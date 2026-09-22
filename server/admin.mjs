import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase, withTransaction } from "./db.mjs";
import { createId } from "./auth.mjs";

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Email không hợp lệ");
  return email;
}

function audit(db, { action, targetId, reason, before, after, createdAt }) {
  db.prepare(
    `
    INSERT INTO admin_audit_logs
      (id, actor_user_id, action, target_type, target_id, reason, before_json, after_json, created_at)
    VALUES (?, NULL, ?, 'user', ?, ?, ?, ?, ?)
  `,
  ).run(
    createId("admin_audit_"),
    action,
    targetId,
    reason,
    JSON.stringify(before),
    JSON.stringify(after),
    createdAt,
  );
}

/**
 * Grant or revoke platform-admin access for a user identified by email.
 *
 * The CLI is intentionally the only place that can change platform-admin
 * membership. Every change is transactional and leaves an audit row with a
 * NULL actor because the actor is the server operator rather than a session.
 */
export function runAdminCommand({
  db,
  command,
  email,
  reason,
  clock = () => new Date(),
} = {}) {
  if (!db) throw new Error("runAdminCommand requires a database");
  const actionName = String(command || "").trim().toLowerCase();
  if (!new Set(["grant", "revoke"]).has(actionName))
    throw new Error("Sử dụng: npm run admin -- grant|revoke EMAIL");
  const normalizedEmail = normalizeEmail(email);
  const now = new Date(typeof clock === "function" ? clock() : clock);
  if (Number.isNaN(now.getTime())) throw new Error("Thời gian hệ thống không hợp lệ");
  const createdAt = now.toISOString();
  const defaultReason =
    actionName === "grant" ? "CLI cấp quyền admin SaaS" : "CLI thu hồi quyền admin SaaS";
  let result;
  withTransaction(db, () => {
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizedEmail);
    if (!user) throw new Error("Không tìm thấy người dùng với email này");
    if (actionName === "grant") {
      if (user.disabled_at)
        throw new Error("Không thể cấp quyền admin cho tài khoản đang bị khóa");
      if (Boolean(user.is_platform_admin))
        throw new Error("Tài khoản đã có quyền admin SaaS");
    } else {
      if (!Boolean(user.is_platform_admin))
        throw new Error("Tài khoản không có quyền admin SaaS");
      if (!user.disabled_at) {
        const activeAdmins = Number(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM users WHERE is_platform_admin = 1 AND disabled_at IS NULL",
            )
            .get().n,
        );
        if (activeAdmins <= 1)
          throw new Error("Không thể thu hồi admin SaaS cuối cùng đang hoạt động");
      }
    }
    const next = actionName === "grant" ? 1 : 0;
    db.prepare("UPDATE users SET is_platform_admin = ? WHERE id = ?").run(
      next,
      user.id,
    );
    const before = { isPlatformAdmin: Boolean(user.is_platform_admin) };
    const after = { isPlatformAdmin: Boolean(next) };
    audit(db, {
      action: actionName === "grant" ? "admin.grant" : "admin.revoke",
      targetId: user.id,
      reason: String(reason || defaultReason).trim() || defaultReason,
      before,
      after,
      createdAt,
    });
    result = {
      action: actionName,
      id: user.id,
      email: user.email,
      isPlatformAdmin: Boolean(next),
    };
  });
  return result;
}

function usage() {
  return [
    "Usage:",
    "  npm run admin -- grant EMAIL [REASON]",
    "  npm run admin -- revoke EMAIL [REASON]",
  ].join("\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const [command, email, ...reasonParts] = process.argv.slice(2);
  if (!command || !email) {
    console.error(usage());
    process.exitCode = 1;
  } else {
    const dbPath =
      process.env.DB_PATH ||
      process.env.DATABASE_PATH ||
      resolve(process.cwd(), "data", "nhactoi.sqlite");
    let db;
    try {
      db = openDatabase(dbPath);
      const result = runAdminCommand({
        db,
        command,
        email,
        reason: reasonParts.join(" "),
      });
      console.log(
        `${result.action === "grant" ? "Đã cấp" : "Đã thu hồi"} quyền admin SaaS cho ${result.email}`,
      );
    } catch (error) {
      console.error(error?.message || error);
      process.exitCode = 1;
    } finally {
      db?.close();
    }
  }
}
