import { planningDay } from './personal-planning.mjs';

export function addPlanningDays(day, amount) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function planningWeek(day) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
  const monday = addPlanningDays(day, 1 - weekday);
  return Array.from({ length: 7 }, (_, i) => addPlanningDays(monday, i));
}
export function vietnamClock(value) {
  return new Date(value).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
}
export function plannedEnd(time, duration) {
  const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + duration;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
// Only persisted task occurrences are shown. Deadlines remain visible even
// when the user's personal plan is on another day or in another week.
export function weekEntries(tasks, events, dates) {
  return dates.map(date => {
    const entries = [];
    for (const task of tasks) {
      if (task.status === 'done' || task.teamArchived) continue;
      if (task.plannedDate === date) entries.push({ kind: 'plan', item: task, time: task.plannedTime || '', label: task.plannedTime ? `${task.plannedTime}–${plannedEnd(task.plannedTime, task.plannedDuration || 60)}` : 'Chưa đặt giờ' });
      if (task.dueAt && planningDay(task.dueAt) === date) entries.push({ kind: 'deadline', item: task, time: vietnamClock(task.dueAt), label: `Hạn ${vietnamClock(task.dueAt)}` });
    }
    const start = Date.parse(`${date}T00:00:00+07:00`), end = start + 86400000;
    for (const event of events) {
      if (event.status === 'done') continue;
      const from = Date.parse(event.starts_at), to = Date.parse(event.ends_at);
      if (from < end && to > start) entries.push({ kind: event.service_id ? 'renewal' : 'event', item: event,
        time: from < start ? '' : vietnamClock(event.starts_at),
        label: `${from < start ? 'Tiếp từ ngày trước' : vietnamClock(event.starts_at)}–${to >= end ? '24:00' : vietnamClock(event.ends_at)}` });
    }
    entries.sort((a, b) => a.time.localeCompare(b.time) || a.item.title.localeCompare(b.item.title, 'vi'));
    return { date, entries };
  });
}
