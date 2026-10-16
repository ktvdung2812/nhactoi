import test from 'node:test';
import assert from 'node:assert/strict';
import { addMember, boot, call, user } from './roadmap-helpers.mjs';

// TC-W0-T04-C: filtering never multiplies tasks or leaks an inaccessible team.
test('opaque legacy ID ties have stable byte ordering across complete and paged task lists', async t => {
  const s = await boot(t), owner = await user(s, 'id-tie-owner@example.test');
  const ids = ['task_A', 'task_a', 'task-a', 'task_10', 'task_2', 'task_é', 'task_Đ'];
  const at = '2030-01-01T02:00:00.000Z';
  for (const id of ids) s.db.prepare(`INSERT INTO tasks(id,workspace_id,project_id,title,status,priority,recurrence,due_at,created_by,created_at,updated_at)
    VALUES(?,?,?,?,'todo','medium','none',?,?,?,?)`)
    .run(id, owner.workspace.id, 'prj_ws_' + owner.workspace.id, id, at, owner.user.id, at, at);
  const expected = [...ids].sort((a,b) => Buffer.compare(Buffer.from(b),Buffer.from(a)));
  const legacy = await call(s, '/tasks', {cookie:owner.cookie});
  assert.equal(legacy.status,200); assert.deepEqual(legacy.body.tasks.map(row=>row.id),expected);
  const actual=[];
  for(let page=1;page<=4;page++) {
    const result=await call(s,`/tasks?page=${page}&pageSize=2`,{cookie:owner.cookie});
    assert.equal(result.status,200);assert.equal(result.body.total,ids.length);assert.equal(result.body.hasMore,page<4);
    actual.push(...result.body.tasks.map(row=>row.id));
  }
  assert.deepEqual(actual,expected);assert.equal(new Set(actual).size,ids.length);
});

test('assignee filters include primary and secondary assignments with stable totals', async t => {
  const s = await boot(t);
  const owner = await user(s, 'filter-owner@example.test');
  const member = await user(s, 'filter-member@example.test');
  const outsider = await user(s, 'filter-outsider@example.test');
  addMember(s, owner, member);
  const post = (path, body, actor = owner) => call(s, path, { method: 'POST', cookie: actor.cookie, body });
  const create = async (title, assigneeId, actor = owner, teamId = null) => {
    const result = await post('/tasks', { title, assigneeId, teamId }, actor);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.task;
  };
  const primary = await create('Primary', member.user.id);
  const secondary = await create('Secondary', owner.user.id);
  assert.equal((await call(s, `/tasks/${secondary.id}/extras`, { method: 'PUT', cookie: owner.cookie,
    body: { assigneeIds: [member.user.id], labelIds: [] } })).status, 200);
  await create('Unassigned', null);
  await create('Other tenant', outsider.user.id, outsider);
  const team = await post('/teams', { name: 'Hidden', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }] });
  assert.equal(team.status, 201, JSON.stringify(team.body));
  const hidden = await create('Hidden team', owner.user.id, owner, team.body.team.id);
  const filter = async (actor, id, page = 1) => {
    const result = await call(s, `/tasks?assigneeId=${id}&pageSize=1&page=${page}`, { cookie: actor.cookie });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const pages = await Promise.all([filter(owner, member.user.id, 1), filter(owner, member.user.id, 2)]);
  assert.deepEqual(pages.map(page => page.total), [2, 2]);
  assert.deepEqual(new Set(pages.flatMap(page => page.tasks.map(task => task.id))), new Set([primary.id, secondary.id]));
  assert.deepEqual(pages.map(page => page.hasMore), [true, false]);
  const visibleToMember = await filter(member, owner.user.id);
  assert.equal(visibleToMember.total, 1);
  assert.equal(visibleToMember.tasks[0].id, secondary.id);
  assert.ok(!visibleToMember.tasks.some(task => task.id === hidden.id));
  assert.equal((await filter(outsider, member.user.id)).total, 0);
});

