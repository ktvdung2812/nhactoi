import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Ban,
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  Pencil,
  ReceiptText,
  RefreshCw,
  X,
} from "lucide-react";

// Mirrors PUT /api/billing/profile validation so most mistakes are caught
// before the request; the server stays the source of truth.
const TAX_CODE = /^\d{10}(-\d{3})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROFILE_FIELDS = [
  { key: "companyName", label: "Tên công ty / đơn vị", max: 200, autoComplete: "organization", placeholder: "Công ty TNHH Nhắc Tôi" },
  { key: "taxCode", label: "Mã số thuế", max: 20, autoComplete: "off", placeholder: "0312345678 hoặc 0312345678-001" },
  { key: "address", label: "Địa chỉ", max: 300, autoComplete: "street-address", placeholder: "Số nhà, đường, phường/xã, tỉnh/thành phố" },
  { key: "email", label: "Email nhận hóa đơn", max: 320, autoComplete: "email", placeholder: "ketoan@congty.vn", type: "email" },
];

const ORDER_STATUS = {
  pending: ["Chờ thanh toán", "is-pending"],
  partially_paid: ["Thanh toán một phần", "is-partial"],
  paid: ["Đã thanh toán", "is-paid"],
  failed: ["Thất bại", "is-failed"],
  canceled: ["Đã hủy", "is-closed"],
  expired: ["Hết hạn", "is-closed"],
  refunded: ["Đã hoàn tiền", "is-refunded"],
};
const OPEN_STATUSES = new Set(["pending", "partially_paid"]);

