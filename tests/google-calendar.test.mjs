import test from 'node:test';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import assert from 'node:assert/strict';
import { boot,user,call } from './roadmap-helpers.mjs';
import { googleEventValue } from '../server/google-calendar.mjs';
import { CALENDAR_SCOPE } from '../server/google-calendar-transport.mjs';
import {emptyOfflineState,enqueue,claimNext,rejectOperation,resolveOperation,acknowledge} from '../mobile/src/core/offline-state.ts';
import {openDatabase} from './database-helpers.mjs';
import {createBackup} from '../server/backups.mjs';
import {restoreBackup} from '../scripts/restore-backup.mjs';
import {outboundSendersPaused} from '../server/restore-safety.mjs';

function fakeProvider() {
  const calendars=new Map(),requests=[],watches=[];let next=0,version=0;
  const p={requests,watches,calendars,timeoutCreate:false,failSecondPage:false,full410:false,
    authUrl:({state})=>`https://accounts.google.com/o/oauth2/v2/auth?state=${state}&scope=${encodeURIComponent(CALENDAR_SCOPE)}`,
    exchange:async()=>({accountId:'google-test-sub',tokens:{access_token:'FAKE_ACCESS_CANARY',refresh_token:'FAKE_REFRESH_CANARY',scope:CALENDAR_SCOPE}}),
    createCalendar:async()=>{const id='calendar_'+(++next);calendars.set(id,new Map());return {id};},
    getEvent:async(t,c,id)=>{requests.push(['get',c,id]);const e=calendars.get(c)?.get(id);if(!e)throw {status:404};return structuredClone(e);},
    createEvent:async(t,c,e)=>{requests.push(['create',c,e.id]);if(calendars.get(c).has(e.id))throw {status:409};const event={...structuredClone(e),etag:'"'+(++version)+'"'};calendars.get(c).set(e.id,event);if(p.timeoutCreate){p.timeoutCreate=false;throw {status:0};}return structuredClone(event);},
    patchEvent:async(t,c,id,e,etag)=>{requests.push(['patch',c,id]);if(calendars.get(c).get(id)?.etag!==etag)throw {status:412};const event={...structuredClone(e),etag:'"'+(++version)+'"'};calendars.get(c).set(id,event);return structuredClone(event);},
    deleteEvent:async(t,c,id)=>{requests.push(['delete',c,id]);calendars.get(c).delete(id);},
    listEvents:async(t,c,{syncToken,pageToken})=>{requests.push(['list',c,syncToken,pageToken]);if(p.full410){p.full410=false;throw {status:410};}if(p.failSecondPage){if(pageToken)throw {status:500};return {items:[...calendars.get(c).values()].slice(0,1),nextPageToken:'page2'};}return {items:[...calendars.get(c).values()].map(e=>structuredClone(e)),nextSyncToken:'sync_'+version};},
    watch:async(t,c,channel)=>{watches.push(channel);return {id:channel.id,resourceId:'resource_'+c,expiration:String(Date.parse('2030-01-01T00:00:00Z'))};},
    stopWatch:async()=>{},revoke:async()=>{},
    change(c,id,patch){const event={...calendars.get(c).get(id),...patch,etag:'"'+(++version)+'"'};calendars.get(c).set(id,event);return event;},
  };return p;
}
async function fixture(t,options={}) {
  let at=new Date('2026-10-16T03:00:00Z');const provider=fakeProvider();
  const s=await boot(t,{clock:()=>at,googleCalendarTransport:provider,...options}),owner=await user(s,'calendar-owner@example.test');
  s.db.prepare("UPDATE subscriptions SET current_period_end='2035-01-01T00:00:00Z' WHERE workspace_id=?").run(owner.workspace.id);
  s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(owner.user.id);
  const api=(path,method='GET',body,actor=owner)=>call(s,path,{method,body,cookie:actor.cookie});
  assert.equal((await api('/admin/google-calendar','PUT',{enabled:true,clientId:'fake-client',clientSecret:'FAKE_CLIENT_SECRET',reason:'Configure fake provider for isolated tests'})).status,200);
  async function connect(actor=owner) {
    const start=await api('/integrations/google-calendar/start','POST',{},actor);assert.equal(start.status,200,JSON.stringify(start.body));
    const url=new URL(start.body.url);const state=url.searchParams.get('state');
    const r=await fetch(s.base+`/api/integrations/google-calendar/callback?state=${state}&code=fake`,{headers:{cookie:actor.cookie},redirect:'manual'});
    assert.equal(r.status,302,await r.text());return state;
  }
  await connect();
  const c=s.db.prepare('SELECT * FROM google_calendar_connections WHERE workspace_id=?').get(owner.workspace.id);
  const task=await api('/tasks','POST',{title:'Calendar task',dueAt:'2026-10-18T02:00:00Z',assigneeId:owner.user.id});assert.equal(task.status,201,JSON.stringify(task.body));
  const sync=()=>api('/integrations/google-calendar/sync','POST',{});
  return {s,api,owner,c,task:task.body.task,provider,connect,sync,advance:ms=>{at=new Date(+at+ms);}};
}

