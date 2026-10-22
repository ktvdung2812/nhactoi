-- Personal workspaces belong to exactly one user, are free, and are permanent.
-- Existing workspaces stay team workspaces.
ALTER TABLE workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'team' CHECK (kind IN ('personal', 'team'));
ALTER TABLE workspaces ADD COLUMN personal_owner_id TEXT UNIQUE REFERENCES users(id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_personal_owner_check CHECK ((kind = 'personal') = (personal_owner_id IS NOT NULL));

-- Row triggers do not fire on TRUNCATE, so restoring a backup still works.
CREATE OR REPLACE FUNCTION nhactoi_protect_personal_workspace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind = 'personal' THEN RAISE EXCEPTION 'personal workspace cannot be deleted' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.personal_owner_id IS DISTINCT FROM OLD.personal_owner_id THEN
    RAISE EXCEPTION 'workspace kind cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspaces_personal_protect ON workspaces;
CREATE TRIGGER workspaces_personal_protect BEFORE DELETE OR UPDATE OF kind, personal_owner_id ON workspaces
  FOR EACH ROW EXECUTE FUNCTION nhactoi_protect_personal_workspace();

CREATE OR REPLACE FUNCTION nhactoi_personal_workspace_members() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id TEXT;
BEGIN
  SELECT personal_owner_id INTO owner_id FROM workspaces WHERE id = NEW.workspace_id AND kind = 'personal';
  IF owner_id IS NULL THEN RETURN NEW; END IF;
  -- invitations has no user_id, so the field is only read for memberships.
  IF TG_TABLE_NAME = 'invitations' THEN
    RAISE EXCEPTION 'personal workspace cannot have other members' USING ERRCODE = '23514';
  END IF;
  IF NEW.user_id <> owner_id THEN
    RAISE EXCEPTION 'personal workspace cannot have other members' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_members_personal_only ON workspace_members;
CREATE TRIGGER workspace_members_personal_only BEFORE INSERT OR UPDATE OF workspace_id, user_id ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION nhactoi_personal_workspace_members();
DROP TRIGGER IF EXISTS invitations_personal_none ON invitations;
CREATE TRIGGER invitations_personal_none BEFORE INSERT ON invitations
  FOR EACH ROW EXECUTE FUNCTION nhactoi_personal_workspace_members();
