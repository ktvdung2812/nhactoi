import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';

const clock = () => new Date('2026-10-16T02:00:00.000Z');
const create = (s,actor,body) => call(s,'/tasks',{cookie:actor.cookie,method:'POST',body:{title:'Reliable task',dueAt:'2026-10-20T02:00:00.000Z',...body}});
const mutation = (s,actor,path,body,method='PATCH') => call(s,path,{cookie:actor.cookie,method,body});
const row = (s,id) => s.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);

test('TC-W1-T09-A/C/D task retry returns committed receipt and rejects a changed payload across current scope',async t=>{
  const s=await boot(t,{clock}),a=await user(s,'receipt-a@example.test'),b=await user(s,'receipt-b@example.test');
  const payload={title:'Task A',operationId:'operation-create-0001'};
  const first=await create(s,a,payload),again=await create(s,a,payload);
  assert.equal(first.status,201,JSON.stringify(first.body));
  assert.deepEqual(again.body,first.body);
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(a.workspace.id).n,1);
  assert.equal((await create(s,a,{...payload,title:'Changed'})).status,409);
  const other=await create(s,b,{...payload,title:'Task B'});
  assert.equal(other.status,201);
  assert.notEqual(other.body.task.id,first.body.task.id);
  const task=first.body.task;
  const done={status:'done',operationId:'operation-done-0001',expectedRevision:task.revision};
  const complete=await mutation(s,a,`/tasks/${task.id}`,done);
  assert.equal(complete.status,200,JSON.stringify(complete.body));
  assert.deepEqual((await mutation(s,a,`/tasks/${task.id}`,done)).body,complete.body);
  s.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(a.workspace.id,a.user.id);
  assert.notEqual((await create(s,a,payload)).status,201);
  assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE workspace_id=?').get(a.workspace.id).n,2);
});

test('TC-W1-T08-B aggregate revision changes for checklist and labels; stale child writes cannot mutate',async t=>{
  const s=await boot(t,{clock}),a=await user(s,'aggregate@example.test');
  const task=(await create(s,a,{})).body.task;
  const list=await mutation(s,a,`/tasks/${task.id}/checklists`,{title:'List',expectedRevision:task.revision},'POST');
  assert.equal(list.status,201,JSON.stringify(list.body));
  const current=(await call(s,`/tasks/${task.id}`,{cookie:a.cookie})).body.task;
  assert.notEqual(current.revision,task.revision);
  const stale=await mutation(s,a,`/tasks/${task.id}/checklists`,{title:'Stale',expectedRevision:task.revision},'POST');
  assert.equal(stale.status,409);
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_checklists WHERE task_id=?').get(task.id).n,1);
  const label=await mutation(s,a,'/task-labels',{name:'New label',color:'#3b82f6'},'POST');
  assert.equal(label.status,201,JSON.stringify(label.body));
  const extras=await mutation(s,a,`/tasks/${task.id}/extras`,{assigneeIds:[],labelIds:[label.body.label.id],expectedRevision:current.revision},'PUT');
  assert.equal(extras.status,200,JSON.stringify(extras.body));
  assert.notEqual((await call(s,`/tasks/${task.id}`,{cookie:a.cookie})).body.task.revision,current.revision);
});

test('TC-W1-T08-C/D personal plans have independent versions, including clearing and recreating a plan',async t=>{
  const s=await boot(t,{clock}),a=await user(s,'plan-a@example.test'),b=await user(s,'plan-b@example.test');
  addMember(s,a,b);
  const task=(await create(s,a,{assigneeId:a.user.id})).body.task;
  assert.equal((await mutation(s,a,`/tasks/${task.id}/extras`,{assigneeIds:[b.user.id],labelIds:[]},'PUT')).status,200);
  const shared=(await call(s,`/tasks/${task.id}`,{cookie:a.cookie})).body.task;
  const plan=async actor=>(await call(s,'/personal-tasks',{cookie:actor.cookie})).body.tasks.find(x=>x.id===task.id);
  const pa=await plan(a),pb=await plan(b);
  const first=await mutation(s,a,`/tasks/${task.id}/plan`,{plannedDate:'2026-10-17',expectedRevision:pa.planRevision});
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal((await mutation(s,b,`/tasks/${task.id}/plan`,{plannedDate:'2026-10-18',expectedRevision:pb.planRevision})).status,200);
  assert.equal((await mutation(s,a,`/tasks/${task.id}/plan`,{plannedDate:'2026-10-19',expectedRevision:pa.planRevision})).status,409);
  assert.equal((await call(s,`/tasks/${task.id}`,{cookie:a.cookie})).body.task.revision,shared.revision);
  assert.equal((await mutation(s,a,`/tasks/${task.id}`,{dueAt:'2026-10-22T02:00:00.000Z',expectedRevision:shared.revision})).status,200);
  assert.equal((await plan(a)).plannedDate,'2026-10-17');
  const cleared=await mutation(s,a,`/tasks/${task.id}/plan`,{plannedDate:null,expectedRevision:first.body.planRevision});
  assert.equal(cleared.status,200);
  assert.notEqual(cleared.body.planRevision,pa.planRevision);
  assert.equal((await mutation(s,a,`/tasks/${task.id}/plan`,{plannedDate:'2026-10-19',expectedRevision:pa.planRevision})).status,409);
});

