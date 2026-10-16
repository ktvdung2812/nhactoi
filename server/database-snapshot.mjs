import { TABLE_COLUMNS, V2_TABLE_COLUMNS, V3_TABLE_COLUMNS, V4_TABLE_COLUMNS, V5_TABLE_COLUMNS, V6_TABLE_COLUMNS, V7_TABLE_COLUMNS, V8_TABLE_COLUMNS, V9_TABLE_COLUMNS, V10_TABLE_COLUMNS, V11_TABLE_COLUMNS, V12_TABLE_COLUMNS } from './database-tables.mjs';
import { SCHEMA_VERSION, withTransaction } from './db.mjs';
export const quoteIdentifier = name => '"' + name.replaceAll('"', '""') + '"';

// Keep historical allowlists explicit when introducing the next schema. A
// snapshot's version must never make missing or unexpected columns acceptable.
const SNAPSHOT_COLUMNS = {
  1: { ...V2_TABLE_COLUMNS, reminder_notice_context: V2_TABLE_COLUMNS.reminder_notice_context.filter(column => column !== 'schedule_key') },
  2: V2_TABLE_COLUMNS,
  3: V3_TABLE_COLUMNS,
  4: V4_TABLE_COLUMNS,
  5: V5_TABLE_COLUMNS,
  6: V6_TABLE_COLUMNS,
  7: V7_TABLE_COLUMNS,
  8: V8_TABLE_COLUMNS,
  9: V9_TABLE_COLUMNS,
  10: V10_TABLE_COLUMNS,
  11: V11_TABLE_COLUMNS,
  12: V12_TABLE_COLUMNS,
  13: TABLE_COLUMNS,
  14: TABLE_COLUMNS,
};

export function validateSnapshot(snapshot) {
  if (snapshot?.format !== 'nhactoi-postgresql' || snapshot.version !== 1
    || !Number.isInteger(snapshot.schemaVersion) || snapshot.schemaVersion > SCHEMA_VERSION
    || !Object.hasOwn(SNAPSHOT_COLUMNS, snapshot.schemaVersion))
    throw new Error('Bản sao PostgreSQL không hợp lệ hoặc khác phiên bản schema');
  const schema = SNAPSHOT_COLUMNS[snapshot.schemaVersion];
  const tables = snapshot.tables;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)
    || JSON.stringify(Object.keys(tables).sort()) !== JSON.stringify(Object.keys(schema).sort()))
    throw new Error('Bản sao thiếu bảng dữ liệu');
  for (const [table, columns] of Object.entries(schema)) {
    const entry = tables[table];
    if (!entry || JSON.stringify(entry.columns) !== JSON.stringify(columns) || !Array.isArray(entry.rows)
      || entry.rows.some(row => !Array.isArray(row) || row.length !== columns.length
        || row.some(v => v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v)))))
      throw new Error('Bản sao có cột hoặc dữ liệu không hợp lệ: ' + table);
  }
  // Import suppresses user triggers to avoid replaying history. Check the graph
  // before that suppression so a corrupted backup cannot introduce a cycle.
  if (tables.task_dependencies) {
    const outgoing = new Map(), incoming = new Map();
    for (const edge of snapshotRows(snapshot, 'task_dependencies')) {
      if (!outgoing.has(edge.predecessor_id)) outgoing.set(edge.predecessor_id, []);
      outgoing.get(edge.predecessor_id).push(edge.successor_id);
      if (!incoming.has(edge.predecessor_id)) incoming.set(edge.predecessor_id, 0);
      incoming.set(edge.successor_id, (incoming.get(edge.successor_id) || 0) + 1);
    }
    const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
    for (let index = 0; index < ready.length; index++) for (const id of outgoing.get(ready[index]) || []) {
      incoming.set(id, incoming.get(id) - 1);
      if (incoming.get(id) === 0) ready.push(id);
    }
    if (ready.length !== incoming.size) throw new Error('Bản sao có chu trình phụ thuộc công việc');
  }
  return snapshot;
}

