ALTER TABLE tasks ADD COLUMN imported_at TEXT;

-- Keep source tombstones even when a destination is deleted: reimport never
-- silently recreates a card the user deliberately removed.
CREATE TABLE import_sources (
 workspace_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 source_board TEXT NOT NULL CHECK(length(source_board) BETWEEN 1 AND 160),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('card','list','label')),
 source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 160),
 destination_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,project_id,source_board,source_kind,source_id),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);

CREATE FUNCTION clear_import_reminder_boundary() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF coalesce(mutation_context()->>'source','unknown') NOT IN ('import','migration')
  AND (NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.remind_at IS DISTINCT FROM OLD.remind_at) THEN
  NEW.imported_at := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tasks_import_boundary BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION clear_import_reminder_boundary();
