import { TABLE_COLUMNS } from './database-tables.mjs';
import { SCHEMA_VERSION, withTransaction } from './db.mjs';
export const quoteIdentifier = name => '"' + name.replaceAll('"', '""') + '"';

export function validateSnapshot(snapshot) {
  if (snapshot?.format !== 'nhactoi-postgresql' || snapshot.version !== 1 || snapshot.schemaVersion !== SCHEMA_VERSION)
    throw new Error('Bản sao PostgreSQL không hợp lệ hoặc khác phiên bản schema');
  const tables = snapshot.tables;
  if (!tables || Object.keys(tables).sort().join() !== Object.keys(TABLE_COLUMNS).sort().join())
    throw new Error('Bản sao thiếu bảng dữ liệu');
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const entry = tables[table];
    if (!entry || JSON.stringify(entry.columns) !== JSON.stringify(columns) || !Array.isArray(entry.rows)
      || entry.rows.some(row => !Array.isArray(row) || row.length !== columns.length
        || row.some(v => v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v)))))
      throw new Error('Bản sao có cột hoặc dữ liệu không hợp lệ: ' + table);
  }
  return snapshot;
}

export function snapshotRows(snapshot, table) {
  const { columns, rows } = snapshot.tables[table];
  return rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

export function exportSnapshot(db) {
  db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const tables = {};
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const rows = db.prepare(`SELECT ${columns.map(quoteIdentifier).join(',')} FROM ${quoteIdentifier(table)}`).all();
      tables[table] = { columns, rows: rows.map(row => columns.map(column => row[column])) };
    }
    db.exec('COMMIT');
    return { format: 'nhactoi-postgresql', version: 1, schemaVersion: SCHEMA_VERSION, tables };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Call only while the app is offline. Constraint checks still run; disabling
// user triggers prevents historical notifications from being sent again.
export function importSnapshot(db, snapshot, { replace = false, afterImport } = {}) {
  validateSnapshot(snapshot);
  return withTransaction(db, () => {
    const tables = Object.keys(TABLE_COLUMNS);
    db.exec(`LOCK TABLE ${tables.map(quoteIdentifier).join(',')} IN ACCESS EXCLUSIVE MODE`);
    if (!replace) for (const table of tables) {
      if (table !== 'ticket_sequence' && db.prepare(`SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1`).get())
        throw new Error('Database đích phải trống; không ghi đè dữ liệu hiện có');
    }
    db.exec('SET CONSTRAINTS ALL DEFERRED');
    for (const table of tables) db.exec(`ALTER TABLE ${quoteIdentifier(table)} DISABLE TRIGGER USER`);
    db.exec(`TRUNCATE ${tables.map(quoteIdentifier).join(',')} RESTART IDENTITY`);
    for (const [table, { columns, rows }] of Object.entries(snapshot.tables)) {
      const insert = db.prepare(`INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of rows) insert.run(...row);
      const count = db.prepare(`SELECT count(*) n FROM ${quoteIdentifier(table)}`).get().n;
      if (count !== rows.length) throw new Error('Row count mismatch: ' + table);
      // Preserve generated IDs after importing explicit historical values.
      for (const column of columns) {
        const sequence = db.prepare('SELECT pg_get_serial_sequence(?, ?) AS name').get(table, column).name;
        if (sequence) {
          const max = db.prepare(`SELECT max(${quoteIdentifier(column)}) n FROM ${quoteIdentifier(table)}`).get().n;
          db.prepare('SELECT setval(?::regclass, ?, ?)').get(sequence, max || 1, max !== null);
        }
      }
    }
    db.exec('SET CONSTRAINTS ALL IMMEDIATE');
    for (const table of tables) db.exec(`ALTER TABLE ${quoteIdentifier(table)} ENABLE TRIGGER USER`);
    afterImport?.(db);
    db.exec('SET CONSTRAINTS ALL IMMEDIATE');
    return Object.fromEntries(tables.map(table => [table, snapshot.tables[table].rows.length]));
  });
}