export function upgradeSnapshot(snapshot) {
  validateSnapshot(snapshot);
  if (snapshot.schemaVersion === SCHEMA_VERSION) return snapshot;
  // Version 14 adds an index only; the version 13 data contract is unchanged.
  if (snapshot.schemaVersion === 13) return { ...snapshot, schemaVersion: 14 };
  if (snapshot.schemaVersion === 12) return upgradeSnapshot({ ...snapshot, schemaVersion: 13, tables: { ...snapshot.tables,
    business_events: {columns:TABLE_COLUMNS.business_events,rows:snapshot.tables.business_events.rows.map(row=>[...row,null])},
    ...Object.fromEntries(['api_tokens','webhook_subscriptions','webhook_deliveries','webhook_attempts'].map(table=>[table,{columns:TABLE_COLUMNS[table],rows:[]}]))
  } });
  if (snapshot.schemaVersion === 11) return upgradeSnapshot({ ...snapshot, schemaVersion: 12, tables: { ...snapshot.tables,
    ...Object.fromEntries(["zalo_oa_connections", "zalo_oa_templates", "zalo_oa_recipients", "zalo_oa_deliveries", "zalo_oa_attempts", "zalo_oa_callbacks"].map(table=>[table,{columns:TABLE_COLUMNS[table],rows:[]}]))
  } });
  if (snapshot.schemaVersion === 10) return upgradeSnapshot({ ...snapshot, schemaVersion: 11, tables: { ...snapshot.tables,
    tasks: {columns:TABLE_COLUMNS.tasks,rows:snapshot.tables.tasks.rows.map(row=>[...row,null])},
    import_sources: {columns:TABLE_COLUMNS.import_sources,rows:[]},
  } });
  if (snapshot.schemaVersion === 9) return upgradeSnapshot({ ...snapshot, schemaVersion: 10, tables: { ...snapshot.tables,
    task_assignment_cycles: {columns:TABLE_COLUMNS.task_assignment_cycles,rows:snapshot.tables.task_assignment_cycles.rows.map(row=>[...row,null])},
    automation_rules: {columns:TABLE_COLUMNS.automation_rules,rows:snapshot.tables.automation_rules.rows.map(row=>[...row,'[]',null,new Date().toISOString()])},
    automation_runs: {columns:TABLE_COLUMNS.automation_runs,rows:snapshot.tables.automation_runs.rows.map(row=>[...row,null])},
    ...Object.fromEntries(['automation_event_queue','work_calendars','reminder_delegates','work_timers','time_entries','task_estimates'].map(table=>[table,{columns:TABLE_COLUMNS[table],rows:[]}]))
  } });
  if (snapshot.schemaVersion === 8) return upgradeSnapshot({ ...snapshot, schemaVersion: 9, tables: { ...snapshot.tables,
    ...Object.fromEntries(['google_calendar_connections','google_calendar_states','google_calendar_mappings','google_calendar_jobs'].map(table => [table,{columns:TABLE_COLUMNS[table],rows:[]}])) ,
  } });
  if (snapshot.schemaVersion === 7) return upgradeSnapshot({ ...snapshot, schemaVersion: 8, tables: { ...snapshot.tables,
    tasks: { columns: V8_TABLE_COLUMNS.tasks, rows: snapshot.tables.tasks.rows.map(row => [...row, null]) },
    ...Object.fromEntries(['project_fields','task_field_values','project_views','task_dependencies','project_templates'].map(table => [table,{columns:TABLE_COLUMNS[table],rows:[]}])) ,
  } });
  if (snapshot.schemaVersion === 5) return upgradeCollaborationSnapshot(snapshot);
  if (snapshot.schemaVersion === 6) return upgradeSnapshot({ ...snapshot, schemaVersion: 7, tables: { ...snapshot.tables,
    service_contracts: { columns: TABLE_COLUMNS.service_contracts, rows: snapshot.tables.service_contracts.rows.map(row => [...row, null, 'daily', row[V5_TABLE_COLUMNS.service_contracts.indexOf('next_date')]]) },
    service_renewals: { columns: TABLE_COLUMNS.service_renewals, rows: snapshot.tables.service_renewals.rows.map(row => [...row, null, null]) },
    service_cycle_tasks: { columns: TABLE_COLUMNS.service_cycle_tasks, rows: [] },
  } });
  if (snapshot.schemaVersion === 4) return upgradeSnapshot({ ...snapshot, schemaVersion: 5, tables: { ...snapshot.tables,
    delivery_leases: { columns: TABLE_COLUMNS.delivery_leases, rows: [] },
  } });
  if (snapshot.schemaVersion === 3) return upgradeSnapshot({ ...snapshot, schemaVersion: 4, tables: { ...snapshot.tables,
    tasks: { columns: V4_TABLE_COLUMNS.tasks, rows: snapshot.tables.tasks.rows.map(row => [...row, 0]) },
    ...Object.fromEntries(['business_events', 'task_assignment_cycles', 'mutation_receipts', 'personal_plan_revisions'].map(table => [table, { columns: V4_TABLE_COLUMNS[table], rows: [] }])),
  } });
  if (snapshot.schemaVersion === 2) return upgradeProjectSnapshot(snapshot);
  // Mirror migration 002: recover a source only for exactly one matching
  // delivery claim. Missing/ambiguous history stays suppressed by the sender.
  const notices = new Map(snapshotRows(snapshot, 'notifications').map(row => [row.id, row]));
  const claims = new Map();
  const key = row => JSON.stringify([row.task_id, row.user_id, row.created_at]);
  for (const claim of snapshotRows(snapshot, 'task_reminder_deliveries')) {
    const id = key(claim);
    claims.set(id, claims.has(id) ? null : claim.schedule_key);
  }
  const context = snapshot.tables.reminder_notice_context;
  const notificationIndex = context.columns.indexOf('notification_id');
  const rows = context.rows.map(row => {
    const notice = notices.get(row[notificationIndex]);
    const schedule = notice?.type === 'task_reminder' ? (claims.get(key(notice)) ?? 'legacy:unknown') : null;
    return [...row, schedule];
  });
  return upgradeSnapshot({ ...snapshot, schemaVersion: 2, tables: { ...snapshot.tables,
    reminder_notice_context: { columns: [...SNAPSHOT_COLUMNS[2].reminder_notice_context], rows },
  } });
}

