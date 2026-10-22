import { isTaskMutation, useTaskMutation } from './useTaskMutation.js';
import { recurrenceLabel } from "../shared/task-recurrence.mjs";
import TaskReminders from "./ReminderSettings.jsx";
import TaskChecklists from "./TaskChecklists.jsx";
import TaskExtras from "./TaskExtras.jsx";
import {TaskTime} from "./WorkManagement.jsx";
import React, { useEffect, useId, useRef, useState } from "react";
import { assistantMention, filterMentionMembers, mentionToken } from "./mention-query.js";
import { ArrowLeft, CheckCheck, MessageSquare, Activity, Link2, Plus, Pencil, Trash2, Copy, RefreshCw, ExternalLink, CalendarDays, UserRound, Bell, Repeat2, Send, ShieldCheck, Upload, Download, FileText, Paperclip, Bot, X } from "lucide-react";
import AssistantMarkdown from "./AssistantMarkdown.js";
import ActionMenu from "./ActionMenu.jsx";
import CommentActions from "./CommentActions.jsx";
import "./task-detail.css";

const statuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };
const date = value => value ? new Date(value).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Chưa đặt";
const initials = value => (value || "?").trim().split(/\s+/).slice(-2).map(s => s[0]).join("").toUpperCase();
const fileSize = bytes => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
const safeUrl = value => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } };

const sourceHref = source => source.kind === "task" && source.taskId ? `/tasks/${encodeURIComponent(source.taskId)}` : /^\/api\/tasks\/[^/?#]+\/attachments\/[^/?#]+\/download$/.test(source.url || "") ? source.url : safeUrl(source.url);
const taskReferences = sources => (sources || []).filter(source => source.kind === "task" && source.taskId).map(source => ({ id: source.taskId, title: source.title || source.taskId }));
const sourceStatus = { read: "Đã đọc", partial: "Đọc một phần", failed: "Chưa đọc được", unread: "Chưa đọc", unsupported: "Chưa hỗ trợ", summarized: "Đã đọc và tóm tắt" };
const actionStatus = { proposed: "Chờ xác nhận", completed: "Hoàn tất", failed: "Chưa thực hiện", stale: "Đã lỗi thời", dismissed: "Đã bỏ qua" };
const argLabels = { title: "Tiêu đề", description: "Mô tả", status: "Trạng thái", priority: "Ưu tiên", dueAt: "Hạn", startAt: "Bắt đầu", assigneeId: "Phụ trách", assigneeIds: "Người phối hợp", completed: "Hoàn thành" };
// Summarize what a proposal would change so the caller can judge it before confirming.
function proposalArgs(args, members) {
  const person = id => members.find(member => member.id === id)?.name || id;
  return Object.entries(args || {}).filter(([key]) => argLabels[key]).map(([key, value]) => {
    const shown = value === null || value === "" ? "Bỏ trống"
      : key === "status" ? statuses[value] || value : key === "priority" ? priorities[value] || value
      : key === "dueAt" || key === "startAt" ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : date(value))
      : key === "assigneeId" ? person(value) : key === "assigneeIds" ? value.map(person).join(", ") || "Không ai"
      : key === "completed" ? (value ? "Có" : "Chưa") : String(value);
    return `${argLabels[key]}: ${shown}`;
  }).join(" · ");
}
function AiEvidence({ sources = [], actions = [], onOpenTask, run, members = [], onAct, busy = false }) {
  return <>
    {sources.length > 0 && <details className="td-ai-sources"><summary>Nguồn tham chiếu ({sources.length})</summary><ul>{sources.map((source, index) => <li key={source.id || index}>{sourceHref(source) ? <a href={sourceHref(source)} target={source.kind === "task" ? undefined : "_blank"} rel="noopener noreferrer" download={source.kind === "file" || undefined} onClick={source.kind === "task" && source.taskId && onOpenTask ? event => { event.preventDefault(); onOpenTask({ id: source.taskId, title: source.title }); } : undefined}>{source.title || source.url}</a> : <span>{source.title || source.id || "Ngữ cảnh công việc"}</span>}<small>{sourceStatus[source.status] || source.status}{(source.detail || source.note || source.error) ? ` · ${source.detail || source.note || source.error}` : ""}</small></li>)}</ul></details>}
    {actions.length > 0 && <ul className="td-ai-actions" aria-label="Đề xuất và kết quả thao tác">{actions.map((action, index) => { const details = proposalArgs(action.args, members); return <li key={action.id || index}>
      {action.status && <span className={`td-ai-chip is-${action.status}`}>{actionStatus[action.status] || action.status}</span>}
      <span className="td-ai-action-text"><strong>{action.summary || action.name}</strong>{details && <small>{details}</small>}{action.error && <small>{action.error}</small>}</span>
      {action.status === "proposed" && run?.canApply && onAct && <span className="td-ai-action-buttons"><button type="button" className="button" disabled={busy} onClick={() => onAct(run, action, "apply")}><CheckCheck size={14} />Thực hiện</button><button type="button" className="button secondary" disabled={busy} onClick={() => onAct(run, action, "dismiss")}>Bỏ qua</button></span>}
    </li>; })}</ul>}
  </>;
}

