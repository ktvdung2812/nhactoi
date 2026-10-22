import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import {boot,call,user,task} from './roadmap-helpers.mjs';import {inspectBackup} from '../server/backups.mjs';
test('backup and Google settings require SaaS admin; OAuth binds state and protects stored secret',async t=>{const s=await boot(t),owner=await user(s,'operations@test.local');assert.equal((await call(s,'/admin/backups',{cookie:owner.cookie})).status,403);s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(owner.user.id);const b=await call(s,'/admin/backups',{method:'POST',cookie:owner.cookie,body:{reason:'Kiểm thử sao lưu'}});assert.equal(b.status,201,JSON.stringify(b.body));const snapshot=inspectBackup(s.dir+'/test.sqlite',b.body.backup.id,s.app.locals.config._settingsKey);assert.equal(snapshot.manifest.version,3);assert.equal(snapshot.manifest.databaseEncrypted,true);{const {readFileSync}=await import('node:fs');const raw=readFileSync(snapshot.dir+'/database.json','utf8');assert.match(raw,/^v1:/);assert.ok(!raw.includes('operations@test.local'),'backup database is encrypted at rest');assert.throws(()=>inspectBackup(s.dir+'/test.sqlite',b.body.backup.id),/khóa mã hóa/);}assert.equal((await call(s,'/admin/backups/schedule',{method:'PUT',cookie:owner.cookie,body:{enabled:true,intervalHours:24,reason:'Tự động hằng ngày'}})).status,200);assert.equal((await call(s,'/admin/backups',{cookie:owner.cookie})).body.backups.length,1);
 const configured=await call(s,'/admin/google-login',{method:'PUT',cookie:owner.cookie,body:{enabled:true,clientId:'test.apps.googleusercontent.com',clientSecret:'secret-not-visible',reason:'Kết nối môi trường kiểm thử'}});assert.equal(configured.status,200);const stored=s.db.prepare("SELECT * FROM app_settings WHERE key='googleLogin'").get();assert.equal(stored.encrypted,1);assert.ok(!stored.value.includes('secret-not-visible'));const config=await call(s,'/admin/google-login',{cookie:owner.cookie});assert.equal(config.body.hasSecret,true);assert.ok(!JSON.stringify(config.body).includes('secret-not-visible'));
 assert.equal((await fetch(s.base+'/api/auth/google/start',{redirect:'manual',headers:{cookie:owner.cookie}})).status,400);const start=await fetch(s.base+'/api/auth/google/start',{redirect:'manual'});assert.equal(start.status,302);const url=new URL(start.headers.get('location'));assert.equal(url.origin,'https://accounts.google.com');assert.ok(url.searchParams.get('state'));assert.ok(url.searchParams.get('code_challenge'));const wrong=await fetch(s.base+'/api/auth/google/callback?state=wrong&code=test');assert.equal(wrong.status,400);
});
test('remote files retain private access and profile across switch, clean up after deletion',async t=>{const objects=new Map();const adapter=()=>({test:async()=>{},put:async(buffer,key)=>{objects.set(key,Buffer.from(buffer));return key},get:async key=>Readable.from([objects.get(key)]),delete:async key=>{objects.delete(key)}});const s=await boot(t,{remoteStorageAdapter:adapter}),owner=await user(s,'remote@test.local'),other=await user(s,'other-remote@test.local');s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(owner.user.id);const profile=await call(s,'/admin/remote-storage',{method:'POST',cookie:owner.cookie,body:{type:'s3',name:'Test S3',region:'auto',bucket:'test',accessKeyId:'key',secretAccessKey:'not-returned',reason:'Test cấu hình'}});assert.equal(profile.status,201,JSON.stringify(profile.body));assert.equal((await call(s,'/admin/remote-storage/active',{method:'PUT',cookie:owner.cookie,body:{id:profile.body.id,reason:'Dùng kho thử'}})).status,200);const card=await task(s,owner);const upload=await fetch(s.base+`/api/tasks/${card.id}/files`,{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/octet-stream','x-file-name':encodeURIComponent('hello.txt')},body:Buffer.from('hello remote')});assert.equal(upload.status,201);const attachment=(await upload.json()).attachment;assert.equal(objects.size,1);const url=s.base+attachment.downloadUrl;assert.equal((await fetch(url,{headers:{cookie:other.cookie}})).status,404);assert.equal(await (await fetch(url,{headers:{cookie:owner.cookie}})).text(),'hello remote');await call(s,'/admin/remote-storage/active',{method:'PUT',cookie:owner.cookie,body:{id:null,reason:'Trở lại máy chủ'}});assert.equal(await (await fetch(url,{headers:{cookie:owner.cookie}})).text(),'hello remote');assert.equal((await call(s,`/tasks/${card.id}/attachments/${attachment.id}`,{method:'DELETE',cookie:owner.cookie})).status,200);await s.app.locals.processRemoteCleanup();assert.equal(objects.size,0);assert.equal(s.db.prepare('SELECT count(*) n FROM task_file_cleanup').get().n,0);});

test('offline restore verifies hashes and restores local attachments into a private new folder',async t=>{
 const {readFileSync,rmSync}=await import('node:fs');
 const {join}=await import('node:path');
 const {restoreBackup}=await import('../scripts/restore-backup.mjs');
 const {openDatabase}=await import('./database-helpers.mjs');
 const s=await boot(t),owner=await user(s,'restore@test.local');
 s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(owner.user.id);
 const card=await task(s,owner);
 const upload=await fetch(s.base+`/api/tasks/${card.id}/files`,{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/octet-stream','x-file-name':'backup.txt'},body:'backup bytes'});
 assert.equal(upload.status,201);
 s.db.prepare('INSERT INTO password_reset_codes(user_id,email,code_hash,expires_at,created_at) VALUES (?,?,?,?,?)').run(owner.user.id,owner.user.email,'hashed-test-code',Date.now()+900000,Date.now());
 const saved=await call(s,'/admin/backups',{method:'POST',cookie:owner.cookie,body:{reason:'Test restore offline'}});
 assert.equal(saved.status,201);
 const restored=openDatabase();
 try {
   const previous=await restoreBackup({db:restored,dataDir:s.dir,backupId:saved.body.backup.id});
   assert.equal(JSON.parse(readFileSync(previous,'utf8')).format,'nhactoi-postgresql');
   assert.equal(restored.prepare("SELECT count(*) n FROM sessions WHERE expires_at>'1970-01-01T00:00:00.000Z'").get().n,0);
   assert.equal(restored.prepare('SELECT count(*) n FROM password_reset_codes').get().n,0);
   const file=restored.prepare("SELECT storage_root,storage_key FROM task_attachments WHERE kind='file'").get();
   assert.equal(readFileSync(join(file.storage_root,file.storage_key),'utf8'),'backup bytes');
   rmSync(join(file.storage_root,file.storage_key));
   // A missing current upload must not prevent recovering its saved bytes.
   await restoreBackup({db:restored,dataDir:s.dir,backupId:saved.body.backup.id});
   const recovered=restored.prepare("SELECT storage_root,storage_key FROM task_attachments WHERE kind='file'").get();
   assert.equal(readFileSync(join(recovered.storage_root,recovered.storage_key),'utf8'),'backup bytes');
 } finally {restored.close();}
});

test("remote backup captures bytes and failed migration verification queues uploaded orphan",async t=>{let failGet=false;const objects=new Map();const adapter=()=>({test:async()=>{},put:async(buffer,key)=>{objects.set(key,Buffer.from(buffer));return key},get:async key=>{if(failGet)throw new Error('simulated network failure');return Readable.from([objects.get(key)])},delete:async key=>objects.delete(key)});const s=await boot(t,{remoteStorageAdapter:adapter}),owner=await user(s,'remote-backup@test.local');s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(owner.user.id);const card=await task(s,owner);const uploaded=await fetch(s.base+`/api/tasks/${card.id}/files`,{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/octet-stream','x-file-name':'local.txt'},body:'preserve local'});assert.equal(uploaded.status,201);const id=(await uploaded.json()).attachment.id;const p=await call(s,'/admin/remote-storage',{method:'POST',cookie:owner.cookie,body:{type:'s3',name:'Test',region:'auto',bucket:'test',accessKeyId:'key',secretAccessKey:'secret',reason:'Test storage'}});await call(s,'/admin/remote-storage/active',{method:'PUT',cookie:owner.cookie,body:{id:p.body.id,reason:'Test remote'}});failGet=true;assert.equal((await call(s,'/admin/remote-storage/migrate',{method:'POST',cookie:owner.cookie,body:{reason:'Test migration fail'}})).status,502);assert.ok(!s.db.prepare('SELECT storage_root FROM task_attachments WHERE id=?').get(id).storage_root.startsWith('remote:'));assert.equal(s.db.prepare("SELECT count(*) n FROM task_file_cleanup WHERE storage_root LIKE 'remote:%'").get().n,1);await s.app.locals.processRemoteCleanup();assert.equal(objects.size,0);failGet=false;assert.equal((await call(s,'/admin/remote-storage/migrate',{method:'POST',cookie:owner.cookie,body:{reason:'Test migration success'}})).status,200);const backup=await call(s,'/admin/backups',{method:'POST',cookie:owner.cookie,body:{reason:'Test remote snapshot'}});assert.equal(backup.status,201,JSON.stringify(backup.body));const snap=inspectBackup(s.dir+'/test.sqlite',backup.body.backup.id,s.app.locals.config._settingsKey);assert.equal(snap.manifest.remoteFiles,1);assert.equal(snap.manifest.files.length,1);const {readFileSync}=await import('node:fs');assert.equal(readFileSync(snap.dir+'/'+snap.manifest.files[0].file,'utf8'),'preserve local');});
test('backup retention keeps the newest complete backups only when an admin asks for it',async t=>{
  let now=Date.parse('2026-10-22T01:00:00Z');
  const s=await boot(t,{clock:()=>new Date(now)}),admin=await user(s,'retention@test.local');
  s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(admin.user.id);
  const backup=async()=>{now+=60_000;const r=await call(s,'/admin/backups',{method:'POST',cookie:admin.cookie,body:{reason:'Kiểm thử giữ bản sao'}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.backup.id};
  const listed=async()=>(await call(s,'/admin/backups',{cookie:admin.cookie})).body;
  const {mkdirSync,readdirSync}=await import('node:fs');
  const ids=[await backup(),await backup(),await backup()];
  assert.equal((await listed()).backups.length,3,'without a limit every backup is kept');
  assert.equal((await call(s,'/admin/backups/schedule',{method:'PUT',cookie:admin.cookie,body:{enabled:false,intervalHours:24,keep:5,reason:'Giá trị lạ'}})).status,400);
  assert.equal((await call(s,'/admin/backups/schedule',{method:'PUT',cookie:admin.cookie,body:{enabled:false,intervalHours:24,keep:7,reason:'Giữ 7 bản'}})).status,200);
  assert.equal((await listed()).schedule.keep,7);
  // Saving the schedule without keep (older clients) leaves the limit alone.
  assert.equal((await call(s,'/admin/backups/schedule',{method:'PUT',cookie:admin.cookie,body:{enabled:true,intervalHours:24,reason:'Bật lịch'}})).status,200);
  assert.equal((await listed()).schedule.keep,7);
  const {pruneBackups,backupRoot}=await import('../server/backups.mjs');
  const root=backupRoot(s.dir+'/test.sqlite');
  mkdirSync(root+'/backup-unfinished.pending');
  for(let i=0;i<5;i++)ids.push(await backup());
  const kept=(await listed()).backups.map(b=>b.id);
  assert.deepEqual(kept,ids.slice(-7).reverse(),'the seven newest backups remain, newest first');
  assert.ok(readdirSync(root).includes('backup-unfinished.pending'),'a pending folder is never pruned');
  assert.deepEqual(pruneBackups(s.dir+'/test.sqlite',0),[],'0 keeps everything');
  const audit=s.db.prepare("SELECT before_json,after_json FROM admin_audit_logs WHERE action='backup.schedule' ORDER BY created_at,id").all();
  assert.equal(JSON.parse(audit[0].after_json).keep,7);
});
