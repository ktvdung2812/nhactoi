ALTER TABLE tasks ADD COLUMN aggregate_revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE business_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  project_id TEXT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  type TEXT NOT NULL,
  actor_user_id TEXT,
  source TEXT NOT NULL,
  operation_id TEXT,
  causation_id TEXT,
  occurred_at TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL
);
CREATE INDEX business_events_task_time_idx ON business_events(workspace_id,task_id,occurred_at,id);

CREATE TABLE task_assignment_cycles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  started_at TEXT,
  deadline_snapshot TEXT,
  acknowledged_at TEXT,
  closed_at TEXT,
  close_reason TEXT,
  history_known INTEGER NOT NULL DEFAULT 1 CHECK(history_known IN(0,1))
);
CREATE UNIQUE INDEX task_assignment_cycles_open_idx ON task_assignment_cycles(task_id,user_id) WHERE closed_at IS NULL;
CREATE INDEX task_assignment_cycles_workspace_idx ON task_assignment_cycles(workspace_id,started_at);

CREATE TABLE mutation_receipts (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  principal_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  operation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT,
  payload_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL CHECK(response_status BETWEEN 200 AND 299),
  response_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,principal_id,operation_id)
);

CREATE FUNCTION mutation_context() RETURNS JSONB LANGUAGE SQL STABLE AS $$
  SELECT coalesce(nullif(current_setting('nhactoi.mutation_context',true),'')::jsonb,'{}'::jsonb)
