// Opt-in reference benchmark: TEST_DATABASE_URL=... node --test tests/performance-x07.mjs
// Fixture remains in an isolated schema managed by the normal test helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, statfsSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { execFileSync, fork } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { request as httpRequest, createServer } from 'node:http';
import { boot, user, addMember } from './roadmap-helpers.mjs';
import { SCHEMA_VERSION } from '../server/db.mjs';
// A synchronous bulk seed blocks the JS event loop long enough to expire an
// idle fetch pool socket. New loopback connections avoid benchmarking that
// harness artifact; connection establishment remains inside each sample.
function call(s,path,{method='GET',body,cookie}={}) {
 return new Promise((resolve,reject)=>{
  const request=httpRequest(s.base+'/api'+path,{method,agent:false,headers:{'content-type':'application/json',cookie}},response=>{
   let data='';response.setEncoding('utf8');response.on('data',chunk=>{data+=chunk;});response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(data)});}catch(error){reject(error);}});
  });request.setTimeout(30000,()=>request.destroy(new Error('Serial HTTP request timed out')));request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
 });
}
const fixedTime='2030-01-02T03:00:00.000Z';
const percentile=(values,fraction)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*fraction)-1];
const fullLoad=process.env.PERF_FULL_LOAD==='1';
const harnessCheck=process.env.PERF_HARNESS_CHECK==='1';
const writeJson=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(path+'.tmp',path);};

function postgresMemory(db){
 const backend=Number(db.prepare('SELECT pg_backend_pid() pid').get().pid);
 const rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);return m?{pid:+m[1],ppid:+m[2],rssBytes:+m[3]*1024,command:m[4]}:null;}).filter(Boolean);
 const parent=rows.find(p=>p.pid===backend)?.ppid,processes=rows.filter(p=>p.pid===parent||p.ppid===parent);
 return {processes,totalRssBytes:processes.reduce((n,p)=>n+p.rssBytes,0),caveat:'Sum of process RSS can count shared PostgreSQL pages repeatedly.'};
}

