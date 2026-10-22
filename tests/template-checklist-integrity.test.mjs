import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';

const clock = () => new Date('2026-10-16T02:00:00.000Z');
async function fixture(t) {
  const s = await boot(t, { clock });
  const owner = await user(s, 'checklist-template-owner@example.test');
  const member = await user(s, 'checklist-template-member@example.test');
  addMember(s, owner, member);
  s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
  const api = (path, method = 'GET', body) => call(s, path, { cookie: owner.cookie, method, body });
  const created = await api('/projects', 'POST', { name: 'Checklist project', accessMode: 'private' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const project = created.body.project;
  assert.equal((await api(`/projects/${project.id}/members/${member.user.id}`, 'PUT', { role: 'editor' })).status, 200);
  const card = async title => {
    const result = await api('/tasks', 'POST', { title, projectId: project.id, assigneeId: owner.user.id, dueAt: '2030-01-01T10:00:00Z' });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const task = result.body.task;
    assert.equal((await api(`/tasks/${task.id}/extras`, 'PUT', { assigneeIds: [member.user.id], labelIds: [] })).status, 200);
    return (await api(`/tasks/${task.id}`)).body.task;
  };
  const source = await card('Checklist source'), target = await card('Checklist target');
  for (const title of ['Release', 'Verify']) {
    const list = await api(`/tasks/${source.id}/checklists`, 'POST', { title });
    assert.equal(list.status, 201, JSON.stringify(list.body));
    const items = [];
    for (const title of ['First step', 'Second step']) {
      const item = await api(`/tasks/${source.id}/checklists/${list.body.checklist.id}/items`, 'POST', { title });
      assert.equal(item.status, 201, JSON.stringify(item.body));
      assert.equal((await api(`/tasks/${source.id}/checklists/${list.body.checklist.id}/items/${item.body.item.id}`, 'PATCH', {
        assigneeIds: [owner.user.id, member.user.id], completed: title === 'First step',
        startAt: '2029-12-20', dueAt: '2029-12-21', remindAt: '2029-12-21T02:00:00.000Z',
      })).status, 200);
      items.push(item.body.item.id);
    }
    assert.equal((await api(`/tasks/${source.id}/checklists/${list.body.checklist.id}/order`, 'PUT', { ids: [...items].reverse() })).status, 200);
  }
  const saved = await api('/task-templates', 'POST', { name: 'Release checklist', kind: 'checklist', sourceTaskId: source.id });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  return { s, owner, member, api, source, target, project, templateId: saved.body.template.id };
}

function content(lists) {
  return lists.map(list => ({ title: list.title, items: list.items.map(item => ({
    title: item.title, completed: item.completed, startAt: item.startAt, dueAt: item.dueAt, remindAt: item.remindAt,
    assigneeIds: [...item.assigneeIds].sort(),
  })) }));
}

function assertNewIds(source, target) {
  const sourceIds = new Set(source.flatMap(list => [list.id, ...list.items.map(item => item.id)]));
  const targetIds = target.flatMap(list => [list.id, ...list.items.map(item => item.id)]);
  assert.equal(new Set(targetIds).size, targetIds.length);
  assert.ok(targetIds.every(id => !sourceIds.has(id)));
}

function snapshot(s) {
  return Object.fromEntries(['tasks', 'task_checklists', 'task_checklist_items', 'task_checklist_assignees', 'task_assignees',
    'workspace_members', 'project_members', 'task_activity', 'business_events', 'mutation_receipts', 'notifications',
    'notification_outbox', 'reminder_email_outbox', 'automation_event_queue', 'webhook_deliveries'].map(table =>
    [table, s.db.prepare(`SELECT * FROM ${table}`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
}

test('TC-W0-T03-B copying a task preserves checklist assignees, item values and ordering under new IDs', async t => {
  const { api, source } = await fixture(t);
  const before = (await api(`/tasks/${source.id}/detail`)).body.checklists;
  const copied = await api(`/tasks/${source.id}/copy`, 'POST', { operationId: 'checklist-copy-preserve-01' });
  assert.equal(copied.status, 201, JSON.stringify(copied.body));
  const after = (await api(`/tasks/${copied.body.task.id}/detail`)).body.checklists;
  assert.deepEqual(content(after), content(before));
  assertNewIds(before, after);
  assert.deepEqual((await api(`/tasks/${source.id}/detail`)).body.checklists, before);
});

test('TC-W0-T03-B applying a checklist template retains current primary and secondary item assignees', async t => {
  const { api, source, target, templateId } = await fixture(t);
  const before = (await api(`/tasks/${source.id}/detail`)).body.checklists;
  const applied = await api(`/task-templates/${templateId}/apply`, 'POST', {
    taskId: target.id, expectedRevision: target.revision, operationId: 'checklist-apply-preserve-01',
  });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  const after = (await api(`/tasks/${target.id}/detail`)).body.checklists;
  assert.deepEqual(content(after), content(before));
  assertNewIds(before, after);
});

test('TC-W0-T03-B template checklists append after existing positions and preserve source item order', async t => {
  const { s, api, source, target, templateId } = await fixture(t);
  const existingIds = [];
  for (const title of ['Existing first', 'Existing second']) {
    const result = await api(`/tasks/${target.id}/checklists`, 'POST', { title });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    existingIds.push(result.body.checklist.id);
    s.db.prepare('UPDATE task_checklists SET position=? WHERE id=?').run(existingIds.length * 10, result.body.checklist.id);
  }
  const existing = s.db.prepare('SELECT * FROM task_checklists WHERE task_id=? ORDER BY position').all(target.id);
  const revision = (await api(`/tasks/${target.id}`)).body.task.revision;
  const applied = await api(`/task-templates/${templateId}/apply`, 'POST', {
    taskId: target.id, expectedRevision: revision, operationId: 'checklist-apply-order-01',
  });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  const rows = s.db.prepare('SELECT * FROM task_checklists WHERE task_id=? ORDER BY position,created_at,id').all(target.id);
  assert.deepEqual(rows.map(row => row.title), ['Existing first', 'Existing second', 'Release', 'Verify']);
  assert.deepEqual(rows.slice(0, 2), existing);
  assert.deepEqual(rows.map(row => row.position), [10, 20, 21, 22]);
  const before = (await api(`/tasks/${source.id}/detail`)).body.checklists;
  const after = (await api(`/tasks/${target.id}/detail`)).body.checklists.slice(2);
  assert.deepEqual(content(after), content(before));
  assertNewIds(before, after);
});

test('TC-W1-T04-C/E revoked or out-of-scope template recipients cannot produce partial copies, grants or receipts', async t => {
  const { s, api, member, source, target, project, templateId } = await fixture(t);
  assert.equal((await api(`/projects/${project.id}/members/${member.user.id}`, 'DELETE')).status, 200);
  for (const [path, body] of [
    [`/tasks/${source.id}/copy`, { operationId: 'checklist-revoked-copy-01' }],
    [`/task-templates/${templateId}/apply`, { taskId: target.id, expectedRevision: target.revision, operationId: 'checklist-revoked-apply-01' }],
  ]) {
    const before = snapshot(s), result = await api(path, 'POST', body);
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.deepEqual(snapshot(s), before);
  }
  assert.equal((await api(`/projects/${project.id}/members/${member.user.id}`, 'PUT', { role: 'editor' })).status, 200);
  assert.equal((await api(`/tasks/${target.id}/extras`, 'PUT', { assigneeIds: [], labelIds: [] })).status, 200);
  const revision = (await api(`/tasks/${target.id}`)).body.task.revision;
  const before = snapshot(s);
  const result = await api(`/task-templates/${templateId}/apply`, 'POST', {
    taskId: target.id, expectedRevision: revision, operationId: 'checklist-outside-card-01',
  });
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.deepEqual(snapshot(s), before);
});
