import {offlineRead,offlineUpdate} from './offline-store';
import {claimNext,acknowledge,rejectOperation,type Payload} from './offline-state';
const running=new Map<string,Promise<void>>();
export function replayOffline(scope:string,send:(path:string,options:RequestInit)=>Promise<Payload>,current:()=>boolean) {
  const active=running.get(scope);if(active)return active;
  const promise=(async()=>{
    while(current()) {
      const operation=await offlineUpdate(scope,state=>claimNext(state));
      if(!operation || !current())return;
      try {
        const result=await send(operation.wire!.path,{method:operation.method,body:JSON.stringify(operation.wire!.body)});
        if(!current())return; // A late ACK never changes the active account's cache.
        await offlineUpdate(scope,state=>acknowledge(state,operation.id,result));
      }catch(error) {
        if(!current())return;
        const e=error as {status?:number;message?:string;payload?:Payload};
        await offlineUpdate(scope,state=>rejectOperation(state,operation.id,{status:e.status??0,message:e.message||'Không gửi được. Nháp vẫn còn.',payload:e.payload}));
        if(!e.status || [401,403,423,429].includes(e.status) || e.status>=500)throw error;
      }
    }
  })().finally(()=>running.delete(scope));
  running.set(scope,promise);return promise;
}
export async function pendingCount(scope:string) {
  const state=await offlineRead(scope);return state.operations.length+Object.keys(state.drafts).length;
}