test('TC-W7-T01 consent is separate, one-use scope-bound state, encrypted tokens and login independent',async t=>{
  const {s,api,owner,c,connect}=await fixture(t);const state=await connect();
  const replay=await api(`/integrations/google-calendar/callback?state=${state}&code=fake`);assert.equal(replay.status,400);
  const publicState=await api('/integrations/google-calendar');assert.ok(!JSON.stringify(publicState).includes('FAKE_'));
  const stored=s.db.prepare('SELECT value,encrypted FROM app_settings WHERE key=?').get('googleCalendarTokens:'+c.id);
  assert.equal(stored.encrypted,1);assert.ok(!stored.value.includes('FAKE_ACCESS'));
  assert.equal((await api('/auth/google/config')).body.linked,false);
  const outsider=await user(s,'calendar-other@example.test');
  const start=await api('/integrations/google-calendar/start','POST',{});const otherState=new URL(start.body.url).searchParams.get('state');
  assert.equal((await api(`/integrations/google-calendar/callback?state=${otherState}&code=fake`,'GET',undefined,outsider)).status,400);
  assert.equal(s.db.prepare('SELECT count(*) n FROM google_calendar_connections WHERE workspace_id=?').get(outsider.workspace.id).n,0);
});

test('TC-W7-T02 deadline projections have stable IDs, no RRULE/reminders and reconcile accepted creates after timeout',async t=>{
  const {s,api,c,task,provider,sync,advance}=await fixture(t);provider.timeoutCreate=true;
  await api(`/tasks/${task.id}`,'PATCH',{recurrence:'daily'});
  assert.equal((await sync()).body.ok,false);
  const mapping=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline'").get(c.id);
  assert.equal(mapping.state,'unknown');assert.equal(provider.calendars.get(c.calendar_id).size,1);
  advance(60000);await sync();
  const e=provider.calendars.get(c.calendar_id).get(mapping.event_id);
  assert.equal(e.transparency,'transparent');assert.equal(e.reminders.useDefault,false);assert.equal(e.recurrence,undefined);
  assert.equal(Date.parse(e.end.dateTime)-Date.parse(e.start.dateTime),15*60000);
  assert.equal(provider.requests.filter(r=>r[0]==='create').length,1);
  assert.equal(s.db.prepare('SELECT state FROM google_calendar_mappings WHERE id=?').get(mapping.id).state,'synced');
});

test('TC-W7-T03 deadline edits use revision/events; concurrent edits conflict; suppression survives 410 full sync',async t=>{
  const {s,api,c,task,provider,sync}=await fixture(t);await sync();
  const m=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline'").get(c.id);
  provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-19T03:00:00+07:00'},end:{dateTime:'2026-10-19T03:15:00+07:00'}});await sync();
  assert.equal(s.db.prepare('SELECT due_at FROM tasks WHERE id=?').get(task.id).due_at,'2026-10-18T20:00:00.000Z');
  assert.ok(s.db.prepare("SELECT 1 FROM business_events WHERE task_id=? AND source='google_calendar'").get(task.id));
  await api(`/tasks/${task.id}`,'PATCH',{dueAt:'2026-10-21T03:00:00Z'});
  provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-22T03:00:00Z'},end:{dateTime:'2026-10-22T03:15:00Z'}});await sync();
  assert.equal(s.db.prepare('SELECT state FROM google_calendar_mappings WHERE id=?').get(m.id).state,'conflict');
  assert.equal(s.db.prepare('SELECT due_at FROM tasks WHERE id=?').get(task.id).due_at,'2026-10-21T03:00:00.000Z');
  const conflict=(await api('/integrations/google-calendar')).body.mappings.find(x=>x.id===m.id).conflict;
  assert.equal((await api(`/integrations/google-calendar/mappings/${m.id}/resolve`,'POST',{choice:'google',expectedRevision:conflict.revision,expectedEtag:conflict.event.etag})).status,200);
  await sync();provider.change(c.calendar_id,m.event_id,{status:'cancelled'});await sync();
  assert.equal(s.db.prepare('SELECT state FROM google_calendar_mappings WHERE id=?').get(m.id).state,'suppressed');
  provider.full410=true;await sync();
  assert.equal(s.db.prepare('SELECT state FROM google_calendar_mappings WHERE id=?').get(m.id).state,'suppressed');
  assert.equal(s.db.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(task.id).deleted_at,null);
});

