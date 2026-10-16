import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { boot, call, user, task, addMember } from './roadmap-helpers.mjs';

const clock = () => new Date('2026-10-16T02:00:00.000Z');
const post = (s, actor, path, body) => call(s, path, { cookie: actor.cookie, method: 'POST', body });
const getTask = async (s, actor, id) => (await call(s, `/tasks/${id}`, { cookie: actor.cookie })).body.task;

async function templates(s, actor) {
  const source = await task(s, actor, 'Template source');
  const checklist = await post(s, actor, `/tasks/${source.id}/checklists`, { title: 'Release' });
  assert.equal(checklist.status, 201, JSON.stringify(checklist.body));
  assert.equal((await post(s, actor, `/tasks/${source.id}/checklists/${checklist.body.checklist.id}/items`, { title: 'Verify release' })).status, 201);
  const result = { source };
  for (const kind of ['task', 'checklist']) {
    const saved = await post(s, actor, '/task-templates', { name: `${kind} template`, kind, sourceTaskId: source.id });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    result[kind] = saved.body.template.id;
  }
  return result;
}

function state(s) {
  // Database-backed side effects must roll back with business data and receipt.
  return Object.fromEntries(['tasks', 'task_checklists', 'task_checklist_items', 'task_activity', 'business_events',
    'mutation_receipts', 'notifications', 'notification_outbox', 'notification_outbox_deliveries',
    'reminder_email_outbox', 'automation_runs', 'webhook_deliveries'].map(table =>
    [table, s.db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]));
}

test('TC-W1-T09-A/C task template create replays one result, rejects changed payload and preserves legacy calls', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'template-receipt@example.test');
  const fixture = await templates(s, owner), path = `/task-templates/${fixture.task}/create`;
  const body = { dueAt: '2030-02-01T03:00:00Z', operationId: 'template-create-retry-01' };
  const first = await post(s, owner, path, body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const before = state(s), retry = await post(s, owner, path, body);
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.body, first.body);
  assert.deepEqual(state(s), before);
  assert.equal(first.body.taskRevision, (await getTask(s, owner, first.body.task.id)).revision);
  assert.equal((await post(s, owner, path, { ...body, dueAt: '2030-02-02T03:00:00Z' })).status, 409);
  assert.deepEqual(state(s), before);
  const legacy = await post(s, owner, path, { dueAt: body.dueAt });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assert.notEqual(legacy.body.task.id, first.body.task.id);
  const events = s.db.prepare('SELECT * FROM business_events WHERE task_id=?').all(first.body.task.id);
  assert.ok(events.some(e => e.type === 'task.created'));
  for (const event of events) {
    assert.equal(event.actor_user_id, owner.user.id);
    assert.equal(event.source, 'web');
    assert.equal(event.operation_id, body.operationId);
    assert.equal(event.occurred_at, clock().toISOString());
  }
});

test('TC-W1-T08-A/B template apply checks target aggregate revision and retries its exact committed result', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'template-revision@example.test');
  const fixture = await templates(s, owner), target = await task(s, owner, 'Template target');
  const path = `/task-templates/${fixture.checklist}/apply`;
  const body = { taskId: target.id, expectedRevision: target.revision, operationId: 'template-apply-retry-01' };
  const first = await post(s, owner, path, body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.checklist.items.length, 1);
  const current = await getTask(s, owner, target.id);
  assert.notEqual(current.revision, target.revision);
  assert.equal(first.body.taskRevision, current.revision);
  const before = state(s), retry = await post(s, owner, path, body);
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.body, first.body);
  assert.deepEqual(state(s), before);
  const stale = await post(s, owner, path, { ...body, operationId: 'template-apply-stale-01' });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.details.code, 'revision_conflict');
  assert.deepEqual(state(s), before);
  assert.equal((await post(s, owner, path, { ...body, expectedRevision: current.revision })).status, 409);
  assert.deepEqual(state(s), before);
});

