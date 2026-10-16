import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { boot, call, user } from './roadmap-helpers.mjs';
import { DEFAULT_REMINDER_POLICY } from '../server/reminder-workflow.mjs';
import { migrateDatabase, SCHEMA_VERSION, withTransaction } from './database-helpers.mjs';

async function registerDevices(s, actor) {
  const login = await call(s, '/mobile/auth/login', { method: 'POST', body: { email: actor.user.email, password: 'Password123!' } });
  const response = await fetch(s.base + '/api/mobile/devices/' + actor.user.id, { method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${login.body.token}` },
    body: JSON.stringify({ fcmToken: `fixture-${actor.user.id}` }) });
  assert.equal(response.status, 200);
}

for (const prefix of ['', '[SQLite legacy] ']) test(prefix + 'source migration preserves rows and backfills only unambiguous delivery claims', async t => {
  const s = await boot(t), actor = await user(s, 'migration@source.test');
  const task = (await call(s, '/tasks', { method: 'POST', cookie: actor.cookie, body: { title: 'Keep me' } })).body.task;
  for (const [id, createdAt] of [['known', '2026-10-01T00:00:00Z'], ['ambiguous', '2026-10-02T00:00:00Z']]) {
    s.db.prepare("INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at) VALUES (?,?,?,?,'task_reminder','Reminder','Due',?)").run(id, actor.workspace.id, actor.user.id, task.id, createdAt);
    for (const key of id === 'known' ? ['2026-10-01T00:00:00Z'] : ['checklist:a:2026-10-02', 'checklist:b:2026-10-02'])
      s.db.prepare('INSERT INTO task_reminder_deliveries(id,task_id,user_id,schedule_key,created_at) VALUES(?,?,?,?,?)').run(id + key, task.id, actor.user.id, key, createdAt);
  }
  s.db.exec('ALTER TABLE reminder_notice_context DROP COLUMN schedule_key');
  if (s.db.dialect === 'postgres') {
    // This fixture removes the source-context column only; newer migrations
    // remain installed. Replay migration 002, not the application's latest DDL.
    const sourceMigration = readFileSync(new URL('../server/migrations/postgres/002-reminder-source.sql', import.meta.url), 'utf8');
    s.db.exec(sourceMigration);
  } else s.db.prepare('DELETE FROM schema_migrations WHERE version=?').run(SCHEMA_VERSION);
  migrateDatabase(s.db); migrateDatabase(s.db);
  assert.equal(s.db.prepare('SELECT schedule_key FROM reminder_notice_context WHERE notification_id=?').get('known').schedule_key, '2026-10-01T00:00:00Z');
  assert.equal(s.db.prepare('SELECT schedule_key FROM reminder_notice_context WHERE notification_id=?').get('ambiguous').schedule_key, 'legacy:unknown');
  assert.equal(s.db.prepare('SELECT title FROM tasks WHERE id=?').get(task.id).title, 'Keep me');
  assert.equal(s.db.prepare('SELECT count(*) n FROM notifications').get().n, 2);
});

test('quiet batches defer email and FCM without retry failures or starving other workspaces', { timeout: 180000 }, async t => {
  let now = '2026-10-03T01:59:00.000Z';
  const emails = [], pushes = [];
  const s = await boot(t, { clock: () => new Date(now), reminderEmailTransport: { sendMail: async mail => emails.push(mail) },
    fcmTransport: async push => { pushes.push(push); return { ok: true }; } });
  const quiet = await user(s, 'quiet@delivery.test'), ready = await user(s, 'ready@delivery.test');
  for (const actor of [quiet, ready]) await registerDevices(s, actor);
  const makeTask = async actor => (await call(s, '/tasks', { method: 'POST', cookie: actor.cookie,
    body: { title: 'Reminder', assigneeId: actor.user.id } })).body.task;
  const quietTask = await makeTask(quiet), readyTask = await makeTask(ready);
  const insert = s.db.prepare("INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at) VALUES (?,?,?,?,'task_reminder','Reminder','Due',?)");
  withTransaction(s.db, () => {
    for (let i = 0; i < 100; i++) insert.run('quiet_' + i, quiet.workspace.id, quiet.user.id, quietTask.id, now);
  });
  now = '2026-10-03T02:00:01.000Z';
  insert.run('ready_notice', ready.workspace.id, ready.user.id, readyTask.id, now);
  assert.equal((await call(s, '/reminder-policy', { method: 'PUT', cookie: quiet.cookie,
    body: { ...DEFAULT_REMINDER_POLICY, quietStart: '09:00', quietEnd: '10:00' } })).status, 200);
  now = '2026-10-03T02:30:00.000Z';
  assert.equal((await s.app.locals.processReminderEmails()).sent, 0);
  assert.equal((await s.app.locals.processNotificationOutbox()).failed, 0);
  assert.equal(s.db.prepare("SELECT count(*) n FROM notification_outbox WHERE attempts<>0").get().n, 0);
  // The next worker tick is after the defer interval, not an immediate rerun.
  now = '2026-10-03T02:31:00.000Z';
  assert.equal((await s.app.locals.processReminderEmails()).sent, 1);
  assert.equal((await s.app.locals.processNotificationOutbox()).sent, 1);
  assert.equal(emails[0].to, ready.user.email);
  assert.equal(pushes[0].outbox.notification_id, 'ready_notice');
  assert.equal(s.db.prepare("SELECT count(*) n FROM reminder_email_outbox WHERE notification_id LIKE 'quiet_%' AND attempts=0 AND next_attempt_at>=?").get(now).n, 100);
  now = '2026-10-03T03:00:00.000Z';
  assert.equal((await s.app.locals.processReminderEmails()).sent, 100);
  assert.equal((await s.app.locals.processNotificationOutbox()).sent, 100);
});

test('email, mobile and browser push revalidate canceled schedules and completed/deleted/reassigned checklist sources', async t => {
  let now = '2026-10-03T02:00:00.000Z', fail = false;
  const sent = { email: 0, mobile: 0, web: 0 };
  const send = channel => async () => { if (fail) throw new Error('temporary failure'); sent[channel]++; return { ok: true }; };
  const vapid = webpush.generateVAPIDKeys();
  const s = await boot(t, { clock: () => new Date(now),
    env: { NODE_ENV: 'test', WEB_PUSH_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_PRIVATE_KEY: vapid.privateKey, WEB_PUSH_SUBJECT: 'mailto:test@example.test' },
    reminderEmailTransport: { sendMail: send('email') }, fcmTransport: send('mobile'), webPushTransport: send('web') });
  const actor = await user(s, 'sources@delivery.test');
  await registerDevices(s, actor);
  const key = createECDH('prime256v1'); key.generateKeys();
  assert.equal((await call(s, '/web-push/subscriptions', { method: 'POST', cookie: actor.cookie, body: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/source-fixture',
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  } })).status, 200);
  const flush = async () => [await s.app.locals.processReminderEmails(), await s.app.locals.processNotificationOutbox(), await s.app.locals.processWebPush()];
  const patch = async (path, body, method = 'PATCH') => {
    const r = await call(s, path, { method, cookie: actor.cookie, body }); assert.ok(r.status < 300, JSON.stringify(r.body)); return r.body;
  };
  const makeTask = async remindAt => (await patch('/tasks', { title: 'Source task', assigneeId: actor.user.id, remindAt }, 'POST')).task;
  for (const remindAt of [null, '2026-10-04T01:00:00.000Z']) {
    const task = await makeTask(now);
    assert.equal(s.app.locals.processReminders().length, 1);
    await patch(`/tasks/${task.id}`, { remindAt });
    for (const result of await flush()) assert.equal(result.sent, 0);
  }
  for (const change of [{ completed: true }, { remindAt: null }, { remindAt: '2026-10-04T01:00:00.000Z' }, { assigneeIds: [] }, 'delete']) {
    const task = await makeTask(null);
    const base = `/tasks/${task.id}/checklists`;
    const list = (await patch(base, { title: 'Steps' }, 'POST')).checklist;
    const item = (await patch(`${base}/${list.id}/items`, { title: 'Step' }, 'POST')).item;
    const path = `${base}/${list.id}/items/${item.id}`;
    await patch(path, { assigneeIds: [actor.user.id], remindAt: now });
    assert.equal(s.app.locals.processReminders().length, 1);
    await patch(path, change === 'delete' ? undefined : change, change === 'delete' ? 'DELETE' : 'PATCH');
    for (const result of await flush()) assert.equal(result.sent, 0);
  }
  assert.deepEqual(sent, { email: 0, mobile: 0, web: 0 });
  // Revalidate retries as well as initial sends.
  const retry = await makeTask(now); s.app.locals.processReminders(); fail = true;
  for (const result of await flush()) assert.equal(result.failed, 1);
  fail = false; await patch(`/tasks/${retry.id}`, { remindAt: null });
  now = '2026-10-03T02:05:00.000Z';
  for (const result of await flush()) assert.equal(result.sent, 0);
  // No deadline is required for a valid explicit reminder or a send-test.
  const valid = await makeTask(now); s.app.locals.processReminders();
  for (const result of await flush()) assert.equal(result.sent, 1);
  await patch(`/tasks/${valid.id}/reminders/test`, {}, 'POST');
  for (const result of await flush()) assert.equal(result.sent, 1);
  assert.deepEqual(sent, { email: 2, mobile: 2, web: 2 });
});

test('mobile skips a calendar reminder retry after the event is completed', async t => {
  let now = '2026-10-03T02:00:00.000Z';
  let failing = true;
  let delivered = 0;
  const s = await boot(t, {
    clock: () => new Date(now),
    fcmTransport: async () => {
      if (failing) throw new Error('temporary transport failure');
      delivered++;
      return { ok: true };
    },
  });
  const actor = await user(s, 'calendar-retry-complete@delivery.test');
  await registerDevices(s, actor);
  const event = await call(s, '/calendar-events', {
    method: 'POST',
    cookie: actor.cookie,
    body: {
      title: 'Lịch hẹn hoàn tất',
      startsAt: '2026-10-03T03:00:00.000Z',
      endsAt: '2026-10-03T04:00:00.000Z',
      remindAt: now,
    },
  });
  assert.equal(event.status, 201, JSON.stringify(event.body));
  assert.equal(s.app.locals.processEventReminders(), 1);
  assert.equal((await s.app.locals.processNotificationOutbox()).failed, 1);
  const completed = await call(s, `/calendar-events/${event.body.id}/status`, {
    method: 'PATCH',
    cookie: actor.cookie,
    body: { status: 'done' },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  now = '2026-10-03T02:00:10.000Z';
  failing = false;
  const retry = await s.app.locals.processNotificationOutbox();
  assert.equal(retry.sent, 0);
  assert.equal(retry.skipped, 1);
  assert.equal(delivered, 0);
});
