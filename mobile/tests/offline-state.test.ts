import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyOfflineState,enqueue,claimNext,acknowledge,rejectOperation,resolveOperation,queueable,projectOffline} from '../src/core/offline-state.ts';
import {canReadOffline,isWritable} from '../src/core/policy.ts';
const add=(state:ReturnType<typeof emptyOfflineState>,id:string,path='/tasks/t',method='PATCH',body:Record<string,unknown>={title:id,expectedRevision:'r1'})=>enqueue(state,{id,path,method,body},1);
test('TC-W4-T03-C/E: sending wire is immutable; a newer edit waits for the predecessor ACK revision',()=>{
  const state=emptyOfflineState();add(state,'operation-a');const first=claimNext(state)!;
  add(state,'operation-b');assert.equal(claimNext(state)!.id,'operation-a');
  assert.deepEqual(state.operations[0].wire,first.wire);assert.equal(state.operations[1].wire,undefined);
  acknowledge(state,'operation-a',{task:{id:'t',revision:'r2'}});
  assert.equal(claimNext(state)!.wire!.body.expectedRevision,'r2');
  assert.equal(state.operations[0].body.title,'operation-b');
});
test('TC-W4-T03-B: task temporary ID resolves before checklist and personal plan; checklist child mapping is atomic',()=>{
  const state=emptyOfflineState();const parent=add(state,'create-task','/tasks','POST',{title:'Parent'});
  add(state,'create-list',`/tasks/${parent.localId}/checklists`,'POST',{title:'List'});
  add(state,'personal-plan',`/tasks/${parent.localId}/plan`,'PATCH',{plannedDate:'2028-02-29'});
  assert.equal(claimNext(state)!.id,'create-task');
  acknowledge(state,'create-task',{task:{id:'server-task',revision:'r1'}});
  let next=claimNext(state)!;assert.equal(next.wire!.path,'/tasks/server-task/checklists');assert.equal(next.wire!.body.expectedRevision,'r1');
  const listId=next.localId!;add(state,'create-item',`/tasks/${parent.localId}/checklists/${listId}/items`,'POST',{title:'Child'});
  acknowledge(state,'create-list',{checklist:{id:'server-list'},taskRevision:'r2'});
  next=claimNext(state)!;assert.equal(next.id,'personal-plan');acknowledge(state,next.id,{planRevision:'p1'});
  next=claimNext(state)!;assert.equal(next.wire!.path,'/tasks/server-task/checklists/server-list/items');assert.equal(next.wire!.body.expectedRevision,'r2');
});
test('TC-W4-T03-D: timeout and process restart preserve operation ID and exact wire payload',()=>{
  const state=emptyOfflineState();add(state,'complete-recurring','/tasks/t','PATCH',{status:'done',expectedRevision:'r1'});
  const before=claimNext(state)!;rejectOperation(state,before.id,{status:0,message:'Response lost'});
  const reopened=JSON.parse(JSON.stringify(state));assert.deepEqual(claimNext(reopened)?.wire,before.wire);
  acknowledge(reopened,before.id,{task:{id:'t',revision:'r2'},nextTask:{id:'one-successor'}});
  assert.equal(claimNext(reopened),undefined);assert.equal((reopened.results[before.id].nextTask as {id:string}).id,'one-successor');
});
test('TC-W4-T04-A/B: conflict retains local and server; local choice has a new operation at reviewed revision',()=>{
  const state=emptyOfflineState();add(state,'old');claimNext(state);
  rejectOperation(state,'old',{status:409,message:'Conflict',payload:{error:{details:{currentRevision:'r2'}}}});
  assert.equal(state.operations[0].status,'conflict');assert.equal(state.operations[0].body.title,'old');
  resolveOperation(state,'old','local','new',{title:'Server',revision:'r2'},'r2');
  assert.equal(claimNext(state)?.wire?.body.operationId,'new');assert.equal(state.operations[0].body.expectedRevision,'r2');
  rejectOperation(state,'new',{status:409,message:'Again',payload:{currentRevision:'r3'}});
  resolveOperation(state,'new','server','unused',{title:'Server'},'r3');assert.equal(state.operations.length,0);
});
test('TC-W4-T05-D: comment/delete/move/upload/finance/renewal/timer never enter task outbox',()=>{
  for(const [path,method] of [['/tasks/t/comments','POST'],['/tasks/t','DELETE'],['/boards/tasks/t/move','POST'],['/tasks/t/attachments','POST'],['/services/s/renew','POST'],['/transactions','POST'],['/tasks/t/timer','POST']]) {
    assert.equal(queueable(path,method),false);assert.throws(()=>add(emptyOfflineState(),'forbidden',path,method));
  }
});
test('TC-W4-T04-C/D: 24h, earlier session expiry, subscription and backward clock are independent gates',()=>{
  const now=Date.parse('2026-10-16T03:00:00Z');
  const session={verifiedAt:now-1000,lastSeenAt:now,expiresAt:new Date(now+1000).toISOString(),workspace:{},subscription:{status:'active',currentPeriodEnd:new Date(now-1).toISOString()}};
  assert.equal(canReadOffline(session,now),true);assert.equal(canReadOffline(session,now-1),false);assert.equal(canReadOffline(session,now+1000),false);
  assert.equal(canReadOffline({...session,verifiedAt:now-86400000},now),false);assert.equal(isWritable({...session,subscription:{...session.subscription,currentPeriodEnd:new Date(Date.now()-1).toISOString()}},true),false);
});
test('TC-W4-T03-B: optimistic task/checklist/plan share the same durable state without altering server base',()=>{
  const state=emptyOfflineState();const create=add(state,'task','/tasks','POST',{title:'Nháp',assigneeId:'u'});
  const list=add(state,'list',`/tasks/${create.localId}/checklists`,'POST',{title:'Checklist'});
  add(state,'item',`/tasks/${create.localId}/checklists/${list.localId}/items`,'POST',{title:'Mục'});
  add(state,'plan',`/tasks/${create.localId}/plan`,'PATCH',{plannedDate:'2028-02-29'});
  const source={tasks:[]};const projected=projectOffline(state,'/personal-tasks',source,'u') as {tasks:Record<string,unknown>[]};
  assert.equal(projected.tasks[0].plannedDate,'2028-02-29');assert.deepEqual(source,{tasks:[]});
  const detail=projectOffline(state,`/tasks/${create.localId}/detail`,null,'u') as {checklists:{items:{title:string}[]}[]};
  assert.equal(detail.checklists[0].items[0].title,'Mục');
});
test('TC-W4-T04-E: denied operation blocks only its resource; drafts remain intact',()=>{
  const state=emptyOfflineState();state.drafts.comment={body:'private draft'};add(state,'denied');add(state,'later');add(state,'other','/tasks/other');claimNext(state);
  rejectOperation(state,'denied',{status:403,message:'revoked'});
  assert.equal(claimNext(state)?.id,'other');assert.equal(state.drafts.comment.body,'private draft');assert.equal(state.operations[1].wire,undefined);
});

