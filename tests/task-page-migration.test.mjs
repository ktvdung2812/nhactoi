import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user } from './roadmap-helpers.mjs';
import { openDatabase } from './database-helpers.mjs';
import { migrateDatabase, SCHEMA_VERSION, withTransaction } from '../server/db.mjs';
import { exportSnapshot, importSnapshot, upgradeSnapshot, validateSnapshot } from '../server/database-snapshot.mjs';
import { V14_TABLE_COLUMNS } from '../server/database-tables.mjs';

function historicalSnapshot(db) {
  return { format: 'nhactoi-postgresql', version: 1, schemaVersion: 13,
    tables: Object.fromEntries(Object.entries(V14_TABLE_COLUMNS).map(([table, columns]) => [table, {
      columns: [...columns], rows: db.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${table}"`).all().map(row => columns.map(column => row[column])),
    }])),
  };
}

// TC-W1-T01-A/B/D; TC-X07 index-only upgrade. This reconstructs the actual
// schema-13 database (no index and no migration-14 row), not just a version tag.
test('schema 13 task-page index upgrade preserves rows, receipt replay, ordering and old snapshots', async t => {
  let now = '2026-10-16T02:00:00Z';
  const s = await boot(t, { clock: () => new Date(now) });
  const target = openDatabase(); t.after(() => target.close());
  const owner = await user(s, 'index-upgrade@example.test');
  const other = await user(s, 'index-other@example.test');
  const api = (path, method = 'GET', body, actor = owner) => call(s, path, { method, body, cookie: actor.cookie });
  const payload = { title: 'Older doing', status: 'doing', dueAt: '2030-01-01T02:00:00Z', assigneeId: owner.user.id, operationId: 'schema13-index-receipt-0001' };
  const original = await api('/tasks', 'POST', payload);
  assert.equal(original.status, 201, JSON.stringify(original.body));
  const card = original.body.task;
  const create = async (title, status, dueAt, actor = owner) => {
    const result = await api('/tasks', 'POST', { title, status, dueAt }, actor);
    assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body.task;
  };
  now = '2026-10-16T03:00:00Z';
  const recent = await create('Newer doing, same due date', 'doing', payload.dueAt);
  const later = await create('Doing later', 'doing', '2030-01-02T02:00:00Z');
  const undated = await create('Doing without deadline', 'doing', null);
  const todoA = await create('Todo tie A', 'todo', '2029-12-01T02:00:00Z');
  const todoB = await create('Todo tie B', 'todo', '2029-12-01T02:00:00Z');
  const completed = await create('Done with oldest deadline', 'done', '2029-01-01T02:00:00Z');
  const removed = await create('Deleted doing must not enter partial index pages', 'doing', '2028-01-01T02:00:00Z');
  assert.equal((await api(`/tasks/${removed.id}`, 'DELETE')).status, 200);
  await create('Other workspace must not enter pages', 'doing', '2027-01-01T02:00:00Z', other);
  const checklist = await api(`/tasks/${card.id}/checklists`, 'POST', { title: 'Historical checklist identity' });
  assert.equal(checklist.status, 201);
  assert.equal((await api(`/tasks/${card.id}/checklists/${checklist.body.checklist.id}/items`, 'POST', { title: 'Historical item' })).status, 201);
  assert.equal((await api(`/tasks/${card.id}/comments`, 'POST', { body: 'Historical comment' })).status, 201);
  assert.equal((await api(`/tasks/${card.id}/attachments`, 'POST', { title: 'Historical link', url: 'https://example.test/history' })).status, 201);
  s.db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at)
    VALUES('index-history-notice',?,?,?,'task_reminder','Historical pending','Keep pending',?)`)
    .run(owner.workspace.id, owner.user.id, card.id, now);
  assert.ok(s.db.prepare('SELECT count(*) n FROM mutation_receipts').get().n > 0);
  assert.ok(s.db.prepare('SELECT count(*) n FROM business_events').get().n > 0);
  assert.ok(s.db.prepare("SELECT count(*) n FROM notification_outbox WHERE notification_id='index-history-notice'").get().n > 0);
  const expected = [recent.id, card.id, later.id, undated.id, ...[todoA.id, todoB.id].sort().reverse(), completed.id];
  const pages = async () => {
    const ids = [];
    for (let page = 1; page <= 4; page++) {
      const result = await api(`/tasks?page=${page}&pageSize=2`);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.total, expected.length);
      assert.equal(result.body.hasMore, page < 4);
      ids.push(...result.body.tasks.map(row => row.id));
    }
    assert.deepEqual(ids, expected, 'status, NULLS LAST, timestamp and ID tie ordering must all survive the index');
    return ids;
  };
  withTransaction(s.db, () => {
    // Reconstruct schema 13 physically, including removal of later additive
    // assistant schema, so the test still exercises a genuine index upgrade.
    s.db.exec('ALTER TABLE task_comments DROP CONSTRAINT task_comments_ai_run_fk');
    s.db.exec('DROP TABLE ai_comment_runs, workspace_ai_settings');
    s.db.exec('ALTER TABLE task_comments DROP COLUMN author_type, DROP COLUMN author_name_snapshot, DROP COLUMN reply_to_comment_id, DROP COLUMN ai_run_id, DROP COLUMN ai_metadata');
    s.db.exec('DROP INDEX tasks_active_page_order');
    s.db.prepare('DELETE FROM schema_migrations WHERE version>13').run();
  });
  assert.equal(s.db.prepare('SELECT max(version) n FROM schema_migrations').get().n, 13);
  const index = db => db.prepare("SELECT indexrelid::text id,indisvalid,indisready,pg_get_indexdef(indexrelid) definition FROM pg_index WHERE indexrelid=to_regclass('tasks_active_page_order')").get();
  assert.equal(index(s.db), undefined);
  await pages();
  const historical = historicalSnapshot(s.db);
  const frozen = structuredClone(historical);
  assert.equal(validateSnapshot(historical), historical);
  const upgraded = upgradeSnapshot(historical);
  assert.equal(upgraded.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(upgraded.tables.task_comments.rows, historical.tables.task_comments.rows.map(row => [...row, 'human', null, null, null, '{}']));
  assert.deepEqual(historical, frozen);

  // Failure after transactional CREATE INDEX must roll back both the index and
  // version ledger; fault injection stays in this DB adapter, never a route.
  const execute = s.db.exec;
  s.db.exec = sql => {
    const result = execute(sql);
    if (sql.includes('CREATE INDEX tasks_active_page_order')) throw new Error('injected after index creation');
    return result;
  };
  try { assert.throws(() => migrateDatabase(s.db, { bootstrapAdmin: false }), /injected after index creation/); }
  finally { s.db.exec = execute; }
  assert.equal(s.db.prepare('SELECT max(version) n FROM schema_migrations').get().n, 13);
  assert.equal(index(s.db), undefined);
  assert.deepEqual(historicalSnapshot(s.db).tables, historical.tables);

  migrateDatabase(s.db, { bootstrapAdmin: false });
  const firstIndex = index(s.db), migration = s.db.prepare('SELECT * FROM schema_migrations WHERE version=14').get();
  assert.ok(firstIndex?.indisvalid && firstIndex.indisready);
  assert.match(firstIndex.definition, /WHERE \(deleted_at IS NULL\)/);
  migrateDatabase(s.db, { bootstrapAdmin: false });
  assert.deepEqual(index(s.db), firstIndex, 'rerun does not rebuild the index');
  assert.deepEqual(s.db.prepare('SELECT * FROM schema_migrations WHERE version=14').all(), [migration]);
  assert.equal(s.db.prepare('SELECT max(version) n FROM schema_migrations').get().n, SCHEMA_VERSION);
  assert.deepEqual(exportSnapshot(s.db), upgraded, 'all rows, keys, revisions, receipts and pending effects remain byte-for-byte equal with new assistant defaults');
  await pages();
  const replay = await api('/tasks', 'POST', payload);
  assert.equal(replay.status, 201); assert.deepEqual(replay.body, original.body);
  assert.deepEqual(exportSnapshot(s.db), upgraded, 'receipt retry after migration causes no new mutation or effect');

  const empty = exportSnapshot(target);
  const invalid = structuredClone(historical); invalid.tables.tasks.columns.push('unexpected');
  assert.throws(() => importSnapshot(target, invalid), /Bản sao/);
  assert.deepEqual(exportSnapshot(target), empty);
  importSnapshot(target, historical);
  assert.deepEqual(exportSnapshot(target), upgradeSnapshot(historical));
  assert.ok(index(target)?.indisvalid);
  assert.equal(target.prepare('SELECT max(version) n FROM schema_migrations').get().n, SCHEMA_VERSION);
  assert.deepEqual(historical, frozen, 'restore never mutates the original schema-13 artifact');
});
