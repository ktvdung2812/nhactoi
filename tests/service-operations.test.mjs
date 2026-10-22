import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {boot,call,user,addMember} from './roadmap-helpers.mjs';
import {processServiceReminders} from '../server/services.mjs';
import {reminderDeliveryAllowed} from '../server/reminder-workflow.mjs';
import {exportSnapshot,upgradeSnapshot} from '../server/database-snapshot.mjs';
import {V5_TABLE_COLUMNS} from '../server/database-tables.mjs';
const clock=()=>new Date('2026-09-22T04:00:00Z');
const write=(s,a,path,body,method='POST')=>call(s,path,{method,cookie:a.cookie,body});
async function service(s,a,body={}){const r=await write(s,a,'/services',{name:'Giấy phép',nextDate:'2026-09-25',cycle:'month',amount:100,...body});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.service;}
const count=(s,table)=>s.db.prepare(`SELECT count(*) n FROM ${table}`).get().n;

test('TC-W2-T03-A/B/D/F/G default is unpaid; explicit expense/task is atomic and monthly anchor survives separate renewals',async t=>{
 const s=await boot(t,{clock:()=>new Date('2026-01-01T02:00:00Z')}),a=await user(s,'renew-atomic@example.test');
 const row=await service(s,a,{nextDate:'2026-01-31'}),path=`/services/${row.id}/renew`;
 const first=await write(s,a,path,{expectedDate:row.nextDate,expectedRevision:row.revision,operationId:'renew-operation-001'});
 assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.nextDate,'2026-02-28');assert.equal(first.body.expenseId,null);assert.equal(count(s,'transactions'),0);assert.equal(s.db.prepare('SELECT actual_paid FROM service_contracts WHERE id=?').get(row.id).actual_paid,null);
 assert.equal((await write(s,a,path,{expectedDate:first.body.nextDate,expectedRevision:row.revision})).status,409);
 const second=await write(s,a,path,{expectedDate:first.body.nextDate,recordExpense:true,createTask:true,operationId:'renew-operation-002'});
 assert.equal(second.status,200,JSON.stringify(second.body));assert.equal(second.body.nextDate,'2026-03-31');assert.ok(second.body.taskId);assert.ok(second.body.expenseId);
 assert.equal(s.db.prepare('SELECT type,amount FROM transactions WHERE id=?').get(second.body.expenseId).type,'expense');assert.equal(count(s,'service_cycle_tasks'),1);
 assert.equal(s.db.prepare('SELECT expense_id,task_id FROM service_renewals WHERE id=?').get(second.body.renewalId).expense_id,second.body.expenseId);
 for(const amount of [-1,Number.MAX_SAFE_INTEGER+1,0])assert.equal((await write(s,a,path,{expectedDate:'2026-03-31',recordExpense:true,amount,operationId:'invalid-operation-'+String(amount)})).status,400);
 assert.equal(count(s,'service_renewals'),2);assert.equal(count(s,'transactions'),1);
});

test('TC-W2-T03-C/H/I replay does not duplicate task/period/expense; task completion alone never renews',async t=>{
 const s=await boot(t,{clock}),a=await user(s,'renew-replay@example.test'),b=await user(s,'renew-denied@example.test');
 const row=await service(s,a),path=`/services/${row.id}/renewal-task`,body={expectedDate:row.nextDate,operationId:'create-renew-task-001'};
 const first=await write(s,a,path,body),again=await write(s,a,path,body),newOp=await write(s,a,path,{...body,operationId:'create-renew-task-002'});
 assert.equal(first.status,200,JSON.stringify(first.body));assert.deepEqual(again.body,first.body);assert.deepEqual(newOp.body,first.body);assert.equal(count(s,'tasks'),1);
 assert.equal((await write(s,b,path,body)).status,404);
 const done=await write(s,a,`/tasks/${first.body.taskId}`,{status:'done'},'PATCH');assert.equal(done.status,200,JSON.stringify(done.body));
 assert.equal(s.db.prepare('SELECT next_date FROM service_contracts WHERE id=?').get(row.id).next_date,row.nextDate);assert.equal(count(s,'service_renewals'),0);assert.equal(count(s,'transactions'),0);
 assert.equal(processServiceReminders({db:s.db,clock}),0,'completed renewal task stops current cycle reminders');
 const renewal={expectedDate:row.nextDate,recordExpense:true,createTask:true,operationId:'renew-replay-001'};
 const paid=await write(s,a,`/services/${row.id}/renew`,renewal),retry=await write(s,a,`/services/${row.id}/renew`,renewal);
 assert.equal(paid.status,200,JSON.stringify(paid.body));assert.deepEqual(retry.body,paid.body);assert.equal(count(s,'service_renewals'),1);assert.equal(count(s,'transactions'),1);assert.equal(count(s,'tasks'),2);
 assert.equal((await write(s,a,`/services/${row.id}/renew`,{...renewal,amount:200})).status,409);
});

