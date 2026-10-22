import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { openDatabase } from './database-helpers.mjs';
import { migrateDatabase, SCHEMA_VERSION, withTransaction } from '../server/db.mjs';
import { quoteIdentifier } from '../server/database-snapshot.mjs';

const at = '2026-10-16T02:00:00.000Z';
const migrationDirectory = new URL('../server/migrations/postgres/', import.meta.url);
const migrations = readdirSync(migrationDirectory).sort();
function applyHistorical(db, first, last) {
  withTransaction(db, () => {
    for (let version = first; version <= last; version++) {
      db.exec(readFileSync(new URL(migrations.find(name => name.startsWith(String(version).padStart(3, '0') + '-')), migrationDirectory), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, at);
    }
  });
}

function oldDatabase(t, version) {
  // Reuse the suite's unique schema registration/cleanup. Recreate only that
  // owned test schema, then execute original SQL; this is not a version-tag downgrade.
  const db = openDatabase(); t.after(() => db.close());
  assert.match(db.schema, /^test_[a-f0-9]{32}$/);
  db.exec(`DROP SCHEMA ${quoteIdentifier(db.schema)} CASCADE`);
  db.exec(`CREATE SCHEMA ${quoteIdentifier(db.schema)}`);
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  applyHistorical(db, 1, 2);
  const directory = mkdtempSync(join(tmpdir(), 'nhactoi-backfill-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'historical.txt'), bytes = Buffer.from('Tệp lịch sử — giữ nguyên\n');
  writeFileSync(file, bytes);
  for (const id of ['owner', 'other-owner']) db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)').run(id, id, id + '@backfill.test', 'unused', at);
  for (const [id, owner] of [['workspace', 'owner'], ['empty-workspace', 'owner'], ['other', 'other-owner']]) {
    db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)').run(id, id, at);
    db.prepare("INSERT INTO workspace_members VALUES (?,?,'owner',?)").run(id, owner, at);
  }
  for (const id of ['team-a', 'team-b', 'empty-team']) db.prepare("INSERT INTO teams(id,workspace_id,name,color,archived_at,created_at,updated_at) VALUES (?,'workspace',?,'blue',?,?,?)").run(id, id, id === 'team-b' ? at : null, at, at);
  const cards = [
    ['common-a', 'workspace', null, 'owner'], ['common-b', 'workspace', null, 'owner'],
    ['team-a1', 'workspace', 'team-a', 'owner'], ['team-a2', 'workspace', 'team-a', 'owner'],
    ['team-b1', 'workspace', 'team-b', 'owner'], ['other-task', 'other', null, 'other-owner'],
  ];
  for (const [id, workspace, team, owner] of cards) {
    db.prepare("INSERT INTO board_columns(id,workspace_id,team_id,name,status,created_at,updated_at) VALUES (?,?,?,'Trùng tên','todo',?,?)").run('column-' + id, workspace, team, at, at);
    db.prepare("INSERT INTO tasks(id,workspace_id,title,status,priority,recurrence,created_by,created_at,updated_at,team_id,column_id,due_at,recurrence_anchor) VALUES (?,?,?,'todo','medium','monthly',?,?,?,?,?,'2026-10-31T02:00:00.000Z','2026-10-31T02:00:00.000Z')").run(id, workspace, id, owner, at, at, team, 'column-' + id);
    db.prepare('INSERT INTO task_checklists(id,task_id,title,created_by,created_at,updated_at,position) VALUES (?,?,?,?,?,?,?)').run('check-' + id, id, 'Checklist', owner, at, at, 2);
    db.prepare('INSERT INTO task_checklist_items(id,checklist_id,title,completed,created_at,updated_at,position) VALUES (?,?,?,?,?,?,?)').run('item-' + id, 'check-' + id, 'Nội dung', 1, at, at, 3);
    db.prepare('INSERT INTO task_comments(id,task_id,author_user_id,body,created_at) VALUES (?,?,?,?,?)').run('comment-' + id, id, owner, 'Bình luận lịch sử', at);
    db.prepare("INSERT INTO task_attachments(id,task_id,title,url,created_by,created_at,kind,original_name,mime_type,size_bytes,storage_root,storage_key,comment_id) VALUES (?,?,?,?,?,?,'file','historical.txt','text/plain',?,?,?,?)").run('file-' + id, id, 'Tệp', '/historical.txt', owner, at, bytes.length, directory, 'historical.txt', 'comment-' + id);
    db.prepare("INSERT INTO personal_task_plans(task_id,user_id,planned_date,start_time,duration_minutes) VALUES (?,?,'2026-10-20','09:00',60)").run(id, owner);
  }
  for (const [id, workspace, name, owner] of [['shared', 'workspace', 'Khẩn', 'owner'], ['unused', 'workspace', 'Chưa dùng', 'owner'], ['other-shared', 'other', 'Khẩn', 'other-owner']]) {
    db.prepare("INSERT INTO task_labels(id,workspace_id,name,color,created_by,created_at,updated_at) VALUES (?,?,?,'blue',?,?,?)").run(id, workspace, name, owner, at, at);
  }
  for (const [id, workspace] of cards) db.prepare('INSERT INTO task_label_links VALUES (?,?,?)').run(id, workspace === 'workspace' ? 'shared' : 'other-shared', at);
  db.prepare("INSERT INTO task_templates(id,workspace_id,source_task_id,kind,name,payload_json,created_by,created_at,updated_at) VALUES ('template','workspace','team-a1','task','Nguồn team','{}','owner',?,?)").run(at, at);
  db.prepare("INSERT INTO automation_rules(id,workspace_id,team_id,name,trigger,actions,created_by,created_at) VALUES ('rule','workspace','team-a','Rule','task.created','[]','owner',?)").run(at);
  db.prepare("INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at) VALUES ('pending-notice','workspace','owner','common-a','task_reminder','Pending','Keep pending',?)").run(at);
  if (version === 5) {
    applyHistorical(db, 3, 5);
    db.prepare('UPDATE tasks SET aggregate_revision=37').run();
    db.prepare("INSERT INTO mutation_receipts(workspace_id,principal_id,operation_id,action,resource_id,payload_hash,response_status,response_json,committed_at) VALUES ('workspace','owner','old-operation','task.create','common-a','historical-hash',201,'{\"taskId\":\"common-a\"}',?)").run(at);
    db.prepare("INSERT INTO business_events(id,workspace_id,project_id,task_id,type,source,occurred_at,after_json) VALUES ('old-event','workspace','prj_ws_workspace','common-a','task.created','web',?,'{}')").run(at);
  }
  return { db, file, bytes };
}

function capture(db) {
  const tables = db.prepare('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename').all().map(row => row.tablename);
  return {
    rows: Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT to_jsonb(t) row FROM ${quoteIdentifier(table)} t ORDER BY to_jsonb(t)::text COLLATE "C"`).all().map(row => row.row)])),
    columns: db.prepare('SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name,ordinal_position').all(),
    indexes: db.prepare('SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY tablename,indexname').all(),
    triggers: db.prepare('SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=current_schema()::regnamespace AND NOT t.tgisinternal ORDER BY c.relname,t.tgname').all(),
    constraints: db.prepare('SELECT conrelid::regclass::text relation,conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace ORDER BY relation,conname').all(),
    functions: db.prepare("SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND prokind='f' ORDER BY proname").all(),
  };
}

async function competingStartup(t, db, oldVersion) {
  const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await control.connect(); t.after(() => control.end());
  await control.query(`SET search_path TO ${quoteIdentifier(db.schema)}`);
  const workers = [];
  for (const suffix of ['a', 'b']) {
    const applicationName = db.schema + '_migration_' + suffix;
    const child = fork(new URL('./fixtures/migration-startup.mjs', import.meta.url), [db.schema, applicationName], { silent: true });
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    t.after(async () => {
      if (child.exitCode !== null) return;
      const stopped = once(child, 'exit');
      child.send('close');
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      await stopped; clearTimeout(kill);
    });
    const message = () => Promise.race([once(child, 'message').then(([result]) => result), once(child, 'exit').then(() => { throw Error('Migration worker exited: ' + errors); })]);
    const ready = await message(); assert.equal(ready.type, 'ready');
    workers.push({ child, applicationName, ready, message });
  }
  assert.notEqual(workers[0].ready.pid, workers[1].ready.pid);
  assert.notEqual(workers[0].ready.backendPid, workers[1].ready.backendPid);
  await control.query('BEGIN');
  await control.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),31001)');
  const results = workers.map(worker => worker.message());
  for (const worker of workers) worker.child.send('start');
  try {
    const deadline = Date.now() + 15000;
    while (true) {
      // Bound parameter values are absent from pg_stat_activity.query.
      const locks = await control.query("SELECT count(*)::int n FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name=ANY($1) AND l.locktype='advisory' AND NOT l.granted AND l.objid=31001", [workers.map(worker => worker.applicationName)]);
      if (locks.rows[0].n === 2) break;
      assert.ok(Date.now() < deadline, 'both independent migration processes must reach the PostgreSQL advisory-lock barrier');
      await delay(20);
    }
  } finally { await control.query('COMMIT'); }
  const completed = await Promise.all(results);
  assert.ok(completed.every(result => result.type === 'done'));
  assert.deepEqual(completed.flatMap(result => result.applied).sort((a, b) => a - b), Array.from({ length: SCHEMA_VERSION - oldVersion }, (_, i) => oldVersion + i + 1), 'each unapplied migration executes once across both startup processes');
  assert.equal(completed.filter(result => result.applied.length > 0).length, 1, 'the competing startup reuses the committed ledger');
}

for (const version of [2, 5]) test(`TC-W1-T01-B schema ${version} backfill faults roll back exact data/schema, then competing startups migrate once`, async t => {
  const { db, file, bytes } = oldDatabase(t, version);
  const before = capture(db);
  assert.equal(before.rows.schema_migrations.length, version);
  assert.equal(before.rows.tasks.length, 6);
  assert.equal(before.rows.task_label_links.length, 6);
  const faults = version === 2 ? [{
    marker: "UPDATE tasks SET project_id = CASE WHEN team_id IS NULL THEN 'prj_ws_' || workspace_id ELSE 'prj_team_' || team_id END WHERE project_id IS NULL;",
    inspect() {
      assert.equal(db.prepare('SELECT count(*) n FROM tasks WHERE project_id IS NOT NULL').get().n, 6);
      assert.equal(db.prepare('SELECT count(*) n FROM board_columns WHERE project_id IS NULL').get().n, 6);
      assert.equal(db.prepare('SELECT count(*) n FROM projects').get().n, 6);
    },
  }] : [{
    marker: 'WHERE t.project_id<>l.project_id;',
    inspect() {
      assert.equal(db.prepare('SELECT count(*) n FROM task_labels').get().n, 5, 'one clone per distinct team project, not one per linked task');
      assert.equal(db.prepare("SELECT count(*) n FROM task_label_links WHERE label_id='shared'").get().n, 5);
    },
  }, {
    marker: 'FROM tasks t,task_labels l WHERE x.task_id=t.id AND x.label_id=l.id AND t.project_id<>l.project_id;',
    inspect() {
      assert.equal(db.prepare("SELECT label_id FROM task_label_links WHERE task_id='team-a1'").get().label_id, 'shared:prj_team_team-a');
      assert.equal(db.prepare("SELECT tgenabled FROM pg_trigger WHERE tgrelid='task_label_links'::regclass AND tgname='task_labels_revision'").get().tgenabled, 'D');
    },
  }];
  for (const fault of faults) {
    const execute = db.exec; let injected = false;
    db.exec = sql => {
      const offset = sql.indexOf(fault.marker);
      if (offset < 0) return execute(sql);
      execute(sql.slice(0, offset + fault.marker.length));
      injected = true; fault.inspect();
      throw new Error('injected after historical backfill write');
    };
    try { assert.throws(() => migrateDatabase(db, { bootstrapAdmin: false }), /injected after historical backfill write/); }
    finally { db.exec = execute; }
    assert.equal(injected, true, 'fault must occur after real SQL writes');
    assert.deepEqual(capture(db), before, 'rollback restores every row, ledger entry, column, index, constraint, function and trigger state');
    assert.deepEqual(readFileSync(file), bytes);
  }
  await competingStartup(t, db, version);
  const after = capture(db);
  assert.deepEqual(after.rows.schema_migrations.map(row => row.version).sort((a, b) => a - b), Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
  for (const [table, rows] of Object.entries(before.rows)) {
    if (['schema_migrations', 'task_labels', 'task_label_links'].includes(table)) continue;
    const columns = before.columns.filter(column => column.table_name === table).map(column => column.column_name);
    const project = row => Object.fromEntries(columns.map(column => [column, row[column]]));
    const sorted = values => values.map(project).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(sorted(after.rows[table]), sorted(rows), table + ' retains all historical columns, identities and relationships');
  }
  assert.equal(after.rows.projects.length, 6, 'empty workspace/team scopes get exactly one default project');
  for (const task of after.rows.tasks) assert.equal(task.project_id, task.team_id ? 'prj_team_' + task.team_id : 'prj_ws_' + task.workspace_id);
  for (const column of after.rows.board_columns) assert.equal(column.project_id, column.team_id ? 'prj_team_' + column.team_id : 'prj_ws_' + column.workspace_id);
  assert.equal(after.rows.board_columns.length, 6, 'identically named columns are not merged');
  assert.equal(after.rows.task_labels.length, 5);
  for (const original of before.rows.task_labels) {
    assert.deepEqual(after.rows.task_labels.find(label => label.id === original.id), { ...original, project_id: 'prj_ws_' + original.workspace_id });
  }
  for (const link of before.rows.task_label_links) {
    const task = after.rows.tasks.find(task => task.id === link.task_id);
    const labelId = task.team_id ? link.label_id + ':' + task.project_id : link.label_id;
    assert.deepEqual(after.rows.task_label_links.find(candidate => candidate.task_id === link.task_id), { ...link, label_id: labelId });
    const original = before.rows.task_labels.find(label => label.id === link.label_id);
    assert.deepEqual(after.rows.task_labels.find(label => label.id === labelId), { ...original, id: labelId, project_id: task.project_id });
  }
  assert.equal(after.rows.task_templates[0].project_id, 'prj_team_team-a', 'source task determines template scope despite legacy NULL team');
  assert.equal(after.rows.automation_rules[0].project_id, 'prj_team_team-a');
  assert.equal(after.rows.business_events.length, version === 5 ? 1 : 0, 'migration creates no synthetic successful business event');
  assert.equal(after.rows.mutation_receipts.length, version === 5 ? 1 : 0);
  for (const [table, rows] of Object.entries(after.rows)) if (!(table in before.rows) && table !== 'projects')
    assert.equal(rows.length, 0, table + ' contains no invented business history, receipt or queued effect');
  assert.deepEqual(readFileSync(file), bytes);
  migrateDatabase(db, { bootstrapAdmin: false });
  assert.deepEqual(capture(db), after, 'rerun is a complete no-op, including migration timestamps and side effects');
});
