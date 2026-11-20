import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';
import { migrateDatabase, openDatabase } from './database-helpers.mjs';
import { APPEARANCE_DEFAULTS as defaults, APPEARANCE_FIELDS, validateAppearance, resolveAppearance } from '../shared/appearance.mjs';
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
  // An unconfigured team starts from the defaults but leaves every field open to members.
  assert.deepEqual((await call(s, path, { cookie: member.cookie })).body.team.editableFields, APPEARANCE_FIELDS);
  assert.equal((await put(s, path, member.cookie, { ...defaults, mode: 'dark', accent: '#a63266' })).status, 200);
  assert.deepEqual((await call(s, path, { cookie: member.cookie })).body.preferences, { mode: 'dark', accent: '#a63266' });
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

test("[SQLite legacy] appearance migration is additive, replayable and cleans up deleted parents", () => {
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
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const standard = accentColors('#176b59'), high = accentColors('#176b59', true);
  assert.ok(luminance(high.light) < luminance(standard.light));
  assert.ok(1.05 / (luminance(high.light) + 0.05) >= 7, 'high-contrast accent reaches AAA on white');
  assert.ok((luminance(high.dark) + 0.05) / (luminance('#16181b') + 0.05) >= 7, 'high-contrast accent reaches AAA on dark surfaces');
});

test('larger text, high contrast and reduced motion are valid choices', () => {
  assert.deepEqual(validateAppearance({ fontSize: 'xlarge', contrast: 'high', motion: 'reduced' }),
    { ...defaults, fontSize: 'xlarge', contrast: 'high', motion: 'reduced' });
  for (const bad of [{ contrast: 'max' }, { motion: 'none' }, { fontSize: 'huge' }]) assert.throws(() => validateAppearance(bad), JSON.stringify(bad));
  assert.ok(!APPEARANCE_FIELDS.includes('contrast') && !APPEARANCE_FIELDS.includes('motion'));
});

