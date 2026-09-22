// Only call on disposable test databases when reconstructing a pre-roadmap schema.
export function removeRoadmapSchema(db){
 db.exec(`DROP TABLE IF EXISTS task_templates; DROP TABLE IF EXISTS task_label_links; DROP TABLE IF EXISTS task_labels; DROP TABLE IF EXISTS task_assignees;
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
