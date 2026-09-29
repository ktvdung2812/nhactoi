import { normalizeRecurrenceOptions } from '../shared/task-recurrence.mjs';

export function validateRecurrenceOptions(recurrence, input, HttpError) {
  try { return normalizeRecurrenceOptions(recurrence, input); }
  catch (error) { throw new HttpError(400, error.message); }
}

export function storedRecurrenceOptions(task) {
  return normalizeRecurrenceOptions(task.recurrence, JSON.parse(task.recurrence_options || '{}'));
}
