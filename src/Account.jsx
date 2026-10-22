import React, { useEffect, useState } from "react";
import {
  Bot,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Mail,
  Monitor,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "./theme.js";
import "./account.css";

const LIMITS = { name: 120, email: 320 };

function normalizedName(user) {
  return String(user?.name || "").trim();
}

function validateName(value) {
  const name = value.trim();
  if (!name) return "Họ và tên không được để trống.";
  if (name.length > LIMITS.name)
    return `Họ và tên không được dài quá ${LIMITS.name} ký tự.`;
  return "";
}

function validateEmail(value) {
  const email = value.trim().toLowerCase();
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
  const initial = normalizedName(user);
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const next = normalizedName(user);
    setSaved(next);
    setName(next);
  }, [user?.id, user?.name]);

  const dirty = name !== saved;

  function cancel() {
    setName(saved);
    setError("");
    setNotice("");
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || !dirty) return;
    const next = name.trim();
    const validationError = validateName(next);
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
        body: JSON.stringify({ name: next }),
      });
      const updated = normalizedName(result.user);
      setSaved(updated);
      setName(updated);
      setNotice("Đã cập nhật thông tin cá nhân.");
      onSaved({ ...result.user, name: updated });
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
          <p>Cập nhật tên hiển thị của bạn.</p>
        </div>
      </div>
      <form onSubmit={submit} noValidate aria-busy={saving}>
        <fieldset disabled={saving}>
          <div className="form-grid">
            <label className="field">
              <span>Họ và tên</span>
              <input
                name="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                  setNotice("");
                }}
                maxLength={LIMITS.name}
                autoComplete="name"
                required
              />
            </label>
          </div>
        </fieldset>
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

