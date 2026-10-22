import test from 'node:test';
import assert from 'node:assert/strict';
import {boot,user,call} from './roadmap-helpers.mjs';
import {emptyOfflineState,enqueue,claimNext,acknowledge,rejectOperation,resolveOperation} from '../mobile/src/core/offline-state.ts';

test('TC-W4-T03-A/B/D + TC-W4-T04-A/B: persisted Android state replays through real PostgreSQL receipts and revisions',async t=>{
  const s=await boot(t,{clock:()=>new Date('2026-10-16T03:00:00Z')});
  const owner=await user(s,'offline-real-pipeline@example.test');
  const login=await call(s,'/mobile/auth/login',{method:'POST',body:{email:owner.user.email,password:'Password123!'}});
  assert.equal(login.status,200);
  const send=async op=>{
    const r=await fetch(s.base+'/api'+op.wire.path,{method:op.method,headers:{'content-type':'application/json',authorization:`Bearer ${login.body.token}`},body:JSON.stringify(op.wire.body)});
    return {status:r.status,body:await r.json()};
  };
  let state=emptyOfflineState();
  const create=enqueue(state,{id:'offline-create-0001',path:'/tasks',method:'POST',body:{title:'Offline parent',assigneeId:owner.user.id}});
  enqueue(state,{id:'offline-list-0001',path:`/tasks/${create.localId}/checklists`,method:'POST',body:{title:'Offline checklist'}});
  enqueue(state,{id:'offline-plan-0001',path:`/tasks/${create.localId}/plan`,method:'PATCH',body:{plannedDate:'2028-02-29',plannedTime:'09:00',plannedDuration:60}});
  const sent=claimNext(state),first=await send(sent);assert.equal(first.status,201,JSON.stringify(first.body));
  // Simulate a committed request whose response never reached the Android store.
  state=JSON.parse(JSON.stringify(state));
  const repeated=await send(claimNext(state));assert.deepEqual(repeated.body,first.body);
  acknowledge(state,sent.id,repeated.body);
  while(state.operations.length){const op=claimNext(state);assert.ok(op);const result=await send(op);assert.ok(result.status<300,JSON.stringify(result.body));assert.ok(op.resource.startsWith("plan:")?result.body.planRevision:result.body.taskRevision);acknowledge(state,op.id,result.body);}
  const id=state.ids[create.localId],detail=(await call(s,`/tasks/${id}/detail`,{cookie:owner.cookie})).body;
  assert.equal(detail.checklists.length,1);assert.equal(detail.task.dueAt,null);
  assert.equal((await call(s,'/personal-tasks',{cookie:owner.cookie})).body.tasks[0].plannedDate,'2028-02-29');
  assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE workspace_id=?').get(owner.workspace.id).n,3);
  enqueue(state,{id:'offline-stale-0001',path:`/tasks/${id}`,method:'PATCH',body:{title:'Local draft',expectedRevision:detail.task.revision}});
  const remote=await call(s,`/tasks/${id}`,{cookie:owner.cookie,method:'PATCH',body:{title:'Remote winner',expectedRevision:detail.task.revision}});assert.equal(remote.status,200);
  const local=claimNext(state),conflict=await send(local);assert.equal(conflict.status,409);
  rejectOperation(state,local.id,{status:409,message:conflict.body.error,payload:conflict.body});
  assert.equal(state.operations[0].status,'conflict');
  assert.equal(s.db.prepare('SELECT title FROM tasks WHERE id=?').get(id).title,'Remote winner');
  resolveOperation(state,local.id,'local','offline-resolved-0001',remote.body.task,remote.body.task.revision);
  const chosen=claimNext(state),saved=await send(chosen);assert.equal(saved.status,200);acknowledge(state,chosen.id,saved.body);
  assert.equal(s.db.prepare('SELECT title FROM tasks WHERE id=?').get(id).title,'Local draft');
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n,1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM mutation_receipts WHERE workspace_id=?').get(owner.workspace.id).n,4);
});