test('accessibility follows the person into every team and cannot be locked by admins', async t => {
  const s = await boot(t), owner = await user(s, 'a11y-owner@example.test'), member = await user(s, 'a11y-member@example.test');
  addMember(s, owner, member);
  const created = await call(s, '/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'A11y', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }, { userId: member.user.id, role: 'member' }] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.team.id, path = `/appearance?teamId=${id}`, policyPath = `/teams/${id}/appearance`;
  assert.equal((await put(s, policyPath, owner.cookie, { preferences: defaults, editableFields: ['contrast'] })).status, 400);
  assert.equal((await put(s, policyPath, owner.cookie, { preferences: defaults, editableFields: [] })).status, 200);
  assert.deepEqual((await call(s, path, { cookie: member.cookie })).body.accessibility, { contrast: 'standard', motion: 'system' });
  assert.equal((await put(s, '/appearance', member.cookie, { ...defaults, contrast: 'high', motion: 'reduced' })).status, 200);
  const scoped = (await call(s, path, { cookie: member.cookie })).body;
  assert.deepEqual(scoped.accessibility, { contrast: 'high', motion: 'reduced' });
  assert.deepEqual((await call(s, '/appearance', { cookie: member.cookie })).body.accessibility, { contrast: 'high', motion: 'reduced' });
  // A fully locked team still accepts the personal overlay but never stores it in the team scope.
  assert.equal((await put(s, path, member.cookie, { ...defaults, contrast: 'high', motion: 'reduced' })).status, 200);
  assert.deepEqual((await call(s, path, { cookie: member.cookie })).body.preferences, {});
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

test('existing menu preferences gain templates and automations without losing the saved order', () => {
  const oldOrder = ['tasks', 'dashboard', 'today', 'upcoming', 'week', 'inbox', 'teams', 'customers', 'services', 'finance', 'transfer', 'tickets', 'trash'];
  const preferences = validateAppearance({ navOrder: oldOrder, hiddenNav: ['tickets'] });
  assert.deepEqual(preferences.navOrder, [...oldOrder, 'projects', 'templates', 'automations', 'public-integrations', 'google-calendar', 'zalo-oa']);
  assert.deepEqual(resolveAppearance({ navOrder: oldOrder }).navOrder, preferences.navOrder);
  assert.deepEqual(resolveAppearance(null, { preferences: { ...defaults, navOrder: oldOrder }, editableFields: [] }).navOrder, preferences.navOrder);
  assert.deepEqual(preferences.hiddenNav, ['tickets']);
  assert.deepEqual(validateAppearance({ hiddenNav: ['templates', 'automations'] }).hiddenNav, ['templates', 'automations']);
});

test('platform sync copies scopes, isolates choices, retains rows and shares accessibility', async t => {
  const s = await boot(t), owner = await user(s, 'platform-owner@example.test');
  const cookie = owner.cookie;
  const get = async path => (await call(s, path, { cookie })).body;
  const sync = body => put(s, '/appearance/sync', cookie, body);
  const initial = await get('/appearance');
  assert.deepEqual(initial, { preferences: null, team: null, accessibility: { contrast: 'standard', motion: 'system' }, platform: 'web', separate: false });
  assert.deepEqual(await get('/appearance/sync'), { web: { separate: false }, mobile: { separate: false } });
  assert.equal((await call(s, '/appearance/sync')).status, 401);
  const team = await call(s, '/teams', { method: 'POST', cookie, body: { name: 'Platform', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }] } });
  assert.equal(team.status, 201);
  const teamId = team.body.team.id, teamPath = `/appearance?teamId=${teamId}`;
  assert.equal((await put(s, '/appearance?platform=web', cookie, { ...defaults, mode: 'dark', contrast: 'high' })).status, 200);
  assert.equal((await get('/appearance?platform=mobile')).preferences.mode, 'dark');
  assert.equal((await put(s, '/appearance?platform=mobile', cookie, { ...defaults, mode: 'light', motion: 'reduced' })).status, 200);
  assert.equal((await get('/appearance?platform=web')).preferences.mode, 'light');
  assert.equal((await put(s, teamPath, cookie, { ...defaults, mode: 'dark', motion: 'reduced' })).status, 200);
  assert.equal((await sync({ platform: 'mobile', separate: true })).body.mobile.separate, true);
  assert.equal((await get('/appearance?platform=mobile')).preferences.mode, 'light');
  assert.deepEqual((await get(`${teamPath}&platform=mobile`)).preferences, { mode: 'dark' });
  assert.equal((await put(s, '/appearance?platform=mobile', cookie, { ...defaults, mode: 'dark', contrast: 'high', motion: 'reduced' })).status, 200);
  assert.equal((await get('/appearance?platform=web')).preferences.mode, 'light');
  assert.deepEqual((await get(teamPath)).accessibility, { contrast: 'high', motion: 'reduced' });
  for (const row of s.db.prepare("SELECT preferences FROM user_appearance WHERE workspace_id=? AND user_id=? AND (scope<>'' OR platform<>'all')").all(owner.workspace.id, owner.user.id)) {
    assert.equal(Object.hasOwn(JSON.parse(row.preferences), 'contrast'), false);
    assert.equal(Object.hasOwn(JSON.parse(row.preferences), 'motion'), false);
  }
  assert.equal((await sync({ platform: 'mobile', separate: false })).status, 200);
  assert.equal((await get('/appearance?platform=mobile')).preferences.mode, 'light');
  assert.equal((await sync({ platform: 'mobile', separate: true })).status, 200);
  assert.equal((await get('/appearance?platform=mobile')).preferences.mode, 'dark');
  // Copying from a platform falls back to shared rows for missing scopes.
  assert.equal((await sync({ platform: 'web', separate: true, copyFrom: 'mobile' })).status, 200);
  assert.equal((await get('/appearance?platform=web')).preferences.mode, 'dark');
  assert.equal((await call(s, `${teamPath}&platform=mobile`, { method: 'DELETE', cookie })).status, 200);
  assert.equal((await sync({ platform: 'web', separate: true, copyFrom: 'mobile' })).status, 200);
  assert.deepEqual((await get(`${teamPath}&platform=web`)).preferences, { mode: 'dark' });
  assert.equal((await sync({ platform: 'web', separate: true, copyFrom: 'all' })).status, 200);
  assert.equal((await get('/appearance?platform=web')).preferences.mode, 'light');
  assert.equal((await put(s, `/teams/${teamId}/appearance`, cookie, { preferences: defaults, editableFields: [] })).status, 200);
  for (const platform of ['web', 'mobile']) {
    assert.equal((await put(s, `${teamPath}&platform=${platform}`, cookie, { ...defaults, mode: 'dark' })).status, 403);
    assert.equal((await put(s, `${teamPath}&platform=${platform}`, cookie, { ...defaults, contrast: 'high', motion: 'reduced' })).status, 200);
  }
});

test('platform sync validates inputs, preserves deleted rows on repeated enable, and allows guests', async t => {
  const s = await boot(t), owner = await user(s, 'sync-validate@example.test'), guest = await user(s, 'sync-guest@example.test');
  addMember(s, owner, guest);
  s.db.prepare("UPDATE workspace_members SET member_type='guest' WHERE workspace_id=? AND user_id=?").run(owner.workspace.id, guest.user.id);
  for (const path of ['/appearance?platform=desktop', '/appearance?platform=', '/appearance?platform=web&platform=mobile']) {
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await call(s, path, { method, cookie: owner.cookie, ...(method === 'PUT' ? { body: defaults } : {}) })).status, 400);
  }
  for (const body of [{}, { platform: 'all', separate: true }, { platform: 'web', separate: 1 }, { platform: 'web', separate: true, extra: 1 }, { platform: 'web', separate: true, copyFrom: 'web' }, { platform: 'web', separate: false, copyFrom: 'all' }, { platform: 'mobile', separate: true, copyFrom: 'desktop' }, []]) {
    assert.equal((await put(s, '/appearance/sync', owner.cookie, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await put(s, '/appearance', guest.cookie, defaults)).status, 200);
  assert.equal((await put(s, '/appearance/sync', guest.cookie, { platform: 'mobile', separate: true })).status, 200);
  assert.equal((await call(s, '/appearance?platform=mobile', { method: 'DELETE', cookie: guest.cookie })).status, 200);
  assert.equal((await put(s, '/appearance/sync', guest.cookie, { platform: 'mobile', separate: true })).status, 200);
  assert.equal((await call(s, '/appearance?platform=mobile', { cookie: guest.cookie })).body.preferences, null);
});

test('platform initialization preserves resets and edited profiles unless copyFrom is explicit', async t => {
  const s = await boot(t), owner = await user(s, 'sync-initialization@example.test');
  const cookie = owner.cookie;
  const get = async path => (await call(s, path, { cookie })).body;
  const sync = (platform, separate, copyFrom) => put(s, '/appearance/sync', cookie, { platform, separate, ...(copyFrom ? { copyFrom } : {}) });
  const team = await call(s, '/teams', { method: 'POST', cookie, body: { name: 'Sync scopes', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }] } });
  assert.equal(team.status, 201);
  const teamPath = `/appearance?teamId=${team.body.team.id}`;
  assert.equal((await put(s, '/appearance', cookie, { ...defaults, mode: 'dark' })).status, 200);
  assert.equal((await put(s, teamPath, cookie, { ...defaults, accent: '#7747b8' })).status, 200);

  // The first enable copies every shared scope.
  assert.equal((await sync('mobile', true)).status, 200);
  assert.equal((await get('/appearance?platform=mobile')).preferences.mode, 'dark');
  assert.deepEqual((await get(`${teamPath}&platform=mobile`)).preferences, { accent: '#7747b8' });

  // An edited separate profile survives switching off and on.
  assert.equal((await put(s, '/appearance?platform=mobile', cookie, { ...defaults, mode: 'light' })).status, 200);
  assert.equal((await sync('mobile', false)).status, 200);
  assert.equal((await sync('mobile', true)).status, 200);
  assert.equal((await get('/appearance?platform=mobile')).preferences.mode, 'light');

  // An explicit copy overwrites both existing and missing separate scopes.
  assert.equal((await call(s, `${teamPath}&platform=mobile`, { method: 'DELETE', cookie })).status, 200);
  assert.equal((await sync('mobile', true, 'all')).status, 200);
  assert.equal((await get('/appearance?platform=mobile')).preferences.mode, 'dark');
  assert.deepEqual((await get(`${teamPath}&platform=mobile`)).preferences, { accent: '#7747b8' });

  // Reset all separate scopes, then toggle: the empty profile stays empty.
  assert.equal((await call(s, '/appearance?platform=mobile', { method: 'DELETE', cookie })).status, 200);
  assert.equal((await call(s, `${teamPath}&platform=mobile`, { method: 'DELETE', cookie })).status, 200);
  assert.ok(s.db.prepare('SELECT 1 FROM user_appearance_sync WHERE workspace_id=? AND user_id=? AND platform=?').get(owner.workspace.id, owner.user.id, 'mobile'));
  assert.equal((await sync('mobile', false)).status, 200);
  assert.equal((await get('/appearance?platform=mobile')).preferences.mode, 'dark');
  assert.equal((await sync('mobile', true)).status, 200);
  assert.equal((await get('/appearance?platform=mobile')).preferences, null);
  assert.equal((await get(`${teamPath}&platform=mobile`)).preferences, null);

  // Repeated off requests do not mark a platform as initialized.
  for (let i = 0; i < 2; i++) {
    assert.equal((await sync('web', false)).status, 200);
    assert.equal(s.db.prepare('SELECT 1 FROM user_appearance_sync WHERE workspace_id=? AND user_id=? AND platform=?').get(owner.workspace.id, owner.user.id, 'web'), undefined);
    assert.equal((await get('/appearance/sync')).web.separate, false);
  }
  assert.equal((await sync('web', true)).status, 200);
  assert.equal((await get('/appearance?platform=web')).preferences.mode, 'dark');
  assert.deepEqual((await get(`${teamPath}&platform=web`)).preferences, { accent: '#7747b8' });
});

