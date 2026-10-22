import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user } from './roadmap-helpers.mjs';
import { openDatabase } from './database-helpers.mjs';
import { exportSnapshot, importSnapshot, upgradeSnapshot } from '../server/database-snapshot.mjs';
import { V15_TABLE_COLUMNS } from '../server/database-tables.mjs';

const register = (s, email, body = {}) => call(s, '/auth/register', { method: 'POST', body: { name: email.split('@')[0], email, password: 'Password123!', ...body } });
const personal = (s, email) => register(s, email, { accountType: 'personal' });

async function invitedMember(s, owner, email) {
  const invite = await call(s, '/invitations', { method: 'POST', cookie: owner.cookie, body: { email } });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  const token = new URLSearchParams(new URL(invite.body.inviteUrl).hash.slice(1)).get('invite');
  const accepted = await call(s, '/invitations/accept', { method: 'POST', body: { token, name: 'Invited', password: 'Password123!' } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return accepted;
}

test('personal sign-up creates a free permanent personal workspace without a workspace name', async t => {
  const s = await boot(t);
  const r = await personal(s, 'solo@example.test');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.workspace.kind, 'personal');
  assert.equal(r.body.workspace.name, 'Không gian cá nhân');
  assert.equal(r.body.subscription.status, 'active');
  assert.equal(s.db.prepare('SELECT personal_owner_id FROM workspaces WHERE id=?').get(r.body.workspace.id).personal_owner_id, r.body.user.id);
  const me = await call(s, '/me', { cookie: r.cookie });
  assert.equal(me.body.workspace.kind, 'personal');
  const task = await call(s, '/tasks', { method: 'POST', cookie: r.cookie, body: { title: 'Việc riêng', dueAt: '2030-01-01T10:00:00Z' } });
  assert.equal(task.status, 201, JSON.stringify(task.body));
  const list = await call(s, '/workspaces', { cookie: r.cookie });
  assert.deepEqual(list.body.workspaces.map(w => w.kind), ['personal']);
  assert.equal(list.body.canCreatePersonal, false);
  assert.equal((await call(s, '/workspaces/personal', { method: 'POST', cookie: r.cookie })).status, 409);
  const checkout = await call(s, '/billing/checkout', { method: 'POST', cookie: r.cookie, body: { plan: 'team', cycle: 'monthly' } });
  assert.equal(checkout.status, 409);
  assert.match(checkout.body.error, /miễn phí/);
});

test('personal workspace cannot be deleted, converted or given other members', async t => {
  const s = await boot(t);
  const solo = await personal(s, 'keep@example.test');
  const other = await user(s, 'other@example.test');
  const id = solo.body.workspace.id;
  assert.throws(() => s.db.prepare('DELETE FROM workspaces WHERE id=?').run(id), /personal workspace cannot be deleted/);
  assert.throws(() => s.db.prepare("UPDATE workspaces SET kind='team', personal_owner_id=NULL WHERE id=?").run(id), /workspace kind cannot be changed/);
  assert.throws(() => s.db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'member',?)").run(id, other.user.id, new Date().toISOString()), /cannot have other members/);
  assert.ok(s.db.prepare('SELECT 1 FROM workspaces WHERE id=?').get(id));
  // Team workspaces keep their existing behaviour.
  assert.equal(s.db.prepare('SELECT kind FROM workspaces WHERE id=?').get(other.workspace.id).kind, 'team');
  const invite = await call(s, '/invitations', { method: 'POST', cookie: solo.cookie, body: { email: 'friend@example.test' } });
  assert.equal(invite.status, 409, JSON.stringify(invite.body));
  assert.match(invite.body.error, /không thể mời/);
  assert.equal(s.db.prepare('SELECT count(*) n FROM invitations WHERE workspace_id=?').get(id).n, 0);
});

test('team sign-up stays the default, requires a workspace name and rejects unknown account types', async t => {
  const s = await boot(t);
  const legacy = await register(s, 'legacy@example.test', { workspaceName: 'Công ty A' });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assert.equal(legacy.body.workspace.kind, 'team');
  assert.equal(legacy.body.workspace.name, 'Công ty A');
  assert.equal(legacy.body.subscription.status, 'trialing');
  const team = await register(s, 'team@example.test', { accountType: 'team', workspaceName: 'Công ty B' });
  assert.equal(team.status, 201);
  assert.equal(team.body.workspace.kind, 'team');
  assert.equal((await register(s, 'noname@example.test', { accountType: 'team' })).status, 400);
  assert.equal((await register(s, 'bad@example.test', { accountType: 'family', workspaceName: 'X' })).status, 400);
  assert.equal(s.db.prepare("SELECT count(*) n FROM users WHERE email IN ('noname@example.test','bad@example.test')").get().n, 0);
});

test('invited members and team owners can create exactly one personal workspace later', async t => {
  const s = await boot(t);
  const owner = await user(s, 'boss@example.test');
  const member = await invitedMember(s, owner, 'staff@example.test');
  assert.equal(member.body.workspace.kind, 'team');
  const before = await call(s, '/workspaces', { cookie: member.cookie });
  assert.equal(before.body.canCreatePersonal, true);
  assert.deepEqual(before.body.workspaces.map(w => w.id), [owner.workspace.id]);

  const created = await call(s, '/workspaces/personal', { method: 'POST', cookie: member.cookie });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.workspace.kind, 'personal');
  assert.notEqual(created.cookie, member.cookie, 'session rotates into the new workspace');
  assert.equal((await call(s, '/me', { cookie: member.cookie })).status, 401);
  assert.equal((await call(s, '/me', { cookie: created.cookie })).body.workspace.id, created.body.workspace.id);
  const after = await call(s, '/workspaces', { cookie: created.cookie });
  assert.equal(after.body.canCreatePersonal, false);
  assert.deepEqual(after.body.workspaces.map(w => w.kind), ['personal', 'team']);
  assert.equal((await call(s, '/workspaces/personal', { method: 'POST', cookie: created.cookie })).status, 409);
  assert.equal(s.db.prepare('SELECT count(*) n FROM workspaces WHERE personal_owner_id=?').get(member.body.user.id).n, 1);

  // Switching back to the team workspace still works.
  const back = await call(s, '/workspaces/switch', { method: 'POST', cookie: created.cookie, body: { workspaceId: owner.workspace.id } });
  assert.equal(back.status, 200);
  assert.equal(back.body.workspace.kind, 'team');

  const ownerPersonal = await call(s, '/workspaces/personal', { method: 'POST', cookie: owner.cookie });
  assert.equal(ownerPersonal.status, 201, JSON.stringify(ownerPersonal.body));
});

