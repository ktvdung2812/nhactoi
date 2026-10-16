import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,call,user,addMember} from './roadmap-helpers.mjs';
import {withTransaction} from '../server/db.mjs';
import {lockWorkspaceSeats,workspaceSeatCount} from '../server/workspace-seats.mjs';

test('TC-X10 Business downgrade with private guest, queued OA, webhook and automation preserves data and stops premium effects',async t=>{
 const now='2026-10-16T03:00:00.000Z',oaSends=[],webhookSends=[];
 const s=await boot(t,{clock:()=>new Date(now),webhookLookup:async()=>[{address:'8.8.8.8',family:4}],webhookTransport:async(endpoint,body)=>{webhookSends.push(JSON.parse(body));return {status:204};},zaloOaTransport:{
  mode:'simulation',authorize:async body=>({oaId:body.oaId,apiVersion:'SIMULATED',policyVersion:'SIMULATED'}),
  templates:async()=>[{id:'internal',version:'v1',status:'approved',purpose:'internal',parameters:['content'],label:'Thông báo nội bộ'}],
  recipient:async()=>({purposes:['internal'],evidenceId:'SIMULATED_PROOF',expiresAt:'2030-01-01T00:00:00Z'}),validateDelivery:async()=>{},
  send:async(credentials,payload,{requestId})=>{oaSends.push({requestId,payload});return {status:'accepted',messageId:'simulated_'+requestId};}
 }});
 const owner=await user(s,'cross-owner@example.test'),guest=await user(s,'cross-guest@example.test'),outsider=await user(s,'cross-outsider@example.test');
 addMember(s,owner,guest);
 s.db.prepare("UPDATE workspace_members SET member_type='guest' WHERE workspace_id=? AND user_id=?").run(owner.workspace.id,guest.user.id);
 s.db.prepare("UPDATE subscriptions SET plan='business',status='active',current_period_end='2035-01-01T00:00:00Z' WHERE workspace_id=?").run(owner.workspace.id);
 const api=(path,method='GET',body,actor=owner)=>call(s,path,{method,body,cookie:actor.cookie});
 const ok=async(path,method,body,status=200,actor=owner)=>{const result=await api(path,method,body,actor);assert.equal(result.status,status,path+' '+JSON.stringify(result.body));return result.body;};
 const project=(await ok('/projects','POST',{name:'X10 private',accessMode:'private'},201)).project;
 await ok(`/projects/${project.id}/members/${guest.user.id}`,'PUT',{role:'editor'});
 const rule=await ok('/automations','POST',{name:'X10 pending rule',projectId:project.id,trigger:'task.created',actions:[{type:'comment',value:'X10 automation history'}]},201);
 await ok('/webhooks','POST',{name:'X10 receiver',url:'https://receiver.example/x10',projectIds:[project.id],events:['task.created']},201);
 await ok('/integrations/zalo-oa/connect','POST',{oaId:'X10_OA',token:'TEST_ONLY_TOKEN',consent:true});
 await ok('/integrations/zalo-oa/templates/refresh','POST',{});
 await ok('/integrations/zalo-oa/recipients','POST',{recipient:'SIMULATED_UID',userId:owner.user.id});
 const recipientId=(await ok('/integrations/zalo-oa')).recipients[0].id;
 const create=async title=>(await ok('/tasks','POST',{title,projectId:project.id,assigneeId:owner.user.id,dueAt:'2026-10-20T03:00:00Z'},201)).task;
 const enqueue=async task=>{
  const body={sourceKind:'task',sourceId:task.id,recipientId,templateId:'internal',purpose:'internal',parameters:{content:'Thông báo nội bộ: '+task.title}};
  const preview=await ok('/integrations/zalo-oa/preview','POST',body);
  return (await ok('/integrations/zalo-oa/deliveries','POST',{...body,previewHash:preview.previewHash},201)).delivery;
 };
 const previous=await create('CANARY_X10_PRIOR'),sent=await enqueue(previous);
 s.app.locals.processAutomations();await s.app.locals.processWebhooks();await s.app.locals.processZaloOa();
 assert.equal(oaSends.length,1);assert.equal(webhookSends.length,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments WHERE task_id=?').get(previous.id).n,1);
 assert.equal(s.db.prepare('SELECT status FROM zalo_oa_deliveries WHERE id=?').get(sent.id).status,'accepted');
 const pending=await create('CANARY_X10_PENDING'),queued=await enqueue(pending);
 assert.equal(s.db.prepare('SELECT count(*) n FROM automation_event_queue WHERE task_id=? AND processed_at IS NULL').get(pending.id).n,1);
 assert.equal(s.db.prepare("SELECT count(*) n FROM webhook_deliveries WHERE state='pending'").get().n,1);
 await ok(`/tasks/${pending.id}`,'PATCH',{description:'Guest can edit before downgrade'},200,guest);
 const before={task:s.db.prepare('SELECT * FROM tasks WHERE id=?').get(pending.id),events:s.db.prepare('SELECT count(*) n FROM business_events').get().n,receipts:s.db.prepare('SELECT count(*) n FROM mutation_receipts').get().n,seats:workspaceSeatCount(s.db,owner.workspace.id,now)};
 assert.equal(before.seats,2);
 // Model the committed plan transition. Payment checkout has its own suite;
 // this case starts at the boundary shared by every queued consumer.
 withTransaction(s.db,()=>{lockWorkspaceSeats(s.db,owner.workspace.id);s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(owner.workspace.id);});
 for(let tick=0;tick<2;tick++){s.app.locals.processAutomations();await s.app.locals.processWebhooks();await s.app.locals.processZaloOa();}
 assert.equal(oaSends.length,1);assert.equal(webhookSends.length,1);
 assert.equal(s.db.prepare('SELECT status FROM zalo_oa_deliveries WHERE id=?').get(queued.id).status,'suppressed');
 assert.equal(s.db.prepare("SELECT count(*) n FROM webhook_deliveries WHERE state='suppressed'").get().n,1);
 assert.equal(s.db.prepare("SELECT count(*) n FROM automation_runs WHERE rule_id=? AND task_id=? AND status='failed'").get(rule.id,pending.id).n,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments WHERE task_id=?').get(pending.id).n,0);
 const rejected=await api(`/tasks/${pending.id}`,'PATCH',{title:'Must not overwrite',operationId:'x10-guest-write',expectedRevision:String(before.task.aggregate_revision)},guest);
 assert.equal(rejected.status,409,JSON.stringify(rejected.body));assert.match(rejected.body.error,/không có quyền/);
 assert.equal((await api('/automations','POST',{name:'No advanced write',projectId:project.id,trigger:'task.created',actions:[{type:'comment',value:'No'}]})).status,403);
 assert.equal((await api('/webhooks','POST',{name:'No hook',url:'https://receiver.example/new',projectIds:[project.id],events:['task.created']})).status,403);
 assert.equal((await api('/integrations/zalo-oa/process','POST',{})).status,403);
 assert.deepEqual(s.db.prepare('SELECT * FROM tasks WHERE id=?').get(pending.id),before.task);
 assert.equal(s.db.prepare('SELECT count(*) n FROM business_events').get().n,before.events);
 assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts').get().n,before.receipts);
 assert.equal(workspaceSeatCount(s.db,owner.workspace.id,now),before.seats);
 assert.equal(s.db.prepare('SELECT access_mode FROM projects WHERE id=?').get(project.id).access_mode,'private');
 assert.equal((await api(`/tasks/${pending.id}`,'GET',undefined,guest)).status,200);
 assert.equal((await api(`/tasks/${pending.id}`,'GET',undefined,outsider)).status,404);
 assert.ok(!JSON.stringify((await api('/tasks','GET',undefined,outsider)).body).includes('CANARY_X10'));
 assert.equal(s.db.prepare('SELECT status FROM zalo_oa_deliveries WHERE id=?').get(sent.id).status,'accepted');
 assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments WHERE task_id=?').get(previous.id).n,1);
 assert.equal(s.db.prepare("SELECT count(*) n FROM automation_runs WHERE rule_id=? AND status='success'").get(rule.id).n,1);
 assert.equal((await ok('/integrations/zalo-oa')).deliveries.length,2);
});
