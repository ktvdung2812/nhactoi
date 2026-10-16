import test from 'node:test';
import assert from 'node:assert/strict';
import { boot,call,user,addMember } from './roadmap-helpers.mjs';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { workspaceSeatCount } from '../server/workspace-seats.mjs';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
const clock=()=>new Date('2026-09-22T04:00:00Z');
async function fixture(t,options={}){const s=await boot(t,{clock,...options});const owner=await user(s,'guest-owner@example.test');s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);const api=(path,method='GET',body,cookie=owner.cookie)=>call(s,path,{method,body,cookie});const p=await api('/projects','POST',{name:'Private',accessMode:'private'});assert.equal(p.status,201);return {s,owner,api,projectId:p.body.project.id};}
test('guest invitation reserves one seat and acceptance grants only the bound project',async t=>{
 const {s,owner,api,projectId}=await fixture(t);
 const r=await api('/invitations','POST',{email:'new-guest@example.test',memberType:'guest',projectId,projectRole:'commenter'});assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal(workspaceSeatCount(s.db,owner.workspace.id,clock().toISOString()),2);
 const token=new URL(r.body.inviteUrl).searchParams.get('invite');
 const accepted=await api('/invitations/accept','POST',{token,name:'Guest',password:'Password123!'},undefined);assert.equal(accepted.status,200,JSON.stringify(accepted.body));
 assert.equal(accepted.body.user.memberType,'guest');
 const mobile=await api('/mobile/auth/login','POST',{email:'new-guest@example.test',password:'Password123!'});assert.equal(mobile.status,200);assert.equal(mobile.body.user.memberType,'guest');assert.equal(workspaceSeatCount(s.db,owner.workspace.id,clock().toISOString()),2);
 const list=await api('/projects','GET',undefined,accepted.cookie);assert.deepEqual(list.body.projects.map(p=>p.id),[projectId]);
 assert.equal(list.body.projects[0].myRole,'commenter');
 assert.equal((await api('/customers','GET',undefined,accepted.cookie)).status,403);
 assert.equal((await api('/invitations/accept','POST',{token},accepted.cookie)).status,404);
 const p2=await api('/projects','POST',{name:'Another',accessMode:'private'});
 assert.equal((await api(`/projects/${p2.body.project.id}/members/${accepted.body.user.id}`,'PUT',{role:'viewer'})).status,200);
 assert.equal(workspaceSeatCount(s.db,owner.workspace.id,clock().toISOString()),2);
});
test('guest acceptance revalidates plan, project and inviter without creating account or consuming twice',async t=>{
 const {s,owner,api,projectId}=await fixture(t);
 const r=await api('/invitations','POST',{email:'blocked-guest@example.test',memberType:'guest',projectId,projectRole:'editor'});assert.equal(r.status,201);
 const token=new URL(r.body.inviteUrl).searchParams.get('invite');
 s.db.prepare("UPDATE subscriptions SET plan='team' WHERE workspace_id=?").run(owner.workspace.id);
 assert.equal((await api('/invitations/accept','POST',{token,name:'Blocked',password:'Password123!'})).status,403);
 assert.equal(s.db.prepare("SELECT count(*) n FROM users WHERE email='blocked-guest@example.test'").get().n,0);
 assert.equal(s.db.prepare('SELECT accepted_at FROM invitations WHERE workspace_id=?').get(owner.workspace.id).accepted_at,null);
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
 await api(`/projects/${projectId}`,'PATCH',{archived:true});
 assert.equal((await api('/invitations/accept','POST',{token,name:'Blocked',password:'Password123!'})).status,403);
});
test('only workspace administrators may reserve guest seats; invalid project and manager guest cannot mutate',async t=>{
 const {s,owner,api,projectId}=await fixture(t);const manager=await user(s,'project-manager@example.test');addMember(s,owner,manager);
 await api(`/projects/${projectId}/members/${manager.user.id}`,'PUT',{role:'manager'});
 const body={email:'unauthorized-guest@example.test',memberType:'guest',projectId,projectRole:'viewer'};
 assert.equal((await api('/invitations','POST',body,manager.cookie)).status,403);
 assert.equal((await api('/invitations','POST',{...body,projectRole:'manager'})).status,400);
 assert.equal((await api('/invitations','POST',{...body,projectId:'another-workspace-project'})).status,403);
 assert.equal(s.db.prepare('SELECT count(*) n FROM invitations WHERE workspace_id=?').get(owner.workspace.id).n,0);
});

