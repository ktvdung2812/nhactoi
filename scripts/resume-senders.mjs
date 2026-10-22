// Offline-only: reconciliation must precede re-enabling restored deliveries.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server/index.mjs';
import { openDatabase, withTransaction } from '../server/db.mjs';
import { RESTORE_SENDER_HOLD } from '../server/restore-safety.mjs';

export function resumeRestoredSenders({ db, dataDir, backupId, reason, env = process.env, clock = () => new Date() }) {
  if (typeof backupId !== 'string' || !backupId || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500)
    throw new Error('Cần mã backup và lý do đối soát từ 3 đến 500 ký tự.');
  // Startup validates every encrypted setting with the original key. No
  // interval, listener or transport is started by this verification.
  let app;
  try { app = createApp({ db, dataDir, env, clock, startWorker: false }); }
  catch { throw new Error('Chưa thể bật sender: kiểm tra cấu hình và cung cấp khóa mã hóa gốc của bản sao.'); }
  try {
    return withTransaction(db, () => {
      const row = db.prepare('SELECT value FROM app_settings WHERE key=? FOR UPDATE').get(RESTORE_SENDER_HOLD);
      if (!row) throw new Error('Không có sender đang dừng do khôi phục.');
      let hold;
      try { hold = JSON.parse(row.value); } catch { throw new Error('Trạng thái khôi phục không hợp lệ; sender tiếp tục dừng.'); }
      if (hold.backupId !== backupId) throw new Error('Mã backup không khớp lần khôi phục đang chờ đối soát.');
      const resumedAt = new Date(clock()).toISOString();
      const receipt = { ...hold, resumedAt, reason: reason.trim() };
      db.prepare(`INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES ('restoreSenderResume',?,0,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,encrypted=0,updated_at=excluded.updated_at`)
        .run(JSON.stringify(receipt), resumedAt);
      db.prepare('DELETE FROM app_settings WHERE key=?').run(RESTORE_SENDER_HOLD);
      return receipt;
    });
  } finally { app.locals.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [backupId, confirmation, reason] = process.argv.slice(2);
  if (!backupId || confirmation !== '--offline-confirm-resume-senders' || !reason) {
    console.error('Usage: node --env-file-if-exists=.env scripts/resume-senders.mjs backup-ID --offline-confirm-resume-senders "Lý do đối soát"\nDừng app; kiểm tra môi trường, người nhận, pending/sent/unknown và khóa mã hóa gốc trước khi bật.');
    process.exitCode = 1;
  } else {
    const db = openDatabase(undefined, { bootstrapAdmin: false });
    try {
      resumeRestoredSenders({ db, dataDir: process.env.NHACTOI_DATA_DIR || 'data', backupId, reason });
      console.log('Đã bỏ chốt dừng sau khôi phục. Khởi động lại ứng dụng để xử lý các job còn hợp lệ.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
    finally { db.close(); }
  }
}
