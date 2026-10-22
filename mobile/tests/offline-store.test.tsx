import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import {offlineRead,offlineUpdate,offlineDelete} from '../src/core/offline-store';
import {enqueue,claimNext,rejectOperation} from '../src/core/offline-state';
jest.unmock('../src/core/offline-store');
const mockRows=new Map<string,string>();
const mockCalls:string[]=[];
let mockFail=false;
const mockTx={
  getFirstAsync:jest.fn(async(_sql:string,scope:string)=>mockRows.has(scope)?{payload:mockRows.get(scope)}:null),
  runAsync:jest.fn(async(_sql:string,scope:string,payload:string)=>{if(mockFail)throw new Error('SQLITE_FULL');mockRows.set(scope,payload);}),
};
const mockDb={
  execAsync:jest.fn(async(sql:string)=>{mockCalls.push(sql);}),
  getFirstAsync:jest.fn(async(sql:string,scope:string)=>sql==='PRAGMA cipher_version'?{'cipher_version':'4.test'}:mockTx.getFirstAsync(sql,scope)),
  runAsync:jest.fn(async(_sql:string,scope:string)=>mockRows.delete(scope)),
  closeAsync:jest.fn(async()=>{}),
  withExclusiveTransactionAsync:jest.fn(async(fn:(tx:typeof mockTx)=>Promise<void>)=>{
    const before=new Map(mockRows);try{await fn(mockTx);}catch(e){mockRows.clear();for(const [k,v]of before)mockRows.set(k,v);throw e;}
  }),
};
jest.mock('expo-sqlite',()=>({openDatabaseAsync:jest.fn(async()=>mockDb),deleteDatabaseAsync:jest.fn()}));
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(async()=>null),setItemAsync:jest.fn(async()=>{})}));
jest.mock('expo-crypto',()=>({getRandomBytesAsync:jest.fn(async()=>new Uint8Array(32).fill(7))}));
test('TC-W4-T02-A/B/D: encryption precedes schema access, scoped state commits only on success, storage faults never erase drafts',async()=>{
  await offlineUpdate('origin/account-a/workspace',state=>{state.drafts.note={body:'private canary'};});
  expect(mockCalls[0]).toMatch(/^PRAGMA key/);
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('nhactoi-drafts.db');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('nhactoi.drafts.key',expect.stringMatching(/^[0-9a-f]{64}$/));
  expect(mockDb.withExclusiveTransactionAsync).toHaveBeenCalled();
  expect((await offlineRead('origin/account-b/workspace')).drafts).toEqual({});
  mockFail=true;
  await expect(offlineUpdate('origin/account-a/workspace',state=>{state.drafts.note={body:'not saved'};})).rejects.toThrow('SQLITE_FULL');
  expect((await offlineRead('origin/account-a/workspace')).drafts.note.body).toBe('private canary');
  expect(SQLite.deleteDatabaseAsync).not.toHaveBeenCalled();
  mockFail=false;
  await offlineDelete('origin/account-b/workspace');
  expect((await offlineRead('origin/account-a/workspace')).drafts.note.body).toBe('private canary');
});
test('TC-X08: revoked import draft stays in its scoped encrypted-store document with original operation and wire payload',async()=>{
  const scope='origin/import-editor/private-workspace',body={title:'Private imported edit',expectedRevision:'r1'};
  await offlineUpdate(scope,state=>{enqueue(state,{id:'import-local-edit',path:'/tasks/imported',method:'PATCH',body});state.drafts.imported={comment:'Private comment draft'};});
  const sent=await offlineUpdate(scope,state=>claimNext(state)!);
  await offlineUpdate(scope,state=>rejectOperation(state,sent.id,{status:404,message:'Không còn quyền'}));
  const restored=await offlineRead(scope);
  expect(restored.operations[0]).toMatchObject({id:sent.id,status:'blocked',body,wire:sent.wire});expect(restored.drafts.imported.comment).toBe('Private comment draft');expect(restored.denied?.imported).toBe(true);expect(claimNext(restored)).toBeUndefined();
  expect((await offlineRead('origin/other-editor/private-workspace')).operations).toEqual([]);expect(SQLite.deleteDatabaseAsync).not.toHaveBeenCalled();
});
