import { reminderDeliveryAllowed, legacyReminderAllowed } from "./reminder-workflow.mjs";
import {
  createId,
  createToken,
  hashToken,
  verifyPassword,
} from "./auth.mjs";
import { canAccessTeamTask } from "./teams.mjs";

const MOBILE_TYPES = new Set([
  "service_renewal",
  "task_reminder",
  "task_update",
  "calendar_event",
]);
const MOBILE_NOTIFICATION_PAGE_SIZE = 50;
const MOBILE_MAX_PAGE_SIZE = 100;
const FCM_MAX_ATTEMPTS = 8;
// A single app can invoke the 30-second worker again while an HTTP request to
// FCM is still in flight. Queue runs per database so two callers cannot send
// the same pending installation concurrently. Delivery rows remain durable
// for retries after a process restart.
const notificationOutboxLocks = new WeakMap();

function nowIso(clock) {
  const date = typeof clock === "function" ? clock() : new Date();
  const value = date instanceof Date ? date : new Date(date);
  return (Number.isNaN(value.getTime()) ? new Date() : value).toISOString();
}

function addMilliseconds(iso, milliseconds) {
  return new Date(new Date(iso).getTime() + milliseconds).toISOString();
}

function clean(value, max, field) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) {
    const error = new Error(`${field} is invalid`);
    error.status = 400;
    throw error;
  }
  return text;
}

function httpError(HttpError, status, message) {
  return new HttpError(status, message);
}

function bearerToken(req) {
  const value = String(req.get("authorization") || "");
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] || null;
}

function userJson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isPlatformAdmin: Boolean(row.is_platform_admin ?? row.isPlatformAdmin),
  };
}

function workspaceJson(row) {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    suspendedAt: row.suspended_at ?? row.suspendedAt ?? null,
  };
}

function subscriptionJson(row, clock) {
  if (!row) return null;
  const now = new Date(nowIso(clock));
  const expired =
    row.status !== "canceled" &&
    new Date(row.current_period_end).getTime() <= now.getTime();
  return {
    plan: row.plan,
    cycle: row.cycle,
    status: expired ? "expired" : row.status,
    currentPeriodEnd: row.current_period_end,
  };
}

function notificationJson(row) {
  const entityType = row.entity_type ?? null;
  const entityId = row.entity_id ?? null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    readAt: row.read_at,
    createdAt: row.created_at,
    taskId: row.task_id,
    serviceId: row.service_id ?? null,
    workspaceId: row.workspace_id,
    entityType,
    entityId,
    target: entityType && entityId ? { type: entityType, id: entityId } : null,
  };
}

function validMobileSession(db, auth, clock) {
  if (!auth?.sessionId || auth.sessionKind !== "mobile") return false;
  const row = db
    .prepare(
      `SELECT s.id, s.user_id, s.kind, s.expires_at, u.disabled_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.user_id = ?`,
    )
    .get(auth.sessionId, auth.userId);
  return Boolean(
    row &&
      row.kind === "mobile" &&
      !row.disabled_at &&
      new Date(row.expires_at).getTime() > new Date(nowIso(clock)).getTime(),
  );
}

function mobileAuth(requireAuth, db, clock, HttpError) {
  return (req, res, next) => {
    if (!req.auth || req.auth.sessionKind !== "mobile" || !validMobileSession(db, req.auth, clock)) {
      return res.status(401).json({ error: "mobile authentication required" });
    }
    return requireAuth(req, res, next);
  };
}

function workspaceMembership(db, userId, workspaceId) {
  return db
    .prepare(
      `SELECT w.id, w.name, w.industry, w.suspended_at, wm.role
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
       JOIN users u ON u.id = wm.user_id
       WHERE wm.user_id = ? AND wm.workspace_id = ? AND u.disabled_at IS NULL`,
    )
    .get(userId, workspaceId);
}