test('copying from a platform that is no longer separate copies what it shows', async t => {
  const s = await boot(t), owner = await user(s, 'sync-copy-inactive@example.test');
  const cookie = owner.cookie;
  const get = async path => (await call(s, path, { cookie })).body;
  const sync = body => put(s, '/appearance/sync', cookie, body);
  const team = await call(s, '/teams', { method: 'POST', cookie, body: { name: 'Copy inactive', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }] } });
  assert.equal(team.status, 201);
  const teamPath = `/appearance?teamId=${team.body.team.id}`;
  assert.equal((await put(s, '/appearance?platform=web', cookie, { ...defaults, mode: 'dark', accent: '#245bc0' })).status, 200);
  assert.equal((await put(s, teamPath, cookie, { ...defaults, mode: 'dark', accent: '#176b59' })).status, 200);
  assert.equal((await sync({ platform: 'web', separate: true })).status, 200);
  assert.equal((await put(s, '/appearance?platform=web', cookie, { ...defaults, mode: 'light', accent: '#b54d2a' })).status, 200);
  assert.equal((await put(s, `${teamPath}&platform=web`, cookie, { ...defaults, mode: 'dark', accent: '#ff0000' })).status, 200);
  // Turning web off hides its saved rows behind the shared profile again.
  assert.equal((await sync({ platform: 'web', separate: false })).status, 200);
  assert.equal((await get('/appearance?platform=web')).preferences.accent, '#245bc0');
  assert.equal((await get(`${teamPath}&platform=web`)).preferences.accent, '#176b59');
  // An explicit copy from the inactive platform must copy what web shows, not its stale rows.
  assert.equal((await sync({ platform: 'mobile', separate: true, copyFrom: 'web' })).status, 200);
  const mobile = (await get('/appearance?platform=mobile')).preferences;
  assert.equal(mobile.mode, 'dark');
  assert.equal(mobile.accent, '#245bc0');
  assert.deepEqual((await get(`${teamPath}&platform=mobile`)).preferences, { mode: 'dark', accent: '#176b59' });
});

