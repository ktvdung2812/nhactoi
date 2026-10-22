// Columns in the PostgreSQL baseline, also the allowlist for logical backups/imports.
export const V2_TABLE_COLUMNS = {
  "admin_audit_logs": [
    "id",
    "actor_user_id",
    "action",
    "target_type",
    "target_id",
    "reason",
    "before_json",
    "after_json",
    "created_at"
  ],
  "ai_conversations": [
    "id",
    "workspace_id",
    "user_id",
    "title",
    "created_at",
    "updated_at"
  ],
  "ai_messages": [
    "id",
    "conversation_id",
    "role",
    "content",
    "metadata",
    "created_at"
  ],
  "app_settings": [
    "key",
    "value",
    "encrypted",
    "updated_at"
  ],
  "auth_request_limits": [
    "bucket",
    "expires_at",
    "count"
  ],
  "automation_rules": [
    "id",
    "workspace_id",
    "team_id",
    "name",
    "trigger",
    "condition_status",
    "actions",
    "enabled",
    "created_by",
    "created_at"
  ],
  "automation_runs": [
    "id",
    "rule_id",
    "workspace_id",
    "task_id",
    "rule_name",
    "status",
    "error",
    "created_at"
  ],
  "billing_orders": [
    "id",
    "workspace_id",
    "plan",
    "cycle",
    "amount",
    "currency",
    "status",
    "provider_payment_id",
    "created_at",
    "paid_at",
    "checkout_url"
  ],
  "billing_webhook_events": [
    "event_id",
    "event_type",
    "order_id",
    "received_at",
    "payload"
  ],
  "board_columns": [
    "id",
    "workspace_id",
    "team_id",
    "name",
    "status",
    "tone",
    "position",
    "archived_at",
    "created_at",
    "updated_at"
  ],
  "board_preferences": [
    "workspace_id",
    "user_id",
    "team_id",
    "collapsed_ids",
    "updated_at"
  ],
  "calendar_event_notices": [
    "event_id",
    "user_id",
    "schedule_key"
  ],
  "calendar_events": [
    "id",
    "workspace_id",
    "team_id",
    "title",
    "description",
    "starts_at",
    "ends_at",
    "remind_at",
    "created_by",
    "created_at",
    "updated_at",
    "status"
  ],
  "comment_mentions": [
    "comment_id",
    "user_id"
  ],
  "comment_reactions": [
    "comment_id",
    "user_id",
    "emoji"
  ],
  "customer_interactions": [
    "id",
    "customer_id",
    "workspace_id",
    "type",
    "note",
    "happened_at",
    "created_by"
  ],
  "customers": [
    "id",
    "workspace_id",
    "name",
    "company",
    "email",
    "phone",
    "service",
    "created_at",
    "updated_at",
    "deleted_at"
  ],
  "google_identities": [
    "sub",
    "user_id",
    "created_at"
  ],
  "google_oauth_states": [
    "state_hash",
    "nonce",
    "verifier",
    "user_id",
    "expires_at"
  ],
  "invitations": [
    "id",
    "workspace_id",
    "email",
    "role",
    "token_hash",
    "expires_at",
    "accepted_at",
    "invited_by",
    "created_at"
  ],
  "mobile_devices": [
    "installation_id",
    "user_id",
    "session_id",
    "fcm_token",
    "platform",
    "created_at",
    "updated_at"
  ],
  "notification_outbox": [
    "id",
    "notification_id",
    "workspace_id",
    "user_id",
    "channel",
    "payload_json",
    "status",
    "attempts",
    "next_attempt_at",
    "last_error",
    "sent_at",
    "created_at"
  ],
  "notification_outbox_deliveries": [
    "outbox_id",
    "installation_id",
    "status",
    "attempts",
    "next_attempt_at",
    "last_error",
    "sent_at",
    "created_at"
  ],
  "notifications": [
    "id",
    "workspace_id",
    "user_id",
    "task_id",
    "type",
    "title",
    "message",
    "read_at",
    "created_at",
    "entity_type",
    "entity_id",
    "service_id"
  ],
  "password_reset_codes": [
    "user_id",
    "email",
    "code_hash",
    "expires_at",
    "attempts",
    "created_at"
  ],
  "personal_task_plans": [
    "task_id",
    "user_id",
    "planned_date",
    "start_time",
    "duration_minutes"
  ],
  "reminder_email_outbox": [
    "notification_id",
    "status",
    "attempts",
    "next_attempt_at",
    "sent_at",
    "last_error"
  ],
  "reminder_notice_context": [
    "notification_id",
    "due_at",
    "audience",
    "condition",
    "schedule_key"
  ],
  "reminder_policies": [
    "workspace_id",
    "scope",
    "policy_json",
    "updated_at"
  ],
  "service_contracts": [
    "id",
    "workspace_id",
    "team_id",
    "customer_id",
    "name",
    "provider",
    "contract_number",
    "amount",
    "next_date",
    "cycle",
    "interval_count",
    "remind_days",
    "assignee_id",
    "note",
    "archived_at",
    "created_by",
    "created_at",
    "updated_at",
    "license_type",
    "quantity",
    "unit_price",
    "actual_paid",
    "purchase_date",
    "account_hint",
    "payment_account",
    "payment_method",
    "portal_url",
    "provider_contact",
    "invoice_type",
    "enabled",
    "sync_calendar",
    "last_renewed_at"
  ],
  "service_reminders": [
    "service_id",
    "user_id",
    "schedule_key"
  ],
  "service_renewals": [
    "id",
    "service_id",
    "previous_date",
    "next_date",
    "amount",
    "note",
    "actor_id",
    "created_at"
  ],
  "sessions": [
    "id",
    "token_hash",
    "user_id",
    "workspace_id",
    "expires_at",
    "created_at",
    "kind"
  ],
  "subscriptions": [
    "workspace_id",
    "plan",
    "cycle",
    "status",
    "current_period_end",
    "updated_at"
  ],
  "task_activity": [
    "id",
    "task_id",
    "actor_user_id",
    "action",
    "summary",
    "created_at",
    "insertion_order"
  ],
  "task_assignees": [
    "task_id",
    "user_id",
    "position",
    "created_at"
  ],
  "task_attachments": [
    "id",
    "task_id",
    "title",
    "url",
    "created_by",
    "created_at",
    "kind",
    "original_name",
    "mime_type",
    "size_bytes",
    "storage_root",
    "storage_key",
    "comment_id"
  ],
  "task_checklist_assignees": [
    "item_id",
    "user_id"
  ],
  "task_checklist_items": [
    "id",
    "checklist_id",
    "title",
    "completed",
    "created_at",
    "updated_at",
    "position",
    "start_at",
    "due_at",
    "remind_at"
  ],
  "task_checklists": [
    "id",
    "task_id",
    "title",
    "created_by",
    "created_at",
    "updated_at",
    "position"
  ],
  "task_comments": [
    "id",
    "task_id",
    "author_user_id",
    "body",
    "created_at",
    "edited_at"
  ],
  "task_file_cleanup": [
    "id",
    "storage_root",
    "storage_key",
    "created_at",
    "attempts",
    "last_error",
    "next_attempt_at"
  ],
  "task_label_links": [
    "task_id",
    "label_id",
    "created_at"
  ],
  "task_labels": [
    "id",
    "workspace_id",
    "name",
    "color",
    "created_by",
    "created_at",
    "updated_at"
  ],
  "task_reminder_deliveries": [
    "id",
    "task_id",
    "user_id",
    "schedule_key",
    "created_at"
  ],
  "task_reminder_responses": [
    "task_id",
    "user_id",
    "acknowledged_at",
    "snoozed_until",
    "snooze_sent_at"
  ],
  "task_reminder_settings": [
    "task_id",
    "settings_json",
    "updated_at"
  ],
  "task_templates": [
    "id",
    "workspace_id",
    "team_id",
    "source_task_id",
    "kind",
    "name",
    "payload_json",
    "created_by",
    "created_at",
    "updated_at"
  ],
  "task_watchers": [
    "task_id",
    "user_id",
    "created_at"
  ],
  "tasks": [
    "id",
    "workspace_id",
    "title",
    "description",
    "status",
    "priority",
    "due_at",
    "remind_at",
    "assignee_id",
    "customer_id",
    "category",
    "recurrence",
    "generated_from_task_id",
    "created_by",
    "created_at",
    "updated_at",
    "deleted_at",
    "team_id",
    "column_id",
    "board_position",
    "recurrence_options",
    "recurrence_anchor"
  ],
  "team_appearance": [
    "team_id",
    "preferences",
    "editable_fields"
  ],
  "team_members": [
    "team_id",
    "workspace_id",
    "user_id",
    "role",
    "created_at",
    "insertion_order"
  ],
  "teams": [
    "id",
    "workspace_id",
    "name",
    "description",
    "color",
    "archived_at",
    "created_at",
    "updated_at"
  ],
  "ticket_events": [
    "id",
    "ticket_id",
    "type",
    "from_value",
    "to_value",
    "actor_user_id",
    "created_at",
    "insertion_order"
  ],
  "ticket_messages": [
    "id",
    "ticket_id",
    "author_user_id",
    "body",
    "is_staff",
    "created_at",
    "insertion_order"
  ],
  "ticket_sequence": [
    "id",
    "next_number"
  ],
  "tickets": [
    "id",
    "number",
    "workspace_id",
    "requester_user_id",
    "subject",
    "category",
    "priority",
    "status",
    "created_at",
    "updated_at"
  ],
  "transactions": [
    "id",
    "workspace_id",
    "type",
    "amount",
    "title",
    "category",
    "date",
    "customer_id",
    "created_by",
    "created_at",
    "deleted_at"
  ],
  "trash_items": [
    "id",
    "workspace_id",
    "entity_type",
    "entity_id",
    "title",
    "deleted_by",
    "deleted_at"
  ],
  "user_appearance": [
    "workspace_id",
    "user_id",
    "scope",
    "team_id",
    "preferences"
  ],
  "users": [
    "id",
    "name",
    "email",
    "password_hash",
    "created_at",
    "is_platform_admin",
    "disabled_at"
  ],
  "web_push_deliveries": [
    "notification_id",
    "subscription_id",
    "status",
    "attempts",
    "next_attempt_at",
    "sent_at",
    "last_error"
  ],
  "web_push_subscriptions": [
    "id",
    "endpoint",
    "p256dh",
    "auth",
    "user_id",
    "session_id",
    "created_at",
    "updated_at"
  ],
  "workspace_members": [
    "workspace_id",
    "user_id",
    "role",
    "created_at"
  ],
  "workspaces": [
    "id",
    "name",
    "industry",
    "created_at",
    "suspended_at",
    "contact_email",
    "phone",
    "address",
    "website",
    "tax_code",
    "note"
  ]
};

