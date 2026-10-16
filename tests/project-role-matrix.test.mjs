import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';

// FR-PROJECT §3.3–3.4, D-05; TC-W1-T04-A/B/C/D/E and TC-X02.
// A role's expected permission is declared here, independently of ACL helpers.
const roles = [
  { key: 'owner', visible: true, write: true, comment: true, manage: true, remove: true },
  { key: 'admin', visible: true, write: true, comment: true, manage: true, remove: true },
  { key: 'manager', visible: true, write: true, comment: true, manage: true, remove: true, projectRole: 'manager' },
  { key: 'editor', visible: true, write: true, comment: true, remove: true, projectRole: 'editor' },
  { key: 'commenter', visible: true, comment: true, projectRole: 'commenter' },
  { key: 'viewer', visible: true, projectRole: 'viewer' },
  { key: 'guest_editor', visible: true, write: true, comment: true, projectRole: 'editor', guest: true },
  { key: 'guest_commenter', visible: true, comment: true, projectRole: 'commenter', guest: true },
  { key: 'guest_viewer', visible: true, projectRole: 'viewer', guest: true },
  { key: 'ungranted_member' },
  { key: 'saas_admin', external: true },
  { key: 'other_workspace', external: true },
];
const clock = () => new Date('2026-10-16T02:00:00Z');
const canary = 'CANARY_ROLE_MATRIX_PRIVATE';
const effectTables = [
  'tasks', 'task_assignees', 'task_checklists', 'task_checklist_items', 'task_checklist_assignees',
  'task_comments', 'task_attachments', 'task_activity', 'task_reminder_responses', 'task_assignment_cycles',
  'business_events', 'mutation_receipts', 'notifications', 'notification_outbox', 'notification_outbox_deliveries',
  'reminder_email_outbox', 'web_push_deliveries', 'automation_event_queue', 'delivery_leases',
  'google_calendar_jobs', 'zalo_oa_deliveries', 'webhook_deliveries', 'project_views', 'project_members', 'trash_items',
];
const snapshot = db => Object.fromEntries(effectTables.map(table => [table,
  db.prepare(`SELECT * FROM ${table}`).all().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
]));

