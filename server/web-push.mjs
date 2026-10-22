import webpush from 'web-push';
import { claimDelivery, beginDelivery, settleDelivery, deliveryFailure } from './delivery-leases.mjs';
import { outboundSendersPaused } from './restore-safety.mjs';
import { createECDH } from 'node:crypto';
import { createId } from './auth.mjs';
import { canAccessTeamTask } from './teams.mjs';
import { reminderDeliveryAllowed, legacyReminderAllowed, reminderRetryAt } from './reminder-workflow.mjs';

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
  if (outboundSendersPaused(db)) return { sent: 0, failed: 0, skipped: 0, paused: true };
  pruneSubscriptions(db, new Date(clock()).toISOString());
  if (!transport) return { sent: 0, failed: 0, skipped: 0 };
  if (runs.has(db)) return runs.get(db);
  const run = (async () => {
    const stats = { sent: 0, failed: 0, skipped: 0 };
    const now = new Date(clock()).toISOString();
    const rows = db.prepare(`SELECT d.notification_id,d.subscription_id,d.attempts FROM web_push_deliveries d
      WHERE d.status='pending' AND d.next_attempt_at<=? ORDER BY d.next_attempt_at LIMIT 100`).all(now);
    for (const row of rows) {
      if (outboundSendersPaused(db)) return { ...stats, paused: true };
      const claim = claimDelivery(db, 'web_push', row.notification_id, row.subscription_id, new Date(clock()).toISOString());
      if (!claim) continue;
      if (claim.unknown) { db.prepare("UPDATE web_push_deliveries SET status='unknown',last_error='delivery outcome unknown' WHERE notification_id=? AND subscription_id=? AND status='pending'").run(row.notification_id,row.subscription_id); stats.failed++; continue; }
      const current = db.prepare(`SELECT p.* FROM web_push_deliveries d JOIN web_push_subscriptions p ON p.id=d.subscription_id
        JOIN sessions s ON s.id=p.session_id AND s.user_id=p.user_id AND s.kind='web'
        WHERE d.notification_id=? AND d.subscription_id=? AND d.status='pending' AND s.expires_at>?`).get(row.notification_id, row.subscription_id, new Date(clock()).toISOString());
      const notice = db.prepare('SELECT * FROM notifications WHERE id=?').get(row.notification_id);
      const update = (status, error = null) => settleDelivery(db, claim, status === 'skipped' ? 'suppressed' : status, new Date(clock()).toISOString(), () => db.prepare("UPDATE web_push_deliveries SET status=?,last_error=? WHERE notification_id=? AND subscription_id=? AND status='pending'").run(status, error, row.notification_id, row.subscription_id), { error });
      if (!current || !notice || notice.user_id !== current.user_id || notice.read_at || Date.parse(now) - Date.parse(notice.created_at) > 86400000 || !webNotificationAllowed(db, notice, new Date(clock()).toISOString())) {
        update('skipped'); stats.skipped++; continue;
      }
      if (notice.type === 'task_reminder') {
        const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(notice.task_id);
        if (!legacyReminderAllowed(db, task, notice.user_id, now)) {
          const retryAt=reminderRetryAt(db,task,notice.user_id,now);
          settleDelivery(db,claim,'retry',new Date(clock()).toISOString(),()=>db.prepare("UPDATE web_push_deliveries SET next_attempt_at=? WHERE notification_id=? AND subscription_id=? AND status='pending'").run(retryAt, row.notification_id, row.subscription_id),{nextAttemptAt:retryAt,error:"reminder deferred by working hours or quiet policy"});
          continue;
        }
      }
      let subscription;
      try { subscription = validatePushSubscription({ endpoint: current.endpoint, keys: { p256dh: current.p256dh, auth: current.auth } }); }
      catch { update('failed','invalid push subscription'); stats.failed++; continue; }
      if(!beginDelivery(db,claim,new Date(clock()).toISOString()))continue;
      try {
        await transport(subscription, { notificationId: notice.id });
      } catch (error) {
        const failure=deliveryFailure(error,Number(row.attempts)+1,{now:new Date(clock()).toISOString()});
        settleDelivery(db,claim,failure.status==='pending'?'retry':failure.status,new Date(clock()).toISOString(),()=>{
          db.prepare("UPDATE web_push_deliveries SET status=?,attempts=attempts+1,next_attempt_at=?,last_error=? WHERE notification_id=? AND subscription_id=? AND status IN ('pending','unknown')")
            .run(failure.status,failure.nextAttemptAt,failure.error,row.notification_id,row.subscription_id);
          if([404,410].includes(Number(error?.statusCode)))db.prepare('DELETE FROM web_push_subscriptions WHERE id=? AND endpoint=?').run(current.id,current.endpoint);
        },{error:failure.error,nextAttemptAt:failure.nextAttemptAt});
        stats.failed++;continue;
      }
      settleDelivery(db,claim,'sent',new Date(clock()).toISOString(),()=>db.prepare("UPDATE web_push_deliveries SET status='sent',attempts=attempts+1,sent_at=?,last_error=NULL WHERE notification_id=? AND subscription_id=? AND status IN ('pending','unknown')").run(new Date(clock()).toISOString(),row.notification_id,row.subscription_id));
      stats.sent++;
    }
    return stats;
  })();
  runs.set(db, run);
  try { return await run; } finally { if (runs.get(db) === run) runs.delete(db); }
}
