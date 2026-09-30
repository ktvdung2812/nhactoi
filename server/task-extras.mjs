import { RECURRENCES as RECURRENCE_VALUES } from "../shared/task-recurrence.mjs";
import { validateRecurrenceOptions, storedRecurrenceOptions } from "./recurrence.mjs";
import { createId } from "./auth.mjs";
import { resolveTaskColumn } from "./boards.mjs";
import {
  canAccessTeamTask,
  canManageAllTeams,
  getTeamAccess,
} from "./teams.mjs";

const MAX_LABELS = 50;
const MAX_ASSIGNEES = 50;
const MAX_CHECKLISTS = 50;
const MAX_CHECKLIST_ITEMS = 100;
const KINDS = new Set(["task", "checklist"]);
const STATUSES = new Set(["todo", "doing", "done"]);
const PRIORITIES = new Set(["low", "medium", "high"]);
const RECURRENCES = new Set(RECURRENCE_VALUES);

function errorOf(HttpError, status, message) {
  return new (HttpError || Error)(status, message);
}

function bodyObject(value, HttpError) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw errorOf(HttpError, 400, "request body is invalid");
  return value;
}

function assertKeys(value, allowed, HttpError) {
  bodyObject(value, HttpError);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw errorOf(HttpError, 400, "request body contains unsupported fields");
  }
}

function stringValue(value, field, HttpError, { required = false, max = 240 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw errorOf(HttpError, 400, `${field} is required`);
    return "";
  }
  if (typeof value !== "string") throw errorOf(HttpError, 400, `${field} is invalid`);
  const result = value.trim();
  if (required && !result) throw errorOf(HttpError, 400, `${field} is required`);
  if (result.length > max) throw errorOf(HttpError, 400, `${field} is too long`);
  return result;
}

function idArray(value, field, HttpError, max) {
  if (!Array.isArray(value) || value.length > max)
    throw errorOf(HttpError, 400, `${field} must be an array of at most ${max} items`);
  const ids = value.map((item) => stringValue(item, field, HttpError, { required: true, max: 160 }));
  if (new Set(ids).size !== ids.length)
    throw errorOf(HttpError, 400, `${field} contains duplicates`);
  return ids;
}

function nowIso(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString();
}

function dueValue(value, HttpError) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !value.trim())
    throw errorOf(HttpError, 400, "dueAt is required");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw errorOf(HttpError, 400, "dueAt is invalid");
  return date.toISOString();
}

function teamValue(value, HttpError) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw errorOf(HttpError, 400, "teamId is invalid");
  return value.trim() || null;
}

function sameTeam(left, right) {
  return (left || null) === (right || null);
}

function taskRow(db, workspaceId, taskId) {
  return db
    .prepare(
      `SELECT t.*, tm.name AS team_name, tm.archived_at AS team_archived
       FROM tasks t
       LEFT JOIN teams tm ON tm.id = t.team_id AND tm.workspace_id = t.workspace_id
       WHERE t.id = ? AND t.workspace_id = ? AND t.deleted_at IS NULL`,
    )
    .get(taskId, workspaceId);
}

function taskForUser(db, auth, taskId, HttpError, { write = false } = {}) {
  const task = taskRow(db, auth.workspaceId, taskId);
  if (!task || !canAccessTeamTask(db, auth.workspaceId, auth.userId, task.team_id))
    return null;
  if (
    write &&
    !canAccessTeamTask(db, auth.workspaceId, auth.userId, task.team_id, { write: true })
  )
    throw errorOf(HttpError, 409, "team is archived and read-only");
  return task;
}

function workspaceRole(db, workspaceId, userId) {
  return db
    .prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId)?.role || null;
}

function canManageScope(db, workspaceId, userId, teamId) {
  if (teamId === null || teamId === undefined) return canManageAllTeams(db, workspaceId, userId);
  return Boolean(getTeamAccess(db, workspaceId, userId, teamId)?.canManage);
}

function canWriteScope(db, workspaceId, userId, teamId) {
  if (!canAccessTeamTask(db, workspaceId, userId, teamId, { write: true })) return false;
  return Boolean(workspaceRole(db, workspaceId, userId));
}

function visibleTemplate(db, auth, template) {
  return Boolean(
    template &&
      template.workspace_id === auth.workspaceId &&
      canAccessTeamTask(db, auth.workspaceId, auth.userId, template.team_id),
  );
}

function templateCanDelete(db, auth, template) {
  return (
    canWriteScope(db, auth.workspaceId, auth.userId, template.team_id) &&
    (template.created_by === auth.userId ||
      canManageScope(db, auth.workspaceId, auth.userId, template.team_id))
  );
}

function labelRows(db, workspaceId, taskId) {
  return db
    .prepare(
      `SELECT l.id, l.name, l.color
       FROM task_label_links ll
       JOIN task_labels l ON l.id = ll.label_id AND l.workspace_id = ?
       WHERE ll.task_id = ?
       ORDER BY lower(l.name) ASC, l.id ASC`,
    )
    .all(workspaceId, taskId);
}

function labelIds(db, workspaceId, taskId) {
  return labelRows(db, workspaceId, taskId).map((row) => row.id);
}

