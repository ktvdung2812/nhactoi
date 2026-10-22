import { validAssigneeId, taskScopeLinkConflict } from './task-extras.mjs';
import { canAccessTask } from './task-access.mjs';
import { createId } from "./auth.mjs";
import {
  cleanupAttachmentRows,
  enqueueAttachmentCleanup,
} from "./task-files.mjs";

export const TRASH_ENTITY_TYPES = new Set([
  "task",
  "customer",
  "transaction",
]);

const PAGE_SIZE = 20;
const PURGE_CONFIRMATION = "XOA VINH VIEN";

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN");
}

function sourceTable(entityType) {
  switch (entityType) {
    case "task":
      return "tasks";
    case "customer":
      return "customers";
    case "transaction":
      return "transactions";
    default:
      return null;
  }
}

/**
 * Add a recovery row in the same transaction as the source soft-delete.
 * `deletedBy` is intentionally nullable so migration backfills can represent
 * records that predate the trash module.
 */
export function recordTrashItem(
  db,
  { workspaceId, entityType, entityId, title, deletedBy, deletedAt },
) {
  if (!TRASH_ENTITY_TYPES.has(entityType))
    throw new Error("unsupported trash entity type");
  const id = createId("trash_");
  db.prepare(
    `
      INSERT INTO trash_items
        (id, workspace_id, entity_type, entity_id, title, deleted_by, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    workspaceId,
    entityType,
    entityId,
    String(title || ""),
    deletedBy || null,
    deletedAt,
  );
  return id;
}

function sourceRow(db, item) {
  if (item.entity_type === "task") {
    return db
      .prepare(
        `
          SELECT
            t.*,
            tm.name AS team_name,
            tm.archived_at AS team_archived,
            assignee.name AS assignee_name,
            c.name AS customer_name
          FROM tasks t
          LEFT JOIN teams tm
            ON tm.id = t.team_id AND tm.workspace_id = t.workspace_id
          LEFT JOIN users assignee ON assignee.id = t.assignee_id
          LEFT JOIN customers c
            ON c.id = t.customer_id AND c.workspace_id = t.workspace_id
          WHERE t.id = ? AND t.workspace_id = ?
        `,
      )
      .get(item.entity_id, item.workspace_id);
  }
  if (item.entity_type === "customer") {
    return db
      .prepare(
        `SELECT * FROM customers WHERE id = ? AND workspace_id = ?`,
      )
      .get(item.entity_id, item.workspace_id);
  }
  if (item.entity_type === "transaction") {
    return db
      .prepare(
        `
          SELECT tr.*, c.name AS customer_name
          FROM transactions tr
          LEFT JOIN customers c
            ON c.id = tr.customer_id AND c.workspace_id = tr.workspace_id
          WHERE tr.id = ? AND tr.workspace_id = ?
        `,
      )
      .get(item.entity_id, item.workspace_id);
  }
  return null;
}

function taskVisibleToMember(db, task, userId) {
  return Boolean(task && canAccessTask(db, task.workspace_id, userId, task, { action: 'delete' }));
}

function isWorkspaceAdmin(auth) {
  return Boolean(auth && ["owner", "admin"].includes(auth.role));
}

function isAuthorized(db, item, source, auth) {
  if (isWorkspaceAdmin(auth)) return true;
  // Platform-admin is deliberately not a bypass. A member can only work with
  // their own task deletions while the task remains visible in its team.
  return (
    item.entity_type === "task" &&
    item.deleted_by === auth.userId &&
    taskVisibleToMember(db, source, auth.userId)
  );
}

function customerAvailable(db, workspaceId, customerId, pendingCustomerIds) {
  const customer = db
    .prepare(
      `SELECT id, deleted_at FROM customers WHERE id = ? AND workspace_id = ?`,
    )
    .get(customerId, workspaceId);
  if (!customer) return false;
  return (
    customer.deleted_at === null ||
    customer.deleted_at === undefined ||
    pendingCustomerIds?.has(customerId)
  );
}

function taskAssigneeIds(db, task) {
  const ids = new Set();
  if (task.assignee_id) ids.add(task.assignee_id);
  for (const row of db
    .prepare(
      `SELECT user_id FROM task_assignees
       WHERE task_id = ?
       UNION
       SELECT a.user_id FROM task_checklist_assignees a
       JOIN task_checklist_items i ON i.id = a.item_id
       JOIN task_checklists c ON c.id = i.checklist_id
       WHERE c.task_id = ? AND i.completed = 0`,
    )
    .all(task.id, task.id)) {
    if (row.user_id) ids.add(row.user_id);
  }
  return ids;
}

function restoreBlockedReason(db, item, source, { pendingCustomerIds = new Set() } = {}) {
  if (!source) return "bản ghi không còn tồn tại";
  if (source.deleted_at === null || source.deleted_at === undefined)
    return "bản ghi đã được khôi phục";

  if (item.entity_type === "task") {
    if (db.dialect === 'postgres') {
      const project = db.prepare('SELECT archived_at FROM projects WHERE id=? AND workspace_id=?').get(source.project_id, source.workspace_id);
      if (!project) return "dự án không còn tồn tại";
      if (project.archived_at) return "dự án đã lưu trữ";
    }
    if (source.team_id) {
      const team = db
        .prepare(
          `SELECT id, archived_at FROM teams WHERE id = ? AND workspace_id = ?`,
        )
        .get(source.team_id, source.workspace_id);
      if (!team) return "đội nhóm không còn tồn tại";
      if (team.archived_at) return "đội nhóm đã lưu trữ";
    }

    // Completed tasks are historical records. Open tasks must still point to
    // a current workspace member with project access (or legacy team access)
    // so the restored task is actionable.
    if (source.status !== "done") {
      const linkConflict = taskScopeLinkConflict(db, source, source.project_id, { completedChecklistIsHistory: true });
      if (linkConflict) return linkConflict;
      for (const assigneeId of taskAssigneeIds(db, source)) {
        if (!validAssigneeId(db, source.workspace_id, source.team_id, assigneeId, source.project_id))
          return "người được giao không còn có quyền trong phạm vi công việc";
      }
    }
    if (
      source.customer_id &&
      !customerAvailable(
        db,
        source.workspace_id,
        source.customer_id,
        pendingCustomerIds,
      )
    )
      return "khách hàng đã bị xoá hoặc không còn thuộc workspace";
  }

  if (
    item.entity_type === "transaction" &&
    source.customer_id &&
    !customerAvailable(
      db,
      source.workspace_id,
      source.customer_id,
      pendingCustomerIds,
    )
  )
    return "khách hàng đã bị xoá hoặc không còn thuộc workspace";

  return null;
}

function metadataJson(db, item, source, auth, { pendingCustomerIds = new Set() } = {}) {
  const authorized = isAuthorized(db, item, source, auth);
  const blocked = authorized
    ? restoreBlockedReason(db, item, source, { pendingCustomerIds })
    : "bạn không có quyền với mục trong thùng rác này";
  return {
    id: item.id,
    entityType: item.entity_type,
    entityId: item.entity_id,
    title: item.title,
    deletedAt: item.deleted_at,
    deletedByName: item.deleted_by_name || null,
    canRestore: authorized && !blocked,
    restoreBlockedReason: blocked,
  };
}

function detailsJson(item, source) {
  if (!source) return {};
  if (item.entity_type === "task") {
    return {
      id: source.id,
      title: source.title,
      description: source.description,
      status: source.status,
      priority: source.priority,
      dueAt: source.due_at,
      remindAt: source.remind_at,
      assigneeId: source.assignee_id,
      assigneeName: source.assignee_name || null,
      customerId: source.customer_id,
      customerName: source.customer_name || null,
      teamId: source.team_id || null,
      teamName: source.team_name || null,
      category: source.category,
      recurrence: source.recurrence,
    };
  }
  if (item.entity_type === "customer") {
    return {
      id: source.id,
      name: source.name,
      company: source.company,
      email: source.email,
      phone: source.phone,
      service: source.service,
    };
  }
  return {
    id: source.id,
    type: source.type,
    amount: source.amount,
    title: source.title,
    category: source.category,
    date: source.date,
    customerId: source.customer_id,
    customerName: source.customer_name || null,
  };
}

function allItems(db, workspaceId) {
  return db
    .prepare(
      `
        SELECT ti.*, u.name AS deleted_by_name
        FROM trash_items ti
        LEFT JOIN users u ON u.id = ti.deleted_by
        WHERE ti.workspace_id = ?
        ORDER BY ti.deleted_at DESC, ti.id DESC
      `,
    )
    .all(workspaceId);
}

function visibleItems(db, workspaceId, auth, type, query) {
  const foldedQuery = fold(query);
  return allItems(db, workspaceId).filter((item) => {
    if (type !== "all" && item.entity_type !== type) return false;
    if (foldedQuery && !fold(item.title).includes(foldedQuery)) return false;
    const source = sourceRow(db, item);
    return isAuthorized(db, item, source, auth);
  });
}

function parseType(value, HttpError) {
  const type = String(value ?? "all");
  if (type === "") return "all";
  if (type !== "all" && !TRASH_ENTITY_TYPES.has(type))
    throw new HttpError(400, "type is invalid");
  return type;
}

function parsePage(value, HttpError) {
  if (value === undefined || value === "") return 1;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
    throw new HttpError(400, "page is invalid");
  return page;
}

function parseIds(body, HttpError) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "request body is invalid");
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100)
    throw new HttpError(400, "ids must contain between 1 and 100 items");
  const ids = [];
  const seen = new Set();
  for (const value of body.ids) {
    if (typeof value !== "string" || !value.trim() || value.length > 200)
      throw new HttpError(400, "ids must contain valid strings");
    const id = value.trim();
    if (seen.has(id)) throw new HttpError(400, "ids must be unique");
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function itemById(db, workspaceId, id) {
  return db
    .prepare(
      `
        SELECT ti.*, u.name AS deleted_by_name
        FROM trash_items ti
        LEFT JOIN users u ON u.id = ti.deleted_by
        WHERE ti.workspace_id = ? AND ti.id = ?
      `,
    )
    .get(workspaceId, id);
}

function mutationItems(db, req, ids, HttpError) {
  const items = [];
  for (const id of ids) {
    const item = itemById(db, req.auth.workspaceId, id);
    if (!item) throw new HttpError(404, "trash item was not found");
    const source = sourceRow(db, item);
    if (!source) throw new HttpError(409, "trash item source is no longer available");
    if (!isAuthorized(db, item, source, req.auth))
      throw new HttpError(403, "you do not have permission for this trash item");
    items.push({ item, source });
  }
  return items;
}

function conflict(HttpError, message, details) {
  throw new HttpError(409, message, details);
}

function restoreItems(db, req, ids, { withTransaction, HttpError, isoNow }) {
  return withTransaction(db, () => {
    // Preflight every row before changing any row. A single blocked item must
    // leave the whole batch untouched.
    const entries = mutationItems(db, req, ids, HttpError);
    const pendingCustomerIds = new Set(
      entries
        .filter(({ item }) => item.entity_type === "customer")
        .map(({ item }) => item.entity_id),
    );
    for (const { item, source } of entries) {
      const reason = restoreBlockedReason(db, item, source, {
        pendingCustomerIds,
      });
      if (reason)
        conflict(HttpError, `Chưa thể khôi phục: ${reason}.`, {
          id: item.id,
          reason,
        });
    }

    const order = { customer: 0, task: 1, transaction: 2 };
    const now = isoNow(req.app.locals.clock);
    for (const { item } of [...entries].sort(
      (left, right) => order[left.item.entity_type] - order[right.item.entity_type],
    )) {
      const table = sourceTable(item.entity_type);
      const hasUpdatedAt = item.entity_type !== "transaction";
      const result = hasUpdatedAt
        ? db
            .prepare(
              `UPDATE ${table} SET deleted_at = NULL, updated_at = ?
               WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL`,
            )
            .run(now, item.entity_id, req.auth.workspaceId)
        : db
            .prepare(
              `UPDATE ${table} SET deleted_at = NULL
               WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL`,
            )
            .run(item.entity_id, req.auth.workspaceId);
      if (!result.changes)
        conflict(HttpError, "trash item is no longer deleted", { id: item.id });
      db.prepare(
        "DELETE FROM trash_items WHERE id = ? AND workspace_id = ?",
      ).run(item.id, req.auth.workspaceId);
    }
    return entries.length;
  });
}

function purgeItems(db, req, ids, { withTransaction, HttpError, isoNow }) {
  return withTransaction(db, () => {
    const entries = mutationItems(db, req, ids, HttpError);
    for (const { item, source } of entries) {
      if (source.deleted_at === null || source.deleted_at === undefined)
        conflict(HttpError, "trash item is no longer deleted", { id: item.id });
    }

    // Queue file cleanup before deleting the source task. The queue insert and
    // source deletion commit atomically, so a storage outage cannot lose the
    // only durable reference needed for a later retry.
    const cleanupRows = [];
    const cleanupAt = isoNow(req.app.locals.clock);
    for (const { item } of entries) {
      if (item.entity_type !== "task") continue;
      const files = db
        .prepare(
          `SELECT * FROM task_attachments
           WHERE task_id = ? AND kind = 'file'`,
        )
        .all(item.entity_id);
      for (const file of files) {
        enqueueAttachmentCleanup(db, file, cleanupAt);
        cleanupRows.push(file);
      }
    }

    // Source rows go first so ON DELETE SET NULL/CASCADE maintains the schema's
    // foreign-key guarantees. Metadata is removed only after the source row is
    // confirmed deleted, and the enclosing transaction rolls back on failure.
    const order = { task: 0, transaction: 1, customer: 2 };
    for (const { item } of [...entries].sort(
      (left, right) => order[left.item.entity_type] - order[right.item.entity_type],
    )) {
      const table = sourceTable(item.entity_type);
      const result = db
        .prepare(
          `DELETE FROM ${table}
           WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL`,
        )
        .run(item.entity_id, req.auth.workspaceId);
      if (!result.changes)
        conflict(HttpError, "trash item source is no longer deleted", {
          id: item.id,
        });
      db.prepare(
        "DELETE FROM trash_items WHERE id = ? AND workspace_id = ?",
      ).run(item.id, req.auth.workspaceId);
    }
    return { count: entries.length, cleanupRows };
  });
}

export function registerTrashRoutes(
  app,
  { requireAuth, ensureWritable, withTransaction, HttpError, fail, isoNow },
) {
  app.get("/api/trash", requireAuth, (req, res, next) => {
    try {
      const type = parseType(req.query?.type, HttpError);
      const query = String(req.query?.q ?? "");
      if (query.length > 200) throw new HttpError(400, "q is too long");
      const page = parsePage(req.query?.page, HttpError);
      const allVisible = visibleItems(
        app.locals.db,
        req.auth.workspaceId,
        req.auth,
        "all",
        "",
      );
      const filtered = visibleItems(
        app.locals.db,
        req.auth.workspaceId,
        req.auth,
        type,
        query,
      );
      const summary = {
        total: allVisible.length,
        task: allVisible.filter((item) => item.entity_type === "task").length,
        customer: allVisible.filter((item) => item.entity_type === "customer")
          .length,
        transaction: allVisible.filter(
          (item) => item.entity_type === "transaction",
        ).length,
      };
      const start = (page - 1) * PAGE_SIZE;
      const items = filtered
        .slice(start, start + PAGE_SIZE)
        .map(({ ...item }) => {
          const source = sourceRow(app.locals.db, item);
          return metadataJson(app.locals.db, item, source, req.auth);
        });
      return res.json({
        items,
        total: filtered.length,
        page,
        pageSize: PAGE_SIZE,
        summary,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/trash/:id", requireAuth, (req, res, next) => {
    try {
      const item = itemById(
        app.locals.db,
        req.auth.workspaceId,
        String(req.params.id || ""),
      );
      if (!item) return fail(res, 404, "trash item was not found");
      const source = sourceRow(app.locals.db, item);
      if (!isAuthorized(app.locals.db, item, source, req.auth))
        return fail(res, 404, "trash item was not found");
      return res.json({
        item: {
          ...metadataJson(app.locals.db, item, source, req.auth),
          details: detailsJson(item, source),
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/trash/restore", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const ids = parseIds(req.body, HttpError);
      const restored = restoreItems(app.locals.db, req, ids, {
        withTransaction,
        HttpError,
        isoNow,
      });
      return res.json({ restored });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/trash/purge", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      if (req.body?.confirmation !== PURGE_CONFIRMATION)
        throw new HttpError(400, "confirmation is invalid");
      const ids = parseIds(req.body, HttpError);
      const purged = purgeItems(app.locals.db, req, ids, {
        withTransaction,
        HttpError,
        isoNow,
      });
      cleanupAttachmentRows(app.locals.db, purged.cleanupRows, {
        now: isoNow(req.app.locals.clock),
      });
      return res.json({ purged: purged.count });
    } catch (error) {
      return next(error);
    }
  });
}