test('TC-W7-T03-E/D and T04-D paging faults preserve sync token, callbacks authenticate and all-day deadline conflicts',async t=>{
  const {s,api,c,provider,sync}=await fixture(t);await sync();
  const before=s.db.prepare('SELECT * FROM google_calendar_connections WHERE id=?').get(c.id);
  provider.failSecondPage=true;assert.equal((await sync()).body.ok,false);
  assert.equal(s.db.prepare('SELECT sync_token FROM google_calendar_connections WHERE id=?').get(c.id).sync_token,before.sync_token);
  provider.failSecondPage=false;
  const channel=provider.watches[0];
  const send=(sequence,token=channel.token)=>fetch(s.base+'/api/integrations/google-calendar/watch',{method:'POST',headers:{'x-goog-channel-id':channel.id,'x-goog-channel-token':token,'x-goog-resource-id':'resource_'+c.calendar_id,'x-goog-message-number':sequence}});
  assert.equal((await send('2','fake')).status,403);assert.equal((await send('2')).status,204);
  const requested=s.db.prepare('SELECT sync_requested FROM google_calendar_connections WHERE id=?').get(c.id).sync_requested;
  assert.equal((await send('2')).status,204);assert.equal((await send('1')).status,204);
  assert.equal(s.db.prepare('SELECT sync_requested FROM google_calendar_connections WHERE id=?').get(c.id).sync_requested,requested);
  const m=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline'").get(c.id);
  provider.change(c.calendar_id,m.event_id,{start:{date:'2026-10-20'},end:{date:'2026-10-21'}});await sync();
  assert.equal(s.db.prepare('SELECT state FROM google_calendar_mappings WHERE id=?').get(m.id).state,'conflict');
});

test('TC-W7-T03-A/T04-A personal sync touches only owner plan; task stays; unknown events are never imported',async t=>{
  const {s,api,owner,c,task,provider,sync}=await fixture(t);
  await api(`/tasks/${task.id}/plan`,'PATCH',{plannedDate:'2026-10-17',plannedTime:'10:00',plannedDuration:60});await sync();
  const m=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='personal'").get(c.id);
  provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-17T11:00:00+07:00'},end:{dateTime:'2026-10-17T12:30:00+07:00'}});await sync();
  assert.equal(s.db.prepare('SELECT duration_minutes FROM personal_task_plans WHERE task_id=? AND user_id=?').get(task.id,owner.user.id).duration_minutes,90);
  assert.equal(s.db.prepare('SELECT due_at FROM tasks WHERE id=?').get(task.id).due_at,'2026-10-18T02:00:00.000Z');
  provider.change(c.calendar_id,m.event_id,{status:'cancelled'});provider.calendars.get(c.calendar_id).set('unmapped',{id:'unmapped',etag:'unmapped',summary:'Do not import'});await sync();
  assert.equal(s.db.prepare('SELECT count(*) n FROM personal_task_plans WHERE task_id=?').get(task.id).n,0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n,1);
});

test('TC-W7-T04-E restore hold and lost membership prevent sends and disconnect preserves Google login',async t=>{
  const {s,api,owner,c,task,provider,sync}=await fixture(t);await sync();const count=provider.requests.length;
  s.db.prepare("INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES('restoreSenderHold','{}',0,?)").run(new Date().toISOString());
  await api(`/tasks/${task.id}`,'PATCH',{dueAt:'2026-10-20T03:00:00Z'});assert.equal((await sync()).body.skipped,true);assert.equal(provider.requests.length,count);
  s.db.prepare("DELETE FROM app_settings WHERE key='restoreSenderHold'").run();
  assert.equal((await api('/integrations/google-calendar','DELETE')).body.eventsDeleted,false);
  assert.equal(s.db.prepare('SELECT status FROM google_calendar_connections WHERE id=?').get(c.id).status,'disconnected');
  assert.equal(s.db.prepare('SELECT count(*) n FROM app_settings WHERE key=?').get('googleCalendarTokens:'+c.id).n,0);
  assert.equal((await api('/auth/google/config')).status,200);
});

test('TC-W7-T05-B simulated timezone and all-day parsing rejects ambiguous ranges',()=>{
  assert.deepEqual(googleEventValue('personal',{start:{date:'2028-02-29'},end:{date:'2028-03-01'}}),{plannedDate:'2028-02-29',plannedTime:null,plannedDuration:60});
  assert.throws(()=>googleEventValue('personal',{start:{date:'2026-02-29'},end:{date:'2026-03-01'}}));
  assert.throws(()=>googleEventValue('deadline',{start:{date:'2026-10-16'},end:{date:'2026-10-17'}}));
  assert.equal(googleEventValue('deadline',{start:{dateTime:'2026-11-01T01:30:00-04:00'},end:{dateTime:'2026-11-01T01:45:00-04:00'}}).dueAt,'2026-11-01T05:30:00.000Z');
});