function memberRows(db, workspaceId, teamId) {
  if (teamId) {
    return db
      .prepare(
        `SELECT u.id, u.name
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.workspace_id = ? AND tm.team_id = ? AND u.disabled_at IS NULL
         ORDER BY lower(u.name) ASC, u.id ASC`,
      )
      .all(workspaceId, teamId);
  }
  return db
    .prepare(
      `SELECT u.id, u.name
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ? AND u.disabled_at IS NULL
       ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                lower(u.name) ASC, u.id ASC`,
    )
    .all(workspaceId);
}

function checklistRows(db, workspaceId, taskId) {
  const lists = db
    .prepare(
      `SELECT c.id, c.title, c.position, c.created_at
       FROM task_checklists c
       JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
       WHERE c.task_id = ? AND t.deleted_at IS NULL
       ORDER BY c.position ASC, c.created_at ASC, c.id ASC`,
    )
    .all(workspaceId, taskId);
  const itemRows = db
    .prepare(
      `SELECT i.id, i.checklist_id, i.title, i.completed, i.position, i.start_at, i.due_at, i.remind_at, i.created_at
       FROM task_checklist_items i
       JOIN task_checklists c ON c.id = i.checklist_id AND c.task_id = ?
       JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
       WHERE t.deleted_at IS NULL
       ORDER BY i.position ASC, i.created_at ASC, i.id ASC`,
    )
    .all(taskId, workspaceId);
  const assigneeRows = itemRows.length
    ? db.prepare(
      `SELECT item_id, user_id FROM task_checklist_assignees WHERE item_id IN (${itemRows.map(() => "?").join(",")}) ORDER BY user_id`,
    ).all(...itemRows.map((row) => row.id))
    : [];
  const assigneeIds = new Map();
  for (const row of assigneeRows) {
    const list = assigneeIds.get(row.item_id) || [];
    list.push(row.user_id);
    assigneeIds.set(row.item_id, list);
  }
  const items = new Map();
  for (const row of itemRows) {
    const list = items.get(row.checklist_id) || [];
    list.push({
      id: row.id,
      title: row.title,
      completed: Boolean(row.completed),
      startAt: row.start_at || null,
      dueAt: row.due_at || null,
      remindAt: row.remind_at || null,
      assigneeIds: assigneeIds.get(row.id) || [],
    });
    items.set(row.checklist_id, list);
  }
  return lists.map((row) => ({ id: row.id, title: row.title, items: items.get(row.id) || [] }));
}

function checklistById(db, workspaceId, taskId, checklistId) {
  return db
    .prepare(
      `SELECT c.*
       FROM task_checklists c
       JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
       WHERE c.id = ? AND c.task_id = ? AND t.deleted_at IS NULL`,
    )
    .get(workspaceId, checklistId, taskId);
}

function itemById(db, workspaceId, taskId, checklistId, itemId) {
  return db
    .prepare(
      `SELECT i.*
       FROM task_checklist_items i
       JOIN task_checklists c ON c.id = i.checklist_id AND c.task_id = ?
       JOIN tasks t ON t.id = c.task_id AND t.workspace_id = ?
       WHERE i.id = ? AND i.checklist_id = ? AND t.deleted_at IS NULL`,
    )
    .get(taskId, workspaceId, itemId, checklistId);
}

function itemJson(row) {
  return { id: row.id, title: row.title, completed: Boolean(row.completed) };
}

function checklistJson(db, workspaceId, taskId, checklistId) {
  const rows = checklistRows(db, workspaceId, taskId);
  return rows.find((row) => row.id === checklistId) || null;
}

function recordActivity(recordTaskActivity, db, values) {
  if (typeof recordTaskActivity === "function") recordTaskActivity(db, values);
}

function extrasPayload(db, auth, task) {
  return {
    assigneeIds: extraAssigneeIds(db, task.id),
    labelIds: labelIds(db, auth.workspaceId, task.id),
    labels: labelRows(db, auth.workspaceId, task.id),
    members: memberRows(db, auth.workspaceId, task.team_id),
    checklists: checklistRows(db, auth.workspaceId, task.id),
  };
}

export function extraAssigneeIds(db, taskId) {
  return db
    .prepare(
      `SELECT user_id FROM task_assignees
       WHERE task_id = ?
       ORDER BY position ASC, created_at ASC, user_id ASC`,
    )
    .all(taskId)
    .map((row) => row.user_id);
}

function validWorkspaceMember(db, workspaceId, userId) {
  return db
    .prepare(
      `SELECT 1 FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ? AND wm.user_id = ? AND u.disabled_at IS NULL`,
    )
    .get(workspaceId, userId);
}

function validateAssigneeIds(db, workspaceId, teamId, ids, HttpError) {
  for (const id of ids) {
    if (!validWorkspaceMember(db, workspaceId, id))
      throw errorOf(HttpError, 400, "assigneeIds contains a user outside this workspace");
    if (teamId && !db
      .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND workspace_id = ? AND user_id = ?")
      .get(teamId, workspaceId, id))
      throw errorOf(HttpError, 400, "assigneeIds must belong to the task team");
  }
}

