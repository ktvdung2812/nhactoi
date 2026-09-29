import webpush from 'web-push';
import { createECDH } from 'node:crypto';
import { createId } from './auth.mjs';
import { canAccessTeamTask } from './teams.mjs';
import { reminderDeliveryAllowed, legacyReminderAllowed } from './reminder-workflow.mjs';

export const WEB_PUSH_SCHEMA = `
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
 id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS web_push_user_idx ON web_push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS web_push_deliveries (
 notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, sent_at TEXT, last_error TEXT,
 PRIMARY KEY(notification_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS web_push_due_idx ON web_push_deliveries(status,next_attempt_at);
CREATE TRIGGER IF NOT EXISTS notifications_web_push_ai AFTER INSERT ON notifications
WHEN NEW.type IN ('task_reminder','task_update','calendar_event','service_renewal')
BEGIN
 INSERT INTO web_push_deliveries(notification_id,subscription_id,next_attempt_at)
 SELECT NEW.id,id,NEW.created_at FROM web_push_subscriptions WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS web_push_task_reset AFTER UPDATE OF due_at,assignee_id,team_id ON tasks
WHEN OLD.due_at IS NOT NEW.due_at OR OLD.assignee_id IS NOT NEW.assignee_id OR OLD.team_id IS NOT NEW.team_id
BEGIN
 UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN
 (SELECT id FROM notifications WHERE task_id=NEW.id AND type='task_reminder');
END;
CREATE TRIGGER IF NOT EXISTS web_push_event_reset AFTER UPDATE OF starts_at,ends_at,remind_at,team_id ON calendar_events
WHEN OLD.starts_at IS NOT NEW.starts_at OR OLD.ends_at IS NOT NEW.ends_at OR OLD.remind_at IS NOT NEW.remind_at OR OLD.team_id IS NOT NEW.team_id
BEGIN
 UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN
 (SELECT id FROM notifications WHERE entity_id=NEW.id AND type='calendar_event');
END;
CREATE TRIGGER IF NOT EXISTS web_push_snooze AFTER UPDATE OF snoozed_until ON task_reminder_responses
WHEN NEW.snoozed_until IS NOT NULL AND OLD.snoozed_until IS NOT NEW.snoozed_until
BEGIN
 UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN
 (SELECT id FROM notifications WHERE task_id=NEW.task_id AND user_id=NEW.user_id AND type='task_reminder');
END;
`;