test('saving appearance without accessibility fields keeps stored accessibility in every scope', async t => {
  const s = await boot(t), owner = await user(s, 'a11y-preserve@example.test');
  const cookie = owner.cookie;
  const accessibility = async () => (await call(s, '/appearance', { cookie })).body.accessibility;
  assert.equal((await put(s, '/appearance', cookie, { ...defaults, contrast: 'high', motion: 'reduced' })).status, 200);
  assert.deepEqual(await accessibility(), { contrast: 'high', motion: 'reduced' });
  const team = await call(s, '/teams', { method: 'POST', cookie, body: { name: 'A11y keep', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }] } });
  assert.equal(team.status, 201);
  const teamPath = `/appearance?teamId=${team.body.team.id}`;
  // Validated defaults must not be routed into the personal row by a team save that omits accessibility.
  assert.equal((await put(s, teamPath, cookie, { accent: '#245bc0' })).status, 200);
  assert.deepEqual(await accessibility(), { contrast: 'high', motion: 'reduced' });
  assert.equal((await put(s, `${teamPath}&platform=mobile`, cookie, { mode: 'light' })).status, 200);
  assert.deepEqual(await accessibility(), { contrast: 'high', motion: 'reduced' });
  const personal = await put(s, '/appearance', cookie, { accent: '#b54d2a' });
  assert.equal(personal.status, 200);
  assert.deepEqual(personal.body.accessibility, { contrast: 'high', motion: 'reduced' });
  assert.deepEqual(await accessibility(), { contrast: 'high', motion: 'reduced' });
  // Explicitly provided fields still update the personal overlay.
  assert.equal((await put(s, '/appearance', cookie, { motion: 'system' })).status, 200);
  assert.deepEqual(await accessibility(), { contrast: 'high', motion: 'system' });
  assert.equal((await put(s, teamPath, cookie, { contrast: 'standard' })).status, 200);
  assert.deepEqual(await accessibility(), { contrast: 'standard', motion: 'system' });
});