async function fixture(t) {
  const s = await boot(t, { clock }), actors = [];
  for (const policy of roles) actors.push({ ...policy, ...await user(s, `matrix-${policy.key}@example.test`) });
  const owner = actors[0], platform = actors.find(a => a.key === 'saas_admin');
  const api = (actor, path, method = 'GET', body) => call(s, path, { cookie: actor.cookie, method, body });
  for (const actor of actors) {
    // External accounts keep their own session/workspace. Business subscriptions
    // make empty report results prove tenant isolation rather than a plan denial.
    s.db.prepare("UPDATE subscriptions SET plan='business',current_period_end='2030-01-01' WHERE workspace_id=?").run(actor.workspace.id);
    if (actor === owner || actor.external) continue;
    addMember(s, owner, actor);
    s.db.prepare('UPDATE workspace_members SET role=?,member_type=? WHERE workspace_id=? AND user_id=?')
      .run(actor.key === 'admin' ? 'admin' : 'member', actor.guest ? 'guest' : 'member', owner.workspace.id, actor.user.id);
  }
  s.db.prepare('UPDATE users SET is_platform_admin=1 WHERE id=?').run(platform.user.id);
  assert.equal(s.db.prepare('SELECT count(*) n FROM workspace_members WHERE workspace_id=? AND user_id=?').get(owner.workspace.id, platform.user.id).n, 0);
  const created = await api(owner, '/projects', 'POST', { name: canary, accessMode: 'private' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const project = created.body.project;
  for (const actor of actors.filter(a => a.projectRole)) {
    const grant = await api(owner, `/projects/${project.id}/members/${actor.user.id}`, 'PUT', { role: actor.projectRole });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
  }
  // Owner/admin have no direct grant: their private access must be inherited.
  for (const actor of actors.filter(a => ['owner', 'admin'].includes(a.key)))
    assert.equal(s.db.prepare('SELECT count(*) n FROM project_members WHERE project_id=? AND user_id=?').get(project.id, actor.user.id).n, 0);
  const taskResult = await api(owner, '/tasks', 'POST', { title: canary, projectId: project.id, assigneeId: owner.user.id, dueAt: '2026-10-20T02:00:00Z' });
  assert.equal(taskResult.status, 201, JSON.stringify(taskResult.body));
  const task = taskResult.body.task;
  const assigned = actors.filter(a => a.visible && a !== owner).map(a => a.user.id);
  assert.equal((await api(owner, `/tasks/${task.id}/extras`, 'PUT', { assigneeIds: assigned, labelIds: [] })).status, 200);
  const checklist = (await api(owner, `/tasks/${task.id}/checklists`, 'POST', { title: canary + ' checklist' })).body.checklist;
  const item = (await api(owner, `/tasks/${task.id}/checklists/${checklist.id}/items`, 'POST', { title: canary + ' step' })).body.item;
  assert.equal((await api(owner, `/tasks/${task.id}/comments`, 'POST', { body: canary + ' comment' })).status, 201);
  const sharedView = await api(owner, `/projects/${project.id}/views`, 'POST', { name: canary + ' view', visibility: 'project', config: { layout: 'list' } });
  assert.equal(sharedView.status, 201, JSON.stringify(sharedView.body));
  const storage = await api(platform, '/admin/storage', 'PATCH', { enabled: true, maxFileSizeMb: 1, localPath: join(s.dir, 'matrix-files'), reason: 'isolated role matrix fixture' });
  assert.equal(storage.status, 200, JSON.stringify(storage.body));
  const upload = async actor => {
    const r = await fetch(s.base + `/api/tasks/${task.id}/files`, { method: 'POST', headers: { cookie: actor.cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'matrix.txt' }, body: canary + ' bytes' });
    return { status: r.status, body: await r.json() };
  };
  const file = await upload(owner); assert.equal(file.status, 201, JSON.stringify(file.body));
  const raw = async (actor, path) => {
    const r = await fetch(s.base + '/api' + path, { headers: { cookie: actor.cookie } });
    return { status: r.status, body: await r.text(), headers: r.headers };
  };
  return { s, actors, owner, api, project, task, checklist, item, view: sharedView.body.view, upload, file: file.body.attachment, raw };
}

async function assertReads(f, actor, visible) {
  const { api, project, task, raw, file, view } = f;
  const direct = [`/tasks/${task.id}`, `/tasks/${task.id}/detail`, `/tasks/${task.id}/extras`,
    `/tasks/${task.id}/collaboration`, `/tasks/${task.id}/reminders`, `/tasks/${task.id}/upload-policy`,
    `/projects/${project.id}`, `/projects/${project.id}/views`, `/projects/${project.id}/fields`,
    `/projects/${project.id}/dependencies`, `/projects/${project.id}/tasks?viewId=${view.id}`];
  for (const path of direct) {
    const r = await api(actor, path); assert.equal(r.status, visible ? 200 : 404, actor.key + ' ' + path + JSON.stringify(r.body));
    if (!visible) assert.ok(!JSON.stringify(r.body).includes(canary), path);
  }
  const detail = await api(actor, `/tasks/${task.id}/detail`);
  if (visible) {
    for (const token of [canary + ' checklist', canary + ' comment', 'matrix.txt'])
      assert.ok(JSON.stringify(detail.body).includes(token), actor.key + ' detail ' + token);
  }
  const download = await raw(actor, file.downloadUrl.replace(/^\/api/, ''));
  assert.equal(download.status, visible ? 200 : 404, actor.key + ' download');
  if (visible) {
    assert.equal(download.body, canary + ' bytes');
    assert.match(download.headers.get('cache-control'), /no-store/);
  } else assert.ok(!download.body.includes(canary));
  const search = await api(actor, `/tasks?q=${canary}&page=1&pageSize=20`);
  assert.equal(search.status, 200); assert.equal(search.body.total, visible ? 1 : 0, actor.key + ' search count');
  const operations = await api(actor, `/operations-dashboard?projectId=${project.id}`);
  assert.equal(operations.status, 200); assert.equal(operations.body.summary.taskCount, visible ? 1 : 0, actor.key + ' operations count');
  const portfolio = await api(actor, `/reports/portfolio?projectId=${project.id}`);
  assert.equal(portfolio.status, 200); assert.equal(portfolio.body.total, visible ? 1 : 0, actor.key + ' portfolio count');
  const sla = await api(actor, `/reports/sla?projectId=${project.id}`);
  assert.equal(sla.status, 200); assert.equal(sla.body.summary.taskCount, visible ? 1 : 0, actor.key + ' SLA count');
  const csv = await raw(actor, `/reports/sla?projectId=${project.id}&format=csv`);
  assert.equal(csv.status, 200); assert.equal(csv.body.includes(canary), visible, actor.key + ' CSV export');
  const legacy = await api(actor, '/board-transfer');
  assert.equal(legacy.status, actor.guest ? 403 : 200);
  assert.ok(!JSON.stringify(legacy.body).includes(canary), 'JSON v1 exports only the default board, never private projects');
  for (const r of [search, operations, portfolio, sla]) if (!visible) assert.ok(!JSON.stringify(r.body).includes(canary), actor.key + ' list/report canary');
}

async function mutation(f, actor, label, allowed, successStatus, run) {
  const before = allowed ? null : snapshot(f.s.db), result = await run();
  if (allowed) assert.equal(result.status, successStatus, actor.key + ' ' + label + JSON.stringify(result.body));
  else {
    assert.ok([403, 404, 409].includes(result.status), actor.key + ' ' + label + ': permission denial expected, got ' + result.status + ' ' + JSON.stringify(result.body));
    assert.deepEqual(snapshot(f.s.db), before, actor.key + ' denied ' + label + ' changed business/event/receipt/outbox');
    assert.ok(!JSON.stringify(result.body).includes(canary), actor.key + ' denial leaked private content');
  }
  return result;
}

test('private project HTTP role matrix protects children, files, counts, exports, writes and current grants', async t => {
  const f = await fixture(t), { s, actors, owner, api, project, task, checklist, item } = f;
  for (const actor of actors) await t.test(actor.key + ' reads and aggregate scope', () => assertReads(f, actor, !!actor.visible));
  for (const actor of actors) await t.test(actor.key + ' mutation and trash permissions', async () => {
    const create = await mutation(f, actor, 'create task', actor.write, 201, () => api(actor, '/tasks', 'POST', { title: 'Matrix create probe', projectId: project.id, operationId: randomUUID() }));
    if (actor.write) assert.equal((await api(owner, `/tasks/${create.body.task.id}`, 'DELETE')).status, 200);
    await mutation(f, actor, 'task content', actor.write, 200, () => api(actor, `/tasks/${task.id}`, 'PATCH', { title: canary + ' ' + actor.key, operationId: randomUUID() }));
    await mutation(f, actor, 'checklist item', actor.write, 200, () => api(actor, `/tasks/${task.id}/checklists/${checklist.id}/items/${item.id}`, 'PATCH', { title: canary + ' step ' + actor.key }));
    await mutation(f, actor, 'comment', actor.comment, 201, () => api(actor, `/tasks/${task.id}/comments`, 'POST', { body: canary + ' comment ' + actor.key }));
    await mutation(f, actor, 'link attachment', actor.write, 201, () => api(actor, `/tasks/${task.id}/attachments`, 'POST', { title: 'Matrix link', url: 'https://example.test/fixture' }));
    await mutation(f, actor, 'file upload', actor.write, 201, () => f.upload(actor));
    await mutation(f, actor, 'acknowledge own assignment', actor.comment, 200, () => api(actor, `/tasks/${task.id}/reminders/acknowledge`, 'POST', {}));
    await mutation(f, actor, 'project shared view', actor.manage, 201, () => api(actor, `/projects/${project.id}/views`, 'POST', { name: 'Matrix shared ' + actor.key, visibility: 'project', config: { layout: 'list' } }));
    const viewer = actors.find(a => a.key === 'viewer');
    await mutation(f, actor, 'internal project membership', actor.manage, 200, () => api(actor, `/projects/${project.id}/members/${viewer.user.id}`, 'PUT', { role: 'viewer' }));
    if (actor.guest) for (const path of ['/customers', '/services', '/transactions', '/members', '/billing', '/automations', '/integrations/google-calendar', '/integrations/zalo-oa']) {
      const forbidden = await api(actor, path); assert.equal(forbidden.status, 403, path); assert.ok(!JSON.stringify(forbidden.body).includes(canary));
    }
    const probe = await api(owner, '/tasks', 'POST', { title: 'Matrix trash probe ' + actor.key, projectId: project.id });
    assert.equal(probe.status, 201, JSON.stringify(probe.body));
    await mutation(f, actor, 'delete task', actor.remove, 200, () => api(actor, `/tasks/${probe.body.task.id}`, 'DELETE'));
    if (!actor.remove) assert.equal((await api(owner, `/tasks/${probe.body.task.id}`, 'DELETE')).status, 200);
    const trash = s.db.prepare('SELECT id FROM trash_items WHERE entity_id=?').get(probe.body.task.id);
    const list = await api(actor, '/trash');
    assert.equal(list.status, actor.guest ? 403 : 200, actor.key + ' trash list');
    if (!actor.guest) assert.equal(list.body.items.some(row => row.id === trash.id), !!actor.remove, actor.key + ' own deletion visibility');
    if (!actor.guest && !['owner', 'admin'].includes(actor.key))
      assert.equal(list.body.total, actor.remove ? 1 : 0, actor.key + ' cannot count other users\' deleted tasks');
    const detail = await api(actor, `/trash/${trash.id}`);
    assert.equal(detail.status, actor.remove ? 200 : actor.guest ? 403 : 404, actor.key + ' trash detail');
    await mutation(f, actor, 'restore own deletion', actor.remove, 200, () => api(actor, '/trash/restore', 'POST', { ids: [trash.id] }));
    if (actor.remove) assert.equal((await api(actor, `/tasks/${probe.body.task.id}`, 'DELETE')).status, 200);
  });
  // A newly issued API call must use the current grant, including cached file
  // URLs/views. Offline revocation timing and in-flight streams are separate tests.
  for (const actor of actors.filter(a => a.projectRole)) await t.test(actor.key + ' after grant revocation', async () => {
    assert.equal((await api(owner, `/projects/${project.id}/members/${actor.user.id}`, 'DELETE')).status, 200);
    await assertReads(f, actor, false);
    await mutation(f, actor, 'revoked task edit', false, 200, () => api(actor, `/tasks/${task.id}`, 'PATCH', { title: 'revoked write', operationId: randomUUID() }));
    const trash = await api(actor, '/trash');
    assert.equal(trash.status, actor.guest ? 403 : 200);
    if (!actor.guest) assert.equal(trash.body.total, 0, actor.key + ' revoked access hides even own prior deletions');
  });
  const admin = actors.find(a => a.key === 'admin');
  s.db.prepare("UPDATE workspace_members SET role='member' WHERE workspace_id=? AND user_id=?").run(owner.workspace.id, admin.user.id);
  await t.test('former workspace admin loses implicit private access', () => assertReads(f, admin, false));
  assert.equal((await api(owner, `/tasks/${task.id}/detail`)).status, 200);
});
