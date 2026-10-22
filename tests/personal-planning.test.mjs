import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickTask, personalTaskGroups, planningDay } from '../shared/personal-planning.mjs';
import { readRoute } from '../src/routes.js';

const now = new Date('2026-09-27T17:30:00Z'); // 00:30 on the 28th in Vietnam.
test('Vietnam day projections cross exactly at 17:00 UTC without mutating a deadline', () => {
  for (const [before, boundary, day] of [
    ['2026-12-31T16:59:59.999Z', '2026-12-31T17:00:00.000Z', '2027-01-01'],
    ['2028-02-28T16:59:59.999Z', '2028-02-28T17:00:00.000Z', '2028-02-29'],
  ]) {
    const task = { id: 'boundary', title: 'Giữ deadline', status: 'todo', dueAt: boundary };
    assert.notEqual(planningDay(before), day);
    assert.equal(planningDay(boundary), day);
    assert.equal(personalTaskGroups([task], 'today', before).length, 0);
    assert.equal(personalTaskGroups([task], 'today', boundary)[0].tasks[0], task);
    assert.equal(task.dueAt, boundary);
  }
});

test('quick capture preserves undated text and previews Vietnamese dates across midnight/month/year', () => {
  assert.equal(planningDay(now), '2026-09-28');
  assert.equal(parseQuickTask('gọi Mai', now).dueAt, null);
  assert.deepEqual(parseQuickTask('Mua sách', now), { title: 'Mua sách', dueAt: null, recognized: false, error: '' });
  assert.deepEqual(parseQuickTask('mai 9h gửi báo giá cho An', now), { title: 'gửi báo giá cho An', dueAt: '2026-09-29T02:00:00.000Z', recognized: true, error: '' });
  assert.equal(parseQuickTask('hôm nay 09:30 gọi An', now).dueAt, '2026-09-28T02:30:00.000Z');
  assert.equal(parseQuickTask('ngày kia gửi bài', '2026-12-30T18:00:00Z').dueAt, '2027-01-02T10:00:00.000Z');
  assert.equal(parseQuickTask('mai 9h30 gửi bài', '2026-09-30T02:00:00Z').dueAt, '2026-10-01T02:30:00.000Z');
  assert.ok(parseQuickTask('mai 25h gửi bài', now).error);
  assert.ok(parseQuickTask('mai 9:65 gửi bài', now).error);
  assert.ok(parseQuickTask('mai 9h', now).error);
});

test('personal projections keep plans separate from deadlines and never treat null dates as overdue', () => {
  const task = (id, dueAt = null, plannedDate = null, status = 'todo') => ({ id, title: id, dueAt, plannedDate, status });
  const items = [task('inbox'), task('planned', null, '2026-09-28'), task('due', '2026-09-28T10:00:00Z'), task('overdue', '2026-09-26T10:00:00Z'), task('missed-plan', null, '2026-09-27'), task('future', '2026-10-02T10:00:00Z', '2026-10-01'), task('done', null, null, 'done')];
  const before = structuredClone(items);
  assert.deepEqual(personalTaskGroups(items, 'inbox', now).flatMap(g => g.tasks.map(t => t.id)), ['inbox']);
  const today = personalTaskGroups(items, 'today', now);
  assert.deepEqual(today.find(g => g.label === 'Hôm nay').tasks.map(t => t.id), ['due', 'planned']);
  assert.deepEqual(today.find(g => g.label === 'Cần xem lại').tasks.map(t => t.id), ['overdue', 'missed-plan']);
  assert.equal(personalTaskGroups(items, 'upcoming', now)[0].label, '2026-10-01');
  assert.deepEqual(items, before);
  for (const path of ['inbox', 'today', 'upcoming']) assert.equal(readRoute(`/${path}`), path);
});

test('ambiguous numeric dates, contradictory relative days and multiple times require explicit preview correction',()=>{
  for(const text of ['Gửi ngày 31/02','Gửi 02/03/2028','thứ 2 gọi An','mai hôm nay 9h gửi','mai 9h 10h gửi'])assert.ok(parseQuickTask(text,'2028-02-28T18:00:00Z').error,text);
  assert.equal(parseQuickTask('ngày mai 9h gửi','2028-02-28T15:00:00Z').dueAt,'2028-02-29T02:00:00.000Z');
});