test('TC-W4-T05-E: correcting a rejected temporary parent preserves its queued checklist and new operation ID',()=>{
  const state=emptyOfflineState();const parent=add(state,'bad-parent','/tasks','POST',{title:'Parent',assigneeId:'revoked'});
  add(state,'child',`/tasks/${parent.localId}/checklists`,'POST',{title:'Child'});claimNext(state);
  rejectOperation(state,parent.id,{status:400,message:'Assignee is invalid'});
  resolveOperation(state,parent.id,'local','corrected-parent',{},undefined,{title:'Parent',assigneeId:null});
  const retry=claimNext(state)!;assert.equal(retry.id,'corrected-parent');assert.equal(retry.localId,parent.localId);
  acknowledge(state,retry.id,{task:{id:'server',revision:'r1'}});
  const child=claimNext(state)!;assert.equal(child.wire?.path,'/tasks/server/checklists');assert.equal(child.wire?.body.expectedRevision,'r1');
});

test('paged personal cache retains queued creates and plans moved to an uncached date window',()=>{
  const state=emptyOfflineState();const parent=add(state,'mine','/tasks','POST',{title:'Mine',assigneeId:'u'});
  add(state,'someone-else','/tasks','POST',{title:'Other',assigneeId:'another'});
  add(state,'new-plan',`/tasks/${parent.localId}/plan`,'PATCH',{plannedDate:'2028-02-29'});
  const plan=add(state,'existing-plan','/tasks/existing/plan','PATCH',{plannedDate:'2028-02-29'});
  plan.snapshot={id:'existing',title:'Existing',status:'todo',assigneeId:'u',dueAt:null,plannedDate:'2028-02-28'};
  const base={tasks:[],total:0,hasMore:false};
  const output=projectOffline(state,'/personal-tasks?view=upcoming&date=2028-02-28&page=1',base,'u') as {tasks:Record<string,unknown>[]};
  assert.equal(output.tasks.length,2);assert.ok(output.tasks.every(t=>t.plannedDate==='2028-02-29'&&t.pending));assert.deepEqual(base,{tasks:[],total:0,hasMore:false});
  state.denied={existing:true};
  assert.equal((projectOffline(state,'/personal-tasks?page=1',base,'u') as {tasks:unknown[]}).tasks.length,1);
  assert.equal(claimNext(state)?.wire?.body.snapshot,undefined);
});