test('TC-W1-T09-D template receipt replay rechecks template and created or target task ACL', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'template-acl-owner@example.test');
  const editor = await user(s, 'template-acl-editor@example.test'), outsider = await user(s, 'template-acl-outsider@example.test');
  addMember(s, owner, editor);
  s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
  const fixture = await templates(s, owner), target = await task(s, owner, 'Apply target');
  const privateProject = await post(s, owner, '/projects', { name: 'Owner private', accessMode: 'private' });
  assert.equal(privateProject.status, 201, JSON.stringify(privateProject.body));
  for (const kind of ['create', 'apply']) {
    const path = `/task-templates/${kind === 'create' ? fixture.task : fixture.checklist}/${kind}`;
    const body = { operationId: `template-acl-${kind}-01`, ...(kind === 'create' ? {} : { taskId: target.id, expectedRevision: target.revision }) };
    const result = await post(s, editor, path, body);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const id = kind === 'create' ? result.body.task.id : target.id;
    const moved = await call(s, `/tasks/${id}`, { method: 'PATCH', cookie: owner.cookie, body: { projectId: privateProject.body.project.id } });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const before = state(s);
    assert.equal((await post(s, editor, path, body)).status, 404);
    assert.equal((await post(s, outsider, path, body)).status, 404);
    assert.deepEqual(state(s), before);
  }
  const path = `/task-templates/${fixture.task}/create`, body = { operationId: 'template-source-acl-01' };
  assert.equal((await post(s, editor, path, body)).status, 201);
  s.db.prepare('DELETE FROM task_templates WHERE id=?').run(fixture.task);
  const before = state(s);
  assert.equal((await post(s, editor, path, body)).status, 404);
  assert.deepEqual(state(s), before);

  // The result can remain visible after only the template's permission is lost.
  s.db.prepare('INSERT INTO project_members(project_id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)')
    .run(privateProject.body.project.id, owner.workspace.id, editor.user.id, 'editor', clock().toISOString());
  const privateSource = await post(s, owner, '/tasks', { title: 'Private template source', projectId: privateProject.body.project.id });
  assert.equal(privateSource.status, 201, JSON.stringify(privateSource.body));
  const privateTemplate = await post(s, owner, '/task-templates', { name: 'Private template', kind: 'task', sourceTaskId: privateSource.body.task.id });
  assert.equal(privateTemplate.status, 201, JSON.stringify(privateTemplate.body));
  const privatePath = `/task-templates/${privateTemplate.body.template.id}/create`, privateBody = { operationId: 'template-revoked-source-01' };
  const created = await post(s, editor, privatePath, privateBody);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await call(s, `/tasks/${created.body.task.id}`, { method: 'PATCH', cookie: owner.cookie, body: { projectId: fixture.source.projectId } })).status, 200);
  s.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(privateProject.body.project.id, editor.user.id);
  assert.equal((await call(s, `/tasks/${created.body.task.id}`, { cookie: editor.cookie })).status, 200);
  const afterRevoke = state(s);
  assert.equal((await post(s, editor, privatePath, privateBody)).status, 404);
  assert.deepEqual(state(s), afterRevoke);
});

test('TC-W1-T09-E template create and apply roll back business, revision, events, receipt and outbox on receipt failure', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'template-fault@example.test');
  const fixture = await templates(s, owner), target = await task(s, owner, 'Fault target');
  s.db.exec(`CREATE FUNCTION reject_template_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected template receipt failure'; END $$;
    CREATE TRIGGER reject_template_receipt_test AFTER INSERT ON mutation_receipts FOR EACH ROW EXECUTE FUNCTION reject_template_receipt_test()`);
  const before = state(s);
  for (const kind of ['create', 'apply']) {
    const path = `/task-templates/${kind === 'create' ? fixture.task : fixture.checklist}/${kind}`;
    const body = { operationId: `template-fault-${kind}-01`, ...(kind === 'create' ? {} : { taskId: target.id, expectedRevision: target.revision }) };
    assert.equal((await post(s, owner, path, body)).status, 500);
    assert.deepEqual(state(s), before);
  }
  s.db.exec('DROP TRIGGER reject_template_receipt_test ON mutation_receipts');
  assert.equal((await post(s, owner, `/task-templates/${fixture.checklist}/apply`, {
    operationId: 'template-fault-apply-01', taskId: target.id, expectedRevision: target.revision,
  })).status, 201);
});

