import { createId } from "./auth.mjs";

export const TICKET_CATEGORIES = new Set([
  "billing",
  "account",
  "technical",
  "other",
]);
export const TICKET_PRIORITIES = new Set(["low", "normal", "high"]);
export const TICKET_STATUSES = new Set([
  "open",
  "in_progress",
  "waiting_customer",
  "resolved",
]);

const PAGE_SIZE = 20;
const COUNTED_STATUSES = [
  "open",
  "in_progress",
  "waiting_customer",
  "resolved",
];

function assertAllowedKeys(body, allowed, message) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "Dữ liệu yêu cầu không hợp lệ");
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new HttpError(400, message);
  }
}

function ticketField(value, field, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} là bắt buộc`);
    return "";
  }
  if (typeof value !== "string")
    throw new HttpError(400, `${field} phải là chuỗi`);
  const result = value.trim();
  if (required && !result) throw new HttpError(400, `${field} là bắt buộc`);
  if (result.length > max) throw new HttpError(400, `${field} quá dài`);
  return result;
}

function enumValue(value, field, allowed) {
  const result = ticketField(value, field, { required: true, max: 40 });
  if (!allowed.has(result)) throw new HttpError(400, `${field} không hợp lệ`);
  return result;
}

function pageValue(value) {
  if (value === undefined || value === "") return 1;
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
    throw new HttpError(400, "Trang không hợp lệ");
  return page;
}

function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN");
}

function searchLike(value) {
  return `%${String(value || "").replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function queryParams(req, { admin = false } = {}) {
  const q = ticketField(req.query?.q, "q", { max: 200 });
  const status = req.query?.status
    ? enumValue(req.query.status, "status", TICKET_STATUSES)
    : "";
  const category = req.query?.category
    ? enumValue(req.query.category, "category", TICKET_CATEGORIES)
    : "";
  const page = pageValue(req.query?.page);
  const workspaceId = admin
    ? ticketField(req.query?.workspaceId, "workspaceId", { max: 100 })
    : "";
  const userId = admin
    ? ticketField(req.query?.userId, "userId", { max: 100 })
    : "";
  return {
    q: normalizeSearch(q),
    status,
    category,
    page,
    pageSize: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    workspaceId,
    userId,
  };
}

function listWhere(params, { userId = null, workspaceId = null } = {}) {
  const clauses = ["1 = 1"];
  const values = [];
  if (userId) {
    clauses.push("t.requester_user_id = ?");
    values.push(userId);
  }
  if (workspaceId) {
    clauses.push("t.workspace_id = ?");
    values.push(workspaceId);
  }
  if (params.status) {
    clauses.push("t.status = ?");
    values.push(params.status);
  }
  if (params.category) {
    clauses.push("t.category = ?");
    values.push(params.category);
  }
  if (params.q) {
    clauses.push(`
      (
        unicode_fold(t.subject) LIKE ? ESCAPE '\\'
        OR CAST(t.number AS TEXT) LIKE ? ESCAPE '\\'
        OR unicode_fold(u.name) LIKE ? ESCAPE '\\'
        OR unicode_fold(u.email) LIKE ? ESCAPE '\\'
        OR unicode_fold(w.name) LIKE ? ESCAPE '\\'
      )
    `);
    const like = searchLike(params.q);
    values.push(like, like, like, like, like);
  }
  return { where: clauses.join(" AND "), values };
}

function ticketSelect() {
  return `
    SELECT
      t.id, t.number, t.subject, t.category, t.priority, t.status,
      t.created_at, t.updated_at,
      u.id AS requester_id, u.name AS requester_name, u.email AS requester_email,
      w.id AS workspace_id, w.name AS workspace_name,
      (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count
    FROM tickets t
    JOIN users u ON u.id = t.requester_user_id
    JOIN workspaces w ON w.id = t.workspace_id
  `;
}

function ticketItem(row) {
  return {
    id: row.id,
    number: Number(row.number),
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requester: {
      id: row.requester_id,
      name: row.requester_name,
      email: row.requester_email,
    },
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
    },
    messageCount: Number(row.message_count || 0),
  };
}

function ticketRow(db, id, { userId = null, workspaceId = null } = {}) {
  const clauses = ["t.id = ?"];
  const values = [id];
  if (userId) {
    clauses.push("t.requester_user_id = ?");
    values.push(userId);
  }
  if (workspaceId) {
    clauses.push("t.workspace_id = ?");
    values.push(workspaceId);
  }
  return db
    .prepare(`${ticketSelect()} WHERE ${clauses.join(" AND ")}`)
    .get(...values);
}

