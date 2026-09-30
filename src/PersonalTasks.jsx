import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bell, Calendar, Check, HelpCircle, Plus, Sparkles, X } from 'lucide-react';
import { parseQuickTask, personalTaskGroups, planningDay } from '../shared/personal-planning.mjs';
import PersonalDashboard from './PersonalDashboard.jsx';
import './personal-tasks.css';

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
    method: 'PATCH',
    body: JSON.stringify({ plannedDate: plannedDate || null }),
  }), plannedDate ? 'Đã cập nhật ngày dự định làm. Hạn hoàn thành giữ nguyên.' : 'Đã bỏ ngày dự định làm.');

  const capture = <form className="personal-capture personal-capture-compact" onSubmit={add}>
      <fieldset disabled={busy || readOnly}>
        <div className="personal-capture-head">
          <span className="personal-capture-label">
            <Sparkles size={15} className="personal-capture-icon" />
            <span>Thêm việc nhanh</span>
          </span>
          <details className="personal-capture-guide">
            <summary className="personal-capture-guide-summary">
              <HelpCircle size={14} />
              <span>Gợi ý cú pháp</span>
            </summary>
            <div className="personal-capture-guide-popover">
              <p>Nhận diện từ khóa: <code>hôm nay</code>, <code>mai</code>, <code>ngày mai</code>, <code>ngày kia</code>; giờ dạng <code>9h</code> hoặc <code>09:30</code> (nếu chưa có giờ: mặc định 17:00). Tắt nhận diện để giữ nguyên câu.</p>
              <p>Lời nhắc xuất hiện trong app; email và Android tùy cấu hình hệ thống.</p>
            </div>
          </details>
        </div>

        <div className="personal-capture-main">
          <div className="personal-capture-input-wrap">
            <input
              className="personal-capture-input"
              aria-label="Nội dung việc nhanh"
              value={text}
              maxLength={240}
              placeholder="Ví dụ: mai 9h gửi báo giá cho An"
              onChange={e => { setText(e.target.value); setManualDue(null); }}
            />
            {text && (
              <button
                type="button"
                className="personal-capture-input-clear"
                onClick={() => { setText(''); setManualDue(null); }}
                title="Xóa nội dung"
                aria-label="Xóa nội dung"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className="button personal-capture-submit"
            type="submit"
            disabled={!parsed.title || Boolean(parsed.error && manualDue === null)}
          >
            <Plus size={16} />
            <span>Thêm việc</span>
          </button>
        </div>

        <div className="personal-capture-toolbar">
          <div className="personal-capture-field-group">
            <div className={`personal-capture-due-control ${dueInput ? 'is-set' : ''}`}>
              <Calendar size={14} className="personal-capture-due-icon" />
              <span className="personal-capture-due-caption">Hạn:</span>
              <input
                aria-label="Hạn việc nhanh"
                type="datetime-local"
                className="personal-capture-datetime"
                value={dueInput}
                onChange={e => setManualDue(e.target.value)}
              />
              {dueInput && (
                <button
                  type="button"
                  className="personal-capture-clear-due"
                  onClick={() => setManualDue('')}
                  title="Không đặt hạn"
                  aria-label="Không đặt hạn"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          <div className="personal-capture-toggles">
            <label className={`personal-capture-chip ${recognize ? 'is-active' : ''}`}>
              <input
                type="checkbox"
                checked={recognize}
                onChange={e => { setRecognize(e.target.checked); setManualDue(null); }}
              />
              <Sparkles size={13} />
              <span>Nhận diện ngày giờ</span>
            </label>

            <label className={`personal-capture-chip ${remind && dueInput ? 'is-active' : ''} ${!dueInput ? 'is-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={remind}
                disabled={!dueInput}
                onChange={e => setRemind(e.target.checked)}
              />
              <Bell size={13} />
              <span>Nhắc đúng hạn</span>
            </label>
          </div>
        </div>

        {text.trim() && (
          <div className={`personal-preview ${parsed.error && manualDue === null ? 'personal-preview-error' : ''}`} aria-live="polite">
            {parsed.error && manualDue === null ? (
              <div className="personal-preview-err-row">
                <AlertCircle size={15} />
                <span>{parsed.error}</span>
              </div>
            ) : (
              <div className="personal-preview-content">
                <span className="personal-preview-prefix">Sẽ lưu:</span>
                <strong className="personal-preview-title">{parsed.title}</strong>
                <div className="personal-preview-tags">
                  <span className="personal-preview-tag">
                    <Calendar size={12} />
                    {dueInput ? `Hạn ${dateLabel(`${dueInput}:00+07:00`)}` : 'Chưa đặt hạn'}
                  </span>
                  {dueInput && remind && (
                    <span className="personal-preview-tag tag-remind">
                      <Bell size={12} /> Nhắc đúng hạn
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </fieldset>
    </form>;

  const list = loading ? <p role="status">Đang tải công việc…</p> : groups.length === 0 ? <p className="personal-empty">{view === 'inbox' ? 'Inbox đang trống. Thêm một việc chưa có hạn ở phía trên.' : view === 'today' ? 'Chưa có việc cho hôm nay. Chọn “Làm hôm nay” từ Inbox hoặc Sắp tới.' : 'Chưa có công việc sắp tới. Đặt hạn hoặc ngày dự định làm để lên kế hoạch.'}</p> : groups.map(group => <section key={group.label} className="personal-group">
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
    </section>);

  return <section className="personal-tasks personal-tasks-dash">
    {readOnly && <p role="status">Không gian đang ở chế độ chỉ đọc. Bạn vẫn có thể xem công việc.</p>}
    {error && <div className="personal-error" role="alert">{error} <button className="button secondary" onClick={() => setRevision(n => n + 1)}>Tải lại</button></div>}
    {message && <p className="personal-feedback" role="status">{message}</p>}
    <PersonalDashboard view={view} me={me} tasks={tasks} groups={groups} capture={capture} list={list} readOnly={readOnly} busy={busy}
      onOpen={onOpen} onPlan={plan} onSuggest={value => { setText(value); setManualDue(null); }} />
  </section>;
}
