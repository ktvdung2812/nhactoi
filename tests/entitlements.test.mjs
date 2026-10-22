import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { boot, call, user } from './roadmap-helpers.mjs';
import { createApp } from './database-helpers.mjs';
import { BASE_ENTITLEMENTS, planEntitlements, hasWorkspaceEntitlement } from '../server/entitlements.mjs';

test('plan codes preserve baseline and tier capabilities independently of display name and sale status', async t => {
  const s = await boot(t);
  const owner = await user(s, 'entitlement-owner@example.test');
  s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(owner.user.id);
  const initial = await call(s, '/billing', { cookie: owner.cookie });
  assert.deepEqual(initial.body.plans.map(p => [p.id, p.monthlyPrice, p.yearlyPrice, p.memberLimit]), [
    ['starter', 199000, 1990000, 3], ['team', 499000, 4990000, 10], ['business', 999000, 9990000, 50],
  ]);
  for (const plan of initial.body.plans) {
    assert.ok(BASE_ENTITLEMENTS.every(code => plan.entitlements.includes(code)));
    assert.equal(plan.entitlements.includes('projects.private'), plan.id !== 'starter');
    assert.equal(plan.entitlements.includes('guests'), plan.id === 'business');
    assert.equal(plan.entitlements.includes('zalo_oa'), plan.id === 'business');
  }
  const before = planEntitlements(s.app.locals.config.plans.find(p => p.id === 'business'));
  assert.equal((await call(s, '/admin/plans/business', { method: 'PATCH', cookie: owner.cookie,
    body: { name: 'Starter đổi tên', active: false, reason: 'Test rename' },
  })).status, 200);
  assert.deepEqual(planEntitlements(s.app.locals.config.plans.find(p => p.id === 'business')), before);
  const { subscription } = (await call(s, '/me', { cookie: owner.cookie })).body;
  assert.ok(subscription.capabilities.includes('tasks'));
  assert.ok(!subscription.capabilities.includes('guests'));
});

test('custom capabilities and downgrade are revalidated across server instances; expired subscriptions cannot write', async t => {
  const s = await boot(t);
  const owner = await user(s, 'entitlement-custom@example.test');
  s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(owner.user.id);
  const write = (path, body, method = 'PATCH') => call(s, path, { method, cookie: owner.cookie, body });
  const draft = { id: 'custom', name: 'Business', monthly: 199000, yearly: 1990000, seats: 3, reason: 'Test custom' };
  for (const entitlements of [null, 'guests', ['root'], ['guests', 'guests']])
    assert.equal((await write('/admin/plans', { ...draft, entitlements }, 'POST')).status, 400);
  assert.equal((await write('/admin/plans', { ...draft, entitlements: ['guests'] }, 'POST')).status, 201);
  assert.equal((await write(`/admin/subscriptions/${owner.workspace.id}`, { plan: 'custom', reason: 'Test assignment' })).status, 200);
  const peer = createApp({ dbPath: join(s.dir, 'test.sqlite'), env: { NODE_ENV: 'test' } });
  const listener = await new Promise(resolve => { const server = peer.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(async () => { await new Promise(resolve => listener.close(resolve)); peer.locals.close(); });
  const capability = code => hasWorkspaceEntitlement(peer.locals.db, peer.locals.config, owner.workspace.id, code, peer.locals.clock);
  assert.equal(capability('guests'), true);
  assert.equal(capability('public_api'), false);
  assert.equal((await write('/admin/plans/custom', { entitlements: [], reason: 'Remove guest writes' })).status, 200);
  assert.equal(capability('guests'), false);
  assert.equal(capability('tasks'), true);
  const refreshed = await fetch(`http://127.0.0.1:${listener.address().port}/api/me`, { headers: { cookie: owner.cookie } });
  assert.equal(refreshed.status, 200);
  assert.ok(!(await refreshed.json()).subscription.capabilities.includes('guests'));
  s.db.prepare("UPDATE subscriptions SET current_period_end='2000-01-01T00:00:00Z' WHERE workspace_id=?").run(owner.workspace.id);
  assert.equal(capability('tasks'), false);
  assert.equal((await call(s, '/tasks', { method: 'POST', cookie: owner.cookie, body: { title: 'Blocked after expiry' } })).status, 402);
  assert.equal((await call(s, '/me', { cookie: owner.cookie })).body.subscription.capabilities.length, 0);
  assert.equal((await call(s, '/tasks', { cookie: owner.cookie })).status, 200);
});
