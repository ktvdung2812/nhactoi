import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createId, hashPassword } from './auth.mjs';

// Called inside the migration/import transaction. The lock prevents two
// concurrent initializers from both observing an installation without an admin.
export function bootstrapAdmin(db, { env = process.env, clock = () => new Date() } = {}) {
  db.exec('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
  if (db.prepare('SELECT 1 FROM users WHERE is_platform_admin=1 AND disabled_at IS NULL LIMIT 1').get())
    return { created: false };

  const name = String(env.BOOTSTRAP_ADMIN_NAME || 'Admin SaaS').trim();
  let email = String(env.BOOTSTRAP_ADMIN_EMAIL || 'admin@nhactoi.local').trim().toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD || randomBytes(24).toString('base64url');
  if (!name || name.length > 120) throw new Error('BOOTSTRAP_ADMIN_NAME không hợp lệ');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('BOOTSTRAP_ADMIN_EMAIL không hợp lệ');
  if (password.length < 12 || password.length > 200)
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD phải dài từ 12 đến 200 ký tự');
  if (db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(email)) {
    if (env.BOOTSTRAP_ADMIN_EMAIL)
      throw new Error('BOOTSTRAP_ADMIN_EMAIL đã tồn tại; chọn email mới hoặc dùng lệnh admin grant cho tài khoản hiện có');
    // Never silently promote an existing account, including a disabled admin.
    email = `admin+${randomBytes(12).toString('hex')}@nhactoi.local`;
  }

  const now = new Date(clock());
  const createdAt = now.toISOString();
  const userId = createId('user_'), workspaceId = createId('workspace_');
  db.prepare('INSERT INTO users(id,name,email,password_hash,is_platform_admin,created_at) VALUES (?,?,?,?,1,?)')
    .run(userId, name, email, hashPassword(password), createdAt);
  db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)')
    .run(workspaceId, 'Quản trị Nhắc tôi', createdAt);
  db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'owner',?)")
    .run(workspaceId, userId, createdAt);
  db.prepare("INSERT INTO subscriptions(workspace_id,plan,cycle,status,current_period_end,updated_at) VALUES (?,'starter','monthly','trialing',?,?)")
    .run(workspaceId, new Date(now.getTime() + 14 * 86400000).toISOString(), createdAt);
  db.prepare("INSERT INTO admin_audit_logs(id,actor_user_id,action,target_type,target_id,reason,before_json,after_json,created_at) VALUES (?,NULL,'admin.bootstrap','user',?,?,NULL,?,?)")
    .run(createId('admin_audit_'), userId, 'Khởi tạo khi migration chưa có admin SaaS hoạt động', JSON.stringify({ isPlatformAdmin: true }), createdAt);

  let credentialsFile = null;
  if (!env.BOOTSTRAP_ADMIN_PASSWORD) {
    const dir = resolve(env.NHACTOI_DATA_DIR || 'data');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    credentialsFile = join(dir, `bootstrap-admin-${userId}.json`);
    // Persist the generated password before commit so a write failure rolls
    // back the account instead of leaving an inaccessible administrator.
    writeFileSync(credentialsFile, JSON.stringify({ email, password, userId, createdAt }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  return { created: true, email, userId, credentialsFile };
}