// Each client owns a durable journal. IPC carries only progress and phase completion,
// so a stalled coordinator, crashed client, or oversized message cannot erase samples.
async function runClients(t,settings,{runId,journalDir,onPhase=()=>{},durations={warmup:60000,measurement:300000},phaseTimeoutMs=450000,readyTimeoutMs=15000}={}){
 mkdirSync(journalDir,{recursive:true});
 const children=settings.map((config,index)=>{
  const child=fork(new URL('./fixtures/performance-client.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc'],env:{PATH:process.env.PATH}});
  const state={child,config,index,stderr:'',lastProgress:null,exit:null};
  child.stderr.on('data',chunk=>{state.stderr=(state.stderr+String(chunk).replaceAll(config.cookie||'never-a-cookie','[redacted]')).slice(-4000);});
  child.on('message',message=>{if(message.kind==='progress')state.lastProgress=message;});
  child.on('exit',(code,signal)=>{state.exit={code,signal};});
  return state;
 });
 let stopped=false;
 const stop=async()=>{
  if(stopped)return;stopped=true;
  await Promise.all(children.map(({child})=>new Promise(resolve=>{
   if(child.exitCode!==null||child.signalCode!==null)return resolve();
   const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);
   child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
  })));
 };
 t.after(stop);
 const wait=(state,kind,phase,send,timeoutMs)=>new Promise((resolve,reject)=>{
  const {child}=state;
  const timer=setTimeout(()=>finish(new Error(`Client ${state.index} ${phase||kind} timed out after ${timeoutMs} ms`)),timeoutMs);
  const onMessage=message=>{
   if(phase&&message.phase!==phase)return;
   if(message.kind===kind)finish(null,message);
   if(message.kind==='fatal'||message.kind==='protocol-error')finish(new Error(`Client ${state.index}: ${JSON.stringify(message.error)}`));
  },onExit=(code,signal)=>finish(new Error(`Client ${state.index} exited ${code}/${signal}`)),onError=error=>finish(error);
  function finish(error,result){clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);child.off('error',onError);error?reject(error):resolve(result);}
  child.on('message',onMessage);child.once('exit',onExit);child.once('error',onError);
  if(child.exitCode!==null||child.signalCode!==null)return onExit(child.exitCode,child.signalCode);
  try{send(error=>{if(error)finish(error);});}catch(error){finish(error);}
 });
 const readJournal=(phase,state)=>{
  const path=join(journalDir,`${phase}-${state.index}.jsonl`),records=[],parseErrors=[];
  try{for(const [line,text] of readFileSync(path,'utf8').split('\n').entries()){
   if(!text)continue;try{records.push(JSON.parse(text));}catch{parseErrors.push(`Incomplete or invalid journal line ${line+1}`);}
  }}catch(error){parseErrors.push(error.code||error.name);}
  const start=records.find(row=>row.kind==='start');
  if(start&&(start.runId!==runId||start.phase!==phase||start.index!==state.index))parseErrors.push('Journal identity mismatch');
  return {path,records,parseErrors};
 };
 const ready=await Promise.allSettled(children.map(state=>wait(state,'ready',null,callback=>state.child.send({kind:'configure',...state.config,index:state.index,runId,journalDir},callback),readyTimeoutMs)));
 const readinessFailures=ready.flatMap((r,index)=>r.status==='rejected'?[{index,error:r.reason.message,stderr:children[index].stderr,exit:children[index].exit}]:[]);
 if(readinessFailures.length){await stop();return {complete:false,readinessFailures,warmup:null,measurement:null};}
 const run=async(phase,durationMs)=>{
  onPhase({phase,status:'RUNNING',durationMs,clients:children.length,journalDir});
  const results=await Promise.allSettled(children.map(state=>wait(state,'result',phase,callback=>state.child.send({kind:'run',phase,durationMs},callback),phaseTimeoutMs)));
  if(results.some(r=>r.status==='rejected'))await stop();
  const clients=children.map((state,index)=>{
   const journal=readJournal(phase,state),result=results[index],complete=journal.records.findLast(row=>row.kind==='complete');
   return {index,path:journal.path,complete:result.status==='fulfilled'&&!!complete&&journal.parseErrors.length===0,
    result:result.status==='fulfilled'?result.value:null,failure:result.status==='rejected'?result.reason.message:null,
    parseErrors:journal.parseErrors,stderr:state.stderr,exit:state.exit,lastProgress:state.lastProgress,
    journalTail:journal.records.filter(r=>r.kind!=='sample').slice(-3),samples:journal.records.filter(r=>r.kind==='sample').map(row=>({...row,client:index}))};
  });
  const samples=clients.flatMap(client=>client.samples),groups=Object.groupBy(samples,s=>s.name),errorCount=samples.filter(s=>s.error).length;
  const summary={phase,status:clients.every(c=>c.complete)?'COMPLETE':'INCOMPLETE',complete:clients.every(c=>c.complete),durationMs,clients:children.length,sampleCount:samples.length,errorCount,errorRate:samples.length?errorCount/samples.length:null,
   clientDiagnostics:clients.map(({samples,...client})=>client),clientMemory:clients.map(c=>c.result?.memory||null),
   groups:Object.entries(groups).map(([name,rows])=>({name,count:rows.length,errors:rows.filter(r=>r.error).length,errorReasons:[...new Set(rows.filter(r=>r.error).map(r=>JSON.stringify(r.error)))].map(value=>JSON.parse(value)),
    p50Ms:percentile(rows.map(r=>r.ms),.5),p95Ms:percentile(rows.map(r=>r.ms),.95),maxMs:Math.max(...rows.map(r=>r.ms)),maxPayloadBytes:Math.max(...rows.map(r=>r.bytes)),
    proposedBudgetMs:rows[0].write?2000:1000,withinProposedBudget:percentile(rows.map(r=>r.ms),.95)<=(rows[0].write?2000:1000)})),samples};
  onPhase(summary);return summary;
 };
 try{
  const warmup=await run('warmup',durations.warmup);
  const measurement=warmup.complete?await run('measurement',durations.measurement):null;
  return {complete:!!measurement?.complete,warmup,measurement};
 }finally{await stop();}
}