test('TC-W1-T07-A/C/D structured events retain assignment/deadline/ack cycles without resetting ack for labels',async t=>{
  const s=await boot(t,{clock}),a=await user(s,'events@example.test');
  const task=(await create(s,a,{assigneeId:a.user.id,operationId:'event-operation-0001'})).body.task;
  assert.equal((await mutation(s,a,`/tasks/${task.id}/reminders/acknowledge`,{},'POST')).status,200);
  assert.equal((await mutation(s,a,`/tasks/${task.id}/extras`,{assigneeIds:[],labelIds:[]},'PUT')).status,200);
  assert.ok(s.db.prepare('SELECT acknowledged_at FROM task_reminder_responses WHERE task_id=?').get(task.id).acknowledged_at);
  assert.equal((await mutation(s,a,`/tasks/${task.id}/reminders/snooze`,{minutes:30},'POST')).status,200);
  assert.equal((await mutation(s,a,`/tasks/${task.id}`,{dueAt:'2026-10-21T02:00:00.000Z'})).status,200);
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_reminder_responses WHERE task_id=?').get(task.id).n,0);
  const cycles=s.db.prepare('SELECT * FROM task_assignment_cycles WHERE task_id=? ORDER BY deadline_snapshot').all(task.id);
  assert.equal(cycles.length,2);
  assert.equal(cycles[0].deadline_snapshot,'2026-10-20T02:00:00.000Z');
  assert.ok(cycles[0].acknowledged_at);
  assert.equal(cycles[0].close_reason,'deadline_changed');
  assert.equal(cycles[1].acknowledged_at,null);
  assert.equal((await mutation(s,a,`/tasks/${task.id}`,{status:'done'})).status,200);
  assert.equal((await mutation(s,a,`/tasks/${task.id}`,{status:'todo'})).status,200);
  const events=s.db.prepare('SELECT * FROM business_events WHERE task_id=?').all(task.id);
  for(const type of ['task.created','task.assigned','task.acknowledged','task.snoozed','task.deadline_changed','task.completed','task.reopened'])assert.ok(events.some(e=>e.type===type),type);
  for(const e of events){assert.equal(e.actor_user_id,a.user.id);assert.equal(e.source,'web');assert.equal(e.occurred_at,clock().toISOString());}
  assert.equal(events.find(e=>e.type==='task.created').operation_id,'event-operation-0001');
});

test('TC-W1-T07-B/TC-W1-T09-E failure at receipt rolls business, event, recurrence and notification intent back together',async t=>{
  const s=await boot(t,{clock}),a=await user(s,'rollback@example.test');
  const task=(await create(s,a,{recurrence:'daily',assigneeId:a.user.id})).body.task;
  const before={task:row(s,task.id),events:s.db.prepare('SELECT count(*) n FROM business_events').get().n,notices:s.db.prepare('SELECT count(*) n FROM notifications').get().n};
  s.db.exec(`CREATE FUNCTION reject_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$;
    CREATE TRIGGER reject_receipt_test AFTER INSERT ON mutation_receipts FOR EACH ROW EXECUTE FUNCTION reject_receipt_test()`);
  const failed=await mutation(s,a,`/tasks/${task.id}`,{status:'done',operationId:'rollback-operation-01',expectedRevision:task.revision});
  assert.equal(failed.status,500);
  assert.deepEqual(row(s,task.id),before.task);
  assert.equal(s.db.prepare('SELECT count(*) n FROM business_events').get().n,before.events);
  assert.equal(s.db.prepare('SELECT count(*) n FROM notifications').get().n,before.notices);
  assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts').get().n,0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE generated_from_task_id=?').get(task.id).n,0);
  s.db.exec('DROP TRIGGER reject_receipt_test ON mutation_receipts');
  assert.equal((await mutation(s,a,`/tasks/${task.id}`,{status:'done',operationId:'rollback-operation-01',expectedRevision:task.revision})).status,200);
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE generated_from_task_id=?').get(task.id).n,1);
});

