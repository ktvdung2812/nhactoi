import React, { useMemo } from 'react';
import { AlarmClock, ArrowUpRight, Bell, BellRing, Calendar, CalendarClock, CalendarDays, Check, Clock, Flag, Hourglass, Inbox, ListTodo, Sparkles, Users } from 'lucide-react';
import { planningDay } from '../shared/personal-planning.mjs';
import { addPlanningDays } from '../shared/week-planning.mjs';
import {
  AssistCard, Badge, Card, DRAG_TYPE, Hero, NextCard, PRIORITY, Pill, RowIcon, StatsCard, TONES, Timeline, Unscheduled,
  clock, dueDay, firstName, longDay, scrollToId, shortDay, slotOf, taskState, useNow, vnMinutes,
} from './PlannerDashboard.jsx';

const LIST_ID = 'personal-all-tasks';
const SUGGESTIONS = {
  today: ['9h họp nhóm đầu ngày', '14h gọi lại khách hàng', '17h tổng kết công việc'],
  upcoming: ['mai 9h họp nhóm', 'ngày kia 14h gửi báo cáo', 'mai 17h gọi khách hàng'],
  inbox: ['Đọc tài liệu dự án', 'Lên ý tưởng chiến dịch', 'Gọi lại cho khách'],
};
const HEADINGS = {
  today: name => <>Chào {name},<br />hôm nay bạn cần làm gì?</>,
  upcoming: name => <>Chào {name},<br />bạn muốn chuẩn bị gì?</>,
  inbox: name => <>Chào {name},<br />bạn đang nghĩ đến việc gì?</>,
};
const LIST_TITLES = { today: 'Tất cả việc hôm nay', upcoming: 'Tất cả việc sắp tới', inbox: 'Tất cả việc trong Inbox' };

const teamOf = task => task.teamName || 'Việc chung';
const byTeam = (a, b) => (a === 'Việc chung' ? -1 : b === 'Việc chung' ? 1 : a.localeCompare(b, 'vi'));
const showList = () => scrollToId(LIST_ID);

function stepChips(task, slot, state, day, today) {
  return [
    { icon: slot ? Clock : CalendarClock, label: `${day && day !== today ? `${shortDay(day)} · ` : ''}${slot ? (slot.deadline ? `Hạn ${clock(slot.end)}` : clock(slot.start)) : 'Chưa xếp giờ'}` },
    task.priority && { icon: Flag, label: PRIORITY[task.priority] || task.priority },
    { label: state.label, tone: state.tone },
  ].filter(Boolean);
}

function entryOf(task, slot, day, now, onOpen) {
  return {
    key: task.id, title: task.title, start: slot.start, end: slot.end, deadline: slot.deadline,
    icon: slot.deadline ? AlarmClock : Clock,
    time: slot.deadline ? `Hạn ${clock(slot.end)}` : `${clock(slot.start)}–${clock(slot.end)}`,
    state: taskState(task, slot, day, now), onClick: () => onOpen(task),
  };
}

