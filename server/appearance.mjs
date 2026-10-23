import { getTeamAccess } from './teams.mjs';
import { APPEARANCE_DEFAULTS, APPEARANCE_FIELDS, APPEARANCE_PERSONAL_FIELDS, validateAppearance, validateAppearancePolicy } from '../shared/appearance.mjs';

export function registerAppearanceRoutes(app, { db, requireAuth, HttpError }) {
  function teamPolicy(workspaceId, userId, teamId) {
    const access = getTeamAccess(db, workspaceId, userId, teamId);
    if (!access?.visible) throw new HttpError(404, 'Không tìm thấy team.');
    const row = db.prepare('SELECT preferences, editable_fields FROM team_appearance WHERE team_id=?').get(teamId);
    // Until an admin saves a policy, members may customize every field.
    return { preferences: { ...APPEARANCE_DEFAULTS, ...(row ? JSON.parse(row.preferences) : {}) },
      editableFields: row ? JSON.parse(row.editable_fields) : [...APPEARANCE_FIELDS], canManage: access.canManage };
  }
  app.put('/api/teams/:teamId/appearance', requireAuth, (req, res, next) => {
    try {
      const policy = teamPolicy(req.auth.workspaceId, req.auth.userId, req.params.teamId);
      if (!policy.canManage) throw new HttpError(403, 'Chỉ quản trị team được cấu hình giao diện chung.');
      let nextPolicy;
      try { nextPolicy = validateAppearancePolicy(req.body); }
      catch (error) { throw new HttpError(400, error.message); }
      db.prepare(`INSERT INTO team_appearance(team_id,preferences,editable_fields) VALUES (?,?,?)
        ON CONFLICT(team_id) DO UPDATE SET preferences=excluded.preferences,editable_fields=excluded.editable_fields`)
        .run(req.params.teamId, JSON.stringify(nextPolicy.preferences), JSON.stringify(nextPolicy.editableFields));
      res.json({ team: { ...nextPolicy, canManage: true } });
    } catch (error) { next(error); }
  });
  app.route('/api/appearance').all(requireAuth).all((req, res, next) => {
    try {
      const teamId = req.query.teamId ?? '';
      if (typeof teamId !== 'string' || teamId.length > 100) throw new HttpError(400, 'Team không hợp lệ.');
      req.appearanceTeam = teamId ? teamPolicy(req.auth.workspaceId, req.auth.userId, teamId) : null;
      req.appearanceScope = teamId;
      next();
    } catch (error) { next(error); }
  }).get((req, res) => {
    const read = scope => {
      const row = db.prepare('SELECT preferences FROM user_appearance WHERE workspace_id=? AND user_id=? AND scope=?').get(req.auth.workspaceId, req.auth.userId, scope);
      return row ? JSON.parse(row.preferences) : null;
    };
    const preferences = read(req.appearanceScope);
    if (!req.appearanceTeam) return res.json({ preferences, team: null });
    // Accessibility settings are personal and apply inside every team.
    const personal = read('') || {};
    const accessibility = Object.fromEntries(APPEARANCE_PERSONAL_FIELDS.map(field => [field, personal[field] ?? APPEARANCE_DEFAULTS[field]]));
    res.json({ preferences, team: req.appearanceTeam, accessibility });
  }).put((req, res, next) => {
    try {
      let preferences;
      try { preferences = validateAppearance(req.body); }
      catch (error) { throw new HttpError(400, error.message); }
      if (req.appearanceTeam) {
        const { preferences: shared, editableFields } = req.appearanceTeam;
        for (const [field, value] of Object.entries(preferences)) {
          if (!editableFields.includes(field) && !APPEARANCE_PERSONAL_FIELDS.includes(field) && JSON.stringify(value) !== JSON.stringify(shared[field]))
            throw new HttpError(403, 'Quản trị team chưa cho phép thay đổi tùy chọn này.');
        }
        preferences = Object.fromEntries(Object.entries(preferences).filter(([field, value]) => editableFields.includes(field) && JSON.stringify(value) !== JSON.stringify(shared[field])));
      }
      db.prepare(`INSERT INTO user_appearance(workspace_id,user_id,scope,team_id,preferences) VALUES (?,?,?,?,?)
        ON CONFLICT(workspace_id,user_id,scope) DO UPDATE SET preferences=excluded.preferences`)
        .run(req.auth.workspaceId, req.auth.userId, req.appearanceScope, req.appearanceScope || null, JSON.stringify(preferences));
      res.json({ preferences });
    } catch (error) { next(error); }
  }).delete((req, res) => {
    db.prepare('DELETE FROM user_appearance WHERE workspace_id=? AND user_id=? AND scope=?').run(req.auth.workspaceId, req.auth.userId, req.appearanceScope);
    res.json({ preferences: null });
  });
}
