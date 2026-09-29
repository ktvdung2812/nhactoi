import { emitTaskEvent } from "./automations.mjs";
import { createId } from "./auth.mjs";
import { notifyTaskAudience, recordCommentMentions } from "./collaboration.mjs";
import { cleanupAttachmentRows, enqueueAttachmentCleanup } from "./task-files.mjs";

const TITLE_MAX = 240;
const COMMENT_MAX = 5000;
const URL_MAX = 2000;
const MAX_CHECKLISTS = 50;
const MAX_CHECKLIST_ITEMS = 100;
const MAX_ATTACHMENTS = 100;

function bodyObject(value, HttpError) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "request body is invalid");
  return value;
}

function assertKeys(value, allowed, HttpError) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new HttpError(400, "request body contains unsupported fields");
  }
}

function text(value, field, cleanString, HttpError, max = TITLE_MAX) {
  return cleanString(value, { required: true, max, field });
}

function httpUrl(value, cleanString, HttpError) {
  const result = text(value, "url", cleanString, HttpError, URL_MAX);
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    throw new HttpError(400, "url is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new HttpError(400, "url must use http or https");
  return result;
}

function taskForUser(db, taskId, auth, canAccessTeamTask, HttpError, { write = false } = {}) {
  const task = db
    .prepare(
      `
        SELECT t.*, tm.name AS team_name, tm.archived_at AS team_archived,
               creator.name AS created_by_name,
               assignee.name AS assignee_name,
               c.name AS customer_name
        FROM tasks t
        LEFT JOIN teams tm
          ON tm.id = t.team_id AND tm.workspace_id = t.workspace_id
        LEFT JOIN users creator ON creator.id = t.created_by
        LEFT JOIN users assignee ON assignee.id = t.assignee_id
        LEFT JOIN customers c
          ON c.id = t.customer_id AND c.workspace_id = t.workspace_id
        WHERE t.id = ? AND t.workspace_id = ? AND t.deleted_at IS NULL
      `,
    )
    .get(taskId, auth.workspaceId);
  if (!task || !canAccessTeamTask(db, auth.workspaceId, auth.userId, task.team_id))
    return null;
  if (write && !canAccessTeamTask(db, auth.workspaceId, auth.userId, task.team_id, { write: true }))
    throw new HttpError(409, "Đội nhóm đã lưu trữ và chỉ được đọc");
  return task;
}

function writableWorkspace(db, workspaceId, clock) {
  const workspace = db
    .prepare("SELECT suspended_at FROM workspaces WHERE id = ?")
    .get(workspaceId);
  if (!workspace || workspace.suspended_at) return false;
  const subscription = db
    .prepare("SELECT status, current_period_end FROM subscriptions WHERE workspace_id = ?")
    .get(workspaceId);
  if (!subscription) return false;
  if (subscription.status === "canceled" || subscription.status === "expired") return false;
  return new Date(subscription.current_period_end).getTime() > new Date(clock()).getTime();
}

function taskJson(row, baseTaskJson) {
  return {
    ...baseTaskJson(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByName: row.created_by_name || null,
    assigneeName: row.assignee_name || null,
    customerName: row.customer_name || null,
  };
}

function checklistJson(row) {
  return {
    id: row.id,
    title: row.title,
    items: Array.isArray(row.items) ? row.items : [],
  };
}

function itemJson(row, assignees = []) {
  const people = Array.isArray(assignees) ? assignees : [];
  return {
    id: row.id,
    title: row.title,
    completed: Boolean(row.completed),
    startAt: row.start_at || null,
    dueAt: row.due_at || null,
    remindAt: row.remind_at || null,
    assigneeIds: people.map((person) => person.id),
    assignees: people.map((person) => ({ id: person.id, name: person.name || "" })),
  };
}

function optionalDate(value, field, HttpError, { dateOnly = false } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, dateOnly ? "Ngày mục checklist không hợp lệ" : `${field} is invalid`);
  const text = value.trim();
  if (dateOnly) {
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text)
      throw new HttpError(400, "Ngày mục checklist không hợp lệ");
    return text;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${field} is invalid`);
  return date.toISOString();
}

// Sub-task assignees come from the parent card only: the primary assignee plus collaborators.
function cardMembers(db, task) {
  const extras = db
    .prepare(
      `SELECT u.id, u.name
       FROM task_assignees a
       JOIN users u ON u.id = a.user_id AND u.disabled_at IS NULL
       WHERE a.task_id = ?
       ORDER BY a.position ASC, u.name COLLATE NOCASE ASC, u.id ASC`,
    )
    .all(task.id);
  const seen = new Set(extras.map((member) => member.id));
  const people = [];
  if (task.assignee_id && !seen.has(task.assignee_id)) {
    const primary = db.prepare("SELECT id, name FROM users WHERE id = ? AND disabled_at IS NULL").get(task.assignee_id);
    if (primary) people.push(primary);
  }
  return [...people, ...extras];
}

function assigneeMap(db, itemIds) {
  const map = new Map();
  if (!itemIds.length) return map;
  const rows = db
    .prepare(
      `SELECT a.item_id, u.id, u.name
       FROM task_checklist_assignees a
       JOIN users u ON u.id = a.user_id
       WHERE a.item_id IN (${itemIds.map(() => "?").join(",")})
       ORDER BY u.name COLLATE NOCASE ASC, u.id ASC`,
    )
    .all(...itemIds);
  for (const row of rows) {
    const list = map.get(row.item_id) || [];
    list.push({ id: row.id, name: row.name });
    map.set(row.item_id, list);
  }
  return map;
}

function loadItem(db, itemId) {
  const row = db
    .prepare("SELECT id, title, completed, start_at, due_at, remind_at FROM task_checklist_items WHERE id = ?")
    .get(itemId);
  return itemJson(row, assigneeMap(db, [itemId]).get(itemId) || []);
}

function assertAssignees(db, task, ids, HttpError) {
  if (!Array.isArray(ids) || ids.length > 30)
    throw new HttpError(400, "assigneeIds must be an array of at most 30 members");
  const unique = ids.map((id) => {
    if (typeof id !== "string" || !id.trim() || id.trim().length > 160)
      throw new HttpError(400, "assigneeIds is invalid");
    return id.trim();
  });
  if (new Set(unique).size !== unique.length) throw new HttpError(400, "assigneeIds contains duplicates");
  const allowed = new Set(cardMembers(db, task).map((member) => member.id));
  if (unique.some((id) => !allowed.has(id)))
    throw new HttpError(400, "Người phụ trách mục checklist phải là thành viên của thẻ");
  return unique;
}

function replaceAssignees(db, itemId, ids) {
  db.prepare("DELETE FROM task_checklist_assignees WHERE item_id = ?").run(itemId);
  const insert = db.prepare("INSERT INTO task_checklist_assignees(item_id, user_id) VALUES (?, ?)");
  for (const id of ids) insert.run(itemId, id);
}

function attachmentJson(row) {
  const base = {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    createdByName: row.created_by_name || null,
  };
  if (row.kind === "file") {
    return {
      ...base,
      kind: "file",
      originalName: row.original_name || row.title,
      sizeBytes: Number(row.size_bytes || 0),
      mimeType: row.mime_type || "application/octet-stream",
      downloadUrl: `/api/tasks/${encodeURIComponent(row.task_id)}/attachments/${encodeURIComponent(row.id)}/download`,
    };
  }
  return { ...base, kind: "link", url: row.url };
}

function commentJson(row, attachments = []) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorName: row.author_name || null,
    attachments,
  };
}

function activityJson(row) {
  return {
    id: row.id,
    action: row.action,
    summary: row.summary,
    createdAt: row.created_at,
    actorName: row.actor_name || null,
  };
}

function checklistRows(db, taskId, workspaceId) {
  const rows = db
    .prepare(
      `
        SELECT c.id, c.title, c.created_at
        FROM task_checklists c
        JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
        WHERE c.task_id = ? AND t.deleted_at IS NULL
        ORDER BY c.position ASC, c.created_at ASC, c.id ASC
      `,
    )
    .all(workspaceId, taskId);
  const itemRows = db
    .prepare(
      `
        SELECT i.id, i.checklist_id, i.title, i.completed, i.start_at, i.due_at, i.remind_at, i.created_at
        FROM task_checklist_items i
        JOIN task_checklists c ON c.id = i.checklist_id
        JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
        WHERE c.task_id = ? AND t.deleted_at IS NULL
        ORDER BY i.position ASC, i.created_at ASC, i.id ASC
      `,
    )
    .all(workspaceId, taskId);
  const people = assigneeMap(db, itemRows.map((row) => row.id));
  const items = new Map();
  for (const row of itemRows) {
    const list = items.get(row.checklist_id) || [];
    list.push(itemJson(row, people.get(row.id) || []));
    items.set(row.checklist_id, list);
  }
  return rows.map((row) => checklistJson({ ...row, items: items.get(row.id) || [] }));
}

function attachmentRows(db, taskId, workspaceId) {
  return db
    .prepare(
      `
        SELECT a.*, u.name AS created_by_name
        FROM task_attachments a
        LEFT JOIN users u ON u.id = a.created_by
        JOIN tasks t ON t.id = a.task_id AND t.workspace_id = ?
        WHERE a.task_id = ? AND t.deleted_at IS NULL
        ORDER BY a.created_at ASC, a.id ASC
      `,
    )
    .all(workspaceId, taskId)
    .map(attachmentJson);
}

function commentRows(db, taskId, workspaceId) {
  const rows = db
    .prepare(
      `
        SELECT c.*, u.name AS author_name
        FROM task_comments c
        LEFT JOIN users u ON u.id = c.author_user_id
        JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
        WHERE c.task_id = ? AND t.deleted_at IS NULL
        ORDER BY c.created_at ASC, c.id ASC
      `,
    )
    .all(workspaceId, taskId);
  const attachmentRows = db
    .prepare(
      `
        SELECT a.*, u.name AS created_by_name
        FROM task_attachments a
        JOIN task_comments c
          ON c.id = a.comment_id AND c.task_id = a.task_id
        LEFT JOIN users u ON u.id = a.created_by
        JOIN tasks t ON t.id = a.task_id AND t.workspace_id = ?
        WHERE a.task_id = ? AND a.kind = 'file' AND t.deleted_at IS NULL
        ORDER BY a.created_at ASC, a.id ASC
      `,
    )
    .all(workspaceId, taskId);
  const attachmentsByComment = new Map();
  for (const row of attachmentRows) {
    const attachments = attachmentsByComment.get(row.comment_id) || [];
    attachments.push(attachmentJson(row));
    attachmentsByComment.set(row.comment_id, attachments);
  }
  return rows.map((row) => commentJson(row, attachmentsByComment.get(row.id) || []));
}

function commentAttachmentRows(db, commentId, taskId, workspaceId) {
  return db
    .prepare(
      `
        SELECT a.*, u.name AS created_by_name
        FROM task_attachments a
        JOIN task_comments c
          ON c.id = a.comment_id AND c.task_id = a.task_id
        LEFT JOIN users u ON u.id = a.created_by
        JOIN tasks t ON t.id = a.task_id AND t.workspace_id = ?
        WHERE a.comment_id = ? AND a.task_id = ?
          AND a.kind = 'file' AND t.deleted_at IS NULL
        ORDER BY a.created_at ASC, a.id ASC
      `,
    )
    .all(workspaceId, commentId, taskId)
    .map(attachmentJson);
}

function activityRows(db, taskId, workspaceId) {
  return db
    .prepare(
      `
        SELECT a.*, u.name AS actor_name
        FROM task_activity a
        LEFT JOIN users u ON u.id = a.actor_user_id
        JOIN tasks t ON t.id = a.task_id AND t.workspace_id = ?
        WHERE a.task_id = ? AND t.deleted_at IS NULL
        ORDER BY a.created_at ASC, a.rowid ASC
      `,
    )
    .all(workspaceId, taskId)
    .map(activityJson);
}

function recordTaskActivity(db, { taskId, actorUserId, action, summary, createdAt, recipients = [] }) {
  db.prepare(
    `
      INSERT INTO task_activity(id, task_id, actor_user_id, action, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(createId("activity_"), taskId, actorUserId || null, action, summary, createdAt);
  notifyTaskAudience(db, { taskId, actorUserId, summary, createdAt, recipients });
  if(action === "task_created") emitTaskEvent(db,{taskId,actorUserId,action,summary});
}

function changedTaskSummary(before, after) {
  const fields = [
    ["title", "tên công việc"],
    ["description", "mô tả"],
    ["status", "trạng thái"],
    ["priority", "mức ưu tiên"],
    ["due_at", "hạn hoàn thành"],
    ["remind_at", "lịch nhắc"],
    ["assignee_id", "người phụ trách"],
    ["customer_id", "khách hàng"],
    ["team_id", "team"],
    ["category", "nhóm dịch vụ"],
    ["recurrence", "lặp lại"],
    ["recurrence_options", "quy tắc lặp"],
  ];
  const changed = fields
    .filter(([column]) => (before[column] ?? null) !== (after[column] ?? null))
    .map(([, label]) => label);
  return changed.length ? `đã cập nhật ${changed.join(", ")}` : null;
}

function checklistById(db, taskId, checklistId, workspaceId) {
  return db
    .prepare(
      `
        SELECT c.*
        FROM task_checklists c
        JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
        WHERE c.id = ? AND c.task_id = ? AND t.deleted_at IS NULL
      `,
    )
    .get(workspaceId, checklistId, taskId);
}

function itemById(db, taskId, checklistId, itemId, workspaceId) {
  return db
    .prepare(
      `
        SELECT i.*
        FROM task_checklist_items i
        JOIN task_checklists c ON c.id = i.checklist_id AND c.task_id = ?
        JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
        WHERE i.id = ? AND i.checklist_id = ? AND t.deleted_at IS NULL
      `,
    )
    .get(taskId, workspaceId, itemId, checklistId);
}

function attachmentById(db, taskId, attachmentId, workspaceId) {
  return db
    .prepare(
      `
        SELECT a.*
        FROM task_attachments a
        JOIN tasks t ON t.id = a.task_id AND t.workspace_id = ?
        WHERE a.id = ? AND a.task_id = ? AND t.deleted_at IS NULL
      `,
    )
    .get(workspaceId, attachmentId, taskId);
}

function detailPayload(db, task, auth, baseTaskJson, canAccessTeamTask, clock) {
  return {
    task: taskJson(task, baseTaskJson),
    checklists: checklistRows(db, task.id, auth.workspaceId),
    checklistMembers: cardMembers(db, task),
    attachments: attachmentRows(db, task.id, auth.workspaceId),
    comments: commentRows(db, task.id, auth.workspaceId),
    activity: activityRows(db, task.id, auth.workspaceId),
    canWrite:
      writableWorkspace(db, auth.workspaceId, clock) &&
      canAccessTeamTask(db, auth.workspaceId, auth.userId, task.team_id, { write: true }),
  };
}

export function registerTaskDetailRoutes(
  app,
  {
    db,
    clock,
    isoNow,
    withTransaction,
    requireAuth,
    ensureWritable,
    HttpError,
    fail,
    cleanString,
    taskJson: baseTaskJson,
    canAccessTeamTask,
  },
) {
  function taskOr404(req, { write = false } = {}) {
    const task = taskForUser(
      db,
      req.params.id,
      req.auth,
      canAccessTeamTask,
      HttpError,
      { write },
    );
    if (!task) throw new HttpError(404, "task was not found");
    return task;
  }

  app.get("/api/tasks/:id/detail", requireAuth, (req, res, next) => {
    try {
      const task = taskOr404(req);
      return res.json(detailPayload(db, task, req.auth, baseTaskJson, canAccessTeamTask, clock));
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tasks/:id/checklists", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const body = bodyObject(req.body, HttpError);
      assertKeys(body, new Set(["title"]), HttpError);
      const title = text(body.title, "title", cleanString, HttpError);
      const count = db.prepare("SELECT COUNT(*) AS count FROM task_checklists WHERE task_id = ?").get(task.id).count;
      if (Number(count) >= MAX_CHECKLISTS) throw new HttpError(400, "a task can have at most 50 checklists");
      const now = isoNow(clock);
      const checklist = withTransaction(db, () => {
        const id = createId("checklist_");
        db.prepare(
          `INSERT INTO task_checklists(id, task_id, title, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, task.id, title, req.auth.userId, now, now);
        db.prepare("UPDATE task_checklists SET position=(SELECT COALESCE(MAX(position),0)+1 FROM task_checklists WHERE task_id=? AND id<>?) WHERE id=?").run(task.id,id,id);
        recordTaskActivity(db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "checklist_created",
          summary: `đã tạo checklist “${title}”`,
          createdAt: now,
        });
        return db.prepare("SELECT id, title FROM task_checklists WHERE id = ?").get(id);
      });
      return res.status(201).json({ checklist: checklistJson({ ...checklist, items: [] }) });
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/tasks/:id/checklists/:checklistId", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const body = bodyObject(req.body, HttpError);
      assertKeys(body, new Set(["title"]), HttpError);
      const title = text(body.title, "title", cleanString, HttpError);
      const checklist = checklistById(db, task.id, req.params.checklistId, req.auth.workspaceId);
      if (!checklist) return fail(res, 404, "checklist was not found");
      const now = isoNow(clock);
      const updated = withTransaction(db, () => {
        const changed = checklist.title !== title;
        db.prepare("UPDATE task_checklists SET title = ?, updated_at = ? WHERE id = ? AND task_id = ?")
          .run(title, now, checklist.id, task.id);
        if (changed)
          recordTaskActivity(db, {
            taskId: task.id,
            actorUserId: req.auth.userId,
            action: "checklist_renamed",
            summary: `đã đổi tên checklist thành “${title}”`,
            createdAt: now,
          });
        return db.prepare("SELECT id, title FROM task_checklists WHERE id = ?").get(checklist.id);
      });
      return res.json({ checklist: checklistJson({ ...updated, items: checklistRows(db, task.id, req.auth.workspaceId).find((item) => item.id === checklist.id)?.items || [] }) });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/tasks/:id/checklists/:checklistId", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const checklist = checklistById(db, task.id, req.params.checklistId, req.auth.workspaceId);
      if (!checklist) return fail(res, 404, "checklist was not found");
      const now = isoNow(clock);
      withTransaction(db, () => {
        const result = db.prepare("DELETE FROM task_checklists WHERE id = ? AND task_id = ?").run(checklist.id, task.id);
        if (!result.changes) throw new HttpError(404, "checklist was not found");
        recordTaskActivity(db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "checklist_removed",
          summary: `đã xoá checklist “${checklist.title}”`,
          createdAt: now,
        });
      });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/tasks/:id/checklists/order", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const body = bodyObject(req.body, HttpError);
      assertKeys(body, new Set(["ids"]), HttpError);
      if (!Array.isArray(body.ids) || body.ids.length > MAX_CHECKLISTS)
        throw new HttpError(400, "ids must include every checklist");
      const ids = body.ids.map((id) => {
        if (typeof id !== "string" || !id.trim()) throw new HttpError(400, "ids must include every checklist");
        return id;
      });
      if (new Set(ids).size !== ids.length) throw new HttpError(400, "ids contains duplicates");
      const rows = db.prepare("SELECT id FROM task_checklists WHERE task_id = ? ORDER BY position, created_at, id").all(task.id);
      if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id)))
        throw new HttpError(400, "ids must include every checklist");
      const now = isoNow(clock);
      withTransaction(db, () => {
        const update = db.prepare("UPDATE task_checklists SET position = ?, updated_at = ? WHERE id = ? AND task_id = ?");
        ids.forEach((id, index) => update.run(index, now, id, task.id));
        recordTaskActivity(db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "checklists_reordered",
          summary: "đã sắp xếp checklist",
          createdAt: now,
        });
      });
      return res.json({ ids });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tasks/:id/checklists/:checklistId/items", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const body = bodyObject(req.body, HttpError);
      assertKeys(body, new Set(["title"]), HttpError);
      const title = text(body.title, "title", cleanString, HttpError);
      const checklist = checklistById(db, task.id, req.params.checklistId, req.auth.workspaceId);
      if (!checklist) return fail(res, 404, "checklist was not found");
      const count = db.prepare("SELECT COUNT(*) AS count FROM task_checklist_items WHERE checklist_id = ?").get(checklist.id).count;
      if (Number(count) >= MAX_CHECKLIST_ITEMS) throw new HttpError(400, "a checklist can have at most 100 items");
      const now = isoNow(clock);
      const item = withTransaction(db, () => {
        const id = createId("checkitem_");
        db.prepare(
          `INSERT INTO task_checklist_items(id, checklist_id, title, completed, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?)`,
        ).run(id, checklist.id, title, now, now);
        db.prepare("UPDATE task_checklist_items SET position=(SELECT COALESCE(MAX(position),0)+1 FROM task_checklist_items WHERE checklist_id=? AND id<>?) WHERE id=?").run(checklist.id,id,id);
        recordTaskActivity(db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "checklist_item_added",
          summary: `đã thêm mục checklist “${title}”`,
          createdAt: now,
        });
        return id;
      });
      return res.status(201).json({ item: loadItem(db, item) });
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/tasks/:id/checklists/:checklistId/items/:itemId", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const body = bodyObject(req.body, HttpError);
      assertKeys(body, new Set(["title", "completed", "startAt", "dueAt", "remindAt", "assigneeIds"]), HttpError);
      if (body.title === undefined && body.completed === undefined && body.startAt === undefined && body.dueAt === undefined && body.remindAt === undefined && body.assigneeIds === undefined)
        throw new HttpError(400, "no checklist item changes were supplied");
      const item = itemById(db, task.id, req.params.checklistId, req.params.itemId, req.auth.workspaceId);
      if (!item) return fail(res, 404, "checklist item was not found");
      const nextTitle = body.title === undefined ? item.title : text(body.title, "title", cleanString, HttpError);
      const nextCompleted = body.completed === undefined ? Boolean(item.completed) : body.completed;
      if (typeof nextCompleted !== "boolean") throw new HttpError(400, "completed must be true or false");
      const nextStart = body.startAt === undefined ? item.start_at || null : optionalDate(body.startAt, "startAt", HttpError, { dateOnly: true });
      const nextDue = body.dueAt === undefined ? item.due_at || null : optionalDate(body.dueAt, "dueAt", HttpError, { dateOnly: true });
      const nextRemind = body.remindAt === undefined ? item.remind_at || null : optionalDate(body.remindAt, "remindAt", HttpError);
      if (nextStart && nextDue && nextStart > nextDue) throw new HttpError(400, "Ngày bắt đầu không được sau hạn chót");
      const nextAssignees = body.assigneeIds === undefined ? null : assertAssignees(db, task, body.assigneeIds, HttpError);
      const previousAssignees = nextAssignees ? (assigneeMap(db, [item.id]).get(item.id) || []).map((person) => person.id) : [];
      const assigneesChanged = Boolean(nextAssignees) && (previousAssignees.length !== nextAssignees.length || [...previousAssignees].sort().some((id, index) => id !== [...nextAssignees].sort()[index]));
      const titleChanged = nextTitle !== item.title;
      const completedChanged = nextCompleted !== Boolean(item.completed);
      const scheduleChanged = nextStart !== (item.start_at || null) || nextDue !== (item.due_at || null);
      const remindChanged = nextRemind !== (item.remind_at || null);
      const now = isoNow(clock);
      const updated = withTransaction(db, () => {
        db.prepare(
          "UPDATE task_checklist_items SET title = ?, completed = ?, start_at = ?, due_at = ?, remind_at = ?, updated_at = ? WHERE id = ? AND checklist_id = ?",
        ).run(nextTitle, nextCompleted ? 1 : 0, nextStart, nextDue, nextRemind, now, item.id, req.params.checklistId);
        if (assigneesChanged) replaceAssignees(db, item.id, nextAssignees);
        if (completedChanged)
          recordTaskActivity(db, {
            taskId: task.id,
            actorUserId: req.auth.userId,
            action: nextCompleted ? "checklist_item_completed" : "checklist_item_reopened",
            summary: nextCompleted ? `đã hoàn thành mục checklist “${nextTitle}”` : `đã mở lại mục checklist “${nextTitle}”`,
            createdAt: now,
          });
        if (titleChanged)
          recordTaskActivity(db, {
            taskId: task.id,
            actorUserId: req.auth.userId,
            action: "checklist_item_updated",
            summary: `đã đổi tên mục checklist thành “${nextTitle}”`,
            createdAt: now,
          });
        if (scheduleChanged)
          recordTaskActivity(db, {
            taskId: task.id,
            actorUserId: req.auth.userId,
            action: "checklist_item_updated",
            summary: `đã cập nhật ngày của mục checklist “${nextTitle}”`,
            createdAt: now,
          });
        if (remindChanged)
          recordTaskActivity(db, {
            taskId: task.id,
            actorUserId: req.auth.userId,
            action: "checklist_item_updated",
            summary: `đã cập nhật lịch nhắc mục checklist “${nextTitle}”`,
            createdAt: now,
          });
        if (assigneesChanged) {
          const added = nextAssignees.filter((id) => !previousAssignees.includes(id));
          if (added.length)
            notifyTaskAudience(db, {
              taskId: task.id,
              actorUserId: req.auth.userId,
              summary: `đã giao bạn mục checklist “${nextTitle}”`,
              createdAt: now,
              recipients: added,
              type: "checklist_assigned",
            });
          recordTaskActivity(db, {
            taskId: task.id,
            actorUserId: req.auth.userId,
            action: "checklist_item_updated",
            summary: `đã cập nhật người phụ trách mục checklist “${nextTitle}”`,
            createdAt: now,
          });
        }
        return item.id;
      });
      return res.json({ item: loadItem(db, updated) });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/tasks/:id/checklists/:checklistId/items/:itemId", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const item = itemById(db, task.id, req.params.checklistId, req.params.itemId, req.auth.workspaceId);
      if (!item) return fail(res, 404, "checklist item was not found");
      const now = isoNow(clock);
      withTransaction(db, () => {
        const result = db.prepare("DELETE FROM task_checklist_items WHERE id = ? AND checklist_id = ?").run(item.id, req.params.checklistId);
        if (!result.changes) throw new HttpError(404, "checklist item was not found");
        recordTaskActivity(db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "checklist_item_removed",
          summary: `đã xoá mục checklist “${item.title}”`,
          createdAt: now,
        });
      });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tasks/:id/attachments", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const body = bodyObject(req.body, HttpError);
      assertKeys(body, new Set(["title", "url"]), HttpError);
      const title = text(body.title, "title", cleanString, HttpError);
      const url = httpUrl(body.url, cleanString, HttpError);
      const count = db.prepare("SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = ?").get(task.id).count;
      if (Number(count) >= MAX_ATTACHMENTS) throw new HttpError(400, "a task can have at most 100 attachments");
      const now = isoNow(clock);
      const attachment = withTransaction(db, () => {
        const id = createId("attachment_");
        db.prepare(
          `INSERT INTO task_attachments(id, task_id, title, url, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, task.id, title, url, req.auth.userId, now);
        recordTaskActivity(db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "attachment_added",
          summary: `đã thêm liên kết “${title}”`,
          createdAt: now,
        });
        return db.prepare("SELECT * FROM task_attachments WHERE id = ?").get(id);
      });
      return res.status(201).json({ attachment: attachmentJson({ ...attachment, created_by_name: req.auth.user?.name || null }) });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/tasks/:id/attachments/:attachmentId", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const attachment = attachmentById(db, task.id, req.params.attachmentId, req.auth.workspaceId);
      if (!attachment) return fail(res, 404, "attachment was not found");
      const now = isoNow(clock);
      withTransaction(db, () => {
        if (attachment.kind === "file") enqueueAttachmentCleanup(db, attachment, now);
        const result = db.prepare("DELETE FROM task_attachments WHERE id = ? AND task_id = ?").run(attachment.id, task.id);
        if (!result.changes) throw new HttpError(404, "attachment was not found");
        recordTaskActivity(db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "attachment_removed",
          summary: attachment.kind === "file"
            ? `đã xoá tệp “${attachment.title}”`
            : `đã xoá liên kết “${attachment.title}”`,
          createdAt: now,
        });
      });
      if (attachment.kind === "file") cleanupAttachmentRows(db, [attachment], { now });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tasks/:id/comments", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      const body = bodyObject(req.body, HttpError);
      assertKeys(body, new Set(["body", "attachmentIds", "mentionIds"]), HttpError);
      let attachmentIds = [];
      if (body.attachmentIds !== undefined) {
        if (!Array.isArray(body.attachmentIds) || body.attachmentIds.length > 10)
          throw new HttpError(400, "attachmentIds must contain at most 10 items");
        const seen = new Set();
        for (const id of body.attachmentIds) {
          if (typeof id !== "string" || !id.trim())
            throw new HttpError(400, "attachmentIds must contain non-empty strings");
          if (seen.has(id)) throw new HttpError(400, "attachmentIds must be unique");
          seen.add(id);
          attachmentIds.push(id);
        }
      }
      const commentBody = attachmentIds.length
        ? cleanString(body.body, { max: COMMENT_MAX, field: "body" })
        : text(body.body, "body", cleanString, HttpError, COMMENT_MAX);
      const now = isoNow(clock);
      const result = withTransaction(db, () => {
        let files = [];
        if (attachmentIds.length) {
          const placeholders = attachmentIds.map(() => "?").join(", ");
          const rows = db
            .prepare(
              `
                SELECT a.*, t.workspace_id AS attachment_workspace_id,
                       t.deleted_at AS task_deleted_at
                FROM task_attachments a
                JOIN tasks t ON t.id = a.task_id
                WHERE a.id IN (${placeholders})
                  AND a.task_id = ? AND t.workspace_id = ?
                  AND t.deleted_at IS NULL
              `,
            )
            .all(...attachmentIds, task.id, req.auth.workspaceId);
          const byId = new Map(rows.map((row) => [row.id, row]));
          for (const id of attachmentIds) {
            const row = byId.get(id);
            if (
              !row ||
              row.task_id !== task.id ||
              row.attachment_workspace_id !== req.auth.workspaceId ||
              row.task_deleted_at ||
              row.kind !== "file"
            ) {
              throw new HttpError(400, "attachment is not available for this task");
            }
            files.push(row);
          }

          const linked = files.filter((row) => row.comment_id !== null && row.comment_id !== undefined);
          if (linked.length) {
            const commentId = linked[0].comment_id;
            const existing = db
              .prepare(
                `
                  SELECT c.*, u.name AS author_name
                  FROM task_comments c
                  LEFT JOIN users u ON u.id = c.author_user_id
                  JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
                  WHERE c.id = ? AND c.task_id = ? AND t.deleted_at IS NULL
                `,
              )
              .get(req.auth.workspaceId, commentId, task.id);
            const existingAttachments = existing
              ? db
                .prepare(
                  `
                    SELECT a.*, u.name AS created_by_name
                    FROM task_attachments a
                    LEFT JOIN users u ON u.id = a.created_by
                    JOIN task_comments c
                      ON c.id = a.comment_id AND c.task_id = a.task_id
                    JOIN tasks t ON t.id = a.task_id AND t.workspace_id = ?
                    WHERE a.comment_id = ? AND a.task_id = ?
                      AND a.kind = 'file' AND t.deleted_at IS NULL
                    ORDER BY a.created_at ASC, a.id ASC
                  `,
                )
                .all(req.auth.workspaceId, commentId, task.id)
              : [];
            const requestedIds = new Set(attachmentIds);
            const existingIds = new Set(existingAttachments.map((row) => row.id));
            const canRetry =
              linked.length === files.length &&
              files.every((row) => row.comment_id === commentId && row.created_by === req.auth.userId) &&
              existing &&
              existing.author_user_id === req.auth.userId &&
              existing.body === commentBody &&
              existingIds.size === requestedIds.size &&
              [...requestedIds].every((id) => existingIds.has(id));
            if (canRetry) {
              return {
                status: 200,
                row: existing,
                attachments: existingAttachments.map(attachmentJson),
              };
            }
            throw new HttpError(409, "attachment is already attached to a comment");
          }
          if (files.some((row) => row.created_by !== req.auth.userId))
            throw new HttpError(400, "attachment is not available for this user");
        }

        const id = createId("comment_");
        db.prepare(
          `INSERT INTO task_comments(id, task_id, author_user_id, body, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(id, task.id, req.auth.userId, commentBody, now);
        const recipients = recordCommentMentions(db, {commentId:id, taskId:task.id, actorUserId:req.auth.userId, ids:body.mentionIds || [], createdAt:now, HttpError});
        recordTaskActivity(db, {
          recipients,
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "comment_added",
          summary: "đã thêm bình luận",
          createdAt: now,
        });
        if (attachmentIds.length) {
          const placeholders = attachmentIds.map(() => "?").join(", ");
          const linkedResult = db
            .prepare(
              `UPDATE task_attachments
               SET comment_id = ?
               WHERE id IN (${placeholders}) AND comment_id IS NULL`,
            )
            .run(id, ...attachmentIds);
          if (Number(linkedResult.changes) !== attachmentIds.length)
            throw new HttpError(409, "attachment is already attached to a comment");
        }
        const comment = db
          .prepare(
            `
              SELECT c.*, u.name AS author_name
              FROM task_comments c
              LEFT JOIN users u ON u.id = c.author_user_id
              WHERE c.id = ?
            `,
          )
          .get(id);
        return {
          status: 201,
          row: comment,
          attachments: commentAttachmentRows(db, id, task.id, req.auth.workspaceId),
        };
      });
      return res.status(result.status).json({ comment: commentJson(result.row, result.attachments) });
    } catch (error) {
      return next(error);
    }
  });
}

export { changedTaskSummary, recordTaskActivity };
