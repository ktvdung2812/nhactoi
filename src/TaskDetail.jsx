import TaskExtras from "./TaskExtras.jsx";
import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCheck, ListChecks, MessageSquare, Activity, Link2, Plus, Pencil, Trash2, Copy, RefreshCw, ExternalLink, CalendarDays, UserRound, Bell, Repeat2, Send, ShieldCheck, Upload, Download, FileText, Paperclip, X } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import CommentActions from "./CommentActions.jsx";
import "./task-detail.css";

const statuses = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành" };
const priorities = { low: "Thấp", medium: "Trung bình", high: "Cao" };
const repeats = { none: "Không lặp lại", daily: "Hàng ngày", weekly: "Hàng tuần", monthly: "Hàng tháng" };
const date = value => value ? new Date(value).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Chưa đặt";
const initials = value => (value || "?").trim().split(/\s+/).slice(-2).map(s => s[0]).join("").toUpperCase();
const fileSize = bytes => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
const safeUrl = value => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } };

export default function TaskDetail({ taskId, api, me, members = [], customers = [], onEdit, onTrash, onBack, onChanged, revision = 0 }) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [description, setDescription] = useState(null), [newChecklist, setNewChecklist] = useState("");
  const [itemDrafts, setItemDrafts] = useState({}), [rename, setRename] = useState(null), [remove, setRemove] = useState(null);
  const [attachment, setAttachment] = useState({ title: "", url: "" }), [comment, setComment] = useState("");
  const [mentionIds, setMentionIds] = useState([]);
  const [uploadFile, setUploadFile] = useState(null), [uploading, setUploading] = useState(false);
  const uploadInput = useRef(null), uploadAbort = useRef(null), commentFileInput = useRef(null);
  const [commentFiles, setCommentFiles] = useState([]), [commentSending, setCommentSending] = useState(""), [commentError, setCommentError] = useState("");
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
    Promise.all([api(`${base}/detail`), api(`${base}/upload-policy`).catch(err => ({ enabled: false, error: err.message })), api(`${base}/collaboration`).catch(() => null)]).then(([detail, uploadPolicy, collaboration]) => ({ ...detail, uploadPolicy, collaboration })).then(result => { if (alive.current && sequence.current === request) setData(result); })
      .catch(err => { if (alive.current && sequence.current === request) {
        setLoadError(true); setError(err.message);
        if ([401, 403, 404].includes(err.status)) {
          setData(null); setDescription(null); setNewChecklist(""); setItemDrafts({});
          setRename(null); setRemove(null); setAttachment({ title: "", url: "" }); setComment(""); setUploadFile(null); setCommentFiles([]); setMentionIds([]);
        }
      } })
      .finally(() => { if (alive.current && sequence.current === request) setLoading(false); });
  }, [api, base, revision, reload]);
  const task = data?.task;
  const writable = Boolean(data?.canWrite && !loadError && !loading && !me?.workspace?.suspendedAt);
  const disabled = !writable || busy;
  async function mutate(path, method, body, success, after, changedTask = false) {
    if (pending.current || !writable) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (err) { if (alive.current) setError(err.message); pending.current = false; if (alive.current) setBusy(false); return; }
    if (!alive.current) return;
    after?.(); setNotice(success); setReload(value => value + 1);
    if (changedTask) { try { await onChanged?.(); } catch { if (alive.current) setNotice(`${success} Hãy làm mới để cập nhật danh sách liên quan.`); } }
    pending.current = false; if (alive.current) setBusy(false);
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
    if (pending.current || !writable || (!comment.trim() && !commentFiles.length)) return;
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
      await api(`${base}/comments`, { method: "POST", body: JSON.stringify({ body: comment.trim(), attachmentIds, ...(data.collaboration ? { mentionIds } : {}) }), signal: controller.signal });
      if (alive.current) { setComment(""); setCommentFiles([]); setMentionIds([]); setNotice("Đã gửi bình luận."); setReload(value => value + 1); }
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
  const count = checklists.reduce((sum, list) => sum + list.items.length, 0);
  const complete = checklists.reduce((sum, list) => sum + list.items.filter(item => item.completed).length, 0);
  return <section className="task-detail-page">
    <button type="button" className="td-back" onClick={() => onBack(task)}><ArrowLeft size={17} />Quay lại bảng công việc</button>
    {!task ? <div className="td-panel td-state" role={error ? "alert" : "status"}>{loading ? "Đang tải công việc…" : <><h2>Chưa mở được công việc</h2><p>{error || "Công việc không tồn tại hoặc bạn không còn quyền truy cập."}</p><button className="button secondary" onClick={() => setReload(v => v + 1)}><RefreshCw size={16} />Thử lại</button></>}</div> : <>
      <header className="td-heading"><div className="td-title-icon"><CheckCheck size={25} /></div><div className="td-title"><p>{task.teamName || "Việc chung của doanh nghiệp"}<span> / Chi tiết công việc</span></p><h1>{task.title}</h1><div className="td-badges"><span className={`status status-${task.status}`}><i />{statuses[task.status]}</span>{task.category && <span className="td-category">{task.category}</span>}{task.teamArchived && <span className="td-category">Team đã lưu trữ</span>}</div></div><ActionMenu label="Thao tác chi tiết công việc" disabled={busy} items={[
        { label: "Chỉnh sửa thông tin", icon: Pencil, disabled, onSelect: () => onEdit(task) },
        { label: "Sao chép liên kết", icon: Copy, onSelect: copyLink },
        data.collaboration && { label: data.collaboration.watching ? "Bỏ theo dõi công việc" : "Theo dõi công việc", icon: Bell, disabled, onSelect: () => mutate(`${base}/watch`, "PUT", { watching: !data.collaboration.watching }, "Đã cập nhật theo dõi.") },
        { label: "Làm mới", icon: RefreshCw, disabled: loading, onSelect: () => setReload(v => v + 1) },
        { label: "Chuyển vào thùng rác", icon: Trash2, danger: true, disabled, onSelect: () => onTrash(task) },
      ]} /></header>
      {!data.canWrite && <p className="td-readonly"><ShieldCheck size={17} />Công việc hiện chỉ được xem. Kiểm tra trạng thái team hoặc quyền sử dụng không gian để tiếp tục chỉnh sửa.</p>}
      {error && <div className="td-error" role="alert">{error}{loadError && <button type="button" onClick={() => setReload(v => v + 1)}>Tải lại công việc</button>}</div>}
      {notice && <p className="td-notice" role="status">{notice}</p>}
      {rename?.path && <section className="td-panel td-rename-item"><form className="td-inline-form" onSubmit={e => { e.preventDefault(); mutate(rename.path, "PATCH", { title: rename.title }, "Đã đổi tên mục checklist.", () => setRename(null)); }}><input aria-label="Tên mục checklist mới" required autoFocus maxLength={240} value={rename.title} disabled={disabled} onChange={e => setRename({ ...rename, title: e.target.value })} /><button className="button" disabled={disabled || !rename.title.trim()}>Lưu tên mục</button><button type="button" className="button secondary" disabled={busy} onClick={() => setRename(null)}>Hủy</button></form></section>}
      {remove && <section className="td-confirm" ref={removeRef} tabIndex={-1} role="region" aria-label="Xác nhận xóa"><strong>Xóa “{remove.title}”?</strong><p>{remove.kind === "checklist" ? "Checklist và các mục bên trong sẽ bị xóa. " : ""}Thao tác này không thể hoàn tác.</p><div><button type="button" className="button secondary" disabled={busy} onClick={() => setRemove(null)}>Hủy</button><button type="button" className="button td-danger" disabled={disabled} onClick={() => mutate(remove.path, "DELETE", undefined, "Đã xóa mục.", () => setRemove(null))}>Xác nhận xóa</button></div></section>}
      <div className="td-layout">
        <div className="td-main">
          <section className="td-panel td-properties" aria-label="Thông tin công việc">
            <label><span>Trạng thái</span><select aria-label="Trạng thái công việc" value={task.status} disabled={disabled} onChange={e => mutate(base, "PATCH", { status: e.target.value }, "Đã cập nhật trạng thái.", undefined, true)}>{Object.entries(statuses).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <label><span>Độ ưu tiên</span><select aria-label="Độ ưu tiên công việc" value={task.priority} disabled={disabled} onChange={e => mutate(base, "PATCH", { priority: e.target.value }, "Đã cập nhật ưu tiên.", undefined, true)}>{Object.entries(priorities).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <div><span><UserRound size={14} />Người phụ trách</span><strong>{assignee || "Chưa giao"}</strong></div>
            <div><span><CalendarDays size={14} />Hạn hoàn thành</span><strong>{date(task.dueAt)}</strong></div>
            <div><span><Bell size={14} />Lịch nhắc</span><strong>{date(task.remindAt)}</strong></div>
            <div><span><Repeat2 size={14} />Lặp lại</span><strong>{repeats[task.recurrence] || "Không lặp lại"}</strong></div>
            {customer && <div className="td-customer"><span>Khách hàng liên quan</span><strong>{customer}</strong></div>}
          </section>
          <section className="td-panel"><div className="td-section-heading"><h2><Pencil size={17} />Mô tả</h2>{description === null && writable && <button type="button" className="td-text-button" disabled={busy} onClick={() => setDescription(task.description || "")}>Chỉnh sửa</button>}</div>
            {description !== null ? <form onSubmit={e => { e.preventDefault(); mutate(base, "PATCH", { description }, "Đã lưu mô tả.", () => setDescription(null), true); }}><textarea aria-label="Mô tả công việc" value={description} maxLength={5000} rows={6} disabled={disabled} onChange={e => setDescription(e.target.value)} /><div className="td-form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setDescription(null)}>Hủy</button><button className="button" disabled={disabled}>Lưu mô tả</button></div></form> : <p className={`td-description ${!task.description ? "td-muted" : ""}`}>{task.description || "Chưa có mô tả. Thêm hướng dẫn để mọi người cùng nắm rõ công việc."}</p>}
          </section>
          <section className="td-panel"><div className="td-section-heading"><h2><ListChecks size={18} />Checklist<span className="td-count">{complete}/{count}</span></h2></div>
            {!checklists.length && <p className="td-empty">Chia công việc thành những bước nhỏ để dễ theo dõi.</p>}
            <div className="td-checklists">{checklists.map(list => { const done = list.items.filter(item => item.completed).length, percent = list.items.length ? Math.round(done / list.items.length * 100) : 0; const listPath = `${base}/checklists/${encodeURIComponent(list.id)}`; return <section className="td-checklist" key={list.id}>
              <div className="td-checklist-heading">{rename?.id === list.id ? <form className="td-inline-form" onSubmit={e => { e.preventDefault(); mutate(listPath, "PATCH", { title: rename.title }, "Đã đổi tên checklist.", () => setRename(null)); }}><input aria-label="Tên checklist mới" autoFocus required maxLength={200} value={rename.title} disabled={disabled} onChange={e => setRename({ ...rename, title: e.target.value })} /><button className="button" disabled={disabled || !rename.title.trim()}>Lưu</button><button type="button" className="td-text-button" disabled={busy} onClick={() => setRename(null)}>Hủy</button></form> : <h3>{list.title}</h3>}<span>{done}/{list.items.length}</span><ActionMenu label={`Thao tác checklist ${list.title}`} disabled={disabled} items={[{ label: "Đổi tên", icon: Pencil, onSelect: () => setRename({ id: list.id, title: list.title }) }, { label: "Xóa checklist", icon: Trash2, danger: true, onSelect: () => setRemove({ path: listPath, title: list.title, kind: "checklist" }) }]} /></div>
              <div className="td-progress"><span>{percent}%</span><progress aria-label={`Tiến độ ${list.title}`} max={100} value={percent} /></div>
              {list.items.map(item => { const itemPath = `${listPath}/items/${encodeURIComponent(item.id)}`; return <div className={`td-check-item ${item.completed ? "is-done" : ""}`} key={item.id}><label><input type="checkbox" checked={Boolean(item.completed)} disabled={disabled} onChange={e => mutate(itemPath, "PATCH", { completed: e.target.checked }, e.target.checked ? "Đã hoàn thành mục checklist." : "Đã mở lại mục checklist.")} /><span>{item.title}</span></label><ActionMenu label={`Thao tác mục ${item.title}`} disabled={disabled} items={[{ label: "Đổi tên", icon: Pencil, onSelect: () => setRename({ id: item.id, title: item.title, path: itemPath }) }, { label: "Xóa mục", icon: Trash2, danger: true, onSelect: () => setRemove({ path: itemPath, title: item.title, kind: "item" }) }]} /></div>; })}
              {writable && <form className="td-inline-form td-add-item" onSubmit={e => { e.preventDefault(); mutate(`${listPath}/items`, "POST", { title: itemDrafts[list.id] || "" }, "Đã thêm mục checklist.", () => setItemDrafts(current => ({ ...current, [list.id]: "" }))); }}><input aria-label={`Mục mới trong ${list.title}`} placeholder="Thêm một việc nhỏ…" required maxLength={240} disabled={disabled} value={itemDrafts[list.id] || ""} onChange={e => setItemDrafts({ ...itemDrafts, [list.id]: e.target.value })} /><button className="button secondary" disabled={disabled || !itemDrafts[list.id]?.trim()}><Plus size={15} />Thêm</button></form>}
            </section>; })}</div>
            {writable && <form className="td-inline-form td-add-checklist" onSubmit={e => { e.preventDefault(); mutate(`${base}/checklists`, "POST", { title: newChecklist }, "Đã thêm checklist.", () => setNewChecklist("")); }}><input aria-label="Tên checklist" placeholder="Tên checklist, ví dụ: Chuẩn bị bàn giao" required maxLength={200} disabled={disabled} value={newChecklist} onChange={e => setNewChecklist(e.target.value)} /><button className="button secondary" disabled={disabled || !newChecklist.trim()}><Plus size={15} />Checklist</button></form>}
          </section>
          <details className="td-panel td-extras"><summary>Nhãn, người phối hợp và mẫu công việc</summary><TaskExtras key={`${taskId}/${revision}`} refreshToken={reload} api={api} task={task} members={members} readOnly={!writable} onChanged={async()=>{setReload(v=>v+1);await onChanged?.();}}/></details>
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
            {writable && <form className="td-comment-form" onSubmit={sendComment}>
              {commentError && <p className="td-comment-error" role="alert">{commentError}</p>}
              <textarea aria-label="Bình luận công việc" placeholder="Trao đổi, cập nhật tiến độ với cả team…" rows={3} maxLength={5000} required={!commentFiles.length} value={comment} disabled={disabled} onChange={e => setComment(e.target.value)} />
              {commentFiles.length > 0 && <ul className="td-comment-pending">{commentFiles.map(item => <li key={item.key}><FileText size={16} /><div><span>{item.file.name}</span><small>{fileSize(item.file.size)}{item.uploaded ? " · Đã tải lên" : " · Chờ gửi"}</small></div><button type="button" aria-label={`Bỏ ${item.file.name} khỏi bình luận`} disabled={disabled} onClick={() => { setCommentFiles(current => current.filter(value => value.key !== item.key)); setCommentError(""); }}><X size={15} /></button></li>)}</ul>}
              {commentFiles.some(item => item.uploaded) && <small className="td-comment-hint">Tệp đã tải lên được giữ trong đính kèm của task. Bạn có thể thử gửi lại bình luận.</small>}
              {data.collaboration && <><select className="td-mention-picker" aria-label="Nhắc tên thành viên" value="" disabled={disabled} onChange={e => { const member = data.collaboration.members.find(m => m.id === e.target.value); if (member && !mentionIds.includes(member.id)) { setMentionIds(ids => [...ids, member.id]); setComment(text => `${text}${text && !text.endsWith(" ") ? " " : ""}@${member.name} `); } }}><option value="">@ Nhắc tên thành viên…</option>{data.collaboration.members.filter(m => m.id !== me?.user?.id && !mentionIds.includes(m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><div className="td-mentions">{mentionIds.map(id => <button type="button" key={id} disabled={disabled} onClick={() => setMentionIds(ids => ids.filter(v => v !== id))}>@{data.collaboration.members.find(m => m.id === id)?.name} ×</button>)}</div></>}
              <div className="td-comment-toolbar">
                {data.uploadPolicy?.enabled && <><input ref={commentFileInput} className="td-comment-file-input" type="file" multiple aria-label="Chọn tệp cho bình luận" disabled={disabled} onChange={selectCommentFiles} /><button type="button" className="button secondary" disabled={disabled || commentFiles.length >= 10} onClick={() => commentFileInput.current?.click()}><Paperclip size={15} />Đính kèm tệp</button></>}
                <button className="button" disabled={disabled || (!comment.trim() && !commentFiles.length)}><Send size={15} />{commentSending || "Gửi bình luận"}</button>
              </div>
              <small className="td-comment-hint">{data.uploadPolicy?.enabled ? `Tối đa ${data.uploadPolicy.maxFileSizeMb} MB/tệp · 10 tệp/bình luận. Tệp được tải lên khi gửi.` : (data.uploadPolicy?.error || "Admin đã tắt tải tệp. Bạn vẫn có thể gửi bình luận văn bản.")}</small>
            </form>}
            {!comments.length && <p className="td-empty">Chưa có trao đổi nào. Cùng cập nhật để công việc luôn rõ ràng.</p>}
            <div className="td-comments">{comments.map(item => <article key={item.id}><span className="td-avatar">{initials(item.authorName)}</span><div><strong>{item.authorName || "Thành viên"}</strong><time dateTime={item.createdAt}>{date(item.createdAt)}</time>{item.body && <p>{item.body}</p>}{item.attachments?.length > 0 && <ul className="td-comment-attachments">{item.attachments.map(file => <li key={file.id}><a href={`/api${base}/attachments/${encodeURIComponent(file.id)}/download`} download={file.originalName || file.title}><FileText size={16} /><span>{file.originalName || file.title}<small>{fileSize(file.sizeBytes || 0)}</small></span><Download size={14} /></a></li>)}</ul>}<CommentActions item={item} meta={data.collaboration?.comments.find(c => c.id === item.id)} api={api} base={base} disabled={disabled} onChanged={() => setReload(v => v + 1)} /></div></article>)}</div>
          </section>
          <section className="td-panel"><div className="td-section-heading"><h2><Activity size={18} />Lịch sử công việc</h2></div>
            {!activity.length && <p className="td-empty">Các thao tác mới sẽ được ghi lại tại đây.</p>}
            <ol className="td-activity">{activity.map(item => <li key={item.id}><span className="td-activity-dot" /><div><p><strong>{item.actorName || "Thành viên"}</strong> {item.summary || item.action}</p><time dateTime={item.createdAt}>{date(item.createdAt)}</time></div></li>)}</ol>
            <div className="td-created">{task.createdByName && <span>Tạo bởi <strong>{task.createdByName}</strong></span>}{task.createdAt && <time dateTime={task.createdAt}>{date(task.createdAt)}</time>}</div>
          </section>
        </aside>
      </div>
    </>}
  </section>;
}
