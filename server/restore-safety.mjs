// A database marker survives process restarts and also covers explicitly
// invoked workers. Its presence is fail-closed, even if its value is damaged.
export const RESTORE_SENDER_HOLD = 'restoreSenderHold';

export function outboundSendersPaused(db) {
  return !!db.prepare('SELECT 1 FROM app_settings WHERE key=?').get(RESTORE_SENDER_HOLD);
}

// Session FKs own device subscriptions and delivery receipts. While recovery
// is held, revoke access without cascading away evidence needed to reconcile.
// exceptId keeps the caller's own session, for example after an email change.
export function invalidateSessions(db, { id, userId, tokenHash, exceptId }) {
  const filters = [['id', id], ['user_id', userId], ['token_hash', tokenHash]].filter(([, value]) => value !== undefined);
  if (!filters.length) throw new Error('Session revocation requires a scope');
  const statement = outboundSendersPaused(db)
    ? "UPDATE sessions SET expires_at='1970-01-01T00:00:00.000Z'"
    : 'DELETE FROM sessions';
  const where = filters.map(([column]) => `${column}=?`);
  if (exceptId !== undefined) where.push('id<>?');
  return db.prepare(`${statement} WHERE ${where.join(' AND ')}`)
    .run(...filters.map(([, value]) => value), ...(exceptId !== undefined ? [exceptId] : []));
}

export function pauseRestoredSenders(db, backupId, restoredAt) {
  db.prepare(`INSERT INTO app_settings(key,value,encrypted,updated_at) VALUES (?,?,0,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,encrypted=0,updated_at=excluded.updated_at`)
    .run(RESTORE_SENDER_HOLD, JSON.stringify({ backupId, restoredAt, reason: 'restore-reconciliation-required' }), restoredAt);
}
