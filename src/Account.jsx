import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, UserRound } from "lucide-react";
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