function useToday({ tasks, groups, now, onOpen, pageInfo }) {
  const today = planningDay(now);
  return useMemo(() => {
    const open = groups.flatMap(g => g.tasks);
    const review = groups.find(g => g.label === 'Cần xem lại')?.tasks || [];
    const done = pageInfo?.doneToday ?? tasks.filter(t => t.status === 'done' && (t.plannedDate === today || dueDay(t) === today)).length;
    const rows = new Map(), unscheduled = [];
    for (const task of open) {
      const slot = slotOf(task, today);
      if (!slot) { unscheduled.push(task); continue; }
      if (!rows.has(teamOf(task))) rows.set(teamOf(task), []);
      rows.get(teamOf(task)).push(entryOf(task, slot, today, now, onOpen));
    }
    const timeline = [...rows].sort(([a], [b]) => byTeam(a, b)).map(([name, entries], i) => ({
      key: name, name, sub: `${entries.length} việc có giờ`, icon: name === 'Việc chung' ? ListTodo : Users, tone: TONES[i % TONES.length], phase: 'today', entries,
    }));
    const next = [...open].map(task => ({ task, slot: slotOf(task, today) }))
      .sort((a, b) => (review.includes(b.task) - review.includes(a.task))
        || ((b.task.priority === 'high') - (a.task.priority === 'high'))
        || ((a.slot?.start ?? 1440) - (b.slot?.start ?? 1440)))
      .slice(0, 3)
      .map(({ task, slot }) => ({ key: task.id, title: task.title, desc: `${teamOf(task)}${task.description ? ` · ${task.description}` : ''}`, chips: stepChips(task, slot, taskState(task, slot, today, now), today, today), onClick: () => onOpen(task) }));
    return {
      title: 'Hôm nay',
      subtitle: `${open.length ? `Bạn có ${open.length} việc cần tập trung${review.length ? `, trong đó ${review.length} việc cần xem lại` : ''}.` : 'Chưa có việc nào cho hôm nay.'} Giờ Việt Nam (UTC+7).`,
      badge: <Badge icon={Check} done={(pageInfo?.total??open.length) === 0 && done > 0}>Hoàn thành · {done} / {(pageInfo?.total??open.length) + done}</Badge>,
      date: `${longDay(now)} · ${clock(vnMinutes(now))}`,
      caption: 'Nhóm việc', timeline,
      unscheduled: unscheduled.map(t => ({ key: t.id, title: t.title, onClick: () => onOpen(t) })),
      unscheduledLabel: `${unscheduled.length} việc chưa có giờ`,
      next, nextEmpty: 'Không còn việc nào. Thêm việc mới hoặc chọn “Làm hôm nay” từ Inbox.',
      stats: [
        { icon: ListTodo, tone: 'green', value: `${open.length} việc`, note: `${done} đã xong`, noteIcon: Check },
        { icon: AlarmClock, tone: 'coral', value: `${review.length} cần xem lại`, note: 'quá hạn', noteIcon: Calendar },
        { icon: BellRing, tone: 'violet', value: `${open.filter(t => t.remindAt).length} lời nhắc`, note: 'đang bật', noteIcon: Bell },
        { icon: Hourglass, tone: 'amber', value: `${unscheduled.length} chưa xếp giờ`, note: 'cần lên lịch', noteIcon: Clock },
      ],
    };
  }, [tasks, groups, now, today, onOpen, pageInfo]);
}

function useUpcoming({ groups, now, onOpen }) {
  const today = planningDay(now);
  return useMemo(() => {
    const open = groups.flatMap(g => g.tasks.map(task => ({ task, day: g.label })));
    const shown = groups.slice(0, 7);
    const unscheduled = [];
    const timeline = shown.map((group, i) => {
      const entries = [];
      for (const task of group.tasks) {
        const slot = slotOf(task, group.label);
        if (slot) entries.push(entryOf(task, slot, group.label, now, onOpen));
        else unscheduled.push({ key: task.id, title: `${shortDay(group.label)} · ${task.title}`, onClick: () => onOpen(task) });
      }
      const inDays = Math.round((Date.parse(group.label) - Date.parse(today)) / 86400000);
      return { key: group.label, name: shortDay(group.label), sub: `${inDays === 1 ? 'Ngày mai' : `${inDays} ngày nữa`} · ${group.tasks.length} việc`, icon: CalendarDays, tone: TONES[i % TONES.length], phase: 'future', entries };
    });
    const next = open.slice(0, 3).map(({ task, day }) => {
      const slot = slotOf(task, day);
      return { key: task.id, title: task.title, desc: `${teamOf(task)}${task.description ? ` · ${task.description}` : ''}`, chips: stepChips(task, slot, taskState(task, slot, day, now), day, today), onClick: () => onOpen(task) };
    });
    const hidden = groups.length - shown.length;
    return {
      title: 'Sắp tới',
      subtitle: `${open.length ? `${open.length} việc trong ${groups.length} ngày tới theo ngày dự định làm và hạn.` : 'Chưa có công việc sắp tới.'} Giờ Việt Nam (UTC+7).`,
      badge: <Badge icon={CalendarDays}>{groups.length} ngày có việc</Badge>,
      date: groups.length ? `${shortDay(groups[0].label)} – ${shortDay(groups[groups.length - 1].label)}` : longDay(now),
      caption: 'Ngày', timeline,
      emptyRow: 'Chưa có ngày nào có việc',
      unscheduled, unscheduledLabel: `${unscheduled.length} việc chưa có giờ`,
      footnote: hidden > 0 ? `Còn ${hidden} ngày khác trong danh sách bên dưới.` : '',
      next, nextEmpty: 'Chưa có việc sắp tới. Đặt hạn hoặc ngày dự định làm để lên kế hoạch.',
      stats: [
        { icon: ListTodo, tone: 'green', value: `${open.length} việc`, note: `${groups.length} ngày`, noteIcon: CalendarDays },
        { icon: AlarmClock, tone: 'coral', value: `${open.filter(({ task }) => dueDay(task) > today).length} có hạn`, note: 'deadline', noteIcon: Calendar },
        { icon: CalendarClock, tone: 'violet', value: `${open.filter(({ task }) => task.plannedDate > today).length} dự định làm`, note: 'đã lên lịch', noteIcon: Check },
        { icon: Hourglass, tone: 'amber', value: `${unscheduled.length} chưa xếp giờ`, note: 'trong 7 ngày đầu', noteIcon: Clock },
      ],
    };
  }, [groups, now, today, onOpen]);
}