test('TC-W7-T02-C/T03-C appointment fields round-trip and renewal projection never renews or writes finance',async t=>{
  const {s,api,c,provider,sync}=await fixture(t);
  await api('/integrations/google-calendar','PATCH',{enabledKinds:['personal','deadline','appointment','renewal']});
  const appointment=await api('/calendar-events','POST',{title:'Appointment',description:'Safe meeting notes',startsAt:'2026-10-20T03:00:00Z',endsAt:'2026-10-20T04:00:00Z'});
  assert.equal(appointment.status,201,JSON.stringify(appointment.body));
  const service=await api('/services','POST',{name:'License renewal',nextDate:'2026-10-31',cycle:'month',amount:123456,note:'PRIVATE_FINANCE_CANARY',accountHint:'PRIVATE_CREDENTIAL_CANARY',syncCalendar:true});
  assert.equal(service.status,201,JSON.stringify(service.body));await sync();
  const maps=s.db.prepare('SELECT * FROM google_calendar_mappings WHERE connection_id=?').all(c.id),a=maps.find(m=>m.kind==='appointment'),r=maps.find(m=>m.kind==='renewal');
  assert.ok(a&&r);const renewal=provider.calendars.get(c.calendar_id).get(r.event_id);
  assert.ok(renewal);assert.ok(!JSON.stringify(renewal).includes('PRIVATE_'));assert.ok(!JSON.stringify(renewal).includes('123456'));
  provider.change(c.calendar_id,a.event_id,{summary:'Edited appointment',description:'Allowed change',start:{dateTime:'2026-10-20T06:00:00Z'},end:{dateTime:'2026-10-20T07:00:00Z'}});
  provider.change(c.calendar_id,r.event_id,{start:{date:'2027-02-01'},end:{date:'2027-02-02'}});await sync();
  assert.equal(s.db.prepare('SELECT title FROM calendar_events WHERE id=?').get(appointment.body.id).title,'Edited appointment');
  assert.equal(s.db.prepare('SELECT next_date FROM service_contracts WHERE id=?').get(service.body.service.id).next_date,'2026-10-31');
  assert.equal(s.db.prepare('SELECT count(*) n FROM service_renewals').get().n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM transactions').get().n,0);
});

test('TC-W7-T03-G/T04-E worker rechecks rights after network and receipt failure rolls back inbound deadline',async t=>{
  const {s,api,owner,c,task,provider,sync}=await fixture(t);await sync();
  const m=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline'").get(c.id);
  const before=s.db.prepare('SELECT due_at,aggregate_revision FROM tasks WHERE id=?').get(task.id),events=s.db.prepare('SELECT count(*) n FROM business_events').get().n;
  s.db.exec(`CREATE FUNCTION fail_google_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action LIKE 'google_calendar.%' THEN RAISE EXCEPTION 'injected receipt fault'; END IF; RETURN NEW; END$$;
    CREATE TRIGGER fail_google_receipt BEFORE INSERT ON mutation_receipts FOR EACH ROW EXECUTE FUNCTION fail_google_receipt()`);
  provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-23T03:00:00Z'},end:{dateTime:'2026-10-23T03:15:00Z'}});await sync();
  assert.deepEqual(s.db.prepare('SELECT due_at,aggregate_revision FROM tasks WHERE id=?').get(task.id),before);
  assert.equal(s.db.prepare('SELECT count(*) n FROM business_events').get().n,events);
  assert.equal(s.db.prepare("SELECT count(*) n FROM mutation_receipts WHERE action LIKE 'google_calendar.%'").get().n,0);
  s.db.exec('DROP TRIGGER fail_google_receipt ON mutation_receipts');
  const previousList=provider.listEvents;provider.listEvents=async(...args)=>{const page=await previousList(...args);s.db.prepare("UPDATE subscriptions SET status='expired' WHERE workspace_id=?").run(owner.workspace.id);return page;};
  const requests=provider.requests.filter(x=>['create','patch','delete'].includes(x[0])).length;
  await sync();assert.deepEqual(s.db.prepare('SELECT due_at,aggregate_revision FROM tasks WHERE id=?').get(task.id),before);
  assert.equal(provider.requests.filter(x=>['create','patch','delete'].includes(x[0])).length,requests);
});

test('TC-W7-T03 lease suppresses competing sync calls while provider request is in flight',async t=>{
  const {api,provider,sync}=await fixture(t);let release,entered;
  const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  const original=provider.listEvents;let intercepted=false;
  provider.listEvents=async(...args)=>{if(!intercepted){intercepted=true;entered();await gate;}return original(...args);};
  const first=sync();await started;
  assert.equal((await api('/integrations/google-calendar/sync','POST',{})).body.skipped,true);
  release();assert.equal((await first).status,200);
  assert.equal(provider.requests.filter(r=>r[0]==='create').length,1);
});

test('TC-W7-T04 local conflict resolution actually patches Google and does not just advance base metadata',async t=>{
 const {s,api,c,task,provider,sync}=await fixture(t);await sync();
 const m=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline'").get(c.id);
 await api(`/tasks/${task.id}`,'PATCH',{dueAt:'2026-10-25T03:00:00Z'});provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-26T03:00:00Z'},end:{dateTime:'2026-10-26T03:15:00Z'}});await sync();
 const conflict=(await api('/integrations/google-calendar')).body.mappings.find(x=>x.id===m.id).conflict;
 assert.equal((await api(`/integrations/google-calendar/mappings/${m.id}/resolve`,'POST',{choice:'local',expectedRevision:conflict.revision,expectedEtag:conflict.event.etag})).status,200);
 await sync();assert.equal(provider.calendars.get(c.calendar_id).get(m.event_id).start.dateTime,'2026-10-25T03:00:00.000Z');
 assert.equal(s.db.prepare('SELECT state FROM google_calendar_mappings WHERE id=?').get(m.id).state,'synced');
});

test('TC-W7-T04 relinking a cancelled event persists a new stable ID and ignores the old tombstone',async t=>{
 const {s,api,c,provider,sync}=await fixture(t);await sync();
 const old=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline'").get(c.id);
 provider.change(c.calendar_id,old.event_id,{status:'cancelled'});await sync();
 assert.equal((await api(`/integrations/google-calendar/mappings/${old.id}/resolve`,'POST',{choice:'relink'})).status,200);
 const fresh=s.db.prepare('SELECT * FROM google_calendar_mappings WHERE id=?').get(old.id);assert.notEqual(fresh.event_id,old.event_id);
 provider.timeoutCreate=true;await sync();await sync();
 assert.equal(s.db.prepare('SELECT event_id FROM google_calendar_mappings WHERE id=?').get(old.id).event_id,fresh.event_id);
 assert.equal(provider.calendars.get(c.calendar_id).get(old.event_id).status,'cancelled');
 assert.equal(provider.calendars.get(c.calendar_id).get(fresh.event_id).status,undefined);
 assert.equal(provider.requests.filter(r=>r[0]==='create'&&r[2]===fresh.event_id).length,1);
});

test('TC-W7-T01-D reconnect keeps account binding and concurrent OAuth callbacks create one calendar',async t=>{
 const {s,api,owner,c,provider,connect}=await fixture(t);
 await api('/integrations/google-calendar','DELETE');
 const original=provider.exchange;provider.exchange=async()=>({...await original(),accountId:'different-google-account'});
 const started=await api('/integrations/google-calendar/start','POST',{}),state=new URL(started.body.url).searchParams.get('state');
 assert.equal((await api(`/integrations/google-calendar/callback?state=${state}&code=fake`)).status,409);
 assert.equal(s.db.prepare('SELECT account_id FROM google_calendar_connections WHERE id=?').get(c.id).account_id,c.account_id);
 assert.equal(s.db.prepare('SELECT count(*) n FROM app_settings WHERE key=?').get('googleCalendarTokens:'+c.id).n,0);
 provider.exchange=original;await connect();assert.equal(provider.calendars.size,1);
 const second=await user(s,'second-calendar@example.test');
 const states=await Promise.all([1,2].map(async()=>new URL((await api('/integrations/google-calendar/start','POST',{},second)).body.url).searchParams.get('state')));
 let release,entered;const barrier=new Promise(resolve=>{release=resolve;}),creating=new Promise(resolve=>{entered=resolve;});
 const create=provider.createCalendar;provider.createCalendar=async(...args)=>{entered();await barrier;return create(...args);};
 const first=fetch(s.base+`/api/integrations/google-calendar/callback?state=${states[0]}&code=fake`,{headers:{cookie:second.cookie},redirect:'manual'});
 await creating;
 assert.equal((await api(`/integrations/google-calendar/callback?state=${states[1]}&code=fake`,'GET',undefined,second)).status,409);
 release();assert.equal((await first).status,302);assert.equal(provider.calendars.size,2);
 assert.equal(s.db.prepare('SELECT count(*) n FROM google_calendar_connections WHERE workspace_id=?').get(owner.workspace.id).n,1);
});

test('TC-W7-T03 independent processes serialize lease claims at a PostgreSQL barrier',async t=>{
 const {s,c,owner}=await fixture(t),servers=[],created=[];
 for(const suffix of ['first','second']){
  const applicationName=s.db.schema+'_google_'+suffix,child=fork(new URL('./fixtures/google-calendar-worker.mjs',import.meta.url),[s.db.schema,join(s.dir,'test.sqlite'),applicationName],{silent:true});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);child.on('message',message=>{if(message.created)created.push(message.created);});
  t.after(async()=>{if(child.exitCode!==null)return;const exited=once(child,'exit');child.send('close');const kill=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(kill);});
  const ready=await Promise.race([once(child,'message').then(([r])=>r),once(child,'exit').then(()=>{throw new Error(errors);})]);servers.push({child,applicationName,base:'http://127.0.0.1:'+ready.port});
 }
 const control=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await control.connect();
 try{
  await control.query(`SET search_path TO "${s.db.schema}"`);await control.query('BEGIN');await control.query('SELECT id FROM google_calendar_connections WHERE id=$1 FOR UPDATE',[c.id]);
  const pending=servers.map(server=>call(server,'/integrations/google-calendar/sync',{method:'POST',cookie:owner.cookie,body:{}}));
  try{const deadline=Date.now()+15000;while(true){const waiting=await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'",[servers.map(server=>server.applicationName)]);if(waiting.rows[0].n===2)break;assert.ok(Date.now()<deadline,'both independent Google workers reach connection lock');await delay(20);}}finally{await control.query('COMMIT');}
  assert.equal((await Promise.race(pending)).body.skipped,true);
  servers.forEach(server=>server.child.send('release-provider'));
  const responses=await Promise.all(pending);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(created.length,1);
  assert.equal(s.db.prepare('SELECT lease_token FROM google_calendar_connections WHERE id=?').get(c.id).lease_token,null);
 }finally{await control.end();}
});

test('TC-X09 Google deadline change conflicts with Android offline completion and replay creates one successor',async t=>{
 const {s,api,owner,c,task,provider,sync}=await fixture(t);
 await api(`/tasks/${task.id}`,'PATCH',{recurrence:'daily'});await sync();
 const localTask=(await api(`/tasks/${task.id}/detail`)).body.task,state=emptyOfflineState();
 enqueue(state,{id:'offline-google-complete-0001',path:`/tasks/${task.id}`,method:'PATCH',body:{status:'done',expectedRevision:localTask.revision}});
 const m=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline' AND source_id=?").get(c.id,task.id);
 provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-19T03:00:00Z'},end:{dateTime:'2026-10-19T03:15:00Z'}});await sync();
 const send=op=>api(op.wire.path,op.method,op.wire.body),pending=claimNext(state),conflict=await send(pending);
 assert.equal(conflict.status,409);rejectOperation(state,pending.id,{status:409,message:conflict.body.error,payload:conflict.body});
 assert.equal(state.operations[0].status,'conflict');assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get(pending.id).n,0);
 const current=(await api(`/tasks/${task.id}/detail`)).body.task;
 resolveOperation(state,pending.id,'local','offline-google-resolved-0001',current,current.revision);
 const resolved=claimNext(state),saved=await send(resolved);assert.equal(saved.status,200,JSON.stringify(saved.body));
 assert.deepEqual((await send(resolved)).body,saved.body);acknowledge(state,resolved.id,saved.body);
 assert.equal(state.operations.length,0);assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n,2);
 await sync();const writes=provider.requests.filter(r=>['create','patch','delete'].includes(r[0])).length;
 await sync();assert.equal(provider.requests.filter(r=>['create','patch','delete'].includes(r[0])).length,writes);
 assert.equal(s.db.prepare("SELECT count(*) n FROM business_events WHERE task_id=? AND type='task.completed'").get(task.id).n,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE operation_id=?').get(resolved.id).n,1);
 assert.equal(s.db.prepare("SELECT count(*) n FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline'").get(c.id).n,2);
});

test('TC-X11 schema13 restore preserves encrypted Calendar state, webhook attempts and receipts without sending',async t=>{
 let response=204;const sent=[];
 const options={webhookLookup:async()=>[{address:'8.8.8.8',family:4}],webhookTransport:async(_endpoint,body)=>{sent.push(body.toString());if(response===null)throw new Error('accepted but response lost');return {status:response};}};
 const {s,api,owner,c,provider,sync}=await fixture(t,options);
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
 const hook=await api('/webhooks','POST',{name:'Restore fixture',url:'https://receiver.example/',events:['task.created'],projectIds:[]});assert.equal(hook.status,201);
 const requests=[];
 for(const state of ['accepted','unknown','pending']){
  const body={title:'Restore '+state,dueAt:'2026-10-20T03:00:00Z',assigneeId:owner.user.id,operationId:'restore-mutation-'+state};
  const result=await api('/tasks','POST',body);assert.equal(result.status,201);requests.push({body,result:result.body});
  if(state!=='pending'){response=state==='accepted'?204:null;await s.app.locals.processWebhooks();}
 }
 await sync();await api(`/tasks/${requests[2].result.task.id}`,'PATCH',{dueAt:'2026-10-21T03:00:00Z'});
 const tables=['tasks','projects','project_members','mutation_receipts','business_events','google_calendar_connections','google_calendar_mappings','google_calendar_jobs','webhook_subscriptions','webhook_deliveries','webhook_attempts'];
 const snapshot=db=>Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
 const before=snapshot(s.db),secrets=s.db.prepare('SELECT key,value FROM app_settings WHERE encrypted=1 ORDER BY key').all();
 assert.ok(secrets.length>=3);assert.ok(!JSON.stringify(secrets).includes('FAKE_ACCESS_CANARY'));
 assert.deepEqual(s.db.prepare('SELECT state FROM webhook_deliveries ORDER BY state').all().map(r=>r.state),['delivered','pending','retry']);
 const backup=await createBackup({db:s.db,dbPath:join(s.dir,'storage'),clock:()=>new Date('2026-10-16T03:00:00Z')}),target=openDatabase();
 await restoreBackup({db:target,dataDir:s.dir,backupId:backup.id});assert.equal(outboundSendersPaused(target),true);assert.deepEqual(snapshot(target),before);
 assert.deepEqual(target.prepare('SELECT key,value FROM app_settings WHERE encrypted=1 ORDER BY key').all(),secrets);
 const restored=await boot(t,{...options,db:target,dbPath:join(s.dir,'storage'),clock:()=>new Date('2026-10-16T03:00:00Z'),googleCalendarTransport:provider});
 const sentBefore=sent.length,googleBefore=provider.requests.length;
 await restored.app.locals.processGoogleCalendar();await restored.app.locals.processWebhooks();await restored.app.locals.processZaloOa();
 assert.equal(sent.length,sentBefore);assert.equal(provider.requests.length,googleBefore);assert.deepEqual(snapshot(target),before);
 assert.equal((await call(restored,'/me',{cookie:owner.cookie})).status,401);
 const login=await call(restored,'/auth/login',{method:'POST',body:{email:owner.user.email,password:'Password123!'}});assert.equal(login.status,200);
 const replay=await call(restored,'/tasks',{method:'POST',cookie:login.cookie,body:requests[0].body});assert.equal(replay.status,201);assert.deepEqual(replay.body,requests[0].result);
 assert.deepEqual(snapshot(target),before);assert.equal(target.prepare('SELECT calendar_id FROM google_calendar_connections WHERE id=?').get(c.id).calendar_id,c.calendar_id);
});

test('TC-W7-T04 disabling a projection blocks inbound writes before queued cleanup',async t=>{
 const {s,api,c,task,provider,sync}=await fixture(t);await sync();
 const m=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='deadline'").get(c.id);
 const before={task:s.db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id),events:s.db.prepare('SELECT count(*) n FROM business_events').get().n,receipts:s.db.prepare('SELECT count(*) n FROM mutation_receipts').get().n};
 provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-23T03:00:00Z'},end:{dateTime:'2026-10-23T03:15:00Z'}});
 assert.equal((await api('/integrations/google-calendar','PATCH',{enabledKinds:['personal']})).status,200);
 await sync();
 assert.deepEqual(s.db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id),before.task);
 assert.equal(s.db.prepare('SELECT count(*) n FROM business_events').get().n,before.events);
 assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts').get().n,before.receipts);
 assert.equal(provider.calendars.get(c.calendar_id).has(m.event_id),false);
 assert.equal(s.db.prepare('SELECT state FROM google_calendar_mappings WHERE id=?').get(m.id).state,'removed');
});