// TC-W0-T04-D: the business day changes at 17:00 UTC, including leap/year edges.
test('today filter uses Vietnam midnight boundaries and leaves stored deadlines unchanged', async t => {
  let now = '2028-02-28T16:59:59.999Z';
  const s = await boot(t, { clock: () => new Date(now) });
  const owner = await user(s, 'day-boundary@example.test');
  const deadlines = ['2028-02-28T16:59:59.999Z', '2028-02-28T17:00:00.000Z', '2028-02-29T16:59:59.999Z', '2028-02-29T17:00:00.000Z'];
  const cards = [];
  for (const dueAt of deadlines) {
    const result = await call(s, '/tasks', { method: 'POST', cookie: owner.cookie, body: { title: dueAt, dueAt } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    cards.push(result.body.task);
  }
  const today = async () => {
    const result = await call(s, '/tasks?due=today', { cookie: owner.cookie });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.total, result.body.tasks.length);
    return result.body.tasks.map(task => task.id).sort();
  };
  assert.deepEqual(await today(), [cards[0].id]);
  now = '2028-02-28T17:00:00.000Z';
  assert.deepEqual(await today(), [cards[1].id, cards[2].id].sort());
  now = '2028-02-29T17:00:00.000Z';
  assert.deepEqual(await today(), [cards[3].id]);
  const after = await call(s, '/tasks', { cookie: owner.cookie });
  assert.deepEqual(after.body.tasks.map(task => task.dueAt).sort(), deadlines);
});

test('paged project ACL matches legacy visibility through team search, archive and grant changes', async t => {
  const s = await boot(t), owner = await user(s, 'page-acl-owner@example.test'), member = await user(s, 'page-acl-member@example.test');
  addMember(s, owner, member);
  s.db.prepare("UPDATE subscriptions SET plan='business' WHERE workspace_id=?").run(owner.workspace.id);
  const api = (actor, path, method = 'GET', body) => call(s, path, { cookie: actor.cookie, method, body });
  const team = await api(owner, '/teams', 'POST', { name: 'Đội DỊCH VỤ Mẫu', color: 'blue', members: [{ userId: owner.user.id, role: 'lead' }] });
  assert.equal(team.status, 201, JSON.stringify(team.body));
  const teamId = team.body.team.id, projectId = s.db.prepare('SELECT id FROM projects WHERE team_id=?').get(teamId).id;
  const common = await api(owner, '/tasks', 'POST', { title: 'Common visible task' });
  const scoped = await api(owner, '/tasks', 'POST', { title: 'Team card without search words', projectId });
  const privateProject = await api(owner, '/projects', 'POST', { name: 'Private exclusion', accessMode: 'private' });
  const hidden = await api(owner, '/tasks', 'POST', { title: 'PRIVATE_PAGING_CANARY', projectId: privateProject.body.project.id });
  for (const result of [common, scoped, hidden]) assert.equal(result.status, 201, JSON.stringify(result.body));
  const grant = role => api(owner, `/projects/${projectId}/members/${member.user.id}`, 'PUT', { role });
  assert.equal((await grant('editor')).status, 200);
  assert.equal(s.db.prepare('SELECT count(*) n FROM team_members WHERE team_id=? AND user_id=?').get(teamId, member.user.id).n, 0);
  const check = async (actor, expected) => {
    const legacy = await api(actor, '/tasks'), pages = [];
    assert.equal(legacy.status, 200);
    for (let page = 1; page <= expected.length + 1; page++) {
      const result = await api(actor, `/tasks?page=${page}&pageSize=1`);
      assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.total, expected.length);
      pages.push(...result.body.tasks.map(row => row.id));
    }
    assert.deepEqual(pages, legacy.body.tasks.map(row => row.id), 'both independently queried paths retain the same ACL and ordering');
    assert.deepEqual([...pages].sort(), [...expected].sort());
  };
  const search = () => api(member, '/tasks?page=1&pageSize=1&q=doi%20dich%20vu%20mau');
  await check(member, [common.body.task.id, scoped.body.task.id]);
  const found = await search(); assert.equal(found.status, 200); assert.equal(found.body.total, 1); assert.equal(found.body.tasks[0].id, scoped.body.task.id);
  const teamPage = await api(member, `/tasks?page=1&teamId=${teamId}`); assert.equal(teamPage.body.total, 1);
  assert.equal((await api(owner, `/projects/${projectId}/members/${member.user.id}`, 'DELETE')).status, 200);
  await check(member, [common.body.task.id]); assert.equal((await search()).body.total, 0);
  assert.equal((await grant('editor')).status, 200);
  assert.equal((await api(owner, `/teams/${teamId}`, 'PATCH', { archived: true })).status, 200);
  await check(member, [common.body.task.id]);
  await check(owner, [common.body.task.id, hidden.body.task.id]);
  assert.equal((await search()).body.total, 0);
  assert.equal((await api(owner, `/teams/${teamId}`, 'PATCH', { archived: false })).status, 200);
  await check(member, [common.body.task.id, scoped.body.task.id]); assert.equal((await search()).body.total, 1);
});