export const V3_TABLE_COLUMNS = {
  ...V2_TABLE_COLUMNS,
  workspace_members: [...V2_TABLE_COLUMNS.workspace_members, 'member_type'],
  invitations: [...V2_TABLE_COLUMNS.invitations, 'member_type'],
  tasks: [...V2_TABLE_COLUMNS.tasks, 'project_id'],
  board_columns: [...V2_TABLE_COLUMNS.board_columns, 'project_id'],
  projects: ['id', 'workspace_id', 'name', 'description', 'access_mode', 'team_id', 'is_default', 'archived_at', 'created_by', 'created_at', 'updated_at'],
  project_members: ['project_id', 'workspace_id', 'user_id', 'role', 'created_at'],
};
export const V4_TABLE_COLUMNS = {
  ...V3_TABLE_COLUMNS,
  tasks: [...V3_TABLE_COLUMNS.tasks, 'aggregate_revision'],
  business_events: ['id', 'workspace_id', 'project_id', 'task_id', 'type', 'actor_user_id', 'source', 'operation_id', 'causation_id', 'occurred_at', 'before_json', 'after_json'],
  task_assignment_cycles: ['id', 'workspace_id', 'task_id', 'user_id', 'started_at', 'deadline_snapshot', 'acknowledged_at', 'closed_at', 'close_reason', 'history_known'],
  mutation_receipts: ['workspace_id', 'principal_id', 'operation_id', 'action', 'resource_id', 'payload_hash', 'response_status', 'response_json', 'committed_at'],
  personal_plan_revisions: ['task_id', 'user_id', 'revision'],
};
export const V5_TABLE_COLUMNS = {
  ...V4_TABLE_COLUMNS,
  delivery_leases: ['channel', 'notification_id', 'target_id', 'workspace_id', 'status', 'lease_token', 'lease_until', 'attempts', 'provider_reference', 'last_error', 'updated_at'],
};

