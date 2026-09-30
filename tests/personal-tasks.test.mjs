import test from 'node:test';
import assert from 'node:assert/strict';
import { addMember, boot, call, task, user } from './roadmap-helpers.mjs';
import { DEFAULT_REMINDER_POLICY } from '../server/reminder-workflow.mjs';
import { migrateDatabase } from './database-helpers.mjs';

test('undated tasks survive create, update, copy, template and board transfer without phantom reminders', async t => {
  const s = await boot(t), owner = await user(s, 'inbox@test.local');
  const create = await call(s, '/tasks', { cookie: owner.cookie, method: 'POST', body: { title: 'Ghi nhanh' } });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const id = create.body.task.id;
  assert.equal(create.body.task.dueAt, null);
  assert.equal((await call(s, `/tasks/${id}`, { cookie: owner.cookie, method: 'PATCH', body: { title: 'Chưa lên lịch', dueAt: null } })).status, 200);
  assert.equal((await call(s, '/tasks', { cookie: owner.cookie, method: 'POST', body: { title: 'Lặp thiếu hạn', recurrence: 'daily' } })).status, 400);
  assert.equal((await call(s, `/tasks/${id}`, { cookie: owner.cookie, method: 'PATCH', body: { recurrence: 'weekly' } })).status, 400);
  const copy = await call(s, `/tasks/${id}/copy`, { cookie: owner.cookie, method: 'POST', body: { dueAt: null } });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  const template = await call(s, '/task-templates', { cookie: owner.cookie, method: 'POST', body: { sourceTaskId: id, kind: 'task', name: 'Ghi nhanh' } });
  assert.equal(template.status, 201);
  const fromTemplate = await call(s, `/task-templates/${template.body.template.id}/create`, { cookie: owner.cookie, method: 'POST', body: { dueAt: null } });
  assert.equal(fromTemplate.status, 201, JSON.stringify(fromTemplate.body));
  const exported = await call(s, '/board-transfer', { cookie: owner.cookie });
  assert.equal(exported.status, 200);
  assert.ok(exported.body.tasks.every(t => t.dueAt === null));
  assert.equal((await call(s, '/board-transfer', { cookie: owner.cookie, method: 'POST', body: { data: exported.body } })).status, 201);
  const policy = await call(s, '/reminder-policy', { cookie: owner.cookie, method: 'PUT', body: { ...DEFAULT_REMINDER_POLICY, enabled: true } });
  assert.equal(policy.status, 200);
  assert.equal(s.app.locals.processReminders().length, 0);
  const patch = await call(s, `/tasks/${id}`, { cookie: owner.cookie, method: 'PATCH', body: { remindAt: new Date().toISOString() } });
  assert.equal(patch.status, 200);
  assert.equal(s.app.locals.processReminders().length, 1); // Explicit reminder remains independent of a deadline.
  assert.equal(s.app.locals.processReminders().length, 0);
  const done = await call(s, `/tasks/${id}`, { cookie: owner.cookie, method: 'PATCH', body: { status: 'done' } });
  assert.equal(done.status, 200);
});

test('personal plans isolate users and tenants, preserve deadlines, and enforce current access', async t => {
  const s = await boot(t), owner = await user(s, 'plan-owner@test.local'), member = await user(s, 'plan-member@test.local'), other = await user(s, 'plan-other@test.local');
  addMember(s, owner, member);
  const card = await task(s, owner, 'Việc chung');
  await call(s, `/tasks/${card.id}`, { cookie: owner.cookie, method: 'PATCH', body: { assigneeId: owner.user.id } });
  await call(s, `/tasks/${card.id}/extras`, { cookie: owner.cookie, method: 'PUT', body: { assigneeIds: [member.user.id], labelIds: [] } });
  const plan = (actor, date) => call(s, `/tasks/${card.id}/plan`, { cookie: actor.cookie, method: 'PATCH', body: { plannedDate: date } });
  assert.equal((await plan(owner, '2026-09-28')).status, 200);
  assert.equal((await plan(member, '2026-09-29')).status, 200);
  assert.equal((await plan(other, '2026-09-30')).status, 404);
  assert.equal((await plan(owner, '2026-02-30')).status, 400);
  assert.equal((await plan(owner, {})).status, 400);
  const list = async actor => (await call(s, '/personal-tasks', { cookie: actor.cookie })).body.tasks;
  assert.equal((await list(owner))[0].plannedDate, '2026-09-28');
  assert.equal((await list(member))[0].plannedDate, '2026-09-29');
  assert.equal((await list(owner))[0].dueAt, card.dueAt);
  assert.equal((await list(other)).length, 0);
  assert.equal((await plan(owner, null)).status, 200);
  assert.equal((await list(owner))[0].plannedDate, null);
  // Losing assignment removes the task from personal views without exposing another plan.
  await call(s, `/tasks/${card.id}/extras`, { cookie: owner.cookie, method: 'PUT', body: { assigneeIds: [], labelIds: [] } });
  assert.equal((await list(member)).length, 0);
  assert.equal((await plan(member, '2026-09-30')).status, 404);
  s.db.prepare("UPDATE subscriptions SET status='expired' WHERE workspace_id=?").run(owner.workspace.id);
  assert.equal((await plan(owner, '2026-09-30')).status, 402);
  assert.equal((await list(owner)).length, 1);
});

