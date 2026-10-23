import React, { useRef, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Check, CreditCard, LoaderCircle, Pencil, Plus, Save, Search, ShieldCheck, Users, X } from "lucide-react";
import ActionMenu from "./ActionMenu.jsx";
import useModalFocus from "./useModalFocus.js";
import "./admin-settings.css";
import "./admin-plans.css";

const money = (value) => new Intl.NumberFormat("vi-VN").format(value) + " ₫";
const seatFeature = /^Tối đa\s+\d[\d,.]*\s+thành viên$/i;
const fold = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
function Field({ label, ...props }) {
  return <label className="field"><span>{label}</span><input {...props} /></label>;
}

export default function AdminPlans({ data, api, onSaved }) {
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [reordering, setReordering] = useState(false);
  const dialogRef = useRef(null);
  const trigger = useRef(null);
  const plans = data.plans || [];
  const visible = plans.filter((plan) =>
    fold(`${plan.name} ${plan.id}`).includes(fold(query.trim())) &&
    (!status || (status === "active") === plan.active));
  function open(plan, element) {
    trigger.current = element;
    setError("");
    setEditing(plan);
  }
  function close() {
    if (saving) return;
    setEditing(null);
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  }
  useModalFocus({ open: Boolean(editing), dialogRef, onClose: close, disabled: saving });
  async function submit(event) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    const body = {
      id: editing.id || f.id.trim(), name: f.name.trim(),
      monthly: Number(f.monthly), yearly: Number(f.yearly), seats: Number(f.seats),
      features: f.features.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      active: f.active === "on", reason: f.reason.trim(),
    };
    setSaving(true);
    setError("");
    try {
      const result = await api(`/admin/plans${editing.id ? `/${editing.id}` : ""}`, {
        method: editing.id ? "PATCH" : "POST", body: JSON.stringify(body),
      });
      onSaved(result);
      close();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  const canReorder = !query.trim() && !status && !editing;
  async function movePlan(id, direction) {
    const ids = plans.map((plan) => plan.id);
    const index = ids.indexOf(id);
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    setReordering(true);
    setError("");
    try {
      const result = await api("/admin/plans/reorder", {
        method: "POST",
        body: JSON.stringify({ ids, reason: "Thay đổi thứ tự hiển thị gói thuê bao" }),
      });
      onSaved(result);
    } catch (e) { setError(e.message); }
    finally { setReordering(false); }
  }
  return <div className="plan-catalog">
    <section className="panel plans-intro">
      <span className="settings-card-icon"><CreditCard size={23} /></span>
      <div><h2>Gói phù hợp cho mỗi đội ngũ</h2><p>{plans.length} gói · {plans.filter((p) => p.active).length} đang bán. Giá mới áp dụng cho hóa đơn tạo mới.{canReorder ? " Dùng menu trên từng thẻ để đổi thứ tự; trang thanh toán dùng cùng thứ tự." : ""}</p></div>
      <button className="button primary" disabled={!!editing} onClick={(e) => open({ active: true }, e.currentTarget)}><Plus size={17} /> Thêm gói</button>
    </section>
    {editing && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section ref={dialogRef} className="modal plan-editor-modal" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title" tabIndex={-1}>
        <div className="modal-heading">
          <div>
            <h2 id="plan-editor-title">{editing.id ? `Chỉnh sửa ${editing.name}` : "Thêm gói thuê bao"}</h2>
            <p className="plan-editor-lead">Ngừng bán sẽ ẩn gói khỏi trang đăng ký và chặn hóa đơn mới. Thuê bao và hóa đơn đã có được giữ nguyên.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Đóng" disabled={saving} onClick={close}><X size={20} /></button>
        </div>
        <form className="modal-form-grid" onSubmit={submit} key={editing.id || "new"}>
          <fieldset disabled={saving}>
            <div className="settings-fields">
              <Field label="Mã gói" name="id" defaultValue={editing.id || ""} disabled={!!editing.id} required maxLength={20} pattern="[a-z]([a-z0-9_]|-)*" title="Bắt đầu bằng chữ thường; chỉ dùng chữ thường, số, dấu gạch ngang hoặc gạch dưới." placeholder="vd: enterprise" />
              <Field label="Tên gói" name="name" defaultValue={editing.name || ""} required maxLength={80} placeholder="vd: Enterprise" />
              <Field label="Giá tháng (VND)" name="monthly" type="number" min={1} max={1000000000} step={1} defaultValue={editing.monthly || ""} required />
              <Field label="Giá năm (VND · tổng 12 tháng)" name="yearly" type="number" min={1} max={1000000000} step={1} defaultValue={editing.yearly || ""} required />
              <Field label="Số thành viên tối đa" name="seats" type="number" min={1} max={1000000} step={1} defaultValue={editing.seats || 1} required />
            </div>
            <label className="field"><span>Quyền lợi hiển thị</span><textarea name="features" rows={4} maxLength={6030} defaultValue={(editing.features || []).filter((f) => !seatFeature.test(f)).join("\n")} placeholder={"Quản lý công việc và nhắc lịch\nCộng tác cùng đội ngũ"} /><small>Mỗi dòng một quyền lợi, tối đa 30 dòng và 200 ký tự/dòng. Giới hạn thành viên được hiển thị tự động. Nội dung này không thay đổi phân quyền tính năng.</small></label>
            <label className="settings-check"><input type="checkbox" name="active" defaultChecked={editing.active} /> Đang bán — cho phép tạo hóa đơn mới</label>
            <label className="field"><span>Lý do thay đổi *</span><textarea name="reason" required minLength={3} maxLength={500} rows={2} placeholder="Ghi lý do để tra cứu trong nhật ký quản trị…" /></label>
          </fieldset>
          {error && <div className="settings-error" role="alert"><AlertCircle size={17} />{error}</div>}
          <div className="modal-actions">
            <small><ShieldCheck size={15} /> Thay đổi được ghi nhật ký quản trị.</small>
            <button className="button secondary" type="button" disabled={saving} onClick={close}>Hủy</button>
            <button className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? "Đang lưu…" : editing.id ? "Lưu thay đổi" : "Tạo gói"}</button>
          </div>
        </form>
      </section>
    </div>}
    {error && !editing && <div className="settings-error" role="alert"><AlertCircle size={17} />{error}</div>}
    <div className="plans-toolbar"><label className="plans-search"><Search size={17} /><input aria-label="Tìm gói thuê bao" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên hoặc mã gói…" /></label><select aria-label="Trạng thái bán" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tất cả trạng thái</option><option value="active">Đang bán</option><option value="inactive">Ngừng bán</option></select></div>
    {!canReorder && (query.trim() || status) && <p className="settings-help">Xóa bộ lọc để sắp xếp thứ tự hiển thị gói.</p>}
    <div className="admin-plan-grid">
      {visible.map((plan) => {
        const index = plans.findIndex((item) => item.id === plan.id);
        return <article className="panel plan-catalog-card" key={plan.id}>
        <header><span className={`admin-badge badge-${plan.active ? "active" : "canceled"}`}><i />{plan.active ? "Đang bán" : "Ngừng bán"}</span><ActionMenu label={`Thao tác gói ${plan.name}`} items={[
          { label: "Chỉnh sửa gói", icon: Pencil, disabled: !!editing || reordering, onSelect: (element) => open(plan, element) },
          ...(canReorder ? [
            { label: "Hiển thị trước", icon: ArrowUp, disabled: reordering || index <= 0, onSelect: () => void movePlan(plan.id, -1) },
            { label: "Hiển thị sau", icon: ArrowDown, disabled: reordering || index >= plans.length - 1, onSelect: () => void movePlan(plan.id, 1) },
          ] : []),
        ]} /></header>
        <h2>{plan.name}</h2><small className="plan-code">{plan.id}</small>
        <div className="admin-plan-price"><strong>{money(plan.monthly)}</strong><span>/ tháng</span></div>
        <p className="admin-plan-year">{money(plan.yearly)} / năm</p>
        <div className="admin-plan-seats"><Users size={17} /> Tối đa {plan.seats.toLocaleString("vi-VN")} thành viên</div>
        <ul>{plan.features.filter((f) => !seatFeature.test(f)).map((feature, index) => <li key={index}><Check size={16} /><span>{feature}</span></li>)}</ul>
        <footer>{plan.subscriptionCount.toLocaleString("vi-VN")} doanh nghiệp đang gắn với gói</footer>
      </article>;
      })}
    </div>
    {!visible.length && <div className="panel admin-state"><Search size={28} /><p>Không tìm thấy gói phù hợp.</p></div>}
    <p className="settings-help">Giới hạn mới phải đủ cho thành viên và lời mời còn hiệu lực. Gói ngừng bán vẫn được giữ để đối chiếu thuê bao và hóa đơn cũ.</p>
  </div>;
}
