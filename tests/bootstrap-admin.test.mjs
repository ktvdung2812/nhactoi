import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database-helpers.mjs';
import { boot, call, user } from './roadmap-helpers.mjs';
import { migrateDatabase, withTransaction } from '../server/db.mjs';
import { bootstrapAdmin } from '../server/bootstrap-admin.mjs';
import { verifyPassword } from '../server/auth.mjs';
import { openDatabase as openLegacy } from '../server/legacy-sqlite.mjs';
import { seedDemo } from '../server/seed.mjs';
import { migrateSqlite } from '../scripts/migrate-sqlite.mjs';

function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nhactoi-bootstrap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('migration generates a private, usable admin account once and preserves existing credentials', async t => {
  const s = await boot(t);
  const dir = temp(t);
  const env = { NHACTOI_DATA_DIR: dir };
  migrateDatabase(s.db, { env });
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  const path = join(dir, files[0]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const credentials = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(credentials.email, 'admin@nhactoi.local');
  assert.equal(credentials.password.length, 32);
  const admin = s.db.prepare('SELECT * FROM users WHERE id=?').get(credentials.userId);
  assert.equal(admin.is_platform_admin, 1);
  assert.ok(verifyPassword(credentials.password, admin.password_hash));
  const login = await call(s, '/auth/login', { method: 'POST', body: credentials });
  assert.equal(login.status, 200);
  assert.equal((await call(s, '/admin/overview', { cookie: login.cookie })).status, 200);
  assert.equal(s.db.prepare('SELECT role FROM workspace_members WHERE user_id=?').get(admin.id).role, 'owner');
  assert.equal(s.db.prepare('SELECT status FROM subscriptions').get().status, 'trialing');
  const audit = s.db.prepare("SELECT * FROM admin_audit_logs WHERE action='admin.bootstrap'").all();
  assert.equal(audit.length, 1);
  assert.ok(!JSON.stringify(audit).includes(credentials.password));
  // Existing active admins win even when the supplied bootstrap config is invalid.
  migrateDatabase(s.db, { env: { ...env, BOOTSTRAP_ADMIN_EMAIL: 'bad', BOOTSTRAP_ADMIN_PASSWORD: 'short' } });
  assert.deepEqual(s.db.prepare('SELECT * FROM users WHERE id=?').get(admin.id), admin);
  assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n, 1);
  assert.deepEqual(readdirSync(dir), files);
});

test('configured initial admin uses supplied credentials without writing a password file', t => {
  const db = openDatabase();
  t.after(() => db.close());
  const dir = temp(t);
  const env = { NHACTOI_DATA_DIR: dir, BOOTSTRAP_ADMIN_NAME: 'Operator', BOOTSTRAP_ADMIN_EMAIL: 'Operator@Example.com', BOOTSTRAP_ADMIN_PASSWORD: 'Bootstrap-test-2026!' };
  const result = withTransaction(db, () => bootstrapAdmin(db, { env }));
  const admin = db.prepare('SELECT * FROM users WHERE id=?').get(result.userId);
  assert.equal(admin.name, 'Operator');
  assert.equal(admin.email, 'operator@example.com');
  assert.ok(verifyPassword(env.BOOTSTRAP_ADMIN_PASSWORD, admin.password_hash));
  assert.equal(result.credentialsFile, null);
  assert.ok(!JSON.stringify(result).includes(env.BOOTSTRAP_ADMIN_PASSWORD));
  assert.deepEqual(readdirSync(dir), []);
});

test('bootstrap never promotes or resets a colliding account, including a disabled admin', async t => {
  const s = await boot(t);
  const registered = await user(s, 'admin@nhactoi.local');
  const env = { NHACTOI_DATA_DIR: temp(t), BOOTSTRAP_ADMIN_EMAIL: 'ADMIN@nhactoi.local', BOOTSTRAP_ADMIN_PASSWORD: 'Bootstrap-test-2026!' };
  for (const disabled of [false, true]) {
    if (disabled) s.db.prepare('UPDATE users SET is_platform_admin=1, disabled_at=? WHERE id=?').run('2026-01-01', registered.user.id);
    const before = s.db.prepare('SELECT * FROM users WHERE id=?').get(registered.user.id);
    assert.throws(() => migrateDatabase(s.db, { env }), /đã tồn tại/);
    assert.deepEqual(s.db.prepare('SELECT * FROM users WHERE id=?').get(registered.user.id), before);
    assert.equal(s.db.prepare('SELECT count(*) n FROM workspaces').get().n, 1);
    assert.equal(s.db.prepare("SELECT count(*) n FROM admin_audit_logs WHERE action='admin.bootstrap'").get().n, 0);
  }
  delete env.BOOTSTRAP_ADMIN_EMAIL;
  migrateDatabase(s.db, { env });
  const active = s.db.prepare('SELECT * FROM users WHERE is_platform_admin=1 AND disabled_at IS NULL').all();
  assert.equal(active.length, 1);
  assert.match(active[0].email, /^admin\+[a-f0-9]+@nhactoi\.local$/);
  assert.notEqual(active[0].id, registered.user.id);
});

test('invalid configuration or unwritable generated credentials rolls back all bootstrap rows', t => {
  const db = openDatabase();
  t.after(() => db.close());
  const file = join(temp(t), 'not-a-directory');
  writeFileSync(file, 'occupied');
  const configs = [
    { BOOTSTRAP_ADMIN_PASSWORD: 'short' },
    { BOOTSTRAP_ADMIN_EMAIL: 'invalid' },
    { NHACTOI_DATA_DIR: file },
  ];
  for (const env of configs) {
    assert.throws(() => migrateDatabase(db, { env }));
    for (const table of ['users', 'workspaces', 'workspace_members', 'subscriptions', 'admin_audit_logs'])
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
  }
});

for (const hasAdmin of [false, true]) {
  test(`SQLite import bootstraps after importing rows (existing admin: ${hasAdmin})`, async t => {
    const dir = temp(t);
    const sourcePath = join(dir, 'source.sqlite');
    const legacy = openLegacy(sourcePath);
    const db = openDatabase();
    t.after(() => { legacy.close(); db.close(); });
    seedDemo({ db: legacy });
    const original = legacy.prepare('SELECT * FROM users LIMIT 1').get();
    if (hasAdmin) legacy.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(original.id);
    const sourceCount = legacy.prepare('SELECT count(*) n FROM users').get().n;
    const result = await migrateSqlite({ sourcePath, db, backupDir: join(dir, 'backup'), env: { NHACTOI_DATA_DIR: dir } });
    assert.equal(result.admin.created, !hasAdmin);
    assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, sourceCount + (hasAdmin ? 0 : 1));
    assert.equal(db.prepare('SELECT count(*) n FROM users WHERE is_platform_admin=1 AND disabled_at IS NULL').get().n, 1);
    assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(original.id).password_hash, original.password_hash);
    if (!hasAdmin) {
      const credentials = JSON.parse(readFileSync(result.admin.credentialsFile, 'utf8'));
      assert.ok(verifyPassword(credentials.password, db.prepare('SELECT password_hash FROM users WHERE id=?').get(result.admin.userId).password_hash));
    } else assert.equal(readdirSync(dir).filter(name => name.startsWith('bootstrap-admin-')).length, 0);
  });
}
