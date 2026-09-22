import React, { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, ChevronRight, Eye, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
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
  readOnly = false,
  canMove = task => !task.teamArchived,
  scopeKey = "default",
  showSummary = true,
}) {
  const sourceColumns = (managedColumns || statuses || DEFAULT_STATUSES).map(normalizeColumn);
  const sourceIds = sourceColumns.map(column => column.id);
  const sourceOrderKey = sourceColumns.map((column, index) => `${column.id}:${column.position ?? index}`).join("|");
  const [view, setView] = useState(() => initialView(scopeKey, sourceColumns));
  const [pending, setPending] = useState(null);
  const [dragged, setDragged] = useState(null);
  const [over, setOver] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const moving = useRef(false);
  const boardRef = useRef(null);
  const scopeRef = useRef(scopeKey);
  const helpId = useId();
  scopeRef.current = scopeKey;

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
    setDragged(null);
    setOver(null);
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

  const taskColumnId = task => {
    const value = getTaskColumn?.(task) ?? (managedColumns ? task?.columnId ?? task?.status : task?.status);
    return value == null ? "todo" : String(value);
  };

  const movable = task => !readOnly && (onTaskMove || onMove) && canMove(task);

  function reorder(id, direction) {
    const order = columns.map(column => column.id);
    const index = order.indexOf(id);
    const next = index + direction;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    setView(current => ({ ...current, scope: scopeKey, order }));
    if (onColumnReorder && (canReorderColumns ?? true)) {
      Promise.resolve(onColumnReorder(order)).catch(err => setError(err?.message || "Chưa lưu được thứ tự cột."));
    }
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
        setMessage(`Đã chuyển “${task.title}” sang ${target?.label || columnId}.`);
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

  function drop(event, columnId, beforeTaskId = null) {
    event.preventDefault();
    event.stopPropagation();
    setOver(null);
    const task = tasks.find(item => String(item.id) === String(dragged));
    setDragged(null);
    if (task) move(task, columnId, beforeTaskId);
  }

  return (
    <div className="task-board-shell">
      <div className="task-board-caption">
        {showSummary && <span>{tasks.length} công việc · {columns.length} cột</span>}
        <span id={helpId}>{readOnly ? "Chế độ chỉ xem" : "Kéo thẻ hoặc dùng menu ⋮ để chuyển cột"}</span>
      </div>
      {error && <div className="task-board-error" role="alert">{error}</div>}
      <p className="task-board-announcement" role="status" aria-live="polite">{message}</p>
      <div className="task-board" ref={boardRef} tabIndex={0} role="region" aria-label="Bảng công việc theo cột" aria-describedby={helpId}>
        {columns.map((column, index) => {
          const cards = tasks.filter(task => taskColumnId(task) === column.id);
          const collapsed = collapsedIds.includes(column.id);
          const draggingTask = tasks.find(item => String(item.id) === String(dragged));
          const acceptDrop = draggingTask && movable(draggingTask) && !pending;
          const actions = [
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
              className={`task-board-column tone-${column.tone || "blue"}${collapsed ? " is-collapsed" : ""}${over?.columnId === column.id ? " is-drop-target" : ""}`}
              aria-label={`${column.label}: ${cards.length} công việc`}
              onDragOver={event => {
                if (acceptDrop) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setOver({ columnId: column.id, taskId: null });
                }
              }}
              onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(null); }}
              onDrop={event => drop(event, column.id, over?.columnId === column.id ? over.taskId : null)}
            >
              {collapsed ? (
                <button className="task-board-expand" type="button" aria-label={`Mở rộng cột ${column.label}`} onClick={() => collapse(column.id, false)}>
                  <ChevronRight size={17} /><i className="task-board-dot" /><strong>{column.label}</strong><span>{cards.length}</span>
                </button>
              ) : <>
                <header className="task-board-column-header">
                  <h3><i className="task-board-dot" />{column.label}</h3>
                  <span className="task-board-count">{cards.length}</span>
                  <ActionMenu label={`Thao tác cột ${column.label}`} items={actions} />
                </header>
                <div className="task-board-cards" tabIndex={0} role="region" aria-label={`Thẻ trong cột ${column.label}`}>
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
                    if (onTrash && movable(task)) taskActions.push({ label: "Chuyển vào thùng rác", icon: Trash2, danger: true, onSelect: () => onTrash(task) });
                    const done = column.status === "done" || task.status === "done";
                    return (
                      <article
                        key={task.id}
                        data-task-id={task.id}
                        className={`task-board-card${done ? " is-done" : ""}${dragged === task.id ? " is-dragging" : ""}${pending === task.id ? " is-pending" : ""}${over?.taskId === String(task.id) ? " is-card-drop-target" : ""}`}
                        draggable={movable(task) && !pending}
                        aria-busy={pending === task.id}
                        onDragStart={event => {
                          if (event.target.closest(".action-menu") || !movable(task) || moving.current) { event.preventDefault(); return; }
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", task.id);
                          setDragged(task.id);
                          setError("");
                        }}
                        onDragOver={event => {
                          if (!acceptDrop) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setOver({ columnId: column.id, taskId: String(task.id) });
                        }}
                        onDrop={event => drop(event, column.id, task.id)}
                        onDragEnd={() => { setDragged(null); setOver(null); }}
                      >
                        <div className="task-board-card-top">
                          <span className={`task-board-priority priority-${task.priority}`}>{priorities[task.priority] || "Trung bình"}</span>
                          <ActionMenu label={`Thao tác công việc ${task.title}`} disabled={!!pending} items={taskActions} />
                        </div>
                        <button className="task-board-open" type="button" onClick={() => onOpen?.(task)} disabled={!!pending} aria-label={`Mở công việc ${task.title}`}>
                          <strong>{task.title}</strong>
                          {task.description && <span className="task-board-description">{task.description}</span>}
                        </button>
                        <span className="task-board-category">{task.teamName || "Việc chung"}{task.category ? ` · ${task.category}` : ""}</span>
                        <footer className="task-board-card-footer">
                          <span className={late ? "is-overdue" : ""}><CalendarDays size={13} />{task.dueAt ? new Date(task.dueAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "Chưa đặt hạn"}</span>
                          {name ? <span className="task-board-person" title={name}><span className="task-board-avatar" aria-hidden="true">{name.split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join("").toUpperCase()}</span><span>{name}</span></span> : <span>Chưa giao</span>}
                        </footer>
                      </article>
                    );
                  })}
                  {!cards.length && <div className="task-board-empty">{readOnly ? "Chưa có công việc" : "Thả công việc vào đây"}</div>}
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
