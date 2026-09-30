import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,call,user,task,addMember} from './roadmap-helpers.mjs';
import {DEFAULT_REMINDER_POLICY,inQuietHours,processWorkflowReminders,reminderDeliveryAllowed} from '../server/reminder-workflow.mjs';
import {migrateDatabase,SCHEMA_VERSION} from './database-helpers.mjs';
const initial='2026-09-27T02:00:00.000Z';
async function fixture(t,options={}){
 let now=initial;
 const s=await boot(t,{...options,clock:()=>new Date(now)});
 s.setNow=value=>{now=value};s.now=()=>now;
 s.owner=await user(s,'owner@reminder.test');
 s.task=await task(s,s.owner,'Bảo trì');
 s.db.prepare('UPDATE tasks SET due_at=?,assignee_id=? WHERE id=?').run('2026-09-27T03:00:00.000Z',s.owner.user.id,s.task.id);
 s.path=`/tasks/${s.task.id}/reminders`;
 return s;
}
async function policy(s,value){const r=await call(s,'/reminder-policy',{method:'PUT',cookie:s.owner.cookie,body:{...DEFAULT_REMINDER_POLICY,...value}});assert.equal(r.status,200,JSON.stringify(r.body));}
test('multi-stage reminders are opt-in, deduplicated, acknowledgements stop only unacknowledged stages, done stops all',async t=>{
 const s=await fixture(t);
 assert.equal(processWorkflowReminders({db:s.db,clock:s.now}).length,0);
 await policy(s,{enabled:true,steps:[{offsetMinutes:-60,audience:'assignees',condition:'unacknowledged'},{offsetMinutes:60,audience:'leads',condition:'incomplete'}]});
 assert.equal(s.app.locals.processReminders().length,1);
 assert.equal(s.app.locals.processReminders().length,0);
 let r=await call(s,s.path+'/acknowledge',{method:'POST',cookie:s.owner.cookie,body:{}});assert.equal(r.status,200);
 await call(s,s.path+'/acknowledge',{method:'POST',cookie:s.owner.cookie,body:{}});
 assert.equal(s.db.prepare("SELECT count(*) n FROM task_activity WHERE action='task_acknowledged'").get().n,1);
 s.setNow('2026-09-27T04:00:00.000Z');assert.equal(s.app.locals.processReminders().length,1);
 s.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(s.task.id);
 s.setNow('2026-09-27T05:00:00.000Z');assert.equal(s.app.locals.processReminders().length,0);
 assert.equal((await call(s,s.path+'/snooze',{method:'POST',cookie:s.owner.cookie,body:{minutes:60}})).status,409);
});
test('snooze leaves deadline unchanged, suppresses legacy reminder, sends once and resets on assignment/deadline change',async t=>{
 const s=await fixture(t);
 s.db.prepare('UPDATE tasks SET remind_at=? WHERE id=?').run(initial,s.task.id);
 const due=s.db.prepare('SELECT due_at FROM tasks WHERE id=?').get(s.task.id).due_at;
 assert.equal((await call(s,s.path+'/snooze',{method:'POST',cookie:s.owner.cookie,body:{minutes:60}})).status,200);
 assert.equal(s.app.locals.processReminders().length,0);
 s.setNow('2026-09-27T03:00:00.000Z');assert.equal(s.app.locals.processReminders().length,1);assert.equal(s.app.locals.processReminders().length,0);
 assert.equal(s.db.prepare('SELECT due_at FROM tasks WHERE id=?').get(s.task.id).due_at,due);
 s.db.prepare('UPDATE tasks SET due_at=? WHERE id=?').run('2026-09-28T03:00:00.000Z',s.task.id);
 assert.equal(s.db.prepare('SELECT count(*) n FROM task_reminder_responses').get().n,0);
});
test('quiet hours across midnight defer reminders; input, tenant and recipient permissions hold',async t=>{
 const s=await fixture(t),other=await user(s,'other@reminder.test');
 assert.equal((await call(s,s.path,{cookie:other.cookie})).status,404);
 assert.equal((await call(s,'/reminder-policy?teamId=missing',{cookie:other.cookie})).status,403);
 addMember(s,s.owner,other);
 assert.equal((await call(s,s.path+'/acknowledge',{method:'POST',cookie:other.cookie,body:{}})).status,403);
 assert.equal((await call(s,'/reminder-policy',{method:'PUT',cookie:other.cookie,body:DEFAULT_REMINDER_POLICY})).status,403);
 assert.equal((await call(s,s.path+'/snooze',{method:'POST',cookie:s.owner.cookie,body:{minutes:0}})).status,400);
 assert.equal((await call(s,'/reminder-policy',{method:'PUT',cookie:s.owner.cookie,body:{...DEFAULT_REMINDER_POLICY,quietStart:'22:00',quietEnd:null}})).status,400);
 await policy(s,{enabled:true,quietStart:'22:00',quietEnd:'08:00',steps:[{offsetMinutes:0,audience:'assignees',condition:'incomplete'}]});
 s.setNow('2026-09-27T16:00:00.000Z');assert.equal(s.app.locals.processReminders().length,0);
 s.setNow('2026-09-28T01:00:00.000Z');assert.equal(s.app.locals.processReminders().length,1);
 assert.equal(inQuietHours({quietStart:'22:00',quietEnd:'08:00'},'2026-09-27T18:00:00Z'),true);
});
test('email persists, retries without duplicate concurrent sends, then skips completed tasks',async t=>{
 let count=0;
 const s=await fixture(t,{reminderEmailTransport:{sendMail:async()=>{count++;if(count===1)throw new Error('secret SMTP error');}}});
 s.db.prepare('UPDATE tasks SET remind_at=? WHERE id=?').run(initial,s.task.id);
 s.app.locals.processReminders();
 assert.equal((await s.app.locals.processReminderEmails()).failed,1);
 const failed=s.db.prepare('SELECT * FROM reminder_email_outbox').get();assert.equal(failed.attempts,1);assert.ok(!failed.last_error.includes('secret'));
 s.setNow('2026-09-27T02:03:00.000Z');
 await Promise.all([s.app.locals.processReminderEmails(),s.app.locals.processReminderEmails()]);
 assert.equal(count,2);assert.equal(s.db.prepare('SELECT status FROM reminder_email_outbox').get().status,'sent');
 s.db.prepare('UPDATE tasks SET remind_at=? WHERE id=?').run(s.now(),s.task.id);s.app.locals.processReminders();
 s.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(s.task.id);
 assert.equal((await s.app.locals.processReminderEmails()).skipped,1);assert.equal(count,2);
});
test('team lead configures own team; removed membership, archive and expired subscription stop reminders',async t=>{
 const s=await fixture(t),member=await user(s,'lead@reminder.test');addMember(s,s.owner,member);
 const id='team_reminder';
 s.db.prepare('INSERT INTO teams(id,workspace_id,name,description,color,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,s.owner.workspace.id,'Team','','green',initial,initial);
 s.db.prepare('INSERT INTO team_members(team_id,workspace_id,user_id,role,created_at) VALUES(?,?,?,?,?)').run(id,s.owner.workspace.id,member.user.id,'lead',initial);
 s.db.prepare('UPDATE tasks SET team_id=?,assignee_id=? WHERE id=?').run(id,member.user.id,s.task.id);
 const r=await call(s,'/reminder-policy?teamId='+id,{method:'PUT',cookie:member.cookie,body:{...DEFAULT_REMINDER_POLICY,enabled:true}});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(s.app.locals.processReminders().length,1);
 s.db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(id,member.user.id);
 assert.equal((await call(s,s.path,{cookie:member.cookie})).status,404);
 s.setNow('2026-09-27T06:00:00Z');assert.equal(s.app.locals.processReminders().length,0);
 s.db.prepare('UPDATE teams SET archived_at=? WHERE id=?').run(initial,id);
 assert.equal((await call(s,'/reminder-policy?teamId='+id,{method:'PUT',cookie:s.owner.cookie,body:DEFAULT_REMINDER_POLICY})).status,403);
 s.db.prepare("UPDATE subscriptions SET status='expired' WHERE workspace_id=?").run(s.owner.workspace.id);
 assert.equal(s.app.locals.processReminders().length,0);
});
test("[SQLite legacy] revoking overrides restores policy and migration upgrades retain records",async t=>{
 const s=await fixture(t);await policy(s,{enabled:true,allowMemberOverride:true});
 assert.equal((await call(s,s.path,{method:'PUT',cookie:s.owner.cookie,body:{enabled:false,steps:DEFAULT_REMINDER_POLICY.steps}})).status,200);
 assert.equal((await call(s,s.path,{cookie:s.owner.cookie})).body.effectivePolicy.enabled,false);
 await policy(s,{enabled:true,allowMemberOverride:false});
 assert.equal((await call(s,s.path,{cookie:s.owner.cookie})).body.effectivePolicy.enabled,true);
 assert.equal((await call(s,s.path,{method:'PUT',cookie:s.owner.cookie,body:{inherit:true}})).status,403);
 s.db.exec(`DROP TRIGGER reminder_response_reset; DROP TRIGGER reminder_extra_response_reset; DROP TRIGGER reminder_email_enqueue;
 DROP TABLE reminder_notice_context; DROP TABLE reminder_email_outbox; DROP TABLE task_reminder_responses; DROP TABLE task_reminder_settings; DROP TABLE reminder_policies;
 DELETE FROM schema_migrations WHERE version>=27;`);
 migrateDatabase(s.db);assert.equal(s.db.prepare('SELECT max(version) n FROM schema_migrations').get().n,SCHEMA_VERSION);
 assert.equal(s.db.prepare('SELECT title FROM tasks WHERE id=?').get(s.task.id).title,'Bảo trì');
 assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('service push is queued and delivered; stale renewal/archive and tenant reads are blocked',async t=>{
 const sent=[];const s=await fixture(t,{fcmTransport:async m=>{sent.push(m);return {ok:true}}});
 const login=await call(s,'/mobile/auth/login',{method:'POST',body:{email:'owner@reminder.test',password:'Password123!'}});
 const token=login.body.token;
 const r=await fetch(s.base+'/api/mobile/devices/test-device',{method:'PUT',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({fcmToken:'service-test-token'})});assert.equal(r.status,200);
 const created=await call(s,'/services',{method:'POST',cookie:s.owner.cookie,body:{name:'Tên miền',nextDate:'2026-09-28',amount:100000,remindDays:7}});assert.equal(created.status,201,JSON.stringify(created.body));
 const serviceId=created.body.service.id;
 s.app.locals.processServiceReminders();assert.equal((await s.app.locals.processNotificationOutbox()).sent,1);assert.equal(sent[0].notification.entityId,serviceId);
 const other=await user(s,'service-outsider@reminder.test');assert.equal((await call(s,'/services/'+serviceId,{cookie:other.cookie})).status,404);
 const n=s.db.prepare("SELECT * FROM notifications WHERE type='service_renewal'").get();
 assert.equal(reminderDeliveryAllowed(s.db,n,s.now()),true);
 const renewed=await call(s,`/services/${serviceId}/renew`,{method:'POST',cookie:s.owner.cookie,body:{expectedDate:'2026-09-28'}});assert.equal(renewed.status,200);
 assert.equal(reminderDeliveryAllowed(s.db,n,s.now()),false);
});

test('snooze cancels queued deliveries so expiry sends only the replacement',async t=>{
 const deliveries=[];
 const s=await fixture(t,{reminderEmailTransport:{sendMail:async mail=>{deliveries.push(mail);}}});
 s.db.prepare('UPDATE tasks SET remind_at=? WHERE id=?').run(initial,s.task.id);s.app.locals.processReminders();
 assert.equal((await call(s,s.path+'/snooze',{method:'POST',cookie:s.owner.cookie,body:{minutes:60}})).status,200);
 assert.equal(s.db.prepare('SELECT status FROM reminder_email_outbox').get().status,'skipped');
 assert.equal(s.db.prepare('SELECT status FROM notification_outbox').get().status,'skipped');
 s.setNow('2026-09-27T03:00:00Z');assert.equal(s.app.locals.processReminders().length,1);
 await s.app.locals.processReminderEmails();assert.equal(deliveries.length,1);assert.equal(deliveries[0].subject,'Đến giờ nhắc lại');
});
test('label-only and ordering edits retain collaborator acknowledgement; removing the person clears it',async t=>{
 const s=await fixture(t),member=await user(s,'collaborator@reminder.test');addMember(s,s.owner,member);
 const extras=`/tasks/${s.task.id}/extras`;
 let r=await call(s,extras,{method:'PUT',cookie:s.owner.cookie,body:{assigneeIds:[member.user.id],labelIds:[]}});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal((await call(s,s.path+'/acknowledge',{method:'POST',cookie:member.cookie,body:{}})).status,200);
 r=await call(s,extras,{method:'PUT',cookie:s.owner.cookie,body:{assigneeIds:[member.user.id],labelIds:[]}});assert.equal(r.status,200);
 assert.ok(s.db.prepare('SELECT acknowledged_at FROM task_reminder_responses WHERE task_id=? AND user_id=?').get(s.task.id,member.user.id).acknowledged_at);
 await call(s,extras,{method:'PUT',cookie:s.owner.cookie,body:{assigneeIds:[],labelIds:[]}});
 assert.equal(s.db.prepare('SELECT count(*) n FROM task_reminder_responses WHERE user_id=?').get(member.user.id).n,0);
});
test('acknowledging while email is queued suppresses unacknowledged-stage delivery',async t=>{
 let sent=0;const s=await fixture(t,{reminderEmailTransport:{sendMail:async()=>{sent++}}});
 await policy(s,{enabled:true,steps:[{offsetMinutes:-60,audience:'assignees',condition:'unacknowledged'}]});
 s.app.locals.processReminders();
 await call(s,s.path+'/acknowledge',{method:'POST',cookie:s.owner.cookie,body:{}});
 assert.equal((await s.app.locals.processReminderEmails()).skipped,1);assert.equal(sent,0);
});
test('send-test targets the current assignee only and is rate limited',async t=>{
 const s=await fixture(t);
 assert.equal((await call(s,s.path+'/test',{method:'POST',cookie:s.owner.cookie,body:{}})).status,201);
 assert.equal((await call(s,s.path+'/test',{method:'POST',cookie:s.owner.cookie,body:{}})).status,429);
 assert.equal(s.db.prepare("SELECT count(*) n FROM notifications WHERE title='Nhắc thử công việc' AND user_id=?").get(s.owner.user.id).n,1);
});
test('snoozing during an in-flight send cannot resurrect the cancelled queue',async t=>{
 let release,entered;
 const gate=new Promise(r=>{release=r});const started=new Promise(r=>{entered=r});
 const s=await fixture(t,{reminderEmailTransport:{sendMail:async()=>{entered();await gate;}}});
 s.db.prepare('UPDATE tasks SET remind_at=? WHERE id=?').run(initial,s.task.id);s.app.locals.processReminders();
 const running=s.app.locals.processReminderEmails();await started;
 assert.equal((await call(s,s.path+'/snooze',{method:'POST',cookie:s.owner.cookie,body:{minutes:60}})).status,200);
 release();await running;
 assert.equal(s.db.prepare('SELECT status FROM reminder_email_outbox').get().status,'skipped');
});
