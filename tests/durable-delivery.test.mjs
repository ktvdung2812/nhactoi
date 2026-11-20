import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH,randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { boot,call,user,task } from './roadmap-helpers.mjs';
import { openDatabase as connect } from '../server/db.mjs';
import { claimDelivery,beginDelivery,settleDelivery,deliveryFailure } from '../server/delivery-leases.mjs';
import { processReminderEmails } from '../server/reminder-workflow.mjs';
import { processNotificationOutbox } from '../server/mobile.mjs';
import { processWebPush } from '../server/web-push.mjs';

const initial='2026-10-16T02:00:00.000Z';
async function fixture(t,options={}) {
 let now=initial;
 const vapid=webpush.generateVAPIDKeys();
 const s=await boot(t,{clock:()=>new Date(now),env:{NODE_ENV:'test',WEB_PUSH_PUBLIC_KEY:vapid.publicKey,WEB_PUSH_PRIVATE_KEY:vapid.privateKey,WEB_PUSH_SUBJECT:'mailto:fixture@example.test'},...options});
 s.clock=()=>new Date(now);s.setNow=value=>{now=value;};
 s.actor=await user(s,'outbox@lease.test');
 s.task=await task(s,s.actor);
 const key=createECDH('prime256v1');key.generateKeys();
 assert.equal((await call(s,'/web-push/subscriptions',{method:'POST',cookie:s.actor.cookie,body:{endpoint:'https://fcm.googleapis.com/fcm/send/lease-fixture',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}})).status,200);
 const mobile=await call(s,'/mobile/auth/login',{method:'POST',body:{email:s.actor.user.email,password:'Password123!'}});
 const registration=await fetch(s.base+'/api/mobile/devices/lease-fixture',{method:'PUT',headers:{'content-type':'application/json',authorization:`Bearer ${mobile.body.token}`},body:JSON.stringify({fcmToken:'fixture-secret-token'})});
 assert.equal(registration.status,200);
 s.db.prepare('UPDATE tasks SET remind_at=? WHERE id=?').run(initial,s.task.id);
 s.app.locals.processReminders();
 s.notice=s.db.prepare("SELECT * FROM notifications WHERE task_id=? AND type='task_reminder'").get(s.task.id);
 s.second=connect(process.env.TEST_DATABASE_URL,{schema:s.db.schema,migrate:false});
 s.second.projectClock=s.clock;s.second.projectConfig=s.db.projectConfig;
 t.after(()=>s.second.close());
 return s;
}

test('TC-W1-T10 A/B: PostgreSQL independent connections and a transport barrier prevent overlap on all channels',async t=>{
 const s=await fixture(t);
 const workers={email:processReminderEmails,web_push:processWebPush,fcm:processNotificationOutbox};
 for(const [channel,worker] of Object.entries(workers)){
  let started,release,count=0;
  const barrier=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{started=resolve;});
  const send=async()=>{count++;started();await barrier;return {ok:true,messageId:'provider-id'};};
  const args={clock:s.clock,transport:channel==='email'?{sendMail:send}:send};
  const first=worker({db:s.db,...args});await entered;
  const second=await worker({db:s.second,...args});assert.equal(second.sent,0);
  release();await first;
  await worker({db:s.second,...args});assert.equal(count,1,channel);
  assert.equal(s.db.prepare('SELECT status FROM delivery_leases WHERE channel=?').get(channel).status,'sent');
 }
});

test('TC-W1-T10 C/F: expired pre-send leases recover with fencing; expired sending stays unknown and is not replayed',async t=>{
 const s=await fixture(t),args=['email',s.notice.id,s.actor.user.id];
 const old=claimDelivery(s.db,...args,initial);assert.ok(old);
 assert.equal(claimDelivery(s.second,...args,initial),null);
 s.setNow('2026-10-16T02:01:01.000Z');
 const recovered=claimDelivery(s.second,...args,s.clock().toISOString());assert.ok(recovered);assert.notEqual(recovered.token,old.token);
 assert.equal(beginDelivery(s.db,old,s.clock().toISOString()),false);
 assert.equal(beginDelivery(s.second,recovered,s.clock().toISOString()),true);
 s.setNow('2026-10-16T02:02:02.000Z');
 let sends=0;
 await processReminderEmails({db:s.db,clock:s.clock,transport:{sendMail:async()=>sends++}});
 assert.equal(sends,0);assert.equal(s.db.prepare('SELECT status FROM reminder_email_outbox').get().status,'unknown');
 assert.equal(s.db.prepare('SELECT status FROM delivery_leases').get().status,'unknown');
 // A late conclusive provider response from the same fenced attempt can settle.
 assert.equal(settleDelivery(s.second,recovered,'sent',s.clock().toISOString(),()=>s.second.prepare("UPDATE reminder_email_outbox SET status='sent' WHERE notification_id=?").run(s.notice.id)),true);
});

