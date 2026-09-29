export const RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const DAY = 86400000;
const OFFSET = 7 * 3600000;

export function normalizeRecurrenceOptions(recurrence, input) {
  if (!RECURRENCES.includes(recurrence)) throw new Error('Tần suất lặp không hợp lệ.');
  const value = input ?? {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['interval', 'weekdays', 'basis'].includes(k)))
    throw new Error('Quy tắc lặp không hợp lệ.');
  const interval = value.interval ?? 1;
  const weekdays = value.weekdays ?? [];
  const basis = value.basis ?? 'due';
  if (!Number.isInteger(interval) || interval < 1 || interval > 365)
    throw new Error('Khoảng lặp phải là số nguyên từ 1 đến 365.');
  if (!['due', 'completion'].includes(basis)) throw new Error('Mốc tính kỳ lặp không hợp lệ.');
  if (!Array.isArray(weekdays) || weekdays.length > 7 || weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7) || new Set(weekdays).size !== weekdays.length)
    throw new Error('Các thứ phải khác nhau, từ 1 (thứ 2) đến 7 (chủ nhật).');
  if (weekdays.length && recurrence !== 'weekly') throw new Error('Chỉ lịch lặp theo tuần mới chọn các thứ.');
  if (recurrence === 'none' && (interval !== 1 || weekdays.length || basis !== 'due'))
    throw new Error('Hãy bật lặp lại trước khi đặt quy tắc lặp.');
  return { interval, weekdays: [...weekdays].sort((a, b) => a - b), basis };
}

function localDate(value) {
  if (!value) return null;
  const date = new Date(new Date(value).getTime() + OFFSET);
  return Number.isFinite(date.getTime()) ? date : null;
}
const isoWeekday = date => date.getUTCDay() || 7;
const monday = date => Math.floor(date.getTime() / DAY) - (isoWeekday(date) - 1);

export function nextTaskOccurrence(dueAt, recurrence, input = {}, completedAt = null, anchorAt = null) {
  const options = normalizeRecurrenceOptions(recurrence, input);
  const due = localDate(dueAt);
  if (!due || recurrence === 'none') return null;
  const base = options.basis === 'completion' ? localDate(completedAt) || due : due;
  const anchor = options.basis === 'completion' ? base : localDate(anchorAt) || due;
  const next = new Date(base);
  if (recurrence === 'daily') next.setUTCDate(next.getUTCDate() + options.interval);
  else if (recurrence === 'weekly' && !options.weekdays.length) next.setUTCDate(next.getUTCDate() + 7 * options.interval);
  else if (recurrence === 'weekly') {
    // Bounded by the validated interval: at most 365 weeks plus one week.
    for (let day = 1; day <= options.interval * 7 + 7; day++) {
      next.setUTCDate(next.getUTCDate() + 1);
      const week = Math.floor((monday(next) - monday(anchor)) / 7);
      if (((week % options.interval) + options.interval) % options.interval === 0 && options.weekdays.includes(isoWeekday(next))) break;
    }
  } else {
    next.setUTCDate(1);
    if (recurrence === 'monthly') next.setUTCMonth(base.getUTCMonth() + options.interval);
    else next.setUTCFullYear(base.getUTCFullYear() + options.interval, anchor.getUTCMonth(), 1);
    const monthEnd = new Date(next);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    next.setUTCDate(Math.min(anchor.getUTCDate(), monthEnd.getUTCDate()));
  }
  const result = new Date(next.getTime() - OFFSET);
  return Number.isFinite(result.getTime()) && next > base ? result : null;
}

export function recurrenceLabel(recurrence, input) {
  if (!recurrence || recurrence === 'none') return 'Không lặp lại';
  const { interval, weekdays, basis } = normalizeRecurrenceOptions(recurrence, input);
  const unit = { daily: 'ngày', weekly: 'tuần', monthly: 'tháng', yearly: 'năm' }[recurrence];
  const days = weekdays.length ? ` (${weekdays.map(d => d === 7 ? 'CN' : `T${d + 1}`).join(', ')})` : '';
  return `Mỗi ${interval} ${unit}${days}${basis === 'completion' ? ', từ lúc hoàn thành' : ', từ hạn kỳ trước'}`;
}