// Step 1 asks for the new address and the current password; step 2 confirms
// the 6-digit code mailed to that address. The email changes only then.
export function EmailChange({ api, user, onSaved }) {
  const [pending, setPending] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reauth, setReauth] = useState(false);

  useEffect(() => {
    let active = true;
    api("/me/email-change")
      .then((result) => { if (active) setPending(result.pending); })
      .catch(() => {});
    return () => { active = false; };
  }, [api, user?.id]);
  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setReauth(false);
    try {
      await action();
    } catch (reason) {
      setError(reason?.message || "Không thể đổi email.");
      setReauth(reason?.code === "reauth_required");
      if (reason?.status === 429) setCooldown(Number(reason.retryAfterSeconds) || 60);
    } finally {
      setBusy(false);
    }
  }

  function sendCode(target) {
    return run(async () => {
      const next = target.trim().toLowerCase();
      const validationError = validateEmail(next);
      if (validationError) throw new Error(validationError);
      const result = await api("/me/email-change", {
        method: "POST",
        body: JSON.stringify({ email: next, ...(password ? { password } : {}) }),
      });
      setPending({ email: result.email, expiresAt: result.expiresAt });
      setCooldown(Number(result.retryAfterSeconds) || 60);
      setCode("");
      setNotice(`Đã gửi mã xác nhận tới ${result.email}. Vui lòng kiểm tra cả thư rác.`);
    });
  }

  // After a reload the password is no longer in memory, so resending goes
  // back to the first step with the pending address filled in.
  function resend() {
    if (password) return sendCode(pending.email);
    setEmail(pending.email);
    setPending(null);
    setCode("");
    setError("");
    setNotice(`Nhập mật khẩu hiện tại để gửi lại mã tới ${pending.email}.`);
  }

  function confirm(event) {
    event.preventDefault();
    return run(async () => {
      if (!/^\d{6}$/.test(code.trim())) throw new Error("Mã xác nhận gồm 6 chữ số.");
      const result = await api("/me/email-change/confirm", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setPending(null);
      setEmail("");
      setPassword("");
      setCode("");
      setNotice("Đã đổi email đăng nhập. Các thiết bị khác đã được đăng xuất.");
      onSaved(result.user);
    });
  }

  // Google sign-in only starts without a session, so sign out first; Google
  // brings the user back with a fresh session.
  function signInWithGoogle() {
    setBusy(true);
    api("/auth/logout", { method: "POST" }).catch(() => {})
      .finally(() => location.assign("/api/auth/google/start"));
  }

  function cancel() {
    return run(async () => {
      await api("/me/email-change", { method: "DELETE" });
      setPending(null);
      setCode("");
      setCooldown(0);
    });
  }

  return (
    <section className="td-panel account-profile-panel" aria-labelledby="account-email-title">
      <div className="td-section-heading">
        <div>
          <h2 id="account-email-title">
            <Mail size={19} /> Email đăng nhập
          </h2>
          <p>Email hiện tại: <strong>{user?.email}</strong></p>
        </div>
      </div>
      {pending ? (
        <form onSubmit={confirm} noValidate aria-busy={busy}>
          <p className="account-help">
            Nhập mã 6 chữ số đã gửi tới <strong>{pending.email}</strong>. Email chỉ được đổi sau khi xác nhận.
          </p>
          <fieldset disabled={busy}>
            <div className="form-grid">
              <label className="field">
                <span>Mã xác nhận</span>
                <input
                  name="code"
                  value={code}
                  onChange={(event) => { setCode(event.target.value); setError(""); }}
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                />
              </label>
            </div>
          </fieldset>
          {error && <p className="td-error" role="alert"><AlertCircle size={16} /> {error}</p>}
          {notice && <p className="td-notice" role="status"><CheckCircle2 size={16} /> {notice}</p>}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={cancel} disabled={busy}>Hủy đổi email</button>
            <button type="button" className="button secondary" onClick={resend} disabled={busy || cooldown > 0}>
              {cooldown > 0 ? `Gửi lại mã sau ${cooldown}s` : "Gửi lại mã"}
            </button>
            <button type="submit" className="button" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
              Xác nhận
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); sendCode(email); }} noValidate aria-busy={busy}>
          <fieldset disabled={busy}>
            <div className="form-grid">
              <label className="field">
                <span>Email mới</span>
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setError(""); setNotice(""); }}
                  maxLength={LIMITS.email}
                  autoComplete="email"
                  required
                />
              </label>
              <label className="field">
                <span>Mật khẩu hiện tại</span>
                <input
                  name="password"
                  type="password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setError(""); }}
                  maxLength={256}
                  autoComplete="current-password"
                  aria-describedby="account-email-help"
                />
              </label>
            </div>
          </fieldset>
          <p id="account-email-help" className="account-help">
            Mã xác nhận sẽ được gửi tới email mới. Bỏ trống mật khẩu nếu bạn vừa đăng nhập bằng Google đã liên kết.
          </p>
          {error && <p className="td-error" role="alert"><AlertCircle size={16} /> {error}</p>}
          {notice && <p className="td-notice" role="status"><CheckCircle2 size={16} /> {notice}</p>}
          <div className="modal-actions">
            {reauth && (
              <button type="button" className="button secondary" onClick={signInWithGoogle} disabled={busy}>
                Đăng nhập lại bằng Google
              </button>
            )}
            <button type="submit" className="button" disabled={busy || cooldown > 0 || !email.trim()}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Mail size={16} />}
              {cooldown > 0 ? `Gửi mã sau ${cooldown}s` : "Gửi mã xác nhận"}
            </button>
          </div>
        </form>
      )}
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
      <p className="account-help">{config.ready ? (config.model ? `Mô hình: ${config.model} · ${config.provider}` : "Nhà cung cấp AI đã sẵn sàng.") : "Nhà cung cấp AI chưa sẵn sàng. Quản trị viên cần kiểm tra cấu hình AI hiện có."}</p>
      <p className="account-help">Ảnh: {config.capabilities?.images ? "Có hỗ trợ" : "Chưa hỗ trợ"} · PDF: {config.capabilities?.pdf ? "Có hỗ trợ" : "Chưa hỗ trợ"}.</p>
      {!canManage && <p className="account-help">Chủ sở hữu hoặc quản trị viên có thể thay đổi cấu hình này.</p>}
      {notice && <p className="td-notice" role="status">{notice}</p>}
      {canManage && <div className="modal-actions"><button className="button" disabled={busy}>{busy ? "Đang lưu…" : "Lưu trợ lý"}</button></div>}
    </form>}
  </section>;
}