async function instance(t,s,suffix){
  const applicationName=`${s.db.schema}_${suffix}`;
  const child=fork(new URL('./fixtures/sync-server.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName],{silent:true});
  let errors='';child.stderr.on('data',d=>{errors+=d});
  t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(kill)});
  const ready=await Promise.race([once(child,'message').then(([x])=>x),once(child,'exit').then(()=>{throw Error(errors)})]);
  return {base:`http://127.0.0.1:${ready.port}`,applicationName};
}

test('TC-W1-T09-B/F two independent processes race one operation and produce one receipt/successor',async t=>{
  const s=await boot(t,{clock}),a=await user(s,'race-receipt@example.test');
  const task=(await create(s,a,{recurrence:'daily'})).body.task;
  const first=await instance(t,s,'first'),second=await instance(t,s,'second');
  const control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();t.after(()=>control.end());
  await control.query(`SET search_path TO "${s.db.schema}"`);
  const operationId='race-complete-operation-01';
  await control.query('BEGIN');
  await control.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))',[JSON.stringify([a.workspace.id,a.user.id,operationId])]);
  const pending=[mutation(first,a,`/tasks/${task.id}`,{status:'done',operationId,expectedRevision:task.revision}),mutation(second,a,`/tasks/${task.id}`,{status:'done',operationId,expectedRevision:task.revision})];
  try{
    const deadline=Date.now()+10000;
    while(true){const waiting=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[[first.applicationName,second.applicationName]]);if(waiting.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both independent requests reach barrier');await delay(20);}
  }finally{await control.query('COMMIT');}
  const results=await Promise.all(pending);
  assert.deepEqual(results.map(r=>r.status),[200,200],JSON.stringify(results));
  assert.deepEqual(results[0].body,results[1].body);
  assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get(operationId).n,1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE generated_from_task_id=?').get(task.id).n,1);
  assert.equal(s.db.prepare("SELECT count(*) n FROM business_events WHERE task_id=? AND type='task.completed'").get(task.id).n,1);
});

test('TC-W1-T07-E event history declares missing evidence unknown and enforces tenant access',async t=>{
  const s=await boot(t,{clock}),a=await user(s,'event-history@example.test'),b=await user(s,'event-outsider@example.test');
  const task=(await create(s,a,{})).body.task;
  assert.equal((await call(s,`/tasks/${task.id}/events`,{cookie:a.cookie})).body.historyCoverage,'recorded');
  assert.equal((await call(s,`/tasks/${task.id}/events`,{cookie:b.cookie})).status,404);
  s.db.prepare('DELETE FROM business_events WHERE task_id=?').run(task.id);
  const old=await call(s,`/tasks/${task.id}/events`,{cookie:a.cookie});
  assert.equal(old.status,200);assert.equal(old.body.historyCoverage,'unknown');assert.deepEqual(old.body.events,[]);
});

test('delete retries remain idempotent after soft deletion and plan tombstones do not obstruct physical cleanup',async t=>{
  const s=await boot(t,{clock}),a=await user(s,'receipt-delete@example.test');
  const task=(await create(s,a,{})).body.task;
  assert.equal((await mutation(s,a,`/tasks/${task.id}/plan`,{plannedDate:'2026-10-18'})).status,200);
  const request={operationId:'operation-delete-01'};
  const first=await mutation(s,a,`/tasks/${task.id}`,request,'DELETE');
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.deepEqual((await mutation(s,a,`/tasks/${task.id}`,request,'DELETE')).body,first.body);
  s.db.prepare('DELETE FROM tasks WHERE id=?').run(task.id);
  assert.equal(s.db.prepare('SELECT count(*) n FROM personal_plan_revisions WHERE task_id=?').get(task.id).n,0);
});