function useInbox({ groups, now, onOpen }) {
  const today = planningDay(now);
  return useMemo(() => {
    const open = groups.flatMap(g => g.tasks);
    const age = task => task.createdAt ? Math.floor((now - Date.parse(task.createdAt)) / 86400000) : 0;
    const rows = new Map();
    for (const task of open) { if (!rows.has(teamOf(task))) rows.set(teamOf(task), []); rows.get(teamOf(task)).push(task); }
    const board = [...rows].sort(([a], [b]) => byTeam(a, b)).map(([name, items], i) => ({ key: name, name, sub: `${items.length} việc chưa lên lịch`, icon: name === 'Việc chung' ? Inbox : Users, tone: TONES[i % TONES.length], items }));
    const high = open.filter(t => t.priority === 'high');
    const next = [...open].sort((a, b) => ((b.priority === 'high') - (a.priority === 'high')) || age(b) - age(a)).slice(0, 3)
      .map(task => ({ key: task.id, title: task.title, desc: `${teamOf(task)}${task.description ? ` · ${task.description}` : ''}`, chips: [
        { icon: Clock, label: age(task) ? `${age(task)} ngày trước` : 'Hôm nay' },
        task.priority && { icon: Flag, label: PRIORITY[task.priority] || task.priority },
        { label: 'Chưa lên lịch', tone: 'next' },
      ].filter(Boolean), onClick: () => onOpen(task) }));
    return {
      title: 'Inbox',
      subtitle: open.length ? `${open.length} việc đang chờ lên lịch. Kéo việc vào một ngày để đặt ngày dự định làm.` : 'Inbox đang trống. Ghi lại việc cần nhớ, lên lịch khi bạn sẵn sàng.',
      badge: <Badge icon={Inbox} done={open.length === 0}>{open.length ? `${open.length} chưa lên lịch` : 'Inbox trống'}</Badge>,
      date: `${longDay(now)} · ${clock(vnMinutes(now))}`,
      board, age,
      days: Array.from({ length: 7 }, (_, i) => addPlanningDays(today, i)),
      next, flag: 'Lên lịch trước', nextTitle: 'Nên lên lịch', nextEmpty: 'Không còn việc chờ. Thêm việc mới ở thẻ bên cạnh.',
      stats: [
        { icon: Inbox, tone: 'green', value: `${open.length} việc`, note: 'chưa lên lịch', noteIcon: CalendarClock },
        { icon: Flag, tone: 'coral', value: `${high.length} ưu tiên cao`, note: 'nên làm sớm', noteIcon: AlarmClock },
        { icon: Hourglass, tone: 'amber', value: `${open.filter(t => age(t) >= 7).length} việc cũ`, note: 'từ 7 ngày trước', noteIcon: Clock },
        { icon: Users, tone: 'violet', value: `${open.filter(t => t.teamName).length} việc đội nhóm`, note: `${board.filter(r => r.key !== 'Việc chung').length} nhóm`, noteIcon: Users },
      ],
    };
  }, [groups, now, today, onOpen]);
}

