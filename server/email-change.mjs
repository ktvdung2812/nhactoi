import { createHmac, randomInt } from "node:crypto";
import { createId, safeEqualText, verifyPassword } from "./auth.mjs";
import { invalidateSessions } from "./restore-safety.mjs";

// Changing the login email needs the current password (or a Google sign-in
// from the last 10 minutes) and a code sent to the new address. Until the
// code is confirmed the account keeps its old email, so a stolen session
// cannot redirect password recovery to an attacker's mailbox.
export function registerEmailChangeRoutes(app, {
  db, clock, config, settingsKey, withTransaction, HttpError,
  requireAuth, emailValue, transport, limit,
}) {
  const ttl = 15 * 60_000;
  const resendMs = 60_000;
  const googleFreshMs = 10 * 60_000;
  const maxAttempts = 5;
  const maxPasswordGuesses = 5;
  const invalid = "Mã xác nhận không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu mã mới.";
  const from = () => config.smtp?.from || "no-reply@nhactoi.local";
  // The label keeps these digests distinct from password reset codes.
  const digest = (userId, email, code) => createHmac("sha256", settingsKey)
    .update(JSON.stringify(["email-change", userId, email, code])).digest("hex");
  const nowMs = () => new Date(clock()).getTime();
  const postgresOnly = (req, res, next) => db.dialect === "postgres"
    ? next() : next(new HttpError(400, "Đổi email cần PostgreSQL."));
  const active = (userId, now) => db.prepare(`SELECT * FROM email_change_requests
    WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?`).get(userId, now, maxAttempts);

  app.get("/api/me/email-change", requireAuth, postgresOnly, (req, res, next) => {
    try {
      const row = active(req.auth.userId, nowMs());
      res.set("Cache-Control", "no-store");
      return res.json({ pending: row ? { email: row.new_email, expiresAt: new Date(Number(row.expires_at)).toISOString() } : null });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/me/email-change", requireAuth, postgresOnly, (req, res, next) => {
    try {
      db.prepare("DELETE FROM email_change_requests WHERE user_id = ? AND consumed_at IS NULL").run(req.auth.userId);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  // The 60-second resend cooldown is per account and starts only once a code
  // was sent, so a mistyped password does not lock the address for a minute.
  app.post("/api/me/email-change", requireAuth, postgresOnly, limit("email-change", {
    ipLimit: 20, windowMs: ttl, emailLimits: [{ limit: 5, windowMs: 60 * 60_000 }],
  }), (req, res, next) => {
    try {
      if (typeof req.body?.email !== "string") throw new HttpError(400, "Email mới không hợp lệ.");
      const email = emailValue(req.body.email);
      const password = req.body.password;
      if (password !== undefined && typeof password !== "string") throw new HttpError(400, "Mật khẩu không hợp lệ.");
      const user = db.prepare("SELECT id, email, password_hash FROM users WHERE id = ?").get(req.auth.userId);
      if (email === user.email) throw new HttpError(400, "Email mới phải khác email hiện tại.");
      const mailer = transport();
      if (!mailer) throw new HttpError(503, "Chưa cấu hình email để gửi mã xác nhận. Vui lòng liên hệ quản trị viên.");
      // Google sign-ups get a random password, so a session that signed in
      // with a still-linked Google account may skip it, but only while fresh:
      // whoever holds an older cookie must prove control of Google again.
      // 403 rather than 401: the client signs out on 401.
      if (password === undefined) {
        const viaGoogle = req.auth.sessionAuthMethod === "google"
          && db.prepare("SELECT 1 FROM google_identities WHERE user_id = ?").get(user.id);
        if (!viaGoogle) throw new HttpError(403, "Vui lòng nhập mật khẩu hiện tại.");
        if (!(nowMs() - Date.parse(req.auth.sessionCreatedAt) <= googleFreshMs))
          throw new HttpError(403, "Hãy đăng nhập lại bằng Google rồi thử lại.", undefined, { code: "reauth_required" });
      } else {
        // Wrong passwords are counted per account, so a stolen session cannot
        // keep guessing by rotating the new address or the IP. The limiter
        // above has already deleted expired buckets.
        const guessKey = `email-change:password:${user.id}`;
        const guesses = db.prepare("SELECT count, expires_at FROM auth_request_limits WHERE bucket = ?").get(guessKey);
        if (guesses && Number(guesses.count) >= maxPasswordGuesses) {
          res.set("Retry-After", String(Math.ceil((Number(guesses.expires_at) - nowMs()) / 1000)));
          throw new HttpError(429, "Bạn đã nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.");
        }
        if (!verifyPassword(password, user.password_hash)) {
          db.prepare(`INSERT INTO auth_request_limits(bucket, expires_at, count) VALUES (?, ?, 1)
            ON CONFLICT(bucket) DO UPDATE SET count = auth_request_limits.count + 1`).run(guessKey, nowMs() + ttl);
          throw new HttpError(403, "Mật khẩu hiện tại không đúng.");
        }
      }
      if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").get(email, user.id))
        throw new HttpError(409, "email is already registered");
      const now = nowMs();
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const id = createId("emailchg_");
      const codeHash = digest(user.id, email, code);
      withTransaction(db, () => {
        db.prepare("DELETE FROM email_change_requests WHERE expires_at <= ?").run(now);
        const previous = db.prepare("SELECT created_at FROM email_change_requests WHERE user_id = ? AND consumed_at IS NULL FOR UPDATE").get(user.id);
        if (previous && Number(previous.created_at) > now - resendMs) {
          res.set("Retry-After", String(Math.ceil((Number(previous.created_at) + resendMs - now) / 1000)));
          throw new HttpError(429, "Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.");
        }
        db.prepare(`INSERT INTO email_change_requests(id, user_id, previous_email, new_email, code_hash, expires_at, attempts, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?)
          ON CONFLICT (user_id) WHERE consumed_at IS NULL DO UPDATE SET id = excluded.id,
            previous_email = excluded.previous_email, new_email = excluded.new_email, code_hash = excluded.code_hash,
            expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`)
          .run(id, user.id, user.email, email, codeHash, now + ttl, now);
      });
      // Delivery failures never log addresses, codes or transport credentials.
      Promise.resolve().then(() => mailer.sendMail({
        from: from(),
        to: email,
        subject: "Mã xác nhận đổi email Nhắc tôi",
        text: `Mã xác nhận của bạn: ${code}\n\nNhập mã trong mục Tài khoản để dùng địa chỉ này làm email đăng nhập Nhắc tôi. Mã có hiệu lực trong 15 phút và chỉ dùng một lần.\nNếu bạn không yêu cầu, hãy bỏ qua email này. Không chia sẻ mã với bất kỳ ai.`,
      })).catch(() => {
        try {
          db.prepare("DELETE FROM email_change_requests WHERE id = ? AND consumed_at IS NULL").run(id);
        } catch { /* The server may already have shut down. */ }
        console.error("[nhactoi] email change code delivery failed");
      });
      res.set("Cache-Control", "no-store");
      return res.json({ email, expiresAt: new Date(now + ttl).toISOString(), retryAfterSeconds: resendMs / 1000 });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/me/email-change/confirm", requireAuth, postgresOnly,
    limit("email-change-confirm", { ipLimit: 30, windowMs: ttl }), (req, res, next) => {
    try {
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      const now = nowMs();
      // Return instead of throwing so a failed guess still counts.
      const outcome = withTransaction(db, () => {
        const row = db.prepare("SELECT * FROM email_change_requests WHERE user_id = ? AND consumed_at IS NULL FOR UPDATE").get(req.auth.userId);
        if (!row || Number(row.expires_at) <= now || Number(row.attempts) >= maxAttempts) return { status: 400 };
        if (!/^\d{6}$/.test(code) || !safeEqualText(row.code_hash, digest(row.user_id, row.new_email, code))) {
          db.prepare("UPDATE email_change_requests SET attempts = attempts + 1 WHERE id = ?").run(row.id);
          return { status: 400 };
        }
        const current = db.prepare("SELECT email FROM users WHERE id = ? FOR UPDATE").get(row.user_id);
        const taken = db.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").get(row.new_email, row.user_id);
        if (current?.email !== row.previous_email || taken) {
          db.prepare("DELETE FROM email_change_requests WHERE id = ?").run(row.id);
          return { status: taken ? 409 : 400 };
        }
        db.prepare("UPDATE users SET email = ? WHERE id = ?").run(row.new_email, row.user_id);
        db.prepare("UPDATE email_change_requests SET consumed_at = ? WHERE id = ?").run(now, row.id);
        // A code sent to the old address must not reset the moved account.
        db.prepare("DELETE FROM password_reset_codes WHERE user_id = ?").run(row.user_id);
        invalidateSessions(db, { userId: row.user_id, exceptId: req.auth.sessionId });
        return { row };
      });
      if (outcome.status === 409) throw new HttpError(409, "email is already registered");
      if (outcome.status) throw new HttpError(400, invalid);
      const { row } = outcome;
      const mailer = transport();
      if (mailer) Promise.resolve().then(() => mailer.sendMail({
        from: from(),
        to: row.previous_email,
        subject: "Email đăng nhập Nhắc tôi đã thay đổi",
        text: `Email đăng nhập tài khoản Nhắc tôi của bạn vừa được đổi sang ${row.new_email}. Các phiên đăng nhập khác đã được đăng xuất.\nNếu bạn không thực hiện thay đổi này, hãy liên hệ quản trị viên ngay.`,
      })).catch(() => console.error("[nhactoi] email change notice delivery failed"));
      res.set("Cache-Control", "no-store");
      return res.json({ user: { ...req.auth.user, email: row.new_email } });
    } catch (error) {
      return next(error);
    }
  });
}
