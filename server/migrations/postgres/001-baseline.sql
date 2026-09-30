-- PostgreSQL baseline, equivalent to SQLite schema version 31.
-- ISO timestamps and integer flags preserve the existing API contract.

CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      , is_platform_admin BIGINT NOT NULL DEFAULT 0, disabled_at TEXT);

CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        industry TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      , suspended_at TEXT, contact_email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', tax_code TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');

CREATE TABLE workspace_members (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      );

CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      , kind TEXT NOT NULL DEFAULT 'web' CHECK(kind IN ('web', 'mobile')));

CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        name TEXT NOT NULL,
        company TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        service TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

CREATE TABLE transactions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        amount BIGINT NOT NULL CHECK (amount > 0),
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        created_by TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );

CREATE TABLE invitations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        invited_by TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
        created_at TEXT NOT NULL
      );

CREATE TABLE billing_webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        order_id TEXT,
        received_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

CREATE TABLE admin_audit_logs (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        created_at TEXT NOT NULL
      );

CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted BIGINT NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1)),
        updated_at TEXT NOT NULL
      );

CREATE TABLE tickets (
        id TEXT PRIMARY KEY,
        number BIGINT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
        category TEXT NOT NULL CHECK (category IN ('billing', 'account', 'technical', 'other')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE ticket_messages (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
        is_staff BIGINT NOT NULL CHECK (is_staff IN (0, 1)),
        created_at TEXT NOT NULL
      ,
 insertion_order BIGINT GENERATED BY DEFAULT AS IDENTITY
);

CREATE TABLE ticket_events (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        type TEXT NOT NULL CHECK (type IN ('created', 'status_changed', 'priority_changed')),
        from_value TEXT,
        to_value TEXT,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        created_at TEXT NOT NULL
      ,
 insertion_order BIGINT GENERATED BY DEFAULT AS IDENTITY
);

CREATE TABLE ticket_sequence (
        id BIGINT PRIMARY KEY CHECK (id = 1),
        next_number BIGINT NOT NULL CHECK (next_number > 0)
      );

CREATE TABLE teams (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
        color TEXT NOT NULL CHECK (color IN ('green', 'blue', 'purple', 'orange', 'rose', 'slate')),
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(id, workspace_id)
      );

CREATE TABLE team_members (
        team_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        role TEXT NOT NULL CHECK (role IN ('lead', 'member')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (team_id, user_id),
        FOREIGN KEY (team_id, workspace_id)
          REFERENCES teams(id, workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        FOREIGN KEY (workspace_id, user_id)
          REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
      ,
 insertion_order BIGINT GENERATED BY DEFAULT AS IDENTITY
);

CREATE TABLE trash_items (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'customer', 'transaction')),
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        deleted_at TEXT NOT NULL,
        UNIQUE(workspace_id, entity_type, entity_id)
      );

CREATE TABLE task_file_cleanup (
        id TEXT PRIMARY KEY,
        storage_root TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts BIGINT NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT NOT NULL
      );

CREATE TABLE board_columns (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        team_id TEXT,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
        tone TEXT NOT NULL DEFAULT 'blue' CHECK (length(tone) BETWEEN 1 AND 40),
        position DOUBLE PRECISION NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (team_id, workspace_id)
          REFERENCES teams(id, workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
      );

CREATE TABLE board_preferences (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        -- Empty string represents the common board because SQLite NULLs do
        -- not participate in PRIMARY KEY uniqueness.
        team_id TEXT NOT NULL DEFAULT '',
        collapsed_ids TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, user_id, team_id)
      );

CREATE TABLE service_contracts (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 team_id TEXT REFERENCES teams(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE, customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
 name TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '', contract_number TEXT NOT NULL DEFAULT '',
 amount BIGINT NOT NULL DEFAULT 0 CHECK(amount>=0), next_date TEXT NOT NULL,
 cycle TEXT NOT NULL CHECK(cycle IN ('month','year')), interval_count BIGINT NOT NULL DEFAULT 1,
 remind_days BIGINT NOT NULL DEFAULT 7, assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
 note TEXT NOT NULL DEFAULT '', archived_at TEXT, created_by TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
, license_type TEXT NOT NULL DEFAULT 'subscription'
  CHECK (license_type IN ('subscription', 'perpetual', 'trial', 'support', 'domain', 'other')), quantity BIGINT NOT NULL DEFAULT 1
  CHECK (quantity BETWEEN 1 AND 1000000), unit_price BIGINT
  CHECK (unit_price IS NULL OR unit_price >= 0), actual_paid BIGINT
  CHECK (actual_paid IS NULL OR actual_paid >= 0), purchase_date TEXT, account_hint TEXT, payment_account TEXT, payment_method TEXT, portal_url TEXT, provider_contact TEXT, invoice_type TEXT
  CHECK (invoice_type IS NULL OR invoice_type IN ('bill', 'invoice')), enabled BIGINT NOT NULL DEFAULT 1
  CHECK (enabled IN (0, 1)), sync_calendar BIGINT NOT NULL DEFAULT 0
  CHECK (sync_calendar IN (0, 1)), last_renewed_at TEXT);

CREATE TABLE service_renewals (
 id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 previous_date TEXT NOT NULL,next_date TEXT NOT NULL,amount BIGINT NOT NULL,note TEXT NOT NULL DEFAULT '',
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,created_at TEXT NOT NULL
);

CREATE TABLE service_reminders(service_id TEXT NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,schedule_key TEXT NOT NULL,PRIMARY KEY(service_id,user_id,schedule_key));

CREATE TABLE customer_interactions(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,type TEXT NOT NULL,note TEXT NOT NULL,happened_at TEXT NOT NULL,created_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE);

CREATE TABLE automation_rules(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,team_id TEXT REFERENCES teams(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,name TEXT NOT NULL,trigger TEXT NOT NULL,condition_status TEXT,actions TEXT NOT NULL,enabled BIGINT NOT NULL DEFAULT 1,created_by TEXT REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,created_at TEXT NOT NULL);

CREATE TABLE task_labels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    color TEXT NOT NULL CHECK (length(color) BETWEEN 1 AND 40),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE calendar_events(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,team_id TEXT REFERENCES teams(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,remind_at TEXT,created_by TEXT REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'doing', 'done')));

CREATE TABLE calendar_event_notices(event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,schedule_key TEXT NOT NULL,PRIMARY KEY(event_id,user_id,schedule_key));

CREATE TABLE google_identities(sub TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,created_at TEXT NOT NULL);

CREATE TABLE google_oauth_states(state_hash TEXT PRIMARY KEY,nonce TEXT NOT NULL,verifier TEXT NOT NULL,user_id TEXT REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,expires_at TEXT NOT NULL);

CREATE TABLE mobile_devices (
  installation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  fcm_token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE password_reset_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE auth_request_limits (
  bucket TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL,
  count BIGINT NOT NULL
);

CREATE TABLE ai_conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE ai_messages (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

CREATE TABLE team_appearance (
    team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    preferences TEXT NOT NULL,
    editable_fields TEXT NOT NULL
  );

CREATE TABLE user_appearance (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    team_id TEXT REFERENCES teams(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    preferences TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id, scope),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    CHECK (scope = COALESCE(team_id, ''))
  );

CREATE TABLE "subscriptions" (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        plan TEXT NOT NULL CHECK (length(plan) BETWEEN 1 AND 20),
        cycle TEXT NOT NULL CHECK (cycle IN ('monthly', 'yearly')),
        status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'expired', 'canceled')),
        current_period_end TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE "billing_orders" (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        plan TEXT NOT NULL CHECK (length(plan) BETWEEN 1 AND 20),
        cycle TEXT NOT NULL CHECK (cycle IN ('monthly', 'yearly')),
        amount BIGINT NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'VND',
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'expired')),
        provider_payment_id TEXT,
        created_at TEXT NOT NULL,
        paid_at TEXT,
        checkout_url TEXT
      );

CREATE TABLE reminder_policies (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 scope TEXT NOT NULL DEFAULT '', policy_json TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,scope)
);

CREATE TABLE "tasks" (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
        priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_at TEXT,
        remind_at TEXT,
        assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        category TEXT NOT NULL DEFAULT '',
        recurrence TEXT NOT NULL CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
        generated_from_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        created_by TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      , team_id TEXT REFERENCES teams(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE, column_id TEXT
        REFERENCES board_columns(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE, board_position DOUBLE PRECISION NOT NULL DEFAULT 0, recurrence_options TEXT NOT NULL DEFAULT '{}', recurrence_anchor TEXT);

CREATE TABLE web_push_subscriptions (
 id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT NOT NULL
      , entity_type TEXT, entity_id TEXT, service_id TEXT
  REFERENCES service_contracts(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE);

CREATE TABLE task_reminder_deliveries (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        schedule_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(task_id, user_id, schedule_key)
      );

CREATE TABLE task_checklists (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , position DOUBLE PRECISION NOT NULL DEFAULT 0);

CREATE TABLE task_checklist_items (
        id TEXT PRIMARY KEY,
        checklist_id TEXT NOT NULL REFERENCES task_checklists(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
        completed BIGINT NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , position DOUBLE PRECISION NOT NULL DEFAULT 0, start_at TEXT, due_at TEXT, remind_at TEXT);

CREATE TABLE task_activity (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
        summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
        created_at TEXT NOT NULL
      ,
 insertion_order BIGINT GENERATED BY DEFAULT AS IDENTITY
);

CREATE TABLE "task_comments" (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        body TEXT NOT NULL CHECK (length(body) BETWEEN 0 AND 5000),
        created_at TEXT NOT NULL
      , edited_at TEXT);

CREATE TABLE task_watchers (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 created_at TEXT NOT NULL, PRIMARY KEY(task_id,user_id)
);

CREATE TABLE comment_reactions (
 comment_id TEXT NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 emoji TEXT NOT NULL CHECK(emoji IN ('👍','❤️','🎉','👀')),
 PRIMARY KEY(comment_id,user_id,emoji)
);

CREATE TABLE comment_mentions (
 comment_id TEXT NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 PRIMARY KEY(comment_id,user_id)
);

CREATE TABLE automation_runs(id TEXT PRIMARY KEY,rule_id TEXT REFERENCES automation_rules(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,rule_name TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL);

CREATE TABLE task_assignees (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    position DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, user_id)
  );

CREATE TABLE task_label_links (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    label_id TEXT NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, label_id)
  );

CREATE TABLE task_templates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    team_id TEXT,
    source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
    kind TEXT NOT NULL CHECK (kind IN ('task', 'checklist')),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    payload_json TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (team_id, workspace_id)
      REFERENCES teams(id, workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
  );

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  channel TEXT NOT NULL DEFAULT 'fcm' CHECK (channel IN ('fcm')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE notification_outbox_deliveries (
  outbox_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  installation_id TEXT NOT NULL REFERENCES mobile_devices(installation_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (outbox_id, installation_id)
);

CREATE TABLE task_checklist_assignees (
            item_id TEXT NOT NULL REFERENCES task_checklist_items(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
            PRIMARY KEY (item_id, user_id)
          );

CREATE TABLE task_reminder_settings (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 settings_json TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE task_reminder_responses (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 acknowledged_at TEXT, snoozed_until TEXT, snooze_sent_at TEXT,
 PRIMARY KEY(task_id,user_id)
);

CREATE TABLE reminder_email_outbox (
 notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','skipped')),
 attempts BIGINT NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
 sent_at TEXT, last_error TEXT
);

CREATE TABLE reminder_notice_context (
 notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 due_at TEXT, audience TEXT NOT NULL DEFAULT 'assignees', condition TEXT NOT NULL DEFAULT 'incomplete'
);

CREATE TABLE personal_task_plans (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
    planned_date TEXT NOT NULL, start_time TEXT, duration_minutes BIGINT NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 15 AND 1440),
    PRIMARY KEY (task_id, user_id)
  );

CREATE TABLE web_push_deliveries (
 notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped','failed')),
 attempts BIGINT NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, sent_at TEXT, last_error TEXT,
 PRIMARY KEY(notification_id,subscription_id)
);

CREATE TABLE task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
        url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2000),
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
        created_at TEXT NOT NULL
      , kind TEXT NOT NULL DEFAULT 'link'
        CHECK (kind IN ('link', 'file')), original_name TEXT, mime_type TEXT, size_bytes BIGINT, storage_root TEXT, storage_key TEXT, comment_id TEXT
        REFERENCES task_comments(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE);

CREATE INDEX workspace_members_user_idx
        ON workspace_members(user_id, workspace_id);

CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE INDEX customers_workspace_idx
        ON customers(workspace_id, deleted_at, created_at);

CREATE INDEX transactions_workspace_idx
        ON transactions(workspace_id, date, deleted_at);

CREATE INDEX notifications_user_idx
        ON notifications(user_id, read_at, created_at);

CREATE INDEX invitations_workspace_idx
        ON invitations(workspace_id, email, accepted_at);

CREATE INDEX users_platform_admin_idx
        ON users(is_platform_admin, disabled_at);

CREATE INDEX users_disabled_idx
        ON users(disabled_at);

CREATE INDEX workspaces_suspended_idx
        ON workspaces(suspended_at);

CREATE INDEX admin_audit_logs_created_idx
        ON admin_audit_logs(created_at DESC);

CREATE INDEX admin_audit_logs_target_idx
        ON admin_audit_logs(target_type, target_id, created_at DESC);

CREATE INDEX admin_audit_logs_actor_idx
        ON admin_audit_logs(actor_user_id, created_at DESC);

CREATE INDEX tickets_requester_workspace_idx
        ON tickets(requester_user_id, workspace_id, updated_at DESC);

CREATE INDEX tickets_workspace_status_idx
        ON tickets(workspace_id, status, category, updated_at DESC);

CREATE INDEX tickets_updated_idx
        ON tickets(updated_at DESC, number DESC);

CREATE INDEX ticket_messages_ticket_idx
        ON ticket_messages(ticket_id, created_at, id);

CREATE INDEX ticket_events_ticket_idx
        ON ticket_events(ticket_id, created_at, id);

CREATE INDEX teams_workspace_idx
        ON teams(workspace_id, archived_at, created_at DESC);

CREATE INDEX team_members_workspace_user_idx
        ON team_members(workspace_id, user_id, team_id);

CREATE INDEX team_members_team_role_idx
        ON team_members(team_id, role, user_id);

CREATE INDEX trash_items_workspace_deleted_idx
        ON trash_items(workspace_id, deleted_at DESC, id DESC);

CREATE INDEX trash_items_workspace_type_idx
        ON trash_items(workspace_id, entity_type, deleted_at DESC);

CREATE INDEX trash_items_deleted_by_idx
        ON trash_items(workspace_id, deleted_by, entity_type, deleted_at DESC);

CREATE INDEX task_checklists_task_idx
        ON task_checklists(task_id, created_at, id);

CREATE INDEX task_checklist_items_checklist_idx
        ON task_checklist_items(checklist_id, created_at, id);

CREATE INDEX task_attachments_task_idx
        ON task_attachments(task_id, created_at, id);

CREATE INDEX task_activity_task_idx
        ON task_activity(task_id, created_at, id);

CREATE INDEX task_attachments_kind_idx
        ON task_attachments(task_id, kind, created_at, id);

CREATE INDEX task_file_cleanup_due_idx
        ON task_file_cleanup(next_attempt_at, created_at, id);

CREATE INDEX task_comments_task_idx
        ON task_comments(task_id, created_at, id);

CREATE INDEX task_attachments_comment_idx
        ON task_attachments(comment_id, created_at, id);

CREATE INDEX board_columns_workspace_board_idx
        ON board_columns(workspace_id, team_id, archived_at, position, id);

CREATE INDEX board_columns_team_idx
        ON board_columns(team_id, workspace_id, archived_at, position, id);

CREATE INDEX board_preferences_user_idx
        ON board_preferences(workspace_id, user_id, team_id);

CREATE INDEX service_contracts_due ON service_contracts(workspace_id,next_date,archived_at);

CREATE INDEX automation_runs_workspace ON automation_runs(workspace_id,created_at);

CREATE INDEX task_assignees_user_idx
    ON task_assignees(user_id, task_id, position);

CREATE UNIQUE INDEX task_labels_workspace_name_idx
    ON task_labels(workspace_id, lower(name));

CREATE INDEX task_label_links_label_idx
    ON task_label_links(label_id, task_id);

CREATE INDEX task_templates_scope_idx
    ON task_templates(workspace_id, team_id, kind, created_at DESC, id);

CREATE INDEX task_checklists_task_position_idx
    ON task_checklists(task_id, position, created_at, id);

CREATE INDEX task_checklist_items_position_idx
    ON task_checklist_items(checklist_id, position, created_at, id);

CREATE INDEX mobile_devices_user_idx
  ON mobile_devices(user_id, created_at, installation_id);

CREATE INDEX mobile_devices_session_idx
  ON mobile_devices(session_id, user_id);

CREATE UNIQUE INDEX mobile_devices_token_idx
  ON mobile_devices(fcm_token);

CREATE INDEX notification_outbox_due_idx
  ON notification_outbox(status, next_attempt_at, created_at, id);

CREATE INDEX notification_outbox_user_idx
  ON notification_outbox(user_id, workspace_id, created_at);

CREATE INDEX notification_outbox_deliveries_due_idx
  ON notification_outbox_deliveries(status, next_attempt_at, created_at, outbox_id);

CREATE INDEX notification_outbox_deliveries_installation_idx
  ON notification_outbox_deliveries(installation_id, status, outbox_id);

CREATE INDEX notifications_service_idx
  ON notifications(service_id, created_at);

CREATE INDEX service_contracts_reminder_idx
  ON service_contracts(workspace_id, enabled, next_date, archived_at);

CREATE INDEX auth_request_limits_expiry_idx ON auth_request_limits(expires_at);

CREATE INDEX task_checklist_assignees_user_idx
            ON task_checklist_assignees(user_id, item_id);

CREATE INDEX ai_conversations_owner_idx ON ai_conversations(workspace_id, user_id, updated_at);

CREATE INDEX ai_messages_conversation_idx ON ai_messages(conversation_id, id);

CREATE INDEX user_appearance_team_idx ON user_appearance(team_id);

CREATE INDEX billing_orders_workspace_idx ON billing_orders(workspace_id, created_at);

CREATE UNIQUE INDEX billing_orders_provider_payment_idx
        ON billing_orders(provider_payment_id) WHERE provider_payment_id IS NOT NULL;

CREATE INDEX reminder_email_due ON reminder_email_outbox(status,next_attempt_at);

CREATE INDEX personal_task_plans_user_idx ON personal_task_plans(user_id, planned_date);

CREATE INDEX tasks_workspace_idx
        ON tasks(workspace_id, deleted_at, due_at);

CREATE INDEX tasks_reminder_idx
        ON tasks(workspace_id, remind_at, deleted_at);

CREATE UNIQUE INDEX tasks_generated_once_idx
        ON tasks(generated_from_task_id) WHERE generated_from_task_id IS NOT NULL;

CREATE INDEX tasks_team_idx
        ON tasks(workspace_id, team_id, deleted_at, due_at);

CREATE INDEX tasks_board_idx
        ON tasks(workspace_id, column_id, deleted_at, board_position, id);

CREATE INDEX web_push_user_idx ON web_push_subscriptions(user_id);

CREATE INDEX web_push_due_idx ON web_push_deliveries(status,next_attempt_at);

CREATE FUNCTION reminder_email_enqueue_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
INSERT INTO reminder_email_outbox(notification_id,next_attempt_at) VALUES(NEW.id,NEW.created_at);
 INSERT INTO reminder_notice_context(notification_id,due_at) VALUES(NEW.id,
 CASE WHEN NEW.type='service_renewal' THEN (SELECT next_date FROM service_contracts WHERE id=NEW.entity_id)
 ELSE (SELECT due_at FROM tasks WHERE id=NEW.task_id) END);
RETURN NULL;
END;
$$;
CREATE TRIGGER reminder_email_enqueue AFTER INSERT ON notifications
FOR EACH ROW WHEN (NEW.type IN ('task_reminder','service_renewal')) EXECUTE FUNCTION reminder_email_enqueue_fn();

CREATE FUNCTION reminder_extra_response_reset_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
DELETE FROM task_reminder_responses WHERE task_id=OLD.task_id AND user_id=OLD.user_id;
RETURN NULL;
END;
$$;
CREATE TRIGGER reminder_extra_response_reset AFTER DELETE ON task_assignees
FOR EACH ROW EXECUTE FUNCTION reminder_extra_response_reset_fn();

CREATE FUNCTION notifications_mobile_outbox_ai_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
INSERT INTO notification_outbox
    (id, notification_id, workspace_id, user_id, channel, payload_json,
     status, attempts, next_attempt_at, created_at)
  VALUES (
    'outbox_' || NEW.id,
    NEW.id,
    NEW.workspace_id,
    NEW.user_id,
    'fcm',
    json_build_object(
      'notificationId', NEW.id,
      'workspaceId', NEW.workspace_id,
      'userId', NEW.user_id,
      'type', NEW.type,
      'title', NEW.title,
      'message', NEW.message,
      'taskId', NEW.task_id,
      'entityType', NEW.entity_type,
      'entityId', NEW.entity_id
    )::text,
    'pending',
    0,
    NEW.created_at,
    NEW.created_at
  ) ON CONFLICT DO NOTHING;
RETURN NULL;
END;
$$;
CREATE TRIGGER notifications_mobile_outbox_ai AFTER INSERT ON notifications
FOR EACH ROW WHEN (NEW.type IN ('task_reminder', 'task_update', 'calendar_event', 'service_renewal')) EXECUTE FUNCTION notifications_mobile_outbox_ai_fn();

CREATE FUNCTION reminder_response_reset_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
DELETE FROM task_reminder_responses WHERE task_id=NEW.id;
 DELETE FROM task_reminder_deliveries WHERE task_id=NEW.id AND schedule_key LIKE 'workflow:%';
 UPDATE reminder_email_outbox SET status='skipped' WHERE status='pending' AND notification_id IN
 (SELECT id FROM notifications WHERE task_id=NEW.id AND type='task_reminder');
 UPDATE notification_outbox SET status='skipped' WHERE status='pending' AND notification_id IN
 (SELECT id FROM notifications WHERE task_id=NEW.id AND type='task_reminder');
RETURN NULL;
END;
$$;
CREATE TRIGGER reminder_response_reset AFTER UPDATE OF due_at,assignee_id,team_id ON tasks
FOR EACH ROW WHEN (OLD.due_at IS DISTINCT FROM NEW.due_at OR OLD.assignee_id IS DISTINCT FROM NEW.assignee_id OR OLD.team_id IS DISTINCT FROM NEW.team_id) EXECUTE FUNCTION reminder_response_reset_fn();

CREATE FUNCTION notifications_web_push_ai_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
INSERT INTO web_push_deliveries(notification_id,subscription_id,next_attempt_at)
 SELECT NEW.id,id,NEW.created_at FROM web_push_subscriptions WHERE user_id=NEW.user_id;
RETURN NULL;
END;
$$;
CREATE TRIGGER notifications_web_push_ai AFTER INSERT ON notifications
FOR EACH ROW WHEN (NEW.type IN ('task_reminder','task_update','calendar_event','service_renewal')) EXECUTE FUNCTION notifications_web_push_ai_fn();

CREATE FUNCTION web_push_task_reset_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN
 (SELECT id FROM notifications WHERE task_id=NEW.id AND type='task_reminder');
RETURN NULL;
END;
$$;
CREATE TRIGGER web_push_task_reset AFTER UPDATE OF due_at,assignee_id,team_id ON tasks
FOR EACH ROW WHEN (OLD.due_at IS DISTINCT FROM NEW.due_at OR OLD.assignee_id IS DISTINCT FROM NEW.assignee_id OR OLD.team_id IS DISTINCT FROM NEW.team_id) EXECUTE FUNCTION web_push_task_reset_fn();

CREATE FUNCTION web_push_event_reset_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN
 (SELECT id FROM notifications WHERE entity_id=NEW.id AND type='calendar_event');
RETURN NULL;
END;
$$;
CREATE TRIGGER web_push_event_reset AFTER UPDATE OF starts_at,ends_at,remind_at,team_id ON calendar_events
FOR EACH ROW WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at OR OLD.ends_at IS DISTINCT FROM NEW.ends_at OR OLD.remind_at IS DISTINCT FROM NEW.remind_at OR OLD.team_id IS DISTINCT FROM NEW.team_id) EXECUTE FUNCTION web_push_event_reset_fn();

CREATE FUNCTION web_push_snooze_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
UPDATE web_push_deliveries SET status='skipped' WHERE status='pending' AND notification_id IN
 (SELECT id FROM notifications WHERE task_id=NEW.task_id AND user_id=NEW.user_id AND type='task_reminder');
RETURN NULL;
END;
$$;
CREATE TRIGGER web_push_snooze AFTER UPDATE OF snoozed_until ON task_reminder_responses
FOR EACH ROW WHEN (NEW.snoozed_until IS NOT NULL AND OLD.snoozed_until IS DISTINCT FROM NEW.snoozed_until) EXECUTE FUNCTION web_push_snooze_fn();

INSERT INTO ticket_sequence(id,next_number) VALUES (1,1);

CREATE FUNCTION unicode_fold(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT lower(translate(regexp_replace(normalize(coalesce(value, ''), NFD), '[̀-ͯ]', '', 'g'), 'đĐ', 'dd'));
$$;