function notificationAccessSql(includeServices = false) {
  const service = includeServices
    ? `
    AND (
      n.service_id IS NULL
      OR EXISTS (
        SELECT 1 FROM service_contracts sc
        WHERE sc.id = n.service_id AND sc.workspace_id = n.workspace_id
          AND sc.archived_at IS NULL
          AND (
            sc.team_id IS NULL
            OR EXISTS (
              SELECT 1 FROM workspace_members service_admin
              WHERE service_admin.workspace_id = n.workspace_id
                AND service_admin.user_id = n.user_id
                AND service_admin.role IN ('owner', 'admin')
            )
            OR EXISTS (
              SELECT 1 FROM team_members service_member
              WHERE service_member.team_id = sc.team_id
                AND service_member.workspace_id = n.workspace_id
                AND service_member.user_id = n.user_id
            )
          )
      )
    )`
    : "";
  return `
    n.user_id = ?
    AND EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = n.workspace_id AND wm.user_id = n.user_id
    )
    AND (
      n.task_id IS NULL
      OR EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.id = n.task_id AND t.deleted_at IS NULL
          AND (
            t.team_id IS NULL
            OR EXISTS (
              SELECT 1 FROM workspace_members admin_member
              WHERE admin_member.workspace_id = n.workspace_id
                AND admin_member.user_id = n.user_id
                AND admin_member.role IN ('owner', 'admin')
            )
            OR EXISTS (
              SELECT 1 FROM team_members visible_member
              WHERE visible_member.team_id = t.team_id
                AND visible_member.workspace_id = n.workspace_id
                AND visible_member.user_id = n.user_id
            )
        )
      )
    )
    AND (
      (
        n.type <> 'calendar_event'
        AND (n.entity_type IS NULL OR n.entity_type <> 'calendar_event')
      )
      OR EXISTS (
        SELECT 1 FROM calendar_events ce
        WHERE ce.id = n.entity_id
          AND ce.workspace_id = n.workspace_id
          AND (
            ce.team_id IS NULL
            OR EXISTS (
              SELECT 1 FROM workspace_members calendar_admin
              WHERE calendar_admin.workspace_id = n.workspace_id
                AND calendar_admin.user_id = n.user_id
                AND calendar_admin.role IN ('owner', 'admin')
            )
            OR EXISTS (
              SELECT 1 FROM team_members calendar_member
              WHERE calendar_member.team_id = ce.team_id
                AND calendar_member.workspace_id = n.workspace_id
                AND calendar_member.user_id = n.user_id
            )
          )
      )
    )${service}`;
}

function parseNotificationQuery(req, HttpError) {
  const query = req.query || {};
  const hasQuery = Object.keys(query).length > 0;
  const type = query.type ? String(query.type).trim() : "";
  if (type && !MOBILE_TYPES.has(type) && type !== "service_renewal") {
    throw httpError(HttpError, 400, "notification type is invalid");
  }
  const workspaceId = query.workspaceId ? String(query.workspaceId).trim() : "";
  const unreadValue = query.unread ?? query.read;
  let unread = null;
  if (unreadValue !== undefined) {
    const value = String(unreadValue).toLowerCase();
    if (["1", "true", "yes"].includes(value)) unread = true;
    else if (["0", "false", "no"].includes(value)) unread = false;
    else throw httpError(HttpError, 400, "unread filter is invalid");
    if (query.read !== undefined) unread = !unread;
  }
  const rawPage = query.page ?? "1";
  const page = Number(rawPage);
  const rawPageSize = query.pageSize ?? query.limit ?? MOBILE_NOTIFICATION_PAGE_SIZE;
  const pageSize = Number(rawPageSize);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
    throw httpError(HttpError, 400, "page is invalid");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MOBILE_MAX_PAGE_SIZE)
    throw httpError(HttpError, 400, "pageSize is invalid");
  return { hasQuery, type, workspaceId, unread, page, pageSize };
}

