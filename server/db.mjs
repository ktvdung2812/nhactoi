import {EXTRAS_SCHEMA} from "./task-extras.mjs";
import {GOOGLE_SCHEMA} from "./google-login.mjs";
import { EVENTS_SCHEMA } from "./calendar-events.mjs";
import { COLLABORATION_SCHEMA } from "./collaboration.mjs";
import { SERVICES_SCHEMA } from "./services.mjs";
import { AUTOMATION_SCHEMA } from "./automations.mjs";
import { MOBILE_SCHEMA, MOBILE_DELIVERY_SCHEMA } from "./mobile.mjs";
import { SERVICE_RENEWAL_SCHEMA } from "../shared/service-renewal.mjs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The application deliberately keeps its persistence layer small and boring.
 * DatabaseSync is a good fit here: request handlers are short, all writes are
 * transactionally grouped, and SQLite gives a useful zero-configuration local
 * deployment for a small SaaS.
 */

export const DEFAULT_DB_PATH = resolve(process.cwd(), "data", "nhactoi.sqlite");

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        industry TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS workspace_members_user_idx
        ON workspace_members(user_id, workspace_id);

      CREATE TABLE IF NOT EXISTS subscriptions (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        plan TEXT NOT NULL CHECK (plan IN ('starter', 'team', 'business')),
        cycle TEXT NOT NULL CHECK (cycle IN ('monthly', 'yearly')),
        status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'expired', 'canceled')),
        current_period_end TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        company TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        service TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS customers_workspace_idx
        ON customers(workspace_id, deleted_at, created_at);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_at TEXT NOT NULL,
        remind_at TEXT,
        assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        category TEXT NOT NULL DEFAULT '',
        recurrence TEXT NOT NULL CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
        generated_from_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS tasks_workspace_idx
        ON tasks(workspace_id, deleted_at, due_at);
      CREATE INDEX IF NOT EXISTS tasks_reminder_idx
        ON tasks(workspace_id, remind_at, deleted_at);
      CREATE UNIQUE INDEX IF NOT EXISTS tasks_generated_once_idx
        ON tasks(generated_from_task_id) WHERE generated_from_task_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS transactions_workspace_idx
        ON transactions(workspace_id, date, deleted_at);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notifications_user_idx
        ON notifications(user_id, read_at, created_at);

      CREATE TABLE IF NOT EXISTS task_reminder_deliveries (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        schedule_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, user_id, schedule_key)
      );

      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        invited_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS invitations_workspace_idx
        ON invitations(workspace_id, email, accepted_at);

      CREATE TABLE IF NOT EXISTS billing_orders (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        plan TEXT NOT NULL CHECK (plan IN ('starter', 'team', 'business')),
        cycle TEXT NOT NULL CHECK (cycle IN ('monthly', 'yearly')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'VND',
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'expired')),
        provider_payment_id TEXT,
        created_at TEXT NOT NULL,
        paid_at TEXT
      );
      CREATE INDEX IF NOT EXISTS billing_orders_workspace_idx
        ON billing_orders(workspace_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS billing_orders_provider_payment_idx
        ON billing_orders(provider_payment_id) WHERE provider_payment_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS billing_webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        order_id TEXT,
        received_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `ALTER TABLE billing_orders ADD COLUMN checkout_url TEXT;`,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE users ADD COLUMN is_platform_admin INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN disabled_at TEXT;
      ALTER TABLE workspaces ADD COLUMN suspended_at TEXT;

      CREATE INDEX IF NOT EXISTS users_platform_admin_idx
        ON users(is_platform_admin, disabled_at);
      CREATE INDEX IF NOT EXISTS users_disabled_idx
        ON users(disabled_at);
      CREATE INDEX IF NOT EXISTS workspaces_suspended_idx
        ON workspaces(suspended_at);

      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx
        ON admin_audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS admin_audit_logs_target_idx
        ON admin_audit_logs(target_type, target_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx
        ON admin_audit_logs(actor_user_id, created_at DESC);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE workspaces ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
      ALTER TABLE workspaces ADD COLUMN phone TEXT NOT NULL DEFAULT '';
      ALTER TABLE workspaces ADD COLUMN address TEXT NOT NULL DEFAULT '';
      ALTER TABLE workspaces ADD COLUMN website TEXT NOT NULL DEFAULT '';
      ALTER TABLE workspaces ADD COLUMN tax_code TEXT NOT NULL DEFAULT '';
      ALTER TABLE workspaces ADD COLUMN note TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1)),
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        number INTEGER NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
        category TEXT NOT NULL CHECK (category IN ('billing', 'account', 'technical', 'other')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS tickets_requester_workspace_idx
        ON tickets(requester_user_id, workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS tickets_workspace_status_idx
        ON tickets(workspace_id, status, category, updated_at DESC);
      CREATE INDEX IF NOT EXISTS tickets_updated_idx
        ON tickets(updated_at DESC, number DESC);

      CREATE TABLE IF NOT EXISTS ticket_messages (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
        is_staff INTEGER NOT NULL CHECK (is_staff IN (0, 1)),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx
        ON ticket_messages(ticket_id, created_at, id);

      CREATE TABLE IF NOT EXISTS ticket_events (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('created', 'status_changed', 'priority_changed')),
        from_value TEXT,
        to_value TEXT,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx
        ON ticket_events(ticket_id, created_at, id);

      CREATE TABLE IF NOT EXISTS ticket_sequence (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        next_number INTEGER NOT NULL CHECK (next_number > 0)
      );
      INSERT OR IGNORE INTO ticket_sequence(id, next_number) VALUES (1, 1);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
        color TEXT NOT NULL CHECK (color IN ('green', 'blue', 'purple', 'orange', 'rose', 'slate')),
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(id, workspace_id)
      );

      CREATE INDEX IF NOT EXISTS teams_workspace_idx
        ON teams(workspace_id, archived_at, created_at DESC);

      CREATE TABLE IF NOT EXISTS team_members (
        team_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('lead', 'member')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (team_id, user_id),
        FOREIGN KEY (team_id, workspace_id)
          REFERENCES teams(id, workspace_id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id, user_id)
          REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS team_members_workspace_user_idx
        ON team_members(workspace_id, user_id, team_id);
      CREATE INDEX IF NOT EXISTS team_members_team_role_idx
        ON team_members(team_id, role, user_id);

      ALTER TABLE tasks ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS tasks_team_idx
        ON tasks(workspace_id, team_id, deleted_at, due_at);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS trash_items (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'customer', 'transaction')),
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        deleted_at TEXT NOT NULL,
        UNIQUE(workspace_id, entity_type, entity_id)
      );

      CREATE INDEX IF NOT EXISTS trash_items_workspace_deleted_idx
        ON trash_items(workspace_id, deleted_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS trash_items_workspace_type_idx
        ON trash_items(workspace_id, entity_type, deleted_at DESC);
      CREATE INDEX IF NOT EXISTS trash_items_deleted_by_idx
        ON trash_items(workspace_id, deleted_by, entity_type, deleted_at DESC);

      -- Older releases already kept soft-deleted records in their source
      -- tables. Preserve those recovery candidates with a NULL actor; only
      -- workspace owners/admins can see or operate on these backfilled rows.
      INSERT OR IGNORE INTO trash_items
        (id, workspace_id, entity_type, entity_id, title, deleted_by, deleted_at)
      SELECT 'trash_legacy_task_' || id, workspace_id, 'task', id, title, NULL, deleted_at
      FROM tasks
      WHERE deleted_at IS NOT NULL;

      INSERT OR IGNORE INTO trash_items
        (id, workspace_id, entity_type, entity_id, title, deleted_by, deleted_at)
      SELECT 'trash_legacy_customer_' || id, workspace_id, 'customer', id, name, NULL, deleted_at
      FROM customers
      WHERE deleted_at IS NOT NULL;

      INSERT OR IGNORE INTO trash_items
        (id, workspace_id, entity_type, entity_id, title, deleted_by, deleted_at)
      SELECT 'trash_legacy_transaction_' || id, workspace_id, 'transaction', id, title, NULL, deleted_at
      FROM transactions
      WHERE deleted_at IS NOT NULL;
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS task_checklists (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_checklists_task_idx
        ON task_checklists(task_id, created_at, id);

      CREATE TABLE IF NOT EXISTS task_checklist_items (
        id TEXT PRIMARY KEY,
        checklist_id TEXT NOT NULL REFERENCES task_checklists(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
        completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_checklist_items_checklist_idx
        ON task_checklist_items(checklist_id, created_at, id);

      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
        url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2000),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_attachments_task_idx
        ON task_attachments(task_id, created_at, id);

      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_comments_task_idx
        ON task_comments(task_id, created_at, id);

      CREATE TABLE IF NOT EXISTS task_activity (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
        summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_activity_task_idx
        ON task_activity(task_id, created_at, id);
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE task_attachments ADD COLUMN kind TEXT NOT NULL DEFAULT 'link'
        CHECK (kind IN ('link', 'file'));
      ALTER TABLE task_attachments ADD COLUMN original_name TEXT;
      ALTER TABLE task_attachments ADD COLUMN mime_type TEXT;
      ALTER TABLE task_attachments ADD COLUMN size_bytes INTEGER;
      ALTER TABLE task_attachments ADD COLUMN storage_root TEXT;
      ALTER TABLE task_attachments ADD COLUMN storage_key TEXT;

      CREATE INDEX IF NOT EXISTS task_attachments_kind_idx
        ON task_attachments(task_id, kind, created_at, id);

      -- A committed attachment delete can be followed by a transient storage
      -- failure. Keep enough immutable information to retry it on the next
      -- application startup or after a later attachment mutation.
      CREATE TABLE IF NOT EXISTS task_file_cleanup (
        id TEXT PRIMARY KEY,
        storage_root TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS task_file_cleanup_due_idx
        ON task_file_cleanup(next_attempt_at, created_at, id);
    `,
  },
  {
    version: 10,
    sql: `
      -- File-only comments are valid. Rebuild the small comments table to
      -- relax the old migration 8 lower-bound check while preserving rows.
      CREATE TABLE task_comments_v10 (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL CHECK (length(body) BETWEEN 0 AND 5000),
        created_at TEXT NOT NULL
      );

      INSERT INTO task_comments_v10(id, task_id, author_user_id, body, created_at)
      SELECT id, task_id, author_user_id, body, created_at
      FROM task_comments;

      DROP TABLE task_comments;
      ALTER TABLE task_comments_v10 RENAME TO task_comments;

      CREATE INDEX IF NOT EXISTS task_comments_task_idx
        ON task_comments(task_id, created_at, id);

      ALTER TABLE task_attachments ADD COLUMN comment_id TEXT
        REFERENCES task_comments(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS task_attachments_comment_idx
        ON task_attachments(comment_id, created_at, id);
    `,
  },
  {
    version: 11,
    sql: `
      -- Board columns are scoped to one workspace board. A NULL team_id is
      -- the common board; team boards use the composite team/workspace key so
      -- a column can never be borrowed by another tenant.
      CREATE TABLE IF NOT EXISTS board_columns (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        team_id TEXT,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
        tone TEXT NOT NULL DEFAULT 'blue' CHECK (length(tone) BETWEEN 1 AND 40),
        position REAL NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (team_id, workspace_id)
          REFERENCES teams(id, workspace_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS board_columns_workspace_board_idx
        ON board_columns(workspace_id, team_id, archived_at, position, id);
      CREATE INDEX IF NOT EXISTS board_columns_team_idx
        ON board_columns(team_id, workspace_id, archived_at, position, id);

      CREATE TABLE IF NOT EXISTS board_preferences (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- Empty string represents the common board because SQLite NULLs do
        -- not participate in PRIMARY KEY uniqueness.
        team_id TEXT NOT NULL DEFAULT '',
        collapsed_ids TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, user_id, team_id)
      );

      CREATE INDEX IF NOT EXISTS board_preferences_user_idx
        ON board_preferences(workspace_id, user_id, team_id);

      ALTER TABLE tasks ADD COLUMN column_id TEXT
        REFERENCES board_columns(id) ON DELETE SET NULL;
      ALTER TABLE tasks ADD COLUMN board_position REAL NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS tasks_board_idx
        ON tasks(workspace_id, column_id, deleted_at, board_position, id);

      -- Bootstrap columns for rows that already exist when upgrading a v10
      -- database. New workspaces and teams are initialized by boards.mjs on
      -- first access.
      INSERT OR IGNORE INTO board_columns
        (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at)
      SELECT 'board_' || w.id || '_common_todo', w.id, NULL, 'Cần làm', 'todo', 'blue', 0,
             w.created_at, w.created_at
      FROM workspaces w
      WHERE NOT EXISTS (
        SELECT 1 FROM board_columns bc
        WHERE bc.workspace_id = w.id AND bc.team_id IS NULL
      );
      INSERT OR IGNORE INTO board_columns
        (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at)
      SELECT 'board_' || w.id || '_common_doing', w.id, NULL, 'Đang làm', 'doing', 'orange', 1,
             w.created_at, w.created_at
      FROM workspaces w
      WHERE NOT EXISTS (
        SELECT 1 FROM board_columns bc
        WHERE bc.workspace_id = w.id AND bc.team_id IS NULL AND bc.status = 'doing'
      );
      INSERT OR IGNORE INTO board_columns
        (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at)
      SELECT 'board_' || w.id || '_common_done', w.id, NULL, 'Hoàn thành', 'done', 'green', 2,
             w.created_at, w.created_at
      FROM workspaces w
      WHERE NOT EXISTS (
        SELECT 1 FROM board_columns bc
        WHERE bc.workspace_id = w.id AND bc.team_id IS NULL AND bc.status = 'done'
      );
      INSERT OR IGNORE INTO board_columns
        (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at)
      SELECT 'board_' || t.id || '_todo', t.workspace_id, t.id, 'Cần làm', 'todo', 'blue', 0,
             t.created_at, t.created_at
      FROM teams t
      WHERE NOT EXISTS (
        SELECT 1 FROM board_columns bc
        WHERE bc.workspace_id = t.workspace_id AND bc.team_id = t.id
      );
      INSERT OR IGNORE INTO board_columns
        (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at)
      SELECT 'board_' || t.id || '_doing', t.workspace_id, t.id, 'Đang làm', 'doing', 'orange', 1,
             t.created_at, t.created_at
      FROM teams t
      WHERE NOT EXISTS (
        SELECT 1 FROM board_columns bc
        WHERE bc.workspace_id = t.workspace_id AND bc.team_id = t.id AND bc.status = 'doing'
      );
      INSERT OR IGNORE INTO board_columns
        (id, workspace_id, team_id, name, status, tone, position, created_at, updated_at)
      SELECT 'board_' || t.id || '_done', t.workspace_id, t.id, 'Hoàn thành', 'done', 'green', 2,
             t.created_at, t.created_at
      FROM teams t
      WHERE NOT EXISTS (
        SELECT 1 FROM board_columns bc
        WHERE bc.workspace_id = t.workspace_id AND bc.team_id = t.id AND bc.status = 'done'
      );

      UPDATE tasks
      SET column_id = (
        SELECT bc.id
        FROM board_columns bc
        WHERE bc.workspace_id = tasks.workspace_id
          AND ((bc.team_id IS NULL AND tasks.team_id IS NULL) OR bc.team_id = tasks.team_id)
          AND bc.status = tasks.status
          AND bc.archived_at IS NULL
        ORDER BY bc.position, bc.id
        LIMIT 1
      )
      WHERE column_id IS NULL;
    `,
  },
  {version:12,sql:COLLABORATION_SCHEMA},
  {version:13,sql:SERVICES_SCHEMA},
  {version:14,sql:AUTOMATION_SCHEMA},
  {version:15,sql:EXTRAS_SCHEMA},
  {version:16,sql:EVENTS_SCHEMA},
  {version:17,sql:GOOGLE_SCHEMA},
  {
    version: 18,
    // Columns are added by migrateDatabase with an existence check.  A few
    // legacy migration fixtures intentionally delete only migration markers
    // before replaying the latest migrations, so this version must remain
    // safe when its additive columns are already present.
    sql: MOBILE_SCHEMA,
  },
  {
    // Renewal fields are deliberately separate from migration 13. Existing
    // service rows are expanded and backfilled without rewriting the applied
    // baseline schema.
    version: 19,
    sql: SERVICE_RENEWAL_SCHEMA,
  },
  {
    // Existing v18 databases already have the main mobile schema. Keep the
    // per-installation delivery state as a separate additive migration so
    // retries can be upgraded without recreating any notification rows.
    version: 20,
    sql: MOBILE_DELIVERY_SCHEMA,
  },
];

export const SCHEMA_VERSION = migrations.at(-1).version;

export function openDatabase(filePath = DEFAULT_DB_PATH) {
  const path = filePath === ":memory:" ? filePath : resolve(filePath);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  // SQLite's built-in LOWER() only handles ASCII. Register a deterministic
  // folding function for the admin search queries so Vietnamese names match
  // regardless of case or tone marks without loading every row in memory.
  db.function(
    "unicode_fold",
    { deterministic: true },
    (value) =>
      String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d")
        .toLocaleLowerCase("vi-VN"),
  );
  // WAL is unavailable for a few URI/in-memory configurations. It is an
  // optimisation only, so an inability to enable it should not block startup.
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {}
  migrateDatabase(db);
  return db;
}

export function migrateDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const has = db.prepare(
    "SELECT version FROM schema_migrations WHERE version = ?",
  );
  const insert = db.prepare(
    "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
  );
  for (const migration of migrations) {
    if (has.get(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (migration.version === 18) {
        const hasColumn = (table, column) =>
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .some((entry) => entry.name === column);
        if (!hasColumn("sessions", "kind")) {
          db.exec(
            "ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'web' CHECK(kind IN ('web', 'mobile'))",
          );
        }
        if (!hasColumn("notifications", "entity_type"))
          db.exec("ALTER TABLE notifications ADD COLUMN entity_type TEXT");
        if (!hasColumn("notifications", "entity_id"))
          db.exec("ALTER TABLE notifications ADD COLUMN entity_id TEXT");
      }
      if (migration.version === 19) {
        // The service migration is additive, but old test/backup fixtures can
        // retain a column after removing only the migration marker. Replay
        // each statement and skip only an already-present ALTER column.
        const hasColumn = (table, column) =>
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .some((entry) => entry.name === column);
        for (const rawStatement of migration.sql.split(/;\s*(?:\r?\n|$)/)) {
          const statement = rawStatement
            .replace(/^\s*(?:--[^\r\n]*(?:\r?\n|$))+/, "")
            .trim();
          if (!statement) continue;
          const addColumn = /^ALTER TABLE\s+(service_contracts|notifications)\s+ADD COLUMN\s+(\w+)/i.exec(statement);
          if (addColumn && hasColumn(addColumn[1], addColumn[2])) continue;
          db.exec(statement);
        }
      } else {
        db.exec(migration.sql);
      }
      insert.run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }
  return db;
}

export function withTransaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}
