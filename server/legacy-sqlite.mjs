// SQLite migrations, used only by the one-time importer and legacy migration tests.
const WEB_PUSH_SCHEMA = "\nCREATE TABLE IF NOT EXISTS web_push_subscriptions (\n id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,\n user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,\n created_at TEXT NOT NULL, updated_at TEXT NOT NULL\n);\nCREATE INDEX IF NOT EXISTS web_push_user_idx ON web_push_subscriptions(user_id);\nCREATE TABLE IF NOT EXISTS web_push_deliveries (\n notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,\n subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,\n status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped','failed')),\n attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, sent_at TEXT, last_error TEXT,\n PRIMARY KEY(notification_id,subscription_id)\n);\nCREATE INDEX IF NOT EXISTS web_push_due_idx ON web_push_deliveries(status,next_attempt_at);\nCREATE TRIGGER IF NOT EXISTS notifications_web_push_ai AFTER INSERT ON notifications\nWHEN NEW.type IN ('task_reminder','task_update','calendar_event','service_renewal')\nBEGIN\n INSERT INTO web_push_deliveries(notification_id,subscription_id,next_attempt_at)\n SELECT NEW.id,id,NEW.created_at FROM web_push_subscriptions WHERE user_id=NEW.user_id;\nEND;\nCREATE TRIGGER IF NOT EXISTS web_push_task_reset AFTER UPDATE OF due_at,assignee_id,team_id ON tasks\nWHEN OLD.due_at IS NOT NEW.due_at OR OLD.assignee_id IS NOT NEW.assignee_id OR OLD.team_id IS NOT NEW.team_id\nBEGIN\n UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN\n (SELECT id FROM notifications WHERE task_id=NEW.id AND type='task_reminder');\nEND;\nCREATE TRIGGER IF NOT EXISTS web_push_event_reset AFTER UPDATE OF starts_at,ends_at,remind_at,team_id ON calendar_events\nWHEN OLD.starts_at IS NOT NEW.starts_at OR OLD.ends_at IS NOT NEW.ends_at OR OLD.remind_at IS NOT NEW.remind_at OR OLD.team_id IS NOT NEW.team_id\nBEGIN\n UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN\n (SELECT id FROM notifications WHERE entity_id=NEW.id AND type='calendar_event');\nEND;\nCREATE TRIGGER IF NOT EXISTS web_push_snooze AFTER UPDATE OF snoozed_until ON task_reminder_responses\nWHEN NEW.snoozed_until IS NOT NULL AND OLD.snoozed_until IS NOT NEW.snoozed_until\nBEGIN\n UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN\n (SELECT id FROM notifications WHERE task_id=NEW.task_id AND user_id=NEW.user_id AND type='task_reminder');\nEND;\n";
const PERSONAL_TASKS_SCHEMA = "\n  CREATE TABLE IF NOT EXISTS personal_task_plans (\n    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    planned_date TEXT NOT NULL,\n    PRIMARY KEY (task_id, user_id)\n  );\n  CREATE INDEX IF NOT EXISTS personal_task_plans_user_idx ON personal_task_plans(user_id, planned_date);\n";
const REMINDER_WORKFLOW_SCHEMA = "\nCREATE TABLE IF NOT EXISTS reminder_policies (\n workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n scope TEXT NOT NULL DEFAULT '', policy_json TEXT NOT NULL, updated_at TEXT NOT NULL,\n PRIMARY KEY(workspace_id,scope)\n);\nCREATE TABLE IF NOT EXISTS task_reminder_settings (\n task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,\n settings_json TEXT NOT NULL, updated_at TEXT NOT NULL\n);\nCREATE TABLE IF NOT EXISTS task_reminder_responses (\n task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,\n user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n acknowledged_at TEXT, snoozed_until TEXT, snooze_sent_at TEXT,\n PRIMARY KEY(task_id,user_id)\n);\nCREATE TABLE IF NOT EXISTS reminder_email_outbox (\n notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,\n status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','skipped')),\n attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,\n sent_at TEXT, last_error TEXT\n);\nCREATE TABLE IF NOT EXISTS reminder_notice_context (\n notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,\n due_at TEXT, audience TEXT NOT NULL DEFAULT 'assignees', condition TEXT NOT NULL DEFAULT 'incomplete'\n);\nCREATE INDEX IF NOT EXISTS reminder_email_due ON reminder_email_outbox(status,next_attempt_at);\nCREATE TRIGGER IF NOT EXISTS reminder_email_enqueue AFTER INSERT ON notifications\nWHEN NEW.type IN ('task_reminder','service_renewal')\nBEGIN\n INSERT INTO reminder_email_outbox(notification_id,next_attempt_at) VALUES(NEW.id,NEW.created_at);\n INSERT INTO reminder_notice_context(notification_id,due_at) VALUES(NEW.id,\n CASE WHEN NEW.type='service_renewal' THEN (SELECT next_date FROM service_contracts WHERE id=NEW.entity_id)\n ELSE (SELECT due_at FROM tasks WHERE id=NEW.task_id) END);\nEND;\nCREATE TRIGGER IF NOT EXISTS reminder_response_reset AFTER UPDATE OF due_at,assignee_id,team_id ON tasks\nWHEN OLD.due_at IS NOT NEW.due_at OR OLD.assignee_id IS NOT NEW.assignee_id OR OLD.team_id IS NOT NEW.team_id\nBEGIN\n DELETE FROM task_reminder_responses WHERE task_id=NEW.id;\n DELETE FROM task_reminder_deliveries WHERE task_id=NEW.id AND schedule_key LIKE 'workflow:%';\n UPDATE reminder_email_outbox SET status='skipped' WHERE status='pending' AND notification_id IN\n (SELECT id FROM notifications WHERE task_id=NEW.id AND type='task_reminder');\n UPDATE notification_outbox SET status='skipped' WHERE status='pending' AND notification_id IN\n (SELECT id FROM notifications WHERE task_id=NEW.id AND type='task_reminder');\nEND;\nCREATE TRIGGER IF NOT EXISTS reminder_extra_response_reset AFTER DELETE ON task_assignees\nBEGIN\n DELETE FROM task_reminder_responses WHERE task_id=OLD.task_id AND user_id=OLD.user_id;\nEND;\n";
const APPEARANCE_SCHEMA = "\n  CREATE TABLE IF NOT EXISTS team_appearance (\n    team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,\n    preferences TEXT NOT NULL,\n    editable_fields TEXT NOT NULL\n  );\n  CREATE TABLE IF NOT EXISTS user_appearance (\n    workspace_id TEXT NOT NULL,\n    user_id TEXT NOT NULL,\n    scope TEXT NOT NULL DEFAULT '',\n    team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,\n    preferences TEXT NOT NULL,\n    PRIMARY KEY (workspace_id, user_id, scope),\n    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE,\n    CHECK (scope = COALESCE(team_id, ''))\n  );\n  CREATE INDEX IF NOT EXISTS user_appearance_team_idx ON user_appearance(team_id);\n";
const EXTRAS_SCHEMA = "\n  CREATE TABLE IF NOT EXISTS task_assignees (\n    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    position REAL NOT NULL DEFAULT 0,\n    created_at TEXT NOT NULL,\n    PRIMARY KEY (task_id, user_id)\n  );\n\n  CREATE INDEX IF NOT EXISTS task_assignees_user_idx\n    ON task_assignees(user_id, task_id, position);\n\n  CREATE TABLE IF NOT EXISTS task_labels (\n    id TEXT PRIMARY KEY,\n    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),\n    color TEXT NOT NULL CHECK (length(color) BETWEEN 1 AND 40),\n    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\n  CREATE UNIQUE INDEX IF NOT EXISTS task_labels_workspace_name_idx\n    ON task_labels(workspace_id, name COLLATE NOCASE);\n\n  CREATE TABLE IF NOT EXISTS task_label_links (\n    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,\n    label_id TEXT NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,\n    created_at TEXT NOT NULL,\n    PRIMARY KEY (task_id, label_id)\n  );\n\n  CREATE INDEX IF NOT EXISTS task_label_links_label_idx\n    ON task_label_links(label_id, task_id);\n\n  CREATE TABLE IF NOT EXISTS task_templates (\n    id TEXT PRIMARY KEY,\n    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n    team_id TEXT,\n    source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,\n    kind TEXT NOT NULL CHECK (kind IN ('task', 'checklist')),\n    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),\n    payload_json TEXT NOT NULL,\n    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL,\n    FOREIGN KEY (team_id, workspace_id)\n      REFERENCES teams(id, workspace_id) ON DELETE CASCADE\n  );\n\n  CREATE INDEX IF NOT EXISTS task_templates_scope_idx\n    ON task_templates(workspace_id, team_id, kind, created_at DESC, id);\n\n  ALTER TABLE task_checklists ADD COLUMN position REAL NOT NULL DEFAULT 0;\n  ALTER TABLE task_checklist_items ADD COLUMN position REAL NOT NULL DEFAULT 0;\n\n  CREATE INDEX IF NOT EXISTS task_checklists_task_position_idx\n    ON task_checklists(task_id, position, created_at, id);\n  CREATE INDEX IF NOT EXISTS task_checklist_items_position_idx\n    ON task_checklist_items(checklist_id, position, created_at, id);\n";
const GOOGLE_SCHEMA = "CREATE TABLE google_identities(sub TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL);CREATE TABLE google_oauth_states(state_hash TEXT PRIMARY KEY,nonce TEXT NOT NULL,verifier TEXT NOT NULL,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);";
const EVENTS_SCHEMA = "CREATE TABLE calendar_events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,remind_at TEXT,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE calendar_event_notices(event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,schedule_key TEXT NOT NULL,PRIMARY KEY(event_id,user_id,schedule_key));";
const COLLABORATION_SCHEMA = "\nCREATE TABLE task_watchers (\n task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,\n user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n created_at TEXT NOT NULL, PRIMARY KEY(task_id,user_id)\n);\nCREATE TABLE comment_reactions (\n comment_id TEXT NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,\n user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n emoji TEXT NOT NULL CHECK(emoji IN ('👍','❤️','🎉','👀')),\n PRIMARY KEY(comment_id,user_id,emoji)\n);\nCREATE TABLE comment_mentions (\n comment_id TEXT NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,\n user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n PRIMARY KEY(comment_id,user_id)\n);\nALTER TABLE task_comments ADD COLUMN edited_at TEXT;\n";
const SERVICES_SCHEMA = "\nCREATE TABLE service_contracts (\n id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n team_id TEXT REFERENCES teams(id) ON DELETE SET NULL, customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,\n name TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', contract_number TEXT NOT NULL DEFAULT '',\n amount INTEGER NOT NULL DEFAULT 0 CHECK(amount>=0), next_date TEXT NOT NULL,\n cycle TEXT NOT NULL CHECK(cycle IN ('month','year')), interval_count INTEGER NOT NULL DEFAULT 1,\n remind_days INTEGER NOT NULL DEFAULT 7, assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,\n note TEXT NOT NULL DEFAULT '', archived_at TEXT, created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL\n);\nCREATE INDEX service_contracts_due ON service_contracts(workspace_id,next_date,archived_at);\nCREATE TABLE service_renewals (\n id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,\n previous_date TEXT NOT NULL,next_date TEXT NOT NULL,amount INTEGER NOT NULL,note TEXT NOT NULL DEFAULT '',\n actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL\n);\nCREATE TABLE service_reminders(service_id TEXT NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,schedule_key TEXT NOT NULL,PRIMARY KEY(service_id,user_id,schedule_key));\nCREATE TABLE customer_interactions(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,type TEXT NOT NULL,note TEXT NOT NULL,happened_at TEXT NOT NULL,created_by TEXT REFERENCES users(id) ON DELETE SET NULL);\n";
const AUTOMATION_SCHEMA = "\nCREATE TABLE automation_rules(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,name TEXT NOT NULL,trigger TEXT NOT NULL,condition_status TEXT,actions TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);\nCREATE TABLE automation_runs(id TEXT PRIMARY KEY,rule_id TEXT REFERENCES automation_rules(id) ON DELETE SET NULL,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,rule_name TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL);\nCREATE INDEX automation_runs_workspace ON automation_runs(workspace_id,created_at);\n";
const MOBILE_SCHEMA = "\nCREATE TABLE IF NOT EXISTS mobile_devices (\n  installation_id TEXT PRIMARY KEY,\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,\n  fcm_token TEXT NOT NULL,\n  platform TEXT NOT NULL DEFAULT 'android',\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS mobile_devices_user_idx\n  ON mobile_devices(user_id, created_at, installation_id);\nCREATE INDEX IF NOT EXISTS mobile_devices_session_idx\n  ON mobile_devices(session_id, user_id);\nCREATE UNIQUE INDEX IF NOT EXISTS mobile_devices_token_idx\n  ON mobile_devices(fcm_token);\n\nCREATE TABLE IF NOT EXISTS notification_outbox (\n  id TEXT PRIMARY KEY,\n  notification_id TEXT NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,\n  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  channel TEXT NOT NULL DEFAULT 'fcm' CHECK (channel IN ('fcm')),\n  payload_json TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),\n  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),\n  next_attempt_at TEXT NOT NULL,\n  last_error TEXT,\n  sent_at TEXT,\n  created_at TEXT NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS notification_outbox_due_idx\n  ON notification_outbox(status, next_attempt_at, created_at, id);\nCREATE INDEX IF NOT EXISTS notification_outbox_user_idx\n  ON notification_outbox(user_id, workspace_id, created_at);\n\n\nCREATE TABLE IF NOT EXISTS notification_outbox_deliveries (\n  outbox_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,\n  installation_id TEXT NOT NULL REFERENCES mobile_devices(installation_id) ON DELETE CASCADE,\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),\n  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),\n  next_attempt_at TEXT NOT NULL,\n  last_error TEXT,\n  sent_at TEXT,\n  created_at TEXT NOT NULL,\n  PRIMARY KEY (outbox_id, installation_id)\n);\n\nCREATE INDEX IF NOT EXISTS notification_outbox_deliveries_due_idx\n  ON notification_outbox_deliveries(status, next_attempt_at, created_at, outbox_id);\nCREATE INDEX IF NOT EXISTS notification_outbox_deliveries_installation_idx\n  ON notification_outbox_deliveries(installation_id, status, outbox_id);\n\n\nCREATE TRIGGER IF NOT EXISTS notifications_mobile_outbox_ai\nAFTER INSERT ON notifications\nWHEN NEW.type IN ('task_reminder', 'task_update', 'calendar_event')\nBEGIN\n  INSERT OR IGNORE INTO notification_outbox\n    (id, notification_id, workspace_id, user_id, channel, payload_json,\n     status, attempts, next_attempt_at, created_at)\n  VALUES (\n    'outbox_' || NEW.id,\n    NEW.id,\n    NEW.workspace_id,\n    NEW.user_id,\n    'fcm',\n    json_object(\n      'notificationId', NEW.id,\n      'workspaceId', NEW.workspace_id,\n      'userId', NEW.user_id,\n      'type', NEW.type,\n      'title', NEW.title,\n      'message', NEW.message,\n      'taskId', NEW.task_id,\n      'entityType', NEW.entity_type,\n      'entityId', NEW.entity_id\n    ),\n    'pending',\n    0,\n    NEW.created_at,\n    NEW.created_at\n  );\nEND;\n";
const MOBILE_DELIVERY_SCHEMA = "\nCREATE TABLE IF NOT EXISTS notification_outbox_deliveries (\n  outbox_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,\n  installation_id TEXT NOT NULL REFERENCES mobile_devices(installation_id) ON DELETE CASCADE,\n  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),\n  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),\n  next_attempt_at TEXT NOT NULL,\n  last_error TEXT,\n  sent_at TEXT,\n  created_at TEXT NOT NULL,\n  PRIMARY KEY (outbox_id, installation_id)\n);\n\nCREATE INDEX IF NOT EXISTS notification_outbox_deliveries_due_idx\n  ON notification_outbox_deliveries(status, next_attempt_at, created_at, outbox_id);\nCREATE INDEX IF NOT EXISTS notification_outbox_deliveries_installation_idx\n  ON notification_outbox_deliveries(installation_id, status, outbox_id);\n";
const SERVICE_MOBILE_SCHEMA = "DROP TRIGGER IF EXISTS notifications_mobile_outbox_ai;\nCREATE TRIGGER IF NOT EXISTS notifications_mobile_outbox_ai\nAFTER INSERT ON notifications\nWHEN NEW.type IN ('task_reminder', 'task_update', 'calendar_event', 'service_renewal')\nBEGIN\n  INSERT OR IGNORE INTO notification_outbox\n    (id, notification_id, workspace_id, user_id, channel, payload_json,\n     status, attempts, next_attempt_at, created_at)\n  VALUES (\n    'outbox_' || NEW.id,\n    NEW.id,\n    NEW.workspace_id,\n    NEW.user_id,\n    'fcm',\n    json_object(\n      'notificationId', NEW.id,\n      'workspaceId', NEW.workspace_id,\n      'userId', NEW.user_id,\n      'type', NEW.type,\n      'title', NEW.title,\n      'message', NEW.message,\n      'taskId', NEW.task_id,\n      'entityType', NEW.entity_type,\n      'entityId', NEW.entity_id\n    ),\n    'pending',\n    0,\n    NEW.created_at,\n    NEW.created_at\n  );\nEND;\n";
const PASSWORD_RESET_SCHEMA = "\nCREATE TABLE IF NOT EXISTS password_reset_codes (\n  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,\n  email TEXT NOT NULL,\n  code_hash TEXT NOT NULL,\n  expires_at INTEGER NOT NULL,\n  attempts INTEGER NOT NULL DEFAULT 0,\n  created_at INTEGER NOT NULL\n);\nCREATE TABLE IF NOT EXISTS auth_request_limits (\n  bucket TEXT PRIMARY KEY,\n  expires_at INTEGER NOT NULL,\n  count INTEGER NOT NULL\n);\nCREATE INDEX IF NOT EXISTS auth_request_limits_expiry_idx ON auth_request_limits(expires_at);\n";
const AI_ASSISTANT_SCHEMA = "\n  CREATE TABLE IF NOT EXISTS ai_conversations (\n    id TEXT PRIMARY KEY,\n    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,\n    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n    title TEXT NOT NULL,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n  CREATE INDEX IF NOT EXISTS ai_conversations_owner_idx ON ai_conversations(workspace_id, user_id, updated_at);\n  CREATE TABLE IF NOT EXISTS ai_messages (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,\n    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),\n    content TEXT NOT NULL,\n    metadata TEXT NOT NULL DEFAULT '{}',\n    created_at TEXT NOT NULL\n  );\n  CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages(conversation_id, id);\n";
const SERVICE_RENEWAL_SCHEMA = "\nALTER TABLE service_contracts ADD COLUMN license_type TEXT NOT NULL DEFAULT 'subscription'\n  CHECK (license_type IN ('subscription', 'perpetual', 'trial', 'support', 'domain', 'other'));\nALTER TABLE service_contracts ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1\n  CHECK (quantity BETWEEN 1 AND 1000000);\nALTER TABLE service_contracts ADD COLUMN unit_price INTEGER\n  CHECK (unit_price IS NULL OR unit_price >= 0);\nALTER TABLE service_contracts ADD COLUMN actual_paid INTEGER\n  CHECK (actual_paid IS NULL OR actual_paid >= 0);\nALTER TABLE service_contracts ADD COLUMN purchase_date TEXT;\nALTER TABLE service_contracts ADD COLUMN account_hint TEXT;\nALTER TABLE service_contracts ADD COLUMN payment_account TEXT;\nALTER TABLE service_contracts ADD COLUMN payment_method TEXT;\nALTER TABLE service_contracts ADD COLUMN portal_url TEXT;\nALTER TABLE service_contracts ADD COLUMN provider_contact TEXT;\nALTER TABLE service_contracts ADD COLUMN invoice_type TEXT\n  CHECK (invoice_type IS NULL OR invoice_type IN ('bill', 'invoice'));\nALTER TABLE service_contracts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1\n  CHECK (enabled IN (0, 1));\nALTER TABLE service_contracts ADD COLUMN sync_calendar INTEGER NOT NULL DEFAULT 0\n  CHECK (sync_calendar IN (0, 1));\nALTER TABLE service_contracts ADD COLUMN last_renewed_at TEXT;\n\nUPDATE service_contracts\nSET unit_price = amount\nWHERE unit_price IS NULL;\n\nALTER TABLE notifications ADD COLUMN service_id TEXT\n  REFERENCES service_contracts(id) ON DELETE CASCADE;\nCREATE INDEX IF NOT EXISTS notifications_service_idx\n  ON notifications(service_id, created_at);\nCREATE INDEX IF NOT EXISTS service_contracts_reminder_idx\n  ON service_contracts(workspace_id, enabled, next_date, archived_at);\n";
import { mkdirSync, readFileSync } from "node:fs";
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
  { version: 21, sql: PASSWORD_RESET_SCHEMA },
  {
    version: 22,
    sql: "ALTER TABLE calendar_events ADD COLUMN status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'doing', 'done'));",
  },
  {
    version: 23,
    sql: `
      ALTER TABLE task_checklist_items ADD COLUMN start_at TEXT;
      ALTER TABLE task_checklist_items ADD COLUMN due_at TEXT;
      ALTER TABLE task_checklist_items ADD COLUMN remind_at TEXT;
      CREATE TABLE IF NOT EXISTS task_checklist_assignees (
        item_id TEXT NOT NULL REFERENCES task_checklist_items(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (item_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS task_checklist_assignees_user_idx
        ON task_checklist_assignees(user_id, item_id);
    `,
  },
  { version: 24, sql: AI_ASSISTANT_SCHEMA },
  { version: 25, sql: APPEARANCE_SCHEMA },
  {
    version: 26,
    // Replace the fixed plan allowlist, preserving every subscription and quote.
    // The migration runner wraps the copy/swap and its marker in one transaction.
    sql: `
      CREATE TABLE subscriptions_v26 (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        plan TEXT NOT NULL CHECK (length(plan) BETWEEN 1 AND 20),
        cycle TEXT NOT NULL CHECK (cycle IN ('monthly', 'yearly')),
        status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'expired', 'canceled')),
        current_period_end TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO subscriptions_v26 SELECT * FROM subscriptions;
      DROP TABLE subscriptions;
      ALTER TABLE subscriptions_v26 RENAME TO subscriptions;
      CREATE TABLE billing_orders_v26 (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        plan TEXT NOT NULL CHECK (length(plan) BETWEEN 1 AND 20),
        cycle TEXT NOT NULL CHECK (cycle IN ('monthly', 'yearly')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'VND',
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'expired')),
        provider_payment_id TEXT,
        created_at TEXT NOT NULL,
        paid_at TEXT,
        checkout_url TEXT
      );
      INSERT INTO billing_orders_v26 SELECT * FROM billing_orders;
      DROP TABLE billing_orders;
      ALTER TABLE billing_orders_v26 RENAME TO billing_orders;
      CREATE INDEX billing_orders_workspace_idx ON billing_orders(workspace_id, created_at);
      CREATE UNIQUE INDEX billing_orders_provider_payment_idx
        ON billing_orders(provider_payment_id) WHERE provider_payment_id IS NOT NULL;
    `,
  },
  { version: 27, sql: REMINDER_WORKFLOW_SCHEMA },
  { version: 28, sql: SERVICE_MOBILE_SCHEMA },
  { version: 29, sql: PERSONAL_TASKS_SCHEMA },
  { version: 30, sql: '' },
  { version: 31, sql: WEB_PUSH_SCHEMA },
  { version: 32, sql: '' },
  { version: 33, sql: '' },
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
    // FK actions must be disabled outside the transaction for a parent rebuild.
    const taskSchema = [29, 30].includes(migration.version) ? db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='tasks'").get().sql : '';
    const rebuildTasks = migration.version === 29 && db.prepare('PRAGMA table_info(tasks)').all().some(c => c.name === 'due_at' && c.notnull)
      || migration.version === 30 && !taskSchema.includes("'yearly'");
    if (rebuildTasks) db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;');
    try {
      db.exec("BEGIN IMMEDIATE");
      if (rebuildTasks) {
        const objects = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='tasks' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
        const schema = migration.version === 29
          ? taskSchema.replace(/due_at\s+TEXT\s+NOT NULL/i, 'due_at TEXT')
          : taskSchema.replace(/('none',\s*'daily',\s*'weekly',\s*'monthly')/, "$1, 'yearly'");
        db.exec(schema.replace(/CREATE TABLE\s+"?tasks"?/i, 'CREATE TABLE tasks_rebuilt'));
        db.exec('INSERT INTO tasks_rebuilt SELECT * FROM tasks; DROP TABLE tasks; ALTER TABLE tasks_rebuilt RENAME TO tasks;');
        for (const object of objects) db.exec(object.sql);
        if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Task migration failed foreign key validation');
      }
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
      if (migration.version === 33) {
        // Mirrors PostgreSQL migration 018: how each session signed in.
        if (!db.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'auth_method'))
          db.exec("ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password' CHECK(auth_method IN ('password', 'google', 'dev'))");
      } else if (migration.version === 32) {
        if (!db.prepare('PRAGMA table_info(reminder_notice_context)').all().some(c => c.name === 'schedule_key'))
          db.exec(readFileSync(new URL('./migrations/postgres/002-reminder-source.sql', import.meta.url), 'utf8'));
      } else if (migration.version === 30) {
        // Check columns individually: legacy fixture/restore upgrades may replay
        // migration markers while retaining already-added columns.
        for (const [table, column, definition] of [
          ['tasks', 'recurrence_options', "TEXT NOT NULL DEFAULT '{}'"],
          ['tasks', 'recurrence_anchor', 'TEXT'],
          ['personal_task_plans', 'start_time', 'TEXT'],
          ['personal_task_plans', 'duration_minutes', 'INTEGER NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 15 AND 1440)'],
        ]) {
          if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column))
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
        db.exec("UPDATE tasks SET recurrence_anchor=due_at WHERE recurrence<>'none' AND recurrence_anchor IS NULL");
      } else if (migration.version === 22) {
        if (!db.prepare("PRAGMA table_info(calendar_events)").all().some((column) => column.name === "status"))
          db.exec(migration.sql);
      } else if (migration.version === 23) {
        const names = new Set(db.prepare("PRAGMA table_info(task_checklist_items)").all().map((column) => column.name));
        for (const column of ["start_at", "due_at", "remind_at"]) {
          if (!names.has(column)) db.exec(`ALTER TABLE task_checklist_items ADD COLUMN ${column} TEXT`);
        }
        db.exec(`
          CREATE TABLE IF NOT EXISTS task_checklist_assignees (
            item_id TEXT NOT NULL REFERENCES task_checklist_items(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (item_id, user_id)
          );
          CREATE INDEX IF NOT EXISTS task_checklist_assignees_user_idx
            ON task_checklist_assignees(user_id, item_id);
        `);
      } else if (migration.version === 19) {
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
    } finally {
      if (rebuildTasks) db.exec('PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;');
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
