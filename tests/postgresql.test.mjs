import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TABLE_COLUMNS, V17_TABLE_COLUMNS } from '../server/database-tables.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { openDatabase } from './database-helpers.mjs';
import { openDatabase as connect, migrateDatabase, withTransaction, bindSql, SCHEMA_VERSION } from '../server/db.mjs';
import { openDatabase as openLegacy } from '../server/legacy-sqlite.mjs';
import { seedDemo } from '../server/seed.mjs';
import { migrateSqlite } from '../scripts/migrate-sqlite.mjs';
import { exportSnapshot, importSnapshot, upgradeSnapshot } from '../server/database-snapshot.mjs';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

test('PostgreSQL baseline is replayable, rejects newer versions and enforces transactional constraints', () => {
  const db = openDatabase();
  try {
    migrateDatabase(db, { bootstrapAdmin: false }); migrateDatabase(db, { bootstrapAdmin: false });
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n, SCHEMA_VERSION);
    const columns = db.prepare("SELECT table_name, json_agg(column_name ORDER BY ordinal_position) names FROM information_schema.columns WHERE table_schema=current_schema() AND table_name <> 'schema_migrations' GROUP BY table_name").all();
    assert.deepEqual(Object.fromEntries(columns.map(row=>[row.table_name,row.names])), TABLE_COLUMNS);
    assert.throws(() => withTransaction(db, () => {
      db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run('rollback', 'Rollback', '2026-01-01');
      db.prepare("INSERT INTO workspace_members VALUES ('rollback','missing','owner','2026-01-01')").run();
    }), error => error.code === '23503');
    assert.equal(db.prepare("SELECT 1 FROM workspaces WHERE id='rollback'").get(), undefined);
    assert.equal(db.prepare('SELECT unicode_fold(?) value').get('Đặng THỊ HƯƠNG').value, 'dang thi huong');
    const hostile = "'; DROP TABLE users; -- ?";
    assert.equal(db.prepare('SELECT ?::text value').get(hostile).value, hostile);
    assert.equal(bindSql("SELECT '?', ?::text -- ?\n, ?::integer"), "SELECT '?', $1::text -- ?\n, $2::integer");
    db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(999, '2026-01-01');
    assert.throws(() => migrateDatabase(db), /newer/);
    assert.throws(() => connect('/tmp/no-sqlite-fallback.sqlite'), /DATABASE_URL/);
  } finally { db.close(); }
});

