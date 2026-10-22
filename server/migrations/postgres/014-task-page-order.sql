-- Keep the active task list's exact ordering in a narrow index. Deep pages
-- otherwise sort all visible task keys on every request.
CREATE INDEX tasks_active_page_order ON tasks (
  workspace_id,
  (CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END),
  due_at ASC, created_at DESC, id DESC
) INCLUDE (project_id, team_id, status) WHERE deleted_at IS NULL;