function ticketDetail(db, id, scope = {}) {
  const row = ticketRow(db, id, scope);
  if (!row) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ");
  const messages = db
    .prepare(
      `
      SELECT
        m.id, m.body, m.is_staff, m.created_at,
        u.id AS author_id, u.name AS author_name, u.email AS author_email
      FROM ticket_messages m
      JOIN users u ON u.id = m.author_user_id
      WHERE m.ticket_id = ?
      ORDER BY m.created_at ASC, m.insertion_order ASC
    `,
    )
    .all(id)
    .map((message) => ({
      id: message.id,
      body: message.body,
      author: {
        id: message.author_id,
        name: message.author_name,
        email: message.author_email,
      },
      isStaff: Boolean(message.is_staff),
      createdAt: message.created_at,
    }));
  const events = db
    .prepare(
      `
      SELECT
        e.id, e.type, e.from_value, e.to_value, e.created_at,
        u.name AS actor_name
      FROM ticket_events e
      LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.ticket_id = ?
      ORDER BY e.created_at ASC, e.insertion_order ASC
    `,
    )
    .all(id)
    .map((event) => ({
      id: event.id,
      type:
        event.type === "status_changed"
          ? "status"
          : event.type === "priority_changed"
            ? "priority"
            : event.type,
      fromValue: event.from_value ?? null,
      toValue: event.to_value ?? null,
      actorName: event.actor_name || "",
      createdAt: event.created_at,
    }));
  return { ticket: ticketItem(row), messages, events };
}

function nextTicketNumber(db) {
  const row = db
    .prepare("SELECT next_number FROM ticket_sequence WHERE id = 1 FOR UPDATE")
    .get();
  if (!row) {
    db.prepare(
      "INSERT INTO ticket_sequence(id, next_number) VALUES (1, 2)",
    ).run();
    return 1;
  }
  db.prepare(
    "UPDATE ticket_sequence SET next_number = next_number + 1 WHERE id = 1",
  ).run();
  return Number(row.next_number);
}

