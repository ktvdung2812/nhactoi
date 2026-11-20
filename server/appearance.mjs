import { withTransaction } from './db.mjs';
import { getTeamAccess } from './teams.mjs';
import { APPEARANCE_DEFAULTS, APPEARANCE_FIELDS, APPEARANCE_PERSONAL_FIELDS, APPEARANCE_PLATFORMS, validateAppearance, validateAppearancePolicy } from '../shared/appearance.mjs';

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
  const read = (auth, scope, platform) => {
    const row = db.prepare('SELECT preferences FROM user_appearance WHERE workspace_id=? AND user_id=? AND scope=? AND platform=?').get(auth.workspaceId, auth.userId, scope, platform);
    return row ? JSON.parse(row.preferences) : null;
  };
  const accessibility = auth => {
    const personal = read(auth, '', 'all') || {};
    return Object.fromEntries(APPEARANCE_PERSONAL_FIELDS.map(field => [field, personal[field] ?? APPEARANCE_DEFAULTS[field]]));
  };
  const flags = auth => {
    const rows = db.prepare('SELECT platform, separate FROM user_appearance_sync WHERE workspace_id=? AND user_id=?').all(auth.workspaceId, auth.userId);
    return Object.fromEntries(APPEARANCE_PLATFORMS.map(platform => [platform, { separate: !!rows.find(row => row.platform === platform)?.separate }]));
  };
  const lock = auth => db.prepare('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))').get(auth.workspaceId, auth.userId);
  const save = (auth, scope, platform, preferences) => db.prepare(`INSERT INTO user_appearance(workspace_id,user_id,scope,team_id,platform,preferences) VALUES (?,?,?,?,?,?)
    ON CONFLICT(workspace_id,user_id,scope,platform) DO UPDATE SET preferences=excluded.preferences`)
    .run(auth.workspaceId, auth.userId, scope, scope || null, platform, JSON.stringify(preferences));
  app.route('/api/appearance/sync').all(requireAuth).get((req, res) => res.json(flags(req.auth))).put((req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['platform', 'separate', 'copyFrom'].includes(key)) || !APPEARANCE_PLATFORMS.includes(body.platform) || typeof body.separate !== 'boolean' || (Object.hasOwn(body, 'copyFrom') && (!body.separate || !['all', ...APPEARANCE_PLATFORMS].includes(body.copyFrom) || body.copyFrom === body.platform))) throw new HttpError(400, 'Cấu hình đồng bộ không hợp lệ.');
      const result = withTransaction(db, () => {
        lock(req.auth);
        const now = new Date().toISOString();
        const initialized = !body.separate || !db.prepare(`INSERT INTO user_appearance_sync(workspace_id,user_id,platform,separate,updated_at) VALUES (?,?,?,1,?)
          ON CONFLICT(workspace_id,user_id,platform) DO NOTHING`)
          .run(req.auth.workspaceId, req.auth.userId, body.platform, now).changes;
        if (initialized) db.prepare('UPDATE user_appearance_sync SET separate=?,updated_at=? WHERE workspace_id=? AND user_id=? AND platform=?')
          .run(body.separate ? 1 : 0, now, req.auth.workspaceId, req.auth.userId, body.platform);
        const rows = db.prepare('SELECT scope, platform, preferences FROM user_appearance WHERE workspace_id=? AND user_id=?').all(req.auth.workspaceId, req.auth.userId);
        const requested = body.copyFrom ?? (body.separate && !initialized ? 'all' : null);
        // A platform that is not separate shows its scopes' shared profile; its own retained rows are stale.
        const source = requested && requested !== 'all' && !flags(req.auth)[requested].separate ? 'all' : requested;
        if (source) {
          const sources = new Map(rows.filter(row => row.platform === 'all').map(row => [row.scope, row]));
          if (source !== 'all') for (const row of rows.filter(row => row.platform === source)) sources.set(row.scope, row);
          db.prepare('DELETE FROM user_appearance WHERE workspace_id=? AND user_id=? AND platform=?').run(req.auth.workspaceId, req.auth.userId, body.platform);
          for (const row of sources.values()) {
            const prefs = JSON.parse(row.preferences);
            for (const field of APPEARANCE_PERSONAL_FIELDS) delete prefs[field];
            save(req.auth, row.scope, body.platform, prefs);
          }
        }
        return flags(req.auth);
      });
      res.json(result);
    } catch (error) { next(error); }
  });
  app.route('/api/appearance').all(requireAuth).all((req, res, next) => {
    try {
      const teamId = req.query.teamId ?? '', platform = req.query.platform ?? 'web';
      if (typeof teamId !== 'string' || teamId.length > 100) throw new HttpError(400, 'Team không hợp lệ.');
      if (!APPEARANCE_PLATFORMS.includes(platform)) throw new HttpError(400, 'Nền tảng không hợp lệ.');
      req.appearanceTeam = teamId ? teamPolicy(req.auth.workspaceId, req.auth.userId, teamId) : null;
      req.appearanceScope = teamId;
      req.appearancePlatform = platform;
      next();
    } catch (error) { next(error); }
  }).get((req, res) => {
    const separate = flags(req.auth)[req.appearancePlatform].separate;
    res.json({ preferences: read(req.auth, req.appearanceScope, separate ? req.appearancePlatform : 'all'), team: req.appearanceTeam, accessibility: accessibility(req.auth), platform: req.appearancePlatform, separate });
  }).put((req, res, next) => {
    try {
      let preferences;
      try { preferences = validateAppearance(req.body); }
      catch (error) { throw new HttpError(400, error.message); }
      // validateAppearance fills every default, so only fields present in the body carry the personal overlay.
      const routed = Object.fromEntries(APPEARANCE_PERSONAL_FIELDS.filter(field => Object.hasOwn(req.body, field)).map(field => [field, preferences[field]]));
      if (req.appearanceTeam) {
        const { preferences: shared, editableFields } = req.appearanceTeam;
        for (const [field, value] of Object.entries(preferences)) {
          if (!editableFields.includes(field) && !APPEARANCE_PERSONAL_FIELDS.includes(field) && JSON.stringify(value) !== JSON.stringify(shared[field]))
            throw new HttpError(403, 'Quản trị team chưa cho phép thay đổi tùy chọn này.');
        }
        preferences = Object.fromEntries(Object.entries(preferences).filter(([field, value]) => editableFields.includes(field) && JSON.stringify(value) !== JSON.stringify(shared[field])));
      }
      for (const field of APPEARANCE_PERSONAL_FIELDS) delete preferences[field];
      const result = withTransaction(db, () => {
        lock(req.auth);
        const platform = flags(req.auth)[req.appearancePlatform].separate ? req.appearancePlatform : 'all';
        const stored = read(req.auth, '', 'all') || {};
        if (req.appearanceScope === '' && platform === 'all') {
          const kept = Object.fromEntries(APPEARANCE_PERSONAL_FIELDS.filter(field => Object.hasOwn(stored, field)).map(field => [field, stored[field]]));
          preferences = { ...preferences, ...kept, ...routed };
          save(req.auth, '', 'all', preferences);
        } else {
          save(req.auth, '', 'all', { ...stored, ...routed });
          save(req.auth, req.appearanceScope, platform, preferences);
        }
        return { preferences, accessibility: accessibility(req.auth) };
      });
      res.json(result);
    } catch (error) { next(error); }
  }).delete((req, res, next) => {
    try {
      withTransaction(db, () => {
        lock(req.auth);
        const platform = flags(req.auth)[req.appearancePlatform].separate ? req.appearancePlatform : 'all';
        db.prepare('DELETE FROM user_appearance WHERE workspace_id=? AND user_id=? AND scope=? AND platform=?').run(req.auth.workspaceId, req.auth.userId, req.appearanceScope, platform);
      });
      res.json({ preferences: null });
    } catch (error) { next(error); }
  });
}
