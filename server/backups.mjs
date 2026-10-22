import {getRemoteStore} from "./remote-storage.mjs";
import {pipeline} from "node:stream/promises";
import {createWriteStream} from "node:fs";
import {rmSync,mkdirSync,chmodSync,copyFileSync,readFileSync,writeFileSync,readdirSync,existsSync,renameSync,lstatSync} from 'node:fs';
import {dirname,join,resolve,isAbsolute} from 'node:path';
import { exportSnapshot, validateSnapshot, snapshotRows } from './database-snapshot.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {safeStoragePath} from './task-files.mjs';
import {decryptSetting,encryptSetting} from './settings-crypto.mjs';
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
export const backupRoot=dbPath=>join(dirname(resolve(dbPath)),'snapshots');
function ensureDir(path){mkdirSync(path,{recursive:true,mode:0o700});if(lstatSync(path).isSymbolicLink())throw new Error('Thư mục sao lưu không được là liên kết');chmodSync(path,0o700)}

const SHA256=/^[a-f0-9]{64}$/i;

function storageKind(storageRoot){
 if(typeof storageRoot!=='string'||!storageRoot)return null;
 return storageRoot.startsWith('remote:')?'remote':'local';
}

function assertStorageMetadata(row){
 const kind=storageKind(row.storage_root);
 if(!kind||typeof row.storage_key!=='string'||!row.storage_key)
  throw new Error('Siêu dữ liệu nơi lưu tệp trong bản sao không hợp lệ');
 if(kind==='remote'){
  const profileId=row.storage_root.slice('remote:'.length);
  if(!profileId||/[\\/\u0000]/u.test(profileId))
   throw new Error('Siêu dữ liệu kho ngoài trong bản sao không hợp lệ');
 }else{
  if(!isAbsolute(row.storage_root))
   throw new Error('Siêu dữ liệu kho cục bộ trong bản sao không hợp lệ');
 }
 const parts=row.storage_key.split(/[\\/]+/u);
 if(parts.some(part=>!part||part==='.'||part==='..'||part.includes('\u0000')))
  throw new Error('Đường dẫn tệp trong bản sao không hợp lệ');
 return kind;
}

function assertManifestStorageMetadata(entry,row){
 const hasMetadata=Object.hasOwn(entry,'storageRoot')||Object.hasOwn(entry,'storageKey')||Object.hasOwn(entry,'storageType');
 if(!hasMetadata)return;
 if(entry.storageRoot!==row.storage_root||entry.storageKey!==row.storage_key||entry.storageType!==storageKind(row.storage_root))
  throw new Error('Siêu dữ liệu nơi lưu tệp không khớp cơ sở dữ liệu');
}

function fileRows(snapshot){
 return snapshotRows(validateSnapshot(snapshot),'task_attachments').filter(row=>row.kind==='file').sort((a,b)=>a.id.localeCompare(b.id));
}
// Version 3 encrypts database.json (password hashes, tokens, customer data)
// with the settings key; version 2 backups stay readable as plaintext.
export function readBackupSnapshot(databasePath,manifest,settingsKey){
 const text=readFileSync(databasePath,'utf8');
 if(manifest.version===2)return JSON.parse(text);
 if(!Buffer.isBuffer(settingsKey)||settingsKey.length!==32)throw new Error('Cần khóa mã hóa gốc để đọc bản sao');
 try{return JSON.parse(decryptSetting(text,settingsKey))}catch{throw new Error('Không giải mã được bản sao bằng khóa mã hóa hiện tại')}
}