// Only browser push services are network targets. Never send to arbitrary
// subscription URLs (including private networks or lookalike hostnames).
export function validPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname));
  } catch { return false; }
}
export function validatePushSubscription(input) {
  if (!input || !validPushEndpoint(input.endpoint)) throw new Error('Địa chỉ dịch vụ push không được hỗ trợ.');
  const key = (value, length) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').length === length && Buffer.from(value, 'base64url').toString('base64url') === value;
  if (!key(input.keys?.p256dh, 65) || !key(input.keys?.auth, 16)) throw new Error('Khóa đăng ký push không hợp lệ.');
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  try { ecdh.computeSecret(Buffer.from(input.keys.p256dh, 'base64url')); }
  catch { throw new Error('Khóa đăng ký push không hợp lệ.'); }
  return { endpoint: input.endpoint, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}
export function webPushConfig(env = {}) {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY || '', privateKey = env.WEB_PUSH_PRIVATE_KEY || '', subject = env.WEB_PUSH_SUBJECT || '';
  if (!publicKey || !privateKey || !subject) return { enabled: false, publicKey: null, transport: null };
  try {
    const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (ecdh.getPublicKey().toString('base64url') !== publicKey) throw new Error('key mismatch');
    // Validate without mutating web-push's process-global VAPID configuration.
    webpush.generateRequestDetails({ endpoint: 'https://fcm.googleapis.com/fcm/send/validate' }, null, { vapidDetails: { publicKey, privateKey, subject } });
  } catch { return { enabled: false, publicKey: null, transport: null }; }
  return { enabled: true, publicKey, transport: (subscription, payload) => webpush.sendNotification(subscription, JSON.stringify(payload), {
    vapidDetails: { publicKey, privateKey, subject }, TTL: 3600, timeout: 10000, urgency: 'normal',
  }) };
}

export function webNotificationAllowed(db, notice, now) {
  if (!notice || !db.prepare(`SELECT 1 FROM users u JOIN workspace_members m ON m.user_id=u.id
    JOIN workspaces w ON w.id=m.workspace_id JOIN subscriptions s ON s.workspace_id=w.id
    WHERE u.id=? AND m.workspace_id=? AND u.disabled_at IS NULL AND w.suspended_at IS NULL
    AND s.status NOT IN ('expired','canceled') AND s.current_period_end>?`).get(notice.user_id, notice.workspace_id, now)) return false;
  if (notice.type === 'calendar_event') {
    const event = db.prepare('SELECT * FROM calendar_events WHERE id=? AND workspace_id=?').get(notice.entity_id, notice.workspace_id);
    return !!event && event.status !== 'done' && event.ends_at > now && canAccessTeamTask(db, notice.workspace_id, notice.user_id, event.team_id, { write: true });
  }
  return reminderDeliveryAllowed(db, notice, now);
}

function pruneSubscriptions(db, now) {
  db.prepare(`DELETE FROM web_push_subscriptions WHERE session_id IN (SELECT id FROM sessions WHERE expires_at<=?)
    OR user_id IN (SELECT id FROM users WHERE disabled_at IS NOT NULL)`).run(now);
}

export function registerWebPushRoutes(app, { db, clock, requireAuth, HttpError, config, withTransaction }) {
  const webOnly = (req, res, next) => { if (req.auth.sessionKind !== 'web') return next(new HttpError(403, 'Chỉ dùng cho phiên trình duyệt.')); next(); };
  app.use('/api/web-push', (req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  app.get('/api/web-push/config', requireAuth, webOnly, (req, res) => res.json({ enabled: config.enabled, publicKey: config.publicKey }));
  app.post('/api/web-push/subscription/status', requireAuth, webOnly, (req, res) => {
    const row = typeof req.body?.endpoint === 'string' && db.prepare('SELECT id FROM web_push_subscriptions WHERE endpoint=? AND user_id=? AND session_id=?').get(req.body.endpoint, req.auth.userId, req.auth.sessionId);
    res.json({ subscribed: !!row });
  });
  app.post('/api/web-push/subscriptions', requireAuth, webOnly, (req, res, next) => {
    try {
      if (!config.enabled) throw new HttpError(503, 'Máy chủ chưa cấu hình Web Push.');
      let sub;
      try { sub = validatePushSubscription(req.body); } catch (e) { throw new HttpError(400, e.message); }
      pruneSubscriptions(db, new Date(clock()).toISOString());
      const existing = db.prepare('SELECT * FROM web_push_subscriptions WHERE endpoint=?').get(sub.endpoint);
      if (existing && existing.user_id !== req.auth.userId) throw new HttpError(409, 'Trình duyệt còn đăng ký cho tài khoản khác. Hãy tắt đăng ký cũ trước.');
      if (!existing && db.prepare('SELECT count(*) n FROM web_push_subscriptions WHERE user_id=?').get(req.auth.userId).n >= 10) throw new HttpError(409, 'Tối đa 10 trình duyệt. Đăng xuất một trình duyệt cũ trước khi thêm.');
      const now = new Date(clock()).toISOString();
      // Refresh the binding without replaying deliveries from an old session.
      withTransaction(db, () => {
      if (existing && (existing.session_id !== req.auth.sessionId || existing.p256dh !== sub.keys.p256dh || existing.auth !== sub.keys.auth)) db.prepare('DELETE FROM web_push_subscriptions WHERE id=?').run(existing.id);
      db.prepare(`INSERT INTO web_push_subscriptions(id,endpoint,p256dh,auth,user_id,session_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET updated_at=excluded.updated_at`).run(createId('webpush_'), sub.endpoint, sub.keys.p256dh, sub.keys.auth, req.auth.userId, req.auth.sessionId, now, now);
      });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.delete('/api/web-push/subscriptions', requireAuth, webOnly, (req, res) => {
    if (typeof req.body?.endpoint === 'string') db.prepare('DELETE FROM web_push_subscriptions WHERE endpoint=? AND user_id=?').run(req.body.endpoint, req.auth.userId);
    res.json({ ok: true });
  });
  app.get('/api/web-push/notifications/:id', requireAuth, webOnly, (req, res, next) => {
    const notice = db.prepare('SELECT * FROM notifications WHERE id=? AND user_id=?').get(req.params.id, req.auth.userId);
    if (!webNotificationAllowed(db, notice, new Date(clock()).toISOString())) return next(new HttpError(404, 'Thông báo không còn khả dụng.'));
    res.json({ workspaceId: notice.workspace_id, path: notice.task_id ? `/tasks/${encodeURIComponent(notice.task_id)}` : notice.type === 'service_renewal' ? `/services?service=${encodeURIComponent(notice.service_id || notice.entity_id)}` : `/tasks?event=${encodeURIComponent(notice.entity_id)}` });
  });
}

const runs = new WeakMap();
export async function processWebPush({ db, clock = () => new Date(), transport }) {
  pruneSubscriptions(db, new Date(clock()).toISOString());
  if (!transport) return { sent: 0, failed: 0, skipped: 0 };
  if (runs.has(db)) return runs.get(db);
  const run = (async () => {
    const stats = { sent: 0, failed: 0, skipped: 0 };
    const now = new Date(clock()).toISOString();
    const rows = db.prepare(`SELECT d.notification_id,d.subscription_id,d.attempts FROM web_push_deliveries d
      WHERE d.status='pending' AND d.next_attempt_at<=? ORDER BY d.next_attempt_at LIMIT 100`).all(now);
    for (const row of rows) {
      const current = db.prepare(`SELECT p.* FROM web_push_deliveries d JOIN web_push_subscriptions p ON p.id=d.subscription_id
        JOIN sessions s ON s.id=p.session_id AND s.user_id=p.user_id AND s.kind='web'
        WHERE d.notification_id=? AND d.subscription_id=? AND d.status='pending' AND s.expires_at>?`).get(row.notification_id, row.subscription_id, new Date(clock()).toISOString());
      const notice = db.prepare('SELECT * FROM notifications WHERE id=?').get(row.notification_id);
      const update = (status, error = null) => db.prepare("UPDATE web_push_deliveries SET status=?,last_error=? WHERE notification_id=? AND subscription_id=? AND status='pending'").run(status, error, row.notification_id, row.subscription_id);
      if (!current || !notice || notice.user_id !== current.user_id || notice.read_at || Date.parse(now) - Date.parse(notice.created_at) > 86400000 || !webNotificationAllowed(db, notice, new Date(clock()).toISOString())) {
        update('skipped'); stats.skipped++; continue;
      }
      if (notice.type === 'task_reminder') {
        const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(notice.task_id);
        if (!legacyReminderAllowed(db, task, notice.user_id, now)) {
          db.prepare("UPDATE web_push_deliveries SET next_attempt_at=? WHERE notification_id=? AND subscription_id=? AND status='pending'").run(new Date(Date.parse(now) + 60000).toISOString(), row.notification_id, row.subscription_id);
          continue;
        }
      }
      try {
        const subscription = validatePushSubscription({ endpoint: current.endpoint, keys: { p256dh: current.p256dh, auth: current.auth } });
        await transport(subscription, { notificationId: notice.id });
        db.prepare("UPDATE web_push_deliveries SET status='sent',attempts=attempts+1,sent_at=?,last_error=NULL WHERE notification_id=? AND subscription_id=? AND status='pending'").run(new Date(clock()).toISOString(), row.notification_id, row.subscription_id);
        stats.sent++;
      } catch (error) {
        const status = Number(error?.statusCode || 0);
        if (status === 404 || status === 410) db.prepare('DELETE FROM web_push_subscriptions WHERE id=? AND endpoint=?').run(current.id, current.endpoint);
        else {
          const attempts = row.attempts + 1;
          const retry = (status === 0 || status === 429 || status >= 500) && attempts < 5;
          db.prepare("UPDATE web_push_deliveries SET status=?,attempts=?,next_attempt_at=?,last_error=? WHERE notification_id=? AND subscription_id=? AND status='pending'")
            .run(retry ? 'pending' : 'failed', attempts, new Date(Date.parse(now) + Math.min(3600000, 60000 * 2 ** (attempts - 1))).toISOString(), status ? `HTTP ${status}` : 'Push transport failed', row.notification_id, row.subscription_id);
        }
        stats.failed++;
      }
    }
    return stats;
  })();
  runs.set(db, run);
  try { return await run; } finally { if (runs.get(db) === run) runs.delete(db); }
}
