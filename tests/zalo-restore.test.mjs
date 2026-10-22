import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {boot, call, user, addMember} from './roadmap-helpers.mjs';
import {createApp, openDatabase} from './database-helpers.mjs';
import {createBackup} from '../server/backups.mjs';
import {restoreBackup} from '../scripts/restore-backup.mjs';
import {outboundSendersPaused} from '../server/restore-safety.mjs';

test('TC-X11 actual OA backup/restore retains encrypted credentials, delivery history and private ACL with senders held', async t => {
  const now = '2026-10-16T03:00:00.000Z', clock = () => new Date(now);
  const sends = [], validations = [];
  let ambiguous = false;
  const transport = {
    mode: 'simulation',
    authorize: async body => ({oaId: body.oaId, apiVersion: 'SIMULATED', policyVersion: 'SIMULATED'}),
    templates: async () => [{id: 'internal', version: 'v1', status: 'approved', purpose: 'internal', parameters: ['content'], label: 'Thông báo nội bộ'}],
    recipient: async () => ({purposes: ['internal'], evidenceId: 'SIMULATED_PROOF', expiresAt: '2030-01-01T00:00:00Z'}),
    validateDelivery: async () => { validations.push('validated'); },
    send: async (_credentials, payload, {requestId}) => {
      sends.push({requestId, payload});
      if (ambiguous) throw {ambiguous: true, status: 0};
      return {status: 'accepted', messageId: 'simulated_' + requestId};
    },
    verifyCallback: async ({headers, rawBody}) => {
      const expected = createHmac('sha256', 'SIMULATED_CALLBACK_KEY').update(rawBody).digest('hex');
      const signature = headers['x-simulated-signature'] || '';
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
      return JSON.parse(rawBody.toString());
    },
  };
  const source = await boot(t, {clock, zaloOaTransport: transport});
  const owner = await user(source, 'oa-restore-owner@example.test');
  const guest = await user(source, 'oa-restore-guest@example.test');
  const revoked = await user(source, 'oa-restore-revoked@example.test');
  const outsider = await user(source, 'oa-restore-outsider@example.test');
  addMember(source, owner, guest); addMember(source, owner, revoked);
  source.db.prepare("UPDATE workspace_members SET member_type='guest' WHERE workspace_id=? AND user_id=?").run(owner.workspace.id, guest.user.id);
  source.db.prepare("UPDATE subscriptions SET plan='business',status='active',current_period_end='2035-01-01T00:00:00Z' WHERE workspace_id=?").run(owner.workspace.id);
  const request = async (path, method = 'GET', body, status = 200) => {
    const result = await call(source, path, {method, body, cookie: owner.cookie});
    assert.equal(result.status, status, path + ' ' + JSON.stringify(result.body));
    return result.body;
  };
  const project = (await request('/projects', 'POST', {name: 'OA restore private', accessMode: 'private'}, 201)).project;
  for (const actor of [guest, revoked]) await request(`/projects/${project.id}/members/${actor.user.id}`, 'PUT', {role: 'editor'});
  const oa = '/integrations/zalo-oa';
  await request(oa + '/connect', 'POST', {oaId: 'RESTORE_OA', token: 'OA_RESTORE_TOKEN_CANARY', appId: 'OA_RESTORE_APP_CANARY', oaSecretKey: 'OA_RESTORE_SECRET_CANARY', consent: true});
  await request(oa + '/templates/refresh', 'POST', {});
  await request(oa + '/recipients', 'POST', {recipient: 'SIMULATED_UID', userId: owner.user.id});
  const recipientId = (await request(oa)).recipients[0].id;
  const requests = [], deliveries = new Map();
  for (const state of ['accepted', 'read', 'unknown', 'pending']) {
    const body = {title: 'CANARY_OA_PRIVATE_' + state, projectId: project.id, assigneeId: owner.user.id, dueAt: '2026-10-20T03:00:00Z', operationId: 'oa-restore-create-' + state};
    const result = await request('/tasks', 'POST', body, 201);
    requests.push({body, result});
    const payload = {sourceKind: 'task', sourceId: result.task.id, recipientId, templateId: 'internal', purpose: 'internal', parameters: {content: 'Thông báo nội bộ: ' + state}};
    const preview = await request(oa + '/preview', 'POST', payload);
    const delivery = (await request(oa + '/deliveries', 'POST', {...payload, previewHash: preview.previewHash}, 201)).delivery;
    deliveries.set(state, delivery);
    if (state !== 'pending') {
      ambiguous = state === 'unknown';
      await source.app.locals.processZaloOa();
    }
    if (state === 'read') {
      for (const status of ['read', 'delivered']) {
        const raw = JSON.stringify({oaId: 'RESTORE_OA', eventId: 'restore-' + status, messageId: 'simulated_' + delivery.id, requestId: delivery.id, status});
        const callback = await fetch(source.base + '/api' + oa + '/callback', {method: 'POST', headers: {'content-type': 'application/json', 'x-simulated-signature': createHmac('sha256', 'SIMULATED_CALLBACK_KEY').update(raw).digest('hex')}, body: raw});
        assert.equal(callback.status, 200);
      }
    }
  }
  await request(`/projects/${project.id}/members/${revoked.user.id}`, 'DELETE');
  const tables = ['tasks', 'projects', 'project_members', 'workspace_members', 'mutation_receipts', 'business_events', 'task_assignment_cycles', 'task_reminder_responses', 'zalo_oa_connections', 'zalo_oa_templates', 'zalo_oa_recipients', 'zalo_oa_deliveries', 'zalo_oa_attempts', 'zalo_oa_callbacks'];
  const snapshot = db => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]));
  const before = snapshot(source.db);
  const secrets = source.db.prepare('SELECT key,value,encrypted FROM app_settings WHERE encrypted=1 ORDER BY key').all();
  assert.equal(secrets.filter(row => row.key.startsWith('zaloOaToken:')).length, 1);
  assert.ok(!JSON.stringify(secrets).includes('CANARY'));
  assert.deepEqual(before.zalo_oa_deliveries.map(row => row.status).sort(), ['accepted', 'pending', 'read', 'unknown']);
  assert.equal(before.zalo_oa_attempts.length, 3);
  assert.equal(before.zalo_oa_callbacks.length, 2);
  assert.equal(sends.length, 3);
  assert.equal(validations.length, 3);
  const backup = await createBackup({db: source.db, dbPath: join(source.dir, 'storage'), clock, settingsKey: source.app.locals.config._settingsKey});
  const target = openDatabase();
  await restoreBackup({db: target, dataDir: source.dir, backupId: backup.id});
  assert.equal(outboundSendersPaused(target), true);
  assert.deepEqual(snapshot(target), before);
  assert.deepEqual(target.prepare('SELECT key,value,encrypted FROM app_settings WHERE encrypted=1 ORDER BY key').all(), secrets);
  const restored = await boot(t, {db: target, dbPath: join(source.dir, 'storage'), clock, zaloOaTransport: transport});
  assert.equal((await call(restored, '/me', {cookie: owner.cookie})).status, 401);
  for (let restart = 0; restart < 2; restart++) {
    const app = createApp({db: target, dataDir: source.dir, clock, env: {NODE_ENV: 'test'}, zaloOaTransport: transport});
    try { assert.deepEqual(await app.locals.processZaloOa(), {blocked: true}); }
    finally { app.locals.close(); }
  }
  const login = async actor => {
    const result = await call(restored, '/auth/login', {method: 'POST', body: {email: actor.user.email, password: 'Password123!'}});
    assert.equal(result.status, 200);
    if (actor !== outsider) {
      const switched = await call(restored, '/workspaces/switch', {method: 'POST', cookie: result.cookie, body: {workspaceId: owner.workspace.id}});
      assert.equal(switched.status, 200);
      return switched.cookie;
    }
    return result.cookie;
  };
  const ownerCookie = await login(owner), guestCookie = await login(guest), revokedCookie = await login(revoked), outsiderCookie = await login(outsider);
  const replay = await call(restored, '/tasks', {method: 'POST', cookie: ownerCookie, body: requests[0].body});
  assert.equal(replay.status, 201); assert.deepEqual(replay.body, requests[0].result);
  const taskPath = '/tasks/' + requests[0].result.task.id;
  assert.equal((await call(restored, taskPath, {cookie: guestCookie})).status, 200);
  for (const cookie of [revokedCookie, outsiderCookie]) {
    assert.equal((await call(restored, taskPath, {cookie})).status, 404);
    assert.ok(!JSON.stringify((await call(restored, '/tasks', {cookie})).body).includes('CANARY_OA_PRIVATE'));
  }
  for (const cookie of [guestCookie, revokedCookie]) assert.equal((await call(restored, oa, {cookie})).status, 403);
  const history = await call(restored, taskPath + '/reminders', {cookie: guestCookie});
  assert.equal(history.status, 200);
  assert.equal(history.body.zaloHistory[0].status, 'accepted');
  assert.ok(!JSON.stringify(history.body).includes('SIMULATED_UID'));
  const blocked = await call(restored, oa + '/process', {method: 'POST', cookie: ownerCookie, body: {}});
  assert.equal(blocked.status, 409); assert.match(blocked.body.error, /sender đang dừng/);
  const missingKeyDir = mkdtempSync(join(tmpdir(), 'nhactoi-oa-restore-missing-key-'));
  t.after(() => rmSync(missingKeyDir, {recursive: true, force: true}));
  assert.throws(() => createApp({db: target, dataDir: missingKeyDir, clock, env: {NODE_ENV: 'test'}, zaloOaTransport: transport}), /Thiếu khóa mã hóa gốc/);
  assert.equal(existsSync(join(missingKeyDir, '.nhactoi-settings.key')), false);
  assert.throws(() => createApp({db: target, dataDir: source.dir, clock, env: {NODE_ENV: 'test', NHACTOI_SETTINGS_KEY: 'ee'.repeat(32)}, zaloOaTransport: transport}), /Không giải mã được cấu hình/);
  assert.equal(outboundSendersPaused(target), true);
  assert.deepEqual(snapshot(target), before);
  assert.equal(sends.length, 3); assert.equal(validations.length, 3);
  assert.equal(target.prepare('SELECT status FROM zalo_oa_deliveries WHERE id=?').get(deliveries.get('unknown').id).status, 'unknown');
  assert.equal(target.prepare('SELECT count(*) n FROM task_reminder_responses WHERE acknowledged_at IS NOT NULL').get().n, 0);
});