test('two independent API processes race for the last guest seat behind a PostgreSQL barrier',async t=>{
 const {s,owner,api,projectId}=await fixture(t);
 const plans=(await api('/billing')).body.plans.map(p=>({...p,memberLimit:p.id==='business'?2:p.memberLimit}));
 s.db.prepare("INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES ('plans',?,0,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(plans),clock().toISOString());
 const servers=[];
 for(const name of ['guest-first','guest-second']){
  const applicationName=s.db.schema+'_'+name;
  const child=fork(new URL('./fixtures/sync-server.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName],{silent:true});
  t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(kill);});
  const [ready]=await once(child,'message');servers.push({base:'http://127.0.0.1:'+ready.port,applicationName});
 }
 const control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();
 try{
  await control.query(`SET search_path TO "${s.db.schema}"`);await control.query('BEGIN');
  await control.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[owner.workspace.id]);
  const pending=servers.map((server,i)=>call(server,'/invitations',{method:'POST',cookie:owner.cookie,body:{email:`race-guest-${i}@example.test`,memberType:'guest',projectId,projectRole:'viewer'}}));
  try{const deadline=Date.now()+10000;while(true){const wait=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[servers.map(s=>s.applicationName)]);if(wait.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both independent requests must wait on workspace lock');await delay(20);}}finally{await control.query('COMMIT');}
  assert.deepEqual((await Promise.all(pending)).map(r=>r.status).sort(),[201,409]);
  assert.equal(workspaceSeatCount(s.db,owner.workspace.id,clock().toISOString()),2);
 }finally{await control.end();}
});

async function seatRace(t, s, owner, options = {}) {
 const optionsPath=join(s.dir,'seat-race-options.json');writeFileSync(optionsPath,JSON.stringify(options));
 const servers=[];
 for(let i=0;i<2;i++){
  const applicationName=s.db.schema+'_seat_race_'+i;
  const child=fork(new URL('./fixtures/sync-server.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName,optionsPath],{silent:true});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(kill);});
  const ready=await Promise.race([once(child,'message').then(([value])=>value),once(child,'exit').then(()=>{throw new Error(errors);})]);
  servers.push({base:'http://127.0.0.1:'+ready.port,applicationName});
 }
 const control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();t.after(()=>control.end());
 await control.query(`SET search_path TO "${s.db.schema}"`);
 return async (operations,beforeRelease=()=>{})=>{
  await control.query('BEGIN');await control.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[owner.workspace.id]);
  const pending=operations.map((operation,i)=>operation(servers[i]));
  try{
   const deadline=Date.now()+15000;
   while(true){
    const result=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[servers.map(server=>server.applicationName)]);
    if(result.rows[0].n===2)break;
    assert.ok(Date.now()<deadline,'both independent processes must reach the workspace lock');await delay(20);
   }
   beforeRelease();
  }finally{await control.query('COMMIT');}
  return Promise.all(pending);
 };
}
const businessSideEffects=db=>Object.fromEntries(['business_events','mutation_receipts','notification_outbox','reminder_email_outbox','web_push_deliveries','webhook_deliveries','zalo_oa_deliveries'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));

test('TC-W1-T05-D expiry during accept/invite contention releases one reserved seat, and later revoke cannot release it twice',async t=>{
 const {s,owner,api,projectId}=await fixture(t);
 const plans=(await api('/billing')).body.plans.map(plan=>({...plan,memberLimit:plan.id==='business'?2:plan.memberLimit}));
 s.db.prepare("INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES('plans',?,0,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(plans),clock().toISOString());
 const expired=await api('/invitations','POST',{email:'expires-at-barrier@example.test',memberType:'guest',projectId,projectRole:'viewer'});assert.equal(expired.status,201);
 const token=new URL(expired.body.inviteUrl).searchParams.get('invite');
 const oldId=s.db.prepare('SELECT id FROM invitations WHERE workspace_id=?').get(owner.workspace.id).id;
 const clockFile=join(s.dir,'seat-clock.txt');writeFileSync(clockFile,clock().toISOString());
 const overlap=await seatRace(t,s,owner,{clockFile}),before=businessSideEffects(s.db);
 const results=await overlap([
  server=>call(server,'/invitations/accept',{method:'POST',body:{token,name:'Expired guest',password:'Password123!'}}),
  server=>call(server,'/invitations',{method:'POST',cookie:owner.cookie,body:{email:'replacement@example.test',memberType:'guest',projectId,projectRole:'viewer'}}),
 ],()=>writeFileSync(clockFile,expired.body.expiresAt));
 assert.deepEqual(results.map(result=>result.status),[409,201]);
 assert.equal(s.db.prepare("SELECT count(*) n FROM users WHERE email='expires-at-barrier@example.test'").get().n,0);
 assert.equal(s.db.prepare('SELECT accepted_at FROM invitations WHERE id=?').get(oldId).accepted_at,null);
 assert.equal(workspaceSeatCount(s.db,owner.workspace.id,expired.body.expiresAt),2);
 assert.equal(s.db.prepare('SELECT count(*) n FROM workspace_members WHERE workspace_id=?').get(owner.workspace.id).n,1);
 const again=await overlap([
  server=>call(server,'/invitations/'+oldId,{method:'DELETE',cookie:owner.cookie}),
  server=>call(server,'/invitations',{method:'POST',cookie:owner.cookie,body:{email:'must-not-fit@example.test',memberType:'guest',projectId,projectRole:'viewer'}}),
 ]);
 assert.deepEqual(again.map(result=>result.status),[200,409]);
 assert.equal(workspaceSeatCount(s.db,owner.workspace.id,expired.body.expiresAt),2);
 assert.equal(s.db.prepare('SELECT count(*) n FROM invitations WHERE workspace_id=?').get(owner.workspace.id).n,1);
 assert.equal(s.db.prepare("SELECT email FROM invitations WHERE workspace_id=?").get(owner.workspace.id).email,'replacement@example.test');
 assert.deepEqual(businessSideEffects(s.db),before);
});

test('TC-W1-T05-E independent checkout/settlement versus invitation observes committed seat capacity without a paid-event receipt on rejection',async t=>{
 const secret='SIMULATED_SEAT_BILLING_SECRET',payments=new Map();
 const provider=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const input=JSON.parse(Buffer.concat(chunks).toString());
  const payment={id:'seat_payment_'+payments.size,externalId:input.externalId,totalAmount:input.totalAmount,currency:'VND',status:'open',amountPaid:0,hostedUrl:'/pay/fixture'};
  payments.set(payment.id,payment);res.setHeader('content-type','application/json');res.end(JSON.stringify({success:true,data:payment}));
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
 const env={NODE_ENV:'test',BILLGATE_API_URL:'http://127.0.0.1:'+provider.address().port,BILLGATE_API_KEY:'SIMULATED',BILLGATE_WEBHOOK_SECRET:secret};
 const {s,owner,api}=await fixture(t,{env});
 const plans=(await api('/billing')).body.plans.map(plan=>({...plan,memberLimit:plan.id==='business'?3:plan.id==='starter'?2:plan.memberLimit}));
 s.db.prepare("INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES('plans',?,0,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(plans),clock().toISOString());
 assert.equal((await api('/invitations','POST',{email:'occupied-reservation@example.test'})).status,201);
 const overlap=await seatRace(t,s,owner,{env}),before=businessSideEffects(s.db);
 const checkoutBody={plan:'starter',cycle:'monthly'};
 const [checkout,invited]=await overlap([
  server=>call(server,'/billing/checkout',{method:'POST',cookie:owner.cookie,body:checkoutBody}),
  server=>call(server,'/invitations',{method:'POST',cookie:owner.cookie,body:{email:'checkout-racer@example.test'}}),
 ]);
 assert.equal(invited.status,201);assert.ok([201,409].includes(checkout.status),JSON.stringify(checkout));
 assert.equal(payments.size,checkout.status===201?1:0);
 assert.equal(s.db.prepare('SELECT count(*) n FROM billing_orders').get().n,payments.size);
 assert.equal(s.db.prepare('SELECT plan FROM subscriptions WHERE workspace_id=?').get(owner.workspace.id).plan,'business');
 assert.equal(workspaceSeatCount(s.db,owner.workspace.id,clock().toISOString()),3);
 const temporary=s.db.prepare("SELECT id FROM invitations WHERE email='checkout-racer@example.test'").get();
 assert.equal((await api('/invitations/'+temporary.id,'DELETE')).status,200);
 const order=checkout.status===201?checkout:await api('/billing/checkout','POST',checkoutBody);assert.equal(order.status,201);
 const payment=payments.get(order.body.providerPaymentId);payment.status='paid';payment.amountPaid=payment.totalAmount;
 const raw=JSON.stringify({id:'seat-race-paid-event',event:'payment.paid',data:{payment}});
 const settle=async server=>{
  const response=await fetch(server.base+'/api/billing/webhook',{method:'POST',headers:{'content-type':'application/json','x-billgate-signature':createHmac('sha256',secret).update(raw).digest('hex')},body:raw});
  return {status:response.status,body:await response.json()};
 };
 const [paid,extra]=await overlap([
  settle,
  server=>call(server,'/invitations',{method:'POST',cookie:owner.cookie,body:{email:'settlement-racer@example.test'}}),
 ]);
 assert.ok(paid.status===200&&extra.status===409||paid.status===409&&extra.status===201,JSON.stringify([paid,extra]));
 const current=s.db.prepare('SELECT plan FROM subscriptions WHERE workspace_id=?').get(owner.workspace.id).plan;
 assert.equal(workspaceSeatCount(s.db,owner.workspace.id,clock().toISOString()),current==='starter'?2:3);
 assert.equal(s.db.prepare("SELECT count(*) n FROM billing_webhook_events WHERE event_id='seat-race-paid-event'").get().n,paid.status===200?1:0);
 assert.equal(s.db.prepare('SELECT status FROM billing_orders WHERE id=?').get(order.body.orderId).status,paid.status===200?'paid':'pending');
 if(paid.status===409){
  const reserved=s.db.prepare("SELECT id FROM invitations WHERE email='settlement-racer@example.test'").get();
  assert.equal((await api('/invitations/'+reserved.id,'DELETE')).status,200);
  assert.equal((await settle(s)).status,200);
 }
 const end=s.db.prepare('SELECT current_period_end FROM subscriptions WHERE workspace_id=?').get(owner.workspace.id).current_period_end;
 assert.equal((await settle(s)).body.duplicate,true);
 assert.equal(s.db.prepare('SELECT current_period_end FROM subscriptions WHERE workspace_id=?').get(owner.workspace.id).current_period_end,end);
 assert.equal(workspaceSeatCount(s.db,owner.workspace.id,clock().toISOString()),2);
 assert.deepEqual(businessSideEffects(s.db),before);
});
