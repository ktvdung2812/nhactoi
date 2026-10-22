import { defaultProjectId, getProjectAccess } from './projects.mjs';
import { canAccessTask } from './task-access.mjs';
import {emitTaskEvent} from "./automations.mjs";
import { createId } from "./auth.mjs";
import { canManageAllTeams, getTeamAccess } from "./teams.mjs";

const STATUSES = new Set(["todo", "doing", "done"]);
const DEFAULT_COLUMNS = [
  { name: "Cần làm", status: "todo", tone: "blue" },
  { name: "Đang làm", status: "doing", tone: "orange" },
  { name: "Hoàn thành", status: "done", tone: "green" },
];
const BOARD_TEAM_MISSING = Symbol("board-team-missing");

function nowIso(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString();
}

function commonTeamId(value) {
  if (value === undefined || value === null || value === "" || value === "null")
    return null;
  return String(value);
}

function errorOf(HttpError, status, message) {
  return new (HttpError || Error)(status, message);
}

function text(value, field, HttpError, { required = false, max = 120 } = {}) {
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

function assertObject(value, HttpError) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw errorOf(HttpError, 400, "request body is invalid");
}

function assertKeys(value, allowed, HttpError) {
  assertObject(value, HttpError);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw errorOf(HttpError, 400, "request body contains unsupported fields");
  }
}

function statusValue(value, HttpError, { required = true } = {}) {
  const valueText = text(value, "status", HttpError, { required, max: 20 });
  if (valueText && !STATUSES.has(valueText)) throw errorOf(HttpError, 400, "status is invalid");
  return valueText;
}

function toneValue(value, HttpError, { required = true } = {}) {
  return text(value, "tone", HttpError, { required, max: 40 });
}

function roleForWorkspace(db, workspaceId, userId) {
  return db
    .prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId)?.role || null;
}

function workspaceWritable(db, workspaceId, clock) {
  const workspace = db.prepare("SELECT suspended_at FROM workspaces WHERE id = ?").get(workspaceId);
  if (!workspace || workspace.suspended_at) return false;
  const subscription = db
    .prepare("SELECT status, current_period_end FROM subscriptions WHERE workspace_id = ?")
    .get(workspaceId);
  if (!subscription || subscription.status === "expired" || subscription.status === "canceled") return false;
  return new Date(subscription.current_period_end).getTime() > new Date(nowIso(clock)).getTime();
}

function teamExists(db, workspaceId, teamId) {
  if (!teamId) return true;
  return Boolean(
    db.prepare("SELECT 1 FROM teams WHERE id = ? AND workspace_id = ?").get(teamId, workspaceId),
  );
}

function scopePredicate(teamId) {
  return teamId === null ? "team_id IS NULL" : "team_id = ?";
}

function scopeArgs(workspaceId, teamId) {
  return teamId === null ? [workspaceId] : [workspaceId, teamId];
}

function boardRows(db, workspaceId, teamId, projectId = null) {
  if (db.dialect === 'postgres') return db.prepare('SELECT * FROM board_columns WHERE workspace_id=? AND project_id=? ORDER BY position,id').all(workspaceId, projectId || defaultProjectId(workspaceId, teamId));
  const predicate = scopePredicate(teamId);
  return db
    .prepare(
      `SELECT * FROM board_columns
       WHERE workspace_id = ? AND ${predicate}
       ORDER BY position ASC, id ASC`,
    )
    .all(...scopeArgs(workspaceId, teamId));
}

function activeBoardRows(db, workspaceId, teamId) {
  return boardRows(db, workspaceId, teamId).filter((row) => !row.archived_at);
}

function columnJson(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    tone: row.tone,
    position: Number(row.position || 0),
    archivedAt: row.archived_at || null,
  };
}

function preferenceTeamId(teamId) {
  return teamId === null ? "" : teamId;
}

function preferenceJson(db, workspaceId, userId, teamId, projectId = null) {
  const row = db
    .prepare(
      `SELECT collapsed_ids FROM board_preferences
       WHERE workspace_id = ? AND user_id = ? AND team_id = ?`,
    )
    .get(workspaceId, userId, projectId && projectId !== defaultProjectId(workspaceId, teamId) ? "project:" + projectId : preferenceTeamId(teamId));
  if (!row) return { collapsedIds: [] };
  try {
    const value = JSON.parse(row.collapsed_ids);
    return { collapsedIds: Array.isArray(value) ? value.filter((item) => typeof item === "string") : [] };
  } catch {
    return { collapsedIds: [] };
  }
}

