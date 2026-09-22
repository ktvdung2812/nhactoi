import RemoteStorageSettings from "./RemoteStorageSettings.jsx";
import OperationsSettings from "./OperationsSettings.jsx";
import React, { useEffect, useRef, useState } from "react";
import {
  Globe,
  Receipt,
  Mail,
  CreditCard,
  Pencil,
  Save,
  X,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ArrowUpRight,
  LoaderCircle,
  Users,
} from "lucide-react";
import "./admin-settings.css";
import ActionMenu from "./ActionMenu.jsx";
import StorageSettings from "./StorageSettings.jsx";

const money = (value) =>
  new Intl.NumberFormat("vi-VN").format(value || 0) + " ₫";
function Field({ label, hint, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Secret({ name, label, configured, clearName }) {
  return (
    <div className="settings-secret">
      <Field
        label={label}
        name={name}
        type="password"
        autoComplete="new-password"
        maxLength={name === "password" ? 512 : 500}
        placeholder={
          configured ? "Đã lưu · để trống để giữ nguyên" : "Chưa thiết lập"
        }
      />
      <label className="settings-check">
        <input type="checkbox" name={clearName} /> Xóa {label.toLowerCase()} đã
        lưu
      </label>
    </div>
  );
}
function Connection({ ready }) {
  return (
    <span className={`admin-connection ${ready ? "ready" : ""}`}>
      {ready ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
      {ready ? "Đã cấu hình" : "Chưa cấu hình"}
    </span>
  );
}
export default function AdminSettings({ data, api, onSaved, openPreview }) {
  const [editing, setEditing] = useState(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const editor = useRef(null),
    trigger = useRef(null);
  useEffect(() => {
    if (editing) editor.current?.querySelector("input")?.focus();
  }, [editing]);
  function open(key, event) {
    trigger.current = event?.currentTarget || event || null;
    setError("");
    setEditing(key);
  }
  function close() {
    if (saving) return;
    setEditing(null);
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  }
  async function submit(event) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    const payload = { reason: f.reason.trim() };
    if (editing === "general") payload.publicAppUrl = f.publicAppUrl.trim();
    if (editing === "plans")
      payload.plans = data.plans.map((p) => ({
        id: p.id,
        name: f[`${p.id}.name`].trim(),
        monthly: Number(f[`${p.id}.monthly`]),
        yearly: Number(f[`${p.id}.yearly`]),
        seats: Number(f[`${p.id}.seats`]),
      }));
    if (editing === "billgateway") {
      payload.billgateway = {
        apiUrl: f.apiUrl.trim(),
        projectId: f.projectId.trim(),
      };
      if (f.apiKey) payload.billgateway.apiKey = f.apiKey;
      if (f.webhookSecret) payload.billgateway.webhookSecret = f.webhookSecret;
      if (f.clearApiKey) payload.billgateway.clearApiKey = true;
      if (f.clearWebhookSecret) payload.billgateway.clearWebhookSecret = true;
      if (
        (f.apiKey && f.clearApiKey) ||
        (f.webhookSecret && f.clearWebhookSecret)
      ) {
        setError("Chọn nhập khóa mới hoặc xóa khóa đã lưu cho mỗi trường.");
        return;
      }
    }
    if (editing === "smtp") {
      payload.smtp = {
        enabled: !!f.enabled,
        host: f.host.trim(),
        port: Number(f.port),
        secure: !!f.secure,
        user: f.user.trim(),
        from: f.from.trim(),
      };
      if (f.password) payload.smtp.password = f.password;
      if (f.clearPassword) payload.smtp.clearPassword = true;
      if (f.password && f.clearPassword) {
        setError("Chọn nhập mật khẩu mới hoặc xóa mật khẩu đã lưu.");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const result = await api("/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onSaved(result.settings || result);
      setEditing(null);
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const gateway = data.billgateway || {},
    smtp = data.smtp || {};
  function card(key, title, description, Icon, summary, form) {
    const active = editing === key;
    return (
      <section className={`panel settings-card ${active ? "is-editing" : ""}`}>
        <div className="settings-card-heading">
          <span className="settings-card-icon">
            <Icon size={21} />
          </span>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <ActionMenu
              label={`Thao tác với ${title.toLowerCase()}`}
              items={[
                {
                  label: "Chỉnh sửa",
                  icon: Pencil,
                  disabled: !!editing || saving,
                  onSelect: (triggerElement) => open(key, triggerElement),
                },
              ]}
          />
        </div>
        {active ? (
          <form ref={editor} onSubmit={submit} className="settings-editor">
            <fieldset disabled={saving}>
              {form}
              <label className="field settings-reason">
                <span>
                  Lý do thay đổi <em>*</em>
                </span>
                <textarea
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  rows={2}
                  placeholder="Ghi ngắn gọn lý do để dễ tra cứu sau này…"
                />
              </label>
            </fieldset>
            {error && (
              <div className="settings-error" role="alert">
                <AlertCircle size={17} />
                {error}
              </div>
            )}
            <div className="settings-actions">
              <small>
                <ShieldCheck size={14} /> Thay đổi được ghi vào nhật ký quản
                trị.
              </small>
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={close}
              >
                <X size={15} /> Hủy
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={saving}
              >
                {saving ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Save size={16} />
                )}
                {saving ? "Đang lưu…" : "Lưu thay đổi"}
              </button>
            </div>
          </form>
        ) : (
          <div className="settings-summary">{summary}</div>
        )}
      </section>
    );
  }
  return (
    <div className="admin-settings">
      <StorageSettings api={api} />
      <RemoteStorageSettings api={api}/>
      <OperationsSettings api={api}/>
      {card(
        "general",
        "Thông tin ứng dụng",
        "Địa chỉ dùng trong liên kết thanh toán và email nhắc việc.",
        Globe,
        <div className="settings-value">
          <span>Địa chỉ ứng dụng</span>
          <strong>{data.publicAppUrl || "Chưa cấu hình"}</strong>
        </div>,
        <Field
          label="Địa chỉ ứng dụng"
          name="publicAppUrl"
          maxLength={500}
          type="url"
          required
          defaultValue={data.publicAppUrl || ""}
          placeholder="https://nhactoi.vn"
          hint="Sử dụng địa chỉ đầy đủ. Tên miền và quyền truy cập CORS được quản lý riêng trên máy chủ."
        />,
      )}
      {card(
        "plans",
        "Gói dịch vụ",
        "Giá áp dụng cho hóa đơn mới. Hóa đơn đã tạo giữ nguyên số tiền.",
        CreditCard,
        <div className="settings-plan-grid">
          {(data.plans || []).map((p) => (
            <div className="settings-plan" key={p.id}>
              <span>{p.name}</span>
              <strong>
                {money(p.monthly)}
                <small>/ tháng</small>
              </strong>
              <p>{money(p.yearly)} / năm</p>
              <div>
                <Users size={15} /> Tối đa {p.seats} thành viên
              </div>
            </div>
          ))}
        </div>,
        <div className="settings-plan-edit">
          {(data.plans || []).map((p) => (
            <div key={p.id}>
              <h3>
                {p.name} <small>{p.id}</small>
              </h3>
              <div className="settings-fields">
                <Field
                  label="Tên gói"
                  name={`${p.id}.name`}
                  defaultValue={p.name}
                  required
                  maxLength={80}
                />
                <Field
                  label="Số thành viên tối đa"
                  name={`${p.id}.seats`}
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  defaultValue={p.seats}
                  required
                />
                <Field
                  label="Giá tháng (VND)"
                  name={`${p.id}.monthly`}
                  type="number"
                  min={1}
                  max={1000000000}
                  step={1}
                  defaultValue={p.monthly}
                  required
                />
                <Field
                  label="Giá năm (VND)"
                  name={`${p.id}.yearly`}
                  type="number"
                  min={1}
                  max={1000000000}
                  step={1}
                  defaultValue={p.yearly}
                  required
                />
              </div>
            </div>
          ))}
          <p className="settings-help">
            Giới hạn thành viên phải đủ cho các doanh nghiệp đang dùng gói, kể
            cả lời mời còn hiệu lực.
          </p>
        </div>,
      )}
      {card(
        "billgateway",
        "BillGateway",
        "Cổng thanh toán thuê bao tháng và năm.",
        Receipt,
        <>
          <Connection ready={data.billingConfigured} />
          <div className="settings-values">
            <div>
              <span>Địa chỉ API</span>
              <strong>{gateway.apiUrl || "Chưa thiết lập"}</strong>
            </div>
            <div>
              <span>Mã dự án</span>
              <strong>{gateway.projectId || "Chưa thiết lập"}</strong>
            </div>
            <div>
              <span>Khóa API / Webhook</span>
              <strong>
                {gateway.hasApiKey ? "Đã lưu khóa API" : "Chưa có khóa API"} ·{" "}
                {gateway.hasWebhookSecret
                  ? "Đã lưu khóa webhook"
                  : "Chưa có khóa webhook"}
              </strong>
            </div>
          </div>
        </>,
        <>
          <div className="settings-fields">
            <Field
              label="Địa chỉ API"
              name="apiUrl"
              maxLength={500}
              type="url"
              defaultValue={gateway.apiUrl || ""}
              placeholder="https://billgateway.example"
            />
            <Field
              label="Mã dự án"
              name="projectId"
              defaultValue={gateway.projectId || ""}
              maxLength={160}
            />
            <Secret
              label="Khóa API"
              name="apiKey"
              configured={gateway.hasApiKey}
              clearName="clearApiKey"
            />
            <Secret
              label="Khóa webhook"
              name="webhookSecret"
              configured={gateway.hasWebhookSecret}
              clearName="clearWebhookSecret"
            />
          </div>
          <p className="settings-help">
            Khóa đã lưu không được hiển thị lại. Để trống trường khóa để giữ
            nguyên kết nối hiện tại.
          </p>
        </>,
      )}
      {card(
        "smtp",
        "Email nhắc việc",
        "Thiết lập máy chủ gửi email cho các lời nhắc.",
        Mail,
        <>
          <Connection ready={data.smtpConfigured} />
          <div className="settings-values">
            <div>
              <span>Gửi email</span>
              <strong>{smtp.enabled ? "Đang bật" : "Đang tắt"}</strong>
            </div>
            <div>
              <span>Máy chủ SMTP</span>
              <strong>
                {smtp.host ? `${smtp.host}:${smtp.port}` : "Chưa thiết lập"}
              </strong>
            </div>
            <div>
              <span>Người gửi</span>
              <strong>{smtp.from || "Chưa thiết lập"}</strong>
            </div>
          </div>
        </>,
        <>
          <label className="settings-check settings-switch">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={smtp.enabled}
            />{" "}
            Bật gửi email nhắc việc
          </label>
          <div className="settings-fields">
            <Field
              label="Máy chủ SMTP"
              name="host"
              defaultValue={smtp.host || ""}
              maxLength={253}
              placeholder="smtp.example.com"
            />
            <Field
              label="Cổng SMTP"
              name="port"
              type="number"
              min={1}
              max={65535}
              step={1}
              defaultValue={smtp.port || 587}
              required
            />
            <Field
              label="Tên đăng nhập"
              name="user"
              defaultValue={smtp.user || ""}
              autoComplete="off"
              maxLength={320}
            />
            <Field
              label="Địa chỉ người gửi"
              name="from"
              defaultValue={smtp.from || ""}
              placeholder="Nhắc tôi <no-reply@example.com>"
              maxLength={320}
            />
            <Secret
              label="Mật khẩu SMTP"
              name="password"
              configured={smtp.hasPassword}
              clearName="clearPassword"
            />
            <label className="settings-check">
              <input
                name="secure"
                type="checkbox"
                defaultChecked={smtp.secure}
              />{" "}
              SSL/TLS trực tiếp (thường dùng cổng 465)
            </label>
          </div>
          <p className="settings-help">
            Trạng thái cấu hình chưa xác nhận kết nối thực tế với máy chủ email.
          </p>
        </>,
      )}
      <div className="admin-config-tip">
        <Sparkles size={22} />
        <div>
          <strong>Bộ trang lỗi Gen Z</strong>
          <p>
            Các trang lỗi 4xx / 5xx với minh họa chuyển động và hướng xử lý rõ
            ràng.
          </p>
          <button className="text-button" onClick={openPreview}>
            Xem bộ thiết kế <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
