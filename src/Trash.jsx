import React, { useEffect, useId, useRef, useState } from "react";
import { Trash2, RotateCcw, Search, RefreshCw, Eye, X, ChevronLeft, ChevronRight, ShieldCheck, Inbox } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import "./trash.css";

const types = { task: "Công việc", customer: "Khách hàng", transaction: "Thu / chi" };
const date = value => value ? new Date(value).toLocaleString("vi-VN") : "Không rõ";
const paths = { task: "tasks", customer: "customers", transaction: "transactions" };
const fieldLabels = { title: "Tiêu đề", name: "Tên", description: "Mô tả", status: "Trạng thái", priority: "Ưu tiên", dueAt: "Hạn hoàn thành", remindAt: "Lịch nhắc", assigneeName: "Người phụ trách", customerName: "Khách hàng", teamName: "Team", category: "Danh mục", recurrence: "Lặp lại", email: "Email", phone: "Điện thoại", company: "Công ty", service: "Dịch vụ", amount: "Số tiền", date: "Ngày ghi nhận", type: "Loại giao dịch", createdAt: "Ngày tạo", updatedAt: "Cập nhật cuối" };
const values = { todo: "Cần làm", doing: "Đang làm", done: "Hoàn thành", low: "Thấp", medium: "Trung bình", high: "Cao", none: "Không lặp lại", daily: "Hàng ngày", weekly: "Hàng tuần", monthly: "Hàng tháng", income: "Thu", expense: "Chi" };
function detailValue(key, value) {
  if (value == null || value === "") return "Chưa có thông tin";
  if (key === "amount") return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(value);
  if (key.endsWith("At")) return date(value);
  return values[value] || String(value);
}

function TrashDialog({ title, busy, onClose, children }) {
  const ref = useRef(null), previous = useRef(null), latest = useRef({ busy, onClose });
  const id = useId();
  latest.current = { busy, onClose };
  useEffect(() => {
    previous.current = document.activeElement;
    ref.current?.querySelector("button:not(:disabled),input:not(:disabled)")?.focus();
    const keydown = event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (!latest.current.busy) latest.current.onClose(); }
      if (event.key !== "Tab") return;
      const nodes = [...(ref.current?.querySelectorAll("button:not(:disabled),input:not(:disabled),[tabindex='0']") || [])];
      if (!nodes.length) { event.preventDefault(); ref.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === nodes[0] || !ref.current.contains(document.activeElement))) { event.preventDefault(); nodes.at(-1).focus(); }
      else if (!event.shiftKey && (document.activeElement === nodes.at(-1) || !ref.current.contains(document.activeElement))) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); if (previous.current?.isConnected) previous.current.focus(); };
  }, []);
  return <div className="trash-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="trash-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} aria-busy={busy}>
      <header><div><span className="eyebrow">THÙNG RÁC CẤP 2</span><h2 id={id}>{title}</h2></div><button type="button" className="icon-button" aria-label="Đóng hộp thoại thùng rác" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}

export function MoveToTrashDialog({ target, api, onClose, onMoved }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  async function submit() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      await api(`/${paths[target.entityType]}/${encodeURIComponent(target.item.id)}`, { method: "DELETE" });
    } catch (err) { setError(err.message); pending.current = false; setBusy(false); return; }
    pending.current = false; setBusy(false); onMoved();
  }
  return <TrashDialog title="Chuyển vào thùng rác?" busy={busy} onClose={onClose}>
    <div className="trash-dialog-body"><p><strong>{target.item.title || target.item.name}</strong></p><p>Mục này sẽ được ẩn khỏi danh sách đang sử dụng. Bạn có thể khôi phục từ Thùng rác cấp 2.</p>{target.entityType === "task" && <p>Lời nhắc của công việc sẽ tạm dừng khi ở trong thùng rác.</p>}{error && <p className="trash-error" role="alert">{error}</p>}</div>
    <footer><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Hủy</button><button className="button trash-danger" type="button" disabled={busy} onClick={submit}><Trash2 size={16} />{busy ? "Đang chuyển…" : "Chuyển vào thùng rác"}</button></footer>
  </TrashDialog>;
}

