import { backup, DatabaseSync } from 'node:sqlite';
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase as openLegacy, SCHEMA_VERSION as LEGACY_VERSION } from '../server/legacy-sqlite.mjs';
import { openDatabase, SCHEMA_VERSION } from '../server/db.mjs';
import { V2_TABLE_COLUMNS } from '../server/database-tables.mjs';
import { importSnapshot, quoteIdentifier } from '../server/database-snapshot.mjs';
import { bootstrapAdmin as ensureBootstrapAdmin } from '../server/bootstrap-admin.mjs';

export async function migrateSqlite({ sourcePath, db, backupDir, bootstrapAdmin = true, env = process.env }) {
  const source = resolve(sourcePath);
  if (!existsSync(source)) throw new Error('Không tìm thấy SQLite nguồn');
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = join(backupDir, `sqlite-before-postgres-${Date.now()}-${randomUUID()}.sqlite`);
  const original = new DatabaseSync(source, { readOnly: true });
  try {
    const version = original.prepare('SELECT max(version) version FROM schema_migrations').get().version;
    if (version > LEGACY_VERSION) throw new Error('SQLite thuộc phiên bản mới hơn; hãy cập nhật công cụ chuyển đổi');
    // Online backup API includes WAL contents, unlike copying only the main file.
    await backup(original, backupPath);
    chmodSync(backupPath, 0o600);
  } finally { original.close(); }
  const stage = mkdtempSync(join(tmpdir(), 'nhactoi-sqlite-import-'));
  let legacy;
  try {
    const stagedPath = join(stage, 'upgraded.sqlite');
    copyFileSync(backupPath, stagedPath);
    legacy = openLegacy(stagedPath);
    if (legacy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok'
      || legacy.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite nguồn không toàn vẹn');
    const tables = {};
    for (const [table, columns] of Object.entries(V2_TABLE_COLUMNS)) {
      const select = columns.map(column => column === 'insertion_order' ? 'rowid AS insertion_order' : quoteIdentifier(column)).join(',');
      const rows = legacy.prepare(`SELECT ${select} FROM ${quoteIdentifier(table)}`).all();
      tables[table] = { columns, rows: rows.map(row => columns.map(column => row[column])) };
    }
    let admin;
    const counts = importSnapshot(db, { format: 'nhactoi-postgresql', version: 1, schemaVersion: 2, tables }, {
      afterImport: () => { if (bootstrapAdmin) admin = ensureBootstrapAdmin(db, { env }); },
    });
    return { backupPath, counts, admin };
  } finally { legacy?.close(); rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [sourcePath, confirmation] = process.argv.slice(2);
  if (!sourcePath || confirmation !== '--offline-confirm-migrate') {
    console.error('Usage: npm run db:import-sqlite -- /path/to/nhactoi.sqlite --offline-confirm-migrate\nStop the app first. DATABASE_URL must point to an empty PostgreSQL database. Keep uploads and the settings encryption key.');
    process.exitCode = 1;
  } else {
    // Import first, then inspect imported admins. Bootstrap must not make the
    // empty destination nonempty before the import's safety check.
    const db = openDatabase(undefined, { bootstrapAdmin: false });
    try {
      const result = await migrateSqlite({ sourcePath, db, backupDir: resolve(process.env.NHACTOI_DATA_DIR || 'data', 'migration-backups') });
      console.log(JSON.stringify(result, null, 2));
    } finally { db.close(); }
  }
}
