import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {boot,call,user,task,addMember} from './roadmap-helpers.mjs';
import {recordRevision} from '../server/record-revision.mjs';

async function childProcess(t,s,kind,name){
 const applicationName=s.db.schema+'_'+name;
 const args=kind==='automation-worker'?[s.db.schema,applicationName,'unused-start-barrier']:[s.db.schema,join(s.dir,'test.sqlite'),applicationName];
 const child=fork(new URL(`./fixtures/${kind}.mjs`,import.meta.url),args,{silent:true});
 let errors='';child.stderr.on('data',data=>{errors+=data;});
 t.after(async()=>{
  if(child.exitCode!==null)return;
  const exited=once(child,'exit');child.send('close');
  const kill=setTimeout(()=>child.kill('SIGKILL'),5000);
  await exited;clearTimeout(kill);
 });
 const [ready]=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error(errors);})]);
 return {child,applicationName,base:`http://127.0.0.1:${ready.port}`};
}

async function waiting(control,applicationName,queryPart){
 const deadline=Date.now()+15000;
 while(true){
  await control.query('SELECT pg_stat_clear_snapshot()');
  const {rows}=await control.query("SELECT query,wait_event FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[applicationName]);
  if(rows.some(row=>row.query.includes(queryPart)))return;
  assert.ok(Date.now()<deadline,`${applicationName} must reach the PostgreSQL barrier for ${queryPart}`);
  await delay(20);
 }
}

for(const trigger of ['task.completed','scheduled','manual'])test(`TC-W5-T02-F ${trigger} revalidates project after a concurrent HTTP task move`,async t=>{
 const s=await boot(t,{clock:()=>new Date('2026-10-16T07:00:00.000Z')});
 const owner=await user(s,`scope-${trigger.replace('.','-')}@test.local`);
 s.db.prepare("UPDATE subscriptions SET plan='business',current_period_end='2031-01-01T00:00:00.000Z' WHERE workspace_id=?").run(owner.workspace.id);
 const send=(path,body,method='POST')=>call(s,path,{method,body,cookie:owner.cookie});
 const card=await task(s,owner);
 const assignee=await user(s,'scope-assignee@test.local');addMember(s,owner,assignee);
 assert.equal((await send(`/tasks/${card.id}`,{assigneeId:assignee.user.id},'PATCH')).status,200);
 const destination=await send('/projects',{name:'Moved task destination',accessMode:'workspace'});
 assert.equal(destination.status,201,JSON.stringify(destination.body));
 const rule=await send('/automations',{
  name:'Source project only',trigger,
  ...(trigger==='scheduled'?{schedule:{time:'15:00',weekdays:[5]}}:{}),
  actions:[{type:'priority',value:'high'},{type:'comment',value:'must not cross projects'}],
 });
 assert.equal(rule.status,201,JSON.stringify(rule.body));
 if(trigger==='task.completed')assert.equal((await send(`/tasks/${card.id}`,{status:'done'},'PATCH')).status,200);
 const before=s.db.prepare('SELECT * FROM tasks WHERE id=?').get(card.id);
 const deliveryCounts=()=>Object.fromEntries(['notifications','notification_outbox','notification_outbox_deliveries','reminder_email_outbox'].map(table=>[table,s.db.prepare(`SELECT count(*) n FROM ${table}`).get().n]));
 const deliveriesBefore=deliveryCounts();
 const mover=await childProcess(t,s,'sync-server','move');
 const runner=await childProcess(t,s,trigger==='manual'?'sync-server':'automation-worker','run');
 const control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
 await control.connect();t.after(()=>control.end());
 await control.query(`SET search_path TO "${s.db.schema}"`);
 // Only this disposable schema gets the barrier trigger. The actual task move
 // still uses the production HTTP route, validation, revision and event pipeline.
 await control.query(`CREATE FUNCTION pause_project_move() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN PERFORM pg_advisory_xact_lock(hashtext(current_schema()),hashtext('scope-move-barrier')); RETURN NEW; END $$;
 CREATE TRIGGER pause_project_move BEFORE UPDATE OF project_id ON tasks
 FOR EACH ROW WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id) EXECUTE FUNCTION pause_project_move()`);
 await control.query('BEGIN');
 await control.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('scope-move-barrier'))");
 const move=call(mover,`/tasks/${card.id}`,{method:'PATCH',cookie:owner.cookie,body:{projectId:destination.body.project.id,expectedRevision:recordRevision(before,'task')}});
 let pending;
 try{
  await waiting(control,mover.applicationName,'UPDATE tasks');
  if(trigger==='manual')pending=call(runner,`/automations/${rule.body.id}/run`,{method:'POST',cookie:owner.cookie,body:{taskId:card.id,operationId:'automation-scope-move'}});
  else{pending=once(runner.child,'message');runner.child.send('run');}
  // The runner has selected the old project and is now waiting for the task
  // row held by the genuine move transaction, not a mocked scheduling delay.
  await waiting(control,runner.applicationName,'SELECT id FROM tasks');
 }finally{await control.query('COMMIT');}
 const moved=await move;
 assert.equal(moved.status,200,JSON.stringify(moved.body));
 const outcome=await pending;
 const current=s.db.prepare('SELECT * FROM tasks WHERE id=?').get(card.id);
 assert.equal(current.project_id,destination.body.project.id);
 assert.equal(current.priority,before.priority,'old project automation must not mutate the moved task');
 assert.equal(recordRevision(current,'task'),moved.body.task.revision,'only the authorized move may change revision');
 assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments WHERE task_id=?').get(card.id).n,0);
 assert.equal(s.db.prepare("SELECT count(*) n FROM task_activity WHERE task_id=? AND action='automation'").get(card.id).n,0);
 assert.equal(s.db.prepare("SELECT count(*) n FROM business_events WHERE task_id=? AND source='automation'").get(card.id).n,0);
 assert.equal(s.db.prepare("SELECT count(*) n FROM notifications WHERE task_id=? AND message LIKE '%Source project only%'").get(card.id).n,0);
 assert.deepEqual(deliveryCounts(),deliveriesBefore,'rejected automation cannot enqueue or deliver notifications');
 assert.equal(s.db.prepare("SELECT count(*) n FROM mutation_receipts WHERE operation_id='automation-scope-move'").get().n,0);
 const run=s.db.prepare('SELECT status,error FROM automation_runs WHERE rule_id=? AND task_id=?').get(rule.body.id,card.id);
 assert.equal(run?.status,'failed');assert.match(run.error,/dự án/);
 if(trigger==='manual'){assert.equal(outcome.status,200);assert.equal(outcome.body.ok,false);}
 if(trigger==='task.completed')assert.equal(s.db.prepare('SELECT count(*) n FROM automation_event_queue WHERE task_id=? AND processed_at IS NULL').get(card.id).n,0);
});
