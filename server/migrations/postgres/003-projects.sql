-- Expand/backfill without changing task, column or child-resource identities.
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'member'
  CHECK (member_type IN ('member', 'guest'));
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'member'
  CHECK (member_type IN ('member', 'guest'));

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('workspace', 'team', 'private')),
  team_id TEXT,
  is_default BIGINT NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  archived_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, workspace_id),
  CHECK ((access_mode = 'team') = (team_id IS NOT NULL)),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_default_scope ON projects(workspace_id, coalesce(team_id, '')) WHERE is_default = 1;
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'manager')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id, user_id),
  FOREIGN KEY(project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  FOREIGN KEY(workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS project_members_user ON project_members(workspace_id, user_id, project_id);

INSERT INTO projects(id, workspace_id, name, access_mode, is_default, created_at, updated_at)
 SELECT 'prj_ws_' || id, id, 'Công việc chung', 'workspace', 1, created_at, created_at FROM workspaces
 ON CONFLICT DO NOTHING;
INSERT INTO projects(id, workspace_id, name, access_mode, team_id, is_default, archived_at, created_at, updated_at)
 SELECT 'prj_team_' || id, workspace_id, name, 'team', id, 1, archived_at, created_at, updated_at FROM teams
 ON CONFLICT DO NOTHING;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id TEXT;
ALTER TABLE board_columns ADD COLUMN IF NOT EXISTS project_id TEXT;
UPDATE tasks SET project_id = CASE WHEN team_id IS NULL THEN 'prj_ws_' || workspace_id ELSE 'prj_team_' || team_id END WHERE project_id IS NULL;
UPDATE board_columns SET project_id = CASE WHEN team_id IS NULL THEN 'prj_ws_' || workspace_id ELSE 'prj_team_' || team_id END WHERE project_id IS NULL;
ALTER TABLE tasks ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE board_columns ALTER COLUMN project_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_project_workspace_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_project_workspace_fk FOREIGN KEY(project_id, workspace_id) REFERENCES projects(id, workspace_id) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'board_columns'::regclass AND conname = 'board_columns_project_workspace_fk') THEN
    ALTER TABLE board_columns ADD CONSTRAINT board_columns_project_workspace_fk FOREIGN KEY(project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'board_columns'::regclass AND conname = 'board_columns_project_scope_unique') THEN
    ALTER TABLE board_columns ADD CONSTRAINT board_columns_project_scope_unique UNIQUE(id, project_id, workspace_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_column_project_fk') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_column_project_fk FOREIGN KEY(column_id, project_id, workspace_id) REFERENCES board_columns(id, project_id, workspace_id) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'workspace_members'::regclass AND conname = 'workspace_guest_role_check') THEN
    ALTER TABLE workspace_members ADD CONSTRAINT workspace_guest_role_check CHECK(member_type = 'member' OR role = 'member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'invitations'::regclass AND conname = 'invitation_guest_role_check') THEN
    ALTER TABLE invitations ADD CONSTRAINT invitation_guest_role_check CHECK(member_type = 'member' OR role = 'member');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS tasks_project_active ON tasks(workspace_id, project_id, deleted_at, status, due_at, id);
CREATE INDEX IF NOT EXISTS board_columns_project ON board_columns(workspace_id, project_id, position, id);

-- A project's board has the same identity as its project (one board/project).
-- Legacy inserts still resolve their old workspace/team scope atomically.
CREATE OR REPLACE FUNCTION nhactoi_default_project() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    INSERT INTO projects(id, workspace_id, name, access_mode, is_default, created_at, updated_at)
      VALUES ('prj_ws_' || NEW.id, NEW.id, 'Công việc chung', 'workspace', 1, NEW.created_at, NEW.created_at) ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO projects(id, workspace_id, name, access_mode, team_id, is_default, archived_at, created_at, updated_at)
      VALUES ('prj_team_' || NEW.id, NEW.workspace_id, NEW.name, 'team', NEW.id, 1, NEW.archived_at, NEW.created_at, NEW.updated_at) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS projects_workspace_default ON workspaces;
CREATE TRIGGER projects_workspace_default AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION nhactoi_default_project();
DROP TRIGGER IF EXISTS projects_team_default ON teams;
CREATE TRIGGER projects_team_default AFTER INSERT ON teams FOR EACH ROW EXECUTE FUNCTION nhactoi_default_project();

CREATE OR REPLACE FUNCTION nhactoi_task_project_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p projects%ROWTYPE;
BEGIN
  IF NEW.project_id IS NULL THEN
    IF TG_OP = 'UPDATE' THEN NEW.project_id := OLD.project_id;
    ELSE NEW.project_id := CASE WHEN NEW.team_id IS NULL THEN 'prj_ws_' || NEW.workspace_id ELSE 'prj_team_' || NEW.team_id END;
    END IF;
  END IF;
  SELECT * INTO p FROM projects WHERE id = NEW.project_id AND workspace_id = NEW.workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid project scope' USING ERRCODE = '23503'; END IF;
  IF NEW.team_id IS DISTINCT FROM p.team_id THEN RAISE EXCEPTION 'Project/team scope mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tasks_project_scope ON tasks;
CREATE TRIGGER tasks_project_scope BEFORE INSERT OR UPDATE OF project_id, team_id, workspace_id ON tasks FOR EACH ROW EXECUTE FUNCTION nhactoi_task_project_scope();
DROP TRIGGER IF EXISTS columns_project_scope ON board_columns;
CREATE TRIGGER columns_project_scope BEFORE INSERT OR UPDATE OF project_id, team_id, workspace_id ON board_columns FOR EACH ROW EXECUTE FUNCTION nhactoi_task_project_scope();

CREATE OR REPLACE FUNCTION nhactoi_project_guest_role() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.role = 'manager' AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.user_id AND member_type = 'guest')
    THEN RAISE EXCEPTION 'Guest cannot manage projects' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_guest_role ON project_members;
CREATE TRIGGER project_guest_role BEFORE INSERT OR UPDATE ON project_members FOR EACH ROW EXECUTE FUNCTION nhactoi_project_guest_role();

CREATE OR REPLACE FUNCTION nhactoi_workspace_guest_role() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.member_type = 'guest' AND EXISTS (SELECT 1 FROM project_members WHERE workspace_id = NEW.workspace_id AND user_id = NEW.user_id AND role = 'manager')
    THEN RAISE EXCEPTION 'Project manager cannot become guest before changing their project role' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_guest_role ON workspace_members;
CREATE TRIGGER workspace_guest_role BEFORE INSERT OR UPDATE ON workspace_members FOR EACH ROW EXECUTE FUNCTION nhactoi_workspace_guest_role();
