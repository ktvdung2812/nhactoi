import React, { useEffect, useRef, useState } from "react";
import { Plus, Zap, Play, Trash2, X } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import useModalFocus from "./useModalFocus.js";
import "./services.css";

const statuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const triggers = { created: "Khi tạo công việc", status_changed: "Khi đổi trạng thái", manual: "Nút chạy thủ công" };
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };

function workspaceCanWrite(me) {
  if (!me) return true;
  const subscription = me.subscription;
  if (!subscription || me.workspace?.suspendedAt || ["expired", "canceled"].includes(subscription.status)) return false;
  return !subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd).getTime() > Date.now();
}

export default function Automations({ api, me, teams = [], tasks = [], members = [], onChanged }) {
  const [data, setData] = useState({ rules: [], runs: [] });
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [run, setRun] = useState(null);
  const [taskId, setTaskId] = useState("");
  const dialogRef = useRef(null);
  const errorRef = useRef(null);
  const nameRef = useRef(null);
  const errorFocusTarget = useRef(null);

  const role = me?.user?.role;
  const canManageCommon = role === "owner" || role === "admin";
  const manageableTeams = teams.filter(team => !team.archivedAt && team.canManage);
  const canManageAny = canManageCommon || manageableTeams.length > 0;
  const canWriteWorkspace = workspaceCanWrite(me);
  const canCreate = canWriteWorkspace && canManageAny;
  const selectedTeam = draft?.teamId ? teams.find(team => String(team.id) === String(draft.teamId)) : null;
  const actionMembers = selectedTeam
    ? members.filter(member => (selectedTeam.memberIds || []).map(String).includes(String(member.id)))
    : members;
  const permissionMessage = !canWriteWorkspace
    ? "Không thể thay đổi tự động hóa khi không gian bị tạm ngưng hoặc thuê bao chỉ đọc."
    : !canManageAny
      ? "Chỉ chủ/quản trị không gian hoặc trưởng nhóm mới có thể tạo quy tắc cho bảng mình quản lý."
      : "";

  const closeDialogs = () => {
    setDraft(null);
    setRun(null);
    setTaskId("");
    setFormError("");
  };

  useModalFocus({
    open: Boolean(draft || run),
    dialogRef,
    onClose: closeDialogs,
    disabled: busy,
  });

  useEffect(() => {
    let active = true;
    api("/automations")
      .then(value => {
        if (active) setData(value);
      })
      .catch(loadError => active && setError(loadError.message));
    return () => {
      active = false;
    };
  }, [api, revision]);

  useEffect(() => {
    if (!formError || (!draft && !run)) return undefined;
    const target = errorFocusTarget.current;
    errorFocusTarget.current = null;
    const frame = requestAnimationFrame(() => (target === "name" ? nameRef.current : errorRef.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [formError, Boolean(draft || run)]);

  function openCreate() {
    if (!canCreate) return;
    setError("");
    setFormError("");
    setDraft({
      name: "",
      teamId: canManageCommon ? "" : manageableTeams[0]?.id || "",
      trigger: "status_changed",
      conditionStatus: "",
      actions: [{ type: "priority", value: "high" }],
    });
  }

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setError("");
    setFormError("");
    try {
      const result = await fn();
      if (result?.ok === false) throw new Error(result.error || "Thao tác chưa hoàn thành");
      closeDialogs();
      setRevision(value => value + 1);
      await onChanged?.();
    } catch (actionError) {
      if (draft || run) setFormError(actionError.message);
      else setError(actionError.message);
      setRevision(value => value + 1);
    } finally {
      setBusy(false);
    }
  }

  const update = (index, patch) => {
    setFormError("");
    setDraft(current => ({ ...current, actions: current.actions.map((action, position) => position === index ? { ...action, ...patch } : action) }));
  };

  function submitDraft(event) {
    event.preventDefault();
    if (!draft.name.trim()) {
      errorFocusTarget.current = "name";
      setFormError("Vui lòng nhập tên quy tắc.");
      return;
    }
    act(() => api("/automations", { method: "POST", body: JSON.stringify({ ...draft, name: draft.name.trim(), teamId: draft.teamId || "" }) }));
  }

  return (
    <section className="services-page">
      <header className="page-heading services-page-heading">
        <div>
          <h1>Tự động hóa</h1>
          <p>Để những bước lặp lại chạy theo quy tắc của team.</p>
        </div>
        <button type="button" className="button" disabled={!canCreate} title={permissionMessage || undefined} aria-describedby={permissionMessage ? "automation-permission-note" : undefined} onClick={openCreate}>
          <Plus size={18} />Tạo quy tắc
        </button>
      </header>
      {permissionMessage && <p id="automation-permission-note" className="automation-permission-note" role="status">{permissionMessage}</p>}
      {!draft && !run && error && <div className="form-error" role="alert">{error}</div>}

      <div className="service-grid">
        {data.rules.map(rule => {
          const actions = [
            rule.trigger === "manual" && rule.enabled && canWriteWorkspace
              ? { label: "Chạy cho công việc", icon: Play, onSelect: () => { setFormError(""); setRun(rule); setTaskId(""); } }
              : null,
            rule.canManage && canWriteWorkspace
              ? { label: rule.enabled ? "Tạm dừng" : "Bật quy tắc", onSelect: () => act(() => api(`/automations/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) })) }
              : null,
          ];
          return (
            <article className="service-card" key={rule.id}>
              <div className="service-card-head">
                <Zap size={20} />
                <h3>{rule.name}</h3>
                <ActionMenu label={`Tùy chọn ${rule.name}`} items={actions} disabled={busy} />
              </div>
              <p>{teams.find(team => team.id === rule.team_id)?.name || "Việc chung doanh nghiệp"} · {rule.enabled ? "Đang bật" : "Tạm dừng"}</p>
              <p>{triggers[rule.trigger]}{rule.condition_status ? ` → ${statuses[rule.condition_status]}` : ""}</p>
              <ol>{rule.actions.map((action, index) => <li key={index}>{action.type === "status" ? `Chuyển sang ${statuses[action.value]}` : action.type === "priority" ? `Ưu tiên: ${priorities[action.value]}` : action.type === "assignee" ? `Giao cho ${members.find(member => member.id === action.value)?.name || "thành viên"}` : `Bình luận: ${action.value}`}</li>)}</ol>
            </article>
          );
        })}
      </div>
      {!data.rules.length && <p className="muted">Chưa có quy tắc. Quản lý doanh nghiệp hoặc team có thể tạo quy tắc đầu tiên.</p>}

      <section className="td-panel">
        <h2>Nhật ký chạy</h2>
        {!data.runs.length ? <p>Chưa có lần chạy nào.</p> : data.runs.map(runItem => <div className="service-history-item" key={runItem.id}><strong>{runItem.rule_name}</strong><span>{runItem.status === "success" ? "Hoàn thành" : "Chưa hoàn thành"} · {new Date(runItem.created_at).toLocaleString("vi-VN")}</span>{runItem.error && <p role="alert">{runItem.error}</p>}</div>)}
      </section>

      {draft && (
        <div className="modal-backdrop">
          <section ref={dialogRef} className="modal service-modal" role="dialog" aria-modal="true" aria-labelledby="automation-title" tabIndex={-1}>
            <header>
              <h2 id="automation-title">Quy tắc mới</h2>
              <button type="button" className="icon-btn" disabled={busy} onClick={closeDialogs} aria-label="Đóng"><X /></button>
            </header>
            {formError && <div ref={errorRef} id="automation-form-error" className="service-modal-error" role="alert" tabIndex={-1}>{formError}</div>}
            <form onSubmit={submitDraft}>
              <div className="service-form-grid">
                <label>Tên quy tắc<input ref={nameRef} data-modal-autofocus required maxLength={120} aria-describedby={formError ? "automation-form-error" : undefined} value={draft.name} onChange={event => { setFormError(""); setDraft({ ...draft, name: event.target.value }); }} /></label>
                <label>Bảng công việc<select value={draft.teamId} onChange={event => { setFormError(""); setDraft({ ...draft, teamId: event.target.value }); }}>{canManageCommon && <option value="">Việc chung của doanh nghiệp</option>}{manageableTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                <label>Sự kiện<select value={draft.trigger} onChange={event => { setFormError(""); setDraft({ ...draft, trigger: event.target.value }); }}>{Object.entries(triggers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                <label>Chỉ khi trạng thái<select value={draft.conditionStatus} onChange={event => { setFormError(""); setDraft({ ...draft, conditionStatus: event.target.value }); }}><option value="">Bất kỳ</option>{Object.entries(statuses).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              </div>
              <h3>Thực hiện lần lượt</h3>
              {draft.actions.map((action, index) => <div className="automation-action" key={index}>
                <select aria-label={`Hành động ${index + 1}`} value={action.type} onChange={event => update(index, { type: event.target.value, value: { status: "doing", priority: "high", assignee: "", comment: "" }[event.target.value] })}><option value="status">Đổi trạng thái</option><option value="priority">Đổi ưu tiên</option><option value="assignee">Giao người phụ trách</option><option value="comment">Thêm bình luận</option></select>
                {action.type === "comment" ? <input required maxLength={5000} aria-label="Nội dung bình luận" value={action.value} onChange={event => update(index, { value: event.target.value })} /> : <select required aria-label="Giá trị hành động" value={action.value} onChange={event => update(index, { value: event.target.value })}>{action.type === "assignee" ? <><option value="">Chọn thành viên</option>{actionMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</> : Object.entries(action.type === "status" ? statuses : priorities).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}
                <button type="button" className="icon-btn" aria-label="Bỏ hành động" disabled={draft.actions.length === 1 || busy} onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, position) => position !== index) })}><Trash2 size={16} /></button>
              </div>)}
              <button type="button" className="button secondary" disabled={draft.actions.length >= 10 || busy} onClick={() => setDraft({ ...draft, actions: [...draft.actions, { type: "priority", value: "high" }] })}><Plus size={16} />Thêm bước</button>
              <p className="muted">Các bước của một lần chạy được lưu cùng nhau. Nếu một bước lỗi, các thay đổi của lần chạy đó được hoàn tác.</p>
              <footer><button type="submit" className="button" disabled={busy}>Lưu quy tắc</button></footer>
            </form>
          </section>
        </div>
      )}

      {run && (
        <div className="modal-backdrop">
          <section ref={dialogRef} className="modal service-modal" role="dialog" aria-modal="true" aria-labelledby="automation-run-title" tabIndex={-1}>
            <header>
              <h2 id="automation-run-title">{run.name}</h2>
              <button type="button" className="icon-btn" disabled={busy} onClick={closeDialogs} aria-label="Đóng"><X /></button>
            </header>
            {formError && <div ref={errorRef} className="service-modal-error" role="alert" tabIndex={-1}>{formError}</div>}
            <label>Công việc<select data-modal-autofocus value={taskId} onChange={event => setTaskId(event.target.value)}><option value="">Chọn công việc</option>{tasks.filter(task => (task.teamId || null) === (run.team_id || null)).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
            <button type="button" className="button" disabled={busy || !taskId} onClick={() => act(() => api(`/automations/${run.id}/run`, { method: "POST", body: JSON.stringify({ taskId }) }))}>Chạy {run.actions.length} bước</button>
          </section>
        </div>
      )}
    </section>
  );
}
