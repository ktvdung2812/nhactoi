import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, CalendarDays, Check, ChevronDown, ChevronRight, ChevronUp, Eye, GripVertical, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import { taskDropTarget, reorderIsNoop, columnDropTarget, moveColumnId } from "./board-order.js";
import "./task-board.css";

export const DEFAULT_STATUSES = [
  { id: "todo", label: "Cần làm", tone: "blue" },
  { id: "doing", label: "Đang làm", tone: "orange" },
  { id: "done", label: "Hoàn thành", tone: "green" },
];

const STATUS_LABELS = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const STATUS_TONES = { todo: "blue", doing: "orange", done: "green" };
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };
const CARD_LIMIT = 5;
const DAY_MS = 86400000;

function initialView(scope, columns) {
  return { scope, order: columns.map(column => column.id), collapsed: [] };
}

function normalizeColumn(column, index) {
  const id = column?.id == null ? String(column?.status || `column-${index + 1}`) : String(column.id);
  const status = column?.status || (STATUS_LABELS[id] ? id : "todo");
  return {
    ...column,
    id,
    status,
    label: column?.label || column?.name || STATUS_LABELS[status] || id,
    tone: column?.tone || STATUS_TONES[status] || "blue",
  };
}

export default function TaskBoard({
  tasks = [],
  selectedTaskId = null,
  members = [],
  statuses = DEFAULT_STATUSES,
  columns: managedColumns = null,
  visibleColumnIds = null,
  preferences = null,
  onPreferencesChange,
  onColumnReorder,
  canReorderColumns,
  columnActions,
  onOpen,
  onCreate,
  onMove,
  onTaskMove,
  getTaskColumn,
  onTrash,
  canTrash = () => true,
  readOnly = false,
  canMove = task => !task.teamArchived,
  scopeKey = "default",
  showSummary = true,
  captionRight = null,
}) {
  const sourceColumns = (managedColumns || statuses || DEFAULT_STATUSES).map(normalizeColumn);
  const sourceIds = sourceColumns.map(column => column.id);
  const sourceOrderKey = sourceColumns.map((column, index) => `${column.id}:${column.position ?? index}`).join("|");
  const [view, setView] = useState(() => initialView(scopeKey, sourceColumns));
  const [pending, setPending] = useState(null);
  const [dragged, setDragged] = useState(null);
  const [over, setOver] = useState(null);
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [overColumn, setOverColumn] = useState(null);
  const [panning, setPanning] = useState(false);
  const [expanded, setExpanded] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const moving = useRef(false);
  const suppressClickRef = useRef(false);
  const boardPointerRef = useRef(null);
  const boardRef = useRef(null);
  const scopeRef = useRef(scopeKey);
  const helpId = useId();
  scopeRef.current = scopeKey;
  const selectedTaskVisible = tasks.some(task => task.id === selectedTaskId);
  useEffect(() => {
    if (selectedTaskId) boardRef.current?.querySelector(".is-ai-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedTaskId, selectedTaskVisible]);

  useEffect(() => {
    setView(current => {
      if (current.scope !== scopeKey) return initialView(scopeKey, sourceColumns);
      const order = [...sourceIds.filter(id => current.order.includes(id)), ...sourceIds.filter(id => !current.order.includes(id))];
      return { ...current, order };
    });
  }, [scopeKey, sourceOrderKey]);

  useEffect(() => {
    setMessage("");
    setError("");
    endBoardPointer();
    setExpanded([]);
  }, [scopeKey]);

  const currentView = view.scope === scopeKey ? view : initialView(scopeKey, sourceColumns);
  const columnById = new Map(sourceColumns.map(column => [column.id, column]));
  const columns = [
    ...currentView.order.filter(id => columnById.has(id)),
    ...sourceIds.filter(id => !currentView.order.includes(id)),
  ].map(id => columnById.get(id));
  const collapsedIds = preferences && Array.isArray(preferences.collapsedIds)
    ? preferences.collapsedIds.map(String)
    : currentView.collapsed;
  const canArrangeColumns = !readOnly && visibleColumnIds == null && (onColumnReorder ? (canReorderColumns ?? true) : true) && columns.length > 1;

  const taskColumnId = task => {
    const value = getTaskColumn?.(task) ?? (managedColumns ? task?.columnId ?? task?.status : task?.status);
    return value == null ? "todo" : String(value);
  };

  const movable = task => !readOnly && (onTaskMove || onMove) && canMove(task);

  function applyOrder(order) {
    setView(current => ({ ...current, scope: scopeKey, order }));
    if (onColumnReorder && (canReorderColumns ?? true)) {
      Promise.resolve(onColumnReorder(order)).catch(err => setError(err?.message || "Chưa lưu được thứ tự cột."));
    }
  }

  function reorder(id, direction) {
    const order = columns.map(column => column.id);
    const index = order.indexOf(id);
    const next = index + direction;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    applyOrder(order);
  }

  function moveColumn(activeId, targetId, before) {
    const order = columns.map(column => column.id);
    const next = moveColumnId(order, activeId, targetId, before);
    if (!next || next.every((id, index) => id === order[index])) return;
    applyOrder(next);
  }

  function collapse(id, collapsed) {
    const next = collapsed
      ? [...new Set([...collapsedIds, id])]
      : collapsedIds.filter(value => value !== id);
    setView(current => ({ ...current, scope: scopeKey, collapsed: next }));
    if (onPreferencesChange) {
      Promise.resolve(onPreferencesChange(next)).catch(err => setError(err?.message || "Chưa lưu được tuỳ chọn bảng."));
    }
    requestAnimationFrame(() => {
      const column = [...(boardRef.current?.querySelectorAll("[data-column]") || [])].find(node => node.dataset.column === id);
      column?.querySelector("button")?.focus({ preventScroll: true });
    });
  }

  async function move(task, columnId, beforeTaskId = null) {
    if (moving.current || !movable(task)) return;
    const fromColumnId = taskColumnId(task);
    if (!onTaskMove && fromColumnId === columnId) return;
    if (onTaskMove && String(beforeTaskId || "") === String(task.id)) return;
    const scope = scopeKey;
    moving.current = true;
    setPending(task.id);
    setError("");
    setMessage("");
    setDragged(null);
    setOver(null);
    try {
      if (onTaskMove) await onTaskMove(task, columnId, beforeTaskId ?? null);
      else await onMove(task, columnId);
      if (scopeRef.current === scope) {
        setExpanded(current => current.includes(columnId) ? current : [...current, columnId]);
        const target = columns.find(column => column.id === columnId);
        setMessage(fromColumnId === columnId
          ? `Đã sắp xếp “${task.title}” trong cột ${target?.label || columnId}.`
          : `Đã chuyển “${task.title}” sang ${target?.label || columnId}.`);
        requestAnimationFrame(() => {
          const node = [...(boardRef.current?.querySelectorAll("[data-task-id]") || [])].find(item => item.dataset.taskId === String(task.id));
          const focusTarget = node?.querySelector(".task-board-open") || boardRef.current;
          focusTarget?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
          focusTarget?.focus({ preventScroll: true });
        });
      }
    } catch (err) {
      if (scopeRef.current === scope) setError(err?.message || "Chưa chuyển được công việc. Vui lòng thử lại.");
    } finally {
      moving.current = false;
      setPending(null);
    }
  }

  function cardRects(list) {
    return [...(list?.querySelectorAll("[data-task-id]") || [])].map(node => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.taskId, top: rect.top, height: rect.height };
    });
  }

  function startTaskDrag(event, task) {
    if (boardPointerRef.current || pending || moving.current || !movable(task) || event.button !== 0 || !event.isPrimary || event.pointerType === "touch") return;
    if (event.target.closest(".action-menu, button, a, input, select, textarea")) return;
    // Capture on the original target so a click without dragging still opens the task.
    const captureTarget = event.target;
    boardPointerRef.current = { kind: "task", id: task.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, captureTarget };
    captureTarget.setPointerCapture(event.pointerId);
  }

  function startColumnDrag(event, column) {
    if (!canArrangeColumns || pending || moving.current || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    boardPointerRef.current = { kind: "column", id: column.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    boardRef.current.setPointerCapture(event.pointerId);
    boardRef.current.focus({ preventScroll: true });
  }

  function startBoardPan(event) {
    suppressClickRef.current = false;
    if (boardPointerRef.current || event.pointerType !== "mouse" || event.button !== 0 || !event.isPrimary) return;
    if (!event.target.matches(".task-board, .task-board-column, .task-board-column-header, .task-board-cards, .task-board-empty")) return;
    const board = boardRef.current;
    if (board.scrollWidth <= board.clientWidth) return;
    event.preventDefault();
    boardPointerRef.current = { kind: "pan", pointerId: event.pointerId, x: event.clientX, scrollLeft: board.scrollLeft, active: false };
    board.setPointerCapture(event.pointerId);
    board.focus({ preventScroll: true });
  }

  function endBoardPointer() {
    const drag = boardPointerRef.current;
    boardPointerRef.current = null;
    setPanning(false);
    setDragged(null);
    setOver(null);
    setDraggedColumn(null);
    setOverColumn(null);
    const captureTarget = drag?.captureTarget || boardRef.current;
    if (drag && captureTarget?.hasPointerCapture(drag.pointerId)) captureTarget.releasePointerCapture(drag.pointerId);
  }

  function taskTargetAt(event, activeId) {
    const board = boardRef.current;
    const rect = board.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    const targets = [...board.querySelectorAll(":scope > [data-column]")].map(node => {
      const bounds = node.getBoundingClientRect();
      const list = node.querySelector(":scope > .task-board-cards");
      return { id: node.dataset.column, left: bounds.left, width: bounds.width, cards: cardRects(list), firstHiddenId: list?.dataset.firstHiddenId };
    });
    return taskDropTarget(targets, activeId, event.clientX, event.clientY);
  }

  function columnTargetAt(event, activeId) {
    const board = boardRef.current;
    const rect = board.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    const rects = [...board.querySelectorAll(":scope > [data-column]")].map(node => {
      const bounds = node.getBoundingClientRect();
      return { id: node.dataset.column, left: bounds.left, width: bounds.width };
    });
    return columnDropTarget(rects, activeId, event.clientX);
  }

  function moveBoardPointer(event) {
    const drag = boardPointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "pan") {
      if (!drag.active && Math.abs(event.clientX - drag.x) < 6) return;
      drag.active = true;
      setPanning(true);
      event.preventDefault();
      boardRef.current.scrollLeft = drag.scrollLeft + drag.x - event.clientX;
      return;
    }
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
      drag.active = true;
      suppressClickRef.current = true;
      if (drag.kind === "task") {
        setDragged(drag.id);
        boardRef.current.focus({ preventScroll: true });
      } else setDraggedColumn(drag.id);
      setError("");
    }
    event.preventDefault();
    const board = boardRef.current;
    const rect = board.getBoundingClientRect();
    if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
      board.scrollLeft += event.clientX < rect.left + 32 ? -16 : event.clientX > rect.right - 32 ? 16 : 0;
    }
    if (drag.kind === "task") {
      const target = taskTargetAt(event, drag.id);
      setOver(current => current?.columnId === target?.columnId && current?.beforeTaskId === target?.beforeTaskId ? current : target);
    } else {
      const target = columnTargetAt(event, drag.id);
      setOverColumn(current => current?.id === target?.id && current?.before === target?.before ? current : target);
    }
  }

  function finishBoardPointer(event) {
    const drag = boardPointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = drag.active ? (drag.kind === "task" ? taskTargetAt(event, drag.id) : drag.kind === "column" ? columnTargetAt(event, drag.id) : null) : null;
    endBoardPointer();
    if (!target || pending || moving.current) return;
    if (drag.kind === "task") {
      const task = tasks.find(task => String(task.id) === String(drag.id));
      const cards = tasks.filter(task => taskColumnId(task) === target.columnId);
      if (task && !reorderIsNoop(cards, task.id, target.beforeTaskId)) move(task, target.columnId, target.beforeTaskId);
    } else if (canArrangeColumns) moveColumn(drag.id, target.id, target.before);
  }

  const hasHelpText = Boolean(captionRight || readOnly);
  const hasCaption = Boolean(showSummary || hasHelpText);

  return (
    <div className="task-board-shell">
      {hasCaption && (
        <div className="task-board-caption">
          {showSummary && <span>{tasks.length} mục · {columns.length} cột</span>}
          {captionRight ? (
            <div id={helpId} className="task-board-caption-right">{captionRight}</div>
          ) : readOnly ? (
            <span id={helpId}>Chế độ chỉ xem</span>
          ) : null}
        </div>
      )}
      {error && <div className="task-board-error" role="alert">{error}</div>}
      <p className="task-board-announcement" role="status" aria-live="polite">{message}</p>
      <div
        className={`task-board${panning ? " is-panning" : ""}${dragged != null ? " is-task-dragging" : ""}`}
        ref={boardRef}
        tabIndex={0}
        role="region"
        aria-label="Bảng công việc theo cột"
        aria-describedby={hasHelpText ? helpId : undefined}
        onPointerDown={startBoardPan}
        onPointerMove={moveBoardPointer}
        onPointerUp={finishBoardPointer}
        onPointerCancel={endBoardPointer}
        onLostPointerCapture={endBoardPointer}
        onKeyDown={event => { if (event.key === "Escape") endBoardPointer(); }}
        onClickCapture={event => {
          if (!suppressClickRef.current || event.detail === 0) return;
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {columns.map((column, index) => {
          if (visibleColumnIds != null && !visibleColumnIds.includes(column.id)) return null;
          const cards = tasks.filter(task => taskColumnId(task) === column.id);
          const collapsed = collapsedIds.includes(column.id) && !cards.some(task => task.id === selectedTaskId);
          const showAll = cards.length <= CARD_LIMIT || expanded.includes(column.id) || cards.slice(CARD_LIMIT).some(task => task.id === selectedTaskId);
          const shownCards = showAll ? cards : cards.slice(0, CARD_LIMIT);
          const firstHiddenId = showAll ? null : cards[CARD_LIMIT].id;
          const actions = [
            !readOnly && onCreate && { label: "Thêm công việc", icon: Plus, disabled: !!pending, onSelect: () => onCreate(column.status || column.id, column.id) },
            { label: "Thu gọn cột", icon: PanelLeftClose, onSelect: () => collapse(column.id, true) },
            ...((onColumnReorder ? canReorderColumns : true) ? [
              { label: "Di chuyển cột sang trái", icon: ArrowLeft, disabled: index === 0, onSelect: () => reorder(column.id, -1) },
              { label: "Di chuyển cột sang phải", icon: ArrowRight, disabled: index === columns.length - 1, onSelect: () => reorder(column.id, 1) },
            ] : []),
            ...(columnActions?.(column, { index, columns, cards }) || []),
          ];
          return (
            <section
              key={column.id}
              data-column={column.id}
              className={`task-board-column tone-${column.tone || "blue"}${collapsed ? " is-collapsed" : ""}${over?.columnId === column.id ? " is-drop-target" : ""}${String(draggedColumn) === String(column.id) ? " is-column-dragging" : ""}${overColumn?.id === column.id ? (overColumn.before ? " is-column-drop-before" : " is-column-drop-after") : ""}`}
              aria-label={`${column.label}: ${cards.length} mục`}
            >
              {collapsed ? (
                <button className="task-board-expand" type="button" aria-label={`Mở rộng cột ${column.label}`} onClick={() => collapse(column.id, false)}>
                  <ChevronRight size={17} /><i className="task-board-dot" /><strong>{column.label}</strong><span>{cards.length}</span>
                </button>
              ) : <>
                <header className="task-board-column-header">
                  <div
                    className="task-board-column-handle"
                    data-draggable={canArrangeColumns && !pending}
                    onPointerDown={event => startColumnDrag(event, column)}
                  >
                    {canArrangeColumns && <span className="task-board-column-grip" aria-hidden="true"><GripVertical size={15} /></span>}
                    <h3><i className="task-board-dot" /><span>{column.label}</span><span className="task-board-count">{cards.length}</span></h3>
                  </div>
                  <ActionMenu label={`Thao tác cột ${column.label}`} items={actions} />
                </header>
                {!readOnly && onCreate && <button className="task-board-add" type="button" onClick={() => onCreate(column.status || column.id, column.id)} disabled={!!pending} aria-label={`Thêm công việc vào ${column.label}`} title="Thêm công việc"><Plus size={18} /></button>}
                <div className={`task-board-cards${over?.columnId === column.id && (over.beforeTaskId == null || String(over.beforeTaskId) === String(firstHiddenId)) ? " is-drop-end" : ""}`} data-first-hidden-id={firstHiddenId ?? undefined} tabIndex={0} role="region" aria-label={`Thẻ trong cột ${column.label}`}>
                  {shownCards.map((task, taskIndex) => {
                    const assignee = members.find(member => String(member.id) === String(task.assigneeId));
                    const name = assignee?.name || assignee?.email;
                    const late = (column.status || task.status) !== "done" && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
                    const lateDays = late ? Math.max(1, Math.floor((Date.now() - new Date(task.dueAt).getTime()) / DAY_MS)) : 0;
                    const taskActions = [{ label: "Xem chi tiết", icon: Eye, onSelect: () => onOpen?.(task) }];
                    if (onTaskMove && movable(task)) {
                      const previous = cards[taskIndex - 1];
                      const next = cards[taskIndex + 1];
                      if (previous) taskActions.push({ label: "Di chuyển lên", icon: ArrowUp, onSelect: () => move(task, column.id, previous.id) });
                      if (next) taskActions.push({ label: "Di chuyển xuống", icon: ArrowDown, onSelect: () => move(task, column.id, cards[taskIndex + 2]?.id || null) });
                      columns.filter(target => target.id !== column.id).forEach(target => taskActions.push({ label: `Chuyển sang ${target.label}`, icon: target.status === "done" ? Check : ArrowRight, onSelect: () => move(task, target.id, null) }));
                    } else {
                      statuses.filter(status => status.id !== task.status && movable(task)).forEach(status => taskActions.push({ label: `Chuyển sang ${status.label || STATUS_LABELS[status.id] || status.id}`, icon: status.id === "done" ? Check : ArrowRight, onSelect: () => move(task, status.id) }));
                    }
                    if (onTrash && canTrash(task) && movable(task)) taskActions.push({ label: "Chuyển vào thùng rác", icon: Trash2, danger: true, onSelect: () => onTrash(task) });
                    const done = column.status === "done" || task.status === "done";
                    const kindLabel = task.kind === "event" ? "Lịch hẹn" : task.kind === "renewal" ? "Gia hạn" : "Công việc";
                    const kindClass = task.kind === "event" ? "event" : task.kind === "renewal" ? "renewal" : "task";
                    return (
                      <article
                        key={task.id}
                        data-task-id={task.id}
                        className={`task-board-card${task.id === selectedTaskId ? " is-ai-selected" : ""}${done ? " is-done" : ""}${String(dragged) === String(task.id) ? " is-dragging" : ""}${pending === task.id ? " is-pending" : ""}${over?.columnId === column.id && String(over.beforeTaskId ?? "") === String(task.id) ? " is-drop-before" : ""}`}
                        draggable={false}
                        data-draggable={Boolean(movable(task) && !pending)}
                        aria-busy={pending === task.id}
                        onPointerDown={event => startTaskDrag(event, task)}
                        onDragStart={event => event.preventDefault()}
                      >
                        <div className="task-board-card-top">
                          <span className={`task-board-kind kind-${kindClass}`}>{kindLabel}</span>
                          <span className={`task-board-priority priority-${task.priority}`}>{priorities[task.priority] || "Trung bình"}</span>
                          <ActionMenu label={`Thao tác công việc ${task.title}`} disabled={!!pending} items={taskActions} />
                        </div>
                        <div className="task-board-open" role="button" tabIndex={pending ? -1 : 0} aria-disabled={pending || undefined} onClick={() => { if (!pending) onOpen?.(task); }} onKeyDown={event => { if (pending || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); onOpen?.(task); }} aria-label={`Mở công việc ${task.title}`}>
                          <strong>{task.title}</strong>
                          {task.description && <span className="task-board-description">{task.description}</span>}
                        </div>
                        <div className="task-board-meta">
                          <span className={late ? "is-overdue" : ""} title={task.dueAt ? new Date(task.dueAt).toLocaleString("vi-VN") : undefined}><CalendarDays size={14} />{late ? `Trễ ${lateDays} ngày` : task.dueAt ? new Date(task.dueAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "Chưa đặt hạn"}{task.kind === "event" && task.endsAt && <small> {new Date(task.dueAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}–{new Date(task.endsAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</small>}</span>
                          <b>{task.teamName || "Việc chung"}{task.category ? ` · ${task.category}` : ""}</b>
                        </div>
                        <footer className="task-board-card-footer">
                          {name ? <span className="task-board-person" title={name}><span className="task-board-avatar" aria-hidden="true">{name.split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join("").toUpperCase()}</span><span>{name}</span></span> : <span>{task.kind === "renewal" ? "Theo dõi dịch vụ" : "Chưa giao"}</span>}
                          {task.remindAt && <span className="task-board-reminder" title={`Nhắc ${new Date(task.remindAt).toLocaleString("vi-VN")}`}><Bell size={13} />{new Date(task.remindAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>}
                        </footer>
                      </article>
                    );
                  })}
                  {!cards.length && <div className="task-board-empty">{readOnly ? "Chưa có mục" : "Thả mục vào đây"}</div>}
                </div>
                {cards.length > CARD_LIMIT && (
                  <button className="task-board-more" type="button" aria-expanded={showAll} onClick={() => setExpanded(current => showAll ? current.filter(id => id !== column.id) : [...current, column.id])}>
                    {showAll ? <>Thu gọn <ChevronUp size={15} /></> : <>Hiện thêm {cards.length - CARD_LIMIT} <ChevronDown size={15} /></>}
                  </button>
                )}
              </>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