test('guests cannot create a personal workspace', async t => {
  const s = await boot(t);
  const owner = await user(s, 'guest-host@example.test');
  const accepted = await invitedMember(s, owner, 'guest-personal@example.test');
  s.db.prepare("UPDATE workspace_members SET member_type='guest' WHERE user_id=?").run(accepted.body.user.id);
  const denied = await call(s, '/workspaces/personal', { method: 'POST', cookie: accepted.cookie });
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  assert.equal(s.db.prepare('SELECT count(*) n FROM workspaces WHERE personal_owner_id=?').get(accepted.body.user.id).n, 0);
});

test('invitations created before a workspace became personal cannot be accepted', async t => {
  const s = await boot(t);
  const solo = await personal(s, 'guarded@example.test');
  const owner = await user(s, 'inviter@example.test');
  const invite = await call(s, '/invitations', { method: 'POST', cookie: owner.cookie, body: { email: 'target@example.test' } });
  const token = new URLSearchParams(new URL(invite.body.inviteUrl).hash.slice(1)).get('invite');
  // Simulate a corrupted row pointing at a personal workspace (bypasses the insert trigger).
  s.db.exec('ALTER TABLE invitations DISABLE TRIGGER invitations_personal_none');
  s.db.prepare('UPDATE invitations SET workspace_id=? WHERE workspace_id=?').run(solo.body.workspace.id, owner.workspace.id);
  s.db.exec('ALTER TABLE invitations ENABLE TRIGGER invitations_personal_none');
  const accepted = await call(s, '/invitations/accept', { method: 'POST', body: { token, name: 'Target', password: 'Password123!' } });
  assert.equal(accepted.status, 409, JSON.stringify(accepted.body));
  assert.equal(s.db.prepare("SELECT count(*) n FROM users WHERE email='target@example.test'").get().n, 0);
});

test('snapshots keep workspace kind and upgrade schema 15 workspaces as team workspaces', async t => {
  const s = await boot(t);
  const solo = await personal(s, 'backup@example.test');
  const team = await user(s, 'backup-team@example.test');
  const snapshot = exportSnapshot(s.db);
  const kinds = rows => Object.fromEntries(rows.map(row => [row[0], row.slice(-2)]));
  assert.deepEqual(kinds(snapshot.tables.workspaces.rows)[solo.body.workspace.id], ['personal', solo.body.user.id]);

  const target = openDatabase();
  t.after(() => target.close());
  importSnapshot(target, snapshot);
  assert.deepEqual(exportSnapshot(target), snapshot);
  assert.throws(() => target.prepare('DELETE FROM workspaces WHERE id=?').run(solo.body.workspace.id), /cannot be deleted/);

  const columns = V15_TABLE_COLUMNS.workspaces;
  const { email_change_requests: _added17, ...tables16 } = snapshot.tables;
  const sessions = V15_TABLE_COLUMNS.sessions;
  const old = { ...snapshot, schemaVersion: 15, tables: { ...tables16, workspaces: {
    columns: [...columns], rows: snapshot.tables.workspaces.rows.map(row => row.slice(0, columns.length)),
  }, sessions: { columns: [...sessions], rows: snapshot.tables.sessions.rows.map(row => row.slice(0, sessions.length)) } } };
  const upgraded = upgradeSnapshot(old);
  assert.equal(upgraded.schemaVersion, snapshot.schemaVersion);
  assert.deepEqual(upgraded.tables.workspaces.columns, snapshot.tables.workspaces.columns);
  assert.ok(upgraded.tables.workspaces.rows.every(row => row.at(-2) === 'team' && row.at(-1) === null));
  assert.deepEqual(kinds(upgraded.tables.workspaces.rows)[team.workspace.id], ['team', null]);
  assert.deepEqual(upgraded.tables.email_change_requests, { columns: snapshot.tables.email_change_requests.columns, rows: [] });
});
