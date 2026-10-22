ALTER TABLE invitations ADD COLUMN project_id TEXT;
ALTER TABLE invitations ADD COLUMN project_role TEXT CHECK(project_role IN ('viewer','commenter','editor'));
ALTER TABLE invitations ADD CONSTRAINT invitations_project_scope FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE invitations ADD CONSTRAINT invitations_project_role CHECK((project_id IS NULL) = (project_role IS NULL));
ALTER TABLE task_templates ADD COLUMN project_id TEXT;
ALTER TABLE task_labels ADD COLUMN project_id TEXT;
ALTER TABLE automation_rules ADD COLUMN project_id TEXT;
UPDATE task_templates SET project_id=coalesce((SELECT project_id FROM tasks WHERE tasks.id=task_templates.source_task_id AND tasks.workspace_id=task_templates.workspace_id), CASE WHEN team_id IS NULL THEN 'prj_ws_'||workspace_id ELSE 'prj_team_'||team_id END);
UPDATE automation_rules SET project_id=CASE WHEN team_id IS NULL THEN 'prj_ws_'||workspace_id ELSE 'prj_team_'||team_id END;
UPDATE task_labels SET project_id='prj_ws_'||workspace_id;
DROP INDEX task_labels_workspace_name_idx;
-- Labels formerly shared across team boards become independent project labels;
-- retain the original ID in the common project and preserve every task link.
INSERT INTO task_labels(id,workspace_id,name,color,created_by,created_at,updated_at,project_id)
 SELECT DISTINCT l.id || ':' || t.project_id,l.workspace_id,l.name,l.color,l.created_by,l.created_at,l.updated_at,t.project_id
 FROM task_labels l JOIN task_label_links x ON x.label_id=l.id JOIN tasks t ON t.id=x.task_id
 WHERE t.project_id<>l.project_id;
ALTER TABLE task_label_links DISABLE TRIGGER task_labels_revision;
UPDATE task_label_links x SET label_id=x.label_id||':'||t.project_id
 FROM tasks t,task_labels l WHERE x.task_id=t.id AND x.label_id=l.id AND t.project_id<>l.project_id;
ALTER TABLE task_label_links ENABLE TRIGGER task_labels_revision;
CREATE UNIQUE INDEX task_labels_project_name_idx ON task_labels(workspace_id,project_id,lower(name));
ALTER TABLE task_templates ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE task_labels ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE automation_rules ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE task_templates ADD CONSTRAINT templates_project_scope FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE task_labels ADD CONSTRAINT labels_project_scope FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE automation_rules ADD CONSTRAINT rules_project_scope FOREIGN KEY(project_id,workspace_id) REFERENCES projects(id,workspace_id) DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX task_templates_project_idx ON task_templates(workspace_id,project_id);
CREATE INDEX task_labels_project_idx ON task_labels(workspace_id,project_id);
CREATE INDEX automation_rules_project_idx ON automation_rules(workspace_id,project_id);
CREATE FUNCTION collaboration_project_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected TEXT;
BEGIN
 IF NEW.project_id IS NULL THEN
  IF TG_OP='UPDATE' THEN NEW.project_id:=OLD.project_id;
  ELSIF TG_TABLE_NAME='task_templates' THEN
   IF NEW.source_task_id IS NOT NULL THEN SELECT project_id INTO NEW.project_id FROM tasks WHERE id=NEW.source_task_id AND workspace_id=NEW.workspace_id; END IF;
  END IF;
  NEW.project_id:=coalesce(NEW.project_id,CASE WHEN to_jsonb(NEW)->>'team_id' IS NULL THEN 'prj_ws_'||NEW.workspace_id ELSE 'prj_team_'||(to_jsonb(NEW)->>'team_id') END);
 END IF;
 IF TG_TABLE_NAME='task_templates' THEN
 IF NEW.source_task_id IS NOT NULL THEN
  SELECT project_id INTO expected FROM tasks WHERE id=NEW.source_task_id AND workspace_id=NEW.workspace_id;
  IF expected IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'Template source is outside project' USING ERRCODE='23514'; END IF;
 END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER templates_project_scope BEFORE INSERT OR UPDATE ON task_templates FOR EACH ROW EXECUTE FUNCTION collaboration_project_scope();
CREATE TRIGGER labels_project_scope BEFORE INSERT OR UPDATE ON task_labels FOR EACH ROW EXECUTE FUNCTION collaboration_project_scope();
CREATE TRIGGER rules_project_scope BEFORE INSERT OR UPDATE ON automation_rules FOR EACH ROW EXECUTE FUNCTION collaboration_project_scope();
CREATE FUNCTION task_label_project_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tasks t JOIN task_labels l ON l.project_id=t.project_id AND l.workspace_id=t.workspace_id WHERE t.id=NEW.task_id AND l.id=NEW.label_id)
 THEN RAISE EXCEPTION 'Label is outside project' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_label_project_scope BEFORE INSERT OR UPDATE ON task_label_links FOR EACH ROW EXECUTE FUNCTION task_label_project_scope();
