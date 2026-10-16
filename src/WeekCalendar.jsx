import { useTaskMutation } from './useTaskMutation.js';
import { useGuardedApi, staleRequest } from './useGuardedApi.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, ArrowLeft, ArrowRight, BadgeDollarSign, Calendar, CalendarClock, CalendarDays, CalendarPlus, Clock, Hourglass, Plus } from 'lucide-react';
import { planningDay } from '../shared/personal-planning.mjs';
import { addPlanningDays, planningWeek, weekEntries } from '../shared/week-planning.mjs';
import { AssistCard, Badge, Card, Hero, NextCard, Pill, StatsCard, Timeline, Unscheduled, clock, firstName, minutesOf, scrollToId, useNow, vnMinutes } from './PlannerDashboard.jsx';
import './week-calendar.css';
import TaskPicker from './TaskPicker.jsx';

const dayLabel = value => new Date(`${value}T12:00:00+07:00`).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit' });
const kinds = { plan: 'Dự định làm', deadline: 'Deadline', event: 'Lịch hẹn', renewal: 'Gia hạn' };
const kindTones = { plan: 'green', deadline: 'coral', event: 'blue', renewal: 'amber' };
const kindIcons = { plan: Clock, deadline: AlarmClock, event: CalendarDays, renewal: BadgeDollarSign };
const EDITOR_ID = 'week-schedule';
const LIST_ID = 'week-all-items';

// Minutes within `date` covered by a week entry; null when it has no time.
function entrySlot({ kind, item }, date) {
  if (kind === 'plan') {
    if (!item.plannedTime) return null;
    const start = minutesOf(item.plannedTime);
    return { start, end: Math.min(1440, start + (item.plannedDuration || 60)) };
  }
  if (kind === 'deadline') { const end = Math.max(30, vnMinutes(item.dueAt)); return { start: Math.max(0, end - 60), end }; }
  const dayStart = Date.parse(`${date}T00:00:00+07:00`), dayEnd = dayStart + 86400000;
  const from = Date.parse(item.starts_at), to = Date.parse(item.ends_at);
  return { start: from <= dayStart ? 0 : vnMinutes(item.starts_at), end: to >= dayEnd ? 1440 : Math.max(1, vnMinutes(item.ends_at)) };
}

