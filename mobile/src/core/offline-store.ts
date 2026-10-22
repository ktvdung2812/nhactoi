import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {serialQueue} from './serial';
import {emptyOfflineState, type OfflineState} from './offline-state';
const serialize=serialQueue();
let database: Promise<SQLite.SQLiteDatabase>|undefined;
async function open() {
  let key=await SecureStore.getItemAsync('nhactoi.drafts.key');
  if(!key) {
    key=Array.from(await Crypto.getRandomBytesAsync(32),v=>v.toString(16).padStart(2,'0')).join('');
    await SecureStore.setItemAsync('nhactoi.drafts.key',key);
  }
  if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Không mở được khóa nháp. Dữ liệu được giữ nguyên.');
  const db=await SQLite.openDatabaseAsync('nhactoi-drafts.db');
  try {
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    const cipher=await db.getFirstAsync<Record<string,string>>('PRAGMA cipher_version');
    if(!cipher || !Object.values(cipher).some(Boolean))throw new Error('Bản ứng dụng chưa hỗ trợ SQLCipher. Cần cài APK đầy đủ.');
    await db.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS offline_state(scope TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL);');
    return db;
  } catch(e) {await db.closeAsync();throw e;}
}
function connection(){return database??=(open().catch(e=>{database=undefined;throw e;}));}
// One atomic state document per scope keeps ID mapping, ACK and next draft revision
// in the same commit. No network work runs inside this transaction.
export function offlineUpdate<T>(scope:string,change:(state:OfflineState)=>T):Promise<T> {
  return serialize(async()=>{
    const db=await connection();let result!:T;
    await db.withExclusiveTransactionAsync(async tx=>{
      const row=await tx.getFirstAsync<{payload:string}>('SELECT payload FROM offline_state WHERE scope=?',scope);
      const state:OfflineState=row?JSON.parse(row.payload):emptyOfflineState();
      result=change(state);
      await tx.runAsync('INSERT INTO offline_state(scope,payload) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload',scope,JSON.stringify(state));
    });
    return result;
  });
}
export function offlineRead(scope:string):Promise<OfflineState> {
  return serialize(async()=>{
    const row=await(await connection()).getFirstAsync<{payload:string}>('SELECT payload FROM offline_state WHERE scope=?',scope);
    return row?JSON.parse(row.payload):emptyOfflineState();
  });
}
export function offlineDelete(scope:string) {
  return serialize(async()=>{await(await connection()).runAsync('DELETE FROM offline_state WHERE scope=?',scope);});
}
