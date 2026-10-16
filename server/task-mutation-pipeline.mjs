import { createHash } from 'node:crypto';
import { withTransaction } from './db.mjs';
import { assertRevision, recordRevision } from './record-revision.mjs';
import { canAccessTask } from './task-access.mjs';
import { getProjectAccess } from './projects.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function mutationFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function withMutationContext(db, context, callback) {
  if (db.dialect !== 'postgres') return callback();
  const previous = db.prepare("SELECT current_setting('nhactoi.mutation_context',true) value").get().value || '';
  db.prepare("SELECT set_config('nhactoi.mutation_context',?,true)").get(JSON.stringify({ ...(previous ? JSON.parse(previous) : {}), ...context }));
  try { return callback(); }
  finally { try { db.prepare("SELECT set_config('nhactoi.mutation_context',?,true)").get(previous); } catch {} }
}

// Only synchronous, JSON task writes belong here. Uploads, provider calls and
// other async handlers must finish their own transaction before doing I/O.
function templateMutation(req) {
  return req.method === 'POST' ? /^\/api\/task-templates\/([^/]+)\/(create|apply)$/.exec(req.path) : null;
}

function supported(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false;
  if (templateMutation(req)) return true;
  if (req.method === 'POST' && /^\/api\/boards\/tasks\/[^/]+\/move$/.test(req.path)) return true;
  return /^\/api\/boards\/tasks\/[^/]+\/move$/.test(req.path) || /^\/api\/tasks(?:\/[^/]+(?:\/extras|\/plan|\/fields|\/timeline|\/copy|\/checklists(?:\/[^/]+(?:\/order|\/copy|\/items(?:\/[^/]+(?:\/convert)?)?)?)?|\/reminders\/(?:acknowledge|snooze))?)?$/.test(req.path);
}