/**
 * Make sure a board has one active default column for each lifecycle status.
 * This deliberately does not open a transaction: callers can invoke it from
 * an existing transaction, and a single request owns the DatabaseSync handle.
 */
export function ensureBoardColumns(db, workspaceId, teamId, clock, projectId = null) {
  if (db.dialect === 'postgres') {
    const id = projectId || defaultProjectId(workspaceId, teamId);
    const project = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=?').get(id, workspaceId);
    if (!project || (project.team_id || null) !== (teamId || null)) return [];
    const rows = boardRows(db, workspaceId, teamId, id), now = nowIso(clock);
    for (const [position, column] of DEFAULT_COLUMNS.entries()) {
      if (rows.some(row => row.status === column.status && !row.archived_at)) continue;
      db.prepare(`INSERT INTO board_columns(id,workspace_id,project_id,team_id,name,status,tone,position,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET archived_at=NULL`)
        .run('boardcol_' + id + '_' + column.status, workspaceId, id, teamId || null, column.name, column.status, column.tone, position, now, now);
    }
    const columns = boardRows(db, workspaceId, teamId, id);
    for (const status of STATUSES) {
      const column = columns.find(row => row.status === status && !row.archived_at);
      db.prepare('UPDATE tasks SET column_id=? WHERE workspace_id=? AND project_id=? AND status=? AND column_id IS NULL AND deleted_at IS NULL').run(column.id, workspaceId, id, status);
    }
    return columns;
  }
  const normalizedTeamId = commonTeamId(teamId);
  if (!teamExists(db, workspaceId, normalizedTeamId)) return [];
  const rows = boardRows(db, workspaceId, normalizedTeamId);
  const present = new Set(rows.filter((row) => !row.archived_at).map((row) => row.status));
  const now = nowIso(clock);
  for (const [index, defaults] of DEFAULT_COLUMNS.entries()) {
    if (present.has(defaults.status)) continue;
    const id = createId("boardcol_");
    const maxPosition = rows.reduce(
      (max, row) => Math.max(max, Number(row.position) || 0),
      -1,
    );
    const position = Math.max(index, maxPosition + 1);
    if (normalizedTeamId === null) {
      db.prepare(
        `INSERT INTO board_columns
         (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(id, workspaceId, defaults.name, defaults.status, defaults.tone, position, now, now);
    } else {
      db.prepare(
        `INSERT INTO board_columns
         (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        workspaceId,
        normalizedTeamId,
        defaults.name,
        defaults.status,
        defaults.tone,
        position,
        now,
        now,
      );
    }
    present.add(defaults.status);
  }

  // A task may have been created before its team board existed (or upgraded
  // from v10). Attach it to the first active column with the same status and
  // give it a stable initial order within that column.
  const columns = boardRows(db, workspaceId, normalizedTeamId).filter((row) => !row.archived_at);
  for (const status of STATUSES) {
    const column = columns.find((row) => row.status === status);
    if (!column) continue;
    const predicate = normalizedTeamId === null ? "team_id IS NULL" : "team_id = ?";
    const args = normalizedTeamId === null
      ? [column.id, workspaceId, status]
      : [column.id, workspaceId, normalizedTeamId, status];
    const unassigned = db
      .prepare(
        `SELECT id FROM tasks
         WHERE workspace_id = ? AND ${predicate} AND status = ?
           AND deleted_at IS NULL AND column_id IS NULL
         ORDER BY created_at ASC, id ASC`,
      )
      .all(...args.slice(1));
    if (!unassigned.length) continue;
    const currentMax = db
      .prepare(
        `SELECT COALESCE(MAX(board_position), -1) AS max_position
         FROM tasks WHERE workspace_id = ? AND column_id = ? AND deleted_at IS NULL`,
      )
      .get(workspaceId, column.id).max_position;
    const update = db.prepare(
      "UPDATE tasks SET column_id = ?, board_position = ? WHERE id = ? AND workspace_id = ? AND column_id IS NULL",
    );
    unassigned.forEach((task, offset) =>
      update.run(column.id, Number(currentMax) + 1 + offset, task.id, workspaceId),
    );
  }
  return boardRows(db, workspaceId, normalizedTeamId);
}

export function resolveTaskColumn(
  db,
  { workspaceId, teamId = null, projectId = null, status, columnId = undefined, clock, HttpError },
) {
  const normalizedTeamId = commonTeamId(teamId);
  if (db.dialect === 'postgres') {
    const columns = ensureBoardColumns(db, workspaceId, normalizedTeamId, clock, projectId);
    const row = columnId ? columns.find(row => row.id === columnId) : columns.find(row => row.status === status && !row.archived_at);
    if (!row) throw errorOf(HttpError, 400, 'columnId không thuộc dự án hoặc trạng thái không hợp lệ');
    if (row.archived_at) throw errorOf(HttpError, 409, 'column is archived');
    return row;
  }
  ensureBoardColumns(db, workspaceId, normalizedTeamId, clock);
  const predicate = scopePredicate(normalizedTeamId);
  const args = normalizedTeamId === null
    ? [workspaceId]
    : [workspaceId, normalizedTeamId];
  let row;
  if (columnId !== undefined && columnId !== null && columnId !== "") {
    row = db
      .prepare(`SELECT * FROM board_columns WHERE id = ? AND workspace_id = ? AND ${predicate}`)
      .get(columnId, ...args);
    if (!row) throw errorOf(HttpError, 400, "columnId is invalid");
  } else {
    row = db
      .prepare(
        `SELECT * FROM board_columns
         WHERE workspace_id = ? AND ${predicate} AND status = ? AND archived_at IS NULL
         ORDER BY position ASC, id ASC LIMIT 1`,
      )
      .get(...args, status);
  }
  if (!row) throw errorOf(HttpError, 409, "board has no active column for this status");
  if (row.archived_at) throw errorOf(HttpError, 409, "column is archived");
  return row;
}

export function boardTaskColumn(db, workspaceId, teamId, columnId, projectId = null) {
  if (db.dialect === 'postgres') return db.prepare('SELECT * FROM board_columns WHERE id=? AND workspace_id=? AND project_id=?').get(columnId, workspaceId, projectId || defaultProjectId(workspaceId, teamId));
  const normalizedTeamId = commonTeamId(teamId);
  const predicate = scopePredicate(normalizedTeamId);
  const args = normalizedTeamId === null ? [workspaceId] : [workspaceId, normalizedTeamId];
  return db
    .prepare(`SELECT * FROM board_columns WHERE id = ? AND workspace_id = ? AND ${predicate}`)
    .get(columnId, ...args);
}

export function syncTaskColumn(
  db,
  { workspaceId, taskId, teamId = null, projectId = null, status, columnId = undefined, boardPosition, clock, HttpError },
) {
  const column = resolveTaskColumn(db, {
    workspaceId,
    projectId: projectId || (db.dialect === "postgres" && taskId ? db.prepare("SELECT project_id FROM tasks WHERE id=? AND workspace_id=?").get(taskId, workspaceId)?.project_id : null),
    teamId,
    status,
    columnId,
    clock,
    HttpError,
  });
  if (taskId) {
    db.prepare(
      "UPDATE tasks SET column_id = ?, board_position = ? WHERE id = ? AND workspace_id = ?",
    ).run(column.id, Number.isFinite(Number(boardPosition)) ? Number(boardPosition) : 0, taskId, workspaceId);
  }
  return column;
}

function accessFor(db, auth, teamId, clock, projectId = null) {
  if (db.dialect === 'postgres') {
    const a = getProjectAccess(db, auth.workspaceId, auth.userId, projectId || defaultProjectId(auth.workspaceId, teamId), { config: db.projectConfig, clock });
    return a ? { teamId, team: null, visible: true, canManage: a.canManage, canWrite: a.canEdit } : null;
  }
  const normalizedTeamId = commonTeamId(teamId);
  if (normalizedTeamId === null) {
    const role = roleForWorkspace(db, auth.workspaceId, auth.userId);
    if (!role) return null;
    const writable = workspaceWritable(db, auth.workspaceId, clock);
    return {
      teamId: null,
      team: null,
      visible: true,
      canManage: writable && ["owner", "admin"].includes(role),
      canWrite: writable,
    };
  }
  const access = getTeamAccess(db, auth.workspaceId, auth.userId, normalizedTeamId);
  if (!access || !access.visible) return null;
  const writable = workspaceWritable(db, auth.workspaceId, clock) && !access.team.archived_at;
  return {
    teamId: normalizedTeamId,
    team: access.team,
    visible: true,
    canManage: writable && access.canManage,
    canWrite: writable,
  };
}

function requireAccess(db, auth, teamId, clock, HttpError, { manage = false, write = false, projectId = null } = {}) {
  const access = accessFor(db, auth, teamId, clock, projectId);
  if (!access) throw errorOf(HttpError, 404, "board was not found");
  // A read-only board stays 409 for everyone; only then is the role checked.
  if (write && !access.canWrite) throw errorOf(HttpError, 409, "board is read-only");
  if (manage && !access.canManage) throw errorOf(HttpError, 403, "you do not have permission to manage this board");
  return access;
}

function taskScopeRow(db, workspaceId, taskId) {
  return db
    .prepare(
      `SELECT t.*, tm.name AS team_name, tm.archived_at AS team_archived
       FROM tasks t
       LEFT JOIN teams tm ON tm.id = t.team_id AND tm.workspace_id = t.workspace_id
       WHERE t.id = ? AND t.workspace_id = ? AND t.deleted_at IS NULL`,
    )
    .get(taskId, workspaceId);
}

function boardTaskRows(db, workspaceId, teamId, columnId) {
  const normalizedTeamId = commonTeamId(teamId);
  const scope = normalizedTeamId === null ? "t.team_id IS NULL" : "t.team_id = ?";
  const args = normalizedTeamId === null
    ? [workspaceId, columnId]
    : [workspaceId, normalizedTeamId, columnId];
  return db
    .prepare(
      `SELECT t.* FROM tasks t
       WHERE t.workspace_id = ? AND ${scope} AND t.column_id = ? AND t.deleted_at IS NULL
       ORDER BY t.board_position ASC, t.created_at ASC, t.id ASC`,
    )
    .all(...args);
}

function setBoardPositions(db, workspaceId, teamId, columnId, taskIds, now) {
  const update = db.prepare(
    `UPDATE tasks SET board_position = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ? AND column_id = ? AND deleted_at IS NULL`,
  );
  taskIds.forEach((taskId, index) => update.run(index, now, taskId, workspaceId, columnId));
}

function parseTeamId(value, HttpError) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw errorOf(HttpError, 400, "teamId is invalid");
  return value.trim() || null;
}

