import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import { planningDay } from '../shared/personal-planning.mjs';
import './planner-dashboard.css';

// Shared building blocks for the personal planning pages (Hôm nay, Sắp tới,
// Lịch tuần, Inbox): a hero card with an hour timeline and summary cards.
export const HOUR_WIDTH = 132;
const MIN_BLOCK = 60; // minutes; short items still get a readable block
const LANE = 76;
export const TONES = ['green', 'violet', 'blue', 'amber', 'coral'];
export const PRIORITY = { low: 'Thấp', medium: 'Trung bình', high: 'Cao' };
export const DRAG_TYPE = 'application/x-nhactoi-plan';

// All timeline math runs in Vietnam time (UTC+7) to match planning dates.
export const vnMinutes = value => { const d = new Date(value); return ((d.getUTCHours() + 7) % 24) * 60 + d.getUTCMinutes(); };
export const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const shortDay = day => new Date(`${day}T12:00:00+07:00`).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit' });
export const longDay = value => new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
export const minutesOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const dueDay = task => task.dueAt ? planningDay(new Date(task.dueAt)) : null;

export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(id); }, []);
  return now;
}

// A task lands on a day at its planned start, or ends at its deadline when
// only the deadline falls on that day.
export function slotOf(task, day) {
  if (task.plannedDate === day && task.plannedTime) {
    const start = minutesOf(task.plannedTime);
    return { start, end: Math.min(1440, start + (task.plannedDuration || 60)) };
  }
  if (dueDay(task) === day) {
    const end = Math.max(30, vnMinutes(task.dueAt));
    return { start: Math.max(0, end - 60), end, deadline: true };
  }
  return null;
}

export function taskState(task, slot, day, now) {
  const today = planningDay(now), nowMin = vnMinutes(now);
  if ((task.dueAt && Date.parse(task.dueAt) < now.getTime()) || (task.plannedDate && task.plannedDate < today)) return { label: 'Quá hạn', tone: 'danger' };
  if (slot && day === today && slot.start <= nowMin && nowMin < slot.end) return { label: 'Đang diễn ra', tone: 'live' };
  if (slot && day === today && slot.end <= nowMin) return { label: 'Đã qua giờ', tone: 'past' };
  return { label: 'Sắp tới', tone: 'next' };
}

export const scrollToId = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function Pill({ icon: Icon, children, onClick, label }) {
  return onClick
    ? <button type="button" className="pd-pill pd-pill-button" aria-label={label} onClick={onClick}>{Icon && <Icon size={15} />}{children}</button>
    : <span className="pd-pill">{Icon && <Icon size={15} />}{children}</span>;
}

export function Card({ className = '', title, action, children, id }) {
  return <section id={id} className={`pd-card ${className}`}>
    {title && <header className="pd-card-head"><h2>{title}</h2>{action && <Pill icon={ArrowUpRight} onClick={action}>Xem tất cả</Pill>}</header>}
    {children}
  </section>;
}

export function Hero({ title, subtitle, tools, children, footer }) {
  return <section className="pd-card pd-hero">
    <header className="pd-hero-head">
      <div><h1>{title}</h1><p>{subtitle}</p></div>
      <div className="pd-hero-tools">{tools}</div>
    </header>
    {children}
    {footer}
  </section>;
}

export function Badge({ icon: Icon, done, children }) {
  return <span className={`pd-badge ${done ? 'is-done' : ''}`}>{Icon && <Icon size={14} />}{children}</span>;
}

export function RowIcon({ icon: Icon, tone }) {
  return <span className={`pd-row-icon tone-${tone}`}><Icon size={18} /></span>;
}

/*
 * rows: [{ key, name, sub, icon, tone, phase: 'past'|'today'|'future', onAdd, onDrop,
 *          entries: [{ key, title, start, end, deadline, tone, state, time, icon, onClick, dragId }] }]
 */