export async function createBackup({db,dbPath,clock=()=>new Date(),settingsKey}){
 if(dbPath===':memory:')throw new Error('Sao lưu cần cơ sở dữ liệu trên đĩa');if(!Buffer.isBuffer(settingsKey)||settingsKey.length!==32)throw new Error('Sao lưu cần khóa mã hóa gốc');const root=backupRoot(dbPath);ensureDir(root);const id=`backup-${new Date(clock()).toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`,stage=join(root,id+'.pending'),target=join(root,id);ensureDir(stage);try{ensureDir(join(stage,'files'));const path=join(stage,'database.json');
 const snapshot=exportSnapshot(db);writeFileSync(path,encryptSetting(JSON.stringify(snapshot),settingsKey),{mode:0o600});chmodSync(path,0o600);const files=fileRows(snapshot);
 const entries=[];for(const row of files){const name=`${row.id.replace(/[^a-zA-Z0-9_-]/g,'_')}.bin`,targetFile=join(stage,'files',name);
 assertStorageMetadata(row);
 if(row.storage_root?.startsWith('remote:')){const store=getRemoteStore(db);if(!store)throw new Error('Cần cấu hình kho ngoài để sao lưu đầy đủ tệp');await pipeline(await store.get(row.storage_root,row.storage_key),createWriteStream(targetFile,{flags:'wx',mode:0o600}));}
 else {const source=safeStoragePath(row,Error);const stat=lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Tệp sao lưu không hợp lệ');copyFileSync(source,targetFile);chmodSync(targetFile,0o600);}
 const size=lstatSync(targetFile).size;if(size!==row.size_bytes)throw new Error('Tệp sao lưu sai dung lượng');entries.push({id:row.id,file:'files/'+name,sha256:sha(targetFile),size,storageRoot:row.storage_root,storageKey:row.storage_key,storageType:storageKind(row.storage_root)})}

 const manifest={version:3,databaseEncrypted:true,id,createdAt:new Date(clock()).toISOString(),databaseSha256:sha(path),files:entries,remoteFiles:files.filter(f=>f.storage_root?.startsWith("remote:")).length};writeFileSync(join(stage,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});renameSync(stage,target);return {id,createdAt:manifest.createdAt,fileCount:entries.length,remoteFiles:manifest.remoteFiles};}catch(error){rmSync(stage,{recursive:true,force:true});throw error}
}
export function inspectBackup(dbPath,id,settingsKey){
 if(!/^backup-[a-zA-Z0-9-]+$/.test(id))throw new Error('Mã sao lưu không hợp lệ');
 const dir=join(backupRoot(dbPath),id);
 const dirStat=lstatSync(dir);if(!dirStat.isDirectory()||dirStat.isSymbolicLink())throw new Error('Đường dẫn sao lưu không hợp lệ');
 const manifestPath=join(dir,'manifest.json');const manifestStat=lstatSync(manifestPath);if(!manifestStat.isFile()||manifestStat.isSymbolicLink())throw new Error('Manifest sao lưu không hợp lệ');
 const databasePath=join(dir,'database.json');const databaseStat=lstatSync(databasePath);if(!databaseStat.isFile()||databaseStat.isSymbolicLink())throw new Error('Cơ sở dữ liệu trong bản sao không hợp lệ');
 const m=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(!m||typeof m!=='object'||Array.isArray(m)||!(m.version===2||(m.version===3&&m.databaseEncrypted===true))||m.id!==id||!Array.isArray(m.files)||!Number.isSafeInteger(m.remoteFiles)||m.remoteFiles<0||sha(databasePath)!==m.databaseSha256)throw new Error('Bản sao không toàn vẹn');
 const filesDir=join(dir,'files');const filesDirStat=lstatSync(filesDir);if(!filesDirStat.isDirectory()||filesDirStat.isSymbolicLink())throw new Error('Thư mục tệp trong bản sao không hợp lệ');
 const snapshot=readBackupSnapshot(databasePath,m,settingsKey);const rows=fileRows(snapshot);const rowsById=new Map(rows.map(row=>[row.id,row]));
 if(rowsById.size!==rows.length||m.files.length!==rows.length||m.remoteFiles!==rows.filter(row=>storageKind(row.storage_root)==='remote').length)throw new Error('Manifest không đầy đủ hoặc có tệp dư');
 const seenIds=new Set();const seenPaths=new Set();
 for(const row of rows)assertStorageMetadata(row);
 for(const entry of m.files){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.id!=='string'||seenIds.has(entry.id)||!rowsById.has(entry.id))throw new Error('Manifest có ID tệp trùng hoặc không khớp cơ sở dữ liệu');
  if(typeof entry.file!=='string'||!/^files\/[a-zA-Z0-9_-]+\.bin$/.test(entry.file)||seenPaths.has(entry.file))throw new Error('Đường dẫn tệp trong manifest không hợp lệ hoặc bị trùng');
  if(!SHA256.test(entry.sha256)||!Number.isSafeInteger(entry.size)||entry.size<0)throw new Error('Hash hoặc dung lượng tệp trong manifest không hợp lệ');
  const row=rowsById.get(entry.id);assertManifestStorageMetadata(entry,row);
  if(entry.size!==row.size_bytes)throw new Error('Dung lượng tệp trong manifest không khớp cơ sở dữ liệu');
  const filePath=join(dir,entry.file);const fileStat=lstatSync(filePath);if(!fileStat.isFile()||fileStat.isSymbolicLink()||fileStat.size!==entry.size||sha(filePath)!==entry.sha256)throw new Error('Tệp trong bản sao không toàn vẹn');
  seenIds.add(entry.id);seenPaths.add(entry.file);
 }
 const actualFiles=readdirSync(filesDir);if(actualFiles.length!==seenPaths.size||actualFiles.some(name=>!seenPaths.has(`files/${name}`)))throw new Error('Thư mục tệp trong bản sao không khớp manifest');
 return {dir,manifest:m,snapshot};
}
// Complete backups, newest first. Pending or unreadable folders are never listed, so never pruned.
export function listBackups(dbPath){const root=backupRoot(dbPath);return existsSync(root)?readdirSync(root).filter(name=>/^backup-[a-zA-Z0-9-]+$/.test(name)).map(id=>{try{const m=JSON.parse(readFileSync(join(root,id,'manifest.json'),'utf8'));return {id,createdAt:m.createdAt,fileCount:m.files.length,remoteFiles:m.remoteFiles}}catch{return null}}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)):[]}
export const BACKUP_KEEP_OPTIONS=[0,7,14,30,60];
// Keep the newest `keep` complete backups; 0 keeps every backup.
export function pruneBackups(dbPath,keep){if(!keep)return [];const root=backupRoot(dbPath),removed=listBackups(dbPath).slice(keep).map(b=>b.id);for(const id of removed)rmSync(join(root,id),{recursive:true,force:true});return removed}

