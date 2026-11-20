import RemoteStorageSettings from "./RemoteStorageSettings.jsx";
import OperationsSettings from "./OperationsSettings.jsx";
import AiSettings from "./AiSettings.jsx";
import React, { useEffect, useRef, useState } from "react";
import {
  Globe,
  Receipt,
  Mail,
  Pencil,
  Save,
  X,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ArrowUpRight,
  LoaderCircle,
  Copy,
  Check,
  PlugZap,
  TriangleAlert,
} from "lucide-react";
import "./admin-settings.css";
import ActionMenu from "./ActionMenu.jsx";
import StorageSettings from "./StorageSettings.jsx";

const DEFAULT_BILLING_API_URL = "https://billing.vce.codes";
const DEFAULT_SKU_PREFIX = "NHACTOI";
const PAYMENT_CODE_PREFIX = /^[A-Z0-9]{2,10}$/;
const SKU_PREFIX = /^[A-Z0-9][A-Z0-9-]{0,19}$/;

function Field({ label, hint, suffix, ...props }) {
  const input = <input {...props} />;
  return (
    <label className="field">
      <span>{label}</span>
      {suffix ? (
        <span className="settings-input-affix">
          {input}
          <span aria-hidden="true">{suffix}</span>
        </span>
      ) : (
        input
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}
// Uppercases codes as they are typed while keeping the caret where it was.
function upperCaseInput(event) {
  const input = event.currentTarget;
  const next = input.value.toUpperCase();
  if (next === input.value) return;
  const { selectionStart, selectionEnd } = input;
  input.value = next;
  input.setSelectionRange(selectionStart, selectionEnd);
}
function formatRate(value) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(
    Number(value) || 0,
  );
}
function formatCheckedAt(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}
function testDetails({ latencyMs, httpStatus, checkedAt }) {
  const time = formatCheckedAt(checkedAt);
  return [
    Number.isFinite(latencyMs) ? `Phản hồi sau ${Math.round(latencyMs)} ms` : "",
    httpStatus ? `HTTP ${httpStatus}` : "",
    time ? `Kiểm tra lúc ${time}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function billingSettingsError(f) {
  const apiKey = (f.apiKey || "").trim();
  if (apiKey.startsWith("bg_live_"))
    return "Payment API cần project API key (bg_proj_…), không dùng API key truy vấn giao dịch (bg_live_…).";
  if (apiKey && !apiKey.startsWith("bg_proj_"))
    return "Project API key của VC Billing phải bắt đầu bằng bg_proj_.";
  const prefix = (f.paymentCodePrefix || "").trim().toUpperCase();
  if (prefix && !PAYMENT_CODE_PREFIX.test(prefix))
    return "Tiền tố mã thanh toán gồm 2–10 ký tự chữ in hoa (A–Z) hoặc số, hoặc để trống để VC Billing tự sinh mã.";
  const rawRate = String(f.taxRate ?? "").trim();
  const rate = rawRate === "" ? 0 : Number(rawRate);
  if (
    !Number.isFinite(rate) ||
    rate < 0 ||
    rate > 100 ||
    Math.abs(Math.round(rate * 100) - rate * 100) > 1e-6
  )
    return "Thuế VAT phải từ 0 đến 100%, tối đa 2 chữ số thập phân.";
  if (!SKU_PREFIX.test((f.skuPrefix || "").trim().toUpperCase()))
    return "Tiền tố SKU gồm 1–20 ký tự chữ in hoa, số hoặc dấu gạch ngang và phải bắt đầu bằng chữ hoặc số.";
  return "";
}
function Secret({ name, label, configured, clearName, hint }) {
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
        hint={hint}
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
export default function AdminSettings({ data, api, onSaved, openPreview, openPlans }) {
  const [editing, setEditing] = useState(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [testing, setTesting] = useState(false),
    [testResult, setTestResult] = useState(null),
    [copied, setCopied] = useState(null);
  const editor = useRef(null),
    trigger = useRef(null),
    webhookCode = useRef(null),
    copyTimer = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    if (editing) editor.current?.querySelector("input")?.focus();
  }, [editing]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(copyTimer.current);
    };
  }, []);
  async function testConnection() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api("/admin/settings/billgateway/test", {
        method: "POST",
      });
      if (!mounted.current) return;
      const ok = !!result?.ok;
      setTestResult({
        ok,
        message:
          result?.message ||
          (ok
            ? "VC Billing đã phản hồi với project API key hiện tại."
            : "VC Billing chưa chấp nhận cấu hình hiện tại."),
        latencyMs: result?.latencyMs,
        httpStatus: result?.httpStatus,
        checkedAt: result?.checkedAt || new Date().toISOString(),
      });
    } catch (e) {
      if (!mounted.current) return;
      setTestResult({
        ok: false,
        message: e.message || "Không kiểm tra được kết nối VC Billing.",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      if (mounted.current) setTesting(false);
    }
  }
  async function copyWebhook(url) {
    clearTimeout(copyTimer.current);
    let copiedOk = false;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard");
      await navigator.clipboard.writeText(url);
      if (!mounted.current) return;
      copiedOk = true;
      setCopied("ok");
    } catch {
      if (!mounted.current) return;
      // Clipboard access can be blocked (non-HTTPS origin, permissions):
      // select the URL so it can be copied manually.
      const node = webhookCode.current,
        selection = window.getSelection?.();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopied("error");
    }
    copyTimer.current = setTimeout(
      () => {
        if (mounted.current) setCopied(null);
      },
      copiedOk ? 2500 : 8000,
    );
  }
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
    if (editing === "billgateway") {
      const apiKey = (f.apiKey || "").trim(),
        taxRate = String(f.taxRate ?? "").trim();
      if (
        (apiKey && f.clearApiKey) ||
        (f.webhookSecret && f.clearWebhookSecret)
      ) {
        setError("Chọn nhập khóa mới hoặc xóa khóa đã lưu cho mỗi trường.");
        return;
      }
      const invalid = billingSettingsError(f);
      if (invalid) {
        setError(invalid);
        return;
      }
      payload.billgateway = {
        apiUrl: f.apiUrl.trim(),
        projectId: f.projectId.trim(),
        paymentCodePrefix: f.paymentCodePrefix.trim().toUpperCase(),
        taxRate: taxRate === "" ? 0 : Number(taxRate),
        skuPrefix: f.skuPrefix.trim().toUpperCase(),
      };
      if (apiKey) payload.billgateway.apiKey = apiKey;
      if (f.webhookSecret) payload.billgateway.webhookSecret = f.webhookSecret;
      if (f.clearApiKey) payload.billgateway.clearApiKey = true;
      if (f.clearWebhookSecret) payload.billgateway.clearWebhookSecret = true;
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
      // A previous connection check no longer describes the saved settings.
      if (editing === "billgateway") setTestResult(null);
      setEditing(null);
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const gateway = data.billgateway || {},
    smtp = data.smtp || {},
    taxRate = Number(gateway.taxRate) || 0,
    webhookUrl = gateway.webhookUrl || "",
    apiKeyWarning =
      gateway.apiKeyKind === "live"
        ? "Đang dùng key bg_live_ — cần project key bg_proj_"
        : gateway.apiKeyKind === "other" && gateway.hasApiKey
          ? "Khóa đã lưu không phải project key bg_proj_"
          : "";
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
      <AiSettings api={api} />
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
      <section className="panel settings-card">
        <div className="settings-card-heading"><div><h2>Gói thuê bao</h2><p>Thêm gói, chỉnh giá, quyền lợi và trạng thái bán tại trang quản lý riêng.</p></div><button className="button secondary" onClick={openPlans}>Quản lý gói <ArrowUpRight size={16} /></button></div>
      </section>
      {card(
        "billgateway",
        "VC Billing",
        "Payment Hub thu tiền thuê bao tháng/năm qua billing.vce.codes.",
        Receipt,
        <>
          <div className="settings-billing-status">
            <Connection ready={data.billingConfigured} />
            <button
              type="button"
              className="button secondary"
              disabled={!!editing || saving || testing}
              aria-busy={testing || undefined}
              onClick={testConnection}
            >
              {testing ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <PlugZap size={15} />
              )}
              {testing ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
            </button>
          </div>
          <div role="status" aria-live="polite" className="settings-test-slot">
            {testResult && (
              <div
                className={`settings-test-result ${testResult.ok ? "is-ok" : "is-error"}`}
              >
                {testResult.ok ? (
                  <CheckCircle2 size={17} />
                ) : (
                  <AlertCircle size={17} />
                )}
                <div>
                  <strong>
                    {testResult.ok
                      ? "Kết nối VC Billing thành công"
                      : "Kết nối VC Billing chưa thành công"}
                  </strong>
                  <p>{testResult.message}</p>
                  <small>{testDetails(testResult)}</small>
                </div>
              </div>
            )}
          </div>
          <div className="settings-values">
            <div>
              <span>Địa chỉ API</span>
              <strong>{gateway.apiUrl || "Chưa thiết lập"}</strong>
            </div>
            <div>
              <span>Mã dự án</span>
              <strong>{gateway.projectId || "Chưa thiết lập"}</strong>
            </div>
            <div className={apiKeyWarning ? "is-warning" : undefined}>
              <span>Project API key</span>
              <strong>
                {apiKeyWarning ? (
                  <>
                    <TriangleAlert size={14} aria-hidden="true" />
                    {apiKeyWarning}
                  </>
                ) : gateway.hasApiKey ? (
                  "Đã lưu khóa bg_proj_"
                ) : (
                  "Chưa có khóa API"
                )}
              </strong>
            </div>
            <div>
              <span>Khóa webhook</span>
              <strong>
                {gateway.hasWebhookSecret
                  ? "Đã lưu khóa webhook"
                  : "Chưa có khóa webhook"}
              </strong>
            </div>
            <div>
              <span>Mã thanh toán</span>
              <strong>
                {gateway.paymentCodePrefix
                  ? `Tiền tố ${gateway.paymentCodePrefix}`
                  : "VC Billing tự sinh"}
              </strong>
            </div>
            <div>
              <span>Thuế VAT</span>
              <strong>
                {taxRate > 0
                  ? `${formatRate(taxRate)}% cộng thêm vào giá gói`
                  : "Không tính VAT"}
              </strong>
            </div>
            <div>
              <span>Tiền tố SKU</span>
              <strong>{gateway.skuPrefix || DEFAULT_SKU_PREFIX}</strong>
            </div>
          </div>
          <div className="settings-webhook">
            <span className="settings-webhook-label">Webhook URL</span>
            <div className="settings-webhook-row">
              <code
                ref={webhookCode}
                className={webhookUrl ? undefined : "is-empty"}
              >
                {webhookUrl ||
                  "Cấu hình địa chỉ ứng dụng để tạo webhook URL"}
              </code>
              <button
                type="button"
                className={`button secondary settings-copy ${copied === "ok" ? "is-copied" : ""}`}
                disabled={!webhookUrl}
                aria-label={
                  copied === "ok"
                    ? "Đã sao chép webhook URL"
                    : "Sao chép webhook URL"
                }
                onClick={() => copyWebhook(webhookUrl)}
              >
                {copied === "ok" ? <Check size={15} /> : <Copy size={15} />}
                {copied === "ok" ? "Đã sao chép" : "Sao chép"}
              </button>
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {copied === "ok"
                ? "Đã sao chép webhook URL"
                : copied === "error"
                  ? "Trình duyệt chặn sao chép tự động. Địa chỉ đã được chọn để bạn sao chép thủ công."
                  : ""}
            </span>
            {copied === "error" && (
              <small className="settings-webhook-error">
                Trình duyệt chặn sao chép tự động — địa chỉ đã được chọn, nhấn
                Ctrl/⌘ + C để sao chép.
              </small>
            )}
            <small>
              Dán địa chỉ này vào cấu hình webhook của dự án trên VC Billing.
              VC Billing không gửi lại webhook bị lỗi; hệ thống tự đối soát các
              hóa đơn đang chờ thanh toán mỗi vài phút.
            </small>
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
              placeholder={gateway.defaultApiUrl || DEFAULT_BILLING_API_URL}
              hint="Origin của VC Billing, không kèm /api/v1"
            />
            <Field
              label="Mã dự án"
              name="projectId"
              defaultValue={gateway.projectId || ""}
              maxLength={160}
            />
            <Secret
              label="Khóa API dự án"
              name="apiKey"
              configured={gateway.hasApiKey}
              clearName="clearApiKey"
              hint="Project API key bắt đầu bằng bg_proj_ — không dùng key bg_live_"
            />
            <Secret
              label="Khóa webhook"
              name="webhookSecret"
              configured={gateway.hasWebhookSecret}
              clearName="clearWebhookSecret"
              hint="Dùng để xác minh chữ ký x-billgate-signature của webhook."
            />
          </div>
          <h3 className="settings-group-title">Hóa đơn và mã thanh toán</h3>
          <div className="settings-fields">
            <Field
              label="Tiền tố mã thanh toán"
              name="paymentCodePrefix"
              defaultValue={gateway.paymentCodePrefix || ""}
              maxLength={10}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="VD: NHACTOI"
              onChange={upperCaseInput}
              hint="Để trống để VC Billing tự sinh mã. Mã dùng làm nội dung chuyển khoản."
            />
            <Field
              label="Thuế VAT"
              name="taxRate"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.01}
              defaultValue={gateway.taxRate ?? 0}
              suffix="%"
              hint="Cộng thêm vào giá gói; 0 = không tính VAT"
            />
            <Field
              label="Tiền tố SKU"
              name="skuPrefix"
              defaultValue={gateway.skuPrefix || DEFAULT_SKU_PREFIX}
              maxLength={20}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={upperCaseInput}
              hint="Chữ in hoa, số và dấu gạch ngang; dùng để đặt mã sản phẩm gói trên VC Billing."
            />
          </div>
          <p className="settings-help">
            Khóa đã lưu không được hiển thị lại. Để trống trường khóa để giữ
            nguyên kết nối hiện tại. Thuế VAT và các tiền tố áp dụng cho hóa
            đơn tạo sau khi lưu.
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
