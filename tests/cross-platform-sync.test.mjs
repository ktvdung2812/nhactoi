import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import pg from 'pg';
import { boot, user, task } from './roadmap-helpers.mjs';
import { workspaceSeatCount } from '../server/workspace-seats.mjs';

const clock = () => new Date('2026-09-22T04:00:00Z');
async function request(s, path, auth, method = 'GET', body) {
  const response = await fetch(`${s.base}/api${path}`, {
    method, headers: { 'content-type': 'application/json', ...auth },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function clients(s, email) {
  const owner = await user(s, email);
  const login = await request(s, '/mobile/auth/login', {}, 'POST', { email, password: 'Password123!' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { owner, web: { cookie: owner.cookie }, mobile: { authorization: `Bearer ${login.body.token}` } };
}

test('web and mobile see shared changes and reject stale task, appointment and renewal drafts', async t => {
  const s = await boot(t, { clock }), { owner, web, mobile } = await clients(s, 'sync-drafts@example.test');
  const original = await task(s, owner);
  assert.ok(original.revision);
  assert.equal((await request(s, `/tasks/${original.id}`, mobile)).body.task.revision, original.revision);
  const moved = await request(s, `/tasks/${original.id}`, mobile, 'PATCH', { status: 'done' });
  assert.equal(moved.status, 200);
  const stale = await request(s, `/tasks/${original.id}`, web, 'PATCH', { title: 'Stale web edit', status: 'todo', expectedRevision: original.revision });
  assert.equal(stale.status, 409);
  assert.equal((await request(s, `/tasks/${original.id}`, web)).body.task.status, 'done');
  const saved = await request(s, `/tasks/${original.id}`, web, 'PATCH', { title: 'Fresh web edit', expectedRevision: moved.body.task.revision });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await request(s, `/tasks/${original.id}`, mobile)).body.task.title, 'Fresh web edit');

  const eventBody = { title: 'Meeting', startsAt: '2026-09-23T04:00:00Z', endsAt: '2026-09-23T05:00:00Z', status: 'todo' };
  const created = await request(s, '/calendar-events', web, 'POST', eventBody);
  assert.equal(created.status, 201);
  const eventPath = `/calendar-events/${created.body.id}`;
  const event = (await request(s, eventPath, mobile)).body.event;
  assert.equal((await request(s, `${eventPath}/status`, web, 'PATCH', { status: 'done' })).status, 200);
  assert.equal((await request(s, eventPath, mobile, 'PUT', { ...eventBody, title: 'Old phone draft', expectedRevision: event.revision })).status, 409);
  assert.equal((await request(s, eventPath, mobile)).body.event.status, 'done');

  const service = (await request(s, '/services', web, 'POST', { name: 'License', nextDate: '2026-09-25', amount: 200 })).body.service;
  assert.equal((await request(s, `/services/${service.id}/renew`, mobile, 'POST', { expectedDate: service.nextDate })).status, 200);
  assert.equal((await request(s, `/services/${service.id}`, web, 'PATCH', { name: 'Old draft', nextDate: service.nextDate, expectedRevision: service.revision })).status, 409);
  const currentService = (await request(s, `/services/${service.id}`, web)).body.service;
  assert.equal(currentService.nextDate, '2027-09-25');
  const calendar = (await request(s, '/calendar-events', mobile)).body.events;
  assert.equal(calendar.find(e => e.service_id === service.id).starts_at, '2027-09-25T01:00:00.000Z');
  assert.equal((await request(s, `/services/${service.id}/history`, web)).body.history.length, 1);

  s.db.prepare("INSERT INTO notifications(id,workspace_id,user_id,type,title,message,created_at) VALUES (?,?,?,'test','Shared notice','body',?)")
    .run('notice_sync', owner.workspace.id, owner.user.id, clock().toISOString());
  assert.equal((await request(s, '/mobile/notifications/notice_sync/read', mobile, 'PATCH')).status, 200);
  assert.ok((await request(s, '/notifications', web)).body.notifications.find(n => n.id === 'notice_sync').readAt);
});

test('independent API processes reserve the last seat once and serialize accept, revoke and downgrade', async t => {
  const s = await boot(t, { clock }), { owner, web } = await clients(s, 'seats-owner@example.test');
  s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(owner.user.id);
  const member = await user(s, 'seats-member@example.test');
  s.db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'member',?)")
    .run(owner.workspace.id, member.user.id, clock().toISOString());
  const first = await instance(t, s, 'seats_first'), second = await instance(t, s, 'seats_second');
  const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await control.connect();
  t.after(() => control.end());
  await control.query(`SET search_path TO "${s.db.schema}"`);
  async function overlap(calls, catalog = false) {
    await control.query('BEGIN');
    if (catalog) await control.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()), 31002)');
    else await control.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [owner.workspace.id]);
    const pending = calls();
    try {
      const deadline = Date.now() + 10000;
      while (true) {
        const result = await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'", [[first.applicationName, second.applicationName]]);
        if (result.rows[0].n === 2) break;
        assert.ok(Date.now() < deadline, 'both requests must wait on the same workspace lock');
        await delay(20);
      }
    } finally { await control.query('COMMIT'); }
    return Promise.all(pending);
  }
  const invitations = await overlap(() => [
    request(first, '/invitations', web, 'POST', { email: 'seats-first@example.test' }),
    request(second, '/invitations', web, 'POST', { email: 'seats-second@example.test' }),
  ]);
  assert.deepEqual(invitations.map(r => r.status).sort(), [201, 409]);
  assert.equal(workspaceSeatCount(s.db, owner.workspace.id, clock().toISOString()), 3);
  const token = new URL(invitations.find(r => r.status === 201).body.inviteUrl).searchParams.get('invite');
  const pending = s.db.prepare('SELECT id,email FROM invitations WHERE workspace_id=?').get(owner.workspace.id);
  const race = await overlap(() => [
    request(first, '/invitations/accept', {}, 'POST', { token, name: 'Invited member', password: 'Password123!' }),
    request(second, `/invitations/${pending.id}`, web, 'DELETE'),
  ]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  const joined = s.db.prepare('SELECT 1 FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND u.email=?')
    .get(owner.workspace.id, pending.email);
  assert.equal(Boolean(joined), race[0].status === 200);
  assert.equal(workspaceSeatCount(s.db, owner.workspace.id, clock().toISOString()), joined ? 3 : 2);
  // Start the downgrade race with exactly three occupied/reserved seats.
  if (!joined) assert.equal((await request(s, '/invitations', web, 'POST', { email: 'seats-reserved@example.test' })).status, 201);
  s.db.prepare("UPDATE subscriptions SET plan='team' WHERE workspace_id=?").run(owner.workspace.id);
  const downgrade = await overlap(() => [
    request(first, `/admin/subscriptions/${owner.workspace.id}`, web, 'PATCH', { plan: 'starter', reason: 'Concurrent downgrade' }),
    request(second, '/invitations', web, 'POST', { email: 'seats-extra@example.test' }),
  ]);
  assert.ok((downgrade[0].status === 200 && downgrade[1].status === 409)
    || (downgrade[0].status === 409 && downgrade[1].status === 201), JSON.stringify(downgrade));
  const plan = s.db.prepare('SELECT plan FROM subscriptions WHERE workspace_id=?').get(owner.workspace.id).plan;
  assert.equal(workspaceSeatCount(s.db, owner.workspace.id, clock().toISOString()), plan === 'starter' ? 3 : 4);
  s.db.prepare("DELETE FROM invitations WHERE workspace_id=? AND email='seats-extra@example.test'").run(owner.workspace.id);
  s.db.prepare("UPDATE subscriptions SET plan='team' WHERE workspace_id=?").run(owner.workspace.id);
  const catalog = await overlap(() => [
    request(first, `/admin/subscriptions/${owner.workspace.id}`, web, 'PATCH', { plan: 'starter', reason: 'Switch during catalog edit' }),
    request(second, '/admin/plans/starter', web, 'PATCH', { seats: 2, reason: 'Reduce catalog seats' }),
  ], true);
  assert.deepEqual(catalog.map(r => r.status).sort(), [200, 409]);
  const currentPlan = s.db.prepare('SELECT plan FROM subscriptions WHERE workspace_id=?').get(owner.workspace.id).plan;
  const currentCatalog = JSON.parse(s.db.prepare("SELECT value FROM app_settings WHERE key='plans'").get()?.value || 'null');
  assert.ok(workspaceSeatCount(s.db, owner.workspace.id, clock().toISOString()) <= (currentCatalog || s.app.locals.config.plans).find(p => p.id === currentPlan).memberLimit);
  const edits = await overlap(() => [
    request(first, '/admin/plans/team', web, 'PATCH', { name: 'Team renamed', reason: 'First catalog edit' }),
    request(second, '/admin/plans/business', web, 'PATCH', { name: 'Business renamed', reason: 'Second catalog edit' }),
  ], true);
  assert.deepEqual(edits.map(r => r.status), [200, 200]);
  const renamed = JSON.parse(s.db.prepare("SELECT value FROM app_settings WHERE key='plans'").get().value);
  assert.equal(renamed.find(p => p.id === 'team').name, 'Team renamed');
  assert.equal(renamed.find(p => p.id === 'business').name, 'Business renamed');
});

