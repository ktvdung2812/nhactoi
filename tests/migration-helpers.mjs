// Only call on disposable test databases when reconstructing a pre-roadmap schema.
export function removeRoadmapSchema(db){
 db.exec(`DROP TRIGGER IF EXISTS notifications_web_push_ai; DROP TRIGGER IF EXISTS web_push_task_reset; DROP TRIGGER IF EXISTS web_push_snooze; DROP TRIGGER IF EXISTS web_push_event_reset;
 DROP TABLE IF EXISTS web_push_deliveries; DROP TABLE IF EXISTS web_push_subscriptions;
 DROP TRIGGER IF EXISTS reminder_response_reset; DROP TRIGGER IF EXISTS reminder_extra_response_reset; DROP TRIGGER IF EXISTS reminder_email_enqueue;
 DROP TABLE IF EXISTS reminder_notice_context; DROP TABLE IF EXISTS reminder_email_outbox; DROP TABLE IF EXISTS task_reminder_responses; DROP TABLE IF EXISTS task_reminder_settings; DROP TABLE IF EXISTS reminder_policies;
 DROP TABLE IF EXISTS task_templates; DROP TABLE IF EXISTS task_label_links; DROP TABLE IF EXISTS task_labels; DROP TABLE IF EXISTS task_assignees;
 DROP INDEX IF EXISTS task_checklists_task_position_idx; DROP INDEX IF EXISTS task_checklist_items_position_idx; ALTER TABLE task_checklists DROP COLUMN position; ALTER TABLE task_checklist_items DROP COLUMN position;
 DROP TABLE IF EXISTS google_oauth_states; DROP TABLE IF EXISTS google_identities;
 DROP TABLE IF EXISTS calendar_event_notices; DROP TABLE IF EXISTS calendar_events;
 DROP TABLE IF EXISTS automation_runs; DROP TABLE IF EXISTS automation_rules;
 DROP TABLE IF EXISTS service_reminders; DROP TABLE IF EXISTS service_renewals; DROP TABLE IF EXISTS service_contracts; DROP TABLE IF EXISTS customer_interactions;
 DROP TABLE IF EXISTS comment_mentions; DROP TABLE IF EXISTS comment_reactions; DROP TABLE IF EXISTS task_watchers;
 ALTER TABLE task_comments DROP COLUMN edited_at;
 DROP INDEX IF EXISTS tasks_board_idx;
 ALTER TABLE tasks DROP COLUMN column_id; ALTER TABLE tasks DROP COLUMN board_position;
 DROP TABLE IF EXISTS board_preferences; DROP TABLE IF EXISTS board_columns;
 DELETE FROM schema_migrations WHERE version>=11;`);
}

// Physically removes migrations 016 onward so older-schema fixtures can replay them.
export function removePersonalWorkspaceSchema(db){
 db.exec(`DROP TABLE IF EXISTS user_appearance_sync;
 ALTER TABLE user_appearance DROP CONSTRAINT user_appearance_pkey;
 ALTER TABLE user_appearance DROP COLUMN IF EXISTS platform;
 ALTER TABLE user_appearance ADD PRIMARY KEY (workspace_id, user_id, scope);
 ALTER TABLE service_contracts DROP CONSTRAINT service_contracts_license_type_check;
 ALTER TABLE service_contracts ADD CONSTRAINT service_contracts_license_type_check CHECK (license_type IN ('subscription', 'perpetual', 'trial', 'support', 'domain', 'other'));
 DROP TABLE IF EXISTS billing_profiles;
 DROP INDEX IF EXISTS billing_orders_reconcile_idx;
 ALTER TABLE billing_orders DROP CONSTRAINT billing_orders_status_check;
 ALTER TABLE billing_orders ADD CONSTRAINT billing_orders_status_check CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'expired'));
 ALTER TABLE billing_orders DROP COLUMN IF EXISTS payment_code, DROP COLUMN IF EXISTS subtotal_amount, DROP COLUMN IF EXISTS tax_rate, DROP COLUMN IF EXISTS tax_amount, DROP COLUMN IF EXISTS amount_paid, DROP COLUMN IF EXISTS last_checked_at;
 ALTER TABLE sessions DROP COLUMN IF EXISTS auth_method;
 DROP TABLE IF EXISTS email_change_requests;
 DROP TRIGGER IF EXISTS workspaces_personal_protect ON workspaces; DROP TRIGGER IF EXISTS workspace_members_personal_only ON workspace_members; DROP TRIGGER IF EXISTS invitations_personal_none ON invitations;
 DROP FUNCTION IF EXISTS nhactoi_protect_personal_workspace(); DROP FUNCTION IF EXISTS nhactoi_personal_workspace_members();
 ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_personal_owner_check, DROP COLUMN IF EXISTS personal_owner_id, DROP COLUMN IF EXISTS kind;`);
}