test('TC-X07 fixed 50 users / 50,000 tasks, paged bootstrap, query count and memory', {skip:harnessCheck,timeout:fullLoad?1800000:300000}, async t=>{
 const target=process.env.PERF_REPORT_PATH||'artifacts/spec-all-2026-10-16/x07-performance.json';
 const report={caseId:'TC-X07',runId:process.env.PERF_RUN_ID||randomUUID(),startedAt:new Date().toISOString(),status:'RUNNING',stage:'boot',fixedTime,samples:[]};
 const checkpoint=stage=>{report.stage=stage;report.updatedAt=new Date().toISOString();writeJson(target,report);};
 checkpoint('boot');
 try{
 const s=await boot(t,{clock:()=>new Date(fixedTime)}),owner=await user(s,'perf-owner@example.test');
 const workspace=owner.workspace.id, project='prj_ws_'+workspace;
 s.db.prepare("UPDATE subscriptions SET plan='business',current_period_end='2031-01-01T00:00:00Z' WHERE workspace_id=?").run(workspace);
 const guest=fullLoad?await user(s,'perf-guest@example.test'):null,outsider=fullLoad?await user(s,'perf-outsider@example.test'):null;
 let privateProject=project;
 if(fullLoad){
  addMember(s,owner,guest);s.db.prepare("UPDATE workspace_members SET member_type='guest' WHERE workspace_id=? AND user_id=?").run(workspace,guest.user.id);
  const p=await call(s,'/projects',{method:'POST',cookie:owner.cookie,body:{name:'PERF_PRIVATE_CANARY',accessMode:'private'}});assert.equal(p.status,201);privateProject=p.body.project.id;
  assert.equal((await call(s,`/projects/${privateProject}/members/${guest.user.id}`,{method:'PUT',cookie:owner.cookie,body:{role:'viewer'}})).status,200);
 }
 const syntheticCount=fullLoad?48:49,assignmentMod=syntheticCount+1;
 s.db.prepare(`INSERT INTO users(id,name,email,password_hash,created_at)
   SELECT 'perf_user_'||n,'Performance user '||n,'perf-'||n||'@example.test','benchmark-only-no-login',? FROM generate_series(1,CAST(? AS INTEGER)) n`).run(fixedTime,syntheticCount);
 s.db.prepare(`INSERT INTO workspace_members(workspace_id,user_id,role,created_at)
   SELECT ?,'perf_user_'||n,'member',? FROM generate_series(1,CAST(? AS INTEGER)) n`).run(workspace,fixedTime,syntheticCount);
 const rule=await call(s,'/automations',{method:'POST',cookie:owner.cookie,body:{name:'Reference queue',projectId:project,trigger:'task.assigned',actions:[{type:'priority',value:'high'}]}});
 assert.equal(rule.status,201,JSON.stringify(rule.body));
 s.db.prepare("SELECT set_config('nhactoi.mutation_context',?,false)").get(JSON.stringify({source:'benchmark',actorUserId:owner.user.id,occurredAt:fixedTime}));
 const seededAt=performance.now();checkpoint('seed tasks');
 for(let start=1;start<=50000;start+=1000){
  s.db.prepare(`INSERT INTO tasks(id,workspace_id,project_id,title,description,status,priority,recurrence,due_at,assignee_id,created_by,created_at,updated_at)
   SELECT 'perf_task_'||n,?,CASE WHEN n%10=1 THEN ? ELSE ? END,CASE WHEN n%10=1 THEN 'PERF_PRIVATE_CANARY ' ELSE 'Performance task ' END||n,'Fixed Vietnamese fixture: Nhắc tôi',CASE WHEN n%5=0 THEN 'done' ELSE 'todo' END,'medium','none',
    CASE WHEN n%3=0 THEN NULL WHEN n%3=1 THEN '2030-01-01T10:00:00.000Z' ELSE '2030-01-02T10:00:00.000Z' END,
    CASE WHEN n%10=1 OR n%CAST(? AS INTEGER)=0 THEN ? ELSE 'perf_user_'||(n%CAST(? AS INTEGER)) END,?,?,? FROM generate_series(CAST(? AS INTEGER),CAST(? AS INTEGER)) n`)
   .run(workspace,privateProject,project,assignmentMod,owner.user.id,assignmentMod,owner.user.id,fixedTime,fixedTime,start,start+999);
  report.seededTasks=start+999;checkpoint('seed tasks');
 }
 checkpoint('seed assignments');
 for(let start=1;start<=50000;start+=1000)s.db.prepare(`INSERT INTO task_assignees(task_id,user_id,position,created_at)
   SELECT 'perf_task_'||n,CASE WHEN n%10=1 THEN ? WHEN (n+1)%CAST(? AS INTEGER)=0 THEN ? ELSE 'perf_user_'||((n+1)%CAST(? AS INTEGER)) END,0,? FROM generate_series(CAST(? AS INTEGER),CAST(? AS INTEGER)) n`).run(guest?.user.id||'perf_user_1',assignmentMod,owner.user.id,assignmentMod,fixedTime,start,start+999);
 s.db.prepare("SELECT set_config('nhactoi.mutation_context','{}',false)").get();
 if(fullLoad){
  checkpoint('seed events');
  const deficit=Math.max(0,250000-Number(s.db.prepare('SELECT count(*) n FROM business_events').get().n));
  for(let start=1;start<=deficit;start+=5000)s.db.prepare(`INSERT INTO business_events(id,workspace_id,project_id,task_id,type,source,occurred_at,after_json)
   SELECT 'perf_history_'||n,t.workspace_id,t.project_id,t.id,'benchmark.audit','benchmark',?,'{"fixture":true}' FROM generate_series(CAST(? AS INTEGER),CAST(? AS INTEGER)) n JOIN tasks t ON t.id='perf_task_'||((n%50000)+1)`)
   .run(fixedTime,start,Math.min(deficit,start+4999));
 }
 s.db.exec('ANALYZE');
 Object.assign(report,{fixture:{users:50,tasks:50000,assignments:100000,businessEvents:Number(s.db.prepare('SELECT count(*) n FROM business_events').get().n),queuedAutomations:Number(s.db.prepare('SELECT count(*) n FROM automation_event_queue WHERE processed_at IS NULL').get().n)},seedMs:performance.now()-seededAt,
  environment:{node:process.version,postgres:s.db.prepare('SHOW server_version').get().server_version,schema:SCHEMA_VERSION,platform:os.platform(),release:os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),loadAverageBefore:os.loadavg(),baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()},
  caveats:['Shared development host; no production SLA claim.',fullLoad?'10 independent Node client processes; HTTP loopback, fixed server clock.':'Sequential warm API sampling; no concurrent load.', 'Serial baseline uses fresh connections; concurrent clients use default fetch keepalive. Connection setup is timed; no request retries.', 'Browser rendering/device memory and provider latency remain separately unverified.']});
 checkpoint('serial baseline');
 if(fullLoad){report.fixture.privateTasks=5000;report.fixture.guestMembers=1;report.fixture.otherWorkspaceUsers=1;report.environment.disk=statfsSync(s.dir);report.environment.postgresMemoryBefore=postgresMemory(s.db);report.environment.postgresSettings=Object.fromEntries(['max_connections','shared_buffers','work_mem'].map(name=>[name,s.db.prepare(`SHOW ${name}`).get()[name]]));}
 const recordedStatements=new Map();
 let queries=0;const execute=s.db.exec.bind(s.db);s.db.exec=sql=>{queries++;return execute(sql);};const prepare=s.db.prepare.bind(s.db);s.db.prepare=sql=>{const statement=prepare(sql);return Object.fromEntries(Object.entries(statement).map(([method,fn])=>[method,(...args)=>{queries++;if(fullLoad&&/^\s*(SELECT|WITH)\b/i.test(sql)&&/\b(tasks|task_assignment_cycles|automation_event_queue)\b/i.test(sql)){const key=/^WITH page_keys/i.test(sql)?sql+JSON.stringify(args):sql;if(!recordedStatements.has(key))recordedStatements.set(key,{sql,args});}return fn(...args);}]))};
 const measure=async(name,operation,{warmup=2,count=15,read=true}={})=>{
  checkpoint('serial '+name);
  for(let i=0;i<warmup;i++)await operation(i);
  const times=[],counts=[],memory=[];
  for(let i=0;i<count;i++){queries=0;const started=performance.now();await operation(i+warmup);times.push(performance.now()-started);counts.push(queries);memory.push(process.memoryUsage());}
  report.samples.push({name,iterations:count,p50Ms:percentile(times,.5),p95Ms:percentile(times,.95),minMs:Math.min(...times),maxMs:Math.max(...times),queries:{min:Math.min(...counts),max:Math.max(...counts)},maxRssBytes:Math.max(...memory.map(m=>m.rss)),maxHeapUsedBytes:Math.max(...memory.map(m=>m.heapUsed)),proposedBudgetMs:read===null?null:read?1000:2000,withinProposedBudget:read===null?null:percentile(times,.95)<=(read?1000:2000)});checkpoint('serial '+name+' complete');
 };
 await measure('GET /dashboard?tasks=none',async()=>{const r=await call(s,'/dashboard?tasks=none',{cookie:owner.cookie});assert.equal(r.status,200);assert.equal(r.body.tasks.length,0);assert.equal(r.body.taskSummary.total,50000);assert.equal(r.body.taskSummary.open,40000);});
 await measure('GET /dashboard (50 records + SQL totals)',async()=>{const r=await call(s,'/dashboard',{cookie:owner.cookie});assert.equal(r.status,200);assert.equal(r.body.tasks.length,50);assert.equal(r.body.taskPage.total,50000);});
 await measure('GET /tasks?page=300&pageSize=100',async()=>{const r=await call(s,'/tasks?page=300&pageSize=100',{cookie:owner.cookie});assert.equal(r.status,200);assert.equal(r.body.tasks.length,100);assert.equal(r.body.total,50000);});
 const ownerAssignments=Number(prepare('SELECT COUNT(*) n FROM tasks t WHERE t.assignee_id=? OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.user_id=?)').get(owner.user.id,owner.user.id).n);
 await measure('GET /tasks?assigneeId=owner&pageSize=100',async()=>{const r=await call(s,`/tasks?assigneeId=${owner.user.id}&pageSize=100`,{cookie:owner.cookie});assert.equal(r.status,200);assert.equal(r.body.tasks.length,100);assert.equal(r.body.total,ownerAssignments);});
 if(fullLoad){
  for(const pageSize of [20,100])for(const page of [1,Math.ceil(25000/pageSize),Math.ceil(50000/pageSize)])await measure(`GET /tasks?page=${page}&pageSize=${pageSize}`,async()=>{const r=await call(s,`/tasks?page=${page}&pageSize=${pageSize}`,{cookie:owner.cookie});assert.equal(r.status,200);assert.equal(r.body.tasks.length,pageSize);assert.equal(r.body.total,50000);},{count:10});
  await measure('GET private guest task page',async()=>{const r=await call(s,'/tasks?page=1&pageSize=100',{cookie:guest.cookie});assert.equal(r.status,200);assert.equal(r.body.total,5000);assert.ok(r.body.tasks.every(t=>t.projectId===privateProject));});
  await measure('GET outsider task page',async()=>{const r=await call(s,'/tasks?page=1&pageSize=100',{cookie:outsider.cookie});assert.equal(r.status,200);assert.equal(r.body.total,0);assert.ok(!JSON.stringify(r.body).includes('PERF_PRIVATE_CANARY'));});
  for(const path of ['/operations-dashboard?page=1&pageSize=20','/reports/portfolio','/reports/sla'])await measure('GET '+path,async()=>assert.equal((await call(s,path,{cookie:owner.cookie})).status,200),{count:10});
 }
 await measure('PATCH /tasks/perf_task_1',async i=>{const r=await call(s,'/tasks/perf_task_1',{method:'PATCH',cookie:owner.cookie,body:{title:'Performance write '+i,operationId:'perf-write-operation-'+i}});assert.equal(r.status,200,JSON.stringify(r.body));},{read:false});
 await measure('automation worker tick',async()=>{assert.equal(s.app.locals.processAutomations().processed,200);},{warmup:0,count:3,read:null});
 report.queueAfter=Number(s.db.prepare('SELECT count(*) n FROM automation_event_queue WHERE processed_at IS NULL').get().n);
 assert.equal(report.fixture.queuedAutomations-report.queueAfter,600);
 if(fullLoad){
  const settings=Array.from({length:10},(_,index)=>({base:s.base,cookie:index===8?guest.cookie:index===9?outsider.cookie:owner.cookie,
   requests:index===8?[{path:'/tasks?page=1&pageSize=100',name:'guest private page',total:5000,maxRecords:100}]:index===9?[{path:'/tasks?page=1&pageSize=100',name:'other tenant page',total:0,maxRecords:100,absent:'PERF_PRIVATE_CANARY'}]:[
    ...[1,250,500].map(page=>({path:`/tasks?page=${page}&pageSize=100`,total:50000,maxRecords:100})),
    {path:'/dashboard?tasks=none',maxRecords:0},{path:'/operations-dashboard?page=1&pageSize=20'},
    {path:`/tasks/perf_task_${index+1}`,method:'PATCH',name:'task write'}]}));
  queries=0;const peak={rssBytes:0,heapUsedBytes:0},observe=()=>{const m=process.memoryUsage();peak.rssBytes=Math.max(peak.rssBytes,m.rss);peak.heapUsedBytes=Math.max(peak.heapUsedBytes,m.heapUsed);};
  const monitor=setInterval(observe,1000);t.after(()=>clearInterval(monitor));
  const rawSamplesPath=target.replace(/\.json$/,'.samples.json'),journalDir=target.replace(/\.json$/,'.clients');
  const raw={runId:report.runId,warmup:[],measurement:[]};report.load={rawSamplesPath,journalDir};
  const persistPhase=phase=>{
   const {samples,...summary}=phase;
   if(samples)raw[phase.phase]=samples;
   report.load[phase.phase]=summary;writeJson(rawSamplesPath,raw);checkpoint('load '+phase.phase+' '+phase.status);
  };
  const load=await runClients(t,settings,{runId:report.runId,journalDir,onPhase:persistPhase});
  clearInterval(monitor);observe();
  for(const phase of ['warmup','measurement'])if(load[phase])delete load[phase].samples;
  report.load={...report.load,...load,serverMemoryPeak:peak,totalQueriesIncludingWarmup:queries,
   averageQueriesPerRequest:queries/((load.warmup?.sampleCount||0)+(load.measurement?.sampleCount||0))};
  report.environment.postgresMemoryAfter=postgresMemory(s.db);checkpoint('load complete');
  assert.ok(load.complete,'Concurrent phase incomplete; see durable client journals and diagnostics');
  report.executionPlans=[];for(const {sql,args:params} of recordedStatements.values()){
   const analyzed=!/FOR (UPDATE|SHARE)/i.test(sql);
   report.executionPlans.push({sql,analyzed,plan:prepare((analyzed?'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ':'EXPLAIN (FORMAT JSON) ')+sql).all(...params)});checkpoint('execution plans');
  }
 }
 report.environment.loadAverageAfter=os.loadavg();
 if(fullLoad){assert.equal(report.load.measurement.errorCount,0,'All HTTP/ACL errors remain in the report');assert.ok(report.load.measurement.groups.every(g=>g.withinProposedBudget),'Measured read/write p95 exceeded proposed budget; see unchanged raw samples');}
 report.status='PASS';report.completedAt=new Date().toISOString();checkpoint('complete');
 console.log(JSON.stringify({caseId:report.caseId,runId:report.runId,status:report.status,fixture:report.fixture,samples:report.samples,measurement:report.load?.measurement,reportPath:target}));
 }catch(error){report.status='FAIL';report.failure={stage:report.stage,name:error.name,message:error.message};report.completedAt=new Date().toISOString();checkpoint(report.stage);throw error;}
});