export const V6_TABLE_COLUMNS = {
  ...V5_TABLE_COLUMNS,
  invitations: [...V5_TABLE_COLUMNS.invitations, 'project_id', 'project_role'],
  task_templates: [...V5_TABLE_COLUMNS.task_templates, 'project_id'],
  task_labels: [...V5_TABLE_COLUMNS.task_labels, 'project_id'],
  automation_rules: [...V5_TABLE_COLUMNS.automation_rules, 'project_id'],
};

export const V7_TABLE_COLUMNS = {
  ...V6_TABLE_COLUMNS,
  service_contracts: [...V5_TABLE_COLUMNS.service_contracts, 'reminder_time', 'reminder_mode', 'renewal_anchor'],
  service_renewals: [...V5_TABLE_COLUMNS.service_renewals, 'expense_id', 'task_id'],
  service_cycle_tasks: ['service_id', 'period_date', 'workspace_id', 'task_id'],
};

export const V8_TABLE_COLUMNS = {
  ...V7_TABLE_COLUMNS,
  tasks: [...V7_TABLE_COLUMNS.tasks, 'start_at'],
  project_fields: ['id','workspace_id','project_id','name','type','position','options_json','retired_at','created_at','updated_at'],
  task_field_values: ['task_id','field_id','workspace_id','project_id','value_json'],
  project_views: ['id','workspace_id','project_id','owner_id','name','visibility','config_json','created_at','updated_at'],
  task_dependencies: ['workspace_id','project_id','predecessor_id','successor_id','created_at'],
  project_templates: ['id','workspace_id','source_project_id','name','payload_json','created_by','created_at'],
};

