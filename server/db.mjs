import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSyncFn } from 'synckit';
import { bootstrapAdmin as ensureBootstrapAdmin } from './bootstrap-admin.mjs';

export const SCHEMA_VERSION = 15;
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
    if (version < 2) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/002-reminder-source.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(2, new Date().toISOString());
    }
    if (version < 3) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/003-projects.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(3, new Date().toISOString());
    }
    if (version < 4) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/004-task-mutation-pipeline.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(4, new Date().toISOString());
    }
    if (version < 5) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/005-durable-delivery.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(5, new Date().toISOString());
    }
    if (version < 6) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/006-project-collaboration.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(6, new Date().toISOString());
    }
    if (version < 7) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/007-service-operations.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(7, new Date().toISOString());
    }
    if (version < 8) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/008-project-advanced.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(8, new Date().toISOString());
    }
    if (version < 9) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/009-google-calendar.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(9, new Date().toISOString());
    }
    if (version < 10) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/010-work-automation.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(10, new Date().toISOString());
    }
    if (version < 11) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/011-project-imports.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(11, new Date().toISOString());
    }
    if (version < 12) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/012-zalo-oa.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(12, new Date().toISOString());
    }
    if (version < 13) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/013-public-api.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(13, new Date().toISOString());
    }
    if (version < 14) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/014-task-page-order.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(14, new Date().toISOString());
    }
    if (version < 15) {
      db.exec(readFileSync(resolve(process.cwd(), 'server/migrations/postgres/015-comment-assistant.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(15, new Date().toISOString());
    }
    if (bootstrapAdmin) admin = ensureBootstrapAdmin(db, { env });
  });
  if (admin?.created) console.info(`[nhactoi] Đã khởi tạo admin SaaS: ${admin.email}.` + (admin.credentialsFile ? ` Thông tin đăng nhập: ${admin.credentialsFile}` : ' Dùng mật khẩu BOOTSTRAP_ADMIN_PASSWORD đã cấu hình.'));
  return db;
}

const transactionDepth = new WeakMap();
export function withTransaction(db, callback) {
  const depth = transactionDepth.get(db) || 0;
  const savepoint = `mutation_${depth}`;
  db.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN');
  transactionDepth.set(db, depth + 1);
  try {
    const result = callback();
    if (result?.then) throw new Error('Transaction callbacks must be synchronous');
    db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    try { db.exec(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}` : 'ROLLBACK'); } catch {}
    throw error;
  } finally {
    transactionDepth.set(db, depth);
  }
}
