import { createId } from './auth.mjs';
import { hasWorkspaceEntitlement } from './entitlements.mjs';

const ROLES = new Set(['viewer', 'commenter', 'editor', 'manager']);
const MODES = new Set(['workspace', 'team', 'private']);
const defaults = { plans: ['starter', 'team', 'business'].map(id => ({ id })) };
export const defaultProjectId = (workspaceId, teamId = null) => teamId ? 'prj_team_' + teamId : 'prj_ws_' + workspaceId;

// The exact same predicate is suitable for task lists, counts, exports and jobs.
// Bind workspaceId, userId in this order. The alias is developer-owned only.
export function projectAccessSql(alias = 't') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias');
  return `EXISTS (SELECT 1 FROM projects acl_p
    JOIN workspace_members acl_wm ON acl_wm.workspace_id = acl_p.workspace_id
    JOIN users acl_u ON acl_u.id = acl_wm.user_id AND acl_u.disabled_at IS NULL
    JOIN workspaces acl_w ON acl_w.id = acl_p.workspace_id AND acl_w.suspended_at IS NULL
    LEFT JOIN project_members acl_pm ON acl_pm.project_id = acl_p.id AND acl_pm.workspace_id = acl_p.workspace_id AND acl_pm.user_id = acl_wm.user_id
    WHERE acl_p.id = ${alias}.project_id AND acl_p.workspace_id = ${alias}.workspace_id
      AND acl_p.workspace_id = ? AND acl_wm.user_id = ?
      AND ((acl_wm.member_type = 'member' AND (acl_wm.role IN ('owner','admin') OR acl_p.access_mode = 'workspace'
        OR (acl_p.access_mode = 'team' AND EXISTS (SELECT 1 FROM team_members acl_tm WHERE acl_tm.team_id = acl_p.team_id AND acl_tm.workspace_id = acl_p.workspace_id AND acl_tm.user_id = acl_wm.user_id))))
        OR acl_pm.user_id IS NOT NULL))`;
}

export function getProjectAccess(db, workspaceId, userId, projectId, { config = defaults, clock = () => new Date() } = {}) {
  const row = db.prepare(`SELECT p.*, wm.role workspace_role, wm.member_type, pm.role project_role, tm.role team_role, t.archived_at team_archived_at
    FROM projects p
    JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ?
    JOIN users u ON u.id = wm.user_id AND u.disabled_at IS NULL
    JOIN workspaces w ON w.id = p.workspace_id AND w.suspended_at IS NULL
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.workspace_id = p.workspace_id AND pm.user_id = wm.user_id
    LEFT JOIN team_members tm ON tm.team_id = p.team_id AND tm.workspace_id = p.workspace_id AND tm.user_id = wm.user_id
    LEFT JOIN teams t ON t.id = p.team_id AND t.workspace_id = p.workspace_id
    WHERE p.workspace_id = ? AND p.id = ?`).get(userId, workspaceId, projectId);
  if (!row) return null;
  const guest = row.member_type === 'guest';
  const workspaceAdmin = !guest && ['owner', 'admin'].includes(row.workspace_role);
  const inherited = !guest && (row.access_mode === 'workspace' || (row.access_mode === 'team' && row.team_role));
  const role = workspaceAdmin ? 'manager' : row.project_role || (inherited ? (row.team_role === 'lead' ? 'manager' : 'editor') : null);
  if (!role) return null;
  const entitled = code => hasWorkspaceEntitlement(db, config, workspaceId, code, clock);
  const writable = !row.archived_at && !row.team_archived_at && entitled('projects')
    && (row.access_mode !== 'private' || entitled('projects.private')) && (!guest || entitled('guests'));
  const edit = writable && ['editor', 'manager'].includes(role);
  return { project: row, role, guest, workspaceAdmin, canRead: true,
    canComment: writable && role !== 'viewer', canAcknowledge: writable && role !== 'viewer',
    canEdit: edit, canDelete: edit && !guest, canMove: edit && !guest,
    canManage: writable && role === 'manager' && !guest, readonly: !writable };
}

export function taskProjectAccess(db, workspaceId, userId, task, { action = 'read', ...options } = {}) {
  if (!task || task.workspace_id !== workspaceId) return false;
  const access = getProjectAccess(db, workspaceId, userId, task.project_id, options);
  const permission = { read: 'canRead', write: 'canEdit', edit: 'canEdit', comment: 'canComment', ack: 'canAcknowledge', delete: 'canDelete', move: 'canMove', manage: 'canManage' }[action];
  return Boolean(permission && access?.[permission]);
}

