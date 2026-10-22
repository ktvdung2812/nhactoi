export const PERSONAL_WORKSPACE_NAME = 'Không gian cá nhân';
// Personal workspaces are free; a far period end keeps every write gate open.
export const PERSONAL_PERIOD_END = '9999-12-31T00:00:00.000Z';

// Call inside a transaction. personal_owner_id is UNIQUE, so a concurrent
// second request for the same user fails instead of creating a duplicate.
export function createPersonalWorkspace(db, { userId, now, createId }) {
  const workspaceId = createId('workspace_');
  db.prepare("INSERT INTO workspaces(id,name,industry,created_at,kind,personal_owner_id) VALUES (?,?,'',?,'personal',?)")
    .run(workspaceId, PERSONAL_WORKSPACE_NAME, now, userId);
  db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'owner',?)")
    .run(workspaceId, userId, now);
  db.prepare("INSERT INTO subscriptions(workspace_id,plan,cycle,status,current_period_end,updated_at) VALUES (?,'starter','monthly','active',?,?)")
    .run(workspaceId, PERSONAL_PERIOD_END, now);
  return workspaceId;
}

export function personalWorkspaceId(db, userId) {
  return db.prepare('SELECT id FROM workspaces WHERE personal_owner_id=?').get(userId)?.id || null;
}

export function isPersonalWorkspace(db, workspaceId) {
  return db.prepare("SELECT kind FROM workspaces WHERE id=?").get(workspaceId)?.kind === 'personal';
}