async function instance(t, s, suffix) {
  const applicationName = `${s.db.schema}_${suffix}`;
  const child = fork(new URL('./fixtures/sync-server.mjs', import.meta.url), [s.db.schema, join(s.dir, 'test.sqlite'), applicationName], { silent: true });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.send('close');
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(kill);
  });
  const ready = await Promise.race([
    once(child, 'message').then(([value]) => value),
    once(child, 'exit').then(() => { throw new Error(`Sync API failed: ${errors}`); }),
  ]);
  return { base: `http://127.0.0.1:${ready.port}`, applicationName };
}

test('independent API processes cannot claim the last login quota slot twice', async t => {
  const s = await boot(t, { clock });
  for (let index = 0; index < 29; index++) {
    assert.equal((await request(s, '/auth/login', {}, 'POST', {
      email: `quota-${index}@example.test`, password: 'wrong',
    })).status, 401);
  }
  const first = await instance(t, s, 'login_web'), second = await instance(t, s, 'login_mobile');
  const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await control.connect();
  try {
    await control.query(`SET search_path TO "${s.db.schema}"`);
    await control.query('BEGIN');
    await control.query("SELECT bucket FROM auth_request_limits WHERE bucket LIKE 'login:ip:%' FOR UPDATE");
    const pending = [
      request(first, '/auth/login', {}, 'POST', { email: 'last-web@example.test', password: 'wrong' }),
      request(second, '/mobile/auth/login', {}, 'POST', { email: 'last-mobile@example.test', password: 'wrong' }),
    ];
    try {
      const deadline = Date.now() + 10000;
      while (true) {
        const waiting = await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'", [[first.applicationName, second.applicationName]]);
        if (waiting.rows[0].n === 2) break;
        assert.ok(Date.now() < deadline, 'both login requests should reach the locked quota');
        await delay(20);
      }
    } finally { await control.query('COMMIT'); }
    assert.deepEqual((await Promise.all(pending)).map(r => r.status).sort(), [401, 429]);
    assert.equal(s.db.prepare("SELECT count FROM auth_request_limits WHERE bucket LIKE 'login:ip:%'").get().count, 30);
  } finally { await control.end(); }
});

