import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';

const clock = () => new Date('2026-10-16T02:00:00.000Z');
const observedTables = [
  'service_contracts', 'service_renewals', 'transactions', 'tasks',
  'service_cycle_tasks', 'task_activity', 'task_assignment_cycles',
  'business_events', 'mutation_receipts', 'notifications',
  'notification_outbox', 'notification_outbox_deliveries',
  'reminder_email_outbox', 'web_push_deliveries', 'automation_event_queue',
];

function snapshot(db) {
  return Object.fromEntries(observedTables.map(table => [table,
    db.prepare(`SELECT * FROM ${table}`).all()
      .map(row => JSON.stringify(row)).sort(),
  ]));
}

// Faults live only in the isolated test schema. Every boundary must actually
// fail, then the same operation must succeed once after removing the trigger.
for (const table of [
  'transactions', 'tasks', 'business_events', 'task_assignment_cycles',
  'service_cycle_tasks', 'task_activity', 'notifications',
  'notification_outbox', 'service_renewals', 'service_contracts',
  'mutation_receipts',
]) {
  test(`TC-W2-T03-E renewal rolls back at ${table} and retries without duplicate effects`, async t => {
    const s = await boot(t, { clock });
    const owner = await user(s, 'renew-fault-owner@example.test');
    const assignee = await user(s, 'renew-fault-assignee@example.test');
    addMember(s, owner, assignee);
    const send = (path, body) => call(s, path, { method: 'POST', cookie: owner.cookie, body });
    const created = await send('/services', {
      name: 'Gia hạn có lỗi giữa chừng', nextDate: '2026-10-31',
      cycle: 'month', amount: 100, assigneeId: assignee.user.id,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const service = created.body.service;
    const body = {
      expectedDate: service.nextDate, expectedRevision: service.revision,
      recordExpense: true, createTask: true, operationId: `fault-renew-${table}`,
    };
    const path = `/services/${service.id}/renew`;
    const before = snapshot(s.db);

    s.db.exec(`
      CREATE FUNCTION reject_renewal_boundary() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected renewal boundary failure'; END $$;
      CREATE TRIGGER reject_renewal_boundary
      BEFORE ${table === 'service_contracts' ? 'UPDATE' : 'INSERT'} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_renewal_boundary();
    `);
    assert.equal((await send(path, body)).status, 500, `${table} fault must be reached`);
    assert.deepEqual(snapshot(s.db), before, `${table}: no business, revision, event, receipt or outbox changes`);
    const unchanged = await call(s, `/services/${service.id}`, { cookie: owner.cookie });
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.service.revision, service.revision);
    assert.equal(unchanged.body.service.nextDate, service.nextDate);
    const history = await call(s, `/services/${service.id}/history`, { cookie: owner.cookie });
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.history, []);

    s.db.exec(`DROP TRIGGER reject_renewal_boundary ON ${table}`);
    const retried = await send(path, body);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.nextDate, '2026-11-30');
    assert.ok(retried.body.expenseId);
    assert.ok(retried.body.taskId);
    const renewal = s.db.prepare('SELECT * FROM service_renewals WHERE id=?').get(retried.body.renewalId);
    assert.equal(renewal.expense_id, retried.body.expenseId);
    assert.equal(renewal.task_id, retried.body.taskId);
    assert.equal(renewal.previous_date, service.nextDate);
    assert.equal(renewal.next_date, retried.body.nextDate);
    assert.deepEqual(s.db.prepare('SELECT type,amount FROM transactions WHERE id=?').get(retried.body.expenseId), { type: 'expense', amount: 100 });
    for (const name of ['service_renewals', 'transactions', 'tasks', 'service_cycle_tasks', 'task_activity', 'task_assignment_cycles', 'mutation_receipts', 'notifications', 'notification_outbox']) {
      assert.equal(s.db.prepare(`SELECT count(*) n FROM ${name}`).get().n, 1, `${name}: one committed effect`);
    }
    assert.deepEqual(s.db.prepare('SELECT type,operation_id,actor_user_id,source FROM business_events ORDER BY type').all(),
      ['task.assigned', 'task.created'].map(type => ({ type, operation_id: body.operationId, actor_user_id: owner.user.id, source: 'web' })));
    const committed = snapshot(s.db);
    const replay = await send(path, body);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, retried.body);
    assert.deepEqual(snapshot(s.db), committed, 'replay preserves the committed revision and all effects');
  });
}
