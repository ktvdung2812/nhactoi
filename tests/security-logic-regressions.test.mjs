import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';

for (const change of ['cancel', 'reschedule', 'expire']) {
  test(`calendar FCM retries stop when a reminder is ${change}`, async t => {
    let now = '2030-01-01T10:00:00.000Z', failing = true, sent = 0;
    const s = await boot(t, { clock: () => new Date(now), fcmTransport: async () => {
      if (failing) throw new Error('temporary failure');
      sent++; return { ok: true };
    } });
    const owner = await user(s, 'calendar@example.test');
    const post = (path, body, method = 'POST') => call(s, path, { method, cookie: owner.cookie, body });
    const login = await post('/mobile/auth/login', { email: owner.user.email, password: 'Password123!' });
    const device = await fetch(`${s.base}/api/mobile/devices/calendar-regression`, {
      method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.body.token}` },
      body: JSON.stringify({ fcmToken: 'calendar-test-token' }),
    });
    assert.equal(device.status, 200);
    const schedule = { title: 'Calendar', startsAt: '2030-01-01T11:00:00.000Z', endsAt: '2030-01-01T12:00:00.000Z', remindAt: now };
    const created = await post('/calendar-events', schedule);
    assert.equal(created.status, 201);
    assert.equal(s.app.locals.processEventReminders(), 1);
    assert.equal((await s.app.locals.processNotificationOutbox()).failed, 1);
    if (change === 'expire') now = schedule.endsAt;
    else {
      assert.equal((await post(`/calendar-events/${created.body.id}`, {
        ...schedule, remindAt: change === 'cancel' ? null : '2030-01-01T10:30:00.000Z',
      }, 'PUT')).status, 200);
      now = '2030-01-01T10:00:10.000Z';
    }
    failing = false;
    assert.equal((await s.app.locals.processNotificationOutbox()).sent, 0);
    assert.equal(sent, 0);
    assert.equal(s.db.prepare("SELECT count(*) n FROM notification_outbox_deliveries WHERE status='pending'").get().n, 0);
    if (change === 'reschedule') {
      now = '2030-01-01T10:30:00.000Z';
      assert.equal(s.app.locals.processEventReminders(), 1);
      assert.equal((await s.app.locals.processNotificationOutbox()).sent, 1);
      assert.equal(sent, 1);
    }
  });
}

test('trash restore validates unfinished checklist assignees and remains atomic', async t => {
  const s = await boot(t);
  const owner = await user(s, 'trash-owner@example.test');
  const member = await user(s, 'trash-member@example.test');
  addMember(s, owner, member);
  const request = async (path, method, body, status = 200) => {
    const response = await call(s, path, { method, body, cookie: owner.cookie });
    assert.equal(response.status, status, JSON.stringify(response.body));
    return response.body;
  };
  const { team } = await request('/teams', 'POST', { name: 'Restore team', color: 'blue', members: [
    { userId: owner.user.id, role: 'lead' }, { userId: member.user.id, role: 'member' },
  ] }, 201);
  const { task } = await request('/tasks', 'POST', { title: 'Checklist owner', teamId: team.id, assigneeId: owner.user.id }, 201);
  await request(`/tasks/${task.id}/extras`, 'PUT', { assigneeIds: [member.user.id], labelIds: [] });
  const { checklist } = await request(`/tasks/${task.id}/checklists`, 'POST', { title: 'Steps' }, 201);
  const itemPath = `/tasks/${task.id}/checklists/${checklist.id}/items`;
  const { item } = await request(itemPath, 'POST', { title: 'Open item' }, 201);
  await request(`${itemPath}/${item.id}`, 'PATCH', { assigneeIds: [member.user.id] });
  await request(`/tasks/${task.id}`, 'DELETE');
  // Legacy/imported rows may retain checklist assignments after the card's
  // secondary assignment disappears; restore must validate the child too.
  s.db.prepare('DELETE FROM task_assignees WHERE task_id=?').run(task.id);
  await request(`/teams/${team.id}/members`, 'PUT', { members: [{ userId: owner.user.id, role: 'lead' }] });
  const { task: valid } = await request('/tasks', 'POST', { title: 'Valid task' }, 201);
  await request(`/tasks/${valid.id}`, 'DELETE');
  const ids = s.db.prepare('SELECT id FROM trash_items WHERE entity_id IN (?,?)').all(task.id, valid.id).map(row => row.id);
  await request('/trash/restore', 'POST', { ids }, 409);
  assert.equal(s.db.prepare('SELECT count(*) n FROM tasks WHERE id IN (?,?) AND deleted_at IS NOT NULL').get(task.id, valid.id).n, 2);

  // Completed checklist items and completed cards remain historical records.
  s.db.prepare('UPDATE task_checklist_items SET completed=1 WHERE id=?').run(item.id);
  await request('/trash/restore', 'POST', { ids });
  assert.equal(s.db.prepare('SELECT completed FROM task_checklist_items WHERE id=?').get(item.id).completed,1);
  assert.equal(s.db.prepare('SELECT user_id FROM task_checklist_assignees WHERE item_id=?').get(item.id).user_id,member.user.id);
  assert.equal((await call(s,`/tasks/${task.id}/detail`,{cookie:member.cookie})).status,404);
  await request(`/tasks/${task.id}`, 'DELETE');
  s.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(task.id);
  s.db.prepare('UPDATE task_checklist_items SET completed=0 WHERE id=?').run(item.id);
  const historical = s.db.prepare('SELECT id FROM trash_items WHERE entity_id=?').get(task.id);
  await request('/trash/restore', 'POST', { ids: [historical.id] });
});
