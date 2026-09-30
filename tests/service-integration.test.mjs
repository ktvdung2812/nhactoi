import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, call, user, addMember } from './roadmap-helpers.mjs';
import { processServiceReminders } from '../server/services.mjs';

const clock = () => new Date('2026-09-22T04:00:00Z');
async function create(s, owner, value = {}) {
  const response = await call(s, '/services', { method: 'POST', cookie: owner.cookie, body: { name: 'Giấy phép thiết kế', nextDate: '2026-09-25', syncCalendar: true, ...value } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.service;
}
test('renewal calendar follows edits, renewal, tracking toggle, archive and restoration without leaking financial data', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'calendar-renewal@example.test'), outsider = await user(s, 'outside-renewal@example.test');
  const row = await create(s, owner, { paymentAccount: 'private billing account', accountHint: 'private login', note: 'private note', unitPrice: 123456 });
  const calendar = async actor => (await call(s, '/calendar-events', { cookie: actor.cookie })).body.events;
  let events = await calendar(owner);
  assert.equal(events.length, 1); assert.equal(events[0].service_id, row.id); assert.equal(events[0].canEdit, false);
  assert.equal(events[0].starts_at, '2026-09-25T01:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(events), /private|123456/);
  assert.deepEqual(await calendar(outsider), []);
  await call(s, `/services/${row.id}`, { method: 'PATCH', cookie: owner.cookie, body: { enabled: false } });
  assert.equal((await calendar(owner)).length, 1);
  await call(s, `/services/${row.id}/renew`, { method: 'POST', cookie: owner.cookie, body: { expectedDate: row.nextDate } });
  events = await calendar(owner); assert.equal(events.length, 1); assert.equal(events[0].starts_at, '2027-09-25T01:00:00.000Z');
  await call(s, `/services/${row.id}/archive`, { method: 'PUT', cookie: owner.cookie, body: { archived: true } });
  assert.deepEqual(await calendar(owner), []);
  await call(s, `/services/${row.id}/archive`, { method: 'PUT', cookie: owner.cookie, body: { archived: false } });
  assert.equal((await calendar(owner)).length, 1);
  await call(s, `/services/${row.id}`, { method: 'PATCH', cookie: owner.cookie, body: { syncCalendar: false } });
  assert.deepEqual(await calendar(owner), []);
});
test('renewal notices open their service and disappear after team access is revoked', async t => {
  const s = await boot(t, { clock }), owner = await user(s, 'notice-owner@example.test'), member = await user(s, 'notice-member@example.test');
  addMember(s, owner, member);
  const team = await call(s, '/teams', { method: 'POST', cookie: owner.cookie, body: { name: 'Design', color: 'green', members: [{userId: owner.user.id,role: 'lead'}, {userId: member.user.id,role: 'member'}] } });
  assert.equal(team.status, 201, JSON.stringify(team.body));
  const row = await create(s, owner, { teamId: team.body.team.id, assigneeId: member.user.id });
  assert.equal(processServiceReminders({ db: s.db, clock }), 1);
  const notices = (await call(s, '/notifications', { cookie: member.cookie })).body.notifications;
  assert.equal(notices.length, 1); assert.equal(notices[0].serviceId, row.id);
  assert.equal((await call(s, `/notifications/${notices[0].id}/read`, { method: 'PATCH', cookie: member.cookie })).status, 200);
  s.db.prepare('DELETE FROM team_members WHERE team_id=? AND user_id=?').run(team.body.team.id, member.user.id);
  assert.deepEqual((await call(s, '/notifications', { cookie: member.cookie })).body.notifications, []);
  assert.deepEqual((await call(s, '/calendar-events', { cookie: member.cookie })).body.events, []);
  assert.equal((await call(s, `/notifications/${notices[0].id}/read`, { method: 'PATCH', cookie: member.cookie })).status, 404);
});

test("[SQLite legacy] migration preserves existing service data and legacy records remain editable", async t => {
  const { migrateDatabase } = await import('./database-helpers.mjs');
  const s = await boot(t, { clock }), owner = await user(s, 'upgrade-service@example.test');
  const row = await create(s, owner, { amount: 890000 });
  // Reconstruct the actual pre-renewal schema in this disposable database.
  s.db.exec('DROP INDEX notifications_service_idx; ALTER TABLE notifications DROP COLUMN service_id; DROP INDEX service_contracts_reminder_idx;');
  for (const column of ['license_type','quantity','unit_price','actual_paid','purchase_date','account_hint','payment_account','payment_method','portal_url','provider_contact','invoice_type','enabled','sync_calendar','last_renewed_at']) {
    s.db.exec(`ALTER TABLE service_contracts DROP COLUMN ${column}`);
  }
  s.db.exec('DELETE FROM schema_migrations WHERE version=19;');
  migrateDatabase(s.db);
  const migrated = s.db.prepare('SELECT * FROM service_contracts WHERE id=?').get(row.id);
  assert.equal(migrated.amount, 890000);
  assert.equal(migrated.unit_price, 890000);
  assert.equal(migrated.quantity, 1);
  assert.equal(migrated.sync_calendar, 0);
  const edited = await call(s, `/services/${row.id}`, { method: 'PATCH', cookie: owner.cookie, body: { enabled: false } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.service.accountHint, '');
  assert.equal(edited.body.service.status, 'disabled');
  migrateDatabase(s.db);
  assert.equal(s.db.prepare('SELECT amount FROM service_contracts WHERE id=?').get(row.id).amount, 890000);
});
