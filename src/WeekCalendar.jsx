import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Plus } from 'lucide-react';
import { planningDay } from '../shared/personal-planning.mjs';
import { addPlanningDays, planningWeek, weekEntries } from '../shared/week-planning.mjs';
import './week-calendar.css';

const dayLabel = value => new Date(`${value}T12:00:00+07:00`).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit' });
const kinds = { plan: 'Dự định làm', deadline: 'Deadline', event: 'Lịch hẹn', renewal: 'Gia hạn' };

export default function WeekCalendar({ api, me, refreshToken, onOpenTask, onOpenEvent, onChanged }) {
  const today = planningDay();
  const [anchor, setAnchor] = useState(today);
  const [data, setData] = useState({ tasks: [], events: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const dates = useMemo(() => planningWeek(anchor), [anchor]);
  const days = useMemo(() => weekEntries(data.tasks, data.events, dates), [data, dates]);
  const readOnly = Boolean(me.workspace.suspendedAt) || ['expired', 'canceled'].includes(me.subscription?.status) || Date.parse(me.subscription?.currentPeriodEnd) <= Date.now();
  const editable = data.tasks.filter(task => task.status !== 'done' && !task.teamArchived);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api('/personal-tasks'), api('/calendar-events')])
      .then(([tasks, events]) => { if (active) { setData({ tasks: tasks.tasks, events: events.events }); setError(''); } })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refreshToken]);

  function edit(task, date) {
    setEditor({ id: task?.id || '', plannedDate: date || task?.plannedDate || today, plannedTime: task?.plannedTime || '', plannedDuration: task?.plannedDuration || 60 });
  }
  async function schedule(id, plan) {
    if (busy || readOnly || !editable.some(task => task.id === id)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/tasks/${encodeURIComponent(id)}/plan`, { method: 'PATCH', body: JSON.stringify(plan) });
      // Apply the successful mutation before refreshing so a failed read cannot
      // leave an editor open that appears to require resubmitting the write.
      setData(current => ({ ...current, tasks: current.tasks.map(task => task.id === id ? { ...task, ...plan } : task) }));
      setEditor(null);
      setNotice(plan.plannedDate ? 'Đã lưu lịch cá nhân. Deadline và lời nhắc giữ nguyên.' : 'Đã bỏ lịch cá nhân.');
      await onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="week-calendar">
    <header className="week-calendar-heading">
      <div><h1>Lịch tuần</h1><p>Sắp xếp việc của bạn theo giờ Việt Nam (UTC+7).</p></div>
      <div className="week-calendar-controls">
        <button type="button" className="button secondary" onClick={() => setAnchor(today)}><CalendarDays size={16} />Hôm nay</button>
        <button type="button" className="icon-button" aria-label="Tuần trước" onClick={() => setAnchor(addPlanningDays(dates[0], -7))}><ArrowLeft size={18} /></button>
        <strong>{dates[0].slice(8)}/{dates[0].slice(5, 7)} – {dates[6].slice(8)}/{dates[6].slice(5, 7)}/{dates[6].slice(0, 4)}</strong>
        <button type="button" className="icon-button" aria-label="Tuần sau" onClick={() => setAnchor(addPlanningDays(dates[0], 7))}><ArrowRight size={18} /></button>
      </div>
    </header>
    {readOnly && <p role="status">Không gian đang ở chế độ chỉ đọc.</p>}
    {error && <p className="week-calendar-error" role="alert">{error}</p>}
    {notice && <p className="week-calendar-notice" role="status">{notice}</p>}
    {editor && <form className="week-calendar-editor" onSubmit={event => {
      event.preventDefault();
      void schedule(editor.id, { plannedDate: editor.plannedDate, plannedTime: editor.plannedTime || null, plannedDuration: Number(editor.plannedDuration) });
    }}>
      <h2>Lên lịch cá nhân</h2>
      <label className="field"><span>Công việc</span><select autoFocus required value={editor.id} disabled={busy} onChange={e => {
        const task = editable.find(task => task.id === e.target.value);
        setEditor(current => ({ ...current, id: e.target.value, plannedTime: task?.plannedTime || '', plannedDuration: task?.plannedDuration || 60 }));
      }}><option value="">Chọn công việc</option>{editable.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      <label className="field"><span>Ngày làm</span><input type="date" required value={editor.plannedDate} disabled={busy} onChange={e => setEditor({ ...editor, plannedDate: e.target.value })} /></label>
      <label className="field"><span>Giờ bắt đầu (không bắt buộc)</span><input type="time" value={editor.plannedTime} disabled={busy} onChange={e => setEditor({ ...editor, plannedTime: e.target.value })} /></label>
      <label className="field"><span>Thời lượng (phút)</span><input type="number" min="15" max="1440" step="1" required value={editor.plannedDuration} disabled={busy} onChange={e => setEditor({ ...editor, plannedDuration: e.target.value })} /></label>
      <p>Khoảng làm việc phải kết thúc trong cùng ngày. Lịch này chỉ áp dụng cho bạn.</p>
      <div className="week-calendar-editor-actions">
        <button className="button" disabled={busy || readOnly}>Lưu lịch</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => setEditor(null)}>Hủy</button>
        {data.tasks.find(task => task.id === editor.id)?.plannedDate && <button type="button" className="button secondary" disabled={busy || readOnly} onClick={() => schedule(editor.id, { plannedDate: null, plannedTime: null, plannedDuration: 60 })}>Bỏ lịch cá nhân</button>}
      </div>
    </form>}
    {loading && <p role="status">Đang tải lịch…</p>}
    <div className="week-calendar-grid" aria-label="Lịch tuần">
      {days.map(({ date, entries }) => <section key={date} className={`week-calendar-day${date === today ? ' is-today' : ''}`} aria-label={dayLabel(date)}
        onDragOver={event => { if (!readOnly && !busy && event.dataTransfer.types.includes('application/x-nhactoi-plan')) event.preventDefault(); }}
        onDrop={event => {
          event.preventDefault();
          const id = event.dataTransfer.getData('application/x-nhactoi-plan');
          if (editable.some(task => task.id === id && task.plannedDate)) void schedule(id, { plannedDate: date });
        }}>
        <header className="week-calendar-day-heading"><span>{dayLabel(date)}</span><strong>{date.slice(8)}</strong></header>
        <div className="week-calendar-items">
          {entries.map(({ kind, item, label }) => <article className={`week-calendar-item ${kind}`} key={`${kind}:${item.id}`} draggable={kind === 'plan' && !readOnly && !busy}
            onDragStart={event => { event.dataTransfer.setData('application/x-nhactoi-plan', item.id); event.dataTransfer.effectAllowed = 'move'; }}>
            <button type="button" className="week-calendar-item-title" onClick={() => kind === 'plan' || kind === 'deadline' ? onOpenTask(item) : onOpenEvent(item)}>{item.title}</button>
            <small>{kinds[kind]} · {label}</small>
            {(kind === 'plan' || kind === 'deadline') && <button type="button" className="week-calendar-edit" disabled={readOnly || busy} onClick={() => edit(item)}>Sắp lịch</button>}
          </article>)}
          {!entries.length && <span className="week-calendar-empty">Không có mục</span>}
        </div>
        <button type="button" className="week-calendar-add" disabled={readOnly || busy || !editable.length} onClick={() => edit(null, date)}><Plus size={14} />Lên lịch việc</button>
      </section>)}
    </div>
    <p className="week-calendar-footnote">Kéo mục “Dự định làm” sang ngày khác hoặc dùng “Sắp lịch”. Deadline và lời nhắc không đổi. Lịch hẹn và gia hạn hiển thị theo quyền truy cập; kỳ lặp công việc tiếp theo chỉ xuất hiện sau khi hoàn thành kỳ hiện tại.</p>
  </section>;
}