// Reconstruct the previous NOT NULL constraint in a disposable fixture only.
function previousSchema(db) {
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE;');
  const sql = db.prepare("SELECT sql FROM sqlite_schema WHERE name='tasks'").get().sql;
  const objects = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='tasks' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  db.exec(sql.replace(/CREATE TABLE\s+"?tasks"?/i, 'CREATE TABLE old_tasks').replace(/due_at\s+TEXT/i, 'due_at TEXT NOT NULL'));
  db.exec('INSERT INTO old_tasks SELECT * FROM tasks; DROP TABLE tasks; ALTER TABLE old_tasks RENAME TO tasks;');
  for (const object of objects) db.exec(object.sql);
  db.exec('DROP TABLE personal_task_plans; DELETE FROM schema_migrations WHERE version>=29; COMMIT; PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;');
}

test("[SQLite legacy] migration 29 preserves dependent records and triggers and reopens idempotently", async t => {
  const s = await boot(t), owner = await user(s, 'migration-plan@test.local'), card = await task(s, owner);
  const cookie = owner.cookie;
  assert.equal((await call(s, `/tasks/${card.id}/comments`, { cookie, method: 'POST', body: { body: 'Giữ bình luận' } })).status, 201);
  assert.equal((await call(s, `/tasks/${card.id}/checklists`, { cookie, method: 'POST', body: { title: 'Giữ checklist' } })).status, 201);
  const before = s.db.prepare('SELECT * FROM tasks').all();
  const objects = s.db.prepare("SELECT name FROM sqlite_schema WHERE tbl_name='tasks' AND type IN ('index','trigger') ORDER BY name").all();
  previousSchema(s.db);
  assert.equal(s.db.prepare('PRAGMA table_info(tasks)').all().find(c => c.name === 'due_at').notnull, 1);
  migrateDatabase(s.db);
  migrateDatabase(s.db);
  assert.deepEqual(s.db.prepare('SELECT * FROM tasks').all(), before);
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments').get().n, 1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_checklists').get().n, 1);
  assert.deepEqual(s.db.prepare("SELECT name FROM sqlite_schema WHERE tbl_name='tasks' AND type IN ('index','trigger') ORDER BY name").all(), objects);
  assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(s.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal((await call(s, `/tasks/${card.id}`, { cookie, method: 'PATCH', body: { dueAt: null } })).status, 200);
  assert.equal((await call(s, `/tasks/${card.id}/comments`, { cookie, method: 'POST', body: { body: 'Vẫn ghi được' } })).status, 201);
});

test("[SQLite legacy] failed migration rolls back the parent rebuild and restores foreign key enforcement", async t => {
  const s = await boot(t), owner = await user(s, 'rollback-plan@test.local'), card = await task(s, owner);
  previousSchema(s.db);
  s.db.exec('PRAGMA foreign_keys=OFF;');
  s.db.prepare('UPDATE tasks SET assignee_id=? WHERE id=?').run('missing-user', card.id);
  s.db.exec('PRAGMA foreign_keys=ON;');
  assert.throws(() => migrateDatabase(s.db), /foreign key validation/);
  assert.equal(s.db.prepare('PRAGMA table_info(tasks)').all().find(c => c.name === 'due_at').notnull, 1);
  assert.equal(s.db.prepare('SELECT title FROM tasks WHERE id=?').get(card.id).title, card.title);
  assert.equal(s.db.prepare('SELECT version FROM schema_migrations WHERE version=29').get(), undefined);
  assert.equal(s.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  s.db.prepare('UPDATE tasks SET assignee_id=NULL WHERE id=?').run(card.id);
  migrateDatabase(s.db);
  assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
});