export default function Trash({ api, me, onChanged }) {
  const [type, setType] = useState("all"), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState([]), [dialog, setDialog] = useState(null), [confirmation, setConfirmation] = useState(""), [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const pending = useRef(false), detailRequest = useRef(0);
  const manager = ["owner", "admin"].includes(me?.user?.role);
  const readOnly = Boolean(me?.workspace?.suspendedAt || ["expired", "canceled"].includes(me?.subscription?.status) || (me?.subscription?.currentPeriodEnd && new Date(me.subscription.currentPeriodEnd) <= new Date()));
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    let canceled = false; setLoading(true); setError(""); setSelected([]);
    api(`/trash?${new URLSearchParams({ type, q: query, page: String(page) })}`).then(result => {
      if (canceled) return;
      if (page > 1 && !result.items.length) { setPage(Math.max(1, Math.ceil(result.total / (result.pageSize || 20)))); return; }
      setData(result);
    }).catch(err => { if (!canceled) { setError(err.message); setData(null); } }).finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [api, type, query, page, revision]);
  const items = data?.items || [], summary = data?.summary || {}, stale = loading || search.trim() !== query;
  const selectedItems = items.filter(item => selected.includes(item.id));
  // The server validates dependencies for the whole selection (e.g. customer + task).
  const canRestoreSelected = selectedItems.length > 0;
  function closeDialog() { if (pending.current) return; detailRequest.current++; setDialog(null); setDialogError(""); setConfirmation(""); }
  function confirmPurge(rows) { setDialog({ kind: "purge", items: rows }); setConfirmation(""); setDialogError(""); }
  async function showDetail(item) {
    const request = ++detailRequest.current;
    setDialog({ kind: "detail", item, loading: true }); setDialogError("");
    try { const result = await api(`/trash/${encodeURIComponent(item.id)}`); if (request === detailRequest.current) setDialog({ kind: "detail", item: result.item, loading: false }); }
    catch (err) { if (request === detailRequest.current) { setDialogError(err.message); setDialog({ kind: "detail", item, loading: false }); } }
  }
  async function mutate(action, rows) {
    if (pending.current || readOnly || !rows.length) return;
    pending.current = true; setBusy(true); setError(""); setDialogError(""); setNotice("");
    try {
      await api(`/trash/${action}`, { method: "POST", body: JSON.stringify({ ids: rows.map(item => item.id), ...(action === "purge" ? { confirmation } : {}) }) });
    } catch (err) { if (dialog) setDialogError(err.message); else setError(err.message); pending.current = false; setBusy(false); return; }
    setNotice(action === "restore" ? `Đã khôi phục ${rows.length} mục.` : `Đã xóa vĩnh viễn ${rows.length} mục.`);
    pending.current = false; setBusy(false); closeDialog(); setSelected([]); setRevision(value => value + 1);
    try { await onChanged?.(); } catch { setNotice("Thao tác đã lưu. Hãy làm mới không gian làm việc để cập nhật các danh sách liên quan."); }
  }
  return <section className="trash-page">
    <div className="trash-heading"><div><span className="eyebrow">KHÔNG GIAN LÀM VIỆC</span><h1><Trash2 size={28} />Thùng rác cấp 2</h1><p>Khôi phục những gì đã xóa. Chỉ xóa vĩnh viễn khi bạn chắc chắn không cần nữa.</p></div>
      <ActionMenu label="Thao tác thùng rác" disabled={busy} items={[
        { label: "Làm mới", icon: RefreshCw, onSelect: () => setRevision(value => value + 1), disabled: loading },
        { label: "Dọn các mục trên trang này", icon: Trash2, danger: true, disabled: readOnly || stale || !items.length, onSelect: () => confirmPurge(items) },
      ]} />
    </div>
    <div className="trash-note"><ShieldCheck size={18} /><p>{manager ? "Bạn đang quản lý thùng rác của doanh nghiệp này." : "Bạn chỉ thấy công việc do mình xóa và còn quyền truy cập."} Dữ liệu được giữ lại cho đến khi xóa vĩnh viễn.</p></div>
    {readOnly && <p className="trash-error" role="status">Không gian hiện ở chế độ chỉ xem. Cần khôi phục quyền sử dụng trước khi thao tác với thùng rác.</p>}
    <div className="trash-filters"><div className="trash-types" role="group" aria-label="Lọc loại dữ liệu">{["all", "task", ...(manager ? ["customer", "transaction"] : [])].map(value => <button type="button" key={value} className={type === value ? "active" : ""} aria-pressed={type === value} disabled={busy} onClick={() => { setType(value); setPage(1); setSelected([]); }}>{value === "all" ? "Tất cả" : types[value]}<span>{summary[value === "all" ? "total" : value] || 0}</span></button>)}</div>
      <label className="trash-search"><Search size={17} /><input aria-label="Tìm trong thùng rác" placeholder="Tìm tên mục đã xóa…" value={search} maxLength={120} disabled={busy} onChange={event => { setSearch(event.target.value); setSelected([]); }} /></label>
    </div>
    {notice && <p role="status" className="trash-success">{notice}</p>}
    {error && <div className="trash-error" role="alert">{error}<button type="button" className="text-button" onClick={() => setRevision(value => value + 1)} disabled={busy}>Thử lại</button></div>}
    <div className="trash-panel" aria-busy={loading || busy}>
      <div className="trash-selection"><label><input type="checkbox" aria-label="Chọn tất cả mục trên trang" disabled={stale || busy || readOnly || !items.length} checked={items.length > 0 && selectedItems.length === items.length} onChange={event => setSelected(event.target.checked ? items.map(item => item.id) : [])} /><span>{selectedItems.length ? `Đã chọn ${selectedItems.length} mục` : "Chọn các mục trên trang"}</span></label>
        {selectedItems.length > 0 && <div className="trash-selection-actions"><button className="button" type="button" disabled={busy || stale || readOnly || !canRestoreSelected} onClick={() => mutate("restore", selectedItems)}><RotateCcw size={15} />Khôi phục ({selectedItems.length})</button><ActionMenu label="Thao tác các mục đã chọn" disabled={busy || stale || readOnly} items={[{ label: "Xóa vĩnh viễn các mục đã chọn", icon: Trash2, danger: true, onSelect: () => confirmPurge(selectedItems) }]} /></div>}
      </div>
      {loading ? <div className="trash-empty" role="status">Đang tải thùng rác…</div> : !items.length ? <div className="trash-empty"><Inbox size={38} /><h2>{query || type !== "all" ? "Không tìm thấy mục phù hợp" : "Thùng rác đang trống"}</h2><p>Các mục bạn chuyển vào thùng rác sẽ xuất hiện tại đây.</p></div> : <div className="trash-items">{items.map(item => <article className="trash-row" key={item.id}>
        <input type="checkbox" aria-label={`Chọn ${item.title}`} disabled={busy || stale || readOnly} checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
        <span className={`trash-item-icon type-${item.entityType}`}><Trash2 size={19} /></span>
        <div className="trash-item-main"><button type="button" onClick={() => showDetail(item)} disabled={busy}>{item.title}</button><span>{types[item.entityType] || "Dữ liệu"}</span>{item.canRestore === false && <small>{item.restoreBlockedReason || "Chưa thể khôi phục mục này."}</small>}</div>
        <div className="trash-item-meta"><span>{item.deletedByName || "Không rõ người xóa"}</span><time dateTime={item.deletedAt}>{date(item.deletedAt)}</time></div>
        <ActionMenu label={`Thao tác mục đã xóa ${item.title}`} disabled={busy || stale} items={[
          { label: "Xem chi tiết", icon: Eye, onSelect: () => showDetail(item) },
          { label: "Khôi phục", icon: RotateCcw, disabled: readOnly || item.canRestore === false, onSelect: () => mutate("restore", [item]) },
          { label: "Xóa vĩnh viễn", icon: Trash2, danger: true, disabled: readOnly, onSelect: () => confirmPurge([item]) },
        ]} />
      </article>)}</div>}
      <footer className="trash-pagination"><span>{data?.total || 0} mục · Trang {page}/{Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 20)))}</span><div><button type="button" className="icon-button" aria-label="Trang thùng rác trước" disabled={page <= 1 || loading || busy} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} /></button><button type="button" className="icon-button" aria-label="Trang thùng rác sau" disabled={page * (data?.pageSize || 20) >= (data?.total || 0) || loading || busy} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} /></button></div></footer>
    </div>
    {dialog && <TrashDialog title={dialog.kind === "purge" ? `Xóa vĩnh viễn ${dialog.items.length} mục?` : "Chi tiết mục đã xóa"} busy={busy} onClose={closeDialog}>
      <div className="trash-dialog-body">{dialog.kind === "purge" ? <><p>Các mục bên dưới sẽ bị xóa vĩnh viễn và <strong>không thể khôi phục</strong>.</p><ul className="trash-confirm-list">{dialog.items.map(item => <li key={item.id}>{item.title}<span>{types[item.entityType]}</span></li>)}</ul><label className="trash-confirm-label">Nhập <strong>XOA VINH VIEN</strong> để xác nhận<input aria-label="Nhập XOA VINH VIEN để xác nhận" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label></> : <><h3>{dialog.item.title}</h3><p>{types[dialog.item.entityType]} · Xóa lúc {date(dialog.item.deletedAt)}</p><p>Người xóa: {dialog.item.deletedByName || "Không rõ"}</p>{dialog.loading ? <p role="status">Đang tải chi tiết…</p> : <dl className="trash-detail-fields">{Object.entries(dialog.item.details || {}).filter(([key, value]) => fieldLabels[key] && (value == null || typeof value !== "object")).map(([key, value]) => <div key={key}><dt>{fieldLabels[key]}</dt><dd>{detailValue(key, value)}</dd></div>)}</dl>}{dialog.item.canRestore === false && <p className="trash-error">{dialog.item.restoreBlockedReason}</p>}</>}{dialogError && <p className="trash-error" role="alert">{dialogError}</p>}</div>
      <footer><button type="button" className="button secondary" disabled={busy} onClick={closeDialog}>{dialog.kind === "purge" ? "Hủy" : "Đóng"}</button>{dialog.kind === "purge" ? <button type="button" className="button trash-danger" disabled={busy || readOnly || confirmation !== "XOA VINH VIEN"} onClick={() => mutate("purge", dialog.items)}><Trash2 size={16} />{busy ? "Đang xóa…" : "Xóa vĩnh viễn"}</button> : <button type="button" className="button" disabled={busy || readOnly || dialog.loading || !!dialogError || dialog.item.canRestore === false} onClick={() => mutate("restore", [dialog.item])}><RotateCcw size={16} />{busy ? "Đang khôi phục…" : "Khôi phục"}</button>}</footer>
    </TrashDialog>}
  </section>;
}