test('TC-W7-T01-D/T04-E disconnect cleanup cannot revoke or erase a concurrent reconnect',async t=>{
 const {s,api,c,provider,sync,connect}=await fixture(t);await sync();
 let entered,release;const reached=new Promise(r=>{entered=r;}),barrier=new Promise(r=>{release=r;});
 provider.stopWatch=async()=>{entered();await barrier;};
 const revoked=[];provider.revoke=async credentials=>{revoked.push(credentials.access_token);};
 const pending=api('/integrations/google-calendar','DELETE');await reached;
 try {
  const start=await api('/integrations/google-calendar/start','POST',{});
  assert.equal(start.status,409,'reconnect waits until old provider cleanup completes');
  assert.equal((await api('/integrations/google-calendar','DELETE')).status,409,'concurrent cleanup cannot bypass the connection lease');
 }finally{release();await pending;}
 assert.deepEqual(revoked,['FAKE_ACCESS_CANARY']);
 provider.exchange=async()=>({accountId:c.account_id,tokens:{access_token:'NEW_ACCESS_CANARY',refresh_token:'NEW_REFRESH_CANARY',scope:CALENDAR_SCOPE}});
 await connect();assert.equal(s.db.prepare('SELECT status FROM google_calendar_connections WHERE id=?').get(c.id).status,'active');
 assert.equal(s.db.prepare('SELECT count(*) n FROM app_settings WHERE key=?').get('googleCalendarTokens:'+c.id).n,1);
});

