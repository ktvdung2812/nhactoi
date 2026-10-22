import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';

const clock = () => new Date('2026-10-18T02:00:00.000Z');
const auth = actor => ({ userId: actor.user.id, workspaceId: actor.workspace.id });
const mutate = (s, actor, method, path, body) => s.app.locals.executeTaskMutation({ auth: auth(actor), method, path, body });

test('assistant commands share task/checklist receipts, revisions, recurrence and activity with HTTP writes', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'assistant-mutations@example.test');
  const createBody = { title: 'Recurring AI task', recurrence: 'daily', dueAt: '2026-10-20T02:00:00Z', operationId: 'assistant-create-task-01' };
  const created = mutate(s, owner, 'POST', '/api/tasks', createBody);
  assert.deepEqual(mutate(s, owner, 'POST', '/api/tasks', createBody), created);
  const task = created.task;
  const listBody = { title: 'Work', expectedRevision: created.taskRevision, operationId: 'assistant-create-list-01' };
  const list = mutate(s, owner, 'POST', `/api/tasks/${task.id}/checklists`, listBody);
  assert.deepEqual(mutate(s, owner, 'POST', `/api/tasks/${task.id}/checklists`, listBody), list);
  assert.notEqual(list.taskRevision, created.taskRevision);
  assert.throws(() => mutate(s, owner, 'POST', `/api/tasks/${task.id}/checklists`, { ...listBody, operationId: 'assistant-stale-list-01' }), { status: 409 });
  const item = mutate(s, owner, 'POST', `/api/tasks/${task.id}/checklists/${list.checklist.id}/items`, {
    title: 'One action', expectedRevision: list.taskRevision, operationId: 'assistant-create-item-01',
  });
  const updated = mutate(s, owner, 'PATCH', `/api/tasks/${task.id}/checklists/${list.checklist.id}/items/${item.item.id}`, {
    completed: true, expectedRevision: item.taskRevision, operationId: 'assistant-finish-item-01',
  });
  assert.equal(updated.item.completed, true);
  const finishBody = { status: 'done', expectedRevision: updated.taskRevision, operationId: 'assistant-finish-task-01' };
  const finished = mutate(s, owner, 'PATCH', `/api/tasks/${task.id}`, finishBody);
  assert.ok(finished.nextTask?.id);
  assert.deepEqual(mutate(s, owner, 'PATCH', `/api/tasks/${task.id}`, finishBody), finished);
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE generated_from_task_id=?').get(task.id).n, 1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_checklists WHERE task_id=?').get(task.id).n, 1);
  const events = s.db.prepare('SELECT source,actor_user_id FROM business_events WHERE task_id=?').all(task.id);
  assert.ok(events.length);
  assert.ok(events.every(event => event.source === 'ai_comment' && event.actor_user_id === owner.user.id));
  assert.equal((await call(s, `/tasks/${task.id}/detail`, { cookie: owner.cookie })).body.checklists[0].items[0].completed, true);
  assert.throws(() => mutate(s, owner, 'DELETE', `/api/tasks/${task.id}`, finishBody), { status: 400 });
});

test('assistant mutations recheck membership, project edit rights and subscription before receipt replay', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'assistant-owner@example.test');
  const viewer = await user(s, 'assistant-viewer@example.test');
  addMember(s, owner, viewer);
  const projectResponse = await call(s, '/projects', { cookie: owner.cookie, method: 'POST', body: { name: 'Restricted', accessMode: 'workspace' } });
  assert.equal(projectResponse.status, 201, JSON.stringify(projectResponse.body));
  const project = projectResponse.body.project;
  assert.equal((await call(s, `/projects/${project.id}/members/${viewer.user.id}`, { cookie: owner.cookie, method: 'PUT', body: { role: 'commenter' } })).status, 200);
  const body = { title: 'Owner task', projectId: project.id, operationId: 'assistant-restricted-01' };
  const created = mutate(s, owner, 'POST', '/api/tasks', body);
  const viewerInWorkspace = { ...viewer, workspace: owner.workspace };
  assert.throws(() => mutate(s, viewerInWorkspace, 'PATCH', `/api/tasks/${created.task.id}`, {
    title: 'Forbidden', operationId: 'assistant-no-edit-01', expectedRevision: created.taskRevision,
  }), { status: 403 });
  s.db.prepare('UPDATE users SET disabled_at=? WHERE id=?').run(clock().toISOString(), owner.user.id);
  assert.throws(() => mutate(s, owner, 'POST', '/api/tasks', body), { status: 403 });
  s.db.prepare('UPDATE users SET disabled_at=NULL WHERE id=?').run(owner.user.id);
  s.db.prepare("UPDATE subscriptions SET status='expired' WHERE workspace_id=?").run(owner.workspace.id);
  assert.throws(() => mutate(s, owner, 'POST', '/api/tasks', body), { status: 402 });
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE workspace_id=?').get(owner.workspace.id).n, 1);
});

test('assistant assigns collaborators and creates a dated checklist item through shared validation', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'assistant-assignment-owner@example.test');
  const member = await user(s, 'assistant-assignment-member@example.test');
  addMember(s, owner, member);
  const created = mutate(s, owner, 'POST', '/api/tasks', { title: 'Assignment', operationId: 'assistant-assignment-task-01' });
  const taskPath = `/api/tasks/${created.task.id}`;
  const extras = mutate(s, owner, 'PUT', `${taskPath}/extras`, {
    assigneeIds: [member.user.id], labelIds: [], expectedRevision: created.taskRevision, operationId: 'assistant-assignment-extras-01',
  });
  const list = mutate(s, owner, 'POST', `${taskPath}/checklists`, {
    title: 'Assigned work', expectedRevision: extras.taskRevision, operationId: 'assistant-assignment-list-01',
  });
  const itemPath = `${taskPath}/checklists/${list.checklist.id}/items`;
  const body = { title: 'Review', assigneeIds: [member.user.id], startAt: '2026-10-20', dueAt: '2026-10-21',
    expectedRevision: list.taskRevision, operationId: 'assistant-assignment-item-01' };
  const item = mutate(s, owner, 'POST', itemPath, body);
  assert.deepEqual(item.item.assigneeIds, [member.user.id]);
  assert.equal(item.item.startAt, '2026-10-20');
  assert.equal(item.item.dueAt, '2026-10-21');
  assert.deepEqual(mutate(s, owner, 'POST', itemPath, body), item);
  assert.equal(s.db.prepare("SELECT count(*) n FROM notifications WHERE task_id=? AND user_id=? AND type='checklist_assigned'").get(created.task.id, member.user.id).n, 1);
  assert.throws(() => mutate(s, owner, 'POST', itemPath, {
    ...body, startAt: '2026-10-22', operationId: 'assistant-invalid-dates-01', expectedRevision: item.taskRevision,
  }), { status: 400 });
  assert.throws(() => mutate(s, owner, 'POST', itemPath, {
    ...body, assigneeIds: [owner.user.id], operationId: 'assistant-invalid-assignee-01', expectedRevision: item.taskRevision,
  }), { status: 400 });
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_checklist_items WHERE checklist_id=?').get(list.checklist.id).n, 1);
});
