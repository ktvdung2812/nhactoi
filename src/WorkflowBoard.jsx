import { useTaskMutation } from './useTaskMutation.js';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, Check, LoaderCircle, Pencil, Plus, X } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import { classifyColumnDrop, resolveDisplayedColumn } from "./board-columns.js";
import TaskBoard, { DEFAULT_STATUSES } from "./TaskBoard.jsx";

const TONES = [
  { id: "blue", label: "Xanh biển" },
  { id: "orange", label: "Cam ấm" },
  { id: "green", label: "Xanh lá" },
  { id: "purple", label: "Tím mơ" },
  { id: "rose", label: "Hồng đào" },
  { id: "slate", label: "Xám đá" },
];

const STATUS_META = {
  todo: { label: "Cần làm", tone: "blue" },
  doing: { label: "Đang làm", tone: "orange" },
  done: { label: "Hoàn thành", tone: "green" },
};

const EMPTY_FORM = { name: "", status: "todo", tone: "blue", targetColumnId: "" };

function text(value) {
  return value == null ? "" : String(value);
}

function normalizeColumn(column, index) {
  const status = text(column?.status) || "todo";
  const fallback = STATUS_META[status] || STATUS_META.todo;
  const id = text(column?.id) || status || `column-${index + 1}`;
  return {
    ...column,
    id,
    name: text(column?.name) || text(column?.label) || fallback.label || id,
    label: text(column?.label) || text(column?.name) || fallback.label || id,
    status,
    tone: text(column?.tone) || fallback.tone,
    position: Number.isFinite(Number(column?.position)) ? Number(column.position) : index,
  };
}

function sortColumns(columns) {
  return [...columns].sort((left, right) => left.position - right.position);
}

function boardPath(teamId, projectId) {
  if(projectId) return `/boards?projectId=${encodeURIComponent(projectId)}`;
  return teamId == null || teamId === ""
    ? "/boards"
    : `/boards?teamId=${encodeURIComponent(teamId)}`;
}

function taskColumnId(task) {
  return text(task?.columnId) || text(task?.status) || "todo";
}

function taskCardsForColumn(tasks, column) {
  return tasks.filter(task => taskColumnId(task) === String(column.id) || (!task.columnId && text(task.status) === String(column.status)));
}

function ErrorMessage({ children }) {
  return children ? <div className="workflow-board-error" role="alert"><X size={15} />{children}</div> : null;
}

