import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,call,user,addMember} from './roadmap-helpers.mjs';
import {emptyOfflineState,enqueue,claimNext,rejectOperation,projectOffline} from '../mobile/src/core/offline-state.ts';

test('TC-X08: Trello private import and Android queue replay revalidate revoked ACL without losing the quarantined draft',async t=>{
 const s=await boot(t,{clock:()=>new Date('2026-10-16T03:00:00Z')}),owner=await user(s,'import-offline-owner@example.test'),editor=await user(s,'import-offline-editor@example.test');
 s.db.prepare("UPDATE subscriptions SET plan='business',current_period_end='2032-01-01' WHERE workspace_id=?").run(owner.workspace.id);addMember(s,owner,editor);
 const request=(path,method='GET',body)=>call(s,path,{cookie:owner.cookie,method,body});
 const project=(await request('/projects','POST',{name:'Private offline import',accessMode:'private'})).body.project;
 assert.equal((await request(`/projects/${project.id}/members/${editor.user.id}`,'PUT',{role:'editor'})).status,200);
 const canary='PRIVATE-TRELLO-X08-DO-NOT-LEAK',content=JSON.stringify({id:'private-board',lists:[{id:'todo',name:'Todo'}],labels:[{id:'source-label',name:'Private label'}],cards:[{id:'source-card',idList:'todo',name:canary,idMembers:['source-user'],idLabels:['source-label'],idChecklists:['source-list']}],checklists:[{id:'source-list',idCard:'source-card',name:'Private checklist',checkItems:[{name:'Original checklist item',state:'incomplete'}]}]}),input={source:'trello',content,userMapping:{'source-user':editor.user.id}},path=`/projects/${project.id}/import`;
 const preview=await request(path+'/preview','POST',input);assert.equal(preview.body.valid,true,JSON.stringify(preview.body));
 const imported=await request(path+'/commit','POST',{...input,previewToken:preview.body.previewToken,operationId:'x08-private-import'});assert.equal(imported.status,201,JSON.stringify(imported.body));
 const id=imported.body.taskIds[0],login=await call(s,'/mobile/auth/login',{method:'POST',body:{email:editor.user.email,password:'Password123!',workspaceId:owner.workspace.id}});assert.equal(login.status,200);
 const mobile=async(path,method='GET',body)=>{const r=await fetch(s.base+'/api'+path,{method,headers:{'content-type':'application/json',authorization:`Bearer ${login.body.token}`},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
 const detail=await mobile(`/tasks/${id}`);assert.equal(detail.status,200);assert.equal(detail.body.task.assigneeId,editor.user.id);
 let state=emptyOfflineState();const draft={title:canary+' local',expectedRevision:detail.body.task.revision};
 enqueue(state,{id:'x08-offline-edit',path:`/tasks/${id}`,method:'PATCH',body:draft});state.drafts[id]={comment:canary+' comment draft'};
 const checklist=s.db.prepare('SELECT * FROM task_checklists WHERE task_id=?').get(id),item=s.db.prepare('SELECT * FROM task_checklist_items WHERE checklist_id=?').get(checklist.id);
 enqueue(state,{id:'x08-offline-child',path:`/tasks/${id}/checklists/${checklist.id}/items/${item.id}`,method:'PATCH',body:{title:canary+' checklist'}});
 enqueue(state,{id:'x08-offline-plan',path:`/tasks/${id}/plan`,method:'PATCH',body:{plannedDate:'2028-02-29',plannedTime:'09:00',plannedDuration:60}});
 // Simulate closing/reopening offline storage. SQLCipher itself needs the native gate.
 state=JSON.parse(JSON.stringify(state));assert.equal(state.operations.length,3);
 assert.equal((await request(`/projects/${project.id}/members/${editor.user.id}`,'DELETE')).status,200);
 const before=s.db.prepare('SELECT * FROM tasks WHERE id=?').get(id),events=s.db.prepare('SELECT count(*) n FROM business_events WHERE task_id=?').get(id).n;
 const operation=claimNext(state),wire=JSON.parse(JSON.stringify(operation.wire));const rejected=await mobile(operation.wire.path,operation.method,operation.wire.body);assert.equal(rejected.status,404);assert.equal(JSON.stringify(rejected.body).includes(canary),false);
 rejectOperation(state,operation.id,{status:rejected.status,message:'Quyền đã thu hồi',payload:rejected.body});state=JSON.parse(JSON.stringify(state));
 assert.equal(state.operations[0].status,'blocked');assert.equal(state.denied[id],true);assert.deepEqual(state.operations[0].body,draft);assert.deepEqual(state.operations[0].wire,wire);assert.equal(state.drafts[id].comment,canary+' comment draft');
 const plan=claimNext(state);assert.equal(plan.id,'x08-offline-plan','denied task blocks its dependent checklist');const planDenied=await mobile(plan.wire.path,plan.method,plan.wire.body);assert.equal(planDenied.status,404);rejectOperation(state,plan.id,{status:planDenied.status,message:'Quyền đã thu hồi',payload:planDenied.body});assert.equal(claimNext(state),undefined);
 assert.deepEqual(s.db.prepare('SELECT * FROM tasks WHERE id=?').get(id),before);assert.equal(s.db.prepare('SELECT count(*) n FROM business_events WHERE task_id=?').get(id).n,events);assert.equal(s.db.prepare("SELECT count(*) n FROM mutation_receipts WHERE operation_id LIKE 'x08-offline-%'").get().n,0);assert.deepEqual(s.db.prepare('SELECT * FROM task_checklist_items WHERE id=?').get(item.id),item);assert.equal(s.db.prepare('SELECT count(*) n FROM personal_task_plans WHERE task_id=?').get(id).n,0);
 for(const url of [`/tasks/${id}`,`/tasks/${id}/detail`,`/projects/${project.id}/tasks`,'/tasks','/personal-tasks','/projects']){const result=await mobile(url);assert.equal(JSON.stringify(result.body).includes(canary),false,url);}
 const visible=projectOffline(state,'/tasks',{tasks:[]},editor.user.id);assert.equal(JSON.stringify(visible).includes(canary),false,'quarantined draft is not projected onto accessible UI results');
});