test('TC-W1-T10 D/F/G: timeout remains unknown on every channel, retries are bounded and provider secrets are redacted',async t=>{
 const s=await fixture(t);
 const send=async()=>{throw Object.assign(new Error('Bearer fixture-secret-token private customer'),{code:'ETIMEDOUT'});};
 for(const worker of [()=>processReminderEmails({db:s.db,clock:s.clock,transport:{sendMail:send}}),()=>processWebPush({db:s.db,clock:s.clock,transport:send}),()=>processNotificationOutbox({db:s.db,clock:s.clock,transport:send})]){
  await worker();await worker();
 }
 for(const table of ['reminder_email_outbox','web_push_deliveries','notification_outbox_deliveries','notification_outbox']){
  const row=s.db.prepare(`SELECT status,last_error FROM ${table}`).get();assert.equal(row.status,'unknown',table);assert.equal(row.last_error,'delivery outcome unknown');
 }
 assert.ok(s.db.prepare('SELECT * FROM delivery_leases').all().every(row=>row.status==='unknown'&&row.attempts===1));
 assert.deepEqual(deliveryFailure({statusCode:429,retryAfterSeconds:30},1,{now:initial}),{status:'pending',error:'HTTP 429',nextAttemptAt:'2026-10-16T02:00:30.000Z'});
 assert.equal(deliveryFailure({statusCode:503},1,{now:initial}).status,'pending');
 assert.equal(deliveryFailure({statusCode:403},1,{now:initial}).status,'failed');
 assert.equal(deliveryFailure({responseCode:550},1,{now:initial}).status,'failed');
 assert.equal(deliveryFailure({statusCode:503},5,{now:initial}).status,'failed');
});

test('TC-W1-T10 E: committed business changes are revalidated before sending and failed settlement rolls back atomically',async t=>{
 const s=await fixture(t);
 const claim=claimDelivery(s.db,'email',s.notice.id,s.actor.user.id,initial);assert.ok(beginDelivery(s.db,claim,initial));
 assert.throws(()=>settleDelivery(s.db,claim,'sent',initial,()=>{s.db.prepare("UPDATE reminder_email_outbox SET status='sent' WHERE notification_id=?").run(s.notice.id);throw new Error('injected storage failure');}),/injected/);
 assert.equal(s.db.prepare('SELECT status FROM delivery_leases').get().status,'sending');
 assert.equal(s.db.prepare('SELECT status FROM reminder_email_outbox').get().status,'pending');
 // Simulate a known pre-send failure; next attempt must still recheck task state.
 settleDelivery(s.db,claim,'retry',initial,()=>{});
 s.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(s.task.id);
 let sent=0;const send=async()=>{sent++;return {ok:true};};
 await processReminderEmails({db:s.db,clock:s.clock,transport:{sendMail:send}});
 await processWebPush({db:s.db,clock:s.clock,transport:send});
 await processNotificationOutbox({db:s.db,clock:s.clock,transport:send});
 assert.equal(sent,0);
 assert.ok(s.db.prepare('SELECT status FROM delivery_leases').all().every(row=>row.status==='suppressed'));
});

