import { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import * as postgres from '../server/db.mjs';
import * as sqlite from '../server/legacy-sqlite.mjs';
import { createApp as createServerApp } from '../server/index.mjs';
import { seedDemo as seed } from '../server/seed.mjs';
export * from '../server/index.mjs';

// The old upgrade fixtures deliberately rebuild SQLite tables. Run those alone
// with test:legacy; every API/regression test normally uses real PostgreSQL.
const legacy = process.env.NHACTOI_LEGACY_TESTS === '1';
export const SCHEMA_VERSION = legacy ? sqlite.SCHEMA_VERSION : postgres.SCHEMA_VERSION;
export const migrateDatabase = legacy ? sqlite.migrateDatabase : db => postgres.migrateDatabase(db, { bootstrapAdmin: false });
export const withTransaction = postgres.withTransaction;
const schemas = new Map();
const connections = new Set();
let admin;
export function openDatabase(path = ':memory:') {
  if (legacy) {
    const db = sqlite.openDatabase(path);
    const prepare = db.prepare.bind(db);
    db.prepare = sql => prepare(sql.replace(/\bFOR UPDATE\b/g, '').replace(/\binsertion_order\b/g, 'rowid'));
    return db;
  }
  if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL to a dedicated PostgreSQL test database (see docs/POSTGRESQL.md)');
  admin ||= postgres.openDatabase(process.env.TEST_DATABASE_URL, { migrate: false });
  const key = path === ':memory:' ? randomUUID() : path;
  if (!schemas.has(key)) {
    const schema = 'test_' + randomUUID().replaceAll('-', '');
    admin.exec(`CREATE SCHEMA "${schema}"`);
    schemas.set(key, schema);
  }
  const db = postgres.openDatabase(process.env.TEST_DATABASE_URL, { schema: schemas.get(key), bootstrapAdmin: false });
  connections.add(db);
  return db;
}
export function createApp(options = {}) {
  return createServerApp({ ...options, db: options.db || openDatabase(options.dbPath) });
}
export function seedDemo(options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  try { return seed({ ...options, db }); } finally { if (!options.db) db.close(); }
}
after(() => {
  for (const db of connections) db.close();
  for (const schema of schemas.values()) admin.exec(`DROP SCHEMA "${schema}" CASCADE`);
  admin?.close();
});