test('simultaneous first enables copy the shared profile once', async t => {
  const s = await boot(t), owner = await user(s, 'sync-race@example.test');
  assert.equal((await put(s, '/appearance', owner.cookie, { ...defaults, mode: 'dark' })).status, 200);
  s.db.exec(`CREATE TABLE appearance_copy_count (n integer NOT NULL);
    INSERT INTO appearance_copy_count VALUES (0);
    CREATE FUNCTION count_appearance_copy() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE appearance_copy_count SET n=n+1; RETURN NULL; END $$;
    CREATE TRIGGER count_appearance_copy AFTER DELETE ON user_appearance
      FOR EACH STATEMENT EXECUTE FUNCTION count_appearance_copy()`);
  const servers = [];
  for (const name of ['appearance_first', 'appearance_second']) {
    const applicationName = `${s.db.schema}_${name}`;
    const child = fork(new URL('./fixtures/sync-server.mjs', import.meta.url), [s.db.schema, join(s.dir, 'test.sqlite'), applicationName], { silent: true });
    t.after(async () => {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.send('close');
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(kill);
    });
    const [ready] = await once(child, 'message');
    servers.push({ base: `http://127.0.0.1:${ready.port}`, applicationName });
  }
  const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await control.connect();
  try {
    await control.query('BEGIN');
    await control.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [owner.workspace.id, owner.user.id]);
    const pending = servers.map(server => put(server, '/appearance/sync', owner.cookie, { platform: 'mobile', separate: true }));
    try {
      const deadline = Date.now() + 10000;
      while (true) {
        const result = await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'", [servers.map(server => server.applicationName)]);
        if (result.rows[0].n === 2) break;
        assert.ok(Date.now() < deadline, 'both requests must wait on the appearance lock');
        await delay(20);
      }
    } finally { await control.query('COMMIT'); }
    assert.deepEqual((await Promise.all(pending)).map(result => result.status), [200, 200]);
    assert.equal(s.db.prepare('SELECT n FROM appearance_copy_count').get().n, 1);
    assert.equal((await call(s, '/appearance?platform=mobile', { cookie: owner.cookie })).body.preferences.mode, 'dark');
  } finally { await control.end(); }
});