export default function TaskDetail({ taskId, api: request, me, members = [], customers = [], onEdit, onTrash, onBack, onChanged, onOpenTask, revision = 0 }) {
  const api = useTaskMutation(request, taskId);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [description, setDescription] = useState(null), [remove, setRemove] = useState(null);
  const descriptionRevision = useRef();
  const [scalarDrafts, setScalarDrafts] = useState({});
  const [attachment, setAttachment] = useState({ title: "", url: "" }), [comment, setComment] = useState("");
  const [mentionIds, setMentionIds] = useState([]);
  const [uploadFile, setUploadFile] = useState(null), [uploading, setUploading] = useState(false);
  const uploadInput = useRef(null), uploadAbort = useRef(null), commentFileInput = useRef(null);
  const [commentFiles, setCommentFiles] = useState([]), [commentSending, setCommentSending] = useState(""), [commentError, setCommentError] = useState("");
  const commentRef = useRef(null), mentionRef = useRef(null), activeMentionRef = useRef(null), pickingMention = useRef(false);
  const [mention, setMention] = useState(null), [mentionIndex, setMentionIndex] = useState(0);
  const mentionListId = useId();
  const commentOperation = useRef(null);
  const [aiRuns, setAiRuns] = useState([]), [aiError, setAiError] = useState("");
  const pending = useRef(false), sequence = useRef(0), alive = useRef(true), removeRef = useRef(null);
  useEffect(() => {
    if (!remove) return;
    const previous = document.activeElement;
    removeRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
    removeRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [remove]);
  const base = `/tasks/${encodeURIComponent(taskId)}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; uploadAbort.current?.abort(); }; }, []);
  useEffect(() => {
    const request = ++sequence.current;
    setLoading(true); setLoadError(false); setError("");
    Promise.all([api(`${base}/detail`), api(`${base}/upload-policy`).catch(err => ({ enabled: false, error: err.message })), api(`${base}/collaboration`).catch(() => null), api("/ai/config").catch(() => null)]).then(([detail, uploadPolicy, collaboration, aiConfig]) => ({ ...detail, uploadPolicy, collaboration, aiConfig })).then(result => { if (alive.current && sequence.current === request) setData(result); })
      .catch(err => { if (alive.current && sequence.current === request) {
        setLoadError(true); setError(err.message);
        if ([401, 403, 404].includes(err.status)) {
          setData(null); setDescription(null); setRemove(null); setAttachment({ title: "", url: "" }); setComment(""); setUploadFile(null); setCommentFiles([]); setMentionIds([]); mentionRef.current = null; setMention(null);
        }
      } })
      .finally(() => { if (alive.current && sequence.current === request) setLoading(false); });
  }, [api, base, revision, reload]);
  const task = data?.task;
  const writable = Boolean(data?.canWrite && !loadError && !loading && !me?.workspace?.suspendedAt);
  const canComment = Boolean((data?.canComment ?? data?.canWrite) && !loadError && !loading && !me?.workspace?.suspendedAt);
  const commentDisabled = !canComment || busy;
  const disabled = !writable || busy;
  useEffect(() => {
    let stopped = false, timer, previous = null;
    setAiRuns([]); setAiError("");
    async function poll() {
      if (document.hidden) { timer = setTimeout(poll, 3000); return; }
      try {
        const result = await api(`${base}/ai-runs`);
        if (stopped) return;
        const signature = JSON.stringify(result.runs || []);
        setAiRuns(result.runs || []); setAiError("");
        if (previous !== null && previous !== signature) {
          const [detail, collaboration] = await Promise.all([api(`${base}/detail`), api(`${base}/collaboration`)]);
          if (!stopped) {
            setData(current => current ? { ...current, ...detail, collaboration } : current);
            const earlier = JSON.parse(previous);
            if ((result.runs || []).some(run => ["completed", "failed", "cancelled"].includes(run.status) && !earlier.some(old => old.id === run.id && old.status === run.status))) await onChanged?.();
          }
        }
        previous = signature;
      } catch (err) {
        if (!stopped) setAiError(err.message);
        if ([401, 403, 404].includes(err.status)) return;
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [api, base]);
  async function retryAi(run) {
    if (pending.current || !canComment) return;
    pending.current = true; setBusy(true); setAiError("");
    try {
      const result = await api(`${base}/ai-runs/${encodeURIComponent(run.id)}/retry`, { method: "POST" });
      if (alive.current && result.run) setAiRuns(current => current.map(value => value.id === run.id ? result.run : value));
    } catch (err) { if (alive.current) setAiError(err.message); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  // Proposals change data only when the caller confirms them here.
  async function actOnProposal(run, action, verb) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(`${base}/ai-runs/${encodeURIComponent(run.id)}/actions/${encodeURIComponent(action.id)}/${verb}`, { method: "POST" });
      if (!alive.current) return;
      if (result.run) setAiRuns(current => current.map(value => value.id === run.id ? result.run : value));
      setNotice(verb === "apply" ? "Đã thực hiện đề xuất của trợ lý." : "Đã bỏ qua đề xuất.");
      if (verb === "apply") { setReload(value => value + 1); await onChanged?.(); }
    } catch (err) {
      if (!alive.current) return;
      setError(err.message);
      // Show the server's verdict (stale, failed or already handled).
      if ([400, 403, 409].includes(err.status)) await api(`${base}/ai-runs`).then(result => { if (alive.current) setAiRuns(result.runs || []); }).catch(() => {});
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  async function mutate(path, method, body, success, after, changedTask = false) {
    if (pending.current || !writable) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (isTaskMutation(path, method)) body = { expectedRevision: task.revision, ...body };
      const result = await api(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (result.taskRevision) setData(current => current ? { ...current, task: { ...current.task, revision: result.taskRevision } } : current);
    } catch (err) { if (alive.current) setError(err.message); pending.current = false; if (alive.current) setBusy(false); return; }
    if (!alive.current) return;
    after?.(); setNotice(success); setReload(value => value + 1);
    if (changedTask) { try { await onChanged?.(); } catch { if (alive.current) setNotice(`${success} Hãy làm mới để cập nhật danh sách liên quan.`); } }
    pending.current = false; if (alive.current) setBusy(false);
  }
  function saveScalar(field, value) {
    const draft = scalarDrafts[field] || { revision: task.revision };
    setScalarDrafts(current => ({ ...current, [field]: { ...draft, value } }));
    return mutate(base, "PATCH", { [field]: value, expectedRevision: draft.revision }, "Đã cập nhật công việc.", () => setScalarDrafts(current => { const next = { ...current }; delete next[field]; return next; }), true);
  }
  async function upload(event) {
    event.preventDefault();
    if (pending.current || !writable || !uploadFile || !data.uploadPolicy?.enabled) return;
    const limit = data.uploadPolicy.maxFileSizeMb * 1024 * 1024;
    if (!uploadFile.size || uploadFile.size > limit) { setError(`Chọn tệp có dữ liệu, tối đa ${data.uploadPolicy.maxFileSizeMb} MB.`); return; }
    pending.current = true; setBusy(true); setUploading(true); setError(""); setNotice("");
    const controller = new AbortController(); uploadAbort.current = controller;
    try {
      await api(`${base}/files`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(uploadFile.name) }, body: uploadFile, signal: controller.signal });
      if (alive.current) {
        setUploadFile(null); if (uploadInput.current) uploadInput.current.value = "";
        setNotice("Đã tải lên tệp đính kèm."); setReload(value => value + 1);
      }
    } catch (err) { if (alive.current) setError(err.message); }
    finally { pending.current = false; uploadAbort.current = null; if (alive.current) { setBusy(false); setUploading(false); } }
  }
  function selectCommentFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (commentFiles.length + files.length > 10) { setCommentError("Mỗi bình luận được đính kèm tối đa 10 tệp."); return; }
    const max = data.uploadPolicy?.maxFileSizeMb || 0;
    if (files.some(file => !file.size || file.size > max * 1024 * 1024)) {
      setCommentError(`Chọn tệp có dữ liệu, tối đa ${max} MB mỗi tệp.`); return;
    }
    setCommentFiles(current => [...current, ...files.map(file => ({ key: crypto.randomUUID(), file, uploaded: null }))]);
    setCommentError("");
  }
  async function sendComment(event) {
    event.preventDefault();
    if (pending.current || !canComment || (!comment.trim() && !commentFiles.length)) return;
    if (commentFiles.some(item => !item.uploaded) && !data.uploadPolicy?.enabled) {
      setCommentError("Tải tệp đang được tắt. Bỏ tệp chưa tải để gửi bình luận bằng văn bản."); return;
    }
    pending.current = true; setBusy(true); setCommentError(""); setNotice("");
    const controller = new AbortController(); uploadAbort.current = controller;
    let hasUploaded = false;
    try {
      const attachmentIds = [];
      for (const [index, item] of commentFiles.entries()) {
        let uploaded = item.uploaded;
        if (!uploaded) {
          setCommentSending(`Đang tải tệp ${index + 1}/${commentFiles.length}…`);
          const result = await api(`${base}/files`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(item.file.name) }, body: item.file, signal: controller.signal });
          uploaded = result.attachment; hasUploaded = true;
          if (alive.current) setCommentFiles(current => current.map(value => value.key === item.key ? { ...value, uploaded } : value));
        }
        attachmentIds.push(uploaded.id);
      }
      setCommentSending("Đang gửi bình luận…");
      const payload = { body: comment.trim(), attachmentIds, ...(data.collaboration ? { mentionIds } : {}) };
      const fingerprint = JSON.stringify(payload);
      if (commentOperation.current?.fingerprint !== fingerprint) commentOperation.current = { fingerprint, operationId: crypto.randomUUID() };
      const result = await api(`${base}/comments`, { method: "POST", body: JSON.stringify({ ...payload, operationId: commentOperation.current.operationId }), signal: controller.signal });
      commentOperation.current = null;
      if (alive.current && result.aiRun) setAiRuns(current => [...current.filter(run => run.id !== result.aiRun.id), result.aiRun]);
      if (alive.current) { setComment(""); setCommentFiles([]); setMentionIds([]); mentionRef.current = null; setMention(null); setNotice("Đã gửi bình luận."); setReload(value => value + 1); }
    } catch (err) {
      if (alive.current) {
        setCommentError(err.message);
        if (hasUploaded) setReload(value => value + 1);
      }
    } finally {
      pending.current = false; uploadAbort.current = null;
      if (alive.current) { setBusy(false); setCommentSending(""); }
    }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(location.href); setNotice("Đã sao chép liên kết công việc."); }
    catch { setError("Chưa sao chép được. Bạn có thể sao chép đường dẫn trên thanh địa chỉ."); }
  }
  const assignee = task?.assigneeName || members.find(member => member.id === task?.assigneeId)?.name;
  const customer = task?.customerName || customers.find(value => value.id === task?.customerId)?.name;
  const checklists = data?.checklists || [], attachments = data?.attachments || [], comments = data?.comments || [], activity = data?.activity || [];
  const assistant = assistantMention(data?.aiConfig?.assistant);
  const mentionMembers = [...(assistant ? [assistant] : []), ...(data?.collaboration?.members || [])];
  const mentionOpen = Boolean(mention && mentionMembers.length && canComment);
  const mentionMatches = mentionOpen ? filterMentionMembers(mentionMembers, mention.query) : [];
  const activeMention = mentionMatches.length ? Math.min(mentionIndex, mentionMatches.length - 1) : 0;
  const mentionLabel = task?.teamName ? `Thành viên team ${task.teamName}` : "Thành viên việc chung của doanh nghiệp";
  function updateMention(value, cursor) {
    if (pickingMention.current) return;
    if (commentRef.current && document.activeElement !== commentRef.current) return;
    const token = mentionToken(value, cursor);
    const previous = mentionRef.current;
    if ((token?.start ?? null) === (previous?.start ?? null) && (token?.query ?? null) === (previous?.query ?? null)) return;
    mentionRef.current = token;
    setMentionIndex(0);
    setMention(token);
  }
  function closeMention() {
    if (!mentionRef.current && !mention) return;
    mentionRef.current = null;
    setMention(null);
  }
  function pickMention(member) {
    const el = commentRef.current;
    const token = mentionRef.current;
    if (!el || !member || !token) return;
    const insert = `@${member.assistant ? member.handle : member.name} `;
    const tokenEnd = token.start + 1 + token.query.length;
    const caret = Math.max(el.selectionStart, el.selectionEnd);
    const replaceEnd = caret >= token.start && caret <= tokenEnd ? caret : tokenEnd;
    const next = el.value.slice(0, token.start) + insert + el.value.slice(replaceEnd);
    if (next.length > 5000) return;
    const pos = token.start + insert.length;
    pickingMention.current = true;
    setComment(next);
    if (!member.assistant) setMentionIds(ids => ids.includes(member.id) ? ids : [...ids, member.id]);
    closeMention();
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      mentionRef.current = null;
      setMention(null);
      setTimeout(() => { pickingMention.current = false; }, 0);
    });
  }
  function onCommentKeyDown(event) {
    if (!mentionOpen) return;
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (composing && !["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    if (event.key === "Escape") { event.preventDefault(); closeMention(); return; }
    if (!mentionMatches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMentionIndex(index => (Math.min(index, mentionMatches.length - 1) + 1) % mentionMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex(index => (Math.min(index, mentionMatches.length - 1) + mentionMatches.length - 1) % mentionMatches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pickMention(mentionMatches[activeMention]);
    }
  }
  function onCommentKeyUp(event) {
    if (["Escape", "Enter", "Tab"].includes(event.key)) return;
    if (mentionOpen && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;
    updateMention(event.currentTarget.value, event.currentTarget.selectionStart);
  }
  useEffect(() => { activeMentionRef.current?.scrollIntoView({ block: "nearest" }); }, [activeMention, mention?.query, mentionOpen]);
  return <section className="task-detail-page">
    {!task ? (
      <div className="td-empty-wrap">
        <button type="button" className="td-back" onClick={() => onBack(task)}>
          <ArrowLeft size={16} />
          <span>Quay lại bảng công việc</span>
        </button>
        <div className="td-panel td-state" role={error ? "alert" : "status"}>
          {loading ? "Đang tải công việc…" : <>
            <h2>Chưa mở được công việc</h2>
            <p>{error || "Công việc không tồn tại hoặc bạn không còn quyền truy cập."}</p>
            <button className="button secondary" onClick={() => setReload(v => v + 1)}><RefreshCw size={16} />Thử lại</button>
          </>}
        </div>
      </div>
    ) : (
      <>
        <header className="td-heading">
          <div className="td-heading-nav">
            <button type="button" className="td-back" onClick={() => onBack(task)}>
              <ArrowLeft size={15} />
              <span>Quay lại bảng công việc</span>
            </button>
            <span className="td-heading-sep">/</span>
            <span className="td-heading-crumb">{task.teamName || "Việc chung của doanh nghiệp"}</span>
            <div className="td-heading-actions">
              <ActionMenu label="Thao tác chi tiết công việc" disabled={busy} items={[
                { label: "Chỉnh sửa thông tin", icon: Pencil, disabled, onSelect: () => onEdit(task) },
                { label: "Sao chép liên kết", icon: Copy, onSelect: copyLink },
                data.collaboration && { label: data.collaboration.watching ? "Bỏ theo dõi công việc" : "Theo dõi công việc", icon: Bell, disabled, onSelect: () => mutate(`${base}/watch`, "PUT", { watching: !data.collaboration.watching }, "Đã cập nhật theo dõi.") },
                { label: "Làm mới", icon: RefreshCw, disabled: loading, onSelect: () => setReload(v => v + 1) },
                { label: "Chuyển vào thùng rác", icon: Trash2, danger: true, disabled, onSelect: () => onTrash(task) },
              ]} />
            </div>
          </div>
          <div className="td-heading-content">
            <div className="td-title-icon"><CheckCheck size={18} /></div>
            <div className="td-title">
              <div className="td-title-row">
                <h1>{task.title}</h1>
                <div className="td-badges">
                  <span className={`status status-${task.status}`}><i />{statuses[task.status]}</span>
                  {task.category && <span className="td-category">{task.category}</span>}
                  {task.teamArchived && <span className="td-category">Team đã lưu trữ</span>}
                </div>
              </div>
            </div>
          </div>
        </header>
        {!data.canWrite && <p className="td-readonly"><ShieldCheck size={17} />Công việc hiện chỉ được xem. Kiểm tra trạng thái team hoặc quyền sử dụng không gian để tiếp tục chỉnh sửa.</p>}
        {error && <div className="td-error" role="alert">{error}{loadError && <button type="button" onClick={() => setReload(v => v + 1)}>Tải lại công việc</button>}</div>}
        {notice && <p className="td-notice" role="status">{notice}</p>}
        {remove && <section className="td-confirm" ref={removeRef} tabIndex={-1} role="region" aria-label="Xác nhận xóa"><strong>Xóa “{remove.title}”?</strong><p>Thao tác này không thể hoàn tác.</p><div><button type="button" className="button secondary" disabled={busy} onClick={() => setRemove(null)}>Hủy</button><button type="button" className="button td-danger" disabled={disabled} onClick={() => mutate(remove.path, "DELETE", undefined, "Đã xóa mục.", () => setRemove(null))}>Xác nhận xóa</button></div></section>}
        <div className="td-layout">
          <div className="td-main">
            <section className="td-panel td-properties" aria-label="Thông tin công việc">
              <label><span>Trạng thái</span><select aria-label="Trạng thái công việc" value={scalarDrafts.status?.value ?? task.status} disabled={disabled} onChange={e => saveScalar("status", e.target.value)}>{Object.entries(statuses).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
              <label><span>Độ ưu tiên</span><select aria-label="Độ ưu tiên công việc" value={scalarDrafts.priority?.value ?? task.priority} disabled={disabled} onChange={e => saveScalar("priority", e.target.value)}>{Object.entries(priorities).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
              {Object.entries(scalarDrafts).map(([field, draft]) => <div key={field}><button type="button" className="button secondary" disabled={disabled} onClick={() => saveScalar(field, draft.value)}>Thử lưu {field === 'status' ? 'trạng thái' : 'ưu tiên'}</button><button type="button" className="button secondary" disabled={busy} onClick={() => setScalarDrafts(current => { const next = { ...current }; delete next[field]; return next; })}>Bỏ thay đổi {field === 'status' ? 'trạng thái' : 'ưu tiên'}</button></div>)}
              <div><span><UserRound size={14} />Người phụ trách</span><strong>{assignee || "Chưa giao"}</strong></div>
              <div><span><CalendarDays size={14} />Ngày bắt đầu chung</span><strong>{date(task.startAt)}</strong></div>
              <div><span><CalendarDays size={14} />Hạn hoàn thành</span><strong>{date(task.dueAt)}</strong></div>
              <div><span><Bell size={14} />Lịch nhắc</span><strong>{date(task.remindAt)}</strong></div>
              <div><span><Repeat2 size={14} />Lặp lại</span><strong>{recurrenceLabel(task.recurrence, task.recurrenceOptions)}</strong></div>
              {customer && <div className="td-customer"><span>Khách hàng liên quan</span><strong>{customer}</strong></div>}
            </section>
            <section className="td-panel"><div className="td-section-heading"><h2><Pencil size={17} />Mô tả</h2>{description === null && writable && <button type="button" className="td-text-button" disabled={busy} onClick={() => { descriptionRevision.current = task.revision; setDescription(task.description || ""); }}>Chỉnh sửa</button>}</div>
              {description !== null ? <form onSubmit={e => { e.preventDefault(); mutate(base, "PATCH", { description, expectedRevision: descriptionRevision.current }, "Đã lưu mô tả.", () => setDescription(null), true); }}><textarea aria-label="Mô tả công việc" value={description} maxLength={5000} rows={6} disabled={disabled} onChange={e => setDescription(e.target.value)} /><div className="td-form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setDescription(null)}>Hủy</button><button className="button" disabled={disabled}>Lưu mô tả</button></div></form> : <p className={`td-description ${!task.description ? "td-muted" : ""}`}>{task.description || "Chưa có mô tả. Thêm hướng dẫn để mọi người cùng nắm rõ công việc."}</p>}
            </section>
            <TaskTime key={taskId+":time"} api={api} task={task} readOnly={!writable||busy} userId={me?.user?.id}/>
            <TaskExtras key={taskId+":extras"} api={api} task={task} readOnly={!writable || busy} canManageLabels={["owner", "admin"].includes(me?.user?.role)} refreshToken={`${revision}:${reload}`} onChanged={async () => { setReload(value => value + 1); await onChanged?.(); }} />
            <TaskReminders key={taskId+":reminders"} api={api} task={task} readOnly={!writable} revision={reload} onChanged={()=>setReload(v=>v+1)} />
            <TaskChecklists base={base} taskRevision={task.revision} checklists={checklists} members={data.checklistMembers || []} writable={writable} disabled={disabled} mutate={mutate} />
            <section className="td-panel"><div className="td-section-heading"><h2><Link2 size={18} />Tệp & liên kết đính kèm<span className="td-count">{attachments.length}</span></h2></div>
              {!attachments.length && <p className="td-empty">Tải tài liệu, bản thiết kế hoặc gắn liên kết dùng chung cho công việc.</p>}
              <div className="td-attachments">{attachments.map(item => <article key={item.id}><div className="td-attachment-icon">{item.kind === "file" ? <FileText size={20} /> : <Link2 size={20} />}</div><div>{item.kind === "file" ? <a href={`/api${base}/attachments/${encodeURIComponent(item.id)}/download`} download={item.originalName || item.title}>{item.originalName || item.title}<Download size={14} /></a> : safeUrl(item.url) ? <a href={safeUrl(item.url)} target="_blank" rel="noopener noreferrer">{item.title}<ExternalLink size={13} /></a> : <strong>{item.title}</strong>}<small>{item.kind === "file" && `${fileSize(item.sizeBytes || 0)} · `}{item.createdByName || "Thành viên"} · {date(item.createdAt)}</small></div><ActionMenu label={`Thao tác đính kèm ${item.title}`} disabled={disabled} items={[{ label: item.kind === "file" ? "Xóa tệp" : "Gỡ liên kết", icon: Trash2, danger: true, onSelect: () => setRemove({ path: `${base}/attachments/${encodeURIComponent(item.id)}`, title: item.title, kind: "attachment" }) }]} /></article>)}</div>
              {writable && <div className="td-file-upload">
                {data.uploadPolicy?.enabled ? <form onSubmit={upload}><label className="td-file-label"><span><Upload size={16} />Tải tệp từ thiết bị</span><input ref={uploadInput} type="file" aria-label="Chọn tệp đính kèm" disabled={disabled} onChange={e => { setUploadFile(e.target.files?.[0] || null); setError(""); }} /></label><small>Tối đa {data.uploadPolicy.maxFileSizeMb} MB mỗi tệp.</small>{uploadFile && <p>{uploadFile.name} · {fileSize(uploadFile.size)}</p>}<button className="button secondary" disabled={disabled || !uploadFile}><Upload size={15} />{uploading ? "Đang tải lên…" : "Tải tệp lên"}</button></form> : <p className="td-empty">{data.uploadPolicy?.error || "Tải tệp đang được tắt. Liên hệ quản trị viên SaaS để bật lưu trữ."}</p>}
              </div>}
              {writable && <form className="td-attachment-form" onSubmit={e => { e.preventDefault(); if (!safeUrl(attachment.url)) { setError("Liên kết cần bắt đầu bằng http:// hoặc https://."); return; } mutate(`${base}/attachments`, "POST", attachment, "Đã thêm liên kết.", () => setAttachment({ title: "", url: "" })); }}><input aria-label="Tên liên kết" placeholder="Tên tài liệu" required maxLength={200} disabled={disabled} value={attachment.title} onChange={e => setAttachment({ ...attachment, title: e.target.value })} /><input aria-label="Địa chỉ liên kết" placeholder="https://…" type="url" required maxLength={2000} disabled={disabled} value={attachment.url} onChange={e => setAttachment({ ...attachment, url: e.target.value })} /><button className="button secondary" disabled={disabled || !attachment.title.trim() || !attachment.url.trim()}><Plus size={15} />Thêm liên kết</button></form>}
            </section>
          </div>
          <aside className="td-discussion">
            <section className="td-panel"><div className="td-section-heading"><h2><MessageSquare size={18} />Bình luận<span className="td-count">{comments.length}</span></h2></div>
              {canComment && <form className="td-comment-form" onSubmit={sendComment}>
                {commentError && <p className="td-comment-error" role="alert">{commentError}</p>}
                <div className="td-mention-field">
                  <textarea ref={commentRef} aria-label="Bình luận công việc" placeholder="Trao đổi, cập nhật tiến độ với cả team…" rows={3} maxLength={5000} required={!commentFiles.length} value={comment} disabled={commentDisabled} aria-autocomplete="list" aria-expanded={mentionOpen} aria-controls={mentionOpen ? mentionListId : undefined} aria-activedescendant={mentionOpen && mentionMatches[activeMention] ? `${mentionListId}-${mentionMatches[activeMention].id}` : undefined} onChange={e => { setComment(e.target.value); updateMention(e.target.value, e.target.selectionStart); }} onClick={e => updateMention(e.target.value, e.target.selectionStart)} onSelect={e => updateMention(e.target.value, e.target.selectionStart)} onKeyDown={onCommentKeyDown} onKeyUp={onCommentKeyUp} onBlur={e => { if (!e.relatedTarget?.closest?.(".td-mention-list")) closeMention(); }} />
                  {mentionOpen && <ul id={mentionListId} className="td-mention-list" role="listbox" aria-label={mentionLabel} onMouseDown={e => e.preventDefault()}>
                    <li className="td-mention-caption" role="presentation">Trợ lý và thành viên</li>
                    {mentionMatches.length ? mentionMatches.map((member, index) => <li key={member.id} role="presentation"><button type="button" role="option" id={`${mentionListId}-${member.id}`} aria-selected={index === activeMention} className={index === activeMention ? "is-active" : ""} ref={index === activeMention ? activeMentionRef : undefined} onMouseEnter={() => setMentionIndex(index)} onMouseDown={event => { event.preventDefault(); pickMention(member); }}><span className="td-avatar" aria-hidden="true">{member.assistant ? <Bot size={17} /> : initials(member.name)}</span><span><strong>{member.name}</strong>{member.email && <small>{member.email}</small>}</span></button></li>) : <li className="td-mention-empty" role="presentation">Không có thành viên phù hợp</li>}
                  </ul>}
                </div>
                {assistant && <small className="td-comment-hint">Gọi @{assistant.handle} để đọc ngữ cảnh và đề xuất thay đổi; dữ liệu chỉ đổi khi bạn bấm Thực hiện. Phản hồi được chia sẻ trong công việc này.</small>}
                {commentFiles.length > 0 && <ul className="td-comment-pending">{commentFiles.map(item => <li key={item.key}><FileText size={16} /><div><span>{item.file.name}</span><small>{fileSize(item.file.size)}{item.uploaded ? " · Đã tải lên" : " · Chờ gửi"}</small></div><button type="button" aria-label={`Bỏ ${item.file.name} khỏi bình luận`} disabled={commentDisabled} onClick={() => { setCommentFiles(current => current.filter(value => value.key !== item.key)); setCommentError(""); }}><X size={15} /></button></li>)}</ul>}
                {commentFiles.some(item => item.uploaded) && <small className="td-comment-hint">Tệp đã tải lên được giữ trong đính kèm của task. Bạn có thể thử gửi lại bình luận.</small>}
                {data.collaboration && mentionIds.length > 0 && <div className="td-mentions">{mentionIds.map(id => <button type="button" key={id} disabled={commentDisabled} onClick={() => setMentionIds(ids => ids.filter(v => v !== id))}>@{data.collaboration.members.find(m => m.id === id)?.name} ×</button>)}</div>}
                <div className="td-comment-toolbar">
                  {data.uploadPolicy?.enabled && <><input ref={commentFileInput} className="td-comment-file-input" type="file" multiple aria-label="Chọn tệp cho bình luận" disabled={commentDisabled} onChange={selectCommentFiles} /><button type="button" className="button secondary" disabled={commentDisabled || commentFiles.length >= 10} onClick={() => commentFileInput.current?.click()}><Paperclip size={15} />Đính kèm tệp</button></>}
                  <button className="button" disabled={commentDisabled || (!comment.trim() && !commentFiles.length)}><Send size={15} />{commentSending || "Gửi bình luận"}</button>
                </div>
                <small className="td-comment-hint">{data.uploadPolicy?.enabled ? `Tối đa ${data.uploadPolicy.maxFileSizeMb} MB/tệp · 10 tệp/bình luận. Tệp được tải lên khi gửi.` : (data.uploadPolicy?.error || "Admin đã tắt tải tệp. Bạn vẫn có thể gửi bình luận văn bản.")}</small>
              </form>}
              {!comments.length && <p className="td-empty">Chưa có trao đổi nào. Cùng cập nhật để công việc luôn rõ ràng.</p>}
              {aiError && <p className="td-comment-error" role="alert">Chưa cập nhật được trạng thái trợ lý: {aiError}</p>}
              {aiRuns.length > 0 && <ul className="td-ai-runs" aria-label="Yêu cầu trợ lý" aria-live="polite">{aiRuns.map(run => <li key={run.id}><a href={`#comment-${run.commentId}`}>{data.aiConfig?.assistant?.name || "Trợ lý AI"}</a><span>{({ queued: "Đang chờ", reading: "Đang đọc ngữ cảnh", executing: "Đang thực hiện", completed: "Hoàn tất", failed: "Có lỗi", cancelled: "Đã dừng" })[run.status] || run.status}</span>{run.error && <small>{run.error}</small>}{run.status !== "completed" && <AiEvidence sources={run.sources} actions={run.actions} onOpenTask={onOpenTask} run={run} members={members} onAct={actOnProposal} busy={busy} />}{run.canRetry && <button className="button secondary" type="button" disabled={commentDisabled} onClick={() => retryAi(run)}>Thử lại</button>}</li>)}</ul>}
              <div className="td-comments">{comments.map(item => <article key={item.id} id={`comment-${item.id}`} className={item.authorType === "assistant" ? "td-ai-comment" : undefined}><span className="td-avatar">{item.authorType === "assistant" ? <Bot size={18} /> : initials(item.authorName)}</span><div><strong>{item.authorName || "Thành viên"}</strong>{item.authorType === "assistant" && <span className="td-ai-badge">AI</span>}<time dateTime={item.createdAt}>{date(item.createdAt)}</time>{item.replyToCommentId && <a className="td-ai-reply" href={`#comment-${item.replyToCommentId}`}>Trả lời bình luận gốc</a>}{item.body && (item.authorType === "assistant" ? <AssistantMarkdown content={item.body} references={taskReferences(item.sources)} onOpenTask={onOpenTask} selectedTaskId={taskId} /> : <p>{item.body}</p>)}
                {(() => { const run = item.aiRunId && aiRuns.find(value => value.id === item.aiRunId); return <AiEvidence sources={item.sources} actions={run?.actions?.length ? run.actions : item.actions} onOpenTask={onOpenTask} run={run} members={members} onAct={actOnProposal} busy={busy} />; })()}{item.attachments?.length > 0 && <ul className="td-comment-attachments">{item.attachments.map(file => <li key={file.id}><a href={`/api${base}/attachments/${encodeURIComponent(file.id)}/download`} download={file.originalName || file.title}><FileText size={16} /><span>{file.originalName || file.title}<small>{fileSize(file.sizeBytes || 0)}</small></span><Download size={14} /></a></li>)}</ul>}<CommentActions item={item} meta={data.collaboration?.comments.find(c => c.id === item.id)} api={api} base={base} disabled={commentDisabled} onChanged={() => setReload(v => v + 1)} /></div></article>)}</div>
            </section>
            <section className="td-panel"><div className="td-section-heading"><h2><Activity size={18} />Lịch sử công việc</h2></div>
              {!activity.length && <p className="td-empty">Các thao tác mới sẽ được ghi lại tại đây.</p>}
              <ol className="td-activity">{activity.map(item => <li key={item.id}><span className="td-activity-dot" /><div><p><strong>{item.actorName || "Thành viên"}</strong> {item.summary || item.action}</p><time dateTime={item.createdAt}>{date(item.createdAt)}</time></div></li>)}</ol>
              <div className="td-created">{task.createdByName && <span>Tạo bởi <strong>{task.createdByName}</strong></span>}{task.createdAt && <time dateTime={task.createdAt}>{date(task.createdAt)}</time>}</div>
            </section>
          </aside>
        </div>
      </>
    )}
  </section>;
}