// Inbox tasks have no time yet, so the hero shows day drop targets instead of hours.
function InboxBoard({ model, today, canPlan, onPlan, onOpen }) {
  const [dropDay, setDropDay] = React.useState(null);
  const tasks = model.board.flatMap(row => row.items);
  return <div className="pd-board">
    <div className="pd-board-days">
      <span className="pd-timeline-caption pd-board-spacer">Kéo vào ngày</span>
      {model.days.map((day, i) => <div key={day} className={`pd-board-day ${day === today ? 'is-now' : ''} ${dropDay === day ? 'is-drop' : ''}`}
        onDragOver={event => { if (canPlan && event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); setDropDay(day); } }}
        onDragLeave={() => setDropDay(d => d === day ? null : d)}
        onDrop={event => { event.preventDefault(); setDropDay(null); const task = tasks.find(t => t.id === event.dataTransfer.getData(DRAG_TYPE)); if (task) onPlan(task, day); }}>
        <small>{i === 0 ? 'Hôm nay' : i === 1 ? 'Ngày mai' : new Date(`${day}T12:00:00+07:00`).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' })}</small>
        {day.slice(8)}/{day.slice(5, 7)}
      </div>)}
    </div>
    {model.board.length === 0 && <div className="pd-board-row"><div className="pd-row-label is-empty"><RowIcon icon={Inbox} tone="green" /><span className="pd-row-text"><strong>Inbox trống</strong><small>Mọi việc đã được lên lịch</small></span></div></div>}
    {model.board.map(row => <div key={row.key} className="pd-board-row">
      <div className="pd-row-label"><RowIcon icon={row.icon} tone={row.tone} /><span className="pd-row-text"><strong>{row.name}</strong><small>{row.sub}</small></span></div>
      <div className="pd-board-lane">
        {row.items.map(task => <button key={task.id} type="button" className={`pd-block tone-${row.tone} ${task.priority === 'high' ? 'state-danger' : 'state-next'}`}
          title={task.title} onClick={() => onOpen(task)} draggable={canPlan}
          onDragStart={event => { event.dataTransfer.setData(DRAG_TYPE, task.id); event.dataTransfer.effectAllowed = 'move'; }}>
          <span className="pd-block-icon">{task.priority === 'high' ? <Flag size={16} /> : <ListTodo size={16} />}</span>
          <span className="pd-block-text"><strong>{task.title}</strong><small>{model.age(task) ? `Tạo ${model.age(task)} ngày trước` : 'Tạo hôm nay'}</small></span>
          <span className="pd-block-state">{task.priority === 'high' ? 'Ưu tiên cao' : 'Chưa lên lịch'}</span>
        </button>)}
      </div>
    </div>)}
    {model.board.length > 0 && <p className="pd-board-hint">Kéo một việc vào ngày để đặt ngày dự định làm. Hạn hoàn thành giữ nguyên. Hoặc dùng “Làm hôm nay” trong danh sách bên dưới.</p>}
  </div>;
}

export default function PersonalDashboard({ pageInfo, loading, view, me, tasks, groups, capture, list, readOnly, busy, onOpen, onPlan, onSuggest }) {
  const now = useNow();
  const today = planningDay(now);
  const models = { today: useToday({ tasks, groups, now, onOpen, pageInfo }), upcoming: useUpcoming({ groups, now, onOpen }), inbox: useInbox({ groups, now, onOpen }) };
  const model = models[view];

  return <div className="pd-dash">
    {Number.isFinite(pageInfo?.total) && pageInfo.total > tasks.length && <p role="status" className="pd-page-note">{loading ? "Đang cập nhật kế hoạch…" : `Trang ${pageInfo.page}: ${tasks.length}/${pageInfo.total} công việc. Lịch, gợi ý và thống kê bên dưới chỉ tính các việc trên trang này; số hoàn thành hôm nay tính toàn bộ phạm vi.`}</p>}
    <Hero title={model.title} subtitle={model.subtitle}
      tools={<>{model.badge}<Pill icon={Calendar}>{model.date}</Pill><Pill icon={ArrowUpRight} onClick={showList}>Danh sách</Pill></>}
      footer={<>
        {model.unscheduled && <Unscheduled icon={Hourglass} label={model.unscheduledLabel} items={model.unscheduled} />}
        {model.footnote && <p className="pd-unscheduled">{model.footnote}</p>}
      </>}>
      {view === 'inbox'
        ? <InboxBoard model={model} today={today} canPlan={!readOnly && !busy} onPlan={onPlan} onOpen={onOpen} />
        : <Timeline caption={model.caption} rows={model.timeline} now={now}
          empty={<><RowIcon icon={CalendarClock} tone="green" /><span className="pd-row-text"><strong>{model.emptyRow || 'Chưa xếp giờ'}</strong><small>Đặt giờ dự định để thấy lịch</small></span></>} />}
    </Hero>

    <div className="pd-bottom">
      <NextCard title={model.nextTitle} flag={model.flag} items={model.next} empty={model.nextEmpty} onViewAll={showList} />
      <StatsCard stats={model.stats} onViewAll={showList} />
      <AssistCard heading={HEADINGS[view](firstName(me))} caption="Thêm việc nhanh"
        suggestions={SUGGESTIONS[view].map(s => ({ key: s, label: s, icon: Sparkles, onClick: () => onSuggest(s) }))}>
        {capture}
      </AssistCard>
    </div>

    <Card id={LIST_ID} className="pd-list" title={LIST_TITLES[view]}>
      <p className="personal-scope">Việc giao cho bạn và việc bạn tạo chưa giao ai trong không gian này. Quyền chia sẻ của công việc giữ nguyên. Giờ Việt Nam (UTC+7).</p>
      {list}
    </Card>
  </div>;
}