export function registerTaskMutationPipeline(app, { db, clock, ensureWritable, requireAuth, HttpError, authorizeTask }) {
  if (db.dialect !== 'postgres') return;
  const authorize = (req, id, { write = true, allowDeleted = false } = {}) => {
    const row = db.prepare(`SELECT * FROM tasks WHERE id=? AND workspace_id=?${allowDeleted ? '' : ' AND deleted_at IS NULL'}${write ? ' FOR UPDATE' : ''}`).get(id, req.auth.workspaceId);
    if (!row || !canAccessTask(db, req.auth.workspaceId, req.auth.userId, row)) throw new HttpError(404, 'task was not found');
    if (write && !canAccessTask(db, req.auth.workspaceId, req.auth.userId, row, { action: /\/reminders\/(acknowledge|snooze)$/.test(req.path) ? 'comment' : req.method === 'DELETE' && /^\/api\/tasks\/[^/]+$/.test(req.path) ? 'delete' : 'write' })) throw new HttpError(getProjectAccess(db,req.auth.workspaceId,req.auth.userId,row.project_id,{clock})?.readonly ? 409 : 403, 'Bạn không có quyền thay đổi công việc này');
    req.authorizePublicMutation?.(row);
    authorizeTask?.(req, row);
    return row;
  };
  app.get('/api/tasks/:id/events', requireAuth, (req, res, next) => {
    try {
      if (!req.auth) throw new HttpError(401, 'Bạn cần đăng nhập');
      const task = authorize(req, req.params.id, { write: false });
      const rows = db.prepare('SELECT * FROM business_events WHERE workspace_id=? AND task_id=? ORDER BY occurred_at,id').all(req.auth.workspaceId,task.id);
      const snapshot = raw => {
        if (!raw) return null;
        const value = JSON.parse(raw);
        const keys = ['id','title','status','priority','due_at','dueAt','assignee_id','userId','recurrence','acknowledged_at','snoozed_until'];
        return Object.fromEntries(keys.filter(key => Object.hasOwn(value,key)).map(key => [key,value[key]]));
      };
      res.json({ historyCoverage: rows.some(row => row.type === 'task.created') ? 'recorded' : 'unknown',
        events: rows.map(row => ({ id: row.id, type: row.type, actorUserId: row.actor_user_id, source: row.source,
          operationId: row.operation_id, occurredAt: row.occurred_at, before: snapshot(row.before_json), after: snapshot(row.after_json) })),
        assignmentCycles: db.prepare('SELECT id,user_id,started_at,deadline_snapshot,acknowledged_at,closed_at,close_reason,history_known FROM task_assignment_cycles WHERE workspace_id=? AND task_id=? ORDER BY started_at,id').all(req.auth.workspaceId,task.id),
      });
    } catch (error) { next(error); }
  });
  app.use((req, res, next) => {
    if (!supported(req)) return next();
    let allowed = false;
    requireAuth(req,res,() => { allowed = true; });
    if (!allowed) return;
    const originalJson = res.json;
    const originalBody = req.body;
    const rejected = Symbol('rejected mutation');
    let response, captured = false;
    try {
      withTransaction(db, () => {
        ensureWritable(req);
        req.authorizePublicMutation?.();
        const operationId = req.headers['idempotency-key'] ?? originalBody?.operationId;
        if (operationId !== undefined && (typeof operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/.test(operationId)))
          throw new HttpError(400, 'operationId phải chứa 8–160 ký tự hợp lệ');
        if (req.headers['idempotency-key'] && originalBody?.operationId && req.headers['idempotency-key'] !== originalBody.operationId)
          throw new HttpError(400, 'operationId không khớp Idempotency-Key');
        const action = `${req.method} ${req.path}`;
        const payload = { ...(originalBody || {}) };
        delete payload.operationId;
        const fingerprint = mutationFingerprint({ action, payload: req.publicPayload || payload });
        if (operationId) db.prepare('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(?))')
          .get(JSON.stringify([req.auth.workspaceId, req.auth.userId, operationId]));
        const templateRoute = templateMutation(req);
        let taskId = req.path.split('/')[req.path.startsWith('/api/boards/tasks/') ? 4 : 3];
        if (templateRoute) {
          // A receipt must not bypass the current template scope, even when its
          // result task is still accessible. Lock against concurrent deletion.
          const template = db.prepare('SELECT * FROM task_templates WHERE id=? AND workspace_id=? FOR UPDATE')
            .get(templateRoute[1], req.auth.workspaceId);
          const access = template && getProjectAccess(db, req.auth.workspaceId, req.auth.userId, template.project_id,
            { config: db.projectConfig, clock });
          if (!access) throw new HttpError(404, 'template was not found');
          if (!access.canEdit) throw new HttpError(access.readonly ? 409 : 403, 'Bạn không có quyền áp dụng mẫu này');
          taskId = null;
          if (templateRoute[2] === 'apply') {
            if (typeof originalBody?.taskId !== 'string' || !originalBody.taskId.trim() || originalBody.taskId.trim().length > 160)
              throw new HttpError(400, 'taskId is invalid');
            taskId = originalBody.taskId.trim();
          }
        }
        const receipt = operationId ? db.prepare('SELECT * FROM mutation_receipts WHERE workspace_id=? AND principal_id=? AND operation_id=?')
            .get(req.auth.workspaceId, req.auth.userId, operationId) : null;
        const current = taskId ? authorize(req, taskId, { allowDeleted: Boolean(receipt && req.method === 'DELETE' && /^\/api\/tasks\/[^/]+$/.test(req.path)) }) : null;
          if (receipt) {
            if (receipt.payload_hash !== fingerprint || receipt.action !== action) throw new HttpError(409, 'operationId đã dùng với nội dung khác');
            if (receipt.resource_id && receipt.resource_id !== taskId) authorize(req, receipt.resource_id);
            response = JSON.parse(receipt.response_json);
            res.status(receipt.response_status);
            res.set('Idempotency-Replayed', 'true');
            captured = true;
            return;
          }
        if (current && !req.path.endsWith('/plan')) assertRevision(originalBody, current, 'task', HttpError);
        req.expectedRevision = originalBody?.expectedRevision;
        req.body = { ...payload };
        delete req.body.expectedRevision;
        res.json = function (body) { response = JSON.parse(JSON.stringify(body)); captured = true; return this; };
        const now = clock().toISOString();
        withMutationContext(db, {
          actorUserId: req.auth.userId, source: req.publicApi ? 'public_api' : req.mobileToken ? 'android' : 'web',
          operationId: operationId || null, occurredAt: now,
        }, () => next());
        if (!captured) throw new Error('Task mutation handler must respond synchronously');
        if (res.statusCode >= 400) throw rejected;
        // Return the exact committed aggregate revision, including child writes.
        // A later read could otherwise adopt an intervening remote edit as the
        // base revision for a newer local draft waiting behind this operation.
        const resultTaskId = response?.task?.id || response?.taskId || taskId || null;
        if (resultTaskId && !req.path.endsWith('/plan')) {
          const committedTask = db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').get(resultTaskId,req.auth.workspaceId);
          if (committedTask) response.taskRevision = recordRevision(committedTask,'task');
        }
        if (operationId) {
          const resultTaskId = response?.task?.id || response?.taskId || taskId || null;
          db.prepare(`INSERT INTO mutation_receipts(workspace_id,principal_id,operation_id,action,resource_id,payload_hash,response_status,response_json,committed_at)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(req.auth.workspaceId,req.auth.userId,operationId,action,resultTaskId,fingerprint,res.statusCode,JSON.stringify(response),now);
        }
      });
      res.json = originalJson;
      req.body = originalBody;
      return res.json(response);
    } catch (error) {
      res.json = originalJson;
      req.body = originalBody;
      if (error === rejected) return res.json(response);
      return next(error);
    }
  });
}