// This opt-in protocol check needs no PostgreSQL and never runs the reference load.
// Short phase/request deadlines apply only to these mock-server harness checks.
test('X07 harness journals successful and failed requests with structured causes',{skip:!harnessCheck,timeout:10000},async t=>{
 const dir=mkdtempSync(join(os.tmpdir(),'nhactoi-x07-harness-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const server=createServer((request,response)=>{
  if(request.url==='/api/drop'){request.socket.destroy();return;}
  response.writeHead(request.url==='/api/http-error'?503:200,{'content-type':'application/json'});response.end(JSON.stringify({tasks:[],total:0}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const result=await runClients(t,[{base:`http://127.0.0.1:${server.address().port}`,cookie:'harness-only-cookie',requests:[{path:'/ok',total:0,maxRecords:0},{path:'/http-error'},{path:'/drop'}]}],
  {runId:'harness-success-and-errors',journalDir:dir,durations:{warmup:150,measurement:150},phaseTimeoutMs:3000});
 assert.equal(result.complete,true);assert.ok(result.measurement.samples.length>3);
 assert.ok(result.measurement.samples.some(row=>row.error?.name==='HttpError'&&row.status===503));
 assert.ok(result.measurement.samples.some(row=>row.error?.causeCode==='UND_ERR_SOCKET'&&row.error.stage==='headers'));
 assert.ok(!JSON.stringify(result).includes('harness-only-cookie'));
 assert.ok(result.measurement.clientDiagnostics.every(row=>row.complete));
});
test('X07 harness preserves partial samples and in-flight provenance on coordinator timeout',{skip:!harnessCheck,timeout:10000},async t=>{
 const dir=mkdtempSync(join(os.tmpdir(),'nhactoi-x07-timeout-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const server=createServer((request,response)=>{if(request.url==='/api/hang')return;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({tasks:[],total:0}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const result=await runClients(t,[{base:`http://127.0.0.1:${server.address().port}`,cookie:'harness-only-cookie',requestTimeoutMs:5000,requests:[{path:'/ok'},{path:'/hang'}]}],
  {runId:'harness-timeout',journalDir:dir,durations:{warmup:200,measurement:200},phaseTimeoutMs:400});
 assert.equal(result.complete,false);assert.equal(result.measurement,null);assert.equal(result.warmup.sampleCount,1);
 assert.match(result.warmup.clientDiagnostics[0].failure,/timed out/);
 assert.ok(result.warmup.clientDiagnostics[0].journalTail.some(row=>row.kind==='stopped'&&row.inFlight?.name==='/hang'));
});
