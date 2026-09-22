import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, FilePlus2, GripVertical, ListChecks, LoaderCircle, Plus, Save, Tag, UserRound, UsersRound, X } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import "./task-extras.css";

const EMPTY_EXTRAS = { assigneeIds: [], labelIds: [], labels: [], members: [], checklists: [] };

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

function displayName(member) {
  return member?.name || member?.email || "Thành viên";
}

function initials(member) {
  return displayName(member).split(/\s+/).filter(Boolean).slice(-2).map(part => part[0]).join("").toUpperCase() || "?";
}

function messageFor(error, fallback) {
  return error?.message || fallback;
}

export const taskExtrasPaths = {
  extras: taskId => `/tasks/${encodeURIComponent(taskId)}/extras`,
  labels: "/task-labels",
  copy: taskId => `/tasks/${encodeURIComponent(taskId)}/copy`,
  checklistCopy: (taskId, checklistId) => `/tasks/${encodeURIComponent(taskId)}/checklists/${encodeURIComponent(checklistId)}/copy`,
  checklistOrder: (taskId, checklistId) => `/tasks/${encodeURIComponent(taskId)}/checklists/${encodeURIComponent(checklistId)}/order`,
  checklistConvert: (taskId, checklistId, itemId) => `/tasks/${encodeURIComponent(taskId)}/checklists/${encodeURIComponent(checklistId)}/items/${encodeURIComponent(itemId)}/convert`,
};

function ErrorBox({ children }) {
  return children ? <div className="task-extras-error" role="alert"><X size={15} />{children}</div> : null;
}

function BusyButton({ children, busy, icon: Icon = Check, ...props }) {
  return <button {...props}>{busy ? <LoaderCircle className="task-extras-spin" size={15} /> : <Icon size={15} />}{children}</button>;
}