function insertEvent(db, { ticketId, type, fromValue, toValue, actorUserId, createdAt }) {
  db.prepare(
    `
      INSERT INTO ticket_events
        (id, ticket_id, type, from_value, to_value, actor_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    createId("ticket_event_"),
    ticketId,
    type,
    fromValue ?? null,
    toValue ?? null,
    actorUserId,
    createdAt,
  );
}

function listTickets(db, params, scope = {}) {
  const filters = listWhere(params, scope);
  const countFilters = listWhere({ ...params, status: "" }, scope);
  const total = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS total FROM tickets t
         JOIN users u ON u.id = t.requester_user_id
         JOIN workspaces w ON w.id = t.workspace_id
         WHERE ${filters.where}`,
      )
      .get(...filters.values).total || 0,
  );
  const rows = db
    .prepare(
      `${ticketSelect()} WHERE ${filters.where}
       ORDER BY t.updated_at DESC, t.number DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...filters.values, params.pageSize, params.offset)
    .map(ticketItem);
  const countRows = db
    .prepare(
      `SELECT t.status, COUNT(*) AS count
       FROM tickets t
       JOIN users u ON u.id = t.requester_user_id
       JOIN workspaces w ON w.id = t.workspace_id
       WHERE ${countFilters.where}
       GROUP BY t.status`,
    )
    .all(...countFilters.values);
  const counts = Object.fromEntries(COUNTED_STATUSES.map((status) => [status, 0]));
  for (const row of countRows) counts[row.status] = Number(row.count);
  return {
    items: rows,
    total,
    page: params.page,
    pageSize: params.pageSize,
    counts,
  };
}

function parseCreateBody(body) {
  assertAllowedKeys(
    body,
    new Set(["subject", "category", "priority", "message"]),
    "Trường dữ liệu ticket không được hỗ trợ",
  );
  return {
    subject: ticketField(body?.subject, "subject", { required: true, max: 160 }),
    category: enumValue(body?.category, "category", TICKET_CATEGORIES),
    priority: enumValue(body?.priority, "priority", TICKET_PRIORITIES),
    message: ticketField(body?.message, "message", { required: true, max: 5000 }),
  };
}

function parseMessageBody(body, { admin = false } = {}) {
  assertAllowedKeys(
    body,
    admin ? new Set(["body", "status", "reason"]) : new Set(["body"]),
    admin
      ? "Trường dữ liệu tin nhắn không được hỗ trợ"
      : "Người dùng không được tự đặt trạng thái hoặc người gửi ticket",
  );
  return {
    body: ticketField(body?.body, "body", { required: true, max: 5000 }),
    status:
      admin && body?.status !== undefined
        ? enumValue(body.status, "status", TICKET_STATUSES)
        : null,
  };
}

function auditReason(body) {
  const value = body?.reason;
  if (value === undefined || value === null || String(value).trim() === "")
    return "Cập nhật yêu cầu hỗ trợ";
  return ticketField(value, "reason", { required: true, max: 500 });
}

/**
 * Register the SaaS support-ticket API. Authorization is supplied by the
 * application so this module cannot accidentally create a second session or
 * a broader workspace-membership check.
 */
export function registerTicketRoutes(
  app,
  {
    db,
    clock,
    withTransaction,
    requireAuth,
    requirePlatformAdmin,
    HttpError: ErrorClass,
    fail,
    isoNow,
    writeAdminAudit,
  },
) {
  // Keep the local class reference available to the small parsing helpers.
  HttpError = ErrorClass;

  app.get("/api/tickets", requireAuth, (req, res, next) => {
    try {
      const params = queryParams(req);
      return res.json(
        listTickets(db, params, {
          userId: req.auth.userId,
          workspaceId: req.auth.workspaceId,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tickets", requireAuth, (req, res, next) => {
    try {
      const input = parseCreateBody(req.body || {});
      const now = isoNow(clock);
      let id;
      withTransaction(db, () => {
        id = createId("ticket_");
        const number = nextTicketNumber(db);
        db.prepare(
          `
          INSERT INTO tickets
            (id, number, workspace_id, requester_user_id, subject, category,
             priority, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
        `,
        ).run(
          id,
          number,
          req.auth.workspaceId,
          req.auth.userId,
          input.subject,
          input.category,
          input.priority,
          now,
          now,
        );
        db.prepare(
          `
          INSERT INTO ticket_messages
            (id, ticket_id, author_user_id, body, is_staff, created_at)
          VALUES (?, ?, ?, ?, 0, ?)
        `,
        ).run(createId("ticket_message_"), id, req.auth.userId, input.message, now);
        insertEvent(db, {
          ticketId: id,
          type: "created",
          fromValue: null,
          toValue: "open",
          actorUserId: req.auth.userId,
          createdAt: now,
        });
      });
      return res.status(201).json(
        ticketDetail(db, id, {
          userId: req.auth.userId,
          workspaceId: req.auth.workspaceId,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/tickets/:id", requireAuth, (req, res, next) => {
    try {
      return res.json(
        ticketDetail(db, req.params.id, {
          userId: req.auth.userId,
          workspaceId: req.auth.workspaceId,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tickets/:id/messages", requireAuth, (req, res, next) => {
    try {
      const input = parseMessageBody(req.body || {});
      let detail;
      withTransaction(db, () => {
        const ticket = ticketRow(db, req.params.id, {
          userId: req.auth.userId,
          workspaceId: req.auth.workspaceId,
        });
        if (!ticket) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ");
        const now = isoNow(clock);
        db.prepare(
          `
          INSERT INTO ticket_messages
            (id, ticket_id, author_user_id, body, is_staff, created_at)
          VALUES (?, ?, ?, ?, 0, ?)
        `,
        ).run(
          createId("ticket_message_"),
          ticket.id,
          req.auth.userId,
          input.body,
          now,
        );
        const nextStatus = ["resolved", "waiting_customer"].includes(ticket.status)
          ? "open"
          : ticket.status;
        if (nextStatus !== ticket.status) {
          db.prepare(
            "UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?",
          ).run(nextStatus, now, ticket.id);
          insertEvent(db, {
            ticketId: ticket.id,
            type: "status_changed",
            fromValue: ticket.status,
            toValue: nextStatus,
            actorUserId: req.auth.userId,
            createdAt: now,
          });
        } else {
          db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(
            now,
            ticket.id,
          );
        }
        detail = ticketDetail(db, ticket.id, {
          userId: req.auth.userId,
          workspaceId: req.auth.workspaceId,
        });
      });
      return res.status(201).json(detail);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/tickets", requirePlatformAdmin, (req, res, next) => {
    try {
      const params = queryParams(req, { admin: true });
      return res.json(
        listTickets(db, params, {
          userId: params.userId || null,
          workspaceId: params.workspaceId || null,
        }),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/tickets/:id", requirePlatformAdmin, (req, res, next) => {
    try {
      return res.json(ticketDetail(db, req.params.id));
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    "/api/admin/tickets/:id/messages",
    requirePlatformAdmin,
    (req, res, next) => {
      try {
        const input = parseMessageBody(req.body || {}, { admin: true });
        let detail;
        withTransaction(db, () => {
          const ticket = ticketRow(db, req.params.id);
          if (!ticket) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ");
          const now = isoNow(clock);
          db.prepare(
            `
            INSERT INTO ticket_messages
              (id, ticket_id, author_user_id, body, is_staff, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
          `,
          ).run(
            createId("ticket_message_"),
            ticket.id,
            req.auth.userId,
            input.body,
            now,
          );
          if (input.status && input.status !== ticket.status) {
            db.prepare(
              "UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?",
            ).run(input.status, now, ticket.id);
            insertEvent(db, {
              ticketId: ticket.id,
              type: "status_changed",
              fromValue: ticket.status,
              toValue: input.status,
              actorUserId: req.auth.userId,
              createdAt: now,
            });
          } else {
            db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(
              now,
              ticket.id,
            );
          }
          if (writeAdminAudit) {
            writeAdminAudit(db, {
              actorUserId: req.auth.userId,
              action: "ticket.reply",
              targetType: "ticket",
              targetId: ticket.id,
              reason: auditReason(req.body || {}),
              before: { status: ticket.status },
              after: { status: input.status || ticket.status },
              createdAt: now,
            });
          }
          detail = ticketDetail(db, ticket.id);
        });
        return res.status(201).json(detail);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.patch("/api/admin/tickets/:id", requirePlatformAdmin, (req, res, next) => {
    try {
      const body = req.body || {};
      const hasStatus = body.status !== undefined;
      const hasPriority = body.priority !== undefined;
      if (!hasStatus && !hasPriority)
        throw new HttpError(400, "Cần cập nhật status hoặc priority");
      const status = hasStatus
        ? enumValue(body.status, "status", TICKET_STATUSES)
        : null;
      const priority = hasPriority
        ? enumValue(body.priority, "priority", TICKET_PRIORITIES)
        : null;
      let detail;
      withTransaction(db, () => {
        const ticket = ticketRow(db, req.params.id);
        if (!ticket) throw new HttpError(404, "Không tìm thấy yêu cầu hỗ trợ");
        const nextStatus = status || ticket.status;
        const nextPriority = priority || ticket.priority;
        const now = isoNow(clock);
        if (nextStatus !== ticket.status || nextPriority !== ticket.priority) {
          db.prepare(
            "UPDATE tickets SET status = ?, priority = ?, updated_at = ? WHERE id = ?",
          ).run(nextStatus, nextPriority, now, ticket.id);
        }
        if (nextStatus !== ticket.status) {
          insertEvent(db, {
            ticketId: ticket.id,
            type: "status_changed",
            fromValue: ticket.status,
            toValue: nextStatus,
            actorUserId: req.auth.userId,
            createdAt: now,
          });
        }
        if (nextPriority !== ticket.priority) {
          insertEvent(db, {
            ticketId: ticket.id,
            type: "priority_changed",
            fromValue: ticket.priority,
            toValue: nextPriority,
            actorUserId: req.auth.userId,
            createdAt: now,
          });
        }
        if (writeAdminAudit && (nextStatus !== ticket.status || nextPriority !== ticket.priority)) {
          writeAdminAudit(db, {
            actorUserId: req.auth.userId,
            action: "ticket.update",
            targetType: "ticket",
            targetId: ticket.id,
            reason: auditReason(body),
            before: { status: ticket.status, priority: ticket.priority },
            after: { status: nextStatus, priority: nextPriority },
            createdAt: now,
          });
        }
        detail = ticketDetail(db, ticket.id);
      });
      return res.json(detail);
    } catch (error) {
      return next(error);
    }
  });
}

// The parsing helpers are intentionally kept private; this binding exists so
// errors can be supplied by the host without introducing a circular import.
let HttpError = Error;
