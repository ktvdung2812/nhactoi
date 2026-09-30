import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSyncFn } from 'synckit';
import { bootstrapAdmin as ensureBootstrapAdmin } from './bootstrap-admin.mjs';

export const SCHEMA_VERSION = 1;
let worker;
const callWorker = (...args) => (worker ||= createSyncFn(resolve(process.cwd(), 'server/postgres-worker.mjs'), { timeout: 120000, execArgv: [] }))(...args);

// Values stay bound. Quoted strings/identifiers and comments must not consume
// parameter numbers. SQL operators are written in PostgreSQL syntax by callers.
export function bindSql(sql) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g,
    token => token === '?' ? `$${++index}` : token);
}

export function openDatabase(connectionString = process.env.DATABASE_URL, { schema = process.env.DATABASE_SCHEMA || 'public', migrate = true, bootstrapAdmin = true, env = process.env } = {}) {
  if (!connectionString || !/^postgres(?:ql)?:\/\//.test(connectionString))
    throw new Error('DATABASE_URL phải là URL PostgreSQL (postgresql://user:password@host:5432/nhactoi)');
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid PostgreSQL schema');
  const id = randomUUID();
  callWorker('connect', id, { connectionString, schema });
  let closed = false;
  const query = (sql, values = []) => {
    if (closed) throw new Error('Database is closed');
    return callWorker('query', id, { sql, values });
  };
  const db = {
    schema,
    dialect: 'postgres',
    prepare(sql) {
      const text = bindSql(sql);
      return {
        all: (...values) => query(text, values).rows,
        get: (...values) => query(text, values).rows[0],
        run: (...values) => ({ changes: query(text, values).rowCount }),
      };
    },
    exec(sql) { query(sql); },
    close() { if (!closed) { callWorker('close', id); closed = true; } },
  };
  try { if (migrate) migrateDatabase(db, { bootstrapAdmin, env }); return db; }
  catch (error) { db.close(); throw error; }
}

export function migrateDatabase(db, { bootstrapAdmin = true, env = process.env } = {}) {
  let admin;
  withTransaction(db, () => {
    // Serialize schema upgrades even when two processes start together.
    db.prepare('SELECT pg_advisory_xact_lock(hashtext(current_schema()), ?)').get(31001);
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const version = db.prepare('SELECT coalesce(max(version), 0) AS version FROM schema_migrations').get().version;
    if (version > SCHEMA_VERSION) throw new Error('Database schema is newer than this application');
    if (version < 1) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/001-baseline.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(1, new Date().toISOString());
    }
    if (bootstrapAdmin) admin = ensureBootstrapAdmin(db, { env });
  });
  if (admin?.created) console.info(`[nhactoi] Đã khởi tạo admin SaaS: ${admin.email}.` + (admin.credentialsFile ? ` Thông tin đăng nhập: ${admin.credentialsFile}` : ' Dùng mật khẩu BOOTSTRAP_ADMIN_PASSWORD đã cấu hình.'));
  return db;
}

export function withTransaction(db, callback) {
  db.exec('BEGIN');
  try {
    const result = callback();
    if (result?.then) throw new Error('Transaction callbacks must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
