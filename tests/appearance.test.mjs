import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';
import { migrateDatabase, openDatabase } from '../server/db.mjs';
import { APPEARANCE_DEFAULTS as defaults, validateAppearance, resolveAppearance } from '../shared/appearance.mjs';
import { accentColors, themeDisabledReason } from '../src/appearance.js';

const put = (s, path, cookie, body) => call(s, path, { method: 'PUT', cookie, body });

test('personal preferences persist, isolate users/workspaces, validate and reset', async t => {
  const s = await boot(t), owner = await user(s, 'appearance-owner@example.test'), member = await user(s, 'appearance-member@example.test');
  addMember(s, owner, member);
  assert.equal((await call(s, '/appearance')).status, 401);
  const customized = { ...defaults, accent: '#7747b8', fontSize: 'large', hiddenNav: ['tickets'], navOrder: ['tasks'] };
  const saved = await put(s, '/appearance', owner.cookie, customized);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.preferences.navOrder[0], 'tasks');
  assert.equal((await call(s, '/appearance', { cookie: owner.cookie })).body.preferences.accent, '#7747b8');
  assert.equal((await call(s, '/appearance', { cookie: member.cookie })).body.preferences, null);
  assert.equal((await put(s, '/appearance', member.cookie, { ...defaults, density: 'compact' })).status, 200);
  for (const bad of [{ accent: 'red; color: red' }, { mode: 'auto' }, { fontSize: 200 }, { hiddenNav: ['admin'] }, { navOrder: ['tasks', 'tasks'] }, { unknown: true }, [], null]) {
    assert.equal((await put(s, '/appearance', owner.cookie, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call(s, '/appearance', { cookie: owner.cookie })).body.preferences.accent, '#7747b8');
  // Same user in their original workspace sees no preference from the joined workspace.
  s.db.prepare('UPDATE sessions SET workspace_id=? WHERE user_id=?').run(member.workspace.id, member.user.id);
  assert.equal((await call(s, '/appearance', { cookie: member.cookie })).body.preferences, null);
  const reset = await call(s, '/appearance', { method: 'DELETE', cookie: owner.cookie });
  assert.equal(reset.status, 200);
  assert.equal((await call(s, '/appearance', { cookie: owner.cookie })).body.preferences, null);
});

test('team admins grant fields, members cannot bypass locks, policy changes override old preferences', async t => {
  const s = await boot(t), owner = await user(s, 'policy-owner@example.test'), member = await user(s, 'policy-member@example.test'), stranger = await user(s, 'policy-stranger@example.test'), outsider = await user(s, 'policy-outsider@example.test');
  addMember(s, owner, member); addMember(s, owner, stranger);
  const created = await call(s, '/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'Design', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }, { userId: member.user.id, role: 'member' }] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.team.id, path = `/appearance?teamId=${id}`, policyPath = `/teams/${id}/appearance`;
  const shared = { ...defaults, accent: '#245bc0', background: 'cool' };
  assert.deepEqual((await call(s, path, { cookie: member.cookie })).body.team.editableFields, []);
  assert.equal((await put(s, policyPath, member.cookie, { preferences: shared, editableFields: ['fontSize'] })).status, 403);
  assert.equal((await put(s, policyPath, owner.cookie, { preferences: shared, editableFields: ['fontSize', 'density'] })).status, 200);
  assert.equal((await put(s, path, member.cookie, { ...shared, fontSize: 'large', density: 'compact' })).status, 200);
  const own = (await call(s, path, { cookie: member.cookie })).body;
  assert.deepEqual(own.preferences, { fontSize: 'large', density: 'compact' });
  assert.equal(resolveAppearance(own.preferences, own.team).accent, shared.accent);
  assert.equal((await put(s, path, member.cookie, { ...shared, accent: '#ffffff' })).status, 403);
  assert.equal((await call(s, path, { cookie: owner.cookie })).body.preferences, null);
  for (const actor of [stranger, outsider]) {
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await call(s, path, { method, cookie: actor.cookie, ...(method === 'PUT' ? { body: shared } : {}) })).status, 404);
    assert.equal((await put(s, policyPath, actor.cookie, { preferences: shared, editableFields: [] })).status, 404);
  }
  assert.equal((await put(s, policyPath, owner.cookie, { preferences: shared, editableFields: ['css'] })).status, 400);
  assert.equal((await put(s, policyPath, owner.cookie, { preferences: shared, editableFields: ['density'] })).status, 200);
  const locked = (await call(s, path, { cookie: member.cookie })).body;
  assert.equal(resolveAppearance(locked.preferences, locked.team).fontSize, 'medium');
  assert.equal(resolveAppearance(locked.preferences, locked.team).density, 'compact');
  assert.equal((await call(s, path, { method: 'DELETE', cookie: member.cookie })).status, 200);
  assert.equal((await call(s, path, { cookie: member.cookie })).body.preferences, null);
  assert.equal((await call(s, '/appearance?teamId[x]=1', { cookie: owner.cookie })).status, 200); // not a teamId query
  assert.equal((await call(s, '/appearance?teamId=a&teamId=b', { cookie: owner.cookie })).status, 400);
  const second = await call(s, '/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'Second', color: 'green', members: [{ userId: owner.user.id, role: 'lead' }, { userId: member.user.id, role: 'member' }] } });
  assert.equal(second.status, 201);
  const otherScope = await call(s, `/appearance?teamId=${second.body.team.id}`, { cookie: member.cookie });
  assert.equal(otherScope.body.preferences, null);
  assert.equal(otherScope.body.team.preferences.accent, defaults.accent);
  // Saving one allowed field must not pin unchanged defaults for other fields.
  await put(s, policyPath, owner.cookie, { preferences: shared, editableFields: ['fontSize', 'accent'] });
  await put(s, path, member.cookie, { ...shared, fontSize: 'large' });
  assert.deepEqual((await call(s, path, { cookie: member.cookie })).body.preferences, { fontSize: 'large' });
  await put(s, policyPath, owner.cookie, { preferences: { ...shared, accent: '#7747b8' }, editableFields: ['fontSize', 'accent'] });
  const updated = (await call(s, path, { cookie: member.cookie })).body;
  assert.equal(resolveAppearance(updated.preferences, updated.team).accent, '#7747b8');
  // Removing team membership immediately removes read/write access.
  s.db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(id, member.user.id);
  assert.equal((await call(s, path, { cookie: member.cookie })).status, 404);
});

test('appearance migration is additive, replayable and cleans up deleted parents', () => {
  const db = openDatabase(':memory:');
  try {
    db.exec('DROP TABLE user_appearance; DROP TABLE team_appearance; DELETE FROM schema_migrations WHERE version=25;');
    migrateDatabase(db); migrateDatabase(db);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=25').get().n, 1);
    db.prepare("INSERT INTO users(id,name,email,password_hash,created_at) VALUES ('u','U','u@test','hash','now')").run();
    db.prepare("INSERT INTO workspaces(id,name,created_at) VALUES ('w','W','now')").run();
    db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES ('w','u','owner','now')").run();
    db.prepare("INSERT INTO user_appearance(workspace_id,user_id,scope,preferences) VALUES ('w','u','','{}')").run();
    assert.throws(() => db.prepare("INSERT INTO user_appearance(workspace_id,user_id,scope,preferences) VALUES ('w','u','bad','{}')").run());
    db.prepare("DELETE FROM workspace_members WHERE workspace_id='w'").run();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM user_appearance').get().n, 0);
  } finally { db.close(); }
});

test('appearance validation and contrast handle all-white and all-black accents', () => {
  assert.deepEqual(validateAppearance({}), defaults);
  for (const hex of ['#ffffff', '#000000', '#ff0000', '#176b59']) {
    const colors = accentColors(hex);
    assert.match(colors.light, /^#[0-9a-f]{6}$/);
    assert.match(colors.dark, /^#[0-9a-f]{6}$/);
  }
  assert.equal(accentColors('#ffffff').onAccent, '#101214');
  assert.equal(accentColors('#000000').onAccent, '#ffffff');
});

test('scoped theme uses the server preference without overwriting the device fallback', async () => {
  const { getSavedTheme, setTheme, setThemeOverride } = await import('../src/theme.js');
  const storage = new Map([['nhactoi_theme', 'light']]);
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.document = { documentElement: { setAttribute() {}, classList: { add() {}, remove() {} } } };
  let requested;
  try {
    setThemeOverride('dark', value => { requested = value; });
    assert.equal(getSavedTheme(), 'dark');
    setTheme('system');
    assert.equal(requested, 'system');
    assert.equal(storage.get('nhactoi_theme'), 'light');
    setThemeOverride(null);
    assert.equal(getSavedTheme(), 'light');
  } finally {
    setThemeOverride(null);
    delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
  }
});


test('personal theme stays available on load failure, while team locks and unsaved drafts are respected', () => {
  const common = { ready: true, editableFields: ['mode'], teamId: '' };
  assert.equal(themeDisabledReason(common), '');
  assert.notEqual(themeDisabledReason({ ...common, ready: false }), '');
  assert.equal(themeDisabledReason({ ...common, ready: false, error: 'Not found' }), '');
  assert.notEqual(themeDisabledReason({ ...common, ready: false, error: 'Not found', teamId: 'team' }), '');
  assert.notEqual(themeDisabledReason({ ...common, teamId: 'team', editableFields: [] }), '');
  assert.equal(themeDisabledReason({ ...common, teamId: 'team' }), '');
  for (const flag of ['busy', 'dirty', 'editingTeam']) {
    assert.notEqual(themeDisabledReason({ ...common, [flag]: true }), '');
  }
});
