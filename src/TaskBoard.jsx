import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, ChevronRight, Eye, GripVertical, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import { reorderBeforeId, reorderIsNoop, moveColumnId, moveColumnToEndId } from "./board-order.js";
import "./task-board.css";

export const DEFAULT_STATUSES = [
  { id: "todo", label: "Cần làm", tone: "blue" },
  { id: "doing", label: "Đang làm", tone: "orange" },
  { id: "done", label: "Hoàn thành", tone: "green" },
];

const STATUS_LABELS = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const STATUS_TONES = { todo: "blue", doing: "orange", done: "green" };
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };

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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const moving = useRef(false);
  const draggedRef = useRef(null);
  const draggedColumnRef = useRef(null);
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
    draggedRef.current = null;
    setDragged(null);
    setOver(null);
    draggedColumnRef.current = null;
    setDraggedColumn(null);
    setOverColumn(null);
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
  const canArrangeColumns = !readOnly && (onColumnReorder ? (canReorderColumns ?? true) : true) && columns.length > 1;

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

  function moveColumnToEnd(activeId) {
    const order = columns.map(column => column.id);
    const next = moveColumnToEndId(order, activeId);
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

  function placeOver(event, columnId) {
    const activeId = draggedRef.current;
    if (!activeId) return;
    const list = event.currentTarget.querySelector(":scope > .task-board-cards");
    const beforeTaskId = reorderBeforeId(cardRects(list), activeId, event.clientY);
    setOver(current => current?.columnId === columnId && String(current.beforeTaskId ?? "") === String(beforeTaskId ?? "")
      ? current
      : { columnId, beforeTaskId });
  }

  function drop(event, columnId, cards) {
    event.preventDefault();
    event.stopPropagation();
    const activeId = draggedRef.current;
    const list = event.currentTarget.querySelector(":scope > .task-board-cards");
    const beforeTaskId = reorderBeforeId(cardRects(list), activeId, event.clientY);
    const task = tasks.find(item => String(item.id) === String(activeId));
    draggedRef.current = null;
    setDragged(null);
    setOver(null);
    if (task && !reorderIsNoop(cards, task.id, beforeTaskId)) move(task, columnId, beforeTaskId);
  }

  function startColumnDrag(event, column) {
    if (pending || moving.current || event.target.closest(".action-menu")) {
      event.preventDefault();
      return;
    }
    const source = event.target.closest(".task-board-column");
    if (source) source.draggable = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `column:${column.id}`);
    draggedColumnRef.current = column.id;
    setDraggedColumn(column.id);
    setError("");
  }

  function endColumnDrag() {
    [...(boardRef.current?.querySelectorAll('[data-column][draggable="true"]') || [])].forEach(node => { node.draggable = false; });
    draggedColumnRef.current = null;
    setDraggedColumn(null);
    setOverColumn(null);
  }

  function placeOverColumn(event, columnId) {
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    setOverColumn(current => current?.id === columnId && current.before === before ? current : { id: columnId, before });
  }

  function dropColumn(event, columnId) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    const activeId = draggedColumnRef.current;
    endColumnDrag();
    if (activeId != null) moveColumn(activeId, columnId, before);
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
        className="task-board"
        ref={boardRef}
        tabIndex={0}
        role="region"
        aria-label="Bảng công việc theo cột"
        aria-describedby={hasHelpText ? helpId : undefined}
        onDragOver={event => {
          if (draggedColumnRef.current == null || !canArrangeColumns || pending) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={event => {
          if (draggedColumnRef.current == null || !canArrangeColumns || pending) return;
          event.preventDefault();
          const activeId = draggedColumnRef.current;
          endColumnDrag();
          moveColumnToEnd(activeId);
        }}
      >
        {columns.map((column, index) => {
          const cards = tasks.filter(task => taskColumnId(task) === column.id);
          const collapsed = collapsedIds.includes(column.id) && !cards.some(task => task.id === selectedTaskId);
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
              onDragOver={event => {
                if (draggedColumnRef.current != null) {
                  if (!canArrangeColumns || pending || String(draggedColumnRef.current) === String(column.id)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  placeOverColumn(event, column.id);
                  return;
                }
                const task = tasks.find(item => String(item.id) === String(draggedRef.current));
                if (!task || !movable(task) || pending) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                placeOver(event, column.id);
              }}
              onDragLeave={event => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                setOver(null);
                setOverColumn(null);
              }}
              onDrop={event => {
                if (draggedColumnRef.current != null) {
                  if (canArrangeColumns && !pending) dropColumn(event, column.id);
                  return;
                }
                const task = tasks.find(item => String(item.id) === String(draggedRef.current));
                if (task && movable(task) && !pending) drop(event, column.id, cards);
              }}
              draggable={canArrangeColumns && !pending}
              onDragEnd={endColumnDrag}
            >
              {collapsed ? (
                <button className="task-board-expand" type="button" aria-label={`Mở rộng cột ${column.label}`} onClick={() => collapse(column.id, false)}>
                  <ChevronRight size={17} /><i className="task-board-dot" /><strong>{column.label}</strong><span>{cards.length}</span>
                </button>
              ) : <>
                <header
                  className={`task-board-column-header${canArrangeColumns ? " is-draggable" : ""}`}
                  onDragStart={event => startColumnDrag(event, column)}
                >
                  {canArrangeColumns && <span className="task-board-column-grip" aria-hidden="true"><GripVertical size={15} /></span>}
                  <h3><i className="task-board-dot" /><span>{column.label}</span></h3>
                  <span className="task-board-count">{cards.length}</span>
                  <ActionMenu label={`Thao tác cột ${column.label}`} items={actions} />
                </header>
                <div className={`task-board-cards${over?.columnId === column.id && over.beforeTaskId == null ? " is-drop-end" : ""}`} tabIndex={0} role="region" aria-label={`Thẻ trong cột ${column.label}`}>
                  {cards.map((task, taskIndex) => {
                    const assignee = members.find(member => String(member.id) === String(task.assigneeId));
                    const name = assignee?.name || assignee?.email;
                    const late = (column.status || task.status) !== "done" && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
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
                        draggable={movable(task) && !pending}
                        aria-busy={pending === task.id}
                        onDragStart={event => {
                          if (event.target.closest(".action-menu") || !movable(task) || moving.current) { event.preventDefault(); return; }
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", String(task.id));
                          draggedRef.current = task.id;
                          setDragged(task.id);
                          setError("");
                        }}
                        onDragEnd={() => { draggedRef.current = null; setDragged(null); setOver(null); }}
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
                        <span className="task-board-category">{task.teamName || "Việc chung"}{task.category ? ` · ${task.category}` : ""}</span>
                        <footer className="task-board-card-footer">
                          <span className={late ? "is-overdue" : ""}><CalendarDays size={13} />{task.dueAt ? new Date(task.dueAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "Chưa đặt hạn"}{task.kind === "event" && task.endsAt && <small> {new Date(task.dueAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}–{new Date(task.endsAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</small>}</span>
                          {task.remindAt && <span className="task-board-reminder" title={`Nhắc ${new Date(task.remindAt).toLocaleString("vi-VN")}`}>Nhắc {new Date(task.remindAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>}
                          {name ? <span className="task-board-person" title={name}><span className="task-board-avatar" aria-hidden="true">{name.split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join("").toUpperCase()}</span><span>{name}</span></span> : <span>{task.kind === "renewal" ? "Theo dõi dịch vụ" : "Chưa giao"}</span>}
                        </footer>
                      </article>
                    );
                  })}
                  {!cards.length && <div className="task-board-empty">{readOnly ? "Chưa có mục" : "Thả mục vào đây"}</div>}
                </div>
                {!readOnly && onCreate && <button className="task-board-add" type="button" onClick={() => onCreate(column.status || column.id, column.id)} disabled={!!pending} aria-label={`Thêm công việc vào ${column.label}`}><Plus size={17} />Thêm công việc</button>}
              </>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
