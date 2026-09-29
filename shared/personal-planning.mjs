import { vietnamDate } from './service-renewal.mjs';

export function planningDay(now = new Date()) {
  return vietnamDate(now);
}

// Deliberately recognize only explicit relative days and clock times. Unknown
// wording stays in the title; users can disable recognition or edit the preview.
export function parseQuickTask(input, now = new Date()) {
  const original = String(input || '').trim();
  let day = /(?:^|\s)(ngày kia|ngày mai|hôm nay|mai)(?=\s|$)/iu.exec(original);
  // Preserve a person's name, e.g. "gọi Mai", instead of treating it as tomorrow.
  if (day?.[1] === 'Mai' && day.index > 0) day = null;
  const time = /(?:^|\s)(\d{1,2})(?:h|:)(\d{2})?(?=\s|$)/iu.exec(original);
  if (!day && !time) return { title: original, dueAt: null, recognized: false, error: '' };
  const hour = time ? Number(time[1]) : 17;
  const minute = time?.[2] ? Number(time[2]) : 0;
  if (hour > 23 || minute > 59) return { title: original, dueAt: null, recognized: false, error: 'Giờ không hợp lệ. Hãy dùng 0–23 giờ và 0–59 phút.' };
  const offset = day ? ({ 'ngày kia': 2, 'ngày mai': 1, mai: 1, 'hôm nay': 0 })[day[1].toLocaleLowerCase('vi')] : 0;
  const date = new Date(`${planningDay(now)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  const dueAt = new Date(`${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`).toISOString();
  let title = original;
  for (const match of [day, time].filter(Boolean).sort((a, b) => b.index - a.index)) {
    title = title.slice(0, match.index) + ' ' + title.slice(match.index + match[0].length);
  }
  title = title.replace(/\s+/g, ' ').trim();
  return { title, dueAt, recognized: true, error: title ? '' : 'Hãy nhập nội dung công việc.' };
}

export function personalTaskGroups(tasks, view, now = new Date()) {
  const today = planningDay(now);
  const groups = new Map();
  for (const task of tasks) {
    if (task.status === 'done' || task.teamArchived) continue;
    const due = task.dueAt ? planningDay(task.dueAt) : null;
    const plan = task.plannedDate;
    let key;
    if (view === 'inbox' && !due && !plan) key = 'Chưa lên lịch';
    if (view === 'today') {
      if ((due && due < today) || (plan && plan < today)) key = 'Cần xem lại';
      else if (due === today || plan === today) key = 'Hôm nay';
    }
    if (view === 'upcoming') {
      // Keep the deadline visible even when the personal plan is later.
      const dates = [due, plan].filter(d => d && d > today).sort();
      key = dates[0];
    }
    if (key) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, items]) => ({
    label,
    tasks: items.sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999') || a.title.localeCompare(b.title, 'vi')),
  }));
}
