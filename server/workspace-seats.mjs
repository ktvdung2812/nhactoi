// Every seat reservation, acceptance and subscription change takes this lock
// inside its transaction. Different workspaces remain independent.
export function lockWorkspaceSeats(db, workspaceId) {
  if (db.dialect === 'postgres')
    db.prepare('SELECT pg_advisory_xact_lock_shared(hashtext(current_schema()), ?)').get(31002);
  return db.prepare(`SELECT id FROM workspaces WHERE id=?${db.dialect === 'postgres' ? ' FOR UPDATE' : ''}`).get(workspaceId);
}

// Catalog seat reductions must also serialize with workspaces switching into
// the affected plan. Acquire this before enumerating/locking subscribers.
export function lockPlanSeatChanges(db) {
  if (db.dialect === 'postgres')
    db.prepare('SELECT pg_advisory_xact_lock(hashtext(current_schema()), ?)').get(31002);
}

export function workspaceSeatCount(db, workspaceId, now) {
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM workspace_members WHERE workspace_id=?) AS members,
    (SELECT COUNT(DISTINCT i.email) FROM invitations i
      WHERE i.workspace_id=? AND i.accepted_at IS NULL AND i.expires_at>?
      AND NOT EXISTS (SELECT 1 FROM workspace_members wm JOIN users u ON u.id=wm.user_id
        WHERE wm.workspace_id=i.workspace_id AND u.email=i.email)) AS pending`)
    .get(workspaceId, workspaceId, now);
  return Number(counts.members) + Number(counts.pending);
}