export default function TaskExtras({ api, task, members = [], onChanged, readOnly = false, refreshToken = 0 }) {
  const taskId = task?.id;
  const [extras, setExtras] = useState(EMPTY_EXTRAS);
  const [labels, setLabels] = useState([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState([]);
  const [selectedChecklistId, setSelectedChecklistId] = useState("");
  const [dueAt, setDueAt] = useState(() => localDateTime(task?.dueAt));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [labelDraft, setLabelDraft] = useState({ name: "", color: "green" });
  const [labelFormOpen, setLabelFormOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState(null);
  const [reload, setReload] = useState(0);
  const alive = useRef(true);

  const canWrite = !readOnly && extras?.canWrite !== false;
  const primaryAssigneeId = text(task?.assigneeId ?? task?.assignee_id);
  const checklists = Array.isArray(extras.checklists) ? extras.checklists : [];
  const selectedChecklist = checklists.find(item => String(item.id) === String(selectedChecklistId)) || checklists[0] || null;
  const availableMembers = useMemo(() => {
    const source = Array.isArray(extras.members) && extras.members.length ? extras.members : members;
    const seen = new Set();
    return source.filter(member => {
      const id = text(member?.id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return id !== primaryAssigneeId;
    });
  }, [extras.members, members, primaryAssigneeId]);

  useEffect(() => {
    alive.current = true;
    if (!taskId) {
      setLoading(false);
      setExtras(EMPTY_EXTRAS);
      return () => { alive.current = false; };
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api(taskExtrasPaths.extras(taskId)),
      api(taskExtrasPaths.labels).catch(() => null),
    ])
      .then(([result, labelResult]) => {
        if (cancelled) return;
        const next = { ...EMPTY_EXTRAS, ...(result || {}) };
        const nextLabels = Array.isArray(labelResult?.labels) ? labelResult.labels : Array.isArray(next.labels) ? next.labels : [];
        const labelIds = Array.isArray(next.labelIds) ? next.labelIds.map(String) : [];
        const assigneeIds = Array.isArray(next.assigneeIds) ? next.assigneeIds.map(String) : [];
        setExtras(next);
        setLabels(nextLabels);
        setSelectedLabelIds(labelIds);
        setSelectedAssigneeIds(assigneeIds);
        setSelectedChecklistId(current => current && next.checklists.some(item => String(item.id) === String(current)) ? current : next.checklists[0]?.id || "");
        setDueAt(localDateTime(task?.dueAt));
      })
      .catch(loadError => { if (!cancelled) setError(messageFor(loadError, "Không thể tải thông tin bổ sung của công việc.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; };
  }, [api, taskId, reload, refreshToken]);

  async function notifyChanged() {
    try {
      await onChanged?.();
    } catch (changeError) {
      if (alive.current) setError(messageFor(changeError, "Đã lưu nhưng chưa làm mới được công việc."));
    }
  }

  async function mutate(key, path, method, body, success) {
    if (!canWrite || busy) return null;
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
      if (alive.current) setError(messageFor(mutationError, "Không thể lưu thay đổi."));
      return null;
    } finally {
      if (alive.current) setBusy("");
    }
  }

  function toggleLabel(id) {
    const value = String(id);
    setSelectedLabelIds(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  }

  function toggleAssignee(id) {
    const value = String(id);
    setSelectedAssigneeIds(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  }

  async function saveAssignments() {
    await mutate("assignments", taskExtrasPaths.extras(taskId), "PUT", { assigneeIds: selectedAssigneeIds, labelIds: selectedLabelIds }, "Đã cập nhật nhãn và người phụ trách.");
  }

  async function createLabel(event) {
    event.preventDefault();
    if (!labelDraft.name.trim()) return;
    const result = await mutate("label", taskExtrasPaths.labels, "POST", { name: labelDraft.name.trim(), color: labelDraft.color }, "Đã tạo nhãn mới.");
    if (result) {
      setLabelDraft({ name: "", color: "green" });
      setLabelFormOpen(false);
    }
  }

  async function copyTask() {
    const result = await mutate("copy", taskExtrasPaths.copy(taskId), "POST", { dueAt: isoDateTime(dueAt) }, "Đã sao chép công việc.");
    if (result?.task) setNotice(`Đã tạo bản sao “${result.task.title || result.task.id}”.`);
  }

  async function saveTemplate(kind) {
    if (!templateForm?.name.trim()) return;
    const body = {
      sourceTaskId: taskId,
      kind,
      name: templateForm.name.trim(),
      ...(kind === "checklist" && selectedChecklist ? { checklistId: selectedChecklist.id } : {}),
    };
    const result = await mutate(`template:${kind}`, "/task-templates", "POST", body, kind === "task" ? "Đã lưu mẫu công việc." : "Đã lưu mẫu checklist.");
    if (result) setTemplateForm(null);
  }

  async function reorderChecklist(index, direction) {
    if (!selectedChecklist) return;
    const items = [...(selectedChecklist.items || [])];
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    const result = await mutate("checklist-order", taskExtrasPaths.checklistOrder(taskId, selectedChecklist.id), "PUT", { ids: items.map(item => item.id) }, "Đã cập nhật thứ tự checklist.");
    if (result) setExtras(current => ({ ...current, checklists: current.checklists.map(list => String(list.id) === String(selectedChecklist.id) ? { ...list, items } : list) }));
  }

  async function copyChecklist() {
    if (!selectedChecklist) return;
    await mutate("checklist-copy", taskExtrasPaths.checklistCopy(taskId, selectedChecklist.id), "POST", {}, "Đã sao chép checklist.");
  }

  async function convertItem(item) {
    if (!selectedChecklist) return;
    const result = await mutate(`convert:${item.id}`, taskExtrasPaths.checklistConvert(taskId, selectedChecklist.id, item.id), "POST", { dueAt: isoDateTime(dueAt) }, "Đã chuyển mục checklist thành công việc.");
    if (result?.task) setNotice(`Đã tạo công việc “${result.task.title || result.task.id}”.`);
  }

  if (!taskId) return null;
  return (
    <section className="task-extras" aria-label="Thông tin bổ sung">
      <header className="task-extras-heading"><div><span className="task-extras-eyebrow">MỞ RỘNG CÔNG VIỆC</span><h2>Nhãn, phân công và mẫu</h2></div><span className="task-extras-count"><ListChecks size={15} />{checklists.length} checklist</span></header>
      {loading && <div className="task-extras-loading"><LoaderCircle className="task-extras-spin" size={18} /> Đang tải thông tin bổ sung…</div>}
      <ErrorBox>{error}</ErrorBox>
      {notice && <p className="task-extras-notice" role="status">{notice}</p>}
      <div className="task-extras-grid">
        <section className="task-extras-panel" aria-labelledby="task-extras-labels-heading">
          <div className="task-extras-panel-heading"><h3 id="task-extras-labels-heading"><Tag size={17} />Nhãn</h3>{canWrite && <button type="button" className="task-extras-link" onClick={() => setLabelFormOpen(value => !value)}><Plus size={14} />Tạo nhãn</button>}</div>
          <div className="task-extras-pills">{selectedLabelIds.length ? selectedLabelIds.map(id => { const label = labels.find(item => String(item.id) === id); return <span className="task-extras-pill" key={id}>{label?.name || id}</span>; }) : <span className="task-extras-muted">Chưa gắn nhãn</span>}</div>
          <div className="task-extras-options">{labels.map(label => <label className="task-extras-check-row" key={label.id}><input type="checkbox" checked={selectedLabelIds.includes(String(label.id))} disabled={!canWrite || !!busy} onChange={() => toggleLabel(label.id)} /><span className={`task-extras-label-dot tone-${label.color || "green"}`} /><span>{label.name}</span></label>)}{!labels.length && <span className="task-extras-muted">Chưa có nhãn nào.</span>}</div>
          {labelFormOpen && canWrite && <form className="task-extras-inline-form" onSubmit={createLabel}><input autoFocus required maxLength={80} value={labelDraft.name} onChange={event => setLabelDraft(current => ({ ...current, name: event.target.value }))} placeholder="Tên nhãn mới" aria-label="Tên nhãn mới" /><select value={labelDraft.color} onChange={event => setLabelDraft(current => ({ ...current, color: event.target.value }))} aria-label="Màu nhãn"><option value="green">Xanh lá</option><option value="blue">Xanh biển</option><option value="orange">Cam</option><option value="purple">Tím</option><option value="rose">Hồng</option></select><BusyButton className="task-extras-button secondary" busy={busy === "label"} disabled={!labelDraft.name.trim() || !!busy}>Lưu</BusyButton></form>}
          {canWrite && <BusyButton className="task-extras-button secondary" busy={busy === "assignments"} disabled={!!busy} onClick={saveAssignments} icon={Save}>Lưu nhãn</BusyButton>}
        </section>

        <section className="task-extras-panel" aria-labelledby="task-extras-assignees-heading">
          <div className="task-extras-panel-heading"><h3 id="task-extras-assignees-heading"><UsersRound size={17} />Người phụ trách</h3><span className="task-extras-meta">{selectedAssigneeIds.length} người</span></div>
          <div className="task-extras-options">{availableMembers.map(member => <label className="task-extras-member-row" key={member.id}><input type="checkbox" checked={selectedAssigneeIds.includes(String(member.id))} disabled={!canWrite || !!busy} onChange={() => toggleAssignee(member.id)} /><span className="task-extras-avatar">{initials(member)}</span><span><strong>{displayName(member)}</strong><small>{member.email || "Thành viên"}</small></span></label>)}{!availableMembers.length && <span className="task-extras-muted">Chưa có thành viên để phân công.</span>}</div>
          {canWrite && <BusyButton className="task-extras-button secondary" busy={busy === "assignments"} disabled={!!busy} onClick={saveAssignments} icon={UserRound}>Lưu người phụ trách</BusyButton>}
        </section>

        <section className="task-extras-panel task-extras-copy-panel" aria-labelledby="task-extras-copy-heading">
          <div className="task-extras-panel-heading"><h3 id="task-extras-copy-heading"><Copy size={17} />Sao chép công việc</h3></div>
          <p className="task-extras-help">Chọn hạn cho bản sao rồi tạo một công việc mới từ nội dung hiện tại.</p>
          <label className="task-extras-field"><span>Hạn bản sao</span><input type="datetime-local" value={dueAt} disabled={!canWrite || !!busy} onChange={event => setDueAt(event.target.value)} /></label>
          {canWrite && <BusyButton className="task-extras-button primary" busy={busy === "copy"} disabled={!!busy} onClick={copyTask} icon={Copy}>Sao chép công việc</BusyButton>}
        </section>

        <section className="task-extras-panel" aria-labelledby="task-extras-template-heading">
          <div className="task-extras-panel-heading"><h3 id="task-extras-template-heading"><FilePlus2 size={17} />Lưu thành mẫu</h3></div>
          <p className="task-extras-help">Dùng lại nội dung công việc hoặc checklist cho những lần sau.</p>
          {templateForm ? <div className="task-extras-template-form"><label className="task-extras-field"><span>Tên mẫu {templateForm.kind === "checklist" ? "checklist" : "công việc"}</span><input autoFocus maxLength={120} value={templateForm.name} onChange={event => setTemplateForm(current => ({ ...current, name: event.target.value }))} placeholder="Ví dụ: Quy trình bàn giao" /></label><div className="task-extras-form-actions"><button type="button" className="task-extras-button secondary" disabled={!!busy} onClick={() => setTemplateForm(null)}>Huỷ</button><BusyButton className="task-extras-button primary" busy={busy === `template:${templateForm.kind}`} disabled={!templateForm.name.trim() || !!busy} onClick={() => saveTemplate(templateForm.kind)} icon={Save}>Lưu mẫu</BusyButton></div></div> : canWrite && <div className="task-extras-template-actions"><button type="button" className="task-extras-button secondary" onClick={() => setTemplateForm({ kind: "task", name: "" })}><FilePlus2 size={15} />Mẫu công việc</button><button type="button" className="task-extras-button secondary" disabled={!selectedChecklist} onClick={() => setTemplateForm({ kind: "checklist", name: "" })}><ListChecks size={15} />Mẫu checklist</button></div>}
        </section>

        <section className="task-extras-panel task-extras-checklist-panel" aria-labelledby="task-extras-checklist-heading">
          <div className="task-extras-panel-heading"><h3 id="task-extras-checklist-heading"><ListChecks size={17} />Thao tác checklist</h3>{selectedChecklist && canWrite && <ActionMenu label="Thao tác checklist" items={[{ label: "Sao chép checklist", icon: Copy, onSelect: copyChecklist }]} disabled={!!busy} />}</div>
          {!checklists.length ? <p className="task-extras-muted">Công việc chưa có checklist.</p> : <><label className="task-extras-field"><span>Checklist đang chọn</span><select value={selectedChecklist?.id || ""} disabled={!!busy} onChange={event => setSelectedChecklistId(event.target.value)}>{checklists.map(list => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label><div className="task-extras-items">{(selectedChecklist?.items || []).map((item, index, items) => <article className={`task-extras-item ${item.completed ? "is-done" : ""}`} key={item.id}><GripVertical size={14} className="task-extras-grip" aria-hidden="true" /><span className="task-extras-item-title">{item.title}</span>{canWrite && <div className="task-extras-item-actions"><button type="button" title="Di chuyển lên" aria-label={`Di chuyển ${item.title} lên`} disabled={!!busy || index === 0} onClick={() => reorderChecklist(index, -1)}><ArrowUp size={14} /></button><button type="button" title="Di chuyển xuống" aria-label={`Di chuyển ${item.title} xuống`} disabled={!!busy || index === items.length - 1} onClick={() => reorderChecklist(index, 1)}><ArrowDown size={14} /></button><ActionMenu label={`Thao tác mục ${item.title}`} disabled={!!busy} items={[{ label: "Chuyển thành công việc", icon: Copy, onSelect: () => convertItem(item) }]} /></div>}</article>)}{!selectedChecklist?.items?.length && <span className="task-extras-muted">Checklist chưa có mục nào.</span>}</div></>}
        </section>
      </div>
    </section>
  );
}