export function Timeline({ caption, rows, now, empty, onDrop }) {
  const nowMin = vnMinutes(now);
  const showNow = rows.some(row => row.phase === 'today');
  const laid = rows.map(row => {
    // Overlapping entries inside a row are stacked in separate lanes.
    const lanes = [];
    const entries = [...row.entries].sort((a, b) => a.start - b.start).map(entry => {
      let lane = lanes.findIndex(end => end <= entry.start);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = Math.max(entry.end, entry.start + MIN_BLOCK);
      return { ...entry, lane };
    });
    return { ...row, entries, height: Math.max(1, lanes.length) * LANE - 12 };
  });
  const spans = laid.flatMap(row => row.entries);
  const startHour = Math.max(0, Math.min(7, ...(showNow ? [Math.floor(nowMin / 60)] : []), ...spans.map(s => Math.floor(s.start / 60))));
  const endHour = Math.min(24, Math.max(22, ...(showNow ? [Math.ceil((nowMin + 1) / 60)] : []), ...spans.map(s => Math.ceil(Math.max(s.end, s.start + MIN_BLOCK) / 60))));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const x = minutes => ((minutes - startHour * 60) / 60) * HOUR_WIDTH;
  const nowX = x(nowMin);
  const nowHour = Math.floor(nowMin / 60);

  const scroller = useRef(null);
  const scrolled = useRef(false);
  const focusX = showNow ? nowX : spans.length ? x(Math.min(...spans.map(s => s.start))) : 0;
  // Bring the current hour (or the first item) into view once, then leave scrolling to the user.
  useEffect(() => {
    if (scrolled.current || !scroller.current) return;
    scrolled.current = true;
    scroller.current.scrollLeft = Math.max(0, focusX - HOUR_WIDTH);
  }, [focusX]);

  const [dropKey, setDropKey] = useState(null);
  const dropProps = row => row.onDrop || onDrop ? {
    onDragOver: event => { if (event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); setDropKey(row.key); } },
    onDragLeave: () => setDropKey(key => key === row.key ? null : key),
    onDrop: event => { event.preventDefault(); setDropKey(null); const id = event.dataTransfer.getData(DRAG_TYPE); if (id) (row.onDrop || onDrop)(id, row); },
  } : {};

  return <div className="pd-timeline">
    <div className="pd-timeline-side">
      <div className="pd-timeline-caption">{caption}</div>
      {laid.length === 0 && <div className="pd-row-label is-empty">{empty}</div>}
      {laid.map(row => <div key={row.key} className={`pd-row-label ${row.phase === 'today' ? 'is-today' : ''} ${dropKey === row.key ? 'is-drop' : ''}`} style={{ height: row.height }} {...dropProps(row)}>
        <RowIcon icon={row.icon} tone={row.tone} />
        <span className="pd-row-text"><strong>{row.name}</strong><small>{row.sub}</small></span>
        {row.onAdd && <button type="button" className="pd-row-add" aria-label={`Lên lịch việc: ${row.name}`} onClick={row.onAdd}><Plus size={15} /></button>}
      </div>)}
    </div>
    <div className="pd-timeline-scroll" ref={scroller}>
      <div className="pd-timeline-grid" style={{ width: hours.length * HOUR_WIDTH }}>
        <div className="pd-hours">
          {hours.map(h => <span key={h} className={`pd-hour ${showNow && h === nowHour ? 'is-now' : showNow && h < nowHour ? 'is-past' : ''}`}>{showNow && h === nowHour && <small>Bây giờ</small>}{String(h).padStart(2, '0')}:00</span>)}
        </div>
        <div className="pd-lanes">
          {showNow && <div className="pd-now-line" style={{ left: nowX }} aria-hidden="true" />}
          {laid.length === 0 && <div className="pd-lane-row" style={{ height: 64 }} />}
          {laid.map(row => <div key={row.key} className={`pd-lane-row ${dropKey === row.key ? 'is-drop' : ''}`} style={{ height: row.height }} {...dropProps(row)}>
            {row.phase !== 'future' && <div className="pd-past" style={{ width: row.phase === 'past' ? '100%' : Math.max(0, nowX) }} aria-hidden="true" />}
            {row.entries.map(entry => {
              const width = x(Math.max(entry.end, entry.start + MIN_BLOCK)) - x(entry.start) - 4;
              const Icon = entry.icon;
              return <button key={entry.key} type="button" className={`pd-block tone-${entry.tone || row.tone} state-${entry.state.tone}`}
                style={{ left: x(entry.start) + 2, width, top: entry.lane * LANE }}
                title={`${entry.title} · ${entry.time} · ${entry.state.label}`} onClick={entry.onClick}
                draggable={Boolean(entry.dragId)} onDragStart={entry.dragId ? event => { event.dataTransfer.setData(DRAG_TYPE, entry.dragId); event.dataTransfer.effectAllowed = 'move'; } : undefined}>
                <span className="pd-block-icon"><Icon size={16} /></span>
                <span className="pd-block-text"><strong>{entry.title}</strong><small>{entry.time}</small></span>
                {width >= 250 && <span className="pd-block-state">{entry.state.label}</span>}
              </button>;
            })}
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}

// Items without a time slot, shown as chips under a timeline.
export function Unscheduled({ icon: Icon, label, items }) {
  if (!items.length) return null;
  return <p className="pd-unscheduled"><Icon size={14} /> {label}: {items.slice(0, 5).map(item => <button key={item.key} type="button" onClick={item.onClick}>{item.title}</button>)}{items.length > 5 && ` và ${items.length - 5} mục khác`}</p>;
}

/* items: [{ key, title, desc, chips: [{ icon, label, tone }], onClick }] */
export function NextCard({ title = 'Việc tiếp theo', items, empty, onViewAll, flag = 'Làm trước' }) {
  return <Card className="pd-next" title={title} action={onViewAll}>
    {items.length === 0 ? <p className="pd-muted">{empty}</p> : items.map((item, index) => <button key={item.key} type="button" className={`pd-step ${index === 0 ? 'is-first' : ''}`} onClick={item.onClick}>
      <span className="pd-step-head"><strong>{item.title}</strong>{index === 0 && <span className="pd-step-flag">{flag}</span>}</span>
      <span className="pd-step-desc">{item.desc}</span>
      <span className="pd-step-chips">{item.chips.map(({ icon: Icon, label, tone }) => <span key={label} className={`pd-chip ${tone ? `state-${tone}` : ''}`}>{Icon && <Icon size={13} />}{label}</span>)}</span>
    </button>)}
  </Card>;
}

/* stats: [{ icon, tone, value, note, noteIcon }] */
export function StatsCard({ title = 'Tổng quan', stats, onViewAll }) {
  return <Card className="pd-stats" title={title} action={onViewAll}>
    <div className="pd-stat-grid">
      {stats.map(({ icon, tone, value, note, noteIcon: NoteIcon }) => <div key={value} className="pd-stat">
        <RowIcon icon={icon} tone={tone} /><strong>{value}</strong><small>{NoteIcon && <NoteIcon size={12} />} {note}</small>
      </div>)}
    </div>
  </Card>;
}

export function AssistCard({ id, heading, suggestions = [], caption, children }) {
  return <section id={id} className="pd-card pd-assist">
    <div className="pd-orb" aria-hidden="true" />
    <h2>{heading}</h2>
    {suggestions.length > 0 && <div className="pd-suggestions">
      {suggestions.map(({ key, label, icon: Icon, onClick }) => <button key={key} type="button" className="pd-chip pd-chip-button" onClick={onClick}>{Icon && <Icon size={13} />}{label}</button>)}
    </div>}
    {caption && <div className="pd-caption">{caption}</div>}
    {children}
  </section>;
}

export const firstName = me => (me.user.name || '').trim().split(/\s+/).pop() || 'bạn';