test('TC-W7-T01-B OAuth exchange revalidates the initiating session and enabled configuration',async t=>{
 for(const change of ['logout','configuration'])await t.test(change,async t=>{
  const {s,api,provider}=await fixture(t),actor=await user(s,'oauth-race-'+change+'@example.test');
  const start=await api('/integrations/google-calendar/start','POST',{},actor),state=new URL(start.body.url).searchParams.get('state');
  let entered,release;const reached=new Promise(r=>{entered=r;}),barrier=new Promise(r=>{release=r;});
  const exchange=provider.exchange;provider.exchange=async(...args)=>{entered();await barrier;return exchange(...args);};
  const callback=fetch(s.base+`/api/integrations/google-calendar/callback?state=${state}&code=fake`,{headers:{cookie:actor.cookie},redirect:'manual'});await reached;
  if(change==='logout')assert.equal((await api('/auth/logout','POST',{},actor)).status,200);
  else assert.equal((await api('/admin/google-calendar','PUT',{enabled:false,clientId:'fake-client',reason:'Disable while OAuth exchange is pending'})).status,200);
  release();const result=await callback;assert.equal(result.status,403,await result.text());
  assert.equal(provider.calendars.size,1);assert.equal(s.db.prepare('SELECT count(*) n FROM google_calendar_connections WHERE workspace_id=?').get(actor.workspace.id).n,0);
 });
});

