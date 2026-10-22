import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database-helpers.mjs';
import { migrateDatabase, SCHEMA_VERSION, withTransaction } from '../server/db.mjs';
import { exportSnapshot, importSnapshot, upgradeSnapshot, validateSnapshot } from '../server/database-snapshot.mjs';
import { V14_TABLE_COLUMNS } from '../server/database-tables.mjs';
import { seedDemo } from '../server/seed.mjs';
import { createBackup } from '../server/backups.mjs';
import { restoreBackup } from '../scripts/restore-backup.mjs';
import { outboundSendersPaused } from '../server/restore-safety.mjs';
import { removePersonalWorkspaceSchema } from './migration-helpers.mjs';

const at = '2026-10-18T02:00:00.000Z';
function schema14(snapshot) {
  return { ...snapshot, schemaVersion: 14, tables: Object.fromEntries(Object.entries(V14_TABLE_COLUMNS).map(([table, columns]) => [table, {
    columns: [...columns], rows: snapshot.tables[table].rows.map(row => columns.map(column => row[snapshot.tables[table].columns.indexOf(column)])),
  }])) };
}

test('assistant migration upgrades populated schema 14 atomically, preserves old comments and restores historical snapshots', t => {
  const db = openDatabase(), target = openDatabase();
  t.after(() => { db.close(); target.close(); });
  seedDemo({ db, clock: () => new Date(at) });
  const task = db.prepare('SELECT * FROM tasks LIMIT 1').get();
  db.prepare('INSERT INTO task_comments(id,task_id,body,created_at) VALUES (?,?,?,?)').run('historical-comment', task.id, '@vyvy ancient mention must not enqueue', at);
  const old = schema14(exportSnapshot(db)), frozen = structuredClone(old);
  withTransaction(db, () => {
    db.exec('ALTER TABLE task_comments DROP CONSTRAINT task_comments_ai_run_fk');
    db.exec('DROP TABLE ai_comment_runs, workspace_ai_settings');
    db.exec('ALTER TABLE task_comments DROP COLUMN author_type, DROP COLUMN author_name_snapshot, DROP COLUMN reply_to_comment_id, DROP COLUMN ai_run_id, DROP COLUMN ai_metadata');
    removePersonalWorkspaceSchema(db);
    db.prepare('DELETE FROM schema_migrations WHERE version>14').run();
  });
  const comments = db.prepare('SELECT * FROM task_comments').all();
  const execute = db.exec;
  db.exec = sql => {
    const result = execute(sql);
    if (sql.includes('CREATE TABLE ai_comment_runs')) throw new Error('fault after assistant migration writes');
    return result;
  };
  try { assert.throws(() => migrateDatabase(db, { bootstrapAdmin: false }), /fault after assistant migration/); }
  finally { db.exec = execute; }
  assert.equal(db.prepare('SELECT max(version) n FROM schema_migrations').get().n, 14);
  assert.equal(db.prepare("SELECT to_regclass('ai_comment_runs') relation").get().relation, null);
  assert.deepEqual(db.prepare('SELECT * FROM task_comments').all(), comments);
  migrateDatabase(db, { bootstrapAdmin: false });
  const migration = db.prepare('SELECT * FROM schema_migrations WHERE version=15').get();
  const upgraded = exportSnapshot(db);
  assert.deepEqual(upgraded, upgradeSnapshot(old));
  assert.equal(upgraded.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(upgraded.tables.ai_comment_runs.rows, [], 'historical mentions do not become new requests');
  assert.deepEqual(db.prepare("SELECT author_type,author_name_snapshot,reply_to_comment_id,ai_run_id,ai_metadata FROM task_comments WHERE id='historical-comment'").get(), {
    author_type: 'human', author_name_snapshot: null, reply_to_comment_id: null, ai_run_id: null, ai_metadata: '{}',
  });
  migrateDatabase(db, { bootstrapAdmin: false });
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version=15').get(), migration);
  assert.deepEqual(exportSnapshot(db), upgraded, 'repeated migration leaves rows and history unchanged');
  importSnapshot(target, old);
  assert.deepEqual(exportSnapshot(target), upgraded);
  assert.deepEqual(old, frozen, 'historical artifacts remain immutable');
  const invalid = structuredClone(old); invalid.tables.ai_comment_runs = upgraded.tables.ai_comment_runs;
  assert.throws(() => validateSnapshot(invalid), /Bản sao/, 'schema 14 rejects future tables');
});

test('assistant settings, durable progress and cyclic comment replies survive snapshot and offline backup restore', async t => {
  const db = openDatabase(), target = openDatabase();
  const directory = mkdtempSync(join(tmpdir(), 'nhactoi-ai-backup-'));
  t.after(() => { db.close(); target.close(); rmSync(directory, { recursive: true, force: true }); });
  seedDemo({ db, clock: () => new Date(at) });
  const task = db.prepare('SELECT * FROM tasks LIMIT 1').get();
  const member = db.prepare('SELECT user_id FROM workspace_members WHERE workspace_id=? LIMIT 1').get(task.workspace_id);
  const sources = JSON.stringify([{ id: 'task:' + task.id, type: 'task', taskId: task.id, status: 'read' }]);
  const actions = JSON.stringify([{ tool: 'create_checklist', status: 'completed', result: { checklistId: 'saved-checklist' } }]);
  withTransaction(db, () => {
    db.prepare('INSERT INTO workspace_ai_settings(workspace_id,name,handle,enabled,updated_at) VALUES (?,?,?,?,?)').run(task.workspace_id, 'Vyvy custom', 'custom_vyvy', 0, at);
    db.prepare('INSERT INTO task_comments(id,task_id,author_user_id,body,created_at) VALUES (?,?,?,?,?)').run('invocation', task.id, member.user_id, '@custom_vyvy tạo checklist', at);
    db.prepare(`INSERT INTO ai_comment_runs(id,workspace_id,project_id,task_id,comment_id,requested_by,request_body,assistant_name,assistant_handle,status,state_json,sources_json,actions_json,attempts,created_at,updated_at)
      VALUES ('run',?,?,?,?,?,?,?,'custom_vyvy','completed',?,?,?,1,?,?)`)
      .run(task.workspace_id, task.project_id, task.id, 'invocation', member.user_id, '@custom_vyvy tạo checklist', 'Vyvy custom', JSON.stringify({ round: 1, pending: { operations: [{ operationId: 'run:0:0', result: 'saved' }] } }), sources, actions, at, at);
    db.prepare(`INSERT INTO task_comments(id,task_id,body,created_at,author_type,author_name_snapshot,reply_to_comment_id,ai_run_id,ai_metadata)
      VALUES ('reply',?,'Đã tạo checklist',?,'assistant','Vyvy custom','invocation','run',?)`).run(task.id, at, JSON.stringify({ sources: JSON.parse(sources), actions: JSON.parse(actions) }));
    db.prepare("UPDATE ai_comment_runs SET reply_comment_id='reply' WHERE id='run'").run();
  });
  const original = exportSnapshot(db);
  importSnapshot(target, original);
  assert.deepEqual(exportSnapshot(target), original, 'both directions of run/comment references restore with deferred foreign keys');
  const corrupted = structuredClone(original);
  corrupted.tables.ai_comment_runs.rows[0][corrupted.tables.ai_comment_runs.columns.indexOf('reply_comment_id')] = 'missing-reply';
  assert.throws(() => importSnapshot(target, corrupted, { replace: true }), /foreign key/i);
  assert.deepEqual(exportSnapshot(target), original, 'invalid AI references roll back the complete restore');
  assert.throws(() => target.prepare(`INSERT INTO task_comments(id,task_id,body,created_at,author_type,ai_run_id) VALUES ('duplicate-reply',?,'Duplicate',?,'assistant','run')`).run(task.id, at), /unique/i);
  const settingsKey = randomBytes(32);
  const backup = await createBackup({ db, dbPath: join(directory, 'storage'), settingsKey });
  db.prepare("UPDATE workspace_ai_settings SET name='Changed',enabled=1").run();
  db.prepare("UPDATE ai_comment_runs SET state_json='{}',actions_json='[]',status='failed'").run();
  await restoreBackup({ db, dataDir: directory, backupId: backup.id, settingsKey });
  const restored = exportSnapshot(db);
  for (const table of ['workspace_ai_settings', 'ai_comment_runs', 'task_comments']) assert.deepEqual(restored.tables[table], original.tables[table], table);
  assert.equal(outboundSendersPaused(db), true, 'restoring progress cannot silently restart external work');
});
