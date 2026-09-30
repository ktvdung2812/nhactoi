import { openDatabase, SCHEMA_VERSION } from '../server/db.mjs';

const db = openDatabase();
const version = db.prepare('SELECT coalesce(max(version), 0) AS version FROM schema_migrations').get().version;
const database = new URL(process.env.DATABASE_URL);
db.close();
console.log(`PostgreSQL ${database.hostname}:${database.port || '5432'}${database.pathname} schema ${version}/${SCHEMA_VERSION}; đã kiểm tra và cập nhật.`);
