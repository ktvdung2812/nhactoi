import { createHmac, randomInt } from "node:crypto";
import { hashPassword, safeEqualText } from "./auth.mjs";
import { invalidateSessions } from './restore-safety.mjs';

// Persist limits so restarting the server or changing IP cannot reset the
// per-address send limit or the number of guesses for a recovery code.
export function authRequestLimiter({ db, clock, settingsKey, withTransaction, HttpError }) {
  const digest = (value) => createHmac("sha256", settingsKey).update(value).digest("hex");
  return (action, { ipLimit, windowMs, emailLimits = [] }) => (req, res, next) => {
    try {
      const now = new Date(clock()).getTime();
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const buckets = [
        { key: `${action}:ip:${digest(req.ip || "unknown")}`, limit: ipLimit, windowMs },
        ...emailLimits.map((rule, index) => ({
          ...rule, key: `${action}:email:${index}:${digest(email)}`,
        })),
      ];
      withTransaction(db, () => {
        db.prepare("DELETE FROM auth_request_limits WHERE expires_at <= ?").run(now);
        for (const bucket of buckets) {
          // Claim the attempt atomically across API processes. A rejected
          // bucket rolls back every earlier claim in this transaction.
          const claimed = db.prepare(`INSERT INTO auth_request_limits(bucket, expires_at, count) VALUES (?, ?, 1)
            ON CONFLICT(bucket) DO UPDATE SET count = auth_request_limits.count + 1
              WHERE auth_request_limits.count < ?
            RETURNING expires_at`).get(bucket.key, now + bucket.windowMs, bucket.limit);
          if (!claimed) {
            const current = db.prepare("SELECT expires_at FROM auth_request_limits WHERE bucket = ?").get(bucket.key);
            res.set("Retry-After", String(Math.ceil((current.expires_at - now) / 1000)));
            throw new HttpError(429, "Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.");
          }
        }
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function registerPasswordResetRoutes(app, {
  db, clock, config, settingsKey, withTransaction, HttpError,
  emailValue, passwordValue, transport, limit, clearSessionCookie,
}) {
  const ttl = 15 * 60_000;
  const generic = "Nếu email thuộc tài khoản đang hoạt động, bạn sẽ nhận được mã xác nhận. Vui lòng kiểm tra cả thư rác.";
  const invalid = "Mã xác nhận không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.";
  const digest = (userId, email, code) => createHmac("sha256", settingsKey)
    .update(JSON.stringify([userId, email, code])).digest("hex");

  app.post("/api/auth/forgot-password", limit("forgot", {
    ipLimit: 20, windowMs: ttl,
    emailLimits: [{ limit: 1, windowMs: 60_000 }, { limit: 5, windowMs: 60 * 60_000 }],
  }), (req, res, next) => {
    try {
      if (typeof req.body?.email !== "string") throw new HttpError(400, "Email không hợp lệ.");
      const email = emailValue(req.body.email);
      const mailer = transport();
      if (!mailer) throw new HttpError(503, "Chức năng khôi phục mật khẩu chưa được cấu hình email. Vui lòng liên hệ quản trị viên.");
      const now = new Date(clock()).getTime();
      db.prepare("DELETE FROM password_reset_codes WHERE expires_at <= ?").run(now);
      const user = db.prepare("SELECT id FROM users WHERE email = ? AND disabled_at IS NULL").get(email);
      if (user) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const codeHash = digest(user.id, email, code);
        db.prepare(`INSERT INTO password_reset_codes(user_id, email, code_hash, expires_at, attempts, created_at)
          VALUES (?, ?, ?, ?, 0, ?)
          ON CONFLICT(user_id) DO UPDATE SET email=excluded.email, code_hash=excluded.code_hash,
            expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at`)
          .run(user.id, email, codeHash, now + ttl, now);
        // Do not expose account existence via SMTP response time or errors.
        // Delivery failures never log addresses, codes or transport credentials.
        Promise.resolve().then(() => mailer.sendMail({
          from: config.smtp?.from || "no-reply@nhactoi.local",
          to: email,
          subject: "Mã đặt lại mật khẩu Nhắc tôi",
          text: `Mã xác nhận của bạn: ${code}\n\nMã có hiệu lực trong 15 phút và chỉ dùng một lần. Nhập mã trên web hoặc app Nhắc tôi để đặt mật khẩu mới.\nNếu bạn không yêu cầu, hãy bỏ qua email này. Không chia sẻ mã với bất kỳ ai.`,
        })).catch(() => {
          try {
            db.prepare("DELETE FROM password_reset_codes WHERE user_id = ? AND code_hash = ?").run(user.id, codeHash);
          } catch { /* The server may already have shut down. */ }
          console.error("[nhactoi] password reset email delivery failed");
        });
      }
      res.set("Cache-Control", "no-store");
      return res.json({ message: generic, retryAfterSeconds: 60 });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/reset-password", limit("reset", { ipLimit: 30, windowMs: ttl }), (req, res, next) => {
    try {
      const body = req.body;
      if (typeof body?.email !== "string" || typeof body?.password !== "string")
        throw new HttpError(400, "Email và mật khẩu không hợp lệ.");
      const email = emailValue(body.email);
      const password = passwordValue(body.password);
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const now = new Date(clock()).getTime();
      const changed = withTransaction(db, () => {
        const row = db.prepare(`SELECT r.*, u.disabled_at FROM password_reset_codes r
          JOIN users u ON u.id = r.user_id AND u.email = r.email WHERE r.email = ?`).get(email);
        if (!row || row.disabled_at || row.expires_at <= now || row.attempts >= 5) return false;
        if (!/^\d{6}$/.test(code) || !safeEqualText(row.code_hash, digest(row.user_id, email, code))) {
          db.prepare("UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = ?").run(row.user_id);
          return false;
        }
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), row.user_id);
        db.prepare("DELETE FROM password_reset_codes WHERE user_id = ?").run(row.user_id);
        invalidateSessions(db, { userId: row.user_id });
        // Recovery proves mailbox ownership, unlike registration or a prior
        // password session. Revoke any Google identity linked before recovery.
        db.prepare("DELETE FROM google_identities WHERE user_id = ?").run(row.user_id);
        db.prepare("DELETE FROM google_oauth_states WHERE user_id = ?").run(row.user_id);
        return true;
      });
      if (!changed) throw new HttpError(400, invalid);
      clearSessionCookie(res, config);
      res.set("Cache-Control", "no-store");
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });
}