export default function WeekCalendar({ api: request, me, refreshToken, onOpenTask, onOpenEvent, onChanged }) {
  const now = useNow();
  const today = planningDay(now);
  const [anchor, setAnchor] = useState(today);
  const draggedPlan = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [denied,setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [revision,setRevision] = useState(0);
  const [paging,setPaging] = useState({anchor,page:1,eventPage:1});
  const page=paging.anchor===anchor?paging.page:1,eventPage=paging.anchor===anchor?paging.eventPage:1;
  const [guardedApi,isCurrent]=useGuardedApi(request,()=>{setSnapshot(null);setDenied(true);setNotice('');setEditor(current=>current?{...current,id:'',task:null,planRevision:undefined}:null);},me.workspace.id);
  const api = useTaskMutation(guardedApi, `${me.workspace.id}:${me.user.id}`);
  const resultKey=`${anchor}:${page}:${eventPage}`;
  const data=snapshot?.key===resultKey&&snapshot.api===api&&snapshot.guard===guardedApi?snapshot:{tasks:[],events:[]};
  const dates = useMemo(() => planningWeek(anchor), [anchor]);
  const days = useMemo(() => weekEntries(data.tasks, data.events, dates), [data, dates]);
  const readOnly = denied || Boolean(me.workspace.suspendedAt) || ['expired', 'canceled'].includes(me.subscription?.status) || Date.parse(me.subscription?.currentPeriodEnd) <= Date.now();
  const editable = data.tasks.filter(task => task.status !== 'done' && !task.teamArchived);

  useEffect(()=>{setEditor(null);setBusy(false);},[api]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api(`/personal-tasks?view=week&date=${dates[0]}&page=${page}&pageSize=50`), me.user.memberType==='guest'?Promise.resolve({events:[],total:0}):api(`/calendar-events?from=${dates[0]}&to=${dates[6]}&openOnly=true&page=${eventPage}&pageSize=50`)])
      .then(([tasks, events]) => { if (active) { setSnapshot({ key:resultKey,api,guard:guardedApi,tasks: tasks.tasks, events: events.events, taskPage:tasks,eventPage:events }); setDenied(false); setError(''); } })
      .catch(e => { if (active&&!staleRequest(e)) {setSnapshot(null);setError(e.message);} })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, guardedApi, refreshToken, dates, page, eventPage, me.user.memberType, revision, resultKey]);

  function edit(task, date) {
    setEditor({ task, planRevision:task?.planRevision, id: task?.id || '', plannedDate: date || task?.plannedDate || today, plannedTime: task?.plannedTime || '', plannedDuration: task?.plannedDuration || 60 });
    setTimeout(() => scrollToId(EDITOR_ID), 0);
  }
  async function schedule(id, plan, capturedRevision) {
    if (busy || readOnly || !(editor?.id===id && editor?.task || editable.some(task => task.id === id))) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/tasks/${encodeURIComponent(id)}/plan`, { method: 'PATCH', body: JSON.stringify({...plan, expectedRevision: capturedRevision ?? (editor?.id===id ? editor.planRevision : data.tasks.find(task=>task.id===id)?.planRevision)}) });
      // Apply the successful mutation before refreshing so a failed read cannot
      // leave an editor open that appears to require resubmitting the write.
      setSnapshot(current => current && ({ ...current, tasks: current.tasks.map(task => task.id === id ? { ...task, ...plan } : task) }));
      setEditor(null);
      setRevision(n=>n+1);
      setNotice(plan.plannedDate ? 'Đã lưu lịch cá nhân. Deadline và lời nhắc giữ nguyên.' : 'Đã bỏ lịch cá nhân.');
      try { await onChanged?.(); }
      catch (e) { if (isCurrent() && !staleRequest(e)) setNotice(`Đã lưu lịch. Chưa làm mới được danh sách: ${e.message}`); }
    } catch (e) { if(!staleRequest(e))setError(e.message); }
    finally { if(isCurrent())setBusy(false); }
  }
  const nowMin = vnMinutes(now);
  const phase = date => date < today ? 'past' : date === today ? 'today' : 'future';
  const canDrag = !readOnly && !busy;
  const open = (kind, item) => kind === 'plan' || kind === 'deadline' ? onOpenTask(item) : onOpenEvent(item);
  const entryState = (kind, item, slot, date) => {
    if (kind === 'deadline' && Date.parse(item.dueAt) < now.getTime()) return { label: 'Quá hạn', tone: 'danger' };
    if (date < today || (date === today && slot.end <= nowMin)) return { label: kinds[kind], tone: 'past' };
    if (date === today && slot.start <= nowMin) return { label: 'Đang diễn ra', tone: 'live' };
    return { label: kinds[kind], tone: 'next' };
  };
  const untimed = [];
  const rows = days.map(({ date, entries }) => ({
    key: date, name: dayLabel(date), sub: `${entries.length} mục`, icon: CalendarDays, tone: date === today ? 'green' : 'blue', phase: phase(date),
    onAdd: readOnly || busy ? undefined : () => edit(null, date),
    entries: entries.flatMap(entry => {
      const slot = entrySlot(entry, date);
      if (!slot) { untimed.push({ key: `${date}:${entry.item.id}`, title: `${dayLabel(date)} · ${entry.item.title}`, onClick: () => edit(entry.item) }); return []; }
      return [{ key: `${entry.kind}:${entry.item.id}`, title: entry.item.title, start: slot.start, end: slot.end, tone: kindTones[entry.kind], icon: kindIcons[entry.kind],
        time: entry.label, state: entryState(entry.kind, entry.item, slot, date), onClick: () => open(entry.kind, entry.item),
        dragId: entry.kind === 'plan' && canDrag && editable.some(task => task.id === entry.item.id) ? entry.item.id : undefined }];
    }),
  }));
  const all = days.flatMap(({ date, entries }) => entries.map(entry => ({ ...entry, date, slot: entrySlot(entry, date) })));
  const count = kind => all.filter(entry => entry.kind === kind).length;
  const next = all.filter(({ date, slot }) => date > today || (date === today && (!slot || slot.end > nowMin))).slice(0, 3).map(({ kind, item, label, date, slot }) => ({
    key: `${date}:${kind}:${item.id}`, title: item.title, desc: `${kinds[kind]}${item.teamName ? ` · ${item.teamName}` : ''}`,
    chips: [{ icon: Calendar, label: date === today ? 'Hôm nay' : dayLabel(date) }, { icon: Clock, label }, slot ? { label: entryState(kind, item, slot, date).label, tone: entryState(kind, item, slot, date).tone } : { label: 'Chưa đặt giờ', tone: 'next' }],
    onClick: () => open(kind, item),
  }));
  const unplanned = editable.filter(task => !task.plannedDate).slice(0, 2);
  const range = `${dates[0].slice(8)}/${dates[0].slice(5, 7)} – ${dates[6].slice(8)}/${dates[6].slice(5, 7)}/${dates[6].slice(0, 4)}`;

  const taskPaged = Number.isFinite(data.taskPage?.total) && (page > 1 || data.taskPage.hasMore);
  const eventPaged = data.eventPage?.total > 0 && (eventPage > 1 || data.eventPage.hasMore);
  return <section className="week-calendar week-calendar-dash">
    {readOnly && <p role="status">Không gian đang ở chế độ chỉ đọc.</p>}
    {error && <p className="week-calendar-error" role="alert">{error} <button onClick={()=>setRevision(n=>n+1)}>Tải lại</button></p>}
    {notice && <p className="week-calendar-notice" role="status">{notice}</p>}
    {loading && <p role="status">Đang tải lịch…</p>}
    {taskPaged && <nav className="task-pagination" aria-label="Phân trang công việc lịch tuần"><button disabled={loading||page===1} onClick={()=>setPaging({anchor,page:page-1,eventPage})}>Việc trước</button><span role="status">Trang việc {page} · {data.taskPage.total} công việc trong tuần</span><button disabled={loading||!data.taskPage.hasMore} onClick={()=>setPaging({anchor,page:page+1,eventPage})}>Việc tiếp</button></nav>}
    {eventPaged && <nav className="task-pagination" aria-label="Phân trang lịch hẹn tuần"><button disabled={loading||eventPage===1} onClick={()=>setPaging({anchor,page,eventPage:eventPage-1})}>Lịch hẹn trước</button><span role="status">Trang lịch hẹn {eventPage} · {data.eventPage.total} lịch hẹn/gia hạn trong tuần</span><button disabled={loading||!data.eventPage.hasMore} onClick={()=>setPaging({anchor,page,eventPage:eventPage+1})}>Lịch hẹn tiếp</button></nav>}
    {(taskPaged || eventPaged) && <p className="pd-page-note">Lịch, gợi ý và thống kê bên dưới thể hiện các mục trên trang hiện tại.</p>}
    <div className="pd-dash">
      <Hero title="Lịch tuần" subtitle={`${all.length ? `${all.length} mục đang hiển thị: ${count('plan')} dự định làm, ${count('deadline')} deadline, ${count('event') + count('renewal')} lịch hẹn và gia hạn.` : 'Trang này chưa có mục nào.'} Giờ Việt Nam (UTC+7).`}
        tools={<>
          <Badge icon={CalendarDays}>{all.length} mục trên trang</Badge>
          <Pill icon={CalendarDays} onClick={() => setAnchor(today)}>Hôm nay</Pill>
          <span className="pd-hero-nav">
            <Pill icon={ArrowLeft} label="Tuần trước" onClick={() => setAnchor(addPlanningDays(dates[0], -7))} />
            <Pill icon={Calendar}>{range}</Pill>
            <Pill icon={ArrowRight} label="Tuần sau" onClick={() => setAnchor(addPlanningDays(dates[0], 7))} />
          </span>
        </>}
        footer={<Unscheduled icon={Hourglass} label={`${untimed.length} mục chưa đặt giờ`} items={untimed} />}>
        <Timeline caption="Ngày trong tuần" rows={rows} now={now}
          onDrop={(id, row) => { if (canDrag && editable.some(task => task.id === id && task.plannedDate)) void schedule(id, { plannedDate: row.key }); }} />
      </Hero>

      <div className="pd-bottom">
        <NextCard title="Sắp diễn ra" flag="Tiếp theo" items={next} empty="Không còn mục nào trong tuần này." onViewAll={() => scrollToId(LIST_ID)} />
        <StatsCard onViewAll={() => scrollToId(LIST_ID)} stats={[
          { icon: Clock, tone: 'green', value: `${count('plan')} dự định làm`, note: 'lịch cá nhân', noteIcon: CalendarClock },
          { icon: AlarmClock, tone: 'coral', value: `${count('deadline')} deadline`, note: 'hạn hoàn thành', noteIcon: Calendar },
          { icon: CalendarDays, tone: 'blue', value: `${count('event')} lịch hẹn`, note: 'cuộc hẹn', noteIcon: Calendar },
          { icon: BadgeDollarSign, tone: 'amber', value: `${count('renewal')} gia hạn`, note: 'dịch vụ', noteIcon: Calendar },
        ]} />
        <AssistCard id={EDITOR_ID} caption="Lên lịch cá nhân"
          heading={editor ? 'Sắp xếp lịch của bạn' : <>Chào {firstName(me)},<br />tuần này bạn muốn sắp xếp gì?</>}
          suggestions={editor ? [] : [
            ...unplanned.map(task => ({ key: task.id, label: `Sắp lịch: ${task.title}`, icon: CalendarPlus, onClick: () => edit(task) })),
            { key: 'new', label: 'Lên lịch việc', icon: Plus, onClick: () => edit(null, dates.includes(today) ? today : dates[0]) },
          ].filter(() => !readOnly)}>
          {editor ? <form className="week-calendar-editor" onSubmit={event => {
        event.preventDefault();
        void schedule(editor.id, { plannedDate: editor.plannedDate, plannedTime: editor.plannedTime || null, plannedDuration: Number(editor.plannedDuration) });
      }}>
        <h2>Lên lịch cá nhân</h2>
        <TaskPicker api={api} personal value={editor.id} selectedTask={editor.task} disabled={busy||readOnly} onChange={(id,task)=>setEditor(current=>({...current,id,task,planRevision:task?.planRevision,plannedTime:task?.plannedTime||'',plannedDuration:task?.plannedDuration||60}))}/>

        <label className="field"><span>Ngày làm</span><input type="date" required value={editor.plannedDate} disabled={busy} onChange={e => setEditor({ ...editor, plannedDate: e.target.value })} /></label>
        <label className="field"><span>Giờ bắt đầu (không bắt buộc)</span><input type="time" value={editor.plannedTime} disabled={busy} onChange={e => setEditor({ ...editor, plannedTime: e.target.value })} /></label>
        <label className="field"><span>Thời lượng (phút)</span><input type="number" min="15" max="1440" step="1" required value={editor.plannedDuration} disabled={busy} onChange={e => setEditor({ ...editor, plannedDuration: e.target.value })} /></label>
        <p>Khoảng làm việc phải kết thúc trong cùng ngày. Lịch này chỉ áp dụng cho bạn.</p>
        <div className="week-calendar-editor-actions">
          <button className="button" disabled={busy || readOnly}>Lưu lịch</button>
          <button type="button" className="button secondary" disabled={busy} onClick={() => setEditor(null)}>Hủy</button>
          {editor.task?.plannedDate && <button type="button" className="button secondary" disabled={busy || readOnly} onClick={() => schedule(editor.id, { plannedDate: null, plannedTime: null, plannedDuration: 60 })}>Bỏ lịch cá nhân</button>}
        </div>
      </form> : <p className="pd-muted">Chọn một việc để đặt ngày, giờ bắt đầu và thời lượng, hoặc kéo khối “Dự định làm” trên lịch sang ngày khác.</p>}
        </AssistCard>
      </div>

      <Card id={LIST_ID} className="pd-week-list" title="Tất cả mục trong tuần">
        <div className="week-calendar-grid" aria-label="Lịch tuần">
          {days.map(({ date, entries }) => <section key={date} className={`week-calendar-day${date === today ? ' is-today' : ''}`} aria-label={dayLabel(date)}
            onDragOver={event => { if (!readOnly && !busy && event.dataTransfer.types.includes('application/x-nhactoi-plan')) event.preventDefault(); }}
            onDrop={event => {
              event.preventDefault();
              const id = event.dataTransfer.getData('application/x-nhactoi-plan');
              if (editable.some(task => task.id === id && task.plannedDate)) void schedule(id, { plannedDate: date }, draggedPlan.current?.id===id ? draggedPlan.current.revision : undefined);
            }}>
            <header className="week-calendar-day-heading"><span>{dayLabel(date)}</span><strong>{date.slice(8)}</strong></header>
            <div className="week-calendar-items">
              {entries.map(({ kind, item, label }) => <article className={`week-calendar-item ${kind}`} key={`${kind}:${item.id}`} draggable={kind === 'plan' && !readOnly && !busy}
                onDragStart={event => { draggedPlan.current = { id: item.id, revision: item.planRevision }; event.dataTransfer.setData('application/x-nhactoi-plan', item.id); event.dataTransfer.effectAllowed = 'move'; }}>
                <button type="button" className="week-calendar-item-title" onClick={() => kind === 'plan' || kind === 'deadline' ? onOpenTask(item) : onOpenEvent(item)}>{item.title}</button>
                <small>{kinds[kind]} · {label}</small>
                {(kind === 'plan' || kind === 'deadline') && <button type="button" className="week-calendar-edit" disabled={readOnly || busy} onClick={() => edit(item)}>Sắp lịch</button>}
              </article>)}
              {!entries.length && <span className="week-calendar-empty">Không có mục</span>}
            </div>
            <button type="button" className="week-calendar-add" disabled={readOnly || busy} onClick={() => edit(null, date)}><Plus size={14} />Lên lịch việc</button>
          </section>)}
        </div>
        <p className="week-calendar-footnote">Kéo mục “Dự định làm” sang ngày khác hoặc dùng “Sắp lịch”. Deadline và lời nhắc không đổi. Lịch hẹn và gia hạn hiển thị theo quyền truy cập; kỳ lặp công việc tiếp theo chỉ xuất hiện sau khi hoàn thành kỳ hiện tại.</p>
      </Card>
    </div>
  </section>;
}
