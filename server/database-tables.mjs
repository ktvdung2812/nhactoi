// Columns in the PostgreSQL baseline, also the allowlist for logical backups/imports.
export const TABLE_COLUMNS = {
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
    "condition"
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
