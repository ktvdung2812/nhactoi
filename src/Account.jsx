import React, { useEffect, useState } from "react";
import {
  Bot,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Monitor,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "./theme.js";
import "./account.css";

const LIMITS = { name: 120, email: 320 };

function normalizedUser(user) {
  return {
    name: String(user?.name || "").trim(),
    email: String(user?.email || "").trim().toLowerCase(),
  };
}

function validate(values) {
  const name = values.name.trim();
  const email = values.email.trim().toLowerCase();
  if (!name) return "Họ và tên không được để trống.";
  if (name.length > LIMITS.name)
    return `Họ và tên không được dài quá ${LIMITS.name} ký tự.`;
  if (!email) return "Email không được để trống.";
  if (email.length > LIMITS.email)
    return `Email không được dài quá ${LIMITS.email} ký tự.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return "Địa chỉ email không hợp lệ.";
  return "";
}

export function ThemeSettings({ disabledReason = "" }) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <section
      className="td-panel account-theme-panel"
      aria-labelledby="account-theme-title"
    >
      <div className="td-section-heading">
        <div>
          <h2 id="account-theme-title">
            <Sun size={19} /> Giao diện
          </h2>
          <p>{disabledReason || "Tùy chỉnh chế độ hiển thị sáng hoặc tối cho ứng dụng."}</p>
        </div>
      </div>
      <div
        className="theme-options-grid"
        role="radiogroup"
        aria-label="Lựa chọn giao diện"
      >
        <button
          type="button"
          role="radio"
          disabled={!!disabledReason}
          aria-checked={theme === "system"}
          className={`theme-option-card ${theme === "system" ? "active" : ""}`}
          onClick={() => setTheme("system")}
        >
          <div className="theme-option-icon">
            <Monitor size={18} />
          </div>
          <strong>Hệ thống</strong>
          <small>
            Tự động theo thiết bị (
            {resolvedTheme === "dark" ? "Đang tối" : "Đang sáng"})
          </small>
        </button>
        <button
          type="button"
          role="radio"
          disabled={!!disabledReason}
          aria-checked={theme === "light"}
          className={`theme-option-card ${theme === "light" ? "active" : ""}`}
          onClick={() => setTheme("light")}
        >
          <div className="theme-option-icon">
            <Sun size={18} />
          </div>
          <strong>Chế độ sáng</strong>
          <small>Giao diện nền sáng, dịu mắt ban ngày</small>
        </button>
        <button
          type="button"
          role="radio"
          disabled={!!disabledReason}
          aria-checked={theme === "dark"}
          className={`theme-option-card ${theme === "dark" ? "active" : ""}`}
          onClick={() => setTheme("dark")}
        >
          <div className="theme-option-icon">
            <Moon size={18} />
          </div>
          <strong>Chế độ tối</strong>
          <small>Giao diện nền tối, giảm chói mắt ban đêm</small>
        </button>
      </div>
    </section>
  );
}

export default function Account({ api, user, onSaved }) {
  const initial = normalizedUser(user);
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const next = normalizedUser(user);
    setSaved(next);
    setValues(next);
  }, [user?.id, user?.name, user?.email]);

  const dirty =
    values.name !== saved.name || values.email !== saved.email;

  function change(field) {
    return (event) => {
      setValues((current) => ({ ...current, [field]: event.target.value }));
      setError("");
      setNotice("");
    };
  }

  function cancel() {
    setValues(saved);
    setError("");
    setNotice("");
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || !dirty) return;
    const next = {
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
    };
    const validationError = validate(next);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/me", {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      const updated = normalizedUser(result.user);
      setSaved(updated);
      setValues(updated);
      setNotice("Đã cập nhật thông tin cá nhân.");
      onSaved({ ...result.user, ...updated });
    } catch (reason) {
      setError(reason?.message || "Không thể cập nhật thông tin cá nhân.");
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <section className="td-panel" role="status" aria-live="polite">
        Đang tải thông tin tài khoản…
      </section>
    );
  }

  return (
    <section className="td-panel account-profile-panel" aria-labelledby="account-profile-title">
      <div className="td-section-heading">
        <div>
          <h2 id="account-profile-title">
            <UserRound size={19} /> Thông tin cá nhân
          </h2>
          <p>Cập nhật tên và email dùng cho tài khoản của bạn.</p>
        </div>
      </div>
      <form onSubmit={submit} noValidate aria-busy={saving}>
        <fieldset disabled={saving}>
          <div className="form-grid">
            <label className="field">
              <span>Họ và tên</span>
              <input
                name="name"
                value={values.name}
                onChange={change("name")}
                maxLength={LIMITS.name}
                autoComplete="name"
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                name="email"
                type="email"
                value={values.email}
                onChange={change("email")}
                maxLength={LIMITS.email}
                autoComplete="email"
                aria-describedby="account-email-help"
                required
              />
            </label>
          </div>
        </fieldset>
        <p id="account-email-help" className="account-help">Sau khi đổi email, hãy dùng email mới để đăng nhập bằng mật khẩu.</p>
        {error && (
          <p className="td-error" role="alert">
            <AlertCircle size={16} /> {error}
          </p>
        )}
        {notice && (
          <p className="td-notice" role="status">
            <CheckCircle2 size={16} /> {notice}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={cancel}
            disabled={saving || !dirty}
          >
            Hủy
          </button>
          <button type="submit" className="button" disabled={saving || !dirty}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function AssistantSettings({ api, user, workspaceId }) {
  const [config, setConfig] = useState(null), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    setConfig(null); setDraft(null); setError(""); setNotice("");
    api("/ai/config").then(value => { if (active) { setConfig(value); setDraft(value.assistant); } }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [api, workspaceId]);
  const canManage = config?.canManageAssistant ?? config?.assistant?.canManage ?? (["owner", "admin"].includes(user?.role) && user?.memberType !== "guest");
  async function save(event) {
    event.preventDefault();
    if (busy || !canManage) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/ai/workspace-settings", { method: "PUT", body: JSON.stringify({ name: draft.name.trim(), handle: draft.handle.trim().replace(/^@/, ""), enabled: draft.enabled }) });
      setDraft(result.assistant); setConfig(value => ({ ...value, ...result })); setNotice("Đã cập nhật trợ lý của không gian.");
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  return <section className="td-panel account-profile-panel" aria-labelledby="account-assistant-title">
    <div className="td-section-heading"><div><h2 id="account-assistant-title"><Bot size={19} />Trợ lý trong bình luận</h2><p>Gọi trợ lý bằng @ trong công việc. Phản hồi hiển thị cho mọi người có quyền xem công việc.</p></div></div>
    {error && <p className="td-error" role="alert">{error}</p>}
    {!draft && !error && <p role="status">Đang tải cấu hình trợ lý…</p>}
    {draft && <form onSubmit={save} aria-busy={busy}>
      <fieldset disabled={!canManage || busy}>
        <label className="check"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft(value => ({ ...value, enabled: event.target.checked }))} />Bật trợ lý trong bình luận</label>
        <div className="form-grid"><label className="field"><span>Tên trợ lý</span><input value={draft.name} maxLength={60} required onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label><label className="field"><span>Tên gọi sau @</span><input value={draft.handle} maxLength={32} required autoCapitalize="none" spellCheck={false} onChange={event => setDraft(value => ({ ...value, handle: event.target.value }))} /><small>2–32 chữ Latin, số hoặc dấu gạch dưới; bắt đầu bằng chữ. Ví dụ: vyvy → @vyvy</small></label></div>
      </fieldset>
      <p className="account-help">{config.ready ? `Mô hình: ${config.model} · ${config.provider}` : "Nhà cung cấp AI chưa sẵn sàng. Quản trị viên cần kiểm tra cấu hình AI hiện có."}</p>
      <p className="account-help">Ảnh: {config.capabilities?.images ? "Có hỗ trợ" : "Chưa hỗ trợ"} · PDF: {config.capabilities?.pdf ? "Có hỗ trợ" : "Chưa hỗ trợ"}.</p>
      {!canManage && <p className="account-help">Chủ sở hữu hoặc quản trị viên có thể thay đổi cấu hình này.</p>}
      {notice && <p className="td-notice" role="status">{notice}</p>}
      {canManage && <div className="modal-actions"><button className="button" disabled={busy}>{busy ? "Đang lưu…" : "Lưu trợ lý"}</button></div>}
    </form>}
  </section>;
}
