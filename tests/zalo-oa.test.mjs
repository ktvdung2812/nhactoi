import {fork} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {boot,user,call,addMember} from './roadmap-helpers.mjs';
function provider(){
 const messages=new Map(),calls=[],templates=[{id:'internal',version:'v1',status:'approved',purpose:'internal',parameters:['content'],cta:'https://example.test/tasks',label:'Thông báo nội bộ'},{id:'care',version:'v1',status:'approved',purpose:'customer_care',parameters:['content']},{id:'promotion',version:'v1',status:'approved',purpose:'promotional',parameters:['content']},{id:'pending',version:'v1',status:'pending',purpose:'internal',parameters:[]}];
 const p={mode:'simulation',reliableNegativeLookup:true,messages,calls,templateList:templates,sendError:null,beforeSend:null,validateError:null,
  authorize:async b=>({oaId:b.oaId,apiVersion:'SIMULATED-v1',policyVersion:'SIMULATED-2026'}),
  templates:async()=>structuredClone(templates),
  recipient:async()=>({purposes:['internal','customer_care','promotional'],evidenceId:'SIMULATED_PROOF',expiresAt:'2030-01-01T00:00:00Z'}),
  validateDelivery:async()=>{if(p.validateError)throw p.validateError;await p.beforeSend?.();},
  send:async(credentials,payload,{requestId})=>{calls.push({requestId,payload});if(p.sendError&&!p.sendError.ambiguous)throw p.sendError;const result={status:'accepted',messageId:'message_'+requestId};messages.set(requestId,result);if(p.sendError)throw p.sendError;return result;},
  lookup:async(_,b)=>messages.get(b.requestId)||{definitivelyNotAccepted:true},
  verifyCallback:async({headers,rawBody})=>{const expected=createHmac('sha256','SIMULATED_CALLBACK_KEY').update(rawBody||'').digest('hex');const received=headers['x-simulated-signature']||'';if(received.length!==expected.length||!timingSafeEqual(Buffer.from(received),Buffer.from(expected)))return null;return JSON.parse(rawBody.toString());},
 };return p;
}
async function fixture(t){
 let at=new Date('2026-10-16T03:00:00Z');const p=provider(),s=await boot(t,{clock:()=>at,zaloOaTransport:p}),owner=await user(s,'oa-owner@example.test');
 s.db.prepare("UPDATE subscriptions SET plan='business',status='active',current_period_end='2035-01-01T00:00:00Z' WHERE workspace_id=?").run(owner.workspace.id);
 const api=(path='',method='GET',body,actor=owner)=>call(s,'/integrations/zalo-oa'+path,{method,body,cookie:actor.cookie});
 assert.equal((await api('/connect','POST',{oaId:'OA_A',token:'TOKEN_SECRET_CANARY',consent:true})).status,200);
 assert.equal((await api('/templates/refresh','POST',{})).status,200);
 assert.equal((await api('/recipients','POST',{recipient:'OA_USER',userId:owner.user.id})).status,200);
 const task=await call(s,'/tasks',{method:'POST',cookie:owner.cookie,body:{title:'Private work',assigneeId:owner.user.id,dueAt:'2026-10-18T02:00:00Z'}});assert.equal(task.status,201,JSON.stringify(task.body));
 const state=(await api()).body,recipientId=state.recipients[0].id,c=s.db.prepare('SELECT * FROM zalo_oa_connections WHERE workspace_id=?').get(owner.workspace.id);
 const body={sourceKind:'task',sourceId:task.body.task.id,templateId:'internal',recipientId,purpose:'internal',parameters:{content:'Thông báo nội bộ: xem công việc'},cta:'https://example.test/tasks'};
 const preview=async(b=body)=>api('/preview','POST',b);
 const enqueue=async(b=body)=>{const r=await preview(b);assert.equal(r.status,200,JSON.stringify(r.body));return api('/deliveries','POST',{...b,previewHash:r.body.previewHash});};
 const process=()=>api('/process','POST',{});
 const callback=async(event,signature=true)=>{const raw=JSON.stringify(event),signed=createHmac('sha256','SIMULATED_CALLBACK_KEY').update(raw).digest('hex');return fetch(s.base+'/api/integrations/zalo-oa/callback',{method:'POST',headers:{'content-type':'application/json','x-simulated-signature':signature?signed:'forged'},body:raw});};
 return {s,p,owner,c,api,task:task.body.task,body,preview,enqueue,process,callback,advance:ms=>at=new Date(+at+ms)};
}
test('TC-W8-T01 tenant-owned encrypted OA, no implicit SaaS rights, disconnect/downgrade preserve history',async t=>{
 const {s,api,owner,c,enqueue,process,p}=await fixture(t);const r=await enqueue();assert.equal(r.status,201);
 const stored=s.db.prepare('SELECT * FROM app_settings WHERE key=?').get('zaloOaToken:'+c.id);assert.equal(stored.encrypted,1);assert.ok(!stored.value.includes('TOKEN_SECRET_CANARY'));assert.ok(!JSON.stringify((await api()).body).includes('TOKEN_SECRET_CANARY'));
 const other=await user(s,'oa-other@example.test');assert.equal((await api('', 'GET',undefined,other)).body.connection,null);
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(other.workspace.id);
 assert.equal((await api('/connect','POST',{oaId:'OA_A',token:'another-token',consent:true},other)).status,403);
 const outsider=await user(s,'oa-saas@example.test');s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(outsider.user.id);addMember(s,owner,outsider);assert.equal((await api('','GET',undefined,outsider)).status,403);
 s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(owner.workspace.id);
 assert.equal((await process()).status,403);await s.app.locals.processZaloOa();assert.equal(p.calls.length,0);assert.equal((await api()).body.deliveries.length,1);
 assert.equal((await api('','DELETE')).status,200);assert.equal((await api()).body.connection.status,'disconnected');assert.equal(s.db.prepare('SELECT count(*) n FROM app_settings WHERE key=?').get('zaloOaToken:'+c.id).n,0);
});
test('TC-W8-T02 validates purpose, template status, exact parameters/CTA, recipient proof and opt-out',async t=>{
 const {api,preview,body,s,c}=await fixture(t);
 assert.equal((await preview()).status,200);
 for(const patch of [{templateId:'pending'},{parameters:{}},{parameters:{content:'x',extra:'payload'}},{cta:'https://attacker.test'},{purpose:'promotional'}])assert.equal((await preview({...body,...patch})).status,400);
 s.db.prepare("UPDATE zalo_oa_recipients SET eligibility_json=? WHERE connection_id=?").run(JSON.stringify({purposes:['internal'],evidenceId:'old',expiresAt:'2020-01-01T00:00:00Z'}),c.id);assert.equal((await preview()).status,400);
 await api('/recipients','POST',{recipient:'OA_USER',userId:s.db.prepare('SELECT authorized_by FROM zalo_oa_connections WHERE id=?').get(c.id).authorized_by});
 assert.equal((await api('/recipients/'+body.recipientId,'PATCH',{optedOut:true})).status,200);assert.equal((await preview()).status,400);
});
test('TC-W8-T03-A / TC-W8-T04-C preview hash, durable logical dedupe, competing worker claim and accepted status independent of task ACK',async t=>{
 const {enqueue,preview,api,body,p,s,task,process}=await fixture(t);const previewed=await preview();assert.equal((await api('/deliveries','POST',{...body,previewHash:'stale'})).status,409);
 const [a,b]=await Promise.all([enqueue(),enqueue()]);assert.equal(a.body.delivery.id,b.body.delivery.id);
 await Promise.all([process(),process()]);assert.equal(p.calls.length,1);assert.deepEqual(p.calls[0].payload,previewed.body.payload);
 assert.equal((await api()).body.deliveries[0].status,'accepted');assert.equal(s.db.prepare('SELECT count(*) n FROM zalo_oa_attempts').get().n,1);
 assert.equal(s.db.prepare('SELECT acknowledged_at FROM task_reminder_responses WHERE task_id=?').get(task.id)?.acknowledged_at??null,null);
});
test('TC-W8-T03-B revalidates after enqueue and after provider validation before external send',async t=>{
 const {enqueue,s,owner,task,p,process,api}=await fixture(t);await enqueue();p.beforeSend=async()=>s.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(task.id);await process();assert.equal(p.calls.length,0);assert.equal((await api()).body.deliveries[0].status,'suppressed');
 assert.equal(s.db.prepare('SELECT count(*) n FROM zalo_oa_attempts').get().n,1);
 s.db.prepare('UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?').run('member',owner.workspace.id,owner.user.id);assert.equal((await api()).status,403);
});
test('TC-W8-T03-C unknown timeout reconciles before retry; spoofed/duplicate/out-of-order callbacks cannot alter tenant or ACK',async t=>{
 const {enqueue,p,process,api,callback,task,s,owner}=await fixture(t);const d=(await enqueue()).body.delivery;p.sendError={ambiguous:true,status:0};await process();assert.equal((await api()).body.deliveries[0].status,'unknown');await process();assert.equal(p.calls.length,1);
 const e={oaId:'OA_A',eventId:'event-read',messageId:'message_'+d.id,requestId:d.id,status:'read'};
 assert.equal((await callback(e,false)).status,403);assert.equal((await callback({...e,oaId:'OA_B'})).status,403);
 assert.equal((await callback(e)).status,200);assert.equal((await callback(e)).status,200);assert.equal((await callback({...e,eventId:'event-delivered',status:'delivered'})).status,200);
 assert.equal((await api()).body.deliveries[0].status,'read');assert.equal(s.db.prepare('SELECT count(*) n FROM zalo_oa_callbacks').get().n,2);
 const history=await call(s,`/tasks/${task.id}/reminders`,{cookie:owner.cookie});assert.equal(history.body.zaloHistory[0].status,'read');assert.ok(!JSON.stringify(history.body.zaloHistory).includes('OA_USER'));
 const outsider=await user(s,'oa-history-outsider@example.test');assert.equal((await call(s,`/tasks/${task.id}/reminders`,{cookie:outsider.cookie})).status,404);
 assert.equal(s.db.prepare('SELECT acknowledged_at FROM task_reminder_responses WHERE task_id=?').get(task.id)?.acknowledged_at??null,null);
});
test('TC-W8-T03-D rate limit retry, attempt cap, secret-free errors, restore hold and crash ambiguity',async t=>{
 const {enqueue,p,process,api,s,advance}=await fixture(t);const d=(await enqueue()).body.delivery;
 s.db.prepare("INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES('restoreSenderHold','{}',0,?)").run(new Date().toISOString());await s.app.locals.processZaloOa();assert.equal(p.calls.length,0);s.db.prepare("DELETE FROM app_settings WHERE key='restoreSenderHold'").run();
 p.sendError={status:429,retryAfterSeconds:60,message:'TOKEN_SECRET_CANARY'};await process();assert.equal((await api()).body.deliveries[0].status,'retry');await process();assert.equal(p.calls.length,1);
 advance(61000);p.sendError=null;await process();assert.equal(p.calls.length,2);assert.equal((await api()).body.deliveries[0].status,'accepted');assert.ok(!JSON.stringify((await api()).body).includes('TOKEN_SECRET_CANARY'));
 s.db.prepare("UPDATE zalo_oa_deliveries SET status='sending',lease_token='crashed',lease_until='2020-01-01T00:00:00Z',provider_message_id=NULL WHERE id=?").run(d.id);await s.app.locals.processZaloOa();assert.equal((await api()).body.deliveries[0].status,'unknown');assert.equal(p.calls.length,2);
 assert.equal((await api('/deliveries/'+d.id+'/reconcile','POST',{})).body.delivery.status,'accepted');assert.equal(p.calls.length,2);
});
test('TC-W8-T02-C service period changes and after-expiry purpose revalidate without touching renewal or finance',async t=>{
 const {s,owner,api,p,process}=await fixture(t);
 const customer=await call(s,'/customers',{method:'POST',cookie:owner.cookie,body:{name:'Customer'}});assert.equal(customer.status,201,JSON.stringify(customer.body));
 const customerId=customer.body.customer?.id||customer.body.id;
 const service=await call(s,'/services',{method:'POST',cookie:owner.cookie,body:{name:'License',customerId,nextDate:'2026-10-17',cycle:'month',amount:100,enabled:true}});assert.equal(service.status,201,JSON.stringify(service.body));
 await api('/recipients','POST',{recipient:'OA_CUSTOMER',customerId});const r=(await api()).body.recipients.find(r=>r.recipient==='OA_CUSTOMER');
 const body={sourceKind:'service',sourceId:service.body.service.id,recipientId:r.id,templateId:'care',purpose:'customer_care',parameters:{content:'Upcoming renewal'}};
 const preview=await api('/preview','POST',body);assert.equal(preview.status,200,JSON.stringify(preview.body));await api('/deliveries','POST',{...body,previewHash:preview.body.previewHash});
 s.db.prepare("UPDATE service_contracts SET next_date='2026-11-17' WHERE id=?").run(body.sourceId);await process();assert.equal(p.calls.length,0);assert.equal((await api()).body.deliveries[0].status,'suppressed');
 s.db.prepare("UPDATE service_contracts SET next_date='2026-10-15' WHERE id=?").run(body.sourceId);assert.equal((await api('/preview','POST',body)).status,400);assert.equal((await api('/preview','POST',{...body,templateId:'promotion',purpose:'promotional'})).status,200);
 assert.equal(s.db.prepare('SELECT count(*) n FROM service_renewals').get().n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM transactions').get().n,0);
});
test('TC-W8-T04 real OA gate remains BLOCKED even after all simulation assertions pass',async t=>{
 const {api}=await fixture(t);assert.equal((await api()).body.realGate,'BLOCKED');assert.equal((await api()).body.connection.contract.mode,'simulation');
});
test('TC-W8-T03-D five known-safe transient attempts terminate; ambiguous errors never schedule blind retries',async t=>{
 const {enqueue,p,process,api,advance,s}=await fixture(t);await enqueue();p.sendError={status:503,definitivelyNotAccepted:true};
 for(let attempt=1;attempt<=5;attempt++){await process();assert.equal(p.calls.length,attempt);assert.equal((await api()).body.deliveries[0].status,attempt===5?'failed':'retry');advance(3600001);}
 await process();assert.equal(p.calls.length,5);assert.equal(s.db.prepare('SELECT count(*) n FROM zalo_oa_attempts').get().n,5);
});
test('TC-W8-T03 transactional enqueue fault leaves no delivery, attempt or side effect',async t=>{
 const {s,enqueue,p}=await fixture(t);s.db.exec(`CREATE FUNCTION fail_oa_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected delivery fault'; END$$; CREATE TRIGGER fail_oa_enqueue BEFORE INSERT ON zalo_oa_deliveries FOR EACH ROW EXECUTE FUNCTION fail_oa_enqueue()`);
 const before=s.db.prepare('SELECT count(*) n FROM business_events').get().n;
 assert.equal((await enqueue()).status,500);assert.equal(s.db.prepare('SELECT count(*) n FROM zalo_oa_deliveries').get().n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM zalo_oa_attempts').get().n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM business_events').get().n,before);assert.equal(p.calls.length,0);
});
test('TC-W8-T03 worker cannot cross provider boundary after losing its lease',async t=>{
 const {s,enqueue,p,process,api,advance}=await fixture(t);await enqueue();p.beforeSend=async()=>{advance(120001);await s.app.locals.processZaloOa();};
 await process();assert.equal(p.calls.length,0);assert.equal((await api()).body.deliveries[0].status,'unknown');
});
test('W8 default production adapter configures real contract but keeps release sender disabled',async t=>{
 const requests=[];const s=await boot(t,{clock:()=>new Date('2026-10-16T03:00:00Z'),zaloOaFetch:async(url)=>{requests.push(url);return new Response(JSON.stringify({error:0,data:{oaid:'OA_LIVE',oa_type:2,is_verified:true}}),{status:200});}}),owner=await user(s,'oa-live-contract@example.test');
 s.db.prepare("UPDATE subscriptions SET plan='business',status='active',current_period_end='2035-01-01T00:00:00Z' WHERE workspace_id=?").run(owner.workspace.id);
 const r=await call(s,'/integrations/zalo-oa/connect',{method:'POST',cookie:owner.cookie,body:{oaId:'OA_LIVE',token:'TOKEN_CANARY',appId:'APP_TEST',oaSecretKey:'OA_SECRET_CANARY',consent:true}});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.connection.senderReady,false);
 assert.deepEqual(requests,['https://openapi.zalo.me/v2.0/oa/getoa']);const publicData=await call(s,'/integrations/zalo-oa',{cookie:owner.cookie});assert.equal(publicData.body.configured,true);assert.equal(publicData.body.realGate,'BLOCKED');assert.ok(!JSON.stringify(publicData.body).includes('CANARY'));
 assert.equal((await call(s,'/integrations/zalo-oa/process',{method:'POST',cookie:owner.cookie,body:{}})).status,409);
});
test('TC-W8-T03-A two independent processes and connections claim one logical delivery behind a PostgreSQL barrier',async t=>{
 const {s,owner,enqueue,api}=await fixture(t),d=(await enqueue()).body.delivery,servers=[],sends=[];
 for(const suffix of ['first','second']){
  const applicationName=s.db.schema+'_oa_'+suffix,child=fork(new URL('./fixtures/zalo-worker.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName],{silent:true});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);child.on('message',message=>{if(message.sent)sends.push(message.sent);});
  t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(kill);});
  const ready=await Promise.race([once(child,'message').then(([r])=>r),once(child,'exit').then(()=>{throw new Error(errors);})]);servers.push({applicationName,base:'http://127.0.0.1:'+ready.port});
 }
 const control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();
 try{
  await control.query(`SET search_path TO "${s.db.schema}"`);await control.query('BEGIN');await control.query('SELECT id FROM zalo_oa_deliveries WHERE id=$1 FOR UPDATE',[d.id]);
  const pending=servers.map(server=>call(server,'/integrations/zalo-oa/process',{method:'POST',cookie:owner.cookie,body:{}}));
  try{const deadline=Date.now()+15000;while(true){const waiting=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[servers.map(s=>s.applicationName)]);if(waiting.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both independent OA workers must reach delivery lock');await delay(20);}}finally{await control.query('COMMIT');}
  const responses=await Promise.all(pending);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.deepEqual(sends,[d.id]);assert.equal((await api()).body.deliveries[0].status,'accepted');assert.equal(s.db.prepare('SELECT count(*) n FROM zalo_oa_attempts WHERE delivery_id=?').get(d.id).n,1);
 }finally{await control.end();}
});
test('TC-W8-T01-B/C role matrix and provider revocation revalidate current access without exposing secrets',async t=>{
 const {s,owner,api,p,enqueue,process,preview,body}=await fixture(t),member=await user(s,'oa-role-matrix@example.test');addMember(s,owner,member);
 for(const memberType of ['member','guest']){s.db.prepare('UPDATE workspace_members SET member_type=?,role=? WHERE workspace_id=? AND user_id=?').run(memberType,'member',owner.workspace.id,member.user.id);assert.equal((await api('','GET',undefined,member)).status,403);assert.equal((await api('/deliveries','POST',body,member)).status,403);}
 s.db.prepare("UPDATE workspace_members SET member_type='member',role='admin' WHERE workspace_id=? AND user_id=?").run(owner.workspace.id,member.user.id);assert.equal((await api('','GET',undefined,member)).status,200);
 for(const status of ['pending','rejected','inactive']){s.db.prepare('UPDATE zalo_oa_templates SET status=? WHERE template_id=?').run(status,'internal');assert.equal((await preview()).status,400);}s.db.prepare("UPDATE zalo_oa_templates SET status='approved' WHERE template_id='internal'").run();
 await enqueue();p.validateError={status:401,message:'TOKEN_SECRET_CANARY'};await process();assert.equal(p.calls.length,0);assert.equal((await api()).body.connection.status,'revoked');await s.app.locals.processZaloOa();assert.equal(p.calls.length,0);
 p.authorize=async()=>({oaId:'WRONG_OA',apiVersion:'SIMULATED',policyVersion:'SIMULATED'});assert.equal((await api('/connect','POST',{oaId:'OA_A',token:'WRONG_SECRET_CANARY',consent:true})).status,403);assert.equal((await api()).body.connection.status,'revoked');assert.ok(!JSON.stringify((await api()).body).includes('CANARY'));
});
