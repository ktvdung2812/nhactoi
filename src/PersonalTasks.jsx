import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { parseQuickTask, personalTaskGroups, planningDay } from '../shared/personal-planning.mjs';
import './personal-tasks.css';

const TITLES = { inbox: 'Inbox', today: 'Hôm nay', upcoming: 'Sắp tới' };
const localInput = value => value ? new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16) : '';
const dateLabel = value => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function PersonalTasks({ api, me, view, refreshToken, onOpen, onChanged }) {
  const [tasks, setTasks] = useState([]);
  const [text, setText] = useState('');
  const [recognize, setRecognize] = useState(true);
  const [manualDue, setManualDue] = useState(null);
  const [remind, setRemind] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let canceled = false;
    api('/personal-tasks').then(result => {
      if (!canceled) { setTasks(result.tasks); setError(''); }
    }).catch(e => { if (!canceled) setError(e.message); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [api, refreshToken, revision]);

  const parsed = recognize ? parseQuickTask(text) : { title: text.trim(), dueAt: null, error: '' };
  const dueInput = manualDue === null ? localInput(parsed.dueAt) : manualDue;
  const readOnly = Boolean(me.workspace.suspendedAt) || ['expired', 'canceled'].includes(me.subscription?.status) || Date.parse(me.subscription?.currentPeriodEnd) <= Date.now();
  const groups = useMemo(() => personalTaskGroups(tasks, view), [tasks, view]);
  const today = planningDay();

  async function mutate(fn, success) {
    if (busy || readOnly) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await fn();
      if (!mounted.current) return;
      setMessage(success);
      setRevision(n => n + 1);
      await onChanged();
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function add(event) {
    event.preventDefault();
    if (!parsed.title || (parsed.error && manualDue === null)) return;
    const dueAt = dueInput ? new Date(`${dueInput}:00+07:00`).toISOString() : null;
    await mutate(async () => {
      await api('/tasks', { method: 'POST', body: JSON.stringify({ title: parsed.title, dueAt, remindAt: remind ? dueAt : null, assigneeId: me.user.id }) });
      if (mounted.current) { setText(''); setManualDue(null); }
    }, dueAt ? 'Đã thêm công việc có hạn. Xem trong Hôm nay hoặc Sắp tới.' : 'Đã lưu công việc vào Inbox.');
  }

  const plan = (task, plannedDate) => mutate(() => api(`/tasks/${encodeURIComponent(task.id)}/plan`, {
    method: 'PATCH', body: JSON.stringify({ plannedDate: plannedDate || null }),
  }), plannedDate ? 'Đã cập nhật ngày dự định làm. Hạn hoàn thành giữ nguyên.' : 'Đã bỏ ngày dự định làm.');

  return <section className="personal-tasks">
    <header className="personal-heading"><h1>{TITLES[view]}</h1><p>{view === 'inbox' ? 'Ghi lại việc cần nhớ, lên lịch khi bạn sẵn sàng.' : view === 'today' ? 'Chọn việc để tập trung hôm nay. Ngày dự định làm độc lập với hạn hoàn thành.' : 'Xem trước công việc theo ngày dự định làm và hạn sắp đến.'}</p></header>
    <p className="personal-scope">Việc giao cho bạn và việc bạn tạo chưa giao ai trong không gian này. Quyền chia sẻ của công việc giữ nguyên. Giờ Việt Nam (UTC+7).</p>
    {readOnly && <p role="status">Không gian đang ở chế độ chỉ đọc. Bạn vẫn có thể xem công việc.</p>}
    <form className="personal-capture" onSubmit={add}>
      <fieldset disabled={busy || readOnly}>
        <label className="field"><span>Thêm việc nhanh</span><div className="personal-capture-row"><input aria-label="Nội dung việc nhanh" value={text} maxLength={240} placeholder="Ví dụ: mai 9h gửi báo giá cho An" onChange={e => { setText(e.target.value); setManualDue(null); }} /><button className="button" type="submit" disabled={!parsed.title || Boolean(parsed.error && manualDue === null)}><Plus size={16} />Thêm việc</button></div></label>
        <div className="personal-capture-options">
          <label><input type="checkbox" checked={recognize} onChange={e => { setRecognize(e.target.checked); setManualDue(null); }} />Nhận diện ngày giờ</label>
          <label className="field"><span>Hạn hoàn thành (không bắt buộc, UTC+7)</span><input aria-label="Hạn việc nhanh" type="datetime-local" value={dueInput} onChange={e => setManualDue(e.target.value)} /></label>
          <button className="button secondary" type="button" onClick={() => setManualDue('')}>Không đặt hạn</button>
          <label><input type="checkbox" checked={remind} disabled={!dueInput} onChange={e => setRemind(e.target.checked)} />Nhắc đúng hạn</label>
        </div>
        {text.trim() && <p className="personal-preview" aria-live="polite">{parsed.error && manualDue === null ? parsed.error : <>Sẽ lưu: <strong>{parsed.title}</strong> · {dueInput ? `Hạn ${dateLabel(`${dueInput}:00+07:00`)} (UTC+7)` : 'Chưa đặt hạn'}{dueInput && remind ? ' · Nhắc đúng hạn' : ''}</>}</p>}
        <p className="personal-help">Nhận diện “hôm nay”, “mai”, “ngày mai”, “ngày kia”, giờ dạng 9h hoặc 09:30. Có ngày mà chưa có giờ: gợi ý 17:00. Tắt nhận diện để giữ nguyên câu.</p>
        <p className="personal-help">Lời nhắc xuất hiện trong ứng dụng; email và Android tùy cấu hình. Ngày dự định làm không tự tạo lời nhắc.</p>
      </fieldset>
    </form>
    {error && <div className="personal-error" role="alert">{error} <button className="button secondary" onClick={() => setRevision(n => n + 1)}>Tải lại</button></div>}
    {message && <p className="personal-feedback" role="status">{message}</p>}
    {loading ? <p role="status">Đang tải công việc…</p> : groups.length === 0 ? <p className="personal-empty">{view === 'inbox' ? 'Inbox đang trống. Thêm một việc chưa có hạn ở phía trên.' : view === 'today' ? 'Chưa có việc cho hôm nay. Chọn “Làm hôm nay” từ Inbox hoặc Sắp tới.' : 'Chưa có công việc sắp tới. Đặt hạn hoặc ngày dự định làm để lên kế hoạch.'}</p> : groups.map(group => <section key={group.label} className="personal-group">
      <h2>{view === 'upcoming' ? new Date(`${group.label}T12:00:00+07:00`).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : group.label} <span>{group.tasks.length}</span></h2>
      {group.tasks.map(task => <article className="personal-task" key={task.id}>
        <button className="icon-button personal-complete" aria-label={`Hoàn thành ${task.title}`} disabled={busy || readOnly} onClick={() => mutate(() => api(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }), 'Đã hoàn thành công việc.')}><Check size={18} /></button>
        <div className="personal-task-content"><button className="personal-task-title" onClick={() => onOpen(task)}>{task.title}</button><p>{task.teamName || 'Việc chung'} · {task.dueAt ? `Hạn ${dateLabel(task.dueAt)}` : 'Chưa đặt hạn'}{task.plannedDate && ` · Dự định làm ${task.plannedDate.split('-').reverse().join('/')}`}</p></div>
        <div className="personal-task-actions">
          {task.plannedDate !== today && <button className="button secondary" disabled={busy || readOnly} onClick={() => plan(task, today)}>Làm hôm nay</button>}
          <label className="field"><span>Ngày dự định làm</span><input type="date" aria-label={`Ngày dự định làm: ${task.title}`} value={task.plannedDate || ''} disabled={busy || readOnly} onChange={e => plan(task, e.target.value)} /></label>
          {task.plannedDate && <button className="button secondary" disabled={busy || readOnly} onClick={() => plan(task, null)}>Bỏ ngày</button>}
        </div>
      </article>)}
    </section>)}
  </section>;
}