export function registerBackupRoutes(app,{db,dbPath,clock,settingsKey,requirePlatformAdmin,withTransaction,writeAdminAudit,HttpError}){
 const setting=()=>{try{return JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key='backupSchedule'").get()?.value||'{}')}catch{return {}}};
 const save=value=>db.prepare("INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES ('backupSchedule',?,0,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(JSON.stringify(value),new Date(clock()).toISOString());
 let backingUp=false;async function run(){if(backingUp)throw new HttpError(409,"Một lần sao lưu đang chạy");backingUp=true;try{const backup=await createBackup({db,dbPath,clock,settingsKey});save({...setting(),lastRun:backup.createdAt,lastAttempt:null,lastError:null});try{const removed=pruneBackups(dbPath,setting().keep);if(removed.length)console.info('[nhactoi] removed old backups',removed.length)}catch{console.error('[nhactoi] could not remove old backups')}return backup}catch(error){save({...setting(),lastAttempt:new Date(clock()).toISOString(),lastError:'Sao lưu thất bại. Kiểm tra dung lượng đĩa và quyền đọc kho tệp.'});throw error}finally{backingUp=false}}
 app.locals.processBackups=async()=>{const s=setting(),at=new Date(clock()).getTime();if(!s.enabled||backingUp)return;const last=Date.parse(s.lastAttempt||s.lastRun||0);if(Number.isFinite(last)&&at-last<(s.intervalHours||24)*3600000)return;await run()};
 app.get('/api/admin/backups',requirePlatformAdmin,(req,res,next)=>{try{const root=backupRoot(dbPath);res.json({backups:listBackups(dbPath),schedule:setting(),path:root})}catch(e){next(e)}});
 app.post('/api/admin/backups',requirePlatformAdmin,async(req,res,next)=>{try{const reason=String(req.body?.reason||'').trim();if(reason.length<3||reason.length>500)throw new HttpError(400,'Cần lý do sao lưu');const backup=await run();withTransaction(db,()=>writeAdminAudit(db,{actorUserId:req.auth.userId,action:'backup.create',targetType:'platform',targetId:backup.id,reason,before:null,after:{id:backup.id},createdAt:new Date(clock()).toISOString()}));res.status(201).json({backup})}catch(e){next(e)}});
 app.put('/api/admin/backups/schedule',requirePlatformAdmin,(req,res,next)=>{try{const b=req.body||{};if(typeof b.enabled!=='boolean'||![6,12,24,168].includes(b.intervalHours)||(b.keep!==undefined&&!BACKUP_KEEP_OPTIONS.includes(b.keep))||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>500)throw new HttpError(400,'Lịch sao lưu hoặc lý do không hợp lệ');const before=setting(),keep=b.keep??before.keep??0;withTransaction(db,()=>{save({...before,enabled:b.enabled,intervalHours:b.intervalHours,keep});writeAdminAudit(db,{actorUserId:req.auth.userId,action:'backup.schedule',targetType:'platform',targetId:'backupSchedule',reason:b.reason.trim(),before:{enabled:!!before.enabled,intervalHours:before.intervalHours||24,keep:before.keep??0},after:{enabled:b.enabled,intervalHours:b.intervalHours,keep},createdAt:new Date(clock()).toISOString()})});res.json({ok:true})}catch(e){next(e)}});
}
