import test from 'node:test';
import assert from 'node:assert/strict';
import { planningWeek, weekEntries, plannedEnd } from '../shared/week-planning.mjs';

test('week spans year boundaries and preserves separate personal plans and deadlines', () => {
  const dates = planningWeek('2027-01-03');
  assert.deepEqual([dates[0], dates[6]], ['2026-12-28', '2027-01-03']);
  const task = { id: 't', title: 'Việc', dueAt: '2026-12-28T18:00:00Z', plannedDate: '2026-12-30', plannedTime: '23:00', plannedDuration: 60 };
  const result = weekEntries([task, { ...task, id: 'done', status: 'done' }, { ...task, id: 'archive', teamArchived: true }], [], dates);
  assert.equal(result[1].entries[0].kind, 'deadline');
  assert.equal(result[1].entries[0].label, 'Hạn 01:00');
  assert.equal(result[2].entries[0].label, '23:00–24:00');
  assert.equal(result.flatMap(d => d.entries).length, 2);
  assert.equal(plannedEnd('09:30', 45), '10:15');
  assert.equal(weekEntries([{ ...task, plannedDate: '2027-01-10' }], [], dates)[1].entries[0].kind, 'deadline');
});
test('appointments span intersecting Vietnam days with an exclusive midnight end', () => {
  const event = { id: 'e', title: 'Hẹn', starts_at: '2026-12-27T16:00:00Z', ends_at: '2026-12-29T17:00:00Z' };
  const result = weekEntries([], [event, { ...event, id: 'done', status: 'done' }, { ...event, id: 'renew', service_id: 's', starts_at: '2026-12-30T01:00:00Z', ends_at: '2026-12-30T02:00:00Z' }], planningWeek('2026-12-28'));
  assert.deepEqual(result.map(d => d.entries.map(e => e.kind)), [['event'], ['event'], ['renewal'], [], [], [], []]);
  assert.equal(result[0].entries[0].label, 'Tiếp từ ngày trước–24:00');
});
