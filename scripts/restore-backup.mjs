// Offline-only recovery. Never invoke from an HTTP request or a running server.
import {copyFileSync,existsSync,mkdirSync,renameSync,chmodSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {inspectBackup} from '../server/backups.mjs';
import {SCHEMA_VERSION} from '../server/db.mjs';
const [dbInput,backupId,confirmation]=process.argv.slice(2);
if(!dbInput||!backupId||confirmation!=='--offline-confirm-restore'){console.error('Usage: node scripts/restore-backup.mjs /absolute/path/database.sqlite backup-ID --offline-confirm-restore\nStop EnvKit/Node service first. Keep the settings encryption key and remote storage intact.');process.exit(1)}
const dbPath=resolve(dbInput);if(existsSync(dbPath+'-wal')||existsSync(dbPath+'-shm'))throw new Error('SQLite đang có WAL/SHM. Dừng dịch vụ và đóng kết nối cơ sở dữ liệu trước khi khôi phục.');
const {dir,manifest}=inspectBackup(dbPath,backupId);const staged=dbPath+'.restore-'+randomUUID();const fileRoot=join(dirname(dbPath),'restored-uploads-'+randomUUID());
let transactionOpen=false;let stagedPath=staged;let target=null;let fileRootCreated=false;let previousPath=null;
try{
 copyFileSync(join(dir,'database.sqlite'),stagedPath);chmodSync(stagedPath,0o600);target=new DatabaseSync(stagedPath);
 if(target.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||target.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Bản sao không toàn vẹn');
 const version=target.prepare('SELECT max(version) n FROM schema_migrations').get().n;if(version>SCHEMA_VERSION)throw new Error('Bản sao thuộc phiên bản phần mềm mới hơn');
 mkdirSync(fileRoot,{recursive:true,mode:0o700});fileRootCreated=true;
 target.exec('BEGIN IMMEDIATE');transactionOpen=true;
 for(const entry of manifest.files){
  const name=entry.file.slice(6);const targetPath=join(fileRoot,name);
  copyFileSync(join(dir,entry.file),targetPath);chmodSync(targetPath,0o600);
  const changed=target.prepare("UPDATE task_attachments SET storage_root=?,storage_key=? WHERE id=? AND kind='file'").run(fileRoot,name,entry.id);
  if(changed.changes!==1)throw new Error('Bản sao không khớp bản ghi tệp đính kèm');
 }
 target.exec('DELETE FROM sessions');if(target.prepare("SELECT 1 FROM sqlite_master WHERE name='password_reset_codes'").get())target.exec('DELETE FROM password_reset_codes');if(target.prepare("SELECT 1 FROM sqlite_master WHERE name='google_oauth_states'").get())target.exec('DELETE FROM google_oauth_states');target.exec("DELETE FROM app_settings WHERE key='backupSchedule'");target.exec('COMMIT');transactionOpen=false;target.close();target=null;
 // Preserve the previous DB and its referenced local files as a rollback point.
 if(existsSync(dbPath)){previousPath=dbPath+'.before-restore-'+Date.now()+'-'+randomUUID();renameSync(dbPath,previousPath)}
 renameSync(stagedPath,dbPath);stagedPath=null;
}catch(error){
 if(transactionOpen){try{target.exec('ROLLBACK')}catch{}}
 if(target){try{target.close()}catch{}}
 if(previousPath&& !existsSync(dbPath)&&existsSync(previousPath)){try{renameSync(previousPath,dbPath)}catch{}}
 if(stagedPath)rmSync(stagedPath,{force:true});
 if(fileRootCreated)rmSync(fileRoot,{recursive:true,force:true});
 throw error;
}
console.log('Khôi phục hoàn tất. Khởi động lại dịch vụ; mọi tài khoản cần đăng nhập lại.');
