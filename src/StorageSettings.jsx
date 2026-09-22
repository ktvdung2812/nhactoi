import React, { useEffect, useRef, useState } from "react";
import { HardDrive, Pencil, Save, X, ShieldCheck, RefreshCw } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";

export default function StorageSettings({ api }) {
  const [data, setData] = useState(null), [draft, setDraft] = useState(null), [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const pending = useRef(false), input = useRef(null), trigger = useRef(null);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    api("/admin/storage").then(value => { if (active) setData(value); }).catch(err => { if (active) { setError(err.message); setData(null); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, revision]);
  useEffect(() => { if (draft) input.current?.focus(); }, [Boolean(draft)]);
  function close() { if (pending.current) return; setDraft(null); setReason(""); setError(""); trigger.current?.focus(); }
  async function save(event) {
    event.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/admin/storage", { method: "PATCH", body: JSON.stringify({ enabled: draft.enabled, maxFileSizeMb: Number(draft.maxFileSizeMb), localPath: draft.localPath.trim(), reason: reason.trim() }) });
      setData(result); setDraft(null); setReason(""); setNotice("Đã lưu nơi lưu tệp và ghi nhật ký quản trị."); trigger.current?.focus();
    } catch (err) { setError(err.message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className={`panel settings-card ${draft ? "is-editing" : ""}`}>
    <div className="settings-card-heading"><span className="settings-card-icon"><HardDrive size={21} /></span><div><h2>Lưu trữ tệp đính kèm</h2><p>Quản lý nơi lưu và dung lượng tệp tải lên trong công việc.</p></div><ActionMenu label="Thao tác lưu trữ tệp" disabled={busy} items={[
      { label: "Chỉnh sửa", icon: Pencil, disabled: loading || !data || Boolean(draft), onSelect: element => { trigger.current = element; setDraft({ ...data }); setError(""); setNotice(""); } },
      { label: "Làm mới", icon: RefreshCw, disabled: loading || Boolean(draft), onSelect: () => setRevision(v => v + 1) },
    ]} /></div>
    {loading ? <div className="settings-summary" role="status">Đang tải cấu hình lưu trữ…</div> : draft ? <form className="settings-editor" onSubmit={save}><fieldset disabled={busy}>
      <label className="settings-check"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Cho phép tải tệp đính kèm</label>
      <label className="field"><span>Thư mục lưu trên máy chủ <em>*</em></span><input ref={input} value={draft.localPath} onChange={e => setDraft({ ...draft, localPath: e.target.value })} required maxLength={1000} placeholder="/duong-dan/kho-tep-rieng" /><small>Dùng đường dẫn tuyệt đối tới thư mục riêng, không công khai qua web. Máy chủ cần quyền ghi vào thư mục này.</small></label>
      <label className="field"><span>Dung lượng tối đa mỗi tệp (MB) <em>*</em></span><input type="number" min={1} max={50} step={1} required value={draft.maxFileSizeMb} onChange={e => setDraft({ ...draft, maxFileSizeMb: e.target.value })} /></label>
      <p className="settings-storage-hint">Thay đổi thư mục chỉ áp dụng cho tệp mới. Tệp cũ tiếp tục được tải xuống từ nơi đã lưu; không di chuyển hoặc xóa thư mục cũ khi còn sử dụng.</p>
      <label className="field settings-reason"><span>Lý do thay đổi <em>*</em></span><textarea rows={2} required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      </fieldset>{error && <p className="settings-error" role="alert">{error}</p>}<div className="settings-actions"><small><ShieldCheck size={14} />Thay đổi được lưu nhật ký.</small><button type="button" className="button secondary" disabled={busy} onClick={close}><X size={15} />Hủy</button><button className="button" disabled={busy}><Save size={15} />{busy ? "Đang lưu…" : "Lưu thay đổi"}</button></div></form> : <div className="settings-summary">
      {data && <div className="settings-values"><div><span>Tải tệp</span><strong>{data.enabled ? "Đang bật" : "Đang tắt"}</strong></div><div><span>Nơi lưu</span><strong>Máy chủ · thư mục riêng</strong></div><div><span>Thư mục</span><strong>{data.localPath}</strong></div><div><span>Tối đa mỗi tệp</span><strong>{data.maxFileSizeMb} MB</strong></div></div>}
      {error && <p className="settings-error" role="alert">{error}<button type="button" onClick={() => setRevision(v => v + 1)}>Thử lại</button></p>}
      {notice && <p role="status" className="settings-storage-hint">{notice}</p>}
    </div>}
  </section>;
}
