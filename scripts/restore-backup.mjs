// Offline-only recovery. Never invoke from an HTTP request or running server.
import { copyFileSync, mkdirSync, chmodSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inspectBackup } from '../server/backups.mjs';
import { openDatabase } from '../server/db.mjs';
import { importSnapshot, exportSnapshot } from '../server/database-snapshot.mjs';

export async function restoreBackup({ db, dataDir, backupId }) {
  const storagePath = join(resolve(dataDir), 'storage');
  const { dir, manifest } = inspectBackup(storagePath, backupId);
  const snapshot = JSON.parse(readFileSync(join(dir, 'database.json'), 'utf8'));
  // Preserve the previous database and leave all of its file paths untouched.
  // Recovery must work even when the current upload bytes/remote store are lost.
  const rollbackDir = join(resolve(dataDir), 'restore-backups');
  mkdirSync(rollbackDir, { recursive: true, mode: 0o700 });
  const previous = join(rollbackDir, `before-restore-${Date.now()}-${randomUUID()}.json`);
  writeFileSync(previous, JSON.stringify(exportSnapshot(db)), { mode: 0o600 });
  const fileRoot = join(resolve(dataDir), 'restored-uploads-' + randomUUID());
  mkdirSync(fileRoot, { mode: 0o700 });
  try {
    for (const entry of manifest.files) {
      const path = join(fileRoot, entry.file.slice(6));
      copyFileSync(join(dir, entry.file), path); chmodSync(path, 0o600);
    }
    importSnapshot(db, snapshot, { replace: true, afterImport(target) {
      for (const entry of manifest.files) {
        const result = target.prepare("UPDATE task_attachments SET storage_root=?,storage_key=? WHERE id=? AND kind='file'").run(fileRoot, entry.file.slice(6), entry.id);
        if (result.changes !== 1) throw new Error('Bản sao không khớp tệp đính kèm');
      }
      target.exec("DELETE FROM sessions; DELETE FROM password_reset_codes; DELETE FROM google_oauth_states; DELETE FROM app_settings WHERE key='backupSchedule'");
    } });
    return previous;
  } catch (error) { rmSync(fileRoot, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [backupId, confirmation] = process.argv.slice(2);
  if (!backupId || confirmation !== '--offline-confirm-restore') {
    console.error('Usage: npm run db:restore -- backup-ID --offline-confirm-restore\nStop the app first. Set DATABASE_URL and NHACTOI_DATA_DIR; keep the settings encryption key.');
    process.exitCode = 1;
  } else {
    const db = openDatabase(undefined, { bootstrapAdmin: false });
    try {
      const previous = await restoreBackup({ db, dataDir: process.env.NHACTOI_DATA_DIR || 'data', backupId });
      console.log(`Khôi phục hoàn tất. Bản trước khi khôi phục: ${previous}. Mọi tài khoản cần đăng nhập lại.`);
    } finally { db.close(); }
  }
}