export function canAccessProject(db, workspaceId, userId, projectId, options = {}) {
  return taskProjectAccess(db, workspaceId, userId, { workspace_id: workspaceId, project_id: projectId }, options);
}

export function resolveTaskProject(db, workspaceId, userId, { projectId, teamId = null, task, action = 'write', ...options } = {}) {
  const id = projectId || task?.project_id || defaultProjectId(workspaceId, teamId);
  const access = getProjectAccess(db, workspaceId, userId, id, options);
  if (!access || !taskProjectAccess(db, workspaceId, userId, { workspace_id: workspaceId, project_id: id }, { action, ...options })) return null;
  return access.project;
}

export function projectJson(access) {
  const p = access.project;
  return { id: p.id, boardId: p.id, name: p.name, description: p.description, accessMode: p.access_mode,
    teamId: p.team_id, isDefault: Boolean(p.is_default), archivedAt: p.archived_at,
    myRole: access.role, canEdit: access.canEdit, canManage: access.canManage, readonly: access.readonly };
}

export function registerProjectRoutes(app, { db, clock, config, requireAuth, ensureWritable, HttpError, withTransaction }) {
  const options = { config, clock };
  const fail = (status, message) => { throw new HttpError(status, message); };
  const body = (value, allowed) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'Dữ liệu project không hợp lệ');
    return value;
  };
  const text = (value, max, required = false) => {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(400, 'Nội dung project không hợp lệ');
    return value.trim();
  };
  const access = (req, manage = false) => {
    const result = getProjectAccess(db, req.auth.workspaceId, req.auth.userId, req.params.id, options);
    if (!result) fail(404, 'Không tìm thấy project');
    if (manage && !result.canManage) fail(403, 'Bạn không có quyền quản lý project');
    return result;
  };
  const members = (req, a) => db.prepare(`SELECT u.id, u.name, wm.member_type, pm.role
    FROM workspace_members wm JOIN users u ON u.id = wm.user_id AND u.disabled_at IS NULL
    LEFT JOIN project_members pm ON pm.project_id = ? AND pm.workspace_id = wm.workspace_id AND pm.user_id = wm.user_id
    WHERE wm.workspace_id = ? ORDER BY u.name, u.id`).all(a.project.id, req.auth.workspaceId)
    .filter(row => getProjectAccess(db, req.auth.workspaceId, row.id, a.project.id, options))
    .map(row => ({ id: row.id, name: row.name, memberType: row.member_type,
      role: getProjectAccess(db, req.auth.workspaceId, row.id, a.project.id, options).role, directRole: row.role || null }));

  app.get('/api/projects', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT id FROM projects WHERE workspace_id=? ORDER BY is_default DESC, name, id').all(req.auth.workspaceId);
    res.json({ projects: rows.map(row => getProjectAccess(db, req.auth.workspaceId, req.auth.userId, row.id, options)).filter(Boolean).map(projectJson) });
  });
  app.get('/api/projects/:id', requireAuth, (req, res) => {
    const a = access(req); res.json({ project: projectJson(a), members: members(req, a) });
  });
  app.get('/api/projects/:id/members', requireAuth, (req, res) => {
    const a = access(req); res.json({ members: members(req, a) });
  });
  app.post('/api/projects', requireAuth, (req, res) => {
    ensureWritable(req);
    const value = body(req.body, ['name', 'description', 'accessMode', 'teamId']);
    const mode = value.accessMode || 'workspace';
    if (!MODES.has(mode)) fail(400, 'Phạm vi project không hợp lệ');
    const teamId = value.teamId || null;
    if ((mode === 'team') !== Boolean(teamId)) fail(400, 'Đội nhóm không phù hợp phạm vi project');
    const membership = db.prepare('SELECT role, member_type FROM workspace_members WHERE workspace_id=? AND user_id=?').get(req.auth.workspaceId, req.auth.userId);
    if (membership?.member_type !== 'member' || !['owner', 'admin'].includes(membership.role)) fail(403, 'Chỉ quản trị workspace được tạo project');
    if (mode === 'private' && !hasWorkspaceEntitlement(db, config || defaults, req.auth.workspaceId, 'projects.private', clock)) fail(403, 'Gói hiện tại không cho tạo project riêng tư');
    if (teamId && !db.prepare('SELECT 1 FROM teams WHERE id=? AND workspace_id=? AND archived_at IS NULL').get(teamId, req.auth.workspaceId)) fail(400, 'Đội nhóm không hợp lệ');
    const id = createId('project_'), now = new Date(clock()).toISOString();
    withTransaction(db, () => {
      db.prepare(`INSERT INTO projects(id,workspace_id,name,description,access_mode,team_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, req.auth.workspaceId, text(value.name, 120, true), text(value.description ?? '', 2000), mode, teamId, req.auth.userId, now, now);
      for (const [position, [name, status, tone]] of [['Cần làm','todo','blue'], ['Đang làm','doing','orange'], ['Hoàn thành','done','green']].entries())
        db.prepare(`INSERT INTO board_columns(id,workspace_id,team_id,name,status,tone,position,created_at,updated_at,project_id) VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(createId('boardcol_'), req.auth.workspaceId, teamId, name, status, tone, position, now, now, id);
    });
    res.status(201).json({ project: projectJson(getProjectAccess(db, req.auth.workspaceId, req.auth.userId, id, options)) });
  });
  app.patch('/api/projects/:id', requireAuth, (req, res) => {
    ensureWritable(req);
    const value = body(req.body, ['name', 'description', 'archived']);
    const a = access(req);
    if (value.archived !== undefined && typeof value.archived !== 'boolean') fail(400, 'Trạng thái lưu trữ không hợp lệ');
    const restoring = value.archived === false && a.project.archived_at && !a.guest && a.role === 'manager'
      && hasWorkspaceEntitlement(db, config || defaults, req.auth.workspaceId, a.project.access_mode === 'private' ? 'projects.private' : 'projects', clock);
    if (!a.canManage && !restoring) fail(403, 'Bạn không có quyền quản lý project');
    if (a.project.is_default && value.archived) fail(409, 'Không thể lưu trữ project mặc định');
    const now = new Date(clock()).toISOString();
    db.prepare('UPDATE projects SET name=?, description=?, archived_at=?, updated_at=? WHERE id=? AND workspace_id=?')
      .run(value.name === undefined ? a.project.name : text(value.name, 120, true), value.description === undefined ? a.project.description : text(value.description, 2000),
        value.archived === undefined ? a.project.archived_at : value.archived ? now : null, now, a.project.id, req.auth.workspaceId);
    res.json({ project: projectJson(getProjectAccess(db, req.auth.workspaceId, req.auth.userId, a.project.id, options)) });
  });
  app.put('/api/projects/:id/members/:userId', requireAuth, (req, res) => {
    ensureWritable(req);
    const value = body(req.body, ['role']);
    if (!ROLES.has(value.role)) fail(400, 'Vai trò project không hợp lệ');
    withTransaction(db, () => {
      db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? FOR UPDATE').get(req.params.id, req.auth.workspaceId);
      const a = access(req, true);
      const target = db.prepare('SELECT role, member_type FROM workspace_members WHERE workspace_id=? AND user_id=?').get(req.auth.workspaceId, req.params.userId);
      if (!target) fail(400, 'Thành viên phải thuộc workspace');
      if (target.member_type === 'guest' && (value.role === 'manager' || !a.workspaceAdmin || !hasWorkspaceEntitlement(db, config || defaults, req.auth.workspaceId, 'guests', clock))) fail(403, 'Không được cấp quyền guest này');
      db.prepare(`INSERT INTO project_members(project_id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role`)
        .run(a.project.id, req.auth.workspaceId, req.params.userId, value.role, new Date(clock()).toISOString());
    });
    res.json({ members: members(req, access(req)) });
  });
  app.delete('/api/projects/:id/members/:userId', requireAuth, (req, res) => {
    ensureWritable(req);
    withTransaction(db, () => {
      db.prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? FOR UPDATE').get(req.params.id, req.auth.workspaceId);
      const a = access(req, true);
      const target = db.prepare('SELECT member_type FROM workspace_members WHERE workspace_id=? AND user_id=?').get(req.auth.workspaceId, req.params.userId);
      if (target?.member_type === 'guest' && !a.workspaceAdmin) fail(403, 'Chỉ quản trị workspace được quản lý guest');
      db.prepare('DELETE FROM project_members WHERE project_id=? AND workspace_id=? AND user_id=?').run(a.project.id, req.auth.workspaceId, req.params.userId);
    });
    const remaining = getProjectAccess(db, req.auth.workspaceId, req.auth.userId, req.params.id, options);
    res.json({ members: remaining ? members(req, remaining) : [], projectAccessRevoked: !remaining });
  });
}