function notificationRows(db, userId, query) {
  const hasServiceId = true;
  const where = [notificationAccessSql(hasServiceId)];
  const params = [userId];
  if (query.workspaceId) {
    where.push("n.workspace_id = ?");
    params.push(query.workspaceId);
  }
  if (query.type) {
    where.push("n.type = ?");
    params.push(query.type);
  }
  if (query.unread !== null) where.push(query.unread ? "n.read_at IS NULL" : "n.read_at IS NOT NULL");
  const whereSql = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS count FROM notifications n WHERE ${whereSql}`).get(...params).count;
  const offset = (query.page - 1) * query.pageSize;
  const rows = db
    .prepare(
      `SELECT n.* FROM notifications n
       WHERE ${whereSql}
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, offset)
    .map(notificationJson);
  return { rows, total: Number(total), offset };
}

function mobilePayload(db, auth, clock, token, expiresAt) {
  const user = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.is_platform_admin,
              wm.role, w.name AS workspace_name, w.industry AS workspace_industry,
              w.suspended_at AS workspace_suspended_at
       FROM users u
       JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ?
       JOIN workspaces w ON w.id = wm.workspace_id
       WHERE u.id = ?`,
    )
    .get(auth.workspaceId, auth.userId);
  const workspace = user
    ? workspaceJson({
        id: auth.workspaceId,
        name: user.workspace_name,
        industry: user.workspace_industry,
        suspended_at: user.workspace_suspended_at,
      })
    : auth.workspace;
  const userValue = user
    ? userJson({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_platform_admin: user.is_platform_admin,
      })
    : auth.user;
  return {
    token,
    expiresAt,
    user: userValue,
    workspace,
    subscription: subscriptionJson(
      db.prepare("SELECT * FROM subscriptions WHERE workspace_id = ?").get(auth.workspaceId),
      clock,
    ),
  };
}

function createMobileSession(db, userId, workspaceId, config, clock) {
  const token = createToken(32);
  const now = new Date(nowIso(clock));
  const days = Number(config.mobileSessionDays || config.sessionDays || 30);
  const expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
  const id = createId("ses_");
  db.prepare(
    `INSERT INTO sessions(id, token_hash, user_id, workspace_id, expires_at, created_at, kind)
     VALUES (?, ?, ?, ?, ?, ?, 'mobile')`,
  ).run(id, hashToken(token), userId, workspaceId, expiresAt, now.toISOString());
  return { id, token, expiresAt };
}

function removeInvalidDevices(db, clock) {
  const now = nowIso(clock);
  db.prepare(
    `DELETE FROM mobile_devices
     WHERE session_id IN (
       SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.kind = 'mobile' AND (u.disabled_at IS NOT NULL OR s.expires_at <= ?)
     )`,
  ).run(now);
}

/**
 * Process due FCM outbox entries.  The transport receives one token at a time
 * so tests can inject a deterministic function and production can use HTTP
 * v1 without changing persistence code.
 */
export async function processNotificationOutbox({
  db,
  clock = () => new Date(),
  transport = null,
  limit = 100,
} = {}) {
  if (!db) throw new Error("processNotificationOutbox requires a database");
  const send = typeof transport === "function"
    ? transport
    : typeof transport?.send === "function"
      ? transport.send.bind(transport)
      : null;
  if (!send) return { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const previousRun = notificationOutboxLocks.get(db);
  let releaseRun;
  const thisRun = new Promise((resolve) => {
    releaseRun = resolve;
  });
  notificationOutboxLocks.set(db, thisRun);
  if (previousRun) await previousRun;
  try {
    const now = nowIso(clock);
    removeInvalidDevices(db, clock);
    const rows = db
    .prepare(
      `SELECT o.*, n.type, n.title, n.message
       FROM notification_outbox o
       JOIN notifications n ON n.id = o.notification_id
       JOIN users u ON u.id = o.user_id AND u.disabled_at IS NULL
       WHERE o.status = 'pending' AND o.next_attempt_at <= ?
       ORDER BY o.created_at, o.id LIMIT ?`,
    )
      .all(now, Math.max(1, Math.min(Number(limit) || 100, 500)));
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const outbox of rows) {
    if (!MOBILE_TYPES.has(outbox.type)) {
      db.prepare("UPDATE notification_outbox SET status='skipped', sent_at=? WHERE id=?").run(now, outbox.id);
      skipped++;
      continue;
    }
    let payload;
    try {
      payload = JSON.parse(outbox.payload_json);
    } catch {
      payload = { notificationId: outbox.notification_id, type: outbox.type, title: outbox.title, message: outbox.message };
    }
    const devices = db
      .prepare(
        `SELECT d.*
         FROM mobile_devices d
         JOIN sessions s ON s.id = d.session_id AND s.user_id = d.user_id AND s.kind = 'mobile'
         JOIN users u ON u.id = d.user_id AND u.disabled_at IS NULL
         JOIN workspace_members wm ON wm.workspace_id = ? AND wm.user_id = d.user_id
         WHERE d.user_id = ? AND d.created_at <= ? AND s.expires_at > ?`,
      )
      .all(outbox.workspace_id, outbox.user_id, outbox.created_at, now);
    if (!devices.length) {
      db.prepare("UPDATE notification_outbox SET status='skipped', sent_at=? WHERE id=?").run(now, outbox.id);
      skipped++;
      continue;
    }
    // Materialize one delivery row per installation.  A successful device is
    // never retried when another installation fails later.
    const ensureDelivery = db.prepare(
      `INSERT INTO notification_outbox_deliveries
       (outbox_id, installation_id, status, attempts, next_attempt_at, created_at)
       VALUES (?, ?, 'pending', 0, ?, ?) ON CONFLICT DO NOTHING`,
    );
    for (const device of devices)
      ensureDelivery.run(outbox.id, device.installation_id, outbox.next_attempt_at, outbox.created_at);
    const dueDeliveries = db.prepare(
      `SELECT d.*, m.fcm_token, m.user_id, m.session_id, m.platform
       FROM notification_outbox_deliveries d
       JOIN mobile_devices m ON m.installation_id=d.installation_id
       WHERE d.outbox_id=? AND d.status='pending' AND d.next_attempt_at<=?
       ORDER BY d.installation_id`,
    ).all(outbox.id, now);
    let lastError = "";
    for (const delivery of dueDeliveries) {
      // Recheck authorization after materializing delivery rows. A workspace
      // membership, session, or account can be revoked between selecting the
      // recipients and the actual network call.
      const authorized = db.prepare(
        `SELECT 1
         FROM mobile_devices m
         JOIN sessions s ON s.id=m.session_id AND s.user_id=m.user_id AND s.kind='mobile'
         JOIN users u ON u.id=m.user_id AND u.disabled_at IS NULL
         JOIN workspace_members wm ON wm.workspace_id=? AND wm.user_id=m.user_id
         WHERE m.installation_id=? AND m.user_id=? AND m.session_id=? AND s.expires_at>?`,
      ).get(
        outbox.workspace_id,
        delivery.installation_id,
        outbox.user_id,
        delivery.session_id,
        now,
      );
      if (db.prepare('SELECT status FROM notification_outbox WHERE id=?').get(outbox.id)?.status !== 'pending') break;
      const notice = db.prepare('SELECT * FROM notifications WHERE id=?').get(outbox.notification_id);
      const access = db.prepare(`SELECT 1 FROM notifications n WHERE n.id=? AND ${notificationAccessSql(true)}`).get(outbox.notification_id,outbox.user_id);
      const reminder = ['task_reminder','service_renewal'].includes(outbox.type);
      if (!authorized || !access || (reminder && !reminderDeliveryAllowed(db,notice,now))) {
        db.prepare(
          `UPDATE notification_outbox_deliveries
           SET status='skipped', last_error='authorization revoked'
           WHERE outbox_id=? AND installation_id=?`,
        ).run(outbox.id, delivery.installation_id);
        continue;
      }
      if (outbox.type === 'task_reminder') {
        const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(notice.task_id);
        if (task && !legacyReminderAllowed(db,task,outbox.user_id,now)) continue;
      }
      try {
        const result = await send({
          token: delivery.fcm_token,
          device: delivery,
          outbox,
          notification: payload,
        });
        if (result && result.ok === false) {
          const error = new Error(result.error || "FCM transport rejected message");
          error.permanent = Boolean(result.permanent);
          throw error;
        }
        db.prepare(
          `UPDATE notification_outbox_deliveries
           SET status='sent', attempts=attempts+1, sent_at=?, last_error=NULL
           WHERE outbox_id=? AND installation_id=?`,
        ).run(now, outbox.id, delivery.installation_id);
      } catch (error) {
        lastError = String(error?.message || error || "push delivery failed").slice(0, 1000);
        const permanent = Boolean(
          error?.permanent ||
            [400, 404, 410].includes(Number(error?.status || error?.statusCode)) ||
            /UNREGISTERED|INVALID_ARGUMENT|not.?registered|invalid.?token/i.test(lastError),
        );
        if (permanent) {
          db.prepare(
            `UPDATE notification_outbox_deliveries
             SET status='failed', attempts=attempts+1, sent_at=NULL, last_error=?
             WHERE outbox_id=? AND installation_id=?`,
          ).run(lastError, outbox.id, delivery.installation_id);
          db.prepare("DELETE FROM mobile_devices WHERE installation_id=? AND user_id=?").run(delivery.installation_id, outbox.user_id);
        } else {
          const attempt = Number(delivery.attempts || 0) + 1;
          const status = attempt >= FCM_MAX_ATTEMPTS ? "failed" : "pending";
          const delay = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempt, 10));
          db.prepare(
            `UPDATE notification_outbox_deliveries
             SET status=?, attempts=?, next_attempt_at=?, last_error=?
             WHERE outbox_id=? AND installation_id=?`,
          ).run(status, attempt, addMilliseconds(now, delay), lastError, outbox.id, delivery.installation_id);
        }
      }
    }
    if (db.prepare('SELECT status FROM notification_outbox WHERE id=?').get(outbox.id)?.status !== 'pending') { skipped++; continue; }
    const state = db.prepare(
      `SELECT
         SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         MIN(CASE WHEN status='pending' THEN next_attempt_at END) AS next_attempt_at
       FROM notification_outbox_deliveries WHERE outbox_id=?`,
    ).get(outbox.id);
    if (!state || Number(state.pending || 0) + Number(state.sent || 0) + Number(state.failed || 0) === 0) {
      db.prepare("UPDATE notification_outbox SET status='skipped', sent_at=? WHERE id=?").run(now, outbox.id);
      skipped++;
    } else if (Number(state.pending || 0) === 0 && Number(state.sent || 0) === 0 && Number(state.failed || 0) > 0) {
      db.prepare(
        `UPDATE notification_outbox
         SET status='failed', attempts=attempts+1, sent_at=NULL, last_error=?
         WHERE id=?`,
      ).run(lastError || "push delivery failed", outbox.id);
      failed++;
    } else if (Number(state.pending || 0) === 0) {
      db.prepare(
        `UPDATE notification_outbox
         SET status='sent', attempts=attempts+1, sent_at=?, last_error=NULL
         WHERE id=?`,
      ).run(now, outbox.id);
      sent++;
    } else {
      const attempt = Number(outbox.attempts || 0) + 1;
      db.prepare(
        `UPDATE notification_outbox
         SET status='pending', attempts=?, next_attempt_at=?, last_error=?
         WHERE id=?`,
      ).run(attempt, state.next_attempt_at || addMilliseconds(now, 2000), lastError || "push delivery failed", outbox.id);
      failed++;
    }
    }
    return { processed: rows.length, sent, failed, skipped };
  } finally {
    releaseRun();
    if (notificationOutboxLocks.get(db) === thisRun) notificationOutboxLocks.delete(db);
  }
}

function serviceAccount(config) {
  const env = config?.env || process.env;
  const json = env.FCM_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(String(json));
      return {
        projectId: String(parsed.project_id || env.FCM_PROJECT_ID || ""),
        clientEmail: String(parsed.client_email || ""),
        privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n"),
      };
    } catch {
      return null;
    }
  }
  if (env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY) {
    return {
      projectId: String(env.FCM_PROJECT_ID),
      clientEmail: String(env.FCM_CLIENT_EMAIL),
      privateKey: String(env.FCM_PRIVATE_KEY).replace(/\\n/g, "\n"),
    };
  }
  return null;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

/** Return null when FCM credentials are absent, keeping push disabled by default. */
export function createFcmTransport(config = {}) {
  const account = serviceAccount(config);
  if (!account?.projectId || !account.clientEmail || !account.privateKey) return null;
  let accessToken = null;
  let accessTokenExpiresAt = 0;
  async function token() {
    if (accessToken && accessTokenExpiresAt > Date.now() + 60_000) return accessToken;
    const issued = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64url(JSON.stringify({
      iss: account.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: issued,
      exp: issued + 3600,
    }));
    const { createSign } = await import("node:crypto");
    const signature = createSign("RSA-SHA256").update(`${header}.${claim}`).sign(account.privateKey, "base64url");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(`${header}.${claim}.${signature}`)}`,
    });
    if (!response.ok) throw new Error(`FCM OAuth token request failed (${response.status})`);
    const body = await response.json();
    accessToken = String(body.access_token || "");
    accessTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
    if (!accessToken) throw new Error("FCM OAuth token response did not contain an access token");
    return accessToken;
  }
  return async ({ token: deviceToken, notification }) => {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          // Keep lock-screen text generic.  The app fetches the notification
          // resource after opening it, so business details are never exposed
          // by a provider preview.
          notification: { title: "Nhắc Tôi", body: "Bạn có cập nhật mới." },
          data: Object.fromEntries(
            ["userId", "workspaceId", "notificationId", "taskId", "entityType", "entityId"]
              .filter((key) => notification?.[key] !== null && notification?.[key] !== undefined)
              .map((key) => [key, String(notification[key])]),
          ),
        },
      }),
    });
    if (response.ok) return { ok: true };
    let body = "";
    try { body = await response.text(); } catch {}
    const permanent = response.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(body);
    const error = new Error(`FCM send failed (${response.status})`);
    error.permanent = permanent;
    throw error;
  };
}

