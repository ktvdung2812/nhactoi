import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecurrenceOptions as normalize, nextTaskOccurrence as next, recurrenceLabel } from '../shared/task-recurrence.mjs';

test('recurrence validation rejects malformed rules and preserves the input', () => {
  const input = { weekdays: [5, 1, 3], interval: 2, basis: 'due' };
  assert.deepEqual(normalize('weekly', input).weekdays, [1, 3, 5]);
  assert.deepEqual(input.weekdays, [5, 1, 3]);
  for (const value of [{ interval: 0 }, { interval: 366 }, { interval: 1.5 }, { weekdays: [1, 1] }, { weekdays: [0] }, { basis: 'fixed' }, { unknown: 1 }, []])
    assert.throws(() => normalize('weekly', value));
  assert.throws(() => normalize('daily', { weekdays: [1] }));
  assert.throws(() => normalize('none', { interval: 2 }));
  assert.equal(next(null, 'daily'), null);
  assert.equal(next('invalid', 'daily'), null);
  assert.equal(next('2026-01-01T00:00:00Z', 'none'), null);
  assert.match(recurrenceLabel('weekly', input), /2 tuần.*T2, T4, T6/);
});

test('calendar recurrence preserves Vietnamese clock, anchor day and leap dates', () => {
  const anchor = '2026-01-30T18:00:00Z'; // January 31, 01:00 Vietnam.
  const feb = next(anchor, 'monthly', {}, null, anchor).toISOString();
  assert.equal(feb, '2026-02-27T18:00:00.000Z');
  assert.equal(next(feb, 'monthly', {}, null, anchor).toISOString(), '2026-03-30T18:00:00.000Z');
  const leap = '2024-02-29T03:00:00Z';
  assert.equal(next(leap, 'yearly', {}, null, leap).toISOString(), '2025-02-28T03:00:00.000Z');
  assert.equal(next('2027-02-28T03:00:00Z', 'yearly', {}, null, leap).toISOString(), '2028-02-29T03:00:00.000Z');
  assert.equal(next('2026-12-31T18:00:00Z', 'daily', { interval: 3 }).toISOString(), '2027-01-03T18:00:00.000Z');
});

test('selected weekdays respect active weeks and completion basis changes the clock anchor', () => {
  const friday = '2026-09-25T02:00:00Z';
  assert.equal(next(friday, 'weekly', { weekdays: [1, 3, 5] }).toISOString(), '2026-09-28T02:00:00.000Z');
  assert.equal(next(friday, 'weekly', { interval: 2, weekdays: [1, 3, 5] }).toISOString(), '2026-10-05T02:00:00.000Z');
  assert.equal(next('2026-09-21T02:00:00Z', 'weekly', { interval: 2, weekdays: [1, 3, 5] }).toISOString(), '2026-09-23T02:00:00.000Z');
  const due = '2026-09-01T02:00:00Z', completed = '2026-09-27T07:00:00Z';
  assert.equal(next(due, 'daily', { interval: 90, basis: 'due' }, completed).toISOString(), '2026-11-30T02:00:00.000Z');
  assert.equal(next(due, 'daily', { interval: 90, basis: 'completion' }, completed).toISOString(), '2026-12-26T07:00:00.000Z');
});