test('TC-W2-T03-E receipt fault rolls back renewal, finance, linked task, events and outbox',async t=>{
 const s=await boot(t,{clock}),a=await user(s,'renew-fault@example.test'),row=await service(s,a);
 const tables=['service_renewals','transactions','tasks','service_cycle_tasks','business_events','notifications','mutation_receipts'];const before=tables.map(table=>count(s,table));
 s.db.exec(`CREATE FUNCTION reject_service_receipt() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$;CREATE TRIGGER reject_service_receipt BEFORE INSERT ON mutation_receipts FOR EACH ROW EXECUTE FUNCTION reject_service_receipt();`);
 const body={expectedDate:row.nextDate,recordExpense:true,createTask:true,operationId:'service-fault-op-001'};
 assert.equal((await write(s,a,`/services/${row.id}/renew`,body)).status,500);
 assert.deepEqual(tables.map(table=>count(s,table)),before);assert.equal(s.db.prepare('SELECT next_date FROM service_contracts WHERE id=?').get(row.id).next_date,row.nextDate);
 s.db.exec('DROP TRIGGER reject_service_receipt ON mutation_receipts');assert.equal((await write(s,a,`/services/${row.id}/renew`,body)).status,200);
});

test('TC-W2-T03-G financial permission and invalid bulk leave no changes',async t=>{
 const s=await boot(t,{clock}),a=await user(s,'renew-owner@example.test'),b=await user(s,'renew-member@example.test');addMember(s,a,b);
 const first=await service(s,a),second=await service(s,a),payload={expectedDate:first.nextDate,recordExpense:true,operationId:'member-expense-001'};
 assert.equal((await write(s,b,`/services/${first.id}/renew`,payload)).status,403);assert.equal(count(s,'transactions'),0);assert.equal(count(s,'mutation_receipts'),0);
 const bad=await write(s,a,'/services/bulk',{action:'renew',operationId:'bulk-renew-001',items:[{id:first.id,expectedDate:first.nextDate},{id:second.id,expectedDate:'2000-01-01'}]});assert.equal(bad.status,409);assert.equal(count(s,'service_renewals'),0);assert.equal(count(s,'mutation_receipts'),0);
 const body={...payload,recordExpense:false};const ok=await write(s,b,`/services/${first.id}/renew`,body);assert.equal(ok.status,200,JSON.stringify(ok.body));
 s.db.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?').run(a.workspace.id,b.user.id);assert.notEqual((await write(s,b,`/services/${first.id}/renew`,body)).status,200);
});

test('TC-W2-T02-A/B/C/E reminder time/milestones preserve old timing and only catch up latest current period',async t=>{
 const s=await boot(t,{clock}),a=await user(s,'reminder-time@example.test'),daily=await service(s,a),milestone=await service(s,a,{reminderMode:'milestone'});
 assert.equal(daily.reminderTime,'09:00');assert.equal(processServiceReminders({db:s.db,clock:()=>new Date('2026-09-25T01:59:59Z')}),0,'catch-up still respects the configured daily send hour');
 assert.equal(processServiceReminders({db:s.db,clock:()=>new Date('2026-09-25T02:00:00Z')}),2);
 assert.equal(processServiceReminders({db:s.db,clock:()=>new Date('2026-09-25T02:00:01Z')}),0);
 assert.equal(processServiceReminders({db:s.db,clock:()=>new Date('2026-09-30T02:00:00Z')}),1,'daily emits today only; milestone is deduplicated');
 assert.equal(s.db.prepare('SELECT count(*) n FROM service_reminders WHERE service_id=?').get(milestone.id).n,1);
 s.db.prepare('UPDATE service_contracts SET reminder_time=NULL WHERE id=?').run(daily.id);
 assert.equal(processServiceReminders({db:s.db,clock:()=>new Date('2026-09-30T17:00:00Z')}),1,'legacy all-day policy rolls at VN midnight');
 const old=exportSnapshot(s.db);old.schemaVersion=5;old.tables=Object.fromEntries(Object.entries(V5_TABLE_COLUMNS).map(([table,columns])=>[table,{columns,rows:old.tables[table].rows.map(row=>columns.map(column=>row[old.tables[table].columns.indexOf(column)]))}]));
 const upgraded=upgradeSnapshot(old);const contract=upgraded.tables.service_contracts;const oldRow=contract.rows.find(r=>r[contract.columns.indexOf('id')]===daily.id);assert.equal(oldRow[contract.columns.indexOf('reminder_time')],null);assert.equal(oldRow[contract.columns.indexOf('renewal_anchor')],daily.nextDate);
});