test('SQLite import preserves rows, identities, pending notifications and source WAL; refuses nonempty targets', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'nhactoi-pg-import-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourcePath = join(dir, 'source.sqlite');
  const legacy = openLegacy(sourcePath);
  const db = openDatabase();
  try {
    seedDemo({ db: legacy, clock: () => new Date('2026-09-01T00:00:00Z') });
    const user = legacy.prepare('SELECT * FROM users LIMIT 1').get();
    const workspace = legacy.prepare('SELECT * FROM workspaces LIMIT 1').get();
    const task = legacy.prepare('SELECT * FROM tasks LIMIT 1').get();
    legacy.prepare(`INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at)
      VALUES ('import-notice',?,?,?,'task_reminder','Nhắc','Nội dung','2026-09-01')`).run(workspace.id, user.id, task.id);
    legacy.prepare("INSERT INTO ai_conversations(id,workspace_id,user_id,title,created_at,updated_at) VALUES ('chat',?,?,'Chat','2026-09-01','2026-09-01')").run(workspace.id,user.id);
    legacy.prepare("INSERT INTO ai_messages(id,conversation_id,role,content,created_at) VALUES (20,'chat','user','Xin chào','2026-09-01')").run();
    const before = digest(sourcePath);
    const result = await migrateSqlite({ sourcePath, db, backupDir: join(dir, 'backups'), bootstrapAdmin: false });
    assert.equal(digest(sourcePath), before);
    assert.ok(readFileSync(result.backupPath).length > 0);
    for (const [table, count] of Object.entries(result.counts))
      assert.equal(db.prepare(`SELECT count(*) n FROM "${table}"`).get().n, count, table);
    assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash, user.password_hash);
    assert.equal(db.prepare("SELECT count(*) n FROM notification_outbox WHERE notification_id='import-notice'").get().n, 1);
    db.prepare("INSERT INTO ai_messages(conversation_id,role,content,created_at) VALUES ('chat','assistant','Chào bạn','2026-09-01')").run();
    assert.equal(db.prepare('SELECT max(id) n FROM ai_messages').get().n, 21);
    assert.equal(db.prepare('SELECT insertion_order FROM task_activity ORDER BY insertion_order LIMIT 1').get()?.insertion_order,
      legacy.prepare('SELECT rowid FROM task_activity ORDER BY rowid LIMIT 1').get()?.rowid);
    await assert.rejects(migrateSqlite({ sourcePath, db, backupDir: join(dir, 'backups') }), /phải trống/);
    const snapshot = exportSnapshot(db);
    const broken = structuredClone(snapshot);
    const entry = broken.tables.workspace_members;
    entry.rows[0][entry.columns.indexOf('user_id')] = 'nonexistent';
    assert.throws(() => importSnapshot(db, broken, { replace: true }), error => error.code === '23503');
    assert.deepEqual(exportSnapshot(db), snapshot, 'failed restore rolls back all replaced rows');
    db.prepare("INSERT INTO ai_messages(conversation_id,role,content,created_at) VALUES ('chat','assistant','Tiếp tục','2026-09-01')").run();
    assert.equal(db.prepare('SELECT max(id) n FROM ai_messages').get().n, 22, 'identity state survives rollback');
    db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at)
      VALUES ('after-rollback',?,?,?,'task_reminder','Nhắc','Nội dung','2026-09-01')`).run(workspace.id, user.id, task.id);
    assert.equal(db.prepare("SELECT count(*) n FROM notification_outbox WHERE notification_id='after-rollback'").get().n, 1, 'triggers stay enabled after rollback');
  } finally { legacy.close(); db.close(); }
});


test('PostgreSQL simultaneous startups apply the baseline and create the initial admin only once', async () => {
  const db = openDatabase();
  const schema = 'test_startup_' + randomUUID().replaceAll('-', '');
  db.exec(`CREATE SCHEMA "${schema}"`);
  try {
    const command = "import {openDatabase} from './server/db.mjs'; const db=openDatabase(); db.close();";
    const options = { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_SCHEMA: schema,
      BOOTSTRAP_ADMIN_NAME: 'Startup admin', BOOTSTRAP_ADMIN_EMAIL: 'startup@example.com', BOOTSTRAP_ADMIN_PASSWORD: 'Startup-test-2026!' } };
    const results = await Promise.allSettled([1, 2].map(() => promisify(execFile)(process.execPath, ['--input-type=module', '-e', command], options)));
    for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
    assert.equal(db.prepare(`SELECT count(*) n FROM "${schema}".schema_migrations`).get().n, SCHEMA_VERSION);
    assert.equal(db.prepare(`SELECT count(*) n FROM "${schema}".users WHERE is_platform_admin=1`).get().n, 1);
    assert.equal(db.prepare(`SELECT count(*) n FROM "${schema}".admin_audit_logs WHERE action='admin.bootstrap'`).get().n, 1);
  } finally { db.exec(`DROP SCHEMA "${schema}" CASCADE`); db.close(); }
});

test('a schema 17 backup restores into schema 18 with every session marked as a password sign-in', () => {
  const source = openDatabase();
  seedDemo({ db: source, includeDemoAccount: true });
  const now = new Date().toISOString(), later = new Date(Date.now() + 86400000).toISOString();
  const { user_id, workspace_id } = source.prepare('SELECT user_id, workspace_id FROM workspace_members LIMIT 1').get();
  source.prepare("INSERT INTO sessions(id, token_hash, user_id, workspace_id, expires_at, created_at, kind, auth_method) VALUES (?, ?, ?, ?, ?, ?, 'web', 'google')")
    .run('ses_google_v17', 'hash-google-v17', user_id, workspace_id, later, now);
  source.prepare("INSERT INTO sessions(id, token_hash, user_id, workspace_id, expires_at, created_at, kind, auth_method) VALUES (?, ?, ?, ?, ?, ?, 'mobile', 'dev')")
    .run('ses_dev_v17', 'hash-dev-v17', user_id, workspace_id, later, now);
  const current = exportSnapshot(source);
  assert.equal(current.schemaVersion, 18);
  assert.deepEqual(current.tables.sessions.columns, TABLE_COLUMNS.sessions);
  const sessions = V17_TABLE_COLUMNS.sessions;
  assert.equal(sessions.includes('auth_method'), false);
  // An application at schema 17 had no auth_method column to export.
  const v17 = { ...current, schemaVersion: 17, tables: { ...current.tables,
    sessions: { columns: [...sessions], rows: current.tables.sessions.rows.map(row => row.slice(0, sessions.length)) } } };
  const upgraded = upgradeSnapshot(v17);
  assert.equal(upgraded.schemaVersion, 18);
  assert.deepEqual(upgraded.tables.sessions.columns, TABLE_COLUMNS.sessions);

  const target = openDatabase();
  try {
    importSnapshot(target, v17);
    const restored = target.prepare('SELECT id, auth_method FROM sessions ORDER BY id').all();
    assert.equal(restored.length, current.tables.sessions.rows.length);
    assert.ok(restored.length >= 2);
    assert.ok(restored.every(row => row.auth_method === 'password'), JSON.stringify(restored));
    assert.deepEqual(exportSnapshot(target).tables.sessions.rows.map(row => row.slice(0, sessions.length)),
      v17.tables.sessions.rows);
  } finally { target.close(); source.close(); }
});
