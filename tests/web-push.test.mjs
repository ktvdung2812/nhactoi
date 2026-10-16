import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { boot, call, user, task, addMember } from './roadmap-helpers.mjs';
import { processWebPush, validatePushSubscription, validPushEndpoint, webPushConfig } from '../server/web-push.mjs';
import { migrateDatabase } from './database-helpers.mjs';

const vapid = webpush.generateVAPIDKeys();
const env = { NODE_ENV: 'test', FRONTEND_ORIGIN: 'http://localhost:5173', WEB_PUSH_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_PRIVATE_KEY: vapid.privateKey, WEB_PUSH_SUBJECT: 'mailto:admin@example.test' };
const subscription = (name = 'device') => { const key = createECDH('prime256v1'); key.generateKeys(); return { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; };
const register = (s, actor, sub) => call(s, '/web-push/subscriptions', { cookie: actor.cookie, method: 'POST', body: sub });
function notice(s, actor, card, id, type = 'task_update') {
  s.db.prepare('INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, actor.workspace.id, actor.user.id, card?.id || null, type, 'Private title', 'Secret description', card ? 'task' : 'calendar_event', card?.id || null, new Date(s.app.locals.clock()).toISOString());
}

test('push config validates a matching VAPID pair; endpoint and key validation rejects SSRF and malformed input', () => {
  assert.equal(webPushConfig({}).enabled, false);
  assert.equal(webPushConfig(env).enabled, true);
  assert.equal(webPushConfig({ ...env, WEB_PUSH_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey }).enabled, false);
  const sub = subscription(); assert.deepEqual(validatePushSubscription(sub), sub);
  for (const endpoint of ['http://fcm.googleapis.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com.evil.test/a', 'https://fcm.googleapis.com@evil.test/a', 'https://fcm.googleapis.com:8443/a', 'https://fcm.googleapis.com/a#fragment', 'https://evil.notify.windows.com.evil.test/a']) assert.equal(validPushEndpoint(endpoint), false, endpoint);
  for (const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2-bl2p.notify.windows.com/x']) assert.equal(validPushEndpoint(endpoint), true);
  for (const keys of [{ p256dh: sub.keys.p256dh, auth: 'x' }, { p256dh: Buffer.alloc(65).toString('base64url'), auth: sub.keys.auth }]) assert.throws(() => validatePushSubscription({ ...sub, keys }));
});

test('subscriptions are user/session scoped, persist across workspace switch, and cascade on logout', async t => {
  const s = await boot(t, { env }), owner = await user(s, 'push-owner@test.local'), other = await user(s, 'push-other@test.local');
  const config = await call(s, '/web-push/config', { cookie: owner.cookie });
  assert.deepEqual(config.body, { enabled: true, publicKey: vapid.publicKey });
  const sub = subscription('scope');
  assert.equal((await register(s, owner, sub)).status, 200);
  assert.equal((await register(s, owner, sub)).status, 200);
  assert.equal((await register(s, other, sub)).status, 409);
  const status = actor => call(s, '/web-push/subscription/status', { cookie: actor.cookie, method: 'POST', body: { endpoint: sub.endpoint } });
  assert.equal((await status(owner)).body.subscribed, true); assert.equal((await status(other)).body.subscribed, false);
  await call(s, '/web-push/subscriptions', { cookie: other.cookie, method: 'DELETE', body: { endpoint: sub.endpoint } });
  assert.equal((await status(owner)).body.subscribed, true);
  addMember(s, other, owner);
  const before = s.db.prepare('SELECT id,session_id FROM web_push_subscriptions').get();
  const switched = await call(s, '/workspaces/switch', { cookie: owner.cookie, method: 'POST', body: { workspaceId: other.workspace.id } });
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  const after = s.db.prepare('SELECT id,session_id FROM web_push_subscriptions').get();
  assert.equal(after.id, before.id); assert.notEqual(after.session_id, before.session_id);
  assert.equal((await status({ ...owner, cookie: switched.cookie })).body.subscribed, true);
  await call(s, '/auth/logout', { cookie: switched.cookie, method: 'POST' });
  assert.equal(s.db.prepare('SELECT count(*) n FROM web_push_subscriptions').get().n, 0);
  assert.equal(s.db.prepare("SELECT count(*) n FROM web_push_subscriptions p LEFT JOIN sessions s ON s.id=p.session_id WHERE s.id IS NULL").get().n, 0);
});

test('delivery retries only failed browsers, is serialized, deduplicates, and has generic payloads', async t => {
  let now = new Date('2026-10-01T03:00:00Z');
  const s = await boot(t, { env, clock: () => now }), owner = await user(s, 'retry@test.local'), card = await task(s, owner);
  notice(s, owner, card, 'before-subscription');
  const one = subscription('one'), two = subscription('two');
  await register(s, owner, one); await register(s, owner, two);
  assert.equal(s.db.prepare('SELECT count(*) n FROM web_push_deliveries').get().n, 0);
  notice(s, owner, card, 'new-notice');
  const sends = [];
  let fail = true;
  const transport = async (sub, payload) => {
    sends.push([sub.endpoint, payload]);
    await new Promise(resolve => setTimeout(resolve, 5));
    if (sub.endpoint === two.endpoint && fail) throw { statusCode: 503, message: 'contains endpoint secret' };
  };
  await Promise.all([processWebPush({ db: s.db, clock: () => now, transport }), processWebPush({ db: s.db, clock: () => now, transport })]);
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[0][1], { notificationId: 'new-notice' });
  assert.equal(s.db.prepare("SELECT last_error FROM web_push_deliveries WHERE status='pending'").get().last_error, 'HTTP 503');
  await processWebPush({ db: s.db, clock: () => now, transport }); assert.equal(sends.length, 2);
  now = new Date(now.getTime() + 61000); fail = false;
  await processWebPush({ db: s.db, clock: () => now, transport });
  assert.equal(sends.length, 3); assert.equal(sends[2][0], two.endpoint);
  await processWebPush({ db: s.db, clock: () => now, transport }); assert.equal(sends.length, 3);
  const resolved = await call(s, '/web-push/notifications/new-notice', { cookie: owner.cookie });
  assert.equal(resolved.body.path, `/tasks/${card.id}`);
  assert.equal(resolved.body.workspaceId, owner.workspace.id);
});

test('delivery rechecks completion, permission and session revocation; invalid endpoint is removed', async t => {
  const now = new Date('2026-10-01T03:00:00Z');
  const s = await boot(t, { env, clock: () => now }), owner = await user(s, 'revoked@test.local'), other = await user(s, 'revoked-other@test.local'), card = await task(s, owner);
  await register(s, owner, subscription('revoked'));
  let sent = 0;
  const run = transport => processWebPush({ db: s.db, clock: () => now, transport: transport || (async () => { sent++; }) });
  notice(s, owner, card, 'completed', 'task_reminder');
  await call(s, `/tasks/${card.id}`, { cookie: owner.cookie, method: 'PATCH', body: { status: 'done' } });
  await run(); assert.equal(sent, 0);
  assert.equal((await call(s, '/web-push/notifications/completed', { cookie: other.cookie })).status, 404);
  await call(s, `/tasks/${card.id}`, { cookie: owner.cookie, method: 'PATCH', body: { status: 'todo' } });
  notice(s, owner, card, 'snoozed', 'task_reminder');
  await call(s, `/tasks/${card.id}/reminders/snooze`, { cookie: owner.cookie, method: 'POST', body: { minutes: 60 } });
  assert.equal(s.db.prepare('SELECT status FROM web_push_deliveries WHERE notification_id=?').get('snoozed').status, 'skipped');
  notice(s, owner, card, 'changed-due', 'task_reminder');
  await call(s, `/tasks/${card.id}`, { cookie: owner.cookie, method: 'PATCH', body: { dueAt: '2030-01-02T10:00:00Z' } });
  assert.equal(s.db.prepare('SELECT status FROM web_push_deliveries WHERE notification_id=?').get('changed-due').status, 'skipped');
  notice(s, owner, card, 'suspended');
  s.db.prepare('UPDATE workspaces SET suspended_at=? WHERE id=?').run(now.toISOString(), owner.workspace.id);
  await run(); assert.equal(sent, 0);
  s.db.prepare('UPDATE workspaces SET suspended_at=NULL WHERE id=?').run(owner.workspace.id);
  notice(s, owner, card, 'gone');
  await run(async () => { throw { statusCode: 410 }; });
  assert.equal(s.db.prepare('SELECT count(*) n FROM web_push_subscriptions').get().n, 0);
  await register(s, owner, subscription('expired'));
  notice(s, owner, card, 'expired-session');
  s.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run('2020-01-01T00:00:00Z', owner.user.id);
  await run(); assert.equal(sent, 0);
});

test("[SQLite legacy] migration 31 is additive, replayable, and preserves existing notifications without sending history", async t => {
  const s = await boot(t, { env }), owner = await user(s, 'migration31@test.local'), card = await task(s, owner);
  s.db.exec('DROP TRIGGER notifications_web_push_ai; DROP TRIGGER web_push_task_reset; DROP TRIGGER web_push_snooze; DROP TRIGGER web_push_event_reset; DROP TABLE web_push_deliveries; DROP TABLE web_push_subscriptions; DELETE FROM schema_migrations WHERE version=31;');
  notice(s, owner, card, 'historical');
  migrateDatabase(s.db); migrateDatabase(s.db);
  assert.equal(s.db.prepare('SELECT count(*) n FROM notifications WHERE id=?').get('historical').n, 1);
  await register(s, owner, subscription('migrated'));
  assert.equal(s.db.prepare('SELECT count(*) n FROM web_push_deliveries').get().n, 0);
  assert.equal(s.db.prepare("SELECT count(*) n FROM web_push_subscriptions p LEFT JOIN sessions s ON s.id=p.session_id WHERE s.id IS NULL").get().n, 0);
});

test('event and renewal pushes resolve targets and skip rescheduled, archived or inaccessible data', async t => {
  const now = new Date('2026-10-01T03:00:00Z');
  const sends = [];
  const s = await boot(t, { env, clock: () => now, webPushTransport: async (sub, payload) => { sends.push(payload); } });
  const owner = await user(s, 'events-push@test.local');
  await register(s, owner, subscription('events'));
  const event = await call(s, '/calendar-events', { cookie: owner.cookie, method: 'POST', body: { title: 'Hẹn', startsAt: '2026-10-01T04:00:00Z', endsAt: '2026-10-01T05:00:00Z', remindAt: '2026-10-01T03:00:00Z' } });
  assert.equal(event.status, 201);
  const service = await call(s, '/services', { cookie: owner.cookie, method: 'POST', body: { name: 'Gia hạn', nextDate: '2026-10-02', remindDays: 7 } });
  assert.equal(service.status, 201);
  s.db.prepare('INSERT INTO notifications(id,workspace_id,user_id,type,title,message,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('event-push', owner.workspace.id, owner.user.id, 'calendar_event', 'Hẹn', '', 'calendar_event', event.body.id, now.toISOString());
  s.app.locals.processServiceReminders();
  const renewal = s.db.prepare("SELECT * FROM notifications WHERE type='service_renewal'").get();
  assert.ok(renewal);
  assert.equal((await call(s, '/web-push/notifications/event-push', { cookie: owner.cookie })).body.path, `/tasks?event=${event.body.id}`);
  assert.equal((await call(s, `/web-push/notifications/${renewal.id}`, { cookie: owner.cookie })).body.path, `/services?service=${service.body.service.id}`);
  assert.equal((await s.app.locals.processWebPush()).sent, 2);
  // New queued copies become invalid when their underlying entities change.
  s.db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,type,title,message,entity_type,entity_id,created_at)
    SELECT id||'_queued',workspace_id,user_id,type,title,message,entity_type,entity_id,created_at FROM notifications WHERE id IN (?,?)`).run('event-push',renewal.id);
  await call(s, `/calendar-events/${event.body.id}/status`, { cookie: owner.cookie, method: 'PATCH', body: { status: 'done' } });
  await call(s, `/services/${service.body.service.id}/renew`, { cookie: owner.cookie, method: 'POST', body: { expectedDate: '2026-10-02' } });
  assert.equal((await s.app.locals.processWebPush()).skipped, 2);
  assert.equal(sends.length, 2);
  s.db.prepare("UPDATE web_push_deliveries SET status='pending' WHERE notification_id='event-push'").run();
  s.db.prepare("UPDATE calendar_events SET starts_at='2026-10-01T04:30:00.000Z' WHERE id=?").run(event.body.id);
  assert.equal(s.db.prepare("SELECT status FROM web_push_deliveries WHERE notification_id='event-push'").get().status, 'skipped');
  assert.equal((await call(s, '/web-push/notifications/event-push', { cookie: owner.cookie })).status, 404);
});

test('queued recipients are rechecked after each network call; retries stop after five attempts', async t => {
  let now = new Date('2026-10-01T03:00:00Z');
  const s = await boot(t, { env, clock: () => now }), owner = await user(s, 'inflight@test.local'), card = await task(s, owner);
  await register(s, owner, subscription('inflight-one')); await register(s, owner, subscription('inflight-two'));
  notice(s, owner, card, 'inflight');
  let sends = 0;
  await processWebPush({ db: s.db, clock: () => now, transport: async () => { sends++; s.db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner.user.id); } });
  assert.equal(sends, 1);
  const login = await call(s, '/auth/login', { method: 'POST', body: { email: 'inflight@test.local', password: 'Password123!' } });
  owner.cookie = login.cookie;
  await register(s, owner, subscription('retry-limit'));
  notice(s, owner, card, 'retry-limit');
  for (let n = 0; n < 5; n++) {
    await processWebPush({ db: s.db, clock: () => now, transport: async () => { throw { statusCode: 429 }; } });
    now = new Date(now.getTime() + 3600000);
  }
  const row = s.db.prepare('SELECT status,attempts FROM web_push_deliveries WHERE notification_id=?').get('retry-limit');
  assert.equal(row.status, 'failed'); assert.equal(row.attempts, 5);
});