for(const change of ['revoke','downgrade'])test(`TC-W1-T10 E: ${change} after enqueue suppresses private project delivery on all channels`,async t=>{
 const s=await fixture(t),project=s.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(s.task.id).project_id;
 s.db.prepare("INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at) VALUES(?,?,?,?,'task_update','Changed','Private payload',?)").run('private-update',s.actor.workspace.id,s.actor.user.id,s.task.id,initial);
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(s.actor.workspace.id);
 s.db.prepare("UPDATE projects SET access_mode='private' WHERE id=?").run(project);
 s.db.prepare("UPDATE workspace_members SET role='member',member_type=? WHERE workspace_id=? AND user_id=?").run(change==='downgrade'?'guest':'member',s.actor.workspace.id,s.actor.user.id);
 s.db.prepare("INSERT INTO project_members(project_id,workspace_id,user_id,role,created_at) VALUES(?,?,?,'editor',?)").run(project,s.actor.workspace.id,s.actor.user.id,initial);
 if(change==='revoke')s.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project,s.actor.user.id);
 else s.db.prepare("UPDATE subscriptions SET plan='team' WHERE workspace_id=?").run(s.actor.workspace.id);
 let sent=0;const send=async()=>{sent++;return {ok:true};};
 await processReminderEmails({db:s.db,clock:s.clock,transport:{sendMail:send}});
 await processWebPush({db:s.db,clock:s.clock,transport:send});
 await processNotificationOutbox({db:s.db,clock:s.clock,transport:send});
 assert.equal(sent,0);
 for(const table of ['reminder_email_outbox','web_push_deliveries','notification_outbox_deliveries'])assert.equal(s.db.prepare(`SELECT status FROM ${table}`).get().status,'skipped',table);
 assert.ok(s.db.prepare('SELECT status FROM delivery_leases').all().every(row=>row.status==='suppressed'));
});

test('TC-W1-T10 D/F: authorized email retry resets failed lease but cannot replay an unknown outcome',async t=>{
 const s=await fixture(t);
 await processReminderEmails({db:s.db,clock:s.clock,transport:{sendMail:async()=>{throw {responseCode:550};}}});
 assert.equal(s.db.prepare("SELECT status FROM delivery_leases WHERE channel='email'").get().status,'failed');
 const retried=await call(s,`/tasks/${s.task.id}/reminders/retry-email`,{method:'POST',cookie:s.actor.cookie,body:{}});
 assert.equal(retried.status,200);assert.equal(retried.body.count,1);
 let sent=0;await processReminderEmails({db:s.second,clock:s.clock,transport:{sendMail:async()=>sent++}});assert.equal(sent,1);
 // Unknown outcomes require reconciliation, never the ordinary failed-job button.
 s.db.prepare("UPDATE reminder_email_outbox SET status='unknown' WHERE notification_id=?").run(s.notice.id);
 const unknown=await call(s,`/tasks/${s.task.id}/reminders/retry-email`,{method:'POST',cookie:s.actor.cookie,body:{}});
 assert.equal(unknown.status,200);assert.equal(unknown.body.count,0);
});

test('TC-W1-T10 D: a stale selected candidate cannot bypass persisted retry backoff',async t=>{
 const s=await fixture(t),next='2026-10-16T02:05:00.000Z';
 const claim=claimDelivery(s.db,'email',s.notice.id,s.actor.user.id,initial);assert.ok(beginDelivery(s.db,claim,initial));
 settleDelivery(s.db,claim,'retry',initial,()=>s.db.prepare('UPDATE reminder_email_outbox SET next_attempt_at=? WHERE notification_id=?').run(next,s.notice.id),{nextAttemptAt:next});
 assert.equal(claimDelivery(s.second,'email',s.notice.id,s.actor.user.id,initial),null);
 assert.ok(claimDelivery(s.second,'email',s.notice.id,s.actor.user.id,next));
 assert.equal(deliveryFailure({statusCode:429,retryAfterSeconds:null},1,{now:initial}).nextAttemptAt,'2026-10-16T02:01:00.000Z');
});

test('TC-W1-T10 A: committed pending jobs survive loss of the worker connection',async t=>{
 const s=await fixture(t);s.db.close();
 let count=0;const send=async()=>{count++;return {ok:true};};
 await processReminderEmails({db:s.second,clock:s.clock,transport:{sendMail:send}});
 await processWebPush({db:s.second,clock:s.clock,transport:send});
 await processNotificationOutbox({db:s.second,clock:s.clock,transport:send});
 assert.equal(count,3);
 assert.equal(s.second.prepare("SELECT count(*) n FROM delivery_leases WHERE status='sent'").get().n,3);
});