export default function WorkflowBoard({
  api,
  teamId = null,
  projectId = null,
  tasks = [],
  selectedTaskId = null,
  members = [],
  onOpen,
  onCreate,
  onTrash,
  onChanged,
  onStatusMove,
  placeByStatus = false,
  canTrash,
  canMove: canMoveItem,
  captionRight = null,
  showColumnTabs = false,
  toolbarRight = null,
  countNoun = "công việc",
  readOnly = false,
  revision = 0,
  scopeKey = "default",
}) {
  const [board, setBoard] = useState(null);
  const [columnFilter, setColumnFilter] = useState([]);
  const [taskSnapshot, setTaskSnapshot] = useState(tasks);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [mutation, setMutation] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [pendingForm, setPendingForm] = useState(false);
  const dialogRef = useRef(null);
  const pendingRef = useRef(false);
  pendingRef.current = pendingForm;

  useEffect(() => setTaskSnapshot(tasks), [tasks, scopeKey, revision]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api(boardPath(teamId,projectId))
      .then(result => {
        if (cancelled) return;
        setBoard({
          columns: Array.isArray(result?.columns) ? result.columns.map(normalizeColumn) : null,
          canManage: result?.canManage !== false,
          canWrite: result?.canWrite !== false,
          preferences: {
            collapsedIds: Array.isArray(result?.preferences?.collapsedIds) ? result.preferences.collapsedIds.map(String) : [],
          },
        });
      })
      .catch(loadError => {
        if (!cancelled) setError(loadError?.message || "Không thể tải bảng công việc.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [api, teamId, projectId, scopeKey, revision, reloadToken]);

  useEffect(() => {
    if (!dialog) return undefined;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector("[data-workflow-autofocus], input, select, button:not(:disabled)")?.focus());
    const onKeyDown = event => {
      if (event.key === "Escape" && !pendingRef.current) {
        event.preventDefault();
        setDialog(null);
        setFormError("");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dialog?.kind]);

  const allColumns = useMemo(() => {
    if (Array.isArray(board?.columns)) return sortColumns(board.columns.map(normalizeColumn));
    return DEFAULT_STATUSES.map(normalizeColumn);
  }, [board?.columns]);
  const activeColumns = useMemo(() => allColumns.filter(column => !column.archivedAt), [allColumns]);
  const archivedColumns = useMemo(() => allColumns.filter(column => Boolean(column.archivedAt)), [allColumns]);
  const activeIds = useMemo(() => new Set(activeColumns.map(column => String(column.id))), [activeColumns]);
  const selectedColumnIds = columnFilter.filter(id => activeIds.has(id));
  const visibleColumnIds = showColumnTabs && selectedColumnIds.length ? selectedColumnIds : null;
  useEffect(() => setColumnFilter([]), [scopeKey, selectedTaskId]);
  useEffect(() => setColumnFilter(current => current.filter(id => activeIds.has(id))), [activeIds]);

  function toggleColumnFilter(id) {
    setColumnFilter(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }
  const getBoardTaskColumn = task => resolveDisplayedColumn(task, activeColumns, { placeByStatus, teamId });
  const visibleTasks = useMemo(() => {
    const originalIndexes = new Map(taskSnapshot.map((task, index) => [String(task.id), index]));
    const columnIndexes = new Map(activeColumns.map((column, index) => [String(column.id), index]));
    return taskSnapshot
      .filter(task => activeIds.has(getBoardTaskColumn(task)))
      .sort((left, right) => {
        const leftColumn = getBoardTaskColumn(left);
        const rightColumn = getBoardTaskColumn(right);
        if (leftColumn !== rightColumn) return (columnIndexes.get(leftColumn) ?? 0) - (columnIndexes.get(rightColumn) ?? 0);
        const leftPosition = Number(left.boardPosition);
        const rightPosition = Number(right.boardPosition);
        if (Number.isFinite(leftPosition) && Number.isFinite(rightPosition) && leftPosition !== rightPosition) return leftPosition - rightPosition;
        return (originalIndexes.get(String(left.id)) ?? 0) - (originalIndexes.get(String(right.id)) ?? 0);
      });
  }, [taskSnapshot, activeIds, activeColumns, placeByStatus, teamId]);
  const canWrite = Boolean(!readOnly && board && board.canWrite !== false);
  // Adding, renaming, reordering and archiving columns is for board managers.
  const canManage = Boolean(canWrite && board.canManage !== false);

  async function notifyChanged() {
    if (!onChanged) return;
    try {
      await onChanged();
    } catch (changeError) {
      setError(changeError?.message || "Đã lưu nhưng chưa làm mới được bảng.");
    }
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setFormError("");
    setDialog({ kind: "create" });
  }

  function openEdit(column) {
    setForm({ name: column.name || column.label, status: column.status || "todo", tone: column.tone || "blue", targetColumnId: "" });
    setFormError("");
    setDialog({ kind: "edit", column });
  }

  function openArchive(column) {
    const targets = activeColumns.filter(item => item.id !== column.id);
    setForm({ ...EMPTY_FORM, targetColumnId: targets.length === 1 ? targets[0].id : "" });
    setFormError("");
    setDialog({ kind: "archive", column });
  }

  function closeDialog() {
    if (pendingForm) return;
    setDialog(null);
    setFormError("");
  }

  async function handleColumnAction(event) {
    event.preventDefault();
    if (!dialog || pendingForm) return;
    const name = form.name.trim();
    const cards = dialog.column ? taskCardsForColumn(taskSnapshot, dialog.column) : [];
    if ((dialog.kind === "create" || dialog.kind === "edit") && !name) {
      setFormError("Hãy nhập tên cột.");
      return;
    }
    if (dialog.kind === "archive" && cards.length && !form.targetColumnId) {
      setFormError("Hãy chọn cột nhận công việc trước khi lưu trữ.");
      return;
    }
    setPendingForm(true);
    setFormError("");
    try {
      if (dialog.kind === "create") {
        await api("/boards/columns", {
          method: "POST",
          body: JSON.stringify({ projectId: projectId || undefined, teamId: teamId ?? null, name, status: form.status, tone: form.tone }),
        });
      } else if (dialog.kind === "edit") {
        await api(`/boards/columns/${encodeURIComponent(dialog.column.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ name, status: form.status, tone: form.tone }),
        });
      } else {
        const payload = form.targetColumnId ? { targetColumnId: form.targetColumnId } : {};
        await api(`/boards/columns/${encodeURIComponent(dialog.column.id)}/archive`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setDialog(null);
      setReloadToken(value => value + 1);
      await notifyChanged();
    } catch (mutationError) {
      setFormError(mutationError?.message || "Không thể lưu thay đổi cột.");
    } finally {
      setPendingForm(false);
    }
  }

  async function restoreColumn(column) {
    if (!canManage || mutation) return;
    setMutation(`restore:${column.id}`);
    setError("");
    try {
      await api(`/boards/columns/${encodeURIComponent(column.id)}/restore`, { method: "POST" });
      setReloadToken(value => value + 1);
      await notifyChanged();
    } catch (restoreError) {
      setError(restoreError?.message || "Không thể khôi phục cột.");
    } finally {
      setMutation(null);
    }
  }

  async function reorderColumns(ids) {
    if (!canManage) return;
    const activeIds = new Set(activeColumns.map(column => String(column.id)));
    let activeIndex = 0;
    const orderedIds = allColumns.map(column => activeIds.has(String(column.id)) ? ids[activeIndex++] : column.id);
    await api("/boards/columns/reorder", {
      method: "POST",
      body: JSON.stringify({ projectId: projectId || undefined, teamId: teamId ?? null, ids: orderedIds }),
    });
    await notifyChanged();
    setReloadToken(value => value + 1);
  }

  async function persistPreferences(collapsedIds) {
    await api("/boards/preferences", {
      method: "PATCH",
      body: JSON.stringify({ projectId: projectId || undefined, teamId: teamId ?? null, collapsedIds }),
    });
    setBoard(current => current ? { ...current, preferences: { ...(current.preferences || {}), collapsedIds } } : current);
  }

  function applyLocalTaskMove(task, columnId, beforeTaskId) {
    const target = activeColumns.find(column => String(column.id) === String(columnId));
    const sourceColumnId = getBoardTaskColumn(task);
    const moved = { ...task, columnId, status: target?.status || task.status };
    const remaining = taskSnapshot.filter(item => String(item.id) !== String(task.id));
    let insertAt = remaining.length;
    if (beforeTaskId != null) {
      const beforeIndex = remaining.findIndex(item => String(item.id) === String(beforeTaskId));
      if (beforeIndex >= 0) insertAt = beforeIndex;
    } else {
      const targetIndexes = remaining.map((item, index) => getBoardTaskColumn(item) === String(columnId) ? index : -1).filter(index => index >= 0);
      if (targetIndexes.length) insertAt = targetIndexes[targetIndexes.length - 1] + 1;
    }
    const next = [...remaining];
    next.splice(insertAt, 0, moved);
    const affected = new Set([sourceColumnId, String(columnId)]);
    const positions = new Map();
    setTaskSnapshot(next.map(item => {
      const itemColumnId = getBoardTaskColumn(item);
      if (!affected.has(itemColumnId)) return item;
      const position = positions.get(itemColumnId) || 0;
      positions.set(itemColumnId, position + 1);
      return { ...item, boardPosition: position };
    }));
  }

  const taskApi = useTaskMutation(api, `${scopeKey}:${teamId || ''}:${projectId || ''}`);
  async function moveTask(task, columnId, beforeTaskId = null) {
    if (!canWrite) throw new Error("Bạn không có quyền cập nhật công việc trong bảng này.");
    const decision = classifyColumnDrop(task, columnId, activeColumns, { placeByStatus, teamId });
    if (decision.mode === "error") throw new Error(decision.message);
    if (decision.mode === "skip") return;
    const key = `task:${task.id}`;
    setMutation(key);
    setError("");
    try {
      if (decision.mode === "status") {
        if (!onStatusMove) throw new Error("Cột tùy chỉnh chỉ nhận công việc thuộc bảng đang chọn.");
        await onStatusMove(task, decision.status);
        applyLocalTaskMove(task, columnId, null);
      } else {
        await taskApi(`/boards/tasks/${encodeURIComponent(task.id)}/move`, {
          method: "POST",
          body: JSON.stringify({ columnId, beforeTaskId: beforeTaskId ?? null, expectedRevision: task.revision }),
        });
        applyLocalTaskMove(task, columnId, beforeTaskId);
      }
      await notifyChanged();
    } catch (moveError) {
      throw moveError;
    } finally {
      setMutation(null);
    }
  }

  function columnActions(column, { cards }) {
    if (!canManage) return [];
    return [
      { label: "Đổi tên và màu", icon: Pencil, onSelect: () => openEdit(column) },
      { label: "Lưu trữ cột", icon: Archive, danger: true, onSelect: () => openArchive(column) },
    ];
  }

  if (loading && !board && !placeByStatus) return <div className="workflow-board-loading"><LoaderCircle className="workflow-board-spin" size={20} /> Đang tải bảng công việc…</div>;

  const dialogCards = dialog?.column ? taskCardsForColumn(taskSnapshot, dialog.column) : [];
  const archiveTargets = dialog?.column ? activeColumns.filter(column => column.id !== dialog.column.id) : [];

  return (
    <div className="workflow-board-shell">
      {showColumnTabs && (
        <div className="toolbar task-toolbar">
          <div className="filter-tabs" role="group" aria-label="Lọc theo cột">
            <button type="button" className={visibleColumnIds == null ? "active" : ""} aria-pressed={visibleColumnIds == null} onClick={() => setColumnFilter([])}>Tất cả</button>
            {activeColumns.map(column => (
              <button key={column.id} type="button" className={visibleColumnIds?.includes(column.id) ? "active" : ""} aria-pressed={visibleColumnIds?.includes(column.id) ?? false} onClick={() => toggleColumnFilter(column.id)}>{column.label}</button>
            ))}
          </div>
          {toolbarRight}
        </div>
      )}
      {(archivedColumns.length > 0 || canManage) && (
        <div className="workflow-board-toolbar">
          <div>
            {archivedColumns.length > 0 && <span className="workflow-board-archived-count">{archivedColumns.length} cột đã lưu trữ</span>}
          </div>
          {canManage && <button type="button" className="workflow-board-add-column" onClick={openCreate}><Plus size={16} /> Thêm cột</button>}
        </div>
      )}
      <ErrorMessage>{error}</ErrorMessage>
      {loading && <div className="workflow-board-refreshing"><LoaderCircle className="workflow-board-spin" size={15} /> Đang đồng bộ…</div>}
      <TaskBoard
        selectedTaskId={selectedTaskId}
        showSummary={false}
        scopeKey={scopeKey}
        columns={activeColumns}
        visibleColumnIds={visibleColumnIds}
        tasks={visibleTasks}
        members={members}
        preferences={canWrite ? board?.preferences : null}
        onPreferencesChange={canWrite ? persistPreferences : undefined}
        onColumnReorder={reorderColumns}
        canReorderColumns={canManage}
        columnActions={columnActions}
        onOpen={onOpen}
        onCreate={(status, columnId) => onCreate?.(status, columnId)}
        onTaskMove={moveTask}
        getTaskColumn={getBoardTaskColumn}
        captionRight={captionRight}
        onTrash={onTrash}
        canTrash={canTrash}
        readOnly={!canWrite}
        canMove={task => Boolean(canWrite && (canMoveItem ? canMoveItem(task) : !task.teamArchived))}
      />

      {visibleColumnIds == null && archivedColumns.length > 0 && (
        <section className="workflow-board-archived" aria-label="Cột đã lưu trữ">
          <div className="workflow-board-archived-heading"><div><span className="workflow-board-caption">LỊCH SỬ BẢNG</span><h3>Cột đã lưu trữ</h3></div><Archive size={17} /></div>
          <div className="workflow-board-archived-list">
            {archivedColumns.map(column => {
              const cards = taskCardsForColumn(taskSnapshot, column);
              return <article className="workflow-board-archived-row" key={column.id}>
                <span className={`task-board-dot tone-${column.tone}`} aria-hidden="true" />
                <div><strong>{column.label}</strong><span>{cards.length} công việc</span></div>
                {canManage && <ActionMenu label={`Thao tác cột ${column.label}`} items={[{ label: "Khôi phục cột", icon: ArchiveRestore, onSelect: () => restoreColumn(column) }]} disabled={mutation === `restore:${column.id}`} />}
              </article>;
            })}
          </div>
        </section>
      )}

      {dialog && <div className="workflow-board-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}>
        <section ref={dialogRef} className="workflow-board-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-board-dialog-title" tabIndex={-1}>
          <header className="workflow-board-modal-head">
            <div><span className="workflow-board-caption">QUẢN LÝ CỘT</span><h2 id="workflow-board-dialog-title">{dialog.kind === "create" ? "Thêm cột mới" : dialog.kind === "edit" ? "Chỉnh sửa cột" : "Lưu trữ cột"}</h2></div>
            <button type="button" className="workflow-board-modal-close" onClick={closeDialog} aria-label="Đóng"><X size={18} /></button>
          </header>
          <form onSubmit={handleColumnAction}>
            <div className="workflow-board-modal-body">
              {dialog.kind === "archive" ? <>
                <p className="workflow-board-modal-note">Cột “{dialog.column.label}” sẽ được giữ lại trong lịch sử để có thể khôi phục sau.</p>
                {dialogCards.length > 0 && <label className="workflow-board-field"><span>Chuyển công việc sang <b>*</b></span><select data-workflow-autofocus required value={form.targetColumnId} onChange={event => setForm(current => ({ ...current, targetColumnId: event.target.value }))}><option value="">Chọn cột đang hoạt động</option>{archiveTargets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select><small>{dialogCards.length} công việc cần được chuyển trước khi lưu trữ.</small></label>}
              </> : <>
                <label className="workflow-board-field"><span>Tên cột <b>*</b></span><input data-workflow-autofocus required maxLength={80} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ví dụ: Chờ duyệt" /></label>
                <label className="workflow-board-field"><span>Trạng thái công việc</span><select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}>{Object.entries(STATUS_META).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select></label>
                <label className="workflow-board-field"><span>Màu cột</span><select value={form.tone} onChange={event => setForm(current => ({ ...current, tone: event.target.value }))}>{TONES.map(tone => <option key={tone.id} value={tone.id}>{tone.label}</option>)}</select></label>
              </>}
              <ErrorMessage>{formError}</ErrorMessage>
            </div>
            <footer className="workflow-board-modal-foot"><button type="button" className="workflow-board-button secondary" onClick={closeDialog} disabled={pendingForm}>Huỷ</button><button type="submit" className={`workflow-board-button ${dialog.kind === "archive" ? "danger" : "primary"}`} disabled={pendingForm}>{pendingForm ? <LoaderCircle className="workflow-board-spin" size={16} /> : dialog.kind === "archive" ? <Archive size={16} /> : <Check size={16} />}{dialog.kind === "create" ? "Thêm cột" : dialog.kind === "edit" ? "Lưu thay đổi" : "Lưu trữ cột"}</button></footer>
          </form>
        </section>
      </div>}
    </div>
  );
}
