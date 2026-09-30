import { createId } from "./auth.mjs";

export const TEAM_COLORS = new Set([
  "green",
  "blue",
  "purple",
  "orange",
  "rose",
  "slate",
]);
export const TEAM_ROLES = new Set(["lead", "member"]);

function textValue(value, field, { required = false, max = 100 } = {}) {
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
  const result = textValue(value, field, { required: true, max: 20 });
  if (!allowed.has(result)) throw new HttpError(400, `${field} không hợp lệ`);
  return result;
}

function assertObject(value, message = "Dữ liệu yêu cầu không hợp lệ") {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, message);
}

function assertKeys(value, allowed, message) {
  assertObject(value);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new HttpError(400, message);
  }
}

function nowIso(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString();
}

function workspaceRole(db, workspaceId, userId) {
  return db
    .prepare(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    )
    .get(workspaceId, userId)?.role || null;
}

function teamRow(db, workspaceId, teamId) {
  return db
    .prepare(
      `
      SELECT t.*,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
        (SELECT COUNT(*) FROM tasks tk
          WHERE tk.team_id = t.id AND tk.deleted_at IS NULL) AS task_count,
        (SELECT COUNT(*) FROM tasks tk
          WHERE tk.team_id = t.id AND tk.deleted_at IS NULL AND tk.status != 'done') AS open_task_count,
        (SELECT COUNT(*) FROM tasks tk
          WHERE tk.team_id = t.id AND tk.deleted_at IS NULL AND tk.status = 'done') AS completed_task_count
      FROM teams t
      WHERE t.id = ? AND t.workspace_id = ?
    `,
    )
    .get(teamId, workspaceId);
}

function memberIds(db, teamId) {
  return db
    .prepare(
      "SELECT user_id FROM team_members WHERE team_id = ? ORDER BY insertion_order",
    )
    .all(teamId)
    .map((row) => row.user_id);
}

function teamMemberRows(db, teamId) {
  return db
    .prepare(
      `
      SELECT u.id, u.name, u.email, tm.role
      FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY CASE tm.role WHEN 'lead' THEN 0 ELSE 1 END, u.name, u.id
    `,
    )
    .all(teamId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
    }));
}

export function getTeamAccess(db, workspaceId, userId, teamId) {
  const team = teamRow(db, workspaceId, teamId);
  if (!team) return null;
  const currentWorkspaceRole = workspaceRole(db, workspaceId, userId);
  const teamRole = db
    .prepare(
      "SELECT role FROM team_members WHERE team_id = ? AND workspace_id = ? AND user_id = ?",
    )
    .get(teamId, workspaceId, userId)?.role || null;
  const isWorkspaceAdmin = ["owner", "admin"].includes(currentWorkspaceRole);
  return {
    team,
    workspaceRole: currentWorkspaceRole,
    teamRole,
    isWorkspaceAdmin,
    visible: isWorkspaceAdmin || Boolean(teamRole),
    canManage: isWorkspaceAdmin || teamRole === "lead",
    canArchive: isWorkspaceAdmin,
  };
}

export function canAccessTeamTask(
  db,
  workspaceId,
  userId,
  teamId,
  { write = false } = {},
) {
  if (!teamId) return Boolean(workspaceRole(db, workspaceId, userId));
  const access = getTeamAccess(db, workspaceId, userId, teamId);
  if (!access || !access.visible) return false;
  if (write && access.team.archived_at) return false;
  return true;
}

export function canManageAllTeams(db, workspaceId, userId) {
  return ["owner", "admin"].includes(workspaceRole(db, workspaceId, userId));
}

function teamJson(db, row, userId, access) {
  const ids = memberIds(db, row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    archivedAt: row.archived_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: Number(row.member_count || 0),
    taskCount: Number(row.task_count || 0),
    openTaskCount: Number(row.open_task_count || 0),
    completedTaskCount: Number(row.completed_task_count || 0),
    memberIds: ids,
    myRole: access?.teamRole || null,
    canManage: Boolean(access?.canManage),
    canArchive: Boolean(access?.canArchive),
  };
}