export const V9_TABLE_COLUMNS = {
  ...V8_TABLE_COLUMNS,
  google_calendar_connections: ['id','workspace_id','user_id','account_id','calendar_id','status','enabled_json','generation','sync_token','sync_requested','sync_processed','channel_id','channel_token_hash','channel_resource','channel_expires_at','channel_sequence','lease_token','lease_until','last_success_at','last_error','next_attempt_at','created_at','updated_at'],
  google_calendar_states: ['state_hash','user_id','workspace_id','session_id','callback_uri','verifier','expires_at'],
  google_calendar_mappings: ['id','connection_id','workspace_id','kind','source_id','event_id','etag','base_revision','base_json','state','conflict_json','last_error','updated_at'],
  google_calendar_jobs: ['connection_id','kind','source_id','revision','attempts','next_attempt_at','last_error'],
};

export const V10_TABLE_COLUMNS = {
  ...V9_TABLE_COLUMNS,
  automation_event_queue: ['rule_id','event_id','task_id','created_at','processed_at'],
  work_calendars: ['workspace_id','user_scope','config_json','updated_at'],
  reminder_delegates: ['id','workspace_id','principal_id','delegate_id','starts_at','ends_at','created_at'],
  work_timers: ['id','workspace_id','task_id','user_id','started_at','closed_at','close_reason'],
  time_entries: ['id','workspace_id','task_id','user_id','started_at','ended_at','duration_seconds','source','timer_id','note','created_at','updated_at'],
  task_estimates: ['task_id','user_id','seconds','updated_at'],
  task_assignment_cycles: [...V9_TABLE_COLUMNS.task_assignment_cycles,'calendar_json'],
  automation_rules: [...V9_TABLE_COLUMNS.automation_rules,'conditions_json','schedule_json','activated_at'],
  automation_runs: [...V9_TABLE_COLUMNS.automation_runs,'trigger_key'],
};