test('TC-W7-T03-C appointment inbound keeps reminder validation and invalidates stale mobile deliveries',async t=>{
 const {s,api,c,provider,sync}=await fixture(t);
 const created=await api('/calendar-events','POST',{title:'Appointment with reminder',startsAt:'2026-10-16T04:00:00Z',endsAt:'2026-10-16T05:00:00Z',remindAt:'2026-10-16T03:00:00Z'});assert.equal(created.status,201,JSON.stringify(created.body));
 await api('/integrations/google-calendar','PATCH',{enabledKinds:['personal','deadline','appointment']});await sync();
 s.app.locals.processEventReminders();
 const m=s.db.prepare("SELECT * FROM google_calendar_mappings WHERE connection_id=? AND kind='appointment' AND source_id=?").get(c.id,created.body.id);
 const before=s.db.prepare('SELECT * FROM calendar_events WHERE id=?').get(created.body.id);
 assert.equal(s.db.prepare("SELECT count(*) n FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.entity_id=? AND o.status='pending'").get(created.body.id).n,1);
 provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-16T02:00:00Z'},end:{dateTime:'2026-10-16T03:30:00Z'}});await sync();
 assert.deepEqual(s.db.prepare('SELECT * FROM calendar_events WHERE id=?').get(created.body.id),before,'cannot retain a reminder after the new appointment start');
 assert.equal(s.db.prepare('SELECT state FROM google_calendar_mappings WHERE id=?').get(m.id).state,'conflict');
 provider.change(c.calendar_id,m.event_id,{start:{dateTime:'2026-10-16T05:00:00Z'},end:{dateTime:'2026-10-16T06:00:00Z'}});await sync();
 assert.equal(s.db.prepare('SELECT starts_at FROM calendar_events WHERE id=?').get(created.body.id).starts_at,'2026-10-16T05:00:00.000Z');
 assert.equal(s.db.prepare("SELECT count(*) n FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.entity_id=? AND o.status='pending'").get(created.body.id).n,0);
});

