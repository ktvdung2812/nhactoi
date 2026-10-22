import test from 'node:test';import assert from 'node:assert/strict';
import {boot,call,user,task,addMember} from './roadmap-helpers.mjs';
import {DEFAULT_WORK_CALENDAR,validateWorkCalendar,nextWorkingInstant,workingSeconds,nextWorkingOccurrence,delegatedRecipients} from '../server/work-calendar.mjs';
import {withTransaction} from '../server/db.mjs';
import {withMutationContext} from '../server/task-mutation-pipeline.mjs';
import {reminderDeliveryAllowed} from '../server/reminder-workflow.mjs';
const calendar={...DEFAULT_WORK_CALENDAR,enabled:true};
function business(s,owner){s.db.prepare("UPDATE subscriptions SET plan='business',current_period_end='2031-01-01T00:00:00.000Z' WHERE workspace_id=?").run(owner.workspace.id);}
async function setup(t,initial='2026-10-16T09:00:00.000Z'){let at=initial;const s=await boot(t,{clock:()=>new Date(at)}),owner=await user(s,'work-owner@test.local');business(s,owner);return {...s,owner,setTime:v=>{at=v;}};}
const send=(s,path,body,method='POST',cookie=s.owner.cookie)=>call(s,path,{method,cookie,body});
test('TC-W5-T01 calendar boundaries, quiet hours, holiday overrides, anchor and 66h/3h',()=>{
 assert.equal(workingSeconds(calendar,'2026-10-16T09:00:00Z','2026-10-19T03:00:00Z'),10800);
 for(const [input,expected] of [['2026-10-16T01:59:00Z','2026-10-16T02:00:00.000Z'],['2026-10-16T05:00:00Z','2026-10-16T06:00:00.000Z'],['2026-10-16T11:00:00Z','2026-10-19T02:00:00.000Z']])assert.equal(nextWorkingInstant(calendar,input).toISOString(),expected);
 assert.equal(nextWorkingInstant({...calendar,holidays:['2026-10-19']},'2026-10-16T11:00Z').toISOString(),'2026-10-20T02:00:00.000Z');
 assert.equal(nextWorkingInstant({...calendar,quietStart:'17:00',quietEnd:'10:00'},'2026-10-16T10:00Z').toISOString(),'2026-10-19T03:00:00.000Z');
 assert.equal(workingSeconds({...calendar,overrides:{'2026-10-17':[['09:00','11:00']]}},'2026-10-17T00:00Z','2026-10-18T00:00Z'),7200);
 assert.throws(()=>validateWorkCalendar({...calendar,intervals:[['12:00','09:00']]}));
 assert.equal(nextWorkingOccurrence({due_at:'2026-10-19T02:00:00Z',recurrence:'weekly',recurrence_anchor:'2026-10-11T09:00:00Z'},{interval:1,weekdays:[],basis:'due'},'2026-10-19T03:00Z',calendar).toISOString(),'2026-10-26T02:00:00.000Z');
 assert.equal(nextWorkingInstant(DEFAULT_WORK_CALENDAR,'2026-10-17T00:00Z').toISOString(),'2026-10-17T00:00:00.000Z');
});
test('TC-W5-T03 timer idempotency, entry ownership, invalid input and automatic close',async t=>{
 const s=await setup(t),a=await task(s,s.owner),other=await user(s,'other-time@test.local');addMember(s,s.owner,other);
 const start=await send(s,`/tasks/${a.id}/timer/start`,{operationId:'start-123456'});assert.equal(start.status,200,JSON.stringify(start.body));
 assert.deepEqual((await send(s,`/tasks/${a.id}/timer/start`,{operationId:'start-123456'})).body,start.body);
 assert.equal((await send(s,`/tasks/${a.id}/timer/start`,{})).status,409);
 s.setTime('2026-10-16T09:01:10.000Z');const stop=await send(s,`/timers/${start.body.timer.id}/stop`,{operationId:'stop-123456'});assert.equal(stop.body.entry.duration_seconds,70);
 assert.deepEqual((await send(s,`/timers/${start.body.timer.id}/stop`,{operationId:'stop-123456'})).body,stop.body);
 const invalid=await send(s,`/tasks/${a.id}/time`,{startedAt:'2026-10-16T10:00:00Z',endedAt:'2026-10-16T09:00:00Z',operationId:'invalid-entry'});assert.equal(invalid.status,400);
 assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get('invalid-entry').n,0);
 assert.equal((await send(s,`/time-entries/${stop.body.entry.id}`,{startedAt:'2026-10-16T09:00:00Z',endedAt:'2026-10-16T09:01:00Z'},'PATCH',other.cookie)).status,404);
 const again=await send(s,`/tasks/${a.id}/timer/start`,{});assert.equal(again.status,200);s.setTime('2026-10-16T09:02:10.000Z');
 assert.equal((await send(s,`/tasks/${a.id}`,{},'DELETE')).status,200);
 assert.equal(s.db.prepare('SELECT count(*) n FROM work_timers WHERE closed_at IS NULL').get().n,0);
 assert.equal(s.db.prepare('SELECT count(*) n FROM time_entries').get().n,2);
});
test('TC-W5-T03-B one user keeps independent timers and receipts across workspace switches',async t=>{
 const s=await setup(t),a=await task(s,s.owner),second=await user(s,'timer-second-workspace@test.local');business(s,second);
 const b=await task(s,second);let cookie=s.owner.cookie;
 const api=(path,body,method='POST')=>call(s,path,{method,cookie,body});
 const switchTo=async workspaceId=>{const r=await api('/workspaces/switch',{workspaceId});assert.equal(r.status,200,JSON.stringify(r.body));cookie=r.cookie;};
 const snapshot=()=>Object.fromEntries(['tasks','work_timers','time_entries','mutation_receipts','business_events','notifications','notification_outbox','automation_event_queue'].map(table=>[table,s.db.prepare(`SELECT * FROM ${table}`).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
 const startA=await api(`/tasks/${a.id}/timer/start`,{operationId:'timer-shared-start'});assert.equal(startA.status,200);
 // The existing helper grants membership and changes the fixture session scope;
 // the HTTP switch still rotates its cookie, matching real client behavior.
 addMember(s,second,s.owner);await switchTo(second.workspace.id);
 assert.equal((await api('/timers/current',undefined,'GET')).body.timer,null);
 s.setTime('2026-10-16T09:00:10.000Z');
 const startB=await api(`/tasks/${b.id}/timer/start`,{operationId:'timer-shared-start'});assert.equal(startB.status,200,JSON.stringify(startB.body));
 assert.notEqual(startA.body.timer.id,startB.body.timer.id);
 assert.equal(startA.body.timer.user_id,startB.body.timer.user_id);
 assert.deepEqual(s.db.prepare('SELECT workspace_id,count(*) n FROM work_timers WHERE closed_at IS NULL GROUP BY workspace_id ORDER BY workspace_id').all(),[s.owner.workspace.id,second.workspace.id].sort().map(workspace_id=>({workspace_id,n:1})));
 let before=snapshot();
 assert.equal((await api(`/tasks/${b.id}/timer/start`,{operationId:'timer-second-active'})).status,409);
 assert.equal((await api(`/timers/${startA.body.timer.id}/stop`,{operationId:'timer-shared-stop'})).status,404);
 assert.equal((await api(`/tasks/${a.id}/time`,undefined,'GET')).status,404);
 assert.deepEqual(snapshot(),before);
 assert.equal((await api('/timers/current',undefined,'GET')).body.timer.id,startB.body.timer.id);
 assert.deepEqual((await api(`/tasks/${b.id}/timer/start`,{operationId:'timer-shared-start'})).body,startB.body);
 await switchTo(s.owner.workspace.id);
 assert.equal((await api('/timers/current',undefined,'GET')).body.timer.id,startA.body.timer.id);
 before=snapshot();
 assert.equal((await api(`/tasks/${a.id}/timer/start`,{operationId:'timer-second-active'})).status,409);
 assert.equal((await api(`/timers/${startB.body.timer.id}/stop`,{operationId:'timer-shared-stop'})).status,404);
 assert.deepEqual(snapshot(),before);
 s.setTime('2026-10-16T09:01:00.000Z');
 const stopA=await api(`/timers/${startA.body.timer.id}/stop`,{operationId:'timer-shared-stop'});assert.equal(stopA.status,200);assert.equal(stopA.body.entry.duration_seconds,60);
 assert.deepEqual((await api(`/timers/${startA.body.timer.id}/stop`,{operationId:'timer-shared-stop'})).body,stopA.body);
 assert.equal((await api('/timers/current',undefined,'GET')).body.timer,null);
 assert.equal(s.db.prepare('SELECT closed_at FROM work_timers WHERE id=?').get(startB.body.timer.id).closed_at,null);
 await switchTo(second.workspace.id);s.setTime('2026-10-16T09:01:30.000Z');
 const stopB=await api(`/timers/${startB.body.timer.id}/stop`,{operationId:'timer-shared-stop'});assert.equal(stopB.status,200);assert.equal(stopB.body.entry.duration_seconds,80);
 assert.deepEqual((await api(`/timers/${startB.body.timer.id}/stop`,{operationId:'timer-shared-stop'})).body,stopB.body);
 assert.equal((await api('/timers/current',undefined,'GET')).body.timer,null);
 assert.equal(s.db.prepare('SELECT count(*) n FROM time_entries WHERE user_id=?').get(s.owner.user.id).n,2);
 assert.deepEqual(s.db.prepare('SELECT workspace_id,count(*) n FROM mutation_receipts WHERE principal_id=? AND operation_id IN (?,?) GROUP BY workspace_id ORDER BY workspace_id').all(s.owner.user.id,'timer-shared-start','timer-shared-stop'),[s.owner.workspace.id,second.workspace.id].sort().map(workspace_id=>({workspace_id,n:2})));
});
test('TC-W5-T04/T05 capacity per assignee, unknown, private ACL and SLA snapshots',async t=>{
 const s=await setup(t),other=await user(s,'work-member@test.local');addMember(s,s.owner,other);
 assert.equal((await send(s,'/work-calendar',{calendar},'PUT')).status,200);
 const created=await send(s,'/tasks',{title:'SLA sample',assigneeId:s.owner.user.id,dueAt:'2026-10-19T10:00:00.000Z'});assert.equal(created.status,201);const a=created.body.task;
 assert.equal((await send(s,`/tasks/${a.id}/extras`,{assigneeIds:[other.user.id],labelIds:[]},'PUT')).status,200);
 assert.equal((await send(s,`/tasks/${a.id}/estimates`,{userId:s.owner.user.id,seconds:10800},'PUT')).status,200);
 assert.equal((await send(s,`/tasks/${a.id}/estimates`,{userId:other.user.id,seconds:3600},'PUT')).status,200);
 let report=await call(s,'/reports/capacity?from=2026-10-19&to=2026-10-25',{cookie:s.owner.cookie});assert.equal(report.status,200,JSON.stringify(report.body));assert.deepEqual(report.body.items.map(i=>i.estimatedSeconds).sort((a,b)=>a-b),[3600,10800]);
 assert.equal(report.body.items[0].capacitySeconds,144000);
 const emptyPage=(await call(s,'/reports/capacity?from=2026-10-19&to=2026-10-25&page=999',{cookie:s.owner.cookie})).body;assert.equal(emptyPage.items.length,0);assert.equal(emptyPage.total,2);
 await send(s,`/tasks/${a.id}/estimates`,{userId:other.user.id,seconds:null},'PUT');report=await call(s,'/reports/capacity?from=2026-10-19&to=2026-10-25',{cookie:s.owner.cookie});assert.equal(report.body.items.find(i=>i.userId===other.user.id).unknownTaskCount,1);
 s.setTime('2026-10-19T03:00:00.000Z');assert.equal((await send(s,`/tasks/${a.id}/reminders/acknowledge`,{})).status,200);
 await send(s,'/work-calendar',{calendar:{...calendar,holidays:['2026-10-19']}},'PUT');
 let sla=await call(s,'/reports/sla',{cookie:s.owner.cookie});assert.equal(sla.status,200,JSON.stringify(sla.body));const c=sla.body.items.find(c=>c.userId===s.owner.user.id);assert.equal(c.acknowledgementWallSeconds,66*3600);assert.equal(c.acknowledgementWorkingSeconds,3*3600);assert.equal(sla.body.summary.onTimeRate,null);
 await send(s,`/tasks/${a.id}`,{status:'done'},'PATCH');sla=await call(s,'/reports/sla',{cookie:s.owner.cookie});assert.equal(sla.body.summary.onTimeRate,1);assert.equal(sla.body.summary.completedWithDeadlineCount,2);
 const privateProject=await send(s,'/projects',{name:'Private report',accessMode:'private'});assert.equal(privateProject.status,201);await send(s,'/tasks',{title:'PRIVATE_CANARY',projectId:privateProject.body.project.id});
 const portfolio=await call(s,'/reports/portfolio',{cookie:other.cookie});assert.equal(portfolio.status,200,JSON.stringify(portfolio.body));assert.equal(JSON.stringify(portfolio.body).includes('Private report'),false);
 assert.equal((await call(s,'/reports/portfolio?page=999',{cookie:other.cookie})).body.total,portfolio.body.total);
});
test('TC-W5-T02 typed/scheduled rules are durable, atomic, editable, and do not replay history',async t=>{
 const s=await setup(t);const a=await task(s,s.owner);
 const create=body=>send(s,'/automations',{name:'Rule',actions:[{type:'comment',value:'done'}],...body});
 assert.equal((await create({trigger:'manual',actions:Array.from({length:11},()=>({type:'priority',value:'high'}))})).status,400);
 const r=await create({trigger:'task.completed'});assert.equal(r.status,201,JSON.stringify(r.body));
 await send(s,`/tasks/${a.id}`,{status:'done'},'PATCH');s.app.locals.processAutomations();s.app.locals.processAutomations();assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments').get().n,1);
 await send(s,`/automations/${r.body.id}`,{enabled:false},'PATCH');await send(s,`/tasks/${a.id}`,{status:'todo'},'PATCH');await send(s,`/tasks/${a.id}`,{status:'done'},'PATCH');await send(s,`/automations/${r.body.id}`,{enabled:true},'PATCH');s.app.locals.processAutomations();assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments').get().n,1);
 const dup=await send(s,`/automations/${r.body.id}/duplicate`,{});assert.equal(dup.status,201);
 assert.equal((await send(s,`/automations/${dup.body.id}`,{name:'Independent',actions:[{type:'priority',value:'high'}]},'PATCH')).status,200);
 assert.equal(s.db.prepare('SELECT name FROM automation_rules WHERE id=?').get(r.body.id).name,'Rule');
 const sched=await create({trigger:'scheduled',schedule:{time:'17:00',weekdays:[5]}});assert.equal(sched.status,201);
 s.setTime('2026-10-16T10:00:00.000Z');s.app.locals.processAutomations();s.app.locals.processAutomations();assert.equal(s.db.prepare('SELECT count(*) n FROM automation_runs WHERE rule_id=?').get(sched.body.id).n,1);
 const manual=await create({trigger:'manual',actions:Array.from({length:10},()=>({type:'comment',value:'manual'}))});assert.equal(manual.status,201);
 for(let i=0;i<2;i++)assert.equal((await send(s,`/automations/${manual.body.id}/run`,{taskId:a.id,operationId:'manual-retry-123'})).body.ok,true);
 assert.equal(s.db.prepare("SELECT count(*) n FROM task_comments WHERE body='manual'").get().n,10);
 const before=s.db.prepare('SELECT count(*) n FROM business_events').get().n;
 const other=await user(s,'invalid-auto@test.local');addMember(s,s.owner,other);
 const failing=await create({trigger:'manual',actions:[{type:'status',value:'todo'},{type:'assignee',value:other.user.id}]});
 s.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(s.owner.workspace.id,other.user.id);
 const failed=await send(s,`/automations/${failing.body.id}/run`,{taskId:a.id,operationId:'failed-automation'});assert.equal(failed.body.ok,false);
 assert.equal(s.db.prepare('SELECT count(*) n FROM business_events').get().n,before);assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get('failed-automation').n,0);
 assert.equal(s.db.prepare('SELECT status FROM tasks WHERE id=?').get(a.id).status,'done');
});
test('TC-W5-T01 delegates require existing ACL, deduplicate and expire before send',async t=>{
 const s=await setup(t),other=await user(s,'delegate@test.local');addMember(s,s.owner,other);
 const a=(await send(s,'/tasks',{title:'Delegated',assigneeId:s.owner.user.id,dueAt:'2026-10-16T10:00Z',remindAt:'2026-10-16T09:00Z'})).body.task;
 const d=await send(s,'/reminder-delegates',{delegateId:other.user.id,startsAt:'2026-10-16T00:00Z',endsAt:'2026-10-17T00:00Z'});assert.equal(d.status,201);
 const row=s.db.prepare('SELECT * FROM tasks WHERE id=?').get(a.id);
 assert.equal(delegatedRecipients(s.db,row,[{id:s.owner.user.id},{id:other.user.id}],'2026-10-16T09:00:00.000Z').length,2);
 await send(s,'/work-calendar',{userId:s.owner.user.id,calendar:{...calendar,holidays:['2026-10-16']}},'PUT'); // Delegate follows their own working calendar, not the absent principal's.
 s.app.locals.processReminders();const notice=s.db.prepare("SELECT * FROM notifications WHERE task_id=? AND user_id=? AND type='task_reminder'").get(a.id,other.user.id);assert.ok(notice);
 assert.equal(reminderDeliveryAllowed(s.db,notice,'2026-10-16T09:00:00.000Z'),true);
 assert.equal(reminderDeliveryAllowed(s.db,notice,'2026-10-17T01:00:00.000Z'),false);
 const project=(await send(s,'/projects',{name:'Private',accessMode:'private'})).body.project;
 const privateTask=(await send(s,'/tasks',{title:'Private',projectId:project.id,assigneeId:s.owner.user.id})).body.task;
 assert.equal(delegatedRecipients(s.db,s.db.prepare('SELECT * FROM tasks WHERE id=?').get(privateTask.id),[{id:s.owner.user.id}],'2026-10-16T09:00:00.000Z').length,1);
});
test('TC-W5-T03-B independent server processes race timers behind a PostgreSQL barrier',async t=>{
 const {fork}=await import('node:child_process'),{once}=await import('node:events'),{join}=await import('node:path'),{setTimeout:delay}=await import('node:timers/promises'),{default:pg}=await import('pg');
 const s=await setup(t),a=await task(s,s.owner),b=await task(s,s.owner,'Other timer task');
 async function instance(name){const applicationName=s.db.schema+'_'+name,child=fork(new URL('./fixtures/sync-server.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName],{silent:true});let errors='';child.stderr.on('data',d=>{errors+=d;});t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(kill);});const ready=await Promise.race([once(child,'message').then(([x])=>x),once(child,'exit').then(()=>{throw Error(errors);})]);return {base:`http://127.0.0.1:${ready.port}`,applicationName};}
 const first=await instance('timerfirst'),second=await instance('timersecond'),control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();t.after(()=>control.end());
 await control.query(`SET search_path TO "${s.db.schema}"`);await control.query('BEGIN');await control.query('SELECT id FROM tasks WHERE id=ANY($1) FOR UPDATE',[[a.id,b.id]]);
 const pending=[first,second].map((server,i)=>call(server,`/tasks/${i?b.id:a.id}/timer/start`,{method:'POST',cookie:s.owner.cookie,body:{operationId:'timer-race-'+i}}));
 try{const deadline=Date.now()+15000;while(true){const waiting=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[[first.applicationName,second.applicationName]]);if(waiting.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both independent processes reach barrier');await delay(20);}}finally{await control.query('COMMIT');}
 assert.deepEqual((await Promise.all(pending)).map(r=>r.status).sort(),[200,409]);assert.equal(s.db.prepare('SELECT count(*) n FROM work_timers WHERE closed_at IS NULL').get().n,1);assert.equal(s.db.prepare("SELECT count(*) n FROM mutation_receipts WHERE action LIKE 'timer.start:%'").get().n,1);
});
test('TC-W5-T02-F/G current rule owner, downgrade, causation and import suppression',async t=>{
 const s=await setup(t),other=await user(s,'rules-owner@test.local');addMember(s,s.owner,other);s.db.prepare("UPDATE workspace_members SET role='admin' WHERE workspace_id=? AND user_id=?").run(s.owner.workspace.id,other.user.id);
 const r=await send(s,'/automations',{name:'Complete assigns',trigger:'task.completed',actions:[{type:'status',value:'todo'}]},'POST',other.cookie);assert.equal(r.status,201);
 const chained=await send(s,'/automations',{name:'Reopen completes',trigger:'task.reopened',actions:[{type:'status',value:'done'}]});assert.equal(chained.status,201);
 const a=await task(s,s.owner);await send(s,`/tasks/${a.id}`,{status:'done'},'PATCH');s.app.locals.processAutomations();s.app.locals.processAutomations();assert.equal(s.db.prepare('SELECT status FROM tasks WHERE id=?').get(a.id).status,'todo');assert.equal(s.db.prepare('SELECT count(*) n FROM automation_runs WHERE rule_id=?').get(chained.body.id).n,0);
 s.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(s.owner.workspace.id,other.user.id);await send(s,`/tasks/${a.id}`,{status:'done'},'PATCH');s.app.locals.processAutomations();assert.equal(s.db.prepare('SELECT status FROM tasks WHERE id=?').get(a.id).status,'done');assert.equal(s.db.prepare("SELECT count(*) n FROM automation_runs WHERE rule_id=? AND status='failed'").get(r.body.id).n,1);
 const imported=await task(s,s.owner);withTransaction(s.db,()=>withMutationContext(s.db,{source:'import',occurredAt:'2026-10-16T09:00:00.000Z'},()=>s.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(imported.id)));assert.equal(s.db.prepare('SELECT count(*) n FROM automation_event_queue WHERE task_id=?').get(imported.id).n,0);
 await send(s,`/tasks/${a.id}`,{status:'todo'},'PATCH');s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(s.owner.workspace.id);s.app.locals.processAutomations();assert.equal(s.db.prepare('SELECT status FROM tasks WHERE id=?').get(a.id).status,'todo');
});
test('TC-W5-T03-F task membership downgrade closes timer once and preserves history',async t=>{
 const s=await setup(t),other=await user(s,'timer-role@test.local');addMember(s,s.owner,other);const a=await task(s,s.owner);
 const timer=await send(s,`/tasks/${a.id}/timer/start`,{},'POST',other.cookie);assert.equal(timer.status,200);
 const row=s.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(a.id);
 s.db.prepare("INSERT INTO project_members(project_id,workspace_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)").run(row.project_id,s.owner.workspace.id,other.user.id,'2026-10-16T09:01:00Z');
 assert.ok(s.db.prepare('SELECT closed_at FROM work_timers WHERE id=?').get(timer.body.timer.id).closed_at);assert.equal(s.db.prepare('SELECT count(*) n FROM time_entries WHERE timer_id=?').get(timer.body.timer.id).n,1);
 assert.equal((await send(s,`/tasks/${a.id}/timer/start`,{},'POST',other.cookie)).status,404);
 const own=await send(s,`/tasks/${a.id}/timer/start`,{});assert.equal(own.status,200);s.setTime('2032-01-01T00:00:00.000Z');s.app.locals.processWorkTimers();assert.ok(s.db.prepare('SELECT closed_at FROM work_timers WHERE id=?').get(own.body.timer.id).closed_at);
});
test('TC-W5-T02-B/C custom-field conditions preserve false/zero and whole-run side effects rollback',async t=>{
 const s=await setup(t),a=await task(s,s.owner),project=s.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(a.id).project_id;
 const field=await send(s,`/projects/${project}/fields`,{name:'Budget',type:'number'});assert.equal(field.status,201,JSON.stringify(field.body));const fieldId=field.body.field.id;
 assert.equal((await send(s,`/tasks/${a.id}/fields`,{values:{[fieldId]:0}},'PUT')).status,200);
 const r=await send(s,'/automations',{name:'Zero value',projectId:project,trigger:'manual',conditions:[{fieldId,operator:'eq',value:0}],actions:[{type:'comment',value:'matched zero'}]});assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal((await send(s,`/automations/${r.body.id}/run`,{taskId:a.id})).body.ok,true);
 const listed=await call(s,'/automations',{cookie:s.owner.cookie});assert.equal(listed.status,200);assert.match(listed.body.rules.find(x=>x.id===r.body.id).conditionDescriptions[0],/Budget.*0/);
 assert.equal((await send(s,`/automations/${r.body.id}`,{conditions:[{fieldId,operator:'eq',value:false}]},'PATCH')).status,400);
 const other=await user(s,'fault-assignee@test.local');addMember(s,s.owner,other);
 const failRule=await send(s,'/automations',{name:'Fault after notification',trigger:'manual',actions:[{type:'status',value:'done'},{type:'assignee',value:other.user.id}]});assert.equal(failRule.status,201);
 s.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(s.owner.workspace.id,other.user.id);
 const tables=['tasks','task_assignment_cycles','business_events','notifications','notification_outbox','reminder_email_outbox','mutation_receipts','automation_event_queue'];const counts=()=>Object.fromEntries(tables.map(table=>[table,s.db.prepare(`SELECT count(*) n FROM ${table}`).get().n]));const before=counts();
 assert.equal((await send(s,`/automations/${failRule.body.id}/run`,{taskId:a.id,operationId:'rollback-full-123'})).body.ok,false);assert.deepEqual(counts(),before);assert.equal(s.db.prepare('SELECT status FROM tasks WHERE id=?').get(a.id).status,'todo');
});
test('TC-W5-T01-C/T04-D API recurrence retains anchor and capacity moves without double counting',async t=>{
 const s=await setup(t);await send(s,'/work-calendar',{calendar},'PUT');
 const card=(await send(s,'/tasks',{title:'Sunday recurrence',dueAt:'2026-10-11T09:00:00Z',recurrence:'weekly',assigneeId:s.owner.user.id})).body.task;
 await send(s,`/tasks/${card.id}`,{status:'done'},'PATCH');const next=s.db.prepare('SELECT * FROM tasks WHERE generated_from_task_id=?').get(card.id);assert.equal(next.due_at,'2026-10-19T02:00:00.000Z');
 await send(s,'/work-calendar',{calendar:{...calendar,weekdays:[0,1,2,3,4,5,6]}},'PUT');
 await send(s,`/tasks/${next.id}`,{status:'done'},'PATCH');const second=s.db.prepare('SELECT * FROM tasks WHERE generated_from_task_id=?').get(next.id);assert.equal(second.due_at,'2026-10-25T09:00:00.000Z');assert.equal(second.recurrence_anchor,'2026-10-11T09:00:00.000Z');
 const other=await user(s,'moved-estimate@test.local');addMember(s,s.owner,other);await send(s,`/tasks/${second.id}/estimates`,{userId:s.owner.user.id,seconds:10800},'PUT');await send(s,`/tasks/${second.id}`,{assigneeId:other.user.id,dueAt:'2026-10-26T09:00:00.000Z'},'PATCH');
 const oldWeek=await call(s,'/reports/capacity?from=2026-10-19&to=2026-10-25',{cookie:s.owner.cookie});assert.equal(oldWeek.body.items.length,0);
 const newWeek=await call(s,'/reports/capacity?from=2026-10-26&to=2026-11-01',{cookie:s.owner.cookie});assert.equal(newWeek.body.items.length,1);assert.equal(newWeek.body.items[0].userId,other.user.id);assert.equal(newWeek.body.items[0].estimatedSeconds,10800);assert.equal(newWeek.body.items[0].unknownTaskCount,0);
});
test('TC-W5-T03-A/D actual seconds sum before format, planned duration stays independent, invalid dates rollback',async t=>{
 const s=await setup(t),a=(await send(s,'/tasks',{title:'Actual vs planned',assigneeId:s.owner.user.id})).body.task;
 assert.equal((await send(s,`/tasks/${a.id}/plan`,{plannedDate:'2026-10-16',plannedDuration:120},'PATCH')).status,200);
 const manual=await send(s,`/tasks/${a.id}/time`,{startedAt:'2026-10-16T07:00:00Z',endedAt:'2026-10-16T07:59:59Z'});assert.equal(manual.status,200);assert.equal(manual.body.entry.duration_seconds,3599);
 const timer=await send(s,`/tasks/${a.id}/timer/start`,{});s.setTime('2026-10-16T09:01:01.000Z');assert.equal((await send(s,`/timers/${timer.body.timer.id}/stop`,{})).body.entry.duration_seconds,61);
 const detail=await call(s,`/tasks/${a.id}/time`,{cookie:s.owner.cookie});assert.equal(detail.body.totalSeconds,3660);
 const plan=s.db.prepare('SELECT * FROM personal_task_plans WHERE task_id=? AND user_id=?').get(a.id,s.owner.user.id);assert.equal(plan.duration_minutes,120);
 for(const body of [{startedAt:'2026-02-31T00:00:00Z',endedAt:'2026-03-03T01:00:00Z'},{startedAt:'2026-10-16T00:00:00Z',endedAt:'2026-10-16T01:00:00Z',durationSeconds:-1},{startedAt:'2026-10-16T00:00:00.500Z',endedAt:'2026-10-16T01:00:00Z'}])assert.equal((await send(s,`/tasks/${a.id}/time`,body)).status,400);
 assert.equal(s.db.prepare('SELECT count(*) n FROM time_entries WHERE task_id=?').get(a.id).n,2);
});
test('TC-W5-T05-A/B/C/D/F SLA reports preserve cycles, unknown history and deadline denominators',async t=>{
 const s=await setup(t),other=await user(s,'sla-extra@test.local');addMember(s,s.owner,other);const cards=[];
 for(let i=0;i<5;i++)cards.push((await send(s,'/tasks',{title:`Report ${i}`,assigneeId:s.owner.user.id,...(i===0?{}:{dueAt:'2026-10-19T09:00:00Z'})})).body.task);
 await send(s,`/tasks/${cards[0].id}/extras`,{assigneeIds:[other.user.id],labelIds:[]},'PUT');
 let sla=(await call(s,'/reports/sla',{cookie:s.owner.cookie})).body;assert.equal(sla.summary.taskCount,5);assert.equal(sla.summary.assignmentCount,6);assert.equal(sla.summary.cycleCount,6);
 await send(s,`/tasks/${cards[0].id}`,{status:'done'},'PATCH');sla=(await call(s,'/reports/sla',{cookie:s.owner.cookie})).body;assert.equal(sla.summary.completedWithDeadlineCount,0);assert.equal(sla.summary.onTimeRate,null);
 await send(s,`/tasks/${cards[1].id}/reminders/acknowledge`,{});await send(s,`/tasks/${cards[1].id}`,{dueAt:'2026-10-20T09:00:00Z'},'PATCH');await send(s,`/tasks/${cards[1].id}/reminders/acknowledge`,{});await send(s,`/tasks/${cards[1].id}`,{status:'done'},'PATCH');await send(s,`/tasks/${cards[1].id}`,{status:'todo'},'PATCH');await send(s,`/tasks/${cards[1].id}`,{status:'done'},'PATCH');
 s.db.prepare('UPDATE task_assignment_cycles SET history_known=0,started_at=NULL,acknowledged_at=NULL WHERE task_id=?').run(cards[4].id);
 sla=(await call(s,'/reports/sla',{cookie:s.owner.cookie})).body;assert.equal(sla.summary.taskCount,5);assert.equal(sla.summary.assignmentCount,6);assert.equal(sla.summary.cycleCount,8);assert.equal(sla.summary.completedWithDeadlineCount,2);assert.equal(sla.summary.unknownTaskCount,1);
 const history=sla.items.filter(c=>c.taskId===cards[1].id);assert.equal(history.length,3);assert.equal(history.find(c=>c.closeReason==='deadline_changed').deadlineSnapshot,'2026-10-19T09:00:00.000Z');assert.equal(history.filter(c=>c.closeReason==='completed').length,2);
 const unknown=sla.items.find(c=>c.taskId===cards[4].id);assert.equal(unknown.acknowledgementWallSeconds,null);assert.equal(unknown.completionWallSeconds,null);
 const response=await fetch(s.base+'/api/reports/sla?format=csv',{headers:{cookie:s.owner.cookie}});assert.equal(response.status,200);const csv=await response.text();assert.match(csv,/Report 1/);assert.match(csv,/deadlineSnapshot/);
});
test('TC-W5-T01-B/F queued email defers to next working slot then suppresses revoked delegate',async t=>{
 const s=await setup(t,'2026-10-16T10:59:00.000Z'),other=await user(s,'deferred-delegate@test.local');addMember(s,s.owner,other);
 await send(s,'/work-calendar',{calendar},'PUT');await send(s,'/reminder-delegates',{delegateId:other.user.id,startsAt:'2026-10-16T00:00Z',endsAt:'2026-10-20T00:00Z'});
 const a=(await send(s,'/tasks',{title:'Work hours',assigneeId:s.owner.user.id,dueAt:'2026-10-16T11:00Z',remindAt:'2026-10-16T10:59Z'})).body.task;s.app.locals.processReminders();
 let sends=0;const {processReminderEmails}=await import('../server/reminder-workflow.mjs');const run=()=>processReminderEmails({db:s.db,clock:s.app.locals.clock||(()=>new Date('2026-10-16T11:00:00Z')),transport:{sendMail:async()=>{sends++;return {messageId:'fake-work-hour'};}}});
 s.setTime('2026-10-16T11:00:00.000Z');await run();assert.equal(sends,0);const jobs=s.db.prepare('SELECT * FROM reminder_email_outbox e JOIN notifications n ON n.id=e.notification_id WHERE n.task_id=?').all(a.id);assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.next_attempt_at==='2026-10-19T02:00:00.000Z'));
 s.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(s.owner.workspace.id,other.user.id);
 await processReminderEmails({db:s.db,clock:()=>new Date('2026-10-19T02:00:00Z'),transport:{sendMail:async()=>{sends++;return {messageId:'fake-work-hour'};}}});assert.equal(sends,1);
 assert.equal(s.db.prepare('SELECT e.status FROM reminder_email_outbox e JOIN notifications n ON n.id=e.notification_id WHERE n.task_id=? AND n.user_id=?').get(a.id,other.user.id).status,'skipped');
});
test('TC-W5-T02-D two independent automation workers consume one durable typed event',async t=>{
 const {fork}=await import('node:child_process'),{once}=await import('node:events'),{setTimeout:delay}=await import('node:timers/promises'),{default:pg}=await import('pg');
 const s=await setup(t),a=await task(s,s.owner),r=await send(s,'/automations',{name:'Exactly one logical run',trigger:'task.completed',actions:[{type:'comment',value:'one execution'}]});assert.equal(r.status,201);await send(s,`/tasks/${a.id}`,{status:'done'},'PATCH');
 const barrier='automation-start-barrier';
 async function worker(name){const applicationName=s.db.schema+'_'+name,child=fork(new URL('./fixtures/automation-worker.mjs',import.meta.url),[s.db.schema,applicationName,barrier],{silent:true});let errors='';child.stderr.on('data',d=>errors+=d);t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(kill);});await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw Error(errors);})]);return {child,applicationName};}
 const first=await worker('autofirst'),second=await worker('autosecond'),control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();t.after(()=>control.end());await control.query(`SET search_path TO "${s.db.schema}"`);await control.query('BEGIN');await control.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))',[barrier]);
 const pending=[first,second].map(({child})=>{const done=once(child,'message');child.send('run');return done;});
 try{const deadline=Date.now()+15000;while(true){const waiting=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[[first.applicationName,second.applicationName]]);if(waiting.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both independent workers reach start barrier');await delay(20);}}finally{await control.query('COMMIT');}
 await Promise.all(pending);assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments WHERE task_id=?').get(a.id).n,1);assert.equal(s.db.prepare('SELECT count(*) n FROM automation_runs WHERE rule_id=?').get(r.body.id).n,1);assert.equal(s.db.prepare('SELECT count(*) n FROM automation_event_queue WHERE processed_at IS NULL').get().n,0);
});
