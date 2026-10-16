import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { boot, call, user } from './roadmap-helpers.mjs';
import { openDatabase, createApp } from './database-helpers.mjs';
import { createBackup } from '../server/backups.mjs';
import { restoreBackup } from '../scripts/restore-backup.mjs';
import { resumeRestoredSenders } from '../scripts/resume-senders.mjs';
import { outboundSendersPaused, pauseRestoredSenders } from '../server/restore-safety.mjs';

test('restore holds all delivery channels and remote cleanup across restart until keyed reconciliation', async t => {
  const now = '2026-10-16T02:00:00.000Z', clock = () => new Date(now);
  const vapid = webpush.generateVAPIDKeys();
  const env = { NODE_ENV: 'test', WEB_PUSH_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_PRIVATE_KEY: vapid.privateKey, WEB_PUSH_SUBJECT: 'mailto:test@example.test' };
  const sent = { email: 0, mobile: 0, web: 0, cleanup: 0 };
  const transports = {
    reminderEmailTransport: { sendMail: async () => { sent.email++; } },
    fcmTransport: async () => { sent.mobile++; return { ok: true }; },
    webPushTransport: async () => { sent.web++; },
    remoteStorageAdapter: () => ({ delete: async () => { sent.cleanup++; } }),
  };
  const source = await boot(t, { clock, env, ...transports });
  const actor = await user(source, 'restore-channels@example.test');
  source.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(actor.user.id);
  const login = await call(source, '/mobile/auth/login', { method: 'POST', body: { email: actor.user.email, password: 'Password123!' } });
  const device = await fetch(source.base + '/api/mobile/devices/restore-fixture', { method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${login.body.token}` }, body: JSON.stringify({ fcmToken: 'restore-test-token' }) });
  assert.equal(device.status, 200);
  const key = createECDH('prime256v1'); key.generateKeys();
  assert.equal((await call(source, '/web-push/subscriptions', { cookie: actor.cookie, method: 'POST', body: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/restore-fixture',
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  } })).status, 200);
  const profile = await call(source, '/admin/remote-storage', { cookie: actor.cookie, method: 'POST', body: {
    type: 's3', name: 'Restore fixture', region: 'auto', bucket: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'canary-encrypted-restore-key', reason: 'Restore regression',
  } });
  assert.equal(profile.status, 201);
  const makeReminder = async title => {
    const response = await call(source, '/tasks', { cookie: actor.cookie, method: 'POST', body: { title, assigneeId: actor.user.id, remindAt: now } });
    assert.equal(response.status, 201);
    assert.equal(source.app.locals.processReminders().length, 1);
  };
  const flush = async app => [await app.locals.processReminderEmails(), await app.locals.processNotificationOutbox(), await app.locals.processWebPush()];
  await makeReminder('Already accepted');
  for (const result of await flush(source.app)) assert.equal(result.sent, 1);
  await makeReminder('Pending after restore');
  source.db.prepare('INSERT INTO task_file_cleanup(id,storage_root,storage_key,created_at,next_attempt_at) VALUES (?,?,?,?,?)')
    .run('remote-cleanup', 'remote:' + profile.body.id, 'original-object', now, now);
  const queues = db => Object.fromEntries(['notification_outbox', 'notification_outbox_deliveries', 'reminder_email_outbox', 'web_push_deliveries', 'task_file_cleanup'].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  const expected = queues(source.db);
  const backup = await createBackup({ db: source.db, dbPath: source.dir + '/storage', clock });
  const restored = openDatabase();
  t.after(() => restored.close());
  await restoreBackup({ db: restored, dataDir: source.dir, backupId: backup.id });
  assert.equal(outboundSendersPaused(restored), true);
  assert.deepEqual(queues(restored), expected, 'restore preserves pending and accepted delivery history');
  assert.equal(restored.prepare('SELECT count(*) n FROM sessions WHERE expires_at>?').get(now).n, 0);
  const restoredHttp = await boot(t, { db: restored, dataDir: source.dir, dbPath: source.dir + '/storage', clock, env, ...transports });
  assert.equal((await call(restoredHttp, '/me', { cookie: actor.cookie })).status, 401);
  const staleMobile = await fetch(restoredHttp.base + '/api/mobile/workspaces', { headers: { authorization: `Bearer ${login.body.token}` } });
  assert.equal(staleMobile.status, 401);
  assert.deepEqual(queues(restored), expected, 'rejected stale cookies and bearer tokens retain delivery evidence during reconciliation');
  assert.equal((await call(restoredHttp, '/auth/logout', { cookie: actor.cookie, method: 'POST' })).status, 200);
  assert.deepEqual(queues(restored), expected, 'explicit logout cannot cascade away restored delivery evidence');
  for (let restart = 0; restart < 2; restart++) {
    const app = createApp({ db: restored, dataDir: source.dir, clock, env, ...transports });
    try {
      for (const result of await flush(app)) assert.equal(result.paused, true);
      assert.deepEqual(await app.locals.processRemoteCleanup(), { paused: true });
      assert.deepEqual(queues(restored), expected, 'paused workers leave receipts, attempts and statuses untouched');
    } finally { app.locals.close(); }
  }
  assert.deepEqual(sent, { email: 1, mobile: 1, web: 1, cleanup: 0 });
  const args = { db: restored, dataDir: source.dir, backupId: backup.id, reason: 'Test environment and recipients reconciled', env, clock };
  const missingKeyDir = mkdtempSync(join(tmpdir(), 'nhactoi-restore-missing-key-'));
  t.after(() => rmSync(missingKeyDir, { recursive: true, force: true }));
  assert.throws(() => createApp({ db: restored, dataDir: missingKeyDir, clock, env }), /Thiếu khóa mã hóa gốc/);
  assert.equal(existsSync(join(missingKeyDir, '.nhactoi-settings.key')), false, 'a replacement key must never be generated over encrypted restored data');
  assert.equal(outboundSendersPaused(restored), true);
  assert.throws(() => resumeRestoredSenders({ ...args, env: { ...env, NHACTOI_SETTINGS_KEY: 'wrong-key' } }), /khóa mã hóa gốc/);
  assert.throws(() => resumeRestoredSenders({ ...args, backupId: 'wrong-backup' }), /không khớp/);
  assert.equal(outboundSendersPaused(restored), true);
  assert.deepEqual(queues(restored), expected);
  const receipt = resumeRestoredSenders(args);
  assert.equal(receipt.backupId, backup.id);
  assert.equal(receipt.resumedAt, now);
  assert.equal(outboundSendersPaused(restored), false);
  const resumed = createApp({ db: restored, dataDir: source.dir, clock, env, ...transports });
  try {
    const results = await flush(resumed);
    assert.equal(results[0].sent, 1, 'only the pending email is sent');
    assert.equal(results[1].sent, 0, 'expired mobile sessions cannot receive restored messages');
    assert.equal(results[2].sent, 0, 'expired browser sessions cannot receive restored messages');
    assert.equal(restored.prepare("SELECT count(*) n FROM notification_outbox WHERE status='sent'").get().n, 1, 'accepted aggregate receipt survives');
    await resumed.locals.processRemoteCleanup();
    assert.equal(sent.cleanup, 1);
  } finally { resumed.locals.close(); }
});

test('an in-flight email batch stops before the next delivery when recovery is paused', async t => {
  const now = '2026-10-16T02:00:00.000Z';
  let sends = 0;
  const s = await boot(t, { clock: () => new Date(now), reminderEmailTransport: { sendMail: async () => {
    sends++;
    pauseRestoredSenders(s.db, 'backup-fixture', now);
  } } });
  const actor = await user(s, 'restore-inflight@example.test');
  for (const title of ['First', 'Second']) {
    assert.equal((await call(s, '/tasks', { cookie: actor.cookie, method: 'POST', body: { title, assigneeId: actor.user.id, remindAt: now } })).status, 201);
  }
  assert.equal(s.app.locals.processReminders().length, 2);
  assert.equal((await s.app.locals.processReminderEmails()).paused, true);
  assert.equal(sends, 1);
  assert.equal(s.db.prepare("SELECT count(*) n FROM reminder_email_outbox WHERE status='pending' AND attempts=0").get().n, 1);
});