async function instance(t, s, suffix) {
  const applicationName = `${s.db.schema}_${suffix}`;
  const child = fork(new URL('./fixtures/sync-server.mjs', import.meta.url), [s.db.schema, join(s.dir, 'test.sqlite'), applicationName], { silent: true });
  let errors = ''; child.stderr.on('data', data => { errors += data; });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit'); child.send('close');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited; clearTimeout(timeout);
  });
  const ready = await Promise.race([once(child, 'message').then(([value]) => value), once(child, 'exit').then(() => { throw Error(errors); })]);
  return { base: `http://127.0.0.1:${ready.port}`, applicationName };
}

test('TC-W1-T09-B two independent processes create or apply one template operation at an advisory lock barrier', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'template-concurrency@example.test');
  const fixture = await templates(s, owner), target = await task(s, owner, 'Concurrent target');
  const first = await instance(t, s, 'template_first'), second = await instance(t, s, 'template_second');
  const control = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL }); await control.connect(); t.after(() => control.end());
  await control.query(`SET search_path TO "${s.db.schema}"`);
  for (const kind of ['create', 'apply']) {
    const operationId = `template-race-${kind}-01`, path = `/task-templates/${kind === 'create' ? fixture.task : fixture.checklist}/${kind}`;
    const body = { operationId, ...(kind === 'create' ? {} : { taskId: target.id, expectedRevision: target.revision }) };
    const before = state(s);
    await control.query('BEGIN');
    await control.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))', [JSON.stringify([owner.workspace.id, owner.user.id, operationId])]);
    const pending = [post(first, owner, path, body), post(second, owner, path, body)];
    try {
      const deadline = Date.now() + 10000;
      while (true) {
        const waiting = await control.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=ANY($1) AND wait_event_type='Lock'", [[first.applicationName, second.applicationName]]);
        if (waiting.rows[0].n === 2) break;
        assert.ok(Date.now() < deadline, 'both independent requests reach PostgreSQL lock barrier');
        await delay(20);
      }
    } finally { await control.query('COMMIT'); }
    const results = await Promise.all(pending);
    assert.deepEqual(results.map(r => r.status), [201, 201], JSON.stringify(results));
    assert.deepEqual(results[0].body, results[1].body);
    const after = state(s);
    assert.equal(after.mutation_receipts.length, before.mutation_receipts.length + 1);
    assert.equal(after.tasks.length, before.tasks.length + (kind === 'create' ? 1 : 0));
    assert.equal(after.task_checklists.length, before.task_checklists.length + (kind === 'apply' ? 1 : 0));
    assert.equal(after.task_activity.length, before.task_activity.length + 1);
  }
});

test('TC-W1-T07-A template writes through Android auth retain actor, source and stable header operation', async t => {
  const s = await boot(t, { clock }), email = 'template-mobile@example.test', owner = await user(s, email);
  const fixture = await templates(s, owner);
  const login = await post(s, owner, '/mobile/auth/login', { email, password: 'Password123!' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const invoke = async (operationId, body) => {
    const response = await fetch(`${s.base}/api/task-templates/${fixture.task}/create`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.body.token}`, 'idempotency-key': operationId }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), replayed: response.headers.get('idempotency-replayed') };
  };
  const first = await invoke('template-mobile-operation-01', {});
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const retry = await invoke('template-mobile-operation-01', {});
  assert.deepEqual(retry.body, first.body);
  assert.equal(retry.replayed, 'true');
  const events = s.db.prepare('SELECT * FROM business_events WHERE task_id=?').all(first.body.task.id);
  assert.ok(events.length);
  for (const event of events) {
    assert.equal(event.actor_user_id, owner.user.id);
    assert.equal(event.source, 'android');
    assert.equal(event.operation_id, 'template-mobile-operation-01');
  }
  assert.equal((await invoke('template-mobile-operation-01', { operationId: 'template-mobile-other-01' })).status, 400);
});
