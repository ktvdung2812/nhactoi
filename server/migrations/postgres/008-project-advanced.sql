ALTER TABLE tasks ADD COLUMN start_at TEXT;
ALTER TABLE tasks ADD CONSTRAINT tasks_timeline_order CHECK(start_at IS NULL OR due_at IS NULL OR start_at::timestamptz <= due_at::timestamptz);
ALTER TABLE tasks ADD CONSTRAINT tasks_project_identity UNIQUE(id,project_id,workspace_id);
CREATE TABLE project_fields (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
 name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN('text','number','date','single','multiple','checkbox')),
 position INTEGER NOT NULL DEFAULT 0, options_json TEXT NOT NULL DEFAULT '[]', retired_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,project_id,workspace_id),
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE task_field_values (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 field_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, value_json TEXT NOT NULL,
 PRIMARY KEY(task_id,field_id),
 FOREIGN KEY(task_id,project_id,workspace_id) REFERENCES tasks(id,project_id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(field_id,project_id,workspace_id) REFERENCES project_fields(id,project_id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX task_field_values_project_idx ON task_field_values(project_id,field_id);
CREATE TABLE project_views (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 name TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN('personal','project')),
 config_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE task_dependencies (
 workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
 predecessor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 successor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 created_at TEXT NOT NULL, PRIMARY KEY(predecessor_id,successor_id), CHECK(predecessor_id<>successor_id),
 FOREIGN KEY(predecessor_id,project_id,workspace_id) REFERENCES tasks(id,project_id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(successor_id,project_id,workspace_id) REFERENCES tasks(id,project_id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX task_dependencies_successor_idx ON task_dependencies(successor_id);
CREATE TABLE project_templates (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 source_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 name TEXT NOT NULL, payload_json TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE,
 created_at TEXT NOT NULL
);
CREATE FUNCTION project_dependency_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- A project row lock serializes graph changes across independent connections.
 PERFORM 1 FROM projects WHERE id=NEW.project_id AND workspace_id=NEW.workspace_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.predecessor_id AND project_id=NEW.project_id AND workspace_id=NEW.workspace_id)
 OR NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.successor_id AND project_id=NEW.project_id AND workspace_id=NEW.workspace_id)
 THEN RAISE EXCEPTION 'Dependency scope mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(WITH RECURSIVE reachable(id) AS (
   SELECT NEW.successor_id UNION SELECT d.successor_id FROM task_dependencies d JOIN reachable r ON d.predecessor_id=r.id WHERE d.project_id=NEW.project_id
 ) SELECT 1 FROM reachable WHERE id=NEW.predecessor_id)
 THEN RAISE EXCEPTION 'Dependency cycle' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dependency_guard BEFORE INSERT OR UPDATE ON task_dependencies FOR EACH ROW EXECUTE FUNCTION project_dependency_guard();
CREATE FUNCTION task_project_relations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.project_id IS DISTINCT FROM OLD.project_id AND (
 EXISTS(SELECT 1 FROM task_dependencies WHERE predecessor_id=OLD.id OR successor_id=OLD.id)
 OR EXISTS(SELECT 1 FROM task_field_values WHERE task_id=OLD.id))
 THEN RAISE EXCEPTION 'Resolve dependencies and custom fields before moving project' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_project_relations BEFORE UPDATE OF project_id ON tasks FOR EACH ROW EXECUTE FUNCTION task_project_relations_guard();
CREATE FUNCTION task_field_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=NEW.task_id AND project_id=NEW.project_id AND workspace_id=NEW.workspace_id)
 THEN RAISE EXCEPTION 'Custom field scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER field_value_scope BEFORE INSERT OR UPDATE ON task_field_values FOR EACH ROW EXECUTE FUNCTION task_field_scope_guard();
CREATE TRIGGER field_value_revision AFTER INSERT OR UPDATE OR DELETE ON task_field_values FOR EACH ROW EXECUTE FUNCTION task_child_revision();