function taskJsonWithBoard(taskJson, row, auth) {
  return taskJson
    ? taskJson(row, auth)
    : {
        id: row.id,
        status: row.status,
        columnId: row.column_id ?? null,
        boardPosition: Number(row.board_position || 0),
      };
}

export function registerBoardRoutes(
  app,
  {
    db,
    clock,
    withTransaction,
    requireAuth,
    ensureWritable,
    HttpError,
    fail,
    taskJson,
    transitionTaskStatus,
    recordTaskActivity,
  },
) {
  function scopeFor(req, value) {
    if (db.dialect === 'postgres' && value?.projectId) {
      const a = getProjectAccess(db, req.auth.workspaceId, req.auth.userId, value.projectId, { config: db.projectConfig, clock });
      if (!a) throw errorOf(HttpError, 404, 'Không tìm thấy bảng');
      if (value.teamId && value.teamId !== a.project.team_id) throw errorOf(HttpError, 400, 'Đội nhóm không khớp dự án');
      return { teamId: a.project.team_id, projectId: a.project.id };
    }
    const teamId = parseTeamId(value?.teamId, HttpError);
    return { teamId, projectId: db.dialect === 'postgres' ? defaultProjectId(req.auth.workspaceId, teamId) : null };
  }

  app.get("/api/boards", requireAuth, (req, res, next) => {
    try {
      const { teamId, projectId } = scopeFor(req, req.query);
      const access = requireAccess(db, req.auth, teamId, clock, HttpError, { projectId });
      const rows = ensureBoardColumns(db, req.auth.workspaceId, teamId, clock, projectId);
      return res.json({
        columns: rows.map(columnJson),
        canManage: access.canManage,
        canWrite: access.canWrite,
        preferences: preferenceJson(db, req.auth.workspaceId, req.auth.userId, teamId, projectId),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/boards/columns", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["projectId", "teamId", "name", "status", "tone"]), HttpError);
      const { teamId, projectId } = scopeFor(req, req.body);
      requireAccess(db, req.auth, teamId, clock, HttpError, { manage: true, write: true, projectId });
      if (!teamExists(db, req.auth.workspaceId, teamId)) throw errorOf(HttpError, 404, "team was not found");
      const name = text(req.body?.name, "name", HttpError, { required: true, max: 120 });
      const status = statusValue(req.body?.status, HttpError);
      const tone = toneValue(req.body?.tone, HttpError);
      const now = nowIso(clock);
      const created = withTransaction(db, () => {
        ensureBoardColumns(db, req.auth.workspaceId, teamId, clock, projectId);
        const rows = boardRows(db, req.auth.workspaceId, teamId, projectId);
        const position = rows.reduce((max, row) => Math.max(max, Number(row.position) || 0), -1) + 1;
        const id = createId("boardcol_");
        const predicate = teamId === null ? "NULL" : "?";
        const params = teamId === null
          ? [id, req.auth.workspaceId, name, status, tone, position, now, now]
          : [id, req.auth.workspaceId, teamId, name, status, tone, position, now, now];
        db.prepare(
          `INSERT INTO board_columns
           (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at${projectId ? ", project_id" : ""})
           VALUES (?, ?, ${predicate}, ?, ?, ?, ?, ?, ?${projectId ? ", ?" : ""})`,
        ).run(...params, ...(projectId ? [projectId] : []));
        return db.prepare("SELECT * FROM board_columns WHERE id = ?").get(id);
      });
      return res.status(201).json({ column: columnJson(created) });
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/boards/columns/:id", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["name", "tone", "status"]), HttpError);
      const current = db
        .prepare("SELECT * FROM board_columns WHERE id = ? AND workspace_id = ?")
        .get(req.params.id, req.auth.workspaceId);
      if (!current) return fail(res, 404, "column was not found");
      const access = requireAccess(db, req.auth, current.team_id, clock, HttpError, { manage: true, write: true, projectId: current.project_id });
      if (current.archived_at) throw errorOf(HttpError, 409, "column is archived; restore it before editing");
      const values = [];
      const fields = [];
      if (req.body?.name !== undefined) {
        fields.push("name = ?");
        values.push(text(req.body.name, "name", HttpError, { required: true, max: 120 }));
      }
      if (req.body?.tone !== undefined) {
        fields.push("tone = ?");
        values.push(toneValue(req.body.tone, HttpError));
      }
      if (req.body?.status !== undefined) {
        const status = statusValue(req.body.status, HttpError);
        if (status !== current.status) {
          const activeTasks = db
            .prepare(
              "SELECT COUNT(*) AS count FROM tasks WHERE workspace_id = ? AND column_id = ? AND deleted_at IS NULL",
            )
            .get(req.auth.workspaceId, current.id).count;
          if (Number(activeTasks) > 0)
            throw errorOf(HttpError, 409, "column status cannot change while it contains tasks");
          fields.push("status = ?");
          values.push(status);
        }
      }
      if (!fields.length) return fail(res, 400, "no column changes were supplied");
      fields.push("updated_at = ?");
      values.push(nowIso(clock), current.id, req.auth.workspaceId);
      withTransaction(db, () => {
        db.prepare(`UPDATE board_columns SET ${fields.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...values);
      });
      const updated = db.prepare("SELECT * FROM board_columns WHERE id = ? AND workspace_id = ?").get(current.id, req.auth.workspaceId);
      return res.json({ column: columnJson(updated), canManage: access.canManage });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/boards/columns/reorder", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["projectId", "teamId", "ids"]), HttpError);
      const { teamId, projectId } = scopeFor(req, req.body);
      requireAccess(db, req.auth, teamId, clock, HttpError, { manage: true, write: true, projectId });
      if (!Array.isArray(req.body?.ids) || !req.body.ids.length)
        throw errorOf(HttpError, 400, "ids must be a non-empty array");
      const ids = req.body.ids.map((id) => text(id, "ids", HttpError, { required: true, max: 160 }));
      if (new Set(ids).size !== ids.length) throw errorOf(HttpError, 400, "ids contains duplicates");
      const rows = boardRows(db, req.auth.workspaceId, teamId, projectId);
      if (rows.length !== ids.length || rows.some((row) => !ids.includes(row.id)))
        throw errorOf(HttpError, 400, "ids must include every column in this board");
      const now = nowIso(clock);
      withTransaction(db, () => {
        const update = db.prepare("UPDATE board_columns SET position = ?, updated_at = ? WHERE id = ? AND workspace_id = ?");
        ids.forEach((id, index) => update.run(index, now, id, req.auth.workspaceId));
      });
      return res.json({ columns: boardRows(db, req.auth.workspaceId, teamId, projectId).map(columnJson) });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/boards/columns/:id/archive", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body || {}, new Set(["targetColumnId"]), HttpError);
      const current = db
        .prepare("SELECT * FROM board_columns WHERE id = ? AND workspace_id = ?")
        .get(req.params.id, req.auth.workspaceId);
      if (!current) return fail(res, 404, "column was not found");
      requireAccess(db, req.auth, current.team_id, clock, HttpError, { manage: true, write: true, projectId: current.project_id });
      if (current.archived_at) throw errorOf(HttpError, 409, "column is already archived");
      const activeCount = boardRows(db, req.auth.workspaceId, current.team_id, current.project_id).filter(row => !row.archived_at).length;
      if (Number(activeCount) <= 1) throw errorOf(HttpError, 409, "board must keep at least one active column");
      const tasks = boardTaskRows(db, req.auth.workspaceId, current.team_id, current.id);
      let target = null;
      if (req.body?.targetColumnId !== undefined && req.body?.targetColumnId !== null && req.body?.targetColumnId !== "") {
        target = boardTaskColumn(db, req.auth.workspaceId, current.team_id, req.body.targetColumnId, current.project_id);
        if (!target) throw errorOf(HttpError, 400, "targetColumnId is invalid");
        if (target.id === current.id || target.archived_at) throw errorOf(HttpError, 409, "target column is invalid");
      } else if (tasks.length) {
        throw errorOf(HttpError, 400, "targetColumnId is required while the column contains tasks");
      }
      const now = nowIso(clock);
      const nextTaskIds = [];
      withTransaction(db, () => {
        if (target) {
          for (const task of tasks) {
            let nextTaskId = null;
            if (task.status !== target.status && transitionTaskStatus) {
              const result = transitionTaskStatus({
                db,
                task,
                nextStatus: target.status,
                actorUserId: req.auth.userId,
                now,
              });
              nextTaskId = result?.nextTaskId || null;
            } else if (task.status !== target.status) {
              db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(target.status, now, task.id, req.auth.workspaceId);
            }
            db.prepare(
              "UPDATE tasks SET column_id = ?, board_position = 0, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
            ).run(target.id, now, task.id, req.auth.workspaceId);
            if (recordTaskActivity) {
              recordTaskActivity(db, {
                taskId: task.id,
                actorUserId: req.auth.userId,
                action: "task_moved",
                summary: `đã chuyển công việc vào cột “${target.name}”`,
                createdAt: now,
              });
            }
            if (nextTaskId) nextTaskIds.push(nextTaskId);
          }
          const targetIds = boardTaskRows(db, req.auth.workspaceId, current.team_id, target.id).map((row) => row.id);
          setBoardPositions(db, req.auth.workspaceId, current.team_id, target.id, targetIds, now);
          for (const nextTaskId of nextTaskIds) {
            const nextTask = taskScopeRow(db, req.auth.workspaceId, nextTaskId);
            if (!nextTask) continue;
            const nextColumn = resolveTaskColumn(db, {
              workspaceId: req.auth.workspaceId,
              teamId: nextTask.team_id,
              projectId: nextTask.project_id,
              status: nextTask.status,
              clock,
              HttpError,
            });
            db.prepare("UPDATE tasks SET column_id = ?, board_position = 0 WHERE id = ? AND workspace_id = ?").run(nextColumn.id, nextTask.id, req.auth.workspaceId);
          }
        }
        db.prepare("UPDATE board_columns SET archived_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(now, now, current.id, req.auth.workspaceId);
        if(target)for(const task of tasks)if(task.status!==target.status)emitTaskEvent(db,{taskId:task.id,actorUserId:req.auth.userId,action:"task_updated",summary:"trạng thái"});
      });
      const archived = db.prepare("SELECT * FROM board_columns WHERE id = ? AND workspace_id = ?").get(current.id, req.auth.workspaceId);
      return res.json({ column: columnJson(archived), nextTaskCount: nextTaskIds.length });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/boards/columns/:id/restore", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body || {}, new Set(), HttpError);
      const current = db
        .prepare("SELECT * FROM board_columns WHERE id = ? AND workspace_id = ?")
        .get(req.params.id, req.auth.workspaceId);
      if (!current) return fail(res, 404, "column was not found");
      requireAccess(db, req.auth, current.team_id, clock, HttpError, { manage: true, write: true, projectId: current.project_id });
      if (!current.archived_at) throw errorOf(HttpError, 409, "column is already active");
      const now = nowIso(clock);
      withTransaction(db, () => {
        const max = db
          .prepare(
            `SELECT COALESCE(MAX(position), -1) AS position FROM board_columns
             WHERE workspace_id = ? AND ${current.project_id ? "project_id = ?" : scopePredicate(current.team_id)}`,
          )
          .get(...(current.project_id ? [req.auth.workspaceId,current.project_id] : scopeArgs(req.auth.workspaceId, current.team_id))).position;
        db.prepare("UPDATE board_columns SET archived_at = NULL, position = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(Number(max) + 1, now, current.id, req.auth.workspaceId);
      });
      return res.json({ column: columnJson(db.prepare("SELECT * FROM board_columns WHERE id = ? AND workspace_id = ?").get(current.id, req.auth.workspaceId)) });
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/boards/preferences", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["projectId", "teamId", "collapsedIds"]), HttpError);
      const { teamId, projectId } = scopeFor(req, req.body);
      requireAccess(db, req.auth, teamId, clock, HttpError, { write: true, projectId });
      if (!Array.isArray(req.body?.collapsedIds)) throw errorOf(HttpError, 400, "collapsedIds must be an array");
      const collapsedIds = req.body.collapsedIds.map((id) => text(id, "collapsedIds", HttpError, { required: true, max: 160 }));
      if (new Set(collapsedIds).size !== collapsedIds.length) throw errorOf(HttpError, 400, "collapsedIds contains duplicates");
      const known = new Set(boardRows(db, req.auth.workspaceId, teamId, projectId).map((row) => row.id));
      if (collapsedIds.some((id) => !known.has(id))) throw errorOf(HttpError, 400, "collapsedIds contains an unknown column");
      const now = nowIso(clock);
      db.prepare(
        `INSERT INTO board_preferences(workspace_id, user_id, team_id, collapsed_ids, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, user_id, team_id)
         DO UPDATE SET collapsed_ids = excluded.collapsed_ids, updated_at = excluded.updated_at`,
      ).run(req.auth.workspaceId, req.auth.userId, (projectId && projectId !== defaultProjectId(req.auth.workspaceId, teamId) ? "project:" + projectId : preferenceTeamId(teamId)), JSON.stringify(collapsedIds), now);
      return res.json({ preferences: { collapsedIds } });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/boards/tasks/:id/move", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["columnId", "beforeTaskId"]), HttpError);
      const task = taskScopeRow(db, req.auth.workspaceId, req.params.id);
      if (!task) return fail(res, 404, "task was not found");
      const access = accessFor(db, req.auth, task.team_id, clock, task.project_id);
      if (!access || !access.visible) return fail(res, 404, "task was not found");
      if (!access.canWrite) throw errorOf(HttpError, 409, "board is read-only");
      const columnId = text(req.body?.columnId, "columnId", HttpError, { required: true, max: 160 });
      ensureBoardColumns(db, req.auth.workspaceId, task.team_id, clock, task.project_id);
      const target = boardTaskColumn(db, req.auth.workspaceId, task.team_id, columnId, task.project_id);
      if (!target) throw errorOf(HttpError, 400, "columnId is invalid");
      if (target.archived_at) throw errorOf(HttpError, 409, "column is archived");
      const beforeTaskId = req.body?.beforeTaskId === undefined || req.body?.beforeTaskId === null || req.body?.beforeTaskId === ""
        ? null
        : text(req.body.beforeTaskId, "beforeTaskId", HttpError, { required: true, max: 160 });
      if (beforeTaskId === task.id) throw errorOf(HttpError, 400, "beforeTaskId cannot be the moved task");
      if (beforeTaskId) {
        const before = taskScopeRow(db, req.auth.workspaceId, beforeTaskId);
        if (!before || (before.team_id || null) !== (task.team_id || null) || before.column_id !== target.id)
          throw errorOf(HttpError, 400, "beforeTaskId must be in the target column");
      }
      const now = nowIso(clock);
      let nextTaskId = null;
      withTransaction(db, () => {
        const sourceColumnId = task.column_id || target.id;
        if (task.status !== target.status) {
          if (transitionTaskStatus) {
            nextTaskId = transitionTaskStatus({
              db,
              task,
              nextStatus: target.status,
              actorUserId: req.auth.userId,
              now,
            })?.nextTaskId || null;
          } else {
            db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(target.status, now, task.id, req.auth.workspaceId);
          }
        }
        db.prepare(
          "UPDATE tasks SET column_id = ?, board_position = 0, updated_at = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
        ).run(target.id, now, task.id, req.auth.workspaceId);
        if (recordTaskActivity) {
          recordTaskActivity(db, {
            taskId: task.id,
            actorUserId: req.auth.userId,
            action: "task_moved",
            summary: `đã chuyển công việc vào cột “${target.name}”`,
            createdAt: now,
          });
        }
        if (sourceColumnId !== target.id) {
          const sourceIds = boardTaskRows(db, req.auth.workspaceId, task.team_id, sourceColumnId).filter((row) => row.id !== task.id).map((row) => row.id);
          setBoardPositions(db, req.auth.workspaceId, task.team_id, sourceColumnId, sourceIds, now);
        }
        const targetRows = boardTaskRows(db, req.auth.workspaceId, task.team_id, target.id).filter((row) => row.id !== task.id).map((row) => row.id);
        const beforeIndex = beforeTaskId ? targetRows.indexOf(beforeTaskId) : -1;
        if (beforeIndex < 0) targetRows.push(task.id);
        else targetRows.splice(beforeIndex, 0, task.id);
        setBoardPositions(db, req.auth.workspaceId, task.team_id, target.id, targetRows, now);
        if (nextTaskId) {
          const nextTask = taskScopeRow(db, req.auth.workspaceId, nextTaskId);
          if (nextTask) {
            const nextColumn = resolveTaskColumn(db, {
              workspaceId: req.auth.workspaceId,
              teamId: nextTask.team_id,
              projectId: nextTask.project_id,
              status: nextTask.status,
              clock,
              HttpError,
            });
            db.prepare("UPDATE tasks SET column_id = ?, board_position = 0 WHERE id = ? AND workspace_id = ?").run(nextColumn.id, nextTask.id, req.auth.workspaceId);
          }
        }
        if(task.status!==target.status)emitTaskEvent(db,{taskId:task.id,actorUserId:req.auth.userId,action:"task_updated",summary:"trạng thái"});
      });
      const moved = taskScopeRow(db, req.auth.workspaceId, task.id);
      return res.json({
        task: taskJsonWithBoard(taskJson, moved, req.auth),
        nextTask: nextTaskId ? taskJsonWithBoard(taskJson, taskScopeRow(db, req.auth.workspaceId, nextTaskId), req.auth) : null,
      });
    } catch (error) {
      return next(error);
    }
  });
}

export { DEFAULT_COLUMNS, STATUSES as BOARD_STATUSES };