export const taxRateOf = (billing) => {
  const rate = Number(billing?.taxRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
};
export const percentLabel = (rate) =>
  Number(rate || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
export const priceWithVat = (price, rate) =>
  (Number(price) || 0) + Math.round(((Number(price) || 0) * rate) / 100);

function normalizeProfile(input) {
  const value = input || {};
  return {
    companyName: String(value.companyName || "").trim(),
    taxCode: String(value.taxCode || "").replace(/\s+/g, ""),
    address: String(value.address || "").trim(),
    email: String(value.email || "").trim(),
  };
}

function validateProfile(v) {
  const errors = {};
  if (v.companyName.length > 200)
    errors.companyName = "Tên công ty / đơn vị tối đa 200 ký tự.";
  if (v.taxCode && !TAX_CODE.test(v.taxCode))
    errors.taxCode = "Mã số thuế gồm 10 hoặc 13 số (dạng 0312345678-001).";
  if (v.address.length > 300) errors.address = "Địa chỉ tối đa 300 ký tự.";
  if (v.email && (v.email.length > 320 || !EMAIL.test(v.email)))
    errors.email = "Email nhận hóa đơn không hợp lệ.";
  return errors;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default function BillingProfile({ api, billing, setBilling, notify, canEdit }) {
  const profile = normalizeProfile(billing?.profile);
  const saved = Boolean(billing?.profileSaved);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const firstInput = useRef(null);
  const editButton = useRef(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) firstInput.current?.focus();
    else if (wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function startEdit() {
    setDraft(profile);
    setErrors({});
    setEditing(true);
  }
  function cancelEdit() {
    if (saving) return;
    setErrors({});
    setEditing(false);
  }
  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const next = normalizeProfile(draft);
    const found = validateProfile(next);
    setErrors(found);
    const firstInvalid = PROFILE_FIELDS.find((f) => found[f.key]);
    if (firstInvalid) {
      document.getElementById(`billing-profile-${firstInvalid.key}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const result = await api("/billing/profile", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setBilling((current) =>
        current
          ? { ...current, profile: result?.profile || next, profileSaved: result?.profileSaved ?? true }
          : current,
      );
      setEditing(false);
      notify("Đã lưu thông tin xuất hóa đơn.");
    } catch (e) {
      notify(e.message, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel billing-profile" aria-labelledby="billing-profile-title">
      <div className="panel-head">
        <div>
          <h2 id="billing-profile-title">
            <ReceiptText size={18} aria-hidden="true" /> Thông tin xuất hóa đơn
          </h2>
          <p>
            Thông tin này được gửi sang VC Billing khi tạo hóa đơn mới; hóa
            đơn đã tạo không thay đổi.
          </p>
        </div>
        {canEdit && !editing && (
          <button
            type="button"
            ref={editButton}
            className="button secondary billing-profile-edit"
            onClick={startEdit}
          >
            <Pencil size={15} aria-hidden="true" />
            {saved ? "Chỉnh sửa" : "Bổ sung thông tin"}
          </button>
        )}
      </div>
      {!saved && !editing && (
        <p className="billing-profile-prompt" role="note">
          <AlertCircle size={15} aria-hidden="true" />
          {canEdit
            ? "Bạn chưa xác nhận thông tin xuất hóa đơn. Hệ thống đang gợi ý từ thông tin không gian; hãy kiểm tra và lưu để hóa đơn ghi đúng đơn vị. Bạn vẫn có thể chọn gói ngay."
            : "Chủ không gian chưa xác nhận thông tin xuất hóa đơn. Hóa đơn đang dùng thông tin gợi ý từ không gian."}
        </p>
      )}
      {editing ? (
        <form
          className="billing-profile-form"
          noValidate
          onSubmit={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelEdit();
            }
          }}
          aria-busy={saving}
        >
          <div className="billing-profile-fields">
            {PROFILE_FIELDS.map((f, index) => {
              const id = `billing-profile-${f.key}`;
              const error = errors[f.key];
              return (
                <label key={f.key} className="field" htmlFor={id}>
                  <span>{f.label}</span>
                  <input
                    id={id}
                    ref={index === 0 ? firstInput : undefined}
                    type={f.type || "text"}
                    value={draft[f.key]}
                    maxLength={f.max}
                    autoComplete={f.autoComplete}
                    placeholder={f.placeholder}
                    readOnly={saving}
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDraft((d) => ({ ...d, [f.key]: value }));
                      if (error) setErrors(({ [f.key]: _, ...rest }) => rest);
                    }}
                  />
                  {error && (
                    <small id={`${id}-error`} className="billing-profile-error" role="alert">
                      {error}
                    </small>
                  )}
                </label>
              );
            })}
          </div>
          <div className="billing-profile-actions">
            <button
              type="button"
              className="button secondary"
              onClick={cancelEdit}
              disabled={saving}
            >
              <X size={16} aria-hidden="true" /> Hủy
            </button>
            <button type="submit" className="button" disabled={saving}>
              {saving ? (
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
              ) : (
                <Check size={16} aria-hidden="true" />
              )}
              {saving ? "Đang lưu…" : "Lưu thông tin"}
            </button>
          </div>
        </form>
      ) : (
        <dl className="billing-profile-summary">
          {PROFILE_FIELDS.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd className={profile[f.key] ? undefined : "is-empty"}>
                {profile[f.key] || "Chưa cập nhật"}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function OrderRow({ order: o, planName, isOwner, busy, onRefresh, onCancel, notify, money, dateLabel }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const [label, tone] = ORDER_STATUS[o.status] || [o.status || "Không rõ", "is-closed"];
  const open = OPEN_STATUSES.has(o.status);
  const amountPaid = Number(o.amountPaid) || 0;
  const taxAmount = Number(o.taxAmount) || 0;
  const checkoutUrl = open && o.checkoutUrl ? safeHttpUrl(o.checkoutUrl) : null;
  const canCancel = isOwner && o.status === "pending" && amountPaid === 0;
  const fullDate = { day: "2-digit", month: "2-digit", year: "numeric" };

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(o.paymentCode);
      setCopied(true);
      notify(`Đã sao chép mã thanh toán ${o.paymentCode}.`);
    } catch {
      notify("Chưa sao chép được mã. Hãy chọn mã và sao chép thủ công.", true);
    }
  }

  return (
    <li className="order-row">
      <div className="order-main">
        <strong>
          {planName} · {o.cycle === "yearly" ? "Năm" : "Tháng"}
        </strong>
        <span className="order-meta">
          {o.createdAt && `Tạo ${dateLabel(o.createdAt, fullDate)}`}
          {o.paidAt && ` · Thanh toán ${dateLabel(o.paidAt, fullDate)}`}
        </span>
        {o.paymentCode && (
          <span className="payment-code" title="Nội dung chuyển khoản ngân hàng">
            Mã TT: <code>{o.paymentCode}</code>
            <button
              type="button"
              onClick={copyCode}
              aria-label={`Sao chép mã thanh toán ${o.paymentCode}`}
              title="Sao chép mã thanh toán"
            >
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            </button>
          </span>
        )}
      </div>
      <div className="order-amount">
        <strong>{money(o.amount)}</strong>
        {taxAmount > 0 && <small>gồm VAT {percentLabel(o.taxRate)}%</small>}
        {o.status === "partially_paid" && (
          <small className="order-received">
            Đã nhận {money(amountPaid)} / {money(o.amount)}
          </small>
        )}
      </div>
      <span className={`order-status ${tone}`}>{label}</span>
      {(checkoutUrl || (isOwner && open)) && (
        <div className="order-actions">
          {checkoutUrl && (
            <a href={checkoutUrl} target="_blank" rel="noreferrer">
              Thanh toán <ExternalLink size={13} aria-hidden="true" />
              <span className="sr-only"> (mở tab mới)</span>
            </a>
          )}
          {isOwner && open && (
            <button type="button" className="text-button" disabled={busy} onClick={() => onRefresh(o)}>
              <RefreshCw size={14} aria-hidden="true" /> Kiểm tra thanh toán
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              className="text-button order-cancel"
              disabled={busy}
              onClick={() => onCancel(o)}
            >
              <Ban size={14} aria-hidden="true" /> Hủy hóa đơn
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function BillingOrders({ api, billing, setBilling, action, notify, busy, isOwner, money, dateLabel }) {
  const orders = billing?.orders || [];
  if (orders.length === 0) return null;
  const planNames = new Map((billing.plans || []).map((p) => [p.id, p.name]));
  const hasOpen = orders.some((o) => OPEN_STATUSES.has(o.status));

  async function reload() {
    try {
      setBilling(await api("/billing"));
    } catch (e) {
      notify(`Chưa tải lại được lịch sử thuê bao: ${e.message}`, true);
    }
  }
  async function refresh(o) {
    const result = await action(
      () => api(`/billing/orders/${o.id}/refresh`, { method: "POST" }),
      "Đã kiểm tra trạng thái hóa đơn",
    );
    if (result) await reload();
  }
  async function cancel(o) {
    if (
      !window.confirm(
        `Hủy hóa đơn ${money(o.amount)}${o.paymentCode ? ` (mã ${o.paymentCode})` : ""}? Đường dẫn thanh toán của hóa đơn này sẽ không còn dùng được.`,
      )
    )
      return;
    const result = await action(
      () => api(`/billing/orders/${o.id}/cancel`, { method: "POST" }),
      "Đã hủy hóa đơn",
    );
    if (result) await reload();
  }

  return (
    <section className="panel billing-orders" aria-labelledby="billing-orders-title">
      <div className="panel-head">
        <div>
          <h2 id="billing-orders-title">Lịch sử thuê bao</h2>
          {hasOpen && (
            <p>
              Thanh toán được xác nhận tự động sau vài phút. Nếu đã chuyển
              khoản mà chưa cập nhật, bấm “Kiểm tra thanh toán”.
            </p>
          )}
        </div>
      </div>
      <ul className="order-list">
        {orders.map((o) => (
          <OrderRow
            key={o.id}
            order={o}
            planName={planNames.get(o.plan) || o.plan}
            isOwner={isOwner}
            busy={busy}
            onRefresh={refresh}
            onCancel={cancel}
            notify={notify}
            money={money}
            dateLabel={dateLabel}
          />
        ))}
      </ul>
    </section>
  );
}