export function registerMobileRoutes(app, {
  db,
  config,
  clock,
  requireAuth,
  authRateLimiter,
  HttpError,
  withTransaction,
  authContext,
  setSessionCookie,
}) {
  const requireMobile = mobileAuth(requireAuth, db, clock, HttpError);
  const authPayload = (req, token = req.mobileToken, expiresAt = req.auth.expiresAt) =>
    mobilePayload(db, req.auth, clock, token, expiresAt);

  app.post(
    "/api/mobile/auth/login",
    authRateLimiter,
    (req, res, next) => {
      try {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length > 256) {
          req.noteAuthFailure?.();
          return res.status(401).json({ error: "email or password is incorrect" });
        }
        const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        if (!user || !verifyPassword(password, user.password_hash)) {
          req.noteAuthFailure?.();
          return res.status(401).json({ error: "email or password is incorrect" });
        }
        if (user.disabled_at) {
          req.clearAuthFailures?.();
          return res.status(403).json({ error: "user account is disabled" });
        }
        const requestedWorkspace = req.body?.workspaceId ? String(req.body.workspaceId).trim() : "";
        const membership = requestedWorkspace
          ? workspaceMembership(db, user.id, requestedWorkspace)
          : db.prepare(
              `SELECT w.id, w.name, w.industry, w.suspended_at, wm.role
               FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
               WHERE wm.user_id=? ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, w.name LIMIT 1`,
            ).get(user.id);
        if (!membership) return res.status(403).json({ error: "user has no workspace membership" });
        const session = createMobileSession(db, user.id, membership.id, config, clock);
        req.clearAuthFailures?.();
        const auth = authContext(db, session.token, clock);
        if (!auth) return res.status(401).json({ error: "could not create mobile session" });
        auth.expiresAt = session.expiresAt;
        auth.sessionKind = "mobile";
        return res.json({
          token: session.token,
          expiresAt: session.expiresAt,
          user: auth.user,
          workspace: auth.workspace,
          subscription: subscriptionJson(db.prepare("SELECT * FROM subscriptions WHERE workspace_id=?").get(membership.id), clock),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post("/api/mobile/auth/logout", requireMobile, (req, res, next) => {
    try {
      db.prepare("DELETE FROM sessions WHERE id=? AND user_id=? AND kind='mobile'").run(req.auth.sessionId, req.auth.userId);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/mobile/workspaces", requireMobile, (req, res, next) => {
    try {
      const workspaces = db.prepare(
        `SELECT w.id,w.name,w.industry,w.suspended_at,wm.role
         FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id
         WHERE wm.user_id=? ORDER BY w.name`,
      ).all(req.auth.userId).map((row) => ({ ...workspaceJson(row), role: row.role }));
      return res.json({ workspaces });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/mobile/workspaces/switch", requireMobile, (req, res, next) => {
    try {
      const workspaceId = clean(req.body?.workspaceId, 100, "workspaceId");
      const membership = workspaceMembership(db, req.auth.userId, workspaceId);
      if (!membership) return res.status(403).json({ error: "you are not a member of this workspace" });
      const changed = db.prepare(
        "UPDATE sessions SET workspace_id=? WHERE id=? AND user_id=? AND kind='mobile'",
      ).run(workspaceId, req.auth.sessionId, req.auth.userId);
      if (!changed.changes) return res.status(401).json({ error: "mobile authentication required" });
      const auth = authContext(db, req.mobileToken, clock);
      if (!auth) return res.status(401).json({ error: "mobile authentication required" });
      auth.expiresAt = req.auth.expiresAt;
      auth.sessionKind = "mobile";
      req.auth = auth;
      return res.json(authPayload(req, req.mobileToken, req.auth.expiresAt));
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/mobile/devices/:installationId", requireMobile, (req, res, next) => {
    try {
      const installationId = clean(req.params.installationId, 200, "installationId");
      const fcmToken = clean(req.body?.fcmToken ?? req.body?.token, 4096, "fcmToken");
      const platform = String(req.body?.platform || "android").trim().slice(0, 40) || "android";
      const now = nowIso(clock);
      withTransaction(db, () => {
        const existingToken = db.prepare("SELECT installation_id,user_id,session_id FROM mobile_devices WHERE fcm_token=?").get(fcmToken);
        if (existingToken && existingToken.user_id !== req.auth.userId) {
          throw httpError(HttpError, 409, "device token is already registered to another account");
        }
        if (existingToken && existingToken.installation_id !== installationId) {
          // A rotated installation id from the same account must not leave a
          // stale token that can receive duplicate pushes.
          db.prepare("DELETE FROM mobile_devices WHERE installation_id=? AND user_id=?")
            .run(existingToken.installation_id, req.auth.userId);
        }
        const existing = db.prepare("SELECT installation_id,user_id,created_at FROM mobile_devices WHERE installation_id=?").get(installationId);
        if (existing && existing.user_id !== req.auth.userId) {
          throw httpError(HttpError, 403, "device installation belongs to another account");
        }
        db.prepare(
          `INSERT INTO mobile_devices(installation_id,user_id,session_id,fcm_token,platform,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(installation_id) DO UPDATE SET
             user_id=excluded.user_id, session_id=excluded.session_id,
             fcm_token=excluded.fcm_token, platform=excluded.platform, updated_at=excluded.updated_at`,
        ).run(installationId, req.auth.userId, req.auth.sessionId, fcmToken, platform, existing?.created_at || now, now);
      });
      return res.json({ ok: true, device: { installationId, platform } });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/mobile/devices/:installationId", requireMobile, (req, res, next) => {
    try {
      const installationId = clean(req.params.installationId, 200, "installationId");
      const result = db.prepare(
        "DELETE FROM mobile_devices WHERE installation_id=? AND user_id=? AND session_id=?",
      ).run(installationId, req.auth.userId, req.auth.sessionId);
      if (!result.changes) return res.status(404).json({ error: "device was not found" });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/mobile/notifications", requireMobile, (req, res, next) => {
    try {
      const query = parseNotificationQuery(req, HttpError);
      if (query.workspaceId && !workspaceMembership(db, req.auth.userId, query.workspaceId)) {
        return res.status(403).json({ error: "you are not a member of this workspace" });
      }
      const result = notificationRows(db, req.auth.userId, query);
      const response = { notifications: result.rows };
      if (query.hasQuery) {
        response.page = query.page;
        response.pageSize = query.pageSize;
        response.total = result.total;
        response.hasMore = result.offset + result.rows.length < result.total;
      }
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/mobile/notifications/:id/read", requireMobile, (req, res, next) => {
    try {
      const id = clean(req.params.id, 200, "id");
      const readAt = nowIso(clock);
      const hasServiceId = true;
      const existing = db.prepare(
        `SELECT n.id FROM notifications n WHERE n.id=? AND ${notificationAccessSql(hasServiceId)}`,
      ).get(id, req.auth.userId);
      if (!existing) return res.status(404).json({ error: "notification was not found" });
      const result = db.prepare(
        "UPDATE notifications SET read_at=? WHERE id=? AND user_id=?",
      ).run(readAt, id, req.auth.userId);
      if (!result.changes) return res.status(404).json({ error: "notification was not found" });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  // The mobile-specific path permits opening an event from another member
  // workspace when a push was received while the session was on a different
  // workspace.  The regular /api/calendar-events/:id route remains scoped to
  // the active web/mobile workspace.
  app.get("/api/mobile/calendar-events/:id", requireMobile, (req, res, next) => {
    try {
      const event = db.prepare(
        `SELECT e.* FROM calendar_events e
         JOIN workspace_members wm ON wm.workspace_id=e.workspace_id AND wm.user_id=?
         WHERE e.id=?`,
      ).get(req.auth.userId, req.params.id);
      if (!event || !canAccessTeamTask(db, event.workspace_id, req.auth.userId, event.team_id)) {
        return res.status(404).json({ error: "calendar event was not found" });
      }
      const membership = db.prepare(
        "SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?",
      ).get(event.workspace_id, req.auth.userId);
      return res.json({ event: {
        ...event,
        canEdit: canAccessTeamTask(db, event.workspace_id, req.auth.userId, event.team_id, { write: true }) &&
          (event.created_by === req.auth.userId || ["owner", "admin"].includes(membership?.role)),
        id: event.id,
        workspaceId: event.workspace_id,
        teamId: event.team_id,
        title: event.title,
        description: event.description,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        remindAt: event.remind_at,
        createdBy: event.created_by,
        createdAt: event.created_at,
        updatedAt: event.updated_at,
      } });
    } catch (error) {
      return next(error);
    }
  });
}