export function visibleTeamRows(db, workspaceId, userId) {
  const global = canManageAllTeams(db, workspaceId, userId);
  const rows = db
    .prepare(
      `
      SELECT t.*,
        (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
        (SELECT COUNT(*) FROM tasks tk
          WHERE tk.team_id = t.id AND tk.deleted_at IS NULL) AS task_count,
        (SELECT COUNT(*) FROM tasks tk
          WHERE tk.team_id = t.id AND tk.deleted_at IS NULL AND tk.status != 'done') AS open_task_count,
        (SELECT COUNT(*) FROM tasks tk
          WHERE tk.team_id = t.id AND tk.deleted_at IS NULL AND tk.status = 'done') AS completed_task_count
      FROM teams t
      WHERE t.workspace_id = ?
        AND (? = 1 OR EXISTS (
          SELECT 1 FROM team_members own_tm
          WHERE own_tm.team_id = t.id AND own_tm.user_id = ?
        ))
      ORDER BY CASE WHEN t.archived_at IS NULL THEN 0 ELSE 1 END,
               t.updated_at DESC, t.id DESC
    `,
    )
    .all(workspaceId, global ? 1 : 0, userId);
  return rows.map((row) =>
    teamJson(db, row, userId, getTeamAccess(db, workspaceId, userId, row.id)),
  );
}

function taskRowsForTeam(db, workspaceId, teamId, taskJson) {
  return db
    .prepare(
      `
      SELECT tk.*, t.name AS team_name, t.archived_at AS team_archived
      FROM tasks tk JOIN teams t ON t.id = tk.team_id
      WHERE tk.team_id = ? AND tk.workspace_id = ? AND t.workspace_id = ?
        AND tk.deleted_at IS NULL
      ORDER BY CASE tk.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
               tk.due_at ASC, tk.created_at DESC, tk.id DESC
    `,
    )
    .all(teamId, workspaceId, workspaceId)
    .map(taskJson);
}

function detail(db, workspaceId, userId, teamId, taskJson) {
  const access = getTeamAccess(db, workspaceId, userId, teamId);
  if (!access || !access.visible)
    throw new HttpError(404, "Không tìm thấy đội nhóm");
  return {
    team: teamJson(db, access.team, userId, access),
    members: teamMemberRows(db, teamId),
    tasks: taskRowsForTeam(db, workspaceId, teamId, taskJson),
  };
}

function parseMembers(value) {
  if (!Array.isArray(value) || value.length < 1)
    throw new HttpError(400, "members phải có ít nhất một thành viên");
  const members = [];
  const seen = new Set();
  for (const member of value) {
    assertKeys(
      member,
      new Set(["userId", "role"]),
      "Thông tin thành viên không hợp lệ",
    );
    const userId = textValue(member.userId, "userId", { required: true, max: 100 });
    if (seen.has(userId)) throw new HttpError(400, "Thành viên bị lặp");
    seen.add(userId);
    members.push({
      userId,
      role: enumValue(member.role, "role", TEAM_ROLES),
    });
  }
  if (!members.some((member) => member.role === "lead"))
    throw new HttpError(400, "Đội nhóm phải có ít nhất một trưởng nhóm");
  return members;
}

function assertWorkspaceMembers(db, workspaceId, members) {
  const check = db.prepare(
    "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
  );
  for (const member of members) {
    if (!check.get(workspaceId, member.userId))
      throw new HttpError(400, "Thành viên phải thuộc không gian làm việc");
  }
}