$$;
CREATE FUNCTION mutation_timestamp() RETURNS TEXT LANGUAGE SQL STABLE AS $$
  SELECT coalesce(mutation_context()->>'occurredAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
$$;
CREATE FUNCTION append_task_event(task_row tasks,event_type TEXT,previous JSONB,current_value JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE context JSONB := mutation_context();
BEGIN
  INSERT INTO business_events(id,workspace_id,project_id,task_id,type,actor_user_id,source,operation_id,causation_id,occurred_at,before_json,after_json)
  VALUES('event_'||gen_random_uuid(),task_row.workspace_id,to_jsonb(task_row)->>'project_id',task_row.id,event_type,
    context->>'actorUserId',coalesce(context->>'source','unknown'),context->>'operationId',context->>'causationId',
    mutation_timestamp(),previous::text,current_value::text);
END $$;

CREATE FUNCTION bump_task_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'aggregate_revision') IS DISTINCT FROM (to_jsonb(OLD)-'aggregate_revision') THEN
    NEW.aggregate_revision := OLD.aggregate_revision+1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tasks_revision BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION bump_task_revision();

CREATE FUNCTION task_lifecycle_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE now_at TEXT := mutation_timestamp(); changed_deadline BOOLEAN; changed_assignment BOOLEAN; reopened BOOLEAN; person RECORD;
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM append_task_event(NEW,'task.created',NULL,to_jsonb(NEW));
    changed_deadline := FALSE; changed_assignment := TRUE; reopened := FALSE;
  ELSE
    changed_deadline := OLD.due_at IS DISTINCT FROM NEW.due_at;
    changed_assignment := OLD.assignee_id IS DISTINCT FROM NEW.assignee_id;
    reopened := OLD.status='done' AND NEW.status<>'done';
    IF changed_deadline THEN PERFORM append_task_event(NEW,'task.deadline_changed',to_jsonb(OLD),to_jsonb(NEW)); END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM append_task_event(NEW,CASE WHEN NEW.status='done' THEN 'task.completed' WHEN reopened THEN 'task.reopened' ELSE 'task.status_changed' END,to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      PERFORM append_task_event(NEW,CASE WHEN NEW.deleted_at IS NULL THEN 'task.restored' ELSE 'task.deleted' END,to_jsonb(OLD),to_jsonb(NEW));
    END IF;
    IF NEW.status='done' AND OLD.status<>'done' THEN
      UPDATE task_assignment_cycles SET closed_at=now_at,close_reason='completed' WHERE task_id=NEW.id AND closed_at IS NULL;
    END IF;
    IF changed_deadline OR reopened THEN
      UPDATE task_assignment_cycles SET closed_at=now_at,close_reason=CASE WHEN reopened THEN 'reopened' ELSE 'deadline_changed' END WHERE task_id=NEW.id AND closed_at IS NULL;
      DELETE FROM task_reminder_responses WHERE task_id=NEW.id;
    ELSIF changed_assignment AND OLD.assignee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM task_assignees WHERE task_id=NEW.id AND user_id=OLD.assignee_id) THEN
      UPDATE task_assignment_cycles SET closed_at=now_at,close_reason='unassigned' WHERE task_id=NEW.id AND user_id=OLD.assignee_id AND closed_at IS NULL;
      DELETE FROM task_reminder_responses WHERE task_id=NEW.id AND user_id=OLD.assignee_id;
      PERFORM append_task_event(NEW,'task.unassigned',jsonb_build_object('userId',OLD.assignee_id,'dueAt',OLD.due_at),jsonb_build_object('userId',OLD.assignee_id,'dueAt',NEW.due_at));
    END IF;
  END IF;
  IF changed_assignment OR changed_deadline OR reopened THEN
    FOR person IN SELECT NEW.assignee_id AS id WHERE NEW.assignee_id IS NOT NULL
      UNION SELECT user_id FROM task_assignees WHERE task_id=NEW.id
    LOOP
      IF NOT EXISTS(SELECT 1 FROM task_assignment_cycles WHERE task_id=NEW.id AND user_id=person.id AND closed_at IS NULL) AND NEW.status<>'done' THEN
        INSERT INTO task_assignment_cycles(id,workspace_id,task_id,user_id,started_at,deadline_snapshot)
          VALUES('cycle_'||gen_random_uuid(),NEW.workspace_id,NEW.id,person.id,now_at,NEW.due_at);
        DELETE FROM task_reminder_responses WHERE task_id=NEW.id AND user_id=person.id;
        PERFORM append_task_event(NEW,'task.assigned',NULL,jsonb_build_object('userId',person.id,'dueAt',NEW.due_at));
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tasks_events AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION task_lifecycle_event();

CREATE FUNCTION task_child_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE row_value JSONB; task_key TEXT;
BEGIN
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
  row_value := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME='task_checklist_items' THEN
    SELECT task_id INTO task_key FROM task_checklists WHERE id=row_value->>'checklist_id';
  ELSIF TG_TABLE_NAME='task_checklist_assignees' THEN
    SELECT c.task_id INTO task_key FROM task_checklist_items i JOIN task_checklists c ON c.id=i.checklist_id WHERE i.id=row_value->>'item_id';
  ELSE task_key := row_value->>'task_id'; END IF;
  UPDATE tasks SET aggregate_revision=aggregate_revision+1 WHERE id=task_key;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER checklists_task_revision AFTER INSERT OR UPDATE OR DELETE ON task_checklists FOR EACH ROW EXECUTE FUNCTION task_child_revision();
CREATE TRIGGER checklist_items_task_revision AFTER INSERT OR UPDATE OR DELETE ON task_checklist_items FOR EACH ROW EXECUTE FUNCTION task_child_revision();
CREATE TRIGGER checklist_assignees_task_revision AFTER INSERT OR UPDATE OR DELETE ON task_checklist_assignees FOR EACH ROW EXECUTE FUNCTION task_child_revision();
CREATE TRIGGER task_labels_revision AFTER INSERT OR UPDATE OR DELETE ON task_label_links FOR EACH ROW EXECUTE FUNCTION task_child_revision();
CREATE TRIGGER task_assignees_revision AFTER INSERT OR UPDATE OR DELETE ON task_assignees FOR EACH ROW EXECUTE FUNCTION task_child_revision();

CREATE FUNCTION task_assignment_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE task_row tasks; person TEXT; task_key TEXT; now_at TEXT := mutation_timestamp();
BEGIN
  person := CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  task_key := CASE WHEN TG_OP='DELETE' THEN OLD.task_id ELSE NEW.task_id END;
  SELECT * INTO task_row FROM tasks WHERE id=task_key;
  IF NOT FOUND OR task_row.assignee_id=person THEN RETURN COALESCE(NEW,OLD); END IF;
  IF TG_OP='DELETE' THEN
    UPDATE task_assignment_cycles SET closed_at=now_at,close_reason='unassigned' WHERE task_id=task_key AND user_id=person AND closed_at IS NULL;
    DELETE FROM task_reminder_responses WHERE task_id=task_key AND user_id=person;
    PERFORM append_task_event(task_row,'task.unassigned',jsonb_build_object('userId',person,'dueAt',task_row.due_at),jsonb_build_object('userId',person));
  ELSE
    IF task_row.status<>'done' THEN
      INSERT INTO task_assignment_cycles(id,workspace_id,task_id,user_id,started_at,deadline_snapshot)
        VALUES('cycle_'||gen_random_uuid(),task_row.workspace_id,task_key,person,now_at,task_row.due_at)
        ON CONFLICT(task_id,user_id) WHERE closed_at IS NULL DO NOTHING;
    END IF;
    DELETE FROM task_reminder_responses WHERE task_id=task_key AND user_id=person;
    PERFORM append_task_event(task_row,'task.assigned',NULL,jsonb_build_object('userId',person,'dueAt',task_row.due_at));
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER task_assignees_events AFTER INSERT OR DELETE ON task_assignees FOR EACH ROW EXECUTE FUNCTION task_assignment_event();

CREATE FUNCTION task_response_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE task_row tasks;
BEGIN
  SELECT * INTO task_row FROM tasks WHERE id=NEW.task_id;
  IF NEW.acknowledged_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.acknowledged_at IS DISTINCT FROM NEW.acknowledged_at) THEN
    UPDATE task_assignment_cycles SET acknowledged_at=NEW.acknowledged_at WHERE task_id=NEW.task_id AND user_id=NEW.user_id AND closed_at IS NULL;
    PERFORM append_task_event(task_row,'task.acknowledged',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW)||jsonb_build_object('dueAt',task_row.due_at));
  END IF;
  IF NEW.snoozed_until IS NOT NULL AND (TG_OP='INSERT' OR OLD.snoozed_until IS DISTINCT FROM NEW.snoozed_until) THEN
    PERFORM append_task_event(task_row,'task.snoozed',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW)||jsonb_build_object('dueAt',task_row.due_at));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_responses_events AFTER INSERT OR UPDATE ON task_reminder_responses FOR EACH ROW EXECUTE FUNCTION task_response_event();

-- Preserve the plan version even when its optional schedule is cleared.
CREATE TABLE personal_plan_revisions (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  revision BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY(task_id,user_id)
);
CREATE FUNCTION personal_plan_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS(SELECT 1 FROM tasks WHERE id=OLD.task_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)) THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
  INSERT INTO personal_plan_revisions(task_id,user_id,revision)
    VALUES(CASE WHEN TG_OP='DELETE' THEN OLD.task_id ELSE NEW.task_id END,CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END,1)
    ON CONFLICT(task_id,user_id) DO UPDATE SET revision=personal_plan_revisions.revision+1;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER personal_plan_revision AFTER INSERT OR UPDATE OR DELETE ON personal_task_plans FOR EACH ROW EXECUTE FUNCTION personal_plan_revision();
