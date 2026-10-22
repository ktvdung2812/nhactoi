import {offlineRead,offlineUpdate,offlineDelete} from '../src/core/offline-store';
import {enqueue, type Payload} from '../src/core/offline-state';
import {replayOffline} from '../src/core/offline-sync';
const scope='offline-sync-test';
beforeEach(async()=>{await offlineDelete(scope);});
function deferred<T>() {let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
test('TC-W4-T03-C/D/E: concurrent flushes share one transport; lost ACK retries exact payload while subsequent draft waits',async()=>{
  await offlineUpdate(scope,state=>enqueue(state,{id:'op-original',path:'/tasks/t',method:'PATCH',body:{title:'First',expectedRevision:'r1'}}));
  const response=deferred<Payload>();const send=jest.fn(()=>response.promise);
  const first=replayOffline(scope,send,()=>true);const duplicate=replayOffline(scope,send,()=>true);
  expect(first).toBe(duplicate);
  await new Promise(resolve=>setTimeout(resolve,0));expect(send).toHaveBeenCalledTimes(1);
  await offlineUpdate(scope,state=>enqueue(state,{id:'op-followup',path:'/tasks/t',method:'PATCH',body:{title:'Second',expectedRevision:'r1'}}));
  response.reject({status:0,message:'Lost response'});await expect(first).rejects.toMatchObject({status:0});
  const frozen=send.mock.calls[0];
  const retry=jest.fn(async(_path:string,options:RequestInit)=>({taskRevision:JSON.parse(String(options.body)).operationId==='op-original'?'r2':'r3'}));
  await replayOffline(scope,retry,()=>true);
  expect(retry.mock.calls[0]).toEqual(frozen);
  expect(JSON.parse(String(retry.mock.calls[1][1].body))).toMatchObject({operationId:'op-followup',expectedRevision:'r2',title:'Second'});
  expect((await offlineRead(scope)).operations).toEqual([]);
});
test('TC-W4-T04-G: old scope response cannot ACK or release dependent queue after account transition',async()=>{
  await offlineUpdate(scope,state=>enqueue(state,{id:'op-original',path:'/tasks/t',method:'PATCH',body:{title:'First',expectedRevision:'r1'}}));
  let current=true;const response=deferred<Payload>();const send=jest.fn(()=>response.promise);
  const running=replayOffline(scope,send,()=>current);await new Promise(resolve=>setTimeout(resolve,0));
  current=false;response.resolve({taskRevision:'r2'});await running;
  expect((await offlineRead(scope)).operations[0]).toMatchObject({id:'op-original',status:'sending'});
  expect((await offlineRead(scope)).results).toEqual({});
});