test('TC-W2-T02-D stale queued reminders revalidate service date/recipient/policy and completed cycle task',async t=>{
 const s=await boot(t,{clock}),a=await user(s,'service-delivery@example.test'),b=await user(s,'service-recipient@example.test');addMember(s,a,b);
 const row=await service(s,a);assert.equal(processServiceReminders({db:s.db,clock}),1);const notice=s.db.prepare('SELECT * FROM notifications WHERE service_id=?').get(row.id);
 assert.equal(reminderDeliveryAllowed(s.db,notice,clock().toISOString()),true);
 await write(s,a,`/services/${row.id}`,{assigneeId:b.user.id},'PATCH');assert.equal(reminderDeliveryAllowed(s.db,notice,clock().toISOString()),false);
 await write(s,a,`/services/${row.id}`,{assigneeId:null},'PATCH');await write(s,a,`/services/${row.id}`,{reminderTime:'10:00'},'PATCH');assert.equal(reminderDeliveryAllowed(s.db,notice,clock().toISOString()),false);
 await write(s,a,`/services/${row.id}`,{reminderTime:'09:00',enabled:false},'PATCH');assert.equal(reminderDeliveryAllowed(s.db,notice,clock().toISOString()),false);
});

async function instance(t,s,name){const applicationName=`${s.db.schema}_${name}`,child=fork(new URL('./fixtures/sync-server.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName],{silent:true});let errors='';child.stderr.on('data',d=>errors+=d);t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(kill);});const ready=await Promise.race([once(child,'message').then(([m])=>m),once(child,'exit').then(()=>{throw Error(errors)})]);return {base:`http://127.0.0.1:${ready.port}`,applicationName};}
test('TC-W2-T03-C/H independent processes race at database barrier without duplicate renewal or task',async t=>{
 const s=await boot(t,{clock}),a=await user(s,'service-concurrent@example.test'),row=await service(s,a),first=await instance(t,s,'first'),second=await instance(t,s,'second');
 const control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();t.after(()=>control.end());await control.query(`SET search_path TO "${s.db.schema}"`);
 for(const [suffix,body] of [['renewal-task',{expectedDate:row.nextDate}],['renew',{expectedDate:row.nextDate,recordExpense:true,createTask:true}]]){
  await control.query('BEGIN');await control.query('SELECT id FROM service_contracts WHERE id=$1 FOR UPDATE',[row.id]);
  const pending=[write(first,a,`/services/${row.id}/${suffix}`,{...body,operationId:`race-${suffix}-1`}),write(second,a,`/services/${row.id}/${suffix}`,{...body,operationId:`race-${suffix}-2`})];
  try{const deadline=Date.now()+10000;while(true){const waiting=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[[first.applicationName,second.applicationName]]);if(waiting.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both requests reached independent connection barrier');await delay(20);}}finally{await control.query('COMMIT');}
  const results=await Promise.all(pending);assert.deepEqual(results.map(r=>r.status).sort(),suffix==='renew'?[200,409]:[200,200],JSON.stringify(results.map(({status,body})=>({status,body}))));if(suffix==='renewal-task')assert.deepEqual(results[0].body,results[1].body);
 }
 assert.equal(count(s,'service_renewals'),1);assert.equal(count(s,'transactions'),1);assert.equal(count(s,'service_cycle_tasks'),2);assert.equal(count(s,'tasks'),2);
});

test('TC-W2-T03-F yearly renewals recover the February 29 anchor in the next leap year',async t=>{
 const s=await boot(t,{clock}),a=await user(s,'service-leap@example.test'),row=await service(s,a,{nextDate:'2028-02-29',cycle:'year'});
 let date=row.nextDate;
 for(const expected of ['2029-02-28','2030-02-28','2031-02-28','2032-02-29']){
  const r=await write(s,a,`/services/${row.id}/renew`,{expectedDate:date,operationId:`leap-${expected}`});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.nextDate,expected);date=r.body.nextDate;
 }
});

test('TC-W2-T03 permissions prevent CRM service assignment or reminder delivery to guest',async t=>{
 const s=await boot(t,{clock}),a=await user(s,'service-guest-owner@example.test'),b=await user(s,'service-guest@example.test');addMember(s,a,b);
 s.db.prepare("UPDATE workspace_members SET member_type='guest' WHERE workspace_id=? AND user_id=?").run(a.workspace.id,b.user.id);
 assert.equal((await write(s,a,'/services',{name:'Private CRM',nextDate:'2026-09-25',assigneeId:b.user.id})).status,400);
 const row=await service(s,a);s.db.prepare('UPDATE service_contracts SET assignee_id=? WHERE id=?').run(b.user.id,row.id);
 assert.equal(processServiceReminders({db:s.db,clock}),0);assert.equal(count(s,'notifications'),0);
 assert.equal((await call(s,`/services/${row.id}`,{cookie:b.cookie})).status,403);
});