function isCardMember(db, task, userId) {
  if (!task || !userId) return false;
  if (task.assignee_id === userId) return true;
  return Boolean(db.prepare("SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?").get(task.id, userId));
}

function validAssigneeId(db, workspaceId, teamId, id) {
  if (!id || !validWorkspaceMember(db, workspaceId, id)) return false;
  if (!teamId) return true;
  return Boolean(
    db
      .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND workspace_id = ? AND user_id = ?")
      .get(teamId, workspaceId, id),
  );
}

function validateLabelIds(db, workspaceId, ids, HttpError) {
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id FROM task_labels WHERE workspace_id = ? AND id IN (${placeholders})`,
    )
    .all(workspaceId, ...ids);
  if (rows.length !== ids.length)
    throw errorOf(HttpError, 400, "labelIds contains an unknown label");
}

function setTaskExtras(db, workspaceId, taskId, assigneeIds, labelIdsValue, now) {
  const retained = new Set(assigneeIds);
  for (const previous of db.prepare("SELECT user_id FROM task_assignees WHERE task_id = ?").all(taskId)) {
    if (!retained.has(previous.user_id)) db.prepare("DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?").run(taskId, previous.user_id);
  }
  const insertAssignee = db.prepare(
    "INSERT INTO task_assignees(task_id, user_id, position, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(task_id,user_id) DO UPDATE SET position=excluded.position",
  );
  assigneeIds.forEach((id, index) => insertAssignee.run(taskId, id, index, now));
  db.prepare("DELETE FROM task_label_links WHERE task_id = ?").run(taskId);
  const insertLabel = db.prepare(
    "INSERT INTO task_label_links(task_id, label_id, created_at) VALUES (?, ?, ?)",
  );
  labelIdsValue.forEach((id) => insertLabel.run(taskId, id, now));
}

function templateJson(row, canDelete) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    teamId: row.team_id || null,
    canDelete: Boolean(canDelete),
  };
}

function templateRow(db, workspaceId, id) {
  return db
    .prepare("SELECT * FROM task_templates WHERE id = ? AND workspace_id = ?")
    .get(id, workspaceId);
}

function parsePayload(template, HttpError) {
  try {
    const payload = JSON.parse(template.payload_json);
    if (!payload || typeof payload !== "object") throw new Error("invalid");
    return payload;
  } catch {
    throw errorOf(HttpError, 500, "template payload is invalid");
  }
}

function taskTemplatePayload(db, workspaceId, task) {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    remindAt: task.remind_at,
    assigneeId: task.assignee_id,
    customerId: task.customer_id,
    category: task.category,
    recurrence: task.recurrence,
    recurrenceOptions: storedRecurrenceOptions(task),
    teamId: task.team_id || null,
    columnId: task.column_id || null,
    assigneeIds: extraAssigneeIds(db, task.id),
    labelIds: labelIds(db, workspaceId, task.id),
  };
}

function checklistTemplatePayload(db, workspaceId, task, checklistId) {
  const lists = checklistRows(db, workspaceId, task.id);
  const selected = checklistId
    ? lists.filter((list) => list.id === checklistId)
    : lists;
  if (checklistId && !selected.length) return null;
  return {
    checklists: selected.map((list) => ({
      title: list.title,
      items: list.items.map((item) => ({ ...item })),
    })),
  };
}

function sourceTaskForTemplate(db, auth, sourceTaskId, HttpError) {
  const task = taskForUser(db, auth, sourceTaskId, HttpError, { write: true });
  if (!task) throw errorOf(HttpError, 404, "source task was not found");
  return task;
}

function insertChecklistTree(db, taskId, payload, actorUserId, now) {
  const created = [];
  for (const list of payload.checklists || []) {
    const checklistId = createId("checklist_");
    db.prepare(
      `INSERT INTO task_checklists
       (id, task_id, title, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(checklistId, taskId, list.title, created.length, actorUserId, now, now);
    const items = [];
    const task = db.prepare("SELECT id, assignee_id, workspace_id, team_id FROM tasks WHERE id = ?").get(taskId);
    for (const [index, item] of (list.items || []).entries()) {
      const itemId = createId("checkitem_");
      db.prepare(
        `INSERT INTO task_checklist_items
         (id, checklist_id, title, completed, position, start_at, due_at, remind_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(itemId, checklistId, item.title, item.completed ? 1 : 0, index, item.startAt || null, item.dueAt || null, item.remindAt || null, now, now);
      const insertAssignee = db.prepare("INSERT INTO task_checklist_assignees(item_id, user_id) VALUES (?, ?)");
      for (const userId of item.assigneeIds || []) {
        if (task && validAssigneeId(db, task.workspace_id, task.team_id, userId) && isCardMember(db, task, userId)) insertAssignee.run(itemId, userId);
      }
      items.push({ id: itemId, title: item.title, completed: Boolean(item.completed) });
    }
    created.push({ id: checklistId, title: list.title, items });
  }
  return created;
}

function copyChecklistTree(db, sourceTaskId, targetTaskId, actorUserId, now) {
  // The caller has already checked both tasks and supplies rows through the
  // direct query below; the task ids are from the same workspace.
  const lists = db
    .prepare(
      `SELECT c.id, c.title, c.position, c.created_at
       FROM task_checklists c WHERE c.task_id = ?
       ORDER BY c.position ASC, c.created_at ASC, c.id ASC`,
    )
    .all(sourceTaskId);
  const created = [];
  for (const list of lists) {
    const checklistId = createId("checklist_");
    db.prepare(
      `INSERT INTO task_checklists
       (id, task_id, title, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(checklistId, targetTaskId, list.title, created.length, actorUserId, now, now);
    const target = db.prepare("SELECT id, assignee_id, workspace_id, team_id FROM tasks WHERE id = ?").get(targetTaskId);
    const items = db
      .prepare(
        `SELECT title, completed, position, created_at, id, start_at, due_at, remind_at
         FROM task_checklist_items WHERE checklist_id = ?
         ORDER BY position ASC, created_at ASC, id ASC`,
      )
      .all(list.id);
    items.forEach((item, index) => {
      const itemId = createId("checkitem_");
      db.prepare(
        `INSERT INTO task_checklist_items
         (id, checklist_id, title, completed, position, start_at, due_at, remind_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(itemId, checklistId, item.title, item.completed ? 1 : 0, index, item.start_at || null, item.due_at || null, item.remind_at || null, now, now);
      const people = db.prepare("SELECT user_id FROM task_checklist_assignees WHERE item_id = ?").all(item.id);
      const insertAssignee = db.prepare("INSERT INTO task_checklist_assignees(item_id, user_id) VALUES (?, ?)");
      for (const person of people) {
        if (target && validAssigneeId(db, target.workspace_id, target.team_id, person.user_id) && isCardMember(db, target, person.user_id)) insertAssignee.run(itemId, person.user_id);
      }
    });
    created.push(checklistId);
  }
  return created;
}

function insertTaskFromData(
  db,
  {
    workspaceId,
    teamId,
    title,
    description = "",
    status = "todo",
    priority = "medium",
    dueAt,
    remindAt = null,
    assigneeId = null,
    customerId = null,
    category = "",
    recurrence = "none",
    recurrenceOptions,
    columnId = undefined,
    actorUserId,
    now,
    clock,
    HttpError,
  },
) {
  const requestedStatus = STATUSES.has(status) ? status : "todo";
  const requestedPriority = PRIORITIES.has(priority) ? priority : "medium";
  const requestedRecurrence = RECURRENCES.has(recurrence) ? recurrence : "none";
  const options = validateRecurrenceOptions(requestedRecurrence, recurrenceOptions, HttpError);
  if (!dueAt && requestedRecurrence !== "none") throw errorOf(HttpError, 400, "Công việc lặp cần có hạn hoàn thành.");
  const column = resolveTaskColumn(db, {
    workspaceId,
    teamId,
    status: requestedStatus,
    columnId: columnId || undefined,
    clock,
    HttpError,
  });
  const id = createId("task_");
  db.prepare(
    `INSERT INTO tasks
     (id, workspace_id, title, description, status, priority, due_at, remind_at,
      assignee_id, customer_id, team_id, column_id, board_position, category,
      recurrence, recurrence_options, recurrence_anchor, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    title,
    description,
    column.status,
    requestedPriority,
    dueAt,
    remindAt,
    assigneeId,
    customerId,
    teamId,
    column.id,
    category,
    requestedRecurrence,
    JSON.stringify(options),
    requestedRecurrence === "none" ? null : dueAt,
    actorUserId,
    now,
    now,
  );
  return id;
}

function ensureTargetTeam(db, auth, teamId, HttpError) {
  if (!canAccessTeamTask(db, auth.workspaceId, auth.userId, teamId, { write: true }))
    throw errorOf(HttpError, 403, "you do not have access to the target team");
}

function templateTaskTeam(template, requestedTeamId, HttpError) {
  if (template.team_id && template.team_id !== requestedTeamId)
    throw errorOf(HttpError, 403, "template is scoped to another team");
}

function taskDataFromPayload(payload, dueAt, teamId, source, db, auth, HttpError) {
  const mainAssignee = payload.assigneeId && validAssigneeId(db, auth.workspaceId, teamId, payload.assigneeId)
    ? payload.assigneeId
    : payload.assigneeId
      ? null
      : null;
  if (payload.assigneeId && !mainAssignee)
    throw errorOf(HttpError, 400, "template assignee is no longer active in the target team");
  const extraIds = Array.isArray(payload.assigneeIds) ? payload.assigneeIds : [];
  validateAssigneeIds(db, auth.workspaceId, teamId, extraIds, HttpError);
  if (mainAssignee) {
    const filtered = extraIds.filter((id) => id !== mainAssignee);
    return {
      title: stringValue(payload.title, "title", HttpError, { required: true, max: 240 }),
      description: stringValue(payload.description, "description", HttpError, { max: 5000 }),
      status: STATUSES.has(payload.status) ? payload.status : "todo",
      priority: PRIORITIES.has(payload.priority) ? payload.priority : "medium",
      dueAt,
      remindAt: payload.remindAt || null,
      assigneeId: mainAssignee,
      customerId: payload.customerId || null,
      category: stringValue(payload.category, "category", HttpError, { max: 120 }),
      recurrence: RECURRENCES.has(payload.recurrence) ? payload.recurrence : "none",
      recurrenceOptions: payload.recurrenceOptions,
      columnId: source && sameTeam(source.team_id, teamId) ? payload.columnId || undefined : undefined,
      extraIds: filtered,
      labelIds: Array.isArray(payload.labelIds) ? payload.labelIds : [],
    };
  }
  return {
    title: stringValue(payload.title, "title", HttpError, { required: true, max: 240 }),
    description: stringValue(payload.description, "description", HttpError, { max: 5000 }),
    status: STATUSES.has(payload.status) ? payload.status : "todo",
    priority: PRIORITIES.has(payload.priority) ? payload.priority : "medium",
    dueAt,
    remindAt: payload.remindAt || null,
    assigneeId: null,
    customerId: payload.customerId || null,
    category: stringValue(payload.category, "category", HttpError, { max: 120 }),
    recurrence: RECURRENCES.has(payload.recurrence) ? payload.recurrence : "none",
    recurrenceOptions: payload.recurrenceOptions,
    columnId: source && sameTeam(source.team_id, teamId) ? payload.columnId || undefined : undefined,
    extraIds,
    labelIds: Array.isArray(payload.labelIds) ? payload.labelIds : [],
  };
}

function insertExtrasAndLabels(db, workspaceId, taskId, extraIds, labels, now) {
  const insertAssignee = db.prepare(
    "INSERT INTO task_assignees(task_id, user_id, position, created_at) VALUES (?, ?, ?, ?)",
  );
  extraIds.forEach((id, index) => insertAssignee.run(taskId, id, index, now));
  const insertLabel = db.prepare(
    "INSERT INTO task_label_links(task_id, label_id, created_at) VALUES (?, ?, ?)",
  );
  labels.forEach((id) => insertLabel.run(taskId, id, now));
}

function taskCopyPayload(db, workspaceId, task) {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    remindAt: task.remind_at,
    assigneeId: task.assignee_id,
    customerId: task.customer_id,
    category: task.category,
    recurrence: task.recurrence,
    recurrenceOptions: storedRecurrenceOptions(task),
    teamId: task.team_id || null,
    columnId: task.column_id || null,
    assigneeIds: extraAssigneeIds(db, task.id),
    labelIds: labelIds(db, workspaceId, task.id),
  };
}

export function registerTaskExtrasRoutes(
  app,
  {
    db,
    clock,
    isoNow = nowIso,
    withTransaction,
    requireAuth,
    ensureWritable,
    HttpError,
    fail,
    recordTaskActivity,
  },
) {
  const timestamp = () => isoNow(clock);

  function taskOr404(req, { write = false } = {}) {
    const task = taskForUser(db, req.auth, req.params.id, HttpError, { write });
    if (!task) throw errorOf(HttpError, 404, "task was not found");
    return task;
  }

  function templateOr404(req, { write = false } = {}) {
    const template = templateRow(db, req.auth.workspaceId, req.params.id);
    if (!template || !visibleTemplate(db, req.auth, template))
      throw errorOf(HttpError, 404, "template was not found");
    if (write && !canWriteScope(db, req.auth.workspaceId, req.auth.userId, template.team_id))
      throw errorOf(HttpError, 409, "team is archived and read-only");
    return template;
  }

  app.get("/api/tasks/:id/extras", requireAuth, (req, res, next) => {
    try {
      const task = taskOr404(req);
      return res.json(extrasPayload(db, req.auth, task));
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/tasks/:id/extras", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const task = taskOr404(req, { write: true });
      assertKeys(req.body, new Set(["assigneeIds", "labelIds"]), HttpError);
      const assignees = idArray(req.body.assigneeIds, "assigneeIds", HttpError, MAX_ASSIGNEES);
      const labels = idArray(req.body.labelIds, "labelIds", HttpError, MAX_LABELS);
      validateAssigneeIds(db, req.auth.workspaceId, task.team_id, assignees, HttpError);
      if (task.assignee_id && assignees.includes(task.assignee_id))
        throw errorOf(HttpError, 400, "assigneeIds must exclude the primary assignee");
      validateLabelIds(db, req.auth.workspaceId, labels, HttpError);
      const now = timestamp();
      withTransaction(db, () => {
        setTaskExtras(db, req.auth.workspaceId, task.id, assignees, labels, now);
        recordActivity(recordTaskActivity, db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "task_extras_updated",
          summary: "đã cập nhật người phụ trách phụ và nhãn công việc",
          createdAt: now,
        });
      });
      return res.json(extrasPayload(db, req.auth, taskRow(db, req.auth.workspaceId, task.id)));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/task-labels", requireAuth, (req, res, next) => {
    try {
      const labels = db
        .prepare(
          `SELECT id, name, color, created_at, updated_at
           FROM task_labels WHERE workspace_id = ?
           ORDER BY lower(name) ASC, id ASC`,
        )
        .all(req.auth.workspaceId)
        .map((row) => ({ id: row.id, name: row.name, color: row.color }));
      return res.json({ labels });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/task-labels", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      if (!canManageAllTeams(db, req.auth.workspaceId, req.auth.userId))
        throw errorOf(HttpError, 403, "only workspace admins can manage labels");
      assertKeys(req.body, new Set(["name", "color"]), HttpError);
      const name = stringValue(req.body.name, "name", HttpError, { required: true, max: 80 });
      const color = stringValue(req.body.color, "color", HttpError, { required: true, max: 40 });
      const now = timestamp();
      const id = createId("label_");
      try {
        withTransaction(db, () => {
          db.prepare(
            `INSERT INTO task_labels(id, workspace_id, name, color, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, req.auth.workspaceId, name, color, req.auth.userId, now, now);
        });
      } catch (error) {
        if (String(error?.message || "").includes("UNIQUE"))
          throw errorOf(HttpError, 409, "a label with that name already exists");
        throw error;
      }
      return res.status(201).json({ label: { id, name, color } });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/task-templates", requireAuth, (req, res, next) => {
    try {
      const rows = db
        .prepare(
          `SELECT * FROM task_templates
           WHERE workspace_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .all(req.auth.workspaceId)
        .filter((row) => visibleTemplate(db, req.auth, row))
        .map((row) => templateJson(row, templateCanDelete(db, req.auth, row)));
      return res.json({ templates: rows });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/task-templates", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["sourceTaskId", "kind", "name", "checklistId"]), HttpError);
      const kind = stringValue(req.body.kind, "kind", HttpError, { required: true, max: 20 });
      if (!KINDS.has(kind)) throw errorOf(HttpError, 400, "kind is invalid");
      const name = stringValue(req.body.name, "name", HttpError, { required: true, max: 120 });
      const sourceTaskId = stringValue(req.body.sourceTaskId, "sourceTaskId", HttpError, { required: true, max: 160 });
      const source = sourceTaskForTemplate(db, req.auth, sourceTaskId, HttpError);
      const checklistId = req.body.checklistId === undefined || req.body.checklistId === null || req.body.checklistId === ""
        ? null
        : stringValue(req.body.checklistId, "checklistId", HttpError, { required: true, max: 160 });
      if (kind === "task" && checklistId)
        throw errorOf(HttpError, 400, "checklistId is only valid for checklist templates");
      const payload = kind === "task"
        ? taskTemplatePayload(db, req.auth.workspaceId, source)
        : checklistTemplatePayload(db, req.auth.workspaceId, source, checklistId);
      if (!payload) throw errorOf(HttpError, 404, "checklist was not found");
      const now = timestamp();
      const id = createId("template_");
      withTransaction(db, () => {
        db.prepare(
          `INSERT INTO task_templates
           (id, workspace_id, team_id, source_task_id, kind, name, payload_json, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          req.auth.workspaceId,
          source.team_id || null,
          source.id,
          kind,
          name,
          JSON.stringify(payload),
          req.auth.userId,
          now,
          now,
        );
      });
      const row = templateRow(db, req.auth.workspaceId, id);
      return res.status(201).json({ template: templateJson(row, true) });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/task-templates/:id", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      const template = templateOr404(req, { write: true });
      if (!templateCanDelete(db, req.auth, template))
        throw errorOf(HttpError, 403, "you do not have permission to delete this template");
      withTransaction(db, () => {
        const result = db
          .prepare("DELETE FROM task_templates WHERE id = ? AND workspace_id = ?")
          .run(template.id, req.auth.workspaceId);
        if (!result.changes) throw errorOf(HttpError, 404, "template was not found");
      });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/task-templates/:id/apply", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["taskId"]), HttpError);
      const template = templateOr404(req, { write: true });
      const taskId = stringValue(req.body.taskId, "taskId", HttpError, { required: true, max: 160 });
      const target = taskForUser(db, req.auth, taskId, HttpError, { write: true });
      if (!target) throw errorOf(HttpError, 404, "target task was not found");
      if (template.kind !== "checklist") throw errorOf(HttpError, 400, "only checklist templates can be applied");
      if (template.team_id && !sameTeam(template.team_id, target.team_id))
        throw errorOf(HttpError, 403, "template is scoped to another team");
      const payload = parsePayload(template, HttpError);
      if (!Array.isArray(payload.checklists) || !payload.checklists.length)
        throw errorOf(HttpError, 400, "template has no checklist data");
      if (Number(db.prepare("SELECT COUNT(*) AS count FROM task_checklists WHERE task_id = ?").get(target.id).count) + payload.checklists.length > MAX_CHECKLISTS)
        throw errorOf(HttpError, 400, "a task can have at most 50 checklists");
      if (payload.checklists.some((list) => (list.items || []).length > MAX_CHECKLIST_ITEMS))
        throw errorOf(HttpError, 400, "a checklist can have at most 100 items");
      const now = timestamp();
      let created;
      withTransaction(db, () => {
        created = insertChecklistTree(db, target.id, payload, req.auth.userId, now);
        recordActivity(recordTaskActivity, db, {
          taskId: target.id,
          actorUserId: req.auth.userId,
          action: "checklist_created",
          summary: `đã áp dụng mẫu checklist “${template.name}”`,
          createdAt: now,
        });
      });
      return res.status(201).json({ checklist: created[0] || null, checklists: created });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/task-templates/:id/create", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["dueAt", "teamId"]), HttpError);
      const template = templateOr404(req, { write: true });
      if (template.kind !== "task") throw errorOf(HttpError, 400, "only task templates can create tasks");
      const dueAt = dueValue(req.body.dueAt, HttpError);
      const teamId = teamValue(req.body.teamId, HttpError);
      templateTaskTeam(template, teamId, HttpError);
      ensureTargetTeam(db, req.auth, teamId, HttpError);
      const payload = parsePayload(template, HttpError);
      const data = taskDataFromPayload(payload, dueAt, teamId, template.team_id ? { team_id: template.team_id } : null, db, req.auth, HttpError);
      if (data.customerId && !db.prepare("SELECT 1 FROM customers WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL").get(data.customerId, req.auth.workspaceId))
        data.customerId = null;
      validateLabelIds(db, req.auth.workspaceId, data.labelIds, HttpError);
      const now = timestamp();
      let id;
      withTransaction(db, () => {
        id = insertTaskFromData(db, {
          workspaceId: req.auth.workspaceId,
          teamId,
          ...data,
          actorUserId: req.auth.userId,
          now,
          clock,
          HttpError,
        });
        insertExtrasAndLabels(db, req.auth.workspaceId, id, data.extraIds, data.labelIds, now);
        recordActivity(recordTaskActivity, db, {
          taskId: id,
          actorUserId: req.auth.userId,
          action: "task_created",
          summary: `đã tạo công việc từ mẫu “${template.name}”`,
          createdAt: now,
        });
      });
      return res.status(201).json({ task: { id } });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tasks/:id/copy", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["dueAt"]), HttpError);
      const source = taskOr404(req, { write: true });
      const dueAt = dueValue(req.body.dueAt, HttpError);
      const extras = extraAssigneeIds(db, source.id).filter((id) => validAssigneeId(db, source.workspace_id, source.team_id, id));
      const labels = labelIds(db, source.workspace_id, source.id);
      const assigneeId = validAssigneeId(db, source.workspace_id, source.team_id, source.assignee_id)
        ? source.assignee_id
        : null;
      const now = timestamp();
      let id;
      withTransaction(db, () => {
        id = insertTaskFromData(db, {
          workspaceId: source.workspace_id,
          teamId: source.team_id || null,
          title: source.title,
          description: source.description,
          status: source.status,
          priority: source.priority,
          dueAt,
          remindAt: source.remind_at,
          assigneeId,
          customerId: source.customer_id,
          category: source.category,
          recurrence: source.recurrence,
          recurrenceOptions: storedRecurrenceOptions(source),
          columnId: source.column_id || undefined,
          actorUserId: req.auth.userId,
          now,
          clock,
          HttpError,
        });
        insertExtrasAndLabels(db, source.workspace_id, id, extras.filter((userId) => userId !== assigneeId), labels, now);
        copyChecklistTree(db, source.id, id, req.auth.userId, now);
        recordActivity(recordTaskActivity, db, {
          taskId: id,
          actorUserId: req.auth.userId,
          action: "task_created",
          summary: `đã sao chép công việc “${source.title}”`,
          createdAt: now,
        });
      });
      return res.status(201).json({ task: { id } });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tasks/:id/checklists/:checklistId/copy", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(), HttpError);
      const task = taskOr404(req, { write: true });
      const source = checklistById(db, req.auth.workspaceId, task.id, req.params.checklistId);
      if (!source) throw errorOf(HttpError, 404, "checklist was not found");
      const now = timestamp();
      let createdId;
      withTransaction(db, () => {
        const id = createId("checklist_");
        const position = Number(db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM task_checklists WHERE task_id = ?").get(task.id).position) + 1;
        db.prepare(
          `INSERT INTO task_checklists(id, task_id, title, position, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, task.id, `${source.title} (copy)`, position, req.auth.userId, now, now);
        const items = db.prepare("SELECT title, completed, position, created_at, id, start_at, due_at, remind_at FROM task_checklist_items WHERE checklist_id = ? ORDER BY position, created_at, id").all(source.id);
        items.forEach((item, index) => {
          const itemId = createId("checkitem_");
          db.prepare(
            `INSERT INTO task_checklist_items(id, checklist_id, title, completed, position, start_at, due_at, remind_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(itemId, id, item.title, item.completed ? 1 : 0, index, item.start_at || null, item.due_at || null, item.remind_at || null, now, now);
          const insertAssignee = db.prepare("INSERT INTO task_checklist_assignees(item_id, user_id) VALUES (?, ?)");
          for (const person of db.prepare("SELECT user_id FROM task_checklist_assignees WHERE item_id = ?").all(item.id)) {
            if (isCardMember(db, task, person.user_id)) insertAssignee.run(itemId, person.user_id);
          }
        });
        createdId = id;
        recordActivity(recordTaskActivity, db, {
          taskId: task.id,
          actorUserId: req.auth.userId,
          action: "checklist_created",
          summary: `đã sao chép checklist “${source.title}”`,
          createdAt: now,
        });
      });
      return res.status(201).json({ checklist: checklistJson(db, req.auth.workspaceId, task.id, createdId) });
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/tasks/:id/checklists/:checklistId/order", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["ids"]), HttpError);
      const task = taskOr404(req, { write: true });
      const checklist = checklistById(db, req.auth.workspaceId, task.id, req.params.checklistId);
      if (!checklist) throw errorOf(HttpError, 404, "checklist was not found");
      const ids = idArray(req.body.ids, "ids", HttpError, MAX_CHECKLIST_ITEMS);
      const rows = db.prepare("SELECT id FROM task_checklist_items WHERE checklist_id = ? ORDER BY position, created_at, id").all(checklist.id);
      if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id)))
        throw errorOf(HttpError, 400, "ids must include every checklist item");
      const now = timestamp();
      withTransaction(db, () => {
        const update = db.prepare("UPDATE task_checklist_items SET position = ?, updated_at = ? WHERE id = ? AND checklist_id = ?");
        ids.forEach((id, index) => update.run(index, now, id, checklist.id));
      });
      const items = db.prepare("SELECT id, title, completed FROM task_checklist_items WHERE checklist_id = ? ORDER BY position, created_at, id").all(checklist.id).map(itemJson);
      return res.json({ ids, items });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tasks/:id/checklists/:checklistId/items/:itemId/convert", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["dueAt"]), HttpError);
      const source = taskOr404(req, { write: true });
      const item = itemById(db, req.auth.workspaceId, source.id, req.params.checklistId, req.params.itemId);
      if (!item) throw errorOf(HttpError, 404, "checklist item was not found");
      const itemDue = item.due_at && /^\d{4}-\d{2}-\d{2}$/.test(item.due_at) ? `${item.due_at}T00:00:00.000Z` : null;
      const dueAt = req.body.dueAt === undefined || req.body.dueAt === null || req.body.dueAt === ""
        ? itemDue || source.due_at
        : dueValue(req.body.dueAt, HttpError);
      const itemPeople = db.prepare("SELECT user_id FROM task_checklist_assignees WHERE item_id = ? ORDER BY user_id").all(item.id)
        .map((row) => row.user_id)
        .filter((id) => validAssigneeId(db, source.workspace_id, source.team_id, id));
      const assigneeId = itemPeople.length
        ? itemPeople[0]
        : validAssigneeId(db, source.workspace_id, source.team_id, source.assignee_id) ? source.assignee_id : null;
      const extras = itemPeople.length
        ? itemPeople.slice(1)
        : extraAssigneeIds(db, source.id).filter((id) => id !== assigneeId && validAssigneeId(db, source.workspace_id, source.team_id, id));
      const labels = labelIds(db, source.workspace_id, source.id);
      const now = timestamp();
      let id;
      withTransaction(db, () => {
        id = insertTaskFromData(db, {
          workspaceId: source.workspace_id,
          teamId: source.team_id || null,
          title: item.title,
          description: "",
          status: "todo",
          priority: source.priority,
          dueAt,
          remindAt: item.remind_at && !Number.isNaN(new Date(item.remind_at).getTime()) ? new Date(item.remind_at).toISOString() : null,
          assigneeId,
          customerId: source.customer_id,
          category: source.category,
          recurrence: "none",
          actorUserId: req.auth.userId,
          now,
          clock,
          HttpError,
        });
        insertExtrasAndLabels(db, source.workspace_id, id, extras, labels, now);
        db.prepare("DELETE FROM task_checklist_items WHERE id = ? AND checklist_id = ?").run(item.id, req.params.checklistId);
        recordActivity(recordTaskActivity, db, {
          taskId: id,
          actorUserId: req.auth.userId,
          action: "task_created",
          summary: `đã chuyển mục checklist “${item.title}” thành công việc`,
          createdAt: now,
        });
        recordActivity(recordTaskActivity, db, {
          taskId: source.id,
          actorUserId: req.auth.userId,
          action: "checklist_item_converted",
          summary: `đã chuyển mục checklist “${item.title}” thành công việc`,
          createdAt: now,
        });
      });
      return res.status(201).json({ task: { id } });
    } catch (error) {
      return next(error);
    }
  });
}

// Reuse current membership when carrying collaborative metadata into a recurrence.
export function reconcileTaskAssignees(db,task){
 for(const id of extraAssigneeIds(db,task.id))if(id===task.assignee_id||!validAssigneeId(db,task.workspace_id,task.team_id,id))db.prepare('DELETE FROM task_assignees WHERE task_id=? AND user_id=?').run(task.id,id);
}
export function copyRecurringExtras(db,sourceId,targetId,now){
 const target=db.prepare('SELECT * FROM tasks WHERE id=?').get(targetId);if(!target)return;
 const ids=extraAssigneeIds(db,sourceId).filter(id=>id!==target.assignee_id&&validAssigneeId(db,target.workspace_id,target.team_id,id));
 insertExtrasAndLabels(db,target.workspace_id,targetId,ids,labelIds(db,target.workspace_id,sourceId),now);
}
