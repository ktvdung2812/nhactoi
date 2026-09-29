import React, { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, FilePlus2, Filter, LoaderCircle, ListChecks, Plus, Sparkles, Trash2, X } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import useModalFocus from "./useModalFocus.js";
import "./task-extras.css";

function text(value) {
  return value == null ? "" : String(value);
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function isoDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const EMPTY_FORM = { name: "", kind: "task", checklistId: "", teamId: "", dueAt: "", taskId: "" };

function templateKindLabel(kind) {
  return kind === "checklist" ? "Mẫu checklist" : "Mẫu công việc";
}

function ErrorBox({ children }) {
  return children ? <div className="task-extras-error" role="alert"><X size={15} />{children}</div> : null;
}

export default function TaskTemplates({
  api,
  task = null,
  taskId = null,
  teams = [],
  checklists = [],
  sourceTaskId = null,
  tasks = [],
  onOpen,
  onCreated,
  onChanged,
  readOnly = false,
}) {
  const currentTaskId = taskId || task?.id || sourceTaskId || "";
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [reload, setReload] = useState(0);
  const dialogRef = useRef(null);
  const alive = useRef(true);
  const [sourceChecklists, setSourceChecklists] = useState([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  useModalFocus({ open: Boolean(dialog), dialogRef, onClose: closeDialog, disabled: Boolean(busy) });

  const activeTeams = useMemo(() => teams.filter(team => !team.archivedAt), [teams]);
  const visibleTemplates = useMemo(() => templates.filter(template => filter === "all" || template.kind === filter), [templates, filter]);
  const taskOptions = useMemo(() => tasks.filter(item => item && item.id), [tasks]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setLoading(true);
    setError("");
    api("/task-templates")
      .then(result => { if (!cancelled) setTemplates(Array.isArray(result?.templates) ? result.templates : []); })
      .catch(loadError => { if (!cancelled) setError(loadError?.message || "Không thể tải danh sách mẫu."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; };
  }, [api, reload]);

  useEffect(() => {
    if (dialog?.kind !== "create" || !form.taskId) { setSourceChecklists([]); setSourceLoading(false); return; }
    let cancelled = false;
    setSourceLoading(true);
    setSourceChecklists([]);
    api(`/tasks/${encodeURIComponent(form.taskId)}/extras`)
      .then(result => { if (!cancelled) setSourceChecklists(result.checklists || []); })
      .catch(error => { if (!cancelled) setFormError(error.message || "Không tải được checklist nguồn."); })
      .finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => { cancelled = true; };
  }, [api, dialog?.kind, form.taskId]);

  async function notifyChanged() {
    try { await onChanged?.(); } catch (changeError) { if (alive.current) setError(changeError?.message || "Đã lưu nhưng chưa làm mới được danh sách mẫu."); }
  }

  async function mutate(key, path, method, body, success) {
    if (readOnly || busy) return null;
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await api(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (alive.current) {
        setNotice(success || "Đã lưu thay đổi.");
        setReload(value => value + 1);
      }
      await notifyChanged();
      return result;
    } catch (mutationError) {
      if (alive.current) { const message = mutationError?.message || "Không thể lưu thay đổi."; setError(message); if (dialog) setFormError(message); }
      return null;
    } finally {
      if (alive.current) setBusy("");
    }
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM, checklistId: checklists[0]?.id || "", taskId: currentTaskId });
    setFormError("");
    setDialog({ kind: "create" });
  }

  function openApply(template) {
    setForm({ ...EMPTY_FORM, kind: template.kind, teamId: task?.teamId || "", dueAt: localDateTime(task?.dueAt), taskId: currentTaskId });
    setFormError("");
    setDialog({ kind: "apply", template });
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setFormError("");
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (!form.name.trim()) { setFormError("Hãy nhập tên mẫu."); return; }
    if (!form.taskId) { setFormError("Hãy chọn công việc nguồn để tạo mẫu."); return; }
    if (form.kind === "checklist" && !form.checklistId) { setFormError("Hãy chọn checklist nguồn."); return; }
    const body = { sourceTaskId: form.taskId, kind: form.kind, name: form.name.trim(), ...(form.kind === "checklist" ? { checklistId: form.checklistId } : {}) };
    const result = await mutate("create", "/task-templates", "POST", body, "Đã tạo mẫu.");
    if (result) closeDialog();
  }

  async function applyTemplate(event) {
    event.preventDefault();
    if (!dialog?.template) return;
    if (dialog.template.kind === "checklist") {
      if (!form.taskId) { setFormError("Hãy chọn công việc nhận checklist."); return; }
      const result = await mutate(`apply:${dialog.template.id}`, `/task-templates/${encodeURIComponent(dialog.template.id)}/apply`, "POST", { taskId: form.taskId }, "Đã áp dụng checklist vào công việc.");
      if (result) closeDialog();
      return;
    }
    const result = await mutate(`create-task:${dialog.template.id}`, `/task-templates/${encodeURIComponent(dialog.template.id)}/create`, "POST", { dueAt: isoDateTime(form.dueAt), teamId: form.teamId || null }, "Đã tạo công việc từ mẫu.");
    if (result?.task) {
      onCreated?.(result.task);
      onOpen?.(result.task);
    }
    if (result) closeDialog();
  }

  async function deleteTemplate(template) {
    if (!template?.canDelete || removeId !== template.id) return;
    const result = await mutate(`delete:${template.id}`, `/task-templates/${encodeURIComponent(template.id)}`, "DELETE", undefined, "Đã xoá mẫu.");
    if (result) setRemoveId("");
  }

  return (
    <section className="task-templates-page" aria-label="Mẫu công việc và checklist">
      <header className="task-templates-heading">
        <div>
          <span className="task-extras-eyebrow">THƯ VIỆN TÁI SỬ DỤNG</span>
          <h1>Mẫu công việc</h1>
          <p>Lưu quy trình thường dùng và tạo công việc mới trong vài bước.</p>
        </div>
        {!readOnly && <button type="button" className="task-extras-button primary" onClick={openCreate}><Plus size={16} />Tạo mẫu</button>}
      </header>
      {error && <ErrorBox>{error}</ErrorBox>}
      {notice && <p className="task-extras-notice" role="status">{notice}</p>}
      <div className="task-templates-toolbar">
        <div className="task-templates-filters" role="group" aria-label="Lọc loại mẫu">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><Filter size={14} />Tất cả <span>{templates.length}</span></button>
          <button type="button" className={filter === "task" ? "active" : ""} onClick={() => setFilter("task")}><FilePlus2 size={14} />Công việc <span>{templates.filter(item => item.kind === "task").length}</span></button>
          <button type="button" className={filter === "checklist" ? "active" : ""} onClick={() => setFilter("checklist")}><ListChecks size={14} />Checklist <span>{templates.filter(item => item.kind === "checklist").length}</span></button>
        </div>
      </div>
      {loading ? (
        <div className="task-extras-loading"><LoaderCircle className="task-extras-spin" size={18} /> Đang tải mẫu…</div>
      ) : visibleTemplates.length ? (
        <div className="task-templates-grid">
          {visibleTemplates.map(template => (
            <article className="task-template-card" key={template.id}>
              <div className="task-template-card-top">
                <span className={`task-template-kind ${template.kind === "checklist" ? "checklist" : "task"}`}>
                  {template.kind === "checklist" ? <ListChecks size={14} /> : <FilePlus2 size={14} />}
                  {templateKindLabel(template.kind)}
                </span>
                {template.canDelete && <ActionMenu label={`Thao tác ${template.name}`} items={[{ label: "Xoá mẫu", icon: Trash2, danger: true, onSelect: () => setRemoveId(template.id) }]} disabled={!!busy} />}
              </div>
              <h2>{template.name}</h2>
              <p>{template.teamId ? `Team: ${activeTeams.find(team => String(team.id) === String(template.teamId))?.name || template.teamId}` : "Dùng trong toàn không gian"}</p>
              {removeId === template.id ? (
                <div className="task-template-delete">
                  <span>Xoá mẫu này?</span>
                  <button type="button" className="task-extras-button secondary" disabled={!!busy} onClick={() => setRemoveId("")}>Huỷ</button>
                  <button type="button" className="task-extras-button danger" disabled={!!busy} onClick={() => deleteTemplate(template)}>
                    {busy === `delete:${template.id}` ? <LoaderCircle className="task-extras-spin" size={14} /> : <Trash2 size={14} />}Xoá
                  </button>
                </div>
              ) : (
                <button type="button" className="task-extras-button primary" disabled={!!busy} onClick={() => openApply(template)}>
                  <Sparkles size={15} />{template.kind === "checklist" ? "Áp dụng vào công việc" : "Tạo công việc"}
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="task-templates-empty">
          <FilePlus2 size={25} />
          <h2>Chưa có mẫu</h2>
          <p>Tạo mẫu từ một công việc hoặc checklist để dùng lại quy trình.</p>
          {!readOnly && <button type="button" className="task-extras-button primary" onClick={openCreate}><Plus size={15} />Tạo mẫu đầu tiên</button>}
        </div>
      )}
      {dialog && (
        <div className="task-extras-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section ref={dialogRef} className="task-extras-modal" role="dialog" aria-modal="true" aria-labelledby="task-template-dialog-title" tabIndex={-1}>
            <header className="task-extras-modal-head">
              <div><span className="task-extras-eyebrow">MẪU CÔNG VIỆC</span><h2 id="task-template-dialog-title">{dialog.kind === "create" ? "Tạo mẫu mới" : `Dùng ${dialog.template.name}`}</h2></div>
              <button type="button" className="task-extras-modal-close" onClick={closeDialog} aria-label="Đóng"><X size={18} /></button>
            </header>
            <form noValidate onSubmit={dialog.kind === "create" ? submitCreate : applyTemplate}>
              <div className="task-extras-modal-body">
                {dialog.kind === "create" ? (
                  <>
                    <label className="task-extras-field"><span>Tên mẫu <b>*</b></span><input data-template-autofocus required maxLength={120} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ví dụ: Quy trình tiếp nhận khách hàng" /></label>
                    <label className="task-extras-field"><span>Loại mẫu</span><select value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value }))}><option value="task">Mẫu công việc</option><option value="checklist">Mẫu checklist</option></select></label>
                    <label className="task-extras-field"><span>Công việc nguồn <b>*</b></span><select required value={form.taskId} disabled={Boolean(currentTaskId)} onChange={event => { setFormError(""); setForm(current => ({ ...current, taskId: event.target.value, checklistId: "" })); }}><option value="">Chọn công việc</option>{currentTaskId && !taskOptions.some(item => item.id === currentTaskId) && <option value={currentTaskId}>{task?.title || "Công việc hiện tại"}</option>}{taskOptions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                    {form.kind === "checklist" && <label className="task-extras-field"><span>Checklist nguồn <b>*</b></span><select required value={form.checklistId} onChange={event => setForm(current => ({ ...current, checklistId: event.target.value }))}><option value="">Chọn checklist</option>{sourceChecklists.map(list => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>}
                  </>
                ) : dialog.template.kind === "checklist" ? (
                  <>
                    <p className="task-extras-modal-note">Checklist sẽ được thêm vào công việc bạn chọn.</p>
                    {currentTaskId ? (
                      <label className="task-extras-field"><span>Công việc nhận checklist <b>*</b></span><input data-template-autofocus required value={form.taskId} readOnly /></label>
                    ) : (
                      <label className="task-extras-field"><span>Công việc nhận checklist <b>*</b></span><select data-template-autofocus required value={form.taskId} onChange={event => setForm(current => ({ ...current, taskId: event.target.value }))}><option value="">Chọn công việc</option>{taskOptions.map(item => <option key={item.id} value={item.id}>{item.title || item.name || item.id}</option>)}</select></label>
                    )}
                  </>
                ) : (
                  <>
                    <p className="task-extras-modal-note">Tạo một công việc mới từ nội dung mẫu, sau đó chọn nơi làm việc và hạn.</p>
                    <label className="task-extras-field"><span>Team</span><select data-template-autofocus value={form.teamId} onChange={event => setForm(current => ({ ...current, teamId: event.target.value }))}><option value="">Việc chung của doanh nghiệp</option>{activeTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                    <label className="task-extras-field"><span>Hạn hoàn thành (cần cho công việc lặp)</span><input aria-describedby={formError ? "task-template-form-error" : undefined} aria-invalid={Boolean(formError)} type="datetime-local" value={form.dueAt} onChange={event => { setFormError(""); setForm(current => ({ ...current, dueAt: event.target.value })); }} /></label>
                  </>
                )}
                {sourceLoading && dialog.kind === "create" && <p role="status">Đang tải checklist…</p>}
                {formError && <div id="task-template-form-error"><ErrorBox>{formError}</ErrorBox></div>}
              </div>
              <footer className="task-extras-modal-foot">
                <button type="button" className="task-extras-button secondary" onClick={closeDialog} disabled={!!busy}>Huỷ</button>
                <button type="submit" className="task-extras-button primary" disabled={!!busy || sourceLoading}>{busy ? <LoaderCircle className="task-extras-spin" size={15} /> : <Check size={15} />}{dialog.kind === "create" ? "Lưu mẫu" : dialog.template.kind === "checklist" ? "Áp dụng checklist" : "Tạo công việc"}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
