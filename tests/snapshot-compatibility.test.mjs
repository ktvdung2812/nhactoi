import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { openDatabase } from './database-helpers.mjs';
import { migrateDatabase } from '../server/db.mjs';
import { V2_TABLE_COLUMNS } from '../server/database-tables.mjs';
import { seedDemo } from '../server/seed.mjs';
import { exportSnapshot, importSnapshot, upgradeSnapshot, validateSnapshot } from '../server/database-snapshot.mjs';
import { createBackup, inspectBackup, backupRoot } from '../server/backups.mjs';
import { restoreBackup } from '../scripts/restore-backup.mjs';

function versionOne(snapshot) {
  const old = structuredClone(snapshot);
  old.schemaVersion = 1;
  old.tables = Object.fromEntries(Object.entries(V2_TABLE_COLUMNS).map(([table, columns]) => [table, {
    columns: [...columns], rows: old.tables[table].rows.map(row => columns.map(column => row[old.tables[table].columns.indexOf(column)])),
  }]));
  const context = old.tables.reminder_notice_context;
  const index = context.columns.indexOf('schedule_key');
  context.columns.splice(index, 1);
  context.rows.forEach(row => row.splice(index, 1));
  return old;
}

function fixture(db) {
  seedDemo({ db, clock: () => new Date('2026-09-01T00:00:00Z') });
  const task = db.prepare('SELECT * FROM tasks LIMIT 1').get();
  const user = db.prepare('SELECT * FROM workspace_members WHERE workspace_id=? LIMIT 1').get(task.workspace_id);
  const insertNotice = db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at)
    VALUES (?,?,?,?,?,'Nhắc','Nội dung',?)`);
  const insertClaim = db.prepare('INSERT INTO task_reminder_deliveries(id,task_id,user_id,schedule_key,created_at) VALUES (?,?,?,?,?)');
  for (const [name, date, schedules] of [
    ['one', '2026-09-01T01:00:00Z', ['workflow:one']],
    ['many', '2026-09-01T02:00:00Z', ['workflow:two', 'workflow:three', 'workflow:four']],
    ['none', '2026-09-01T03:00:00Z', []],
  ]) {
    insertNotice.run(name, task.workspace_id, user.user_id, task.id, 'task_reminder', date);
    for (const schedule of schedules) insertClaim.run(schedule, task.id, user.user_id, schedule, date);
  }
  // Other notification kinds must not acquire a made-up reminder source.
  insertNotice.run('other', task.workspace_id, user.user_id, task.id, 'task_assigned', '2026-09-01T01:00:00Z');
  db.prepare('INSERT INTO reminder_notice_context(notification_id) VALUES (?)').run('other');
}

test('schema 1 snapshot upgrades match migration 002 without mutating history or replaying notifications', () => {
  const source = openDatabase(), target = openDatabase();
  try {
    fixture(source);
    const old = versionOne(exportSnapshot(source));
    const original = structuredClone(old);
    const upgraded = upgradeSnapshot(old);
    assert.deepEqual(old, original, 'the original backup remains unchanged');
    const context = upgraded.tables.reminder_notice_context;
    assert.deepEqual(Object.fromEntries(context.rows.filter(row => ['one', 'many', 'none', 'other'].includes(row[0])).map(row => [row[0], row.at(-1)])), {
      one: 'workflow:one', many: 'legacy:unknown', none: 'legacy:unknown', other: null,
    });

    source.exec('ALTER TABLE reminder_notice_context DROP COLUMN schedule_key');
    source.exec(readFileSync(new URL('../server/migrations/postgres/002-reminder-source.sql', import.meta.url), 'utf8'));
    const migrated = exportSnapshot(source).tables.reminder_notice_context;
    assert.deepEqual(migrated.columns, context.columns);
    assert.deepEqual(migrated.rows.sort(), [...context.rows].sort(), 'snapshot and live database upgrades agree');
    const counts = importSnapshot(target, old);
    for (const [table, entry] of Object.entries(old.tables)) {
      assert.equal(counts[table], entry.rows.length, table);
      assert.equal(target.prepare(`SELECT count(*) n FROM "${table}"`).get().n, entry.rows.length, table);
    }
    assert.deepEqual(exportSnapshot(target), upgraded, 'IDs, relationships and pending/sent history survive the upgrade');
    const beforeFailure = exportSnapshot(target);
    assert.throws(() => importSnapshot(target, old, { replace: true, afterImport() { throw new Error('fault after import'); } }), /fault after import/);
    assert.deepEqual(exportSnapshot(target), beforeFailure, 'failed upgrade and restore roll back together');
    assert.throws(() => importSnapshot(target, old), /phải trống/);
  } finally { source.close(); target.close(); }
});

test('snapshot compatibility never relaxes table/column/value checks or accepts future versions', () => {
  const db = openDatabase();
  try {
    const current = exportSnapshot(db);
    const old = versionOne(current);
    assert.equal(validateSnapshot(old), old);
    assert.equal(upgradeSnapshot(current), current);
    for (const change of [
      snapshot => { snapshot.schemaVersion = 999; },
      snapshot => { snapshot.schemaVersion = '1'; },
      snapshot => { snapshot.schemaVersion = 0; },
      snapshot => { snapshot.version = 2; },
      snapshot => { delete snapshot.tables.users; },
      snapshot => { snapshot.tables.unexpected = { columns: [], rows: [] }; },
      snapshot => { snapshot.tables.reminder_notice_context.columns.push('schedule_key'); },
      snapshot => { snapshot.tables.users.columns[0] = 'unexpected'; },
      snapshot => { snapshot.tables.users.rows.push([]); },
      snapshot => { snapshot.tables.users.rows.push(snapshot.tables.users.columns.map(() => ({}))); },
    ]) {
      const invalid = structuredClone(old); change(invalid);
      assert.throws(() => importSnapshot(db, invalid), /Bản sao/);
      assert.deepEqual(exportSnapshot(db), current, 'invalid backups cannot alter the destination');
    }
  } finally { db.close(); }
});

test('old schema backup manifests retain checksum validation and restore through the normal offline path', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'nhactoi-old-backup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = openDatabase();
  try {
    fixture(db);
    const file = Buffer.from('Tệp lịch sử được giữ nguyên');
    writeFileSync(join(directory, 'upload.bin'), file);
    const task = db.prepare('SELECT id FROM tasks LIMIT 1').get();
    db.prepare(`INSERT INTO task_attachments(id,task_id,title,url,created_at,kind,original_name,mime_type,size_bytes,storage_root,storage_key)
      VALUES ('old-file',?,'Tệp cũ','/old-file','2026-09-01','file','cũ.txt','text/plain',?,?,'upload.bin')`).run(task.id, file.length, directory);
    const storagePath = join(directory, 'storage');
    const backup = await createBackup({ db, dbPath: storagePath, settingsKey: randomBytes(32) });
    const dir = join(backupRoot(storagePath), backup.id);
    const databasePath = join(dir, 'database.json');
    const old = versionOne(exportSnapshot(db));
    writeFileSync(databasePath, JSON.stringify(old));
    assert.throws(() => inspectBackup(storagePath, backup.id), /toàn vẹn/, 'schema upgrades do not bypass the file checksum');
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // Simulate a plaintext version 2 backup written before encryption.
    manifest.version = 2;
    delete manifest.databaseEncrypted;
    manifest.databaseSha256 = createHash('sha256').update(readFileSync(databasePath)).digest('hex');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.equal(inspectBackup(storagePath, backup.id).manifest.id, backup.id);
    const pending = db.prepare('SELECT * FROM notification_outbox ORDER BY id').all();
    await restoreBackup({ db, dataDir: directory, backupId: backup.id });
    assert.deepEqual(db.prepare('SELECT * FROM notification_outbox ORDER BY id').all(), pending);
    assert.equal(db.prepare("SELECT schedule_key FROM reminder_notice_context WHERE notification_id='one'").get().schedule_key, 'workflow:one');
    assert.equal(db.prepare("SELECT schedule_key FROM reminder_notice_context WHERE notification_id='many'").get().schedule_key, 'legacy:unknown');
    const restored = db.prepare("SELECT * FROM task_attachments WHERE id='old-file'").get();
    assert.equal(restored.task_id, task.id);
    assert.notEqual(restored.storage_root, directory);
    assert.deepEqual(readFileSync(join(restored.storage_root, restored.storage_key)), file);
  } finally { db.close(); }
});