function assertUnassignedRemoved(db, teamId, nextMembers) {
  const nextIds = new Set(nextMembers.map((member) => member.userId));
  const assigned = db
    .prepare(
      `
      SELECT DISTINCT assigned.user_id
      FROM (
        SELECT assignee_id AS user_id
        FROM tasks
        WHERE team_id = ? AND deleted_at IS NULL AND status != 'done'
          AND assignee_id IS NOT NULL
        UNION
        SELECT ta.user_id
        FROM task_assignees ta
        JOIN tasks tk ON tk.id = ta.task_id
        WHERE tk.team_id = ? AND tk.deleted_at IS NULL AND tk.status != 'done'
      ) assigned
    `,
    )
    .all(teamId, teamId)
    .map((row) => row.user_id)
    .filter((userId) => !nextIds.has(userId));
  if (assigned.length)
    throw new HttpError(
      409,
      "Không thể xóa thành viên đang được giao công việc chưa hoàn thành; hãy phân công lại trước",
    );
}

function assertLeadCanChange(current, next, userId) {
  const currentById = new Map(current.map((member) => [member.userId, member.role]));
  const nextById = new Map(next.map((member) => [member.userId, member.role]));
  for (const [memberId, role] of currentById) {
    if (role === "lead" && nextById.get(memberId) !== "lead")
      throw new HttpError(403, "Trưởng nhóm chỉ được quản lý thành viên thường");
  }
  for (const [memberId, role] of nextById) {
    if (role === "lead" && currentById.get(memberId) !== "lead")
      throw new HttpError(403, "Chỉ quản trị workspace được thay đổi trưởng nhóm");
  }
  if (nextById.get(userId) !== "lead")
    throw new HttpError(403, "Trưởng nhóm không thể tự xóa khỏi đội nhóm");
}