test('TC-W7-T01-D known calendar creation survives session/config/entitlement revocation without activation or duplicate recovery',async t=>{
 for(const change of ['logout','configuration','entitlement'])await t.test(change,async t=>{
  const {s,api,provider,connect}=await fixture(t),actor=await user(s,'calendar-create-'+change+'@example.test');
  const start=await api('/integrations/google-calendar/start','POST',{},actor),state=new URL(start.body.url).searchParams.get('state');
  let entered,release;const reached=new Promise(r=>{entered=r;}),barrier=new Promise(r=>{release=r;});
  const create=provider.createCalendar;provider.createCalendar=async(...args)=>{entered();await barrier;return create(...args);};
  const callback=fetch(s.base+`/api/integrations/google-calendar/callback?state=${state}&code=fake`,{headers:{cookie:actor.cookie},redirect:'manual'});await reached;
  if(change==='logout')await api('/auth/logout','POST',{},actor);
  else if(change==='configuration')await api('/admin/google-calendar','PUT',{enabled:false,clientId:'fake-client',reason:'Disable pending calendar creation'});
  else s.db.prepare("UPDATE subscriptions SET status='canceled' WHERE workspace_id=?").run(actor.workspace.id);
  release();assert.equal((await callback).status,409);
  const c=s.db.prepare('SELECT * FROM google_calendar_connections WHERE workspace_id=? AND user_id=?').get(actor.workspace.id,actor.user.id);
  assert.equal(c.calendar_id,'calendar_2','known provider resource must remain recoverable');assert.equal(c.status,'disconnected');
  assert.equal(s.db.prepare('SELECT count(*) n FROM google_calendar_jobs WHERE connection_id=?').get(c.id).n,0);
  if(change==='logout'){const login=await api('/auth/login','POST',{email:actor.user.email,password:'Password123!'},actor);actor.cookie=login.cookie;}
  else if(change==='configuration')await api('/admin/google-calendar','PUT',{enabled:true,clientId:'fake-client',reason:'Restore configuration after isolated test'});
  else s.db.prepare("UPDATE subscriptions SET status='active' WHERE workspace_id=?").run(actor.workspace.id);
  await connect(actor);assert.equal(provider.calendars.size,2,'reconnect reuses the already created calendar');
 });
});

test('TC-W7-T01-D disconnect while calendar creation is pending preserves the new generation and eventual resource identity',async t=>{
 for(const outcome of ['success','unknown'])await t.test(outcome,async t=>{
  const {s,api,provider,connect}=await fixture(t),actor=await user(s,'calendar-disconnect-'+outcome+'@example.test');
  const state=new URL((await api('/integrations/google-calendar/start','POST',{},actor)).body.url).searchParams.get('state');
  let entered,release;const reached=new Promise(r=>{entered=r;}),barrier=new Promise(r=>{release=r;});
  const create=provider.createCalendar;provider.createCalendar=async(...args)=>{entered();await barrier;if(outcome==='unknown')throw {status:0};return create(...args);};
  const callback=fetch(s.base+`/api/integrations/google-calendar/callback?state=${state}&code=fake`,{headers:{cookie:actor.cookie},redirect:'manual'});await reached;
  try{
   assert.equal((await api('/integrations/google-calendar','DELETE',undefined,actor)).status,200);
   assert.equal((await api('/integrations/google-calendar/start','POST',{},actor)).status,409,'do not create another calendar before the first outcome is known');
  }finally{release();}
  const before=s.db.prepare('SELECT * FROM google_calendar_connections WHERE workspace_id=?').get(actor.workspace.id);
  assert.equal((await callback).status,outcome==='success'?409:502);
  const after=s.db.prepare('SELECT * FROM google_calendar_connections WHERE id=?').get(before.id);
  assert.equal(after.generation,before.generation);
  if(outcome==='success'){
   assert.equal(after.calendar_id,'calendar_2');assert.equal(after.status,'disconnected');
   assert.equal(s.db.prepare('SELECT count(*) n FROM app_settings WHERE key=?').get('googleCalendarTokens:'+after.id).n,0);
   provider.createCalendar=create;await connect(actor);assert.equal(provider.calendars.size,2);
  }else{assert.deepEqual(after,before,'late unknown result cannot overwrite the newer disconnect generation');assert.equal(after.status,'needs_review');}
 });
});
