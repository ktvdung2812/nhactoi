import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user, task, addMember } from './roadmap-helpers.mjs';
import { migrateDatabase } from './database-helpers.mjs';

const weekly = { interval: 2, weekdays: [1, 3], basis: 'due' };
test('advanced recurrence survives old clients, completion paths, copies, templates and board transfer', async t => {
  const s = await boot(t, { clock: () => new Date('2026-09-30T04:00:00Z') });
  const owner = await user(s, 'advanced@test.local'), cookie = owner.cookie;
  const create = async (overrides = {}) => {
    const r = await call(s, '/tasks', { cookie, method: 'POST', body: { title: 'Lặp nâng cao', dueAt: '2026-09-28T02:00:00Z', remindAt: '2026-09-28T01:00:00Z', recurrence: 'weekly', recurrenceOptions: weekly, ...overrides } });
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.task;
  };
  const patch = (id, body) => call(s, `/tasks/${id}`, { cookie, method: 'PATCH', body });
  const card = await create();
  const oldClient = await patch(card.id, { title: 'Đổi tên', recurrence: 'weekly' });
  assert.deepEqual(oldClient.body.task.recurrenceOptions, weekly);
  assert.equal((await patch(card.id, { dueAt: null })).status, 400);
  assert.equal((await patch(card.id, { recurrenceOptions: { interval: 0 } })).status, 400);
  const completed = await patch(card.id, { status: 'done' });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  let next = completed.body.nextTask;
  assert.equal(next.dueAt, '2026-09-30T02:00:00.000Z'); // Keeps past deadline despite late completion.
  assert.equal(next.remindAt, '2026-09-30T01:00:00.000Z');
  assert.deepEqual(next.recurrenceOptions, weekly);
  assert.equal((await patch(card.id, { status: 'done' })).body.nextTask, null);
  await patch(card.id, { status: 'todo' });
  assert.equal((await patch(card.id, { status: 'done' })).body.nextTask, null);
  const cols = (await call(s, '/boards', { cookie })).body.columns;
  const moved = await call(s, `/boards/tasks/${next.id}/move`, { cookie, method: 'POST', body: { columnId: cols.find(c => c.status === 'done').id } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  next = moved.body.nextTask;
  assert.equal(next.dueAt, '2026-10-12T02:00:00.000Z');
  const anchor = () => s.db.prepare('SELECT recurrence_anchor FROM tasks WHERE id=?').get(next.id).recurrence_anchor;
  assert.equal(anchor(), card.dueAt);
  await patch(next.id, { recurrenceOptions: weekly, title: 'Giữ mốc' });
  assert.equal(anchor(), card.dueAt);
  await patch(next.id, { dueAt: '2026-10-13T02:00:00Z' });
  assert.equal(anchor(), '2026-10-13T02:00:00.000Z');
  await patch(next.id, { recurrenceOptions: { ...weekly, interval: 3 } });
  assert.equal(anchor(), '2026-10-13T02:00:00.000Z');
  const copy = await call(s, `/tasks/${card.id}/copy`, { cookie, method: 'POST', body: { dueAt: '2026-11-02T02:00:00Z' } });
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.deepEqual((await call(s, `/tasks/${copy.body.task.id}`, { cookie })).body.task.recurrenceOptions, weekly);
  assert.equal(s.db.prepare('SELECT recurrence_anchor FROM tasks WHERE id=?').get(copy.body.task.id).recurrence_anchor, '2026-11-02T02:00:00.000Z');
  const template = await call(s, '/task-templates', { cookie, method: 'POST', body: { sourceTaskId: card.id, kind: 'task', name: 'Quy tắc' } });
  const fromTemplate = await call(s, `/task-templates/${template.body.template.id}/create`, { cookie, method: 'POST', body: { dueAt: '2026-11-02T02:00:00Z' } });
  assert.equal(fromTemplate.status, 201, JSON.stringify(fromTemplate.body));
  assert.deepEqual((await call(s, `/tasks/${fromTemplate.body.task.id}`, { cookie })).body.task.recurrenceOptions, weekly);
  // After-completion basis goes through the automation entrypoint too, including early completion.
  const early = await create({ dueAt: '2028-02-29T02:00:00Z', remindAt: null, recurrence: 'yearly', recurrenceOptions: { interval: 1, basis: 'completion' } });
  const rule = await call(s, '/automations', { cookie, method: 'POST', body: { name: 'Xong', trigger: 'manual', actions: [{ type: 'status', value: 'done' }] } });
  assert.equal((await call(s, `/automations/${rule.body.id}/run`, { cookie, method: 'POST', body: { taskId: early.id } })).body.ok, true);
  const successor = s.db.prepare('SELECT * FROM tasks WHERE generated_from_task_id=?').get(early.id);
  assert.equal(successor.due_at, '2027-09-30T04:00:00.000Z');
  assert.equal(successor.recurrence_anchor, successor.due_at);
  const after = await create({ recurrence: 'daily', recurrenceOptions: { interval: 2, basis: 'completion' } });
  assert.equal((await patch(after.id, { status: 'done' })).body.nextTask.dueAt, '2026-10-02T04:00:00.000Z');
  const exported = (await call(s, '/board-transfer', { cookie })).body;
  assert.deepEqual(exported.tasks.find(t => t.title === 'Đổi tên').recurrenceOptions, weekly);
  const result = await call(s, '/board-transfer', { cookie, method: 'POST', body: { data: exported } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok(s.db.prepare('SELECT count(*) n FROM tasks WHERE recurrence_anchor=?').get(card.dueAt).n >= 4);
  assert.equal((await patch(after.id, { recurrence: 'none' })).status, 200);
});

test('time blocks preserve reminders and user isolation, validate boundaries and enforce archived teams', async t => {
  const s = await boot(t), owner = await user(s, 'time@test.local'), member = await user(s, 'time-member@test.local');
  addMember(s, owner, member);
  const card = await task(s, owner);
  const cookie = owner.cookie;
  await call(s, `/tasks/${card.id}`, { cookie, method: 'PATCH', body: { assigneeId: owner.user.id, remindAt: '2029-12-31T10:00:00Z' } });
  await call(s, `/tasks/${card.id}/extras`, { cookie, method: 'PUT', body: { assigneeIds: [member.user.id], labelIds: [] } });
  const plan = body => call(s, `/tasks/${card.id}/plan`, { cookie, method: 'PATCH', body });
  const plannedDate = '2026-09-28';
  assert.equal((await plan({ plannedDate, plannedTime: '23:00', plannedDuration: 60 })).status, 200);
  assert.equal((await plan({ plannedDate: '2026-09-29' })).status, 200);
  let mine = (await call(s, '/personal-tasks', { cookie })).body.tasks[0];
  assert.equal(mine.plannedTime, '23:00'); assert.equal(mine.plannedDuration, 60);
  assert.equal(mine.dueAt, card.dueAt); assert.equal(mine.remindAt, '2029-12-31T10:00:00.000Z');
  assert.equal((await call(s, '/personal-tasks', { cookie: member.cookie })).body.tasks[0].plannedTime, null);
  for (const invalid of [{ plannedTime: '24:00' }, { plannedTime: '9:00' }, { plannedDuration: 0 }, { plannedDuration: 14 }, { plannedDuration: 1441 }, { plannedDuration: 60.5 }, { plannedTime: '23:30', plannedDuration: 60 }])
    assert.equal((await plan({ plannedDate, ...invalid })).status, 400, JSON.stringify(invalid));
  assert.equal((await plan({ plannedDate, plannedTime: null, plannedDuration: 1440 })).status, 200);
  assert.equal((await plan({ plannedDate: null })).status, 200);
  mine = (await call(s, '/personal-tasks', { cookie })).body.tasks[0];
  assert.equal(mine.plannedDate, null); assert.equal(mine.plannedTime, null);
  // The retained collaborator must also have access to the destination project.
  // Otherwise the move correctly fails before this test reaches archived planning.
  const team = await call(s, '/teams', { cookie, method: 'POST', body: { name: 'Lưu trữ', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }, { userId: member.user.id, role: 'member' }] } });
  assert.equal(team.status, 201, JSON.stringify(team.body));
  const move = await call(s, `/tasks/${card.id}`, { cookie, method: 'PATCH', body: { teamId: team.body.team.id, assigneeId: owner.user.id } });
  assert.equal(move.status, 200, JSON.stringify(move.body));
  assert.equal(s.db.prepare('SELECT team_id FROM tasks WHERE id=?').get(card.id).team_id, team.body.team.id);
  s.db.prepare('UPDATE teams SET archived_at=? WHERE id=?').run(new Date().toISOString(), team.body.team.id);
  assert.equal((await plan({ plannedDate })).status, 409);
});

test("[SQLite legacy] migration 30 preserves tasks, plans, dependencies and supports yearly recurrence", async t => {
  const s = await boot(t), owner = await user(s, 'upgrade30@test.local'), card = await task(s, owner), cookie = owner.cookie;
  await call(s, `/tasks/${card.id}`, { cookie, method: 'PATCH', body: { recurrence: 'monthly' } });
  await call(s, `/tasks/${card.id}/plan`, { cookie, method: 'PATCH', body: { plannedDate: '2030-01-02' } });
  await call(s, `/tasks/${card.id}/comments`, { cookie, method: 'POST', body: { body: 'Giữ' } });
  const sql = s.db.prepare("SELECT sql FROM sqlite_schema WHERE name='tasks'").get().sql;
  const objects = s.db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='tasks' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  s.db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE;');
  s.db.exec(sql.replace(/CREATE TABLE\s+"?tasks"?/i, 'CREATE TABLE tasks_v29').replace(/,\s*'yearly'/, ''));
  s.db.exec('INSERT INTO tasks_v29 SELECT * FROM tasks; DROP TABLE tasks; ALTER TABLE tasks_v29 RENAME TO tasks;');
  for (const object of objects) s.db.exec(object.sql);
  s.db.exec('ALTER TABLE tasks DROP COLUMN recurrence_options; ALTER TABLE tasks DROP COLUMN recurrence_anchor; ALTER TABLE personal_task_plans DROP COLUMN start_time; ALTER TABLE personal_task_plans DROP COLUMN duration_minutes; DELETE FROM schema_migrations WHERE version=30; COMMIT; PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;');
  migrateDatabase(s.db); migrateDatabase(s.db);
  assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(s.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_comments WHERE task_id=?').get(card.id).n, 1);
  const row = s.db.prepare('SELECT * FROM tasks WHERE id=?').get(card.id);
  assert.equal(row.recurrence_anchor, card.dueAt);
  const personal = (await call(s, '/personal-tasks', { cookie })).body.tasks[0];
  assert.equal(personal.plannedDate, '2030-01-02'); assert.equal(personal.plannedTime, null); assert.equal(personal.plannedDuration, 60);
  assert.equal((await call(s, `/tasks/${card.id}`, { cookie, method: 'PATCH', body: { recurrence: 'yearly' } })).status, 200);
});