export const V11_TABLE_COLUMNS = {
  ...V10_TABLE_COLUMNS,
  tasks: [...V10_TABLE_COLUMNS.tasks, 'imported_at'],
  import_sources: ['workspace_id','project_id','source_board','source_kind','source_id','destination_id','created_at'],
};

export const V12_TABLE_COLUMNS = {
  ...V11_TABLE_COLUMNS,
  zalo_oa_connections: ["id", "workspace_id", "oa_id", "authorized_by", "status", "contract_json", "generation", "created_at", "updated_at"],
  zalo_oa_templates: ["connection_id", "template_id", "version", "status", "purpose", "definition_json", "updated_at"],
  zalo_oa_recipients: ["id", "connection_id", "recipient_key", "user_id", "customer_id", "eligibility_json", "opted_out", "updated_at"],
  zalo_oa_deliveries: ["id", "connection_id", "workspace_id", "actor_id", "source_kind", "source_id", "cycle", "recipient_id", "purpose", "template_id", "generation", "payload_json", "source_json", "status", "attempts", "next_attempt_at", "lease_token", "lease_until", "provider_message_id", "last_error", "created_at", "updated_at"],
  zalo_oa_attempts: ["id", "delivery_id", "attempt", "status", "provider_reference", "error_code", "started_at", "finished_at"],
  zalo_oa_callbacks: ["connection_id", "event_id", "delivery_id", "status", "received_at"],
};

export const V14_TABLE_COLUMNS = {
  ...V12_TABLE_COLUMNS,
  business_events: [...V12_TABLE_COLUMNS.business_events, 'resource_revision'],
  api_tokens: ['id','workspace_id','created_by','name','token_hash','scopes_json','projects_json','created_at','last_used_at','revoked_at'],
  webhook_subscriptions: ['id','workspace_id','created_by','name','url','projects_json','events_json','active','key_version','created_at','updated_at'],
  webhook_deliveries: ['id','subscription_id','workspace_id','event_id','state','attempt_count','manual_retries','next_attempt_at','lease_token','lease_until','last_status','last_error','created_at','updated_at'],
  webhook_attempts: ['id','delivery_id','attempt_number','key_version','started_at','completed_at','status','outcome'],
};

export const V15_TABLE_COLUMNS = {
  ...V14_TABLE_COLUMNS,
  workspace_ai_settings: ['workspace_id','name','handle','enabled','updated_at'],
  task_comments: [...V14_TABLE_COLUMNS.task_comments,'author_type','author_name_snapshot','reply_to_comment_id','ai_run_id','ai_metadata'],
  ai_comment_runs: ['id','workspace_id','project_id','task_id','comment_id','requested_by','request_body','assistant_name','assistant_handle','status','error','reply_comment_id','state_json','sources_json','actions_json','attempts','lease_token','lease_until','created_at','updated_at'],
};

export const V16_TABLE_COLUMNS = {
  ...V15_TABLE_COLUMNS,
  workspaces: [...V15_TABLE_COLUMNS.workspaces, 'kind', 'personal_owner_id'],
};

export const TABLE_COLUMNS = {
  ...V16_TABLE_COLUMNS,
  email_change_requests: ['id','user_id','previous_email','new_email','code_hash','expires_at','attempts','created_at','consumed_at'],
};