test('independent API processes serialize concurrent mobile/web renewals and task edits', async t => {
  const s = await boot(t, { clock }), { owner, web, mobile } = await clients(s, 'sync-race@example.test');
  const first = await instance(t, s, 'web'), second = await instance(t, s, 'mobile');
  const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await control.connect();
  t.after(() => control.end());
  await control.query(`SET search_path TO "${s.db.schema}"`);
  async function overlap(table, id, calls) {
    // Hold the row until both independent backends are waiting. Without read
    // locks they both read the old record and block only at their later UPDATE.
    await control.query('BEGIN');
    await control.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
    const pending = calls();
    try {
      const deadline = Date.now() + 10000;
      while (true) {
        const result = await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'", [[first.applicationName, second.applicationName]]);
        if (result.rows[0].n === 2) break;
        assert.ok(Date.now() < deadline, 'both API instances should reach the locked row');
        await delay(20);
      }
    } finally { await control.query('COMMIT'); }
    return Promise.all(pending);
  }
  const service = (await request(s, '/services', web, 'POST', { name: 'Concurrent license', nextDate: '2026-09-25', amount: 200 })).body.service;
  const renewals = await overlap('service_contracts', service.id, () => [
    request(first, `/services/${service.id}/renew`, web, 'POST', { expectedDate: service.nextDate }),
    request(second, `/services/${service.id}/renew`, mobile, 'POST', { expectedDate: service.nextDate }),
  ]);
  assert.deepEqual(renewals.map(r => r.status).sort(), [200, 409]);
  assert.equal((await request(s, `/services/${service.id}/history`, web)).body.history.length, 1);
  const metadata = await overlap('service_contracts', service.id, () => [
    request(first, `/services/${service.id}`, web, 'PATCH', { note: 'Web note' }),
    request(second, `/services/${service.id}`, mobile, 'PATCH', { amount: 300 }),
  ]);
  assert.deepEqual(metadata.map(r => r.status), [200, 200]);
  const merged = (await request(s, `/services/${service.id}`, web)).body.service;
  assert.equal(merged.note, 'Web note');
  assert.equal(merged.amount, 300);
  assert.equal(merged.nextDate, '2027-09-25');

  const original = await task(s, owner);
  const edits = await overlap('tasks', original.id, () => [
    request(first, `/tasks/${original.id}`, web, 'PATCH', { title: 'Web change', expectedRevision: original.revision }),
    request(second, `/tasks/${original.id}`, mobile, 'PATCH', { status: 'done', expectedRevision: original.revision }),
  ]);
  assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
  const webTask = (await request(first, `/tasks/${original.id}`, web)).body.task;
  const phoneTask = (await request(second, `/tasks/${original.id}`, mobile)).body.task;
  assert.deepEqual(webTask, phoneTask);

  const eventBody = { title: 'Concurrent meeting', startsAt: '2026-09-23T04:00:00Z', endsAt: '2026-09-23T05:00:00Z' };
  const eventId = (await request(s, '/calendar-events', web, 'POST', eventBody)).body.id;
  const event = (await request(s, `/calendar-events/${eventId}`, web)).body.event;
  const appointments = await overlap('calendar_events', eventId, () => [
    request(first, `/calendar-events/${eventId}`, web, 'PUT', { ...eventBody, title: 'Web meeting', expectedRevision: event.revision }),
    request(second, `/calendar-events/${eventId}/status`, mobile, 'PATCH', { status: 'done', expectedRevision: event.revision }),
  ]);
  assert.deepEqual(appointments.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual((await request(first, `/calendar-events/${eventId}`, web)).body.event, (await request(second, `/calendar-events/${eventId}`, mobile)).body.event);
});