function replaceRoster(db, teamId, workspaceId, next, now) {
  db.prepare("DELETE FROM team_members WHERE team_id = ?").run(teamId);
  const insert = db.prepare(
    `
    INSERT INTO team_members(team_id, workspace_id, user_id, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  );
  for (const member of next)
    insert.run(teamId, workspaceId, member.userId, member.role, now);
}

export function registerTeamRoutes(
  app,
  {
    db,
    clock,
    withTransaction,
    requireAuth,
    ensureWritable,
    HttpError: ErrorClass,
    fail,
    taskJson,
  },
) {
  HttpError = ErrorClass;

  app.get("/api/teams", requireAuth, (req, res, next) => {
    try {
      return res.json({
        teams: visibleTeamRows(db, req.auth.workspaceId, req.auth.userId),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/teams", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(
        req.body,
        new Set(["name", "description", "color", "members"]),
        "Trường dữ liệu đội nhóm không được hỗ trợ",
      );
      if (!canManageAllTeams(db, req.auth.workspaceId, req.auth.userId))
        return fail(res, 403, "Chỉ chủ sở hữu hoặc quản trị workspace được tạo đội nhóm");
      const name = textValue(req.body.name, "name", { required: true, max: 100 });
      const description = textValue(req.body.description, "description", {
        max: 1000,
      });
      const color = enumValue(req.body.color, "color", TEAM_COLORS);
      const members = parseMembers(req.body.members);
      assertWorkspaceMembers(db, req.auth.workspaceId, members);
      const id = createId("team_");
      const now = nowIso(clock);
      withTransaction(db, () => {
        db.prepare(
          `
          INSERT INTO teams(id, workspace_id, name, description, color, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(id, req.auth.workspaceId, name, description, color, now, now);
        replaceRoster(db, id, req.auth.workspaceId, members, now);
      });
      return res.status(201).json(
        detail(db, req.auth.workspaceId, req.auth.userId, id, taskJson),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/teams/:id", requireAuth, (req, res, next) => {
    try {
      return res.json(
        detail(db, req.auth.workspaceId, req.auth.userId, req.params.id, taskJson),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/teams/:id", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(
        req.body,
        new Set(["name", "description", "color", "archived"]),
        "Trường dữ liệu đội nhóm không được hỗ trợ",
      );
      const access = getTeamAccess(
        db,
        req.auth.workspaceId,
        req.auth.userId,
        req.params.id,
      );
      if (!access || !access.visible) return fail(res, 404, "Không tìm thấy đội nhóm");
      const body = req.body;
      const hasArchive = body.archived !== undefined;
      if (access.team.archived_at) {
        if (!access.canArchive || !hasArchive || body.archived !== false || Object.keys(body).length !== 1)
          return fail(res, 409, "Đội nhóm đã lưu trữ và chỉ quản trị workspace được khôi phục");
      } else if (hasArchive && !access.canArchive) {
        return fail(res, 403, "Chỉ chủ sở hữu hoặc quản trị workspace được lưu trữ đội nhóm");
      }
      if (!access.canManage)
        return fail(res, 403, "Bạn không có quyền chỉnh sửa đội nhóm");
      const values = {};
      if (body.name !== undefined)
        values.name = textValue(body.name, "name", { required: true, max: 100 });
      if (body.description !== undefined)
        values.description = textValue(body.description, "description", { max: 1000 });
      if (body.color !== undefined)
        values.color = enumValue(body.color, "color", TEAM_COLORS);
      if (hasArchive) {
        if (typeof body.archived !== "boolean")
          throw new HttpError(400, "archived phải là true hoặc false");
        values.archived_at = body.archived ? nowIso(clock) : null;
      }
      if (!Object.keys(values).length)
        throw new HttpError(400, "Chưa có thay đổi đội nhóm");
      const now = nowIso(clock);
      withTransaction(db, () => {
        const assignments = [];
        const params = [];
        for (const [column, value] of Object.entries(values)) {
          assignments.push(`${column} = ?`);
          params.push(value);
        }
        assignments.push("updated_at = ?");
        params.push(now, req.params.id, req.auth.workspaceId);
        db.prepare(
          `UPDATE teams SET ${assignments.join(", ")} WHERE id = ? AND workspace_id = ?`,
        ).run(...params);
      });
      return res.json(
        detail(db, req.auth.workspaceId, req.auth.userId, req.params.id, taskJson),
      );
    } catch (error) {
      return next(error);
    }
  });

  app.put("/api/teams/:id/members", requireAuth, (req, res, next) => {
    try {
      ensureWritable(req);
      assertKeys(req.body, new Set(["members"]), "Trường dữ liệu thành viên không được hỗ trợ");
      const access = getTeamAccess(
        db,
        req.auth.workspaceId,
        req.auth.userId,
        req.params.id,
      );
      if (!access || !access.visible) return fail(res, 404, "Không tìm thấy đội nhóm");
      if (access.team.archived_at)
        return fail(res, 409, "Đội nhóm đã lưu trữ và chỉ được đọc");
      if (!access.canManage)
        return fail(res, 403, "Bạn không có quyền chỉnh sửa thành viên đội nhóm");
      const next = parseMembers(req.body.members);
      assertWorkspaceMembers(db, req.auth.workspaceId, next);
      const current = db
        .prepare("SELECT user_id AS \"userId\", role FROM team_members WHERE team_id = ?")
        .all(req.params.id);
      if (!access.isWorkspaceAdmin)
        assertLeadCanChange(current, next, req.auth.userId);
      const now = nowIso(clock);
      withTransaction(db, () => {
        assertUnassignedRemoved(db, req.params.id, next);
        replaceRoster(db, req.params.id, req.auth.workspaceId, next, now);
        db.prepare("UPDATE teams SET updated_at = ? WHERE id = ? AND workspace_id = ?").run(
          now,
          req.params.id,
          req.auth.workspaceId,
        );
      });
      return res.json(
        detail(db, req.auth.workspaceId, req.auth.userId, req.params.id, taskJson),
      );
    } catch (error) {
      return next(error);
    }
  });
}

let HttpError = Error;