function upgradeProjectSnapshot(snapshot) {
  const projects = [
    ...snapshotRows(snapshot, 'workspaces').map(row => ({ id: 'prj_ws_' + row.id, workspace_id: row.id, name: 'Công việc chung', description: '', access_mode: 'workspace', team_id: null, is_default: 1, archived_at: null, created_by: null, created_at: row.created_at, updated_at: row.created_at })),
    ...snapshotRows(snapshot, 'teams').map(row => ({ id: 'prj_team_' + row.id, workspace_id: row.workspace_id, name: row.name, description: '', access_mode: 'team', team_id: row.id, is_default: 1, archived_at: row.archived_at, created_by: null, created_at: row.created_at, updated_at: row.updated_at })),
  ];
  const tables = { ...snapshot.tables,
    projects: { columns: V3_TABLE_COLUMNS.projects, rows: projects.map(row => V3_TABLE_COLUMNS.projects.map(column => row[column])) },
    project_members: { columns: V3_TABLE_COLUMNS.project_members, rows: [] },
  };
  for (const table of ['tasks', 'board_columns', 'workspace_members', 'invitations']) {
    tables[table] = { columns: V3_TABLE_COLUMNS[table], rows: snapshotRows(snapshot, table).map(row =>
      [...snapshot.tables[table].columns.map(column => row[column]), ['tasks', 'board_columns'].includes(table)
        ? (row.team_id ? 'prj_team_' + row.team_id : 'prj_ws_' + row.workspace_id) : 'member']) };
  }
  return upgradeSnapshot({ ...snapshot, schemaVersion: 3, tables });
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
      tables[table] = { columns: [...columns], rows: rows.map(row => columns.map(column => row[column])) };
    }
    db.exec('COMMIT');
    return { format: 'nhactoi-postgresql', version: 1, schemaVersion: SCHEMA_VERSION, tables };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Call only while the app is offline. Constraint checks still run; disabling
// user triggers prevents historical notifications from being sent again.
export function importSnapshot(db, snapshot, { replace = false, afterImport } = {}) {
  snapshot = upgradeSnapshot(snapshot);
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

function upgradeCollaborationSnapshot(snapshot) {
  const tables = { ...snapshot.tables };
  const tasks = new Map(snapshotRows(snapshot, 'tasks').map(row => [row.id,row]));
  for (const table of ['task_templates','automation_rules','task_labels']) {
    tables[table] = { columns: V6_TABLE_COLUMNS[table], rows: snapshotRows(snapshot,table).map(row => [...snapshot.tables[table].columns.map(c=>row[c]),
      table==='task_templates' && tasks.has(row.source_task_id) ? tasks.get(row.source_task_id).project_id : row.team_id ? 'prj_team_'+row.team_id : 'prj_ws_'+row.workspace_id]) };
  }
  tables.invitations={columns:V6_TABLE_COLUMNS.invitations,rows:snapshot.tables.invitations.rows.map(row=>[...row,null,null])};
  const labels=new Map(snapshotRows({...snapshot,tables},'task_labels').map(row=>[row.id,row]));
  const added=new Set();
  tables.task_label_links={...snapshot.tables.task_label_links,rows:snapshotRows(snapshot,'task_label_links').map(link=>{
    const task=tasks.get(link.task_id),label=labels.get(link.label_id);
    let id=link.label_id;
    if(task&&label&&task.project_id!==label.project_id){id=label.id+':'+task.project_id;if(!added.has(id)){
      added.add(id);tables.task_labels.rows.push(V6_TABLE_COLUMNS.task_labels.map(c=>({...label,id,project_id:task.project_id})[c]));
    }}
    return snapshot.tables.task_label_links.columns.map(c=>c==='label_id'?id:link[c]);
  })};
  return upgradeSnapshot({...snapshot,schemaVersion:6,tables});
}
