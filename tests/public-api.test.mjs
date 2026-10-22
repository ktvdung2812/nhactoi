import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boot,user,call,addMember} from './roadmap-helpers.mjs';
import {resolveWebhookDestination,isPublicWebhookAddress,verifyWebhook,signWebhook} from '../server/webhook-transport.mjs';
async function fixture(t){
 let at=new Date('2026-10-16T03:00:00Z'),response={status:204};const requests=[];
 const s=await boot(t,{clock:()=>at,webhookLookup:async()=>[{address:'8.8.8.8',family:4}],webhookTransport:async(endpoint,body,headers)=>{requests.push({url:endpoint.url.href,body,headers});if(response instanceof Error)throw response;return response;}});
 const owner=await user(s,'api-owner@example.test');s.db.prepare("UPDATE subscriptions SET plan='business',current_period_end='2035-01-01T00:00:00Z' WHERE workspace_id=?").run(owner.workspace.id);
 const api=(path,method='GET',body,actor=owner)=>call(s,path,{method,body,cookie:actor.cookie});
 const project=(await api('/projects','POST',{name:'Private API',accessMode:'private'})).body.project;
 assert.ok(project?.id);
 const issued=await api('/api-tokens','POST',{name:'Test token',scopes:['projects:read','tasks:read','tasks:write'],projectIds:[project.id]});assert.equal(issued.status,201,JSON.stringify(issued.body));
 const raw=issued.body.rawToken;
 async function v1(path,method='GET',body,token=raw,headers={}){const r=await fetch(s.base+'/api/v1'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),headers:r.headers};}
 const create=(title='Public task',operationId='public-create-0001')=>v1('/tasks','POST',{title,projectId:project.id,assigneeId:owner.user.id,dueAt:'2026-10-20T03:00:00Z',operationId});
 return {s,api,owner,project,raw,issued,v1,create,requests,advance:ms=>{at=new Date(+at+ms);},respond:value=>{response=value;}};
}
test('TC-W9-T01 token is shown once, hashed, project/scope bounded and revoked immediately',async t=>{
 const {s,api,owner,project,raw,issued,v1,create}=await fixture(t);
 const stored=s.db.prepare('SELECT * FROM api_tokens WHERE id=?').get(issued.body.token.id);assert.ok(!JSON.stringify(stored).includes(raw));assert.match(stored.token_hash,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify((await api('/api-tokens')).body).includes(raw));
 const created=await create();assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.task.projectId,project.id);
 assert.equal((await v1('/billing')).status,404);assert.equal((await v1('/workspaces/members','POST',{})).status,404);
 const other=(await api('/tasks','POST',{title:'Outside token'})).body.task;
 assert.equal((await v1('/tasks/'+other.id)).status,404);
 const read=(await api('/api-tokens','POST',{name:'Read',scopes:['tasks:read'],projectIds:[project.id]})).body.rawToken;
 assert.equal((await v1('/tasks','POST',{title:'No',projectId:project.id,operationId:'no-write-0001'},read)).status,403);
 assert.equal((await fetch(s.base+'/api/tasks',{headers:{authorization:'Bearer '+raw}})).status,401);
 assert.equal((await api('/api-tokens/'+issued.body.token.id,'DELETE')).status,200);assert.equal((await v1('/tasks')).status,401);
 s.db.prepare("UPDATE api_tokens SET revoked_at=NULL WHERE id=?").run(issued.body.token.id);s.db.prepare("UPDATE users SET disabled_at=? WHERE id=?").run(new Date().toISOString(),owner.user.id);assert.equal((await v1('/tasks')).status,401);
});
test('TC-W9-T02 shared task/checklist/labels/custom values use revision, receipts and exactly one recurrence successor',async t=>{
 const {s,api,project,v1,create}=await fixture(t);const first=await create();assert.equal(first.status,201,JSON.stringify(first.body));
 const replay=await create();assert.deepEqual(replay.body,first.body);assert.equal(replay.headers.get('idempotency-replayed'),'true');
 assert.equal((await create('Different')).status,409);
 let task=first.body.task;
 const bad=await v1('/tasks/'+task.id,'PATCH',{title:'Invalid',workspaceId:'other',operationId:'invalid-mass-0001',expectedRevision:task.revision});assert.equal(bad.status,400);
 const checklist=await v1(`/tasks/${task.id}/checklists`,'POST',{title:'Checklist',operationId:'checklist-0001',expectedRevision:task.revision});assert.equal(checklist.status,201,JSON.stringify(checklist.body));assert.notEqual(checklist.body.revision,task.revision);
 const item=await v1(`/tasks/${task.id}/checklists/${checklist.body.checklist.id}/items`,'POST',{title:'Item',operationId:'checklist-item-0001',expectedRevision:checklist.body.revision});assert.equal(item.status,201,JSON.stringify(item.body));
 const stale=await v1('/tasks/'+task.id,'PATCH',{status:'done',operationId:'stale-edit-0001',expectedRevision:task.revision});assert.equal(stale.status,409);assert.equal(stale.body.error.code,'revision_conflict');
 task=(await v1('/tasks/'+task.id)).body.task;
 const recurrence=await v1('/tasks/'+task.id,'PATCH',{recurrence:'daily',operationId:'set-recurring-0001',expectedRevision:task.revision});assert.equal(recurrence.status,200);
 const done={status:'done',operationId:'complete-recurring-0001',expectedRevision:recurrence.body.revision};assert.equal((await v1('/tasks/'+task.id,'PATCH',done)).status,200);assert.equal((await v1('/tasks/'+task.id,'PATCH',done)).status,200);
 assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE project_id=?').get(project.id).n,2);
 assert.ok(s.db.prepare("SELECT 1 FROM business_events WHERE task_id=? AND source='public_api'").get(task.id));
 const field=await api(`/projects/${project.id}/fields`,'POST',{name:'Effort',type:'number'});assert.equal(field.status,201,JSON.stringify(field.body));
 task=(await v1('/tasks/'+task.id)).body.task;const values=await v1('/tasks/'+task.id+'/fields','PUT',{values:{[field.body.field.id]:0},expectedRevision:task.revision,operationId:'fields-value-0001'});assert.equal(values.status,200,JSON.stringify(values.body));
 const label=await api('/task-labels','POST',{name:'API label',color:'blue',projectId:project.id});assert.equal(label.status,201);
 task=(await v1('/tasks/'+task.id)).body.task;const labels=await v1('/tasks/'+task.id+'/labels','PUT',{labelIds:[label.body.label.id],operationId:'api-labels-0001',expectedRevision:task.revision});assert.equal(labels.status,200,JSON.stringify(labels.body));
 assert.equal((await v1('/tasks/'+task.id+'/labels')).body.labels.length,1);
});
test('TC-W9-T02 pagination is stable and binds cursor to scope/filter; downgrade and rate limits enforce current policy',async t=>{
 const {s,owner,project,v1,create,advance}=await fixture(t);for(let i=0;i<3;i++)assert.equal((await create('Task '+i,'paging-create-000'+i)).status,201);
 const page=await v1('/tasks?limit=2');assert.equal(page.body.data.length,2);assert.equal(page.body.total,3);assert.ok(page.body.nextCursor);
 const next=await v1('/tasks?limit=2&cursor='+encodeURIComponent(page.body.nextCursor));assert.equal(next.body.data.length,1);assert.ok(!page.body.data.some(x=>x.id===next.body.data[0].id));
 assert.equal((await v1('/tasks?status=done&cursor='+encodeURIComponent(page.body.nextCursor))).status,400);
 assert.equal((await v1('/tasks?limit=101')).status,400);assert.equal((await v1('/projects')).body.data.length,1);
 s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(owner.workspace.id);assert.equal((await v1('/tasks')).status,403);
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);advance(60000);
 let r;for(let i=0;i<121;i++)r=await v1('/tasks?limit=1');assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0);assert.equal(r.body.error.code,'rate_limited');
 assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE project_id=?').get(project.id).n,3);
});
test('TC-W9-T03 SSRF blocks reserved IPv4/IPv6, mapped addresses, private DNS and URL redirects; signature authenticates exact bytes',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1','100.64.0.1','::1','::ffff:8.8.8.8','fe80::1','fd00::1','2001:db8::1','2002:7f00:1::1'])assert.equal(isPublicWebhookAddress(ip),false,ip);
 assert.equal(isPublicWebhookAddress('8.8.8.8'),true);assert.equal(isPublicWebhookAddress('2606:4700:4700::1111'),true);
 for(const url of ['http://example.com','https://localhost/hook','https://127.0.0.1','https://[::1]/','https://user:password@example.com','https://example.com:444/'])await assert.rejects(resolveWebhookDestination(url));
 await assert.rejects(resolveWebhookDestination('https://receiver.example',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]));
 const body=Buffer.from('{"name":"Tiếng Việt"}'),header=signWebhook('secret',2,1000,body);
 assert.equal(verifyWebhook(body,header,{2:'secret'},{now:1000000}),true);assert.equal(verifyWebhook(Buffer.concat([body,Buffer.from(' ')]),header,{2:'secret'},{now:1000000}),false);assert.equal(verifyWebhook(body,header,{2:'secret'},{now:1400000}),false);
});
test('TC-W9-T03 webhook retries stable event ID, signs bytes, rotates key and suppresses after downgrade/restore',async t=>{
 const {s,api,owner,project,create,requests,advance,respond}=await fixture(t);
 const subscription=await api('/webhooks','POST',{name:'Receiver',url:'https://receiver.example/hooks',projectIds:[project.id],events:['task.created','task.completed']});assert.equal(subscription.status,201,JSON.stringify(subscription.body));
 const id=subscription.body.subscription.id,secret=subscription.body.signingSecret;assert.ok(!JSON.stringify((await api('/webhooks')).body).includes(secret));
 await create();respond(new Error('accepted then timeout'));await s.app.locals.processWebhooks();assert.equal(requests.length,1);
 const first=requests[0],envelope=JSON.parse(first.body);assert.equal(verifyWebhook(first.body,first.headers['x-nhactoi-signature'],{1:secret},{now:Date.parse('2026-10-16T03:00:00Z')}),true);
 assert.equal(s.db.prepare('SELECT state FROM webhook_deliveries').get().state,'retry');
 const rotated=await api('/webhooks/'+id+'/rotate','POST',{});respond({status:204});advance(60000);await s.app.locals.processWebhooks();assert.equal(requests.length,2);assert.equal(JSON.parse(requests[1].body).eventId,envelope.eventId);
 assert.equal(verifyWebhook(requests[1].body,requests[1].headers['x-nhactoi-signature'],{2:rotated.body.signingSecret},{now:Date.parse('2026-10-16T03:01:00Z')}),true);
 await create('Queued before downgrade','downgrade-create-0001');s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(owner.workspace.id);await s.app.locals.processWebhooks();assert.equal(requests.length,2);assert.equal(s.db.prepare("SELECT count(*) n FROM webhook_deliveries WHERE state='suppressed'").get().n,1);
 s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);await create('Restore queued','restore-create-0001');s.db.prepare("INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES('restoreSenderHold','{}',0,?)").run(new Date().toISOString());assert.equal((await s.app.locals.processWebhooks()).processed,0);assert.equal(requests.length,2);
});
test('TC-W9-T03 terminal redirects, bounded automatic retries and manual retries retain event ID',async t=>{
 const {s,api,project,create,requests,respond,advance}=await fixture(t);
 const hook=(await api('/webhooks','POST',{name:'Redirect test',url:'https://receiver.example/',projectIds:[project.id],events:['task.created']})).body.subscription;
 await create();respond({status:302});await s.app.locals.processWebhooks();let delivery=s.db.prepare('SELECT * FROM webhook_deliveries').get();assert.equal(delivery.state,'failed');assert.equal(requests.length,1);
 assert.equal((await api(`/webhooks/${hook.id}/deliveries/${delivery.id}/retry`,'POST',{})).status,200);respond({status:503});
 for(let i=0;i<8;i++){advance(3601000);await s.app.locals.processWebhooks();}
 delivery=s.db.prepare('SELECT * FROM webhook_deliveries').get();assert.equal(delivery.state,'failed');assert.equal(delivery.attempt_count,8);assert.equal(new Set(requests.map(r=>JSON.parse(r.body).eventId)).size,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM webhook_attempts').get().n,8);
});

function checkSchema(value,schema,path='$'){
 if(schema.enum)assert.ok(schema.enum.includes(value),path+' enum');
 if(schema.type){const types=[schema.type].flat();const type=value===null?'null':Array.isArray(value)?'array':typeof value;
  assert.ok(types.includes(type)||(types.includes('integer')&&Number.isInteger(value)),path+' type '+type);
 }
 if(typeof value==='string'){if(schema.pattern)assert.match(value,new RegExp(schema.pattern),path);if(schema.minLength)assert.ok(value.length>=schema.minLength,path);if(schema.maxLength)assert.ok(value.length<=schema.maxLength,path);}
 if(typeof value==='number'){if(schema.minimum!==undefined)assert.ok(value>=schema.minimum,path);if(schema.maximum!==undefined)assert.ok(value<=schema.maximum,path);}
 if(Array.isArray(value)&&schema.items)value.forEach((v,i)=>checkSchema(v,schema.items,path+'['+i+']'));
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  for(const key of schema.required||[])assert.ok(Object.hasOwn(value,key),path+' missing '+key);
  for(const [key,v] of Object.entries(value)){if(schema.properties?.[key])checkSchema(v,schema.properties[key],path+'.'+key);else if(schema.additionalProperties===false)assert.fail(path+' unexpected '+key);}
 }
}
test('TC-W9-T04 executable OpenAPI/client examples, negative contracts and raw-body consumer dedupe',async t=>{
 const {publicOpenApi}=await import('../server/public-api-contract.mjs');
 const {createTask,tasks}=await import('../examples/public-api-client.mjs');
 const {consumeWebhook}=await import('../examples/webhook-consumer.mjs');
 const {s,project,raw,v1}=await fixture(t);
 assert.deepEqual(JSON.parse(readFileSync('docs/product-spec/public-api-v1.openapi.json')),publicOpenApi);
 assert.deepEqual((await v1('/openapi.json')).body,publicOpenApi);
 const created=await createTask({baseUrl:s.base,token:raw,projectId:project.id,title:'Example from docs',operationId:'example-contract-0001'});
 const schema=publicOpenApi.paths['/tasks'].post.responses['201'].content['application/json'].schema;
 checkSchema(created,schema);assert.throws(()=>checkSchema({...created,task:{...created.task,revision:123}},schema));assert.throws(()=>checkSchema({...created,task:{...created.task,credential:'must-not-export'}},schema));
 const result=await v1('/tasks?limit=1');checkSchema(result.body,publicOpenApi.paths['/tasks'].get.responses['200'].content['application/json'].schema);
 const examples=[];for await(const task of tasks({baseUrl:s.base,token:raw,projectId:project.id}))examples.push(task);assert.equal(examples.length,1);
 const bad=await v1('/tasks/'+created.task.id,'PATCH',{title:'missing revision'});checkSchema(bad.body,publicOpenApi.components.schemas.Error);
 const invalidJson=await fetch(s.base+'/api/v1/tasks',{method:'POST',headers:{authorization:'Bearer '+raw,'content-type':'application/json'},body:'{' });assert.equal(invalidJson.status,400);checkSchema(await invalidJson.json(),publicOpenApi.components.schemas.Error);
 const tooLarge=await v1('/tasks','POST',{title:'x'.repeat(1024*1024)});assert.equal(tooLarge.status,413);checkSchema(tooLarge.body,publicOpenApi.components.schemas.Error);
 const event={eventId:'event-consumer',schemaVersion:1,eventType:'task.created',resource:{type:'task',id:created.task.id},data:{title:'Example'}};
 const bytes=Buffer.from(JSON.stringify(event)),signature=signWebhook('example-secret',1,1000,bytes),seen=new Set();let applied=0;
 const args={rawBody:bytes,signature,secrets:{1:'example-secret'},now:1000000,commitOnce:async id=>{if(seen.has(id))return false;seen.add(id);applied++;return true;}};
 assert.equal((await consumeWebhook(args)).status,204);assert.equal((await consumeWebhook(args)).status,204);assert.equal(applied,1);
 assert.equal((await consumeWebhook({...args,rawBody:Buffer.concat([bytes,Buffer.from(' ')])})).status,401);
});
test('TC-W9-T02/T03 transaction fault leaves no mutation, event, receipt or webhook intent; revoked project blocks receipt replay',async t=>{
 const {s,api,owner,project,v1,create,raw}=await fixture(t);
 await api('/webhooks','POST',{name:'Fault receiver',url:'https://receiver.example',projectIds:[project.id],events:['task.created']});
 s.db.exec(`CREATE FUNCTION fail_public_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected public receipt fault'; END$$;
 CREATE TRIGGER fail_public_receipt BEFORE INSERT ON mutation_receipts FOR EACH ROW EXECUTE FUNCTION fail_public_receipt()`);
 assert.equal((await create()).status,500);
 for(const table of ['tasks','business_events','mutation_receipts','webhook_deliveries'])assert.equal(s.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
 s.db.exec('DROP TRIGGER fail_public_receipt ON mutation_receipts');assert.equal((await create()).status,201);
 s.db.prepare("UPDATE workspace_members SET role='member' WHERE workspace_id=? AND user_id=?").run(owner.workspace.id,owner.user.id);
 s.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project.id,owner.user.id);
 assert.equal((await create()).status,404);assert.equal((await v1('/tasks')).body.total,0);
});
test('TC-W9-T03 independent database connections with barrier claim once; DNS rebinding and post-DNS revoke cannot send',async t=>{
 const {openDatabase}=await import('../server/db.mjs');const {createApp}=await import('../server/index.mjs');
 const {s,api,owner,project,create,requests}=await fixture(t);
 await api('/webhooks','POST',{name:'Concurrent',url:'https://receiver.example',projectIds:[project.id],events:['task.created']});await create();
 const secondDb=openDatabase(process.env.TEST_DATABASE_URL,{schema:s.db.schema,migrate:false});
 let entered,release,sends=0;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 const second=createApp({db:secondDb,settingsKey:s.app.locals.config._settingsKey.toString('hex'),env:{NODE_ENV:'test'},clock:s.app.locals.clock,webhookLookup:async()=>{entered();await gate;return [{address:'8.8.8.8',family:4}];},webhookTransport:async()=>{sends++;return {status:204};}});
 t.after(()=>{second.locals.close();secondDb.close();});
 const first=second.locals.processWebhooks({limit:1});await started;assert.equal((await s.app.locals.processWebhooks({limit:1})).processed,0);release();await first;assert.equal(sends,1);assert.equal(requests.length,0);
 await create('Revoke during DNS','dns-revoke-0001');
 let release2,entered2;const gate2=new Promise(r=>{release2=r;}),started2=new Promise(r=>{entered2=r;});
 const thirdDb=openDatabase(process.env.TEST_DATABASE_URL,{schema:s.db.schema,migrate:false});
 const third=createApp({db:thirdDb,settingsKey:s.app.locals.config._settingsKey.toString('hex'),env:{NODE_ENV:'test'},clock:s.app.locals.clock,webhookLookup:async()=>{entered2();await gate2;return [{address:'8.8.8.8',family:4}];},webhookTransport:async()=>{sends++;return {status:204};}});t.after(()=>{third.locals.close();thirdDb.close();});
 const pending=third.locals.processWebhooks({limit:1});await started2;s.db.prepare("UPDATE subscriptions SET plan='starter' WHERE workspace_id=?").run(owner.workspace.id);release2();await pending;assert.equal(sends,1);assert.equal(s.db.prepare("SELECT count(*) n FROM webhook_deliveries WHERE state='suppressed'").get().n,1);
});

test('TC-W9-T02/T04 recurring completion filters successor through the public task schema',async t=>{
 const {publicOpenApi}=await import('../server/public-api-contract.mjs');
 const {api,project,v1}=await fixture(t);
 const customer=(await api('/customers','POST',{name:'PRIVATE_CRM_CANARY'})).body.customer;
 const task=(await api('/tasks','POST',{title:'Recurring scoped API',projectId:project.id,customerId:customer.id,recurrence:'daily',dueAt:'2026-10-20T03:00:00Z'})).body.task;
 const result=await v1('/tasks/'+task.id,'PATCH',{status:'done',expectedRevision:task.revision,operationId:'successor-schema-0001'});
 assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.body.nextTask?.id);
 assert.ok(!JSON.stringify(result.body).includes(customer.id),'tasks-only token must not expose linked CRM identifier in successor');
 checkSchema(result.body.nextTask,publicOpenApi.components.schemas.Task);
 checkSchema(result.body,publicOpenApi.paths['/tasks/{taskId}'].patch.responses[200].content['application/json'].schema);
});

test('TC-W9-T03-F crashed eighth webhook attempt cannot bypass the automatic attempt cap',async t=>{
 const {s,api,project,create,requests}=await fixture(t);
 const hook=(await api('/webhooks','POST',{name:'Crash cap',url:'https://receiver.example/crash',projectIds:[project.id],events:['task.created']})).body.subscription;
 await create();
 const d=s.db.prepare('SELECT * FROM webhook_deliveries').get();
 s.db.prepare("UPDATE webhook_deliveries SET state='sending',attempt_count=8,lease_token='crashed-eighth',lease_until='2026-10-16T02:00:00Z' WHERE id=?").run(d.id);
 s.db.prepare("INSERT INTO webhook_attempts(id,delivery_id,attempt_number,key_version,started_at,outcome) VALUES('crashed-attempt',?,8,1,'2026-10-16T02:00:00Z','sending')").run(d.id);
 await s.app.locals.processWebhooks();
 assert.equal(requests.length,0,'expired lease is not authorization for a ninth automatic send');
 assert.equal(s.db.prepare('SELECT state FROM webhook_deliveries WHERE id=?').get(d.id).state,'failed');
 assert.equal(s.db.prepare("SELECT outcome FROM webhook_attempts WHERE id='crashed-attempt'").get().outcome,'unknown');
 assert.equal((await api(`/webhooks/${hook.id}/deliveries/${d.id}/retry`,'POST',{})).status,200);
 await s.app.locals.processWebhooks();assert.equal(requests.length,1,'an explicit manual retry is authorized');
 assert.equal(s.db.prepare('SELECT attempt_count FROM webhook_deliveries WHERE id=?').get(d.id).attempt_count,9);
});
