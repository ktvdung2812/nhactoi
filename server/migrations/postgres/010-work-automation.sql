CREATE TABLE work_calendars (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 user_scope TEXT NOT NULL DEFAULT '', config_json TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,user_scope)
);
CREATE TABLE reminder_delegates (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 principal_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 delegate_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(principal_id<>delegate_id AND starts_at<ends_at)
);
CREATE INDEX reminder_delegates_active_idx ON reminder_delegates(workspace_id,principal_id,starts_at,ends_at);
ALTER TABLE task_assignment_cycles ADD COLUMN calendar_json TEXT;
CREATE FUNCTION snapshot_assignment_calendar() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 SELECT config_json INTO NEW.calendar_json FROM work_calendars WHERE workspace_id=NEW.workspace_id AND user_scope IN ('',NEW.user_id)
 ORDER BY (user_scope=NEW.user_id) DESC LIMIT 1;
 RETURN NEW;
END $$;
CREATE TRIGGER task_assignment_calendar BEFORE INSERT ON task_assignment_cycles FOR EACH ROW EXECUTE FUNCTION snapshot_assignment_calendar();
CREATE TABLE work_timers (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 started_at TEXT NOT NULL, closed_at TEXT, close_reason TEXT
);
CREATE UNIQUE INDEX work_timers_one_active ON work_timers(workspace_id,user_id) WHERE closed_at IS NULL;
CREATE TABLE time_entries (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 started_at TEXT NOT NULL, ended_at TEXT NOT NULL, duration_seconds BIGINT NOT NULL CHECK(duration_seconds>=0),
 source TEXT NOT NULL CHECK(source IN ('manual','timer')), timer_id TEXT UNIQUE REFERENCES work_timers(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
 note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(started_at<=ended_at)
);
CREATE INDEX time_entries_scope_idx ON time_entries(workspace_id,task_id,user_id,started_at);
CREATE TABLE task_estimates (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 seconds BIGINT NOT NULL CHECK(seconds>=0), updated_at TEXT NOT NULL,
 PRIMARY KEY(task_id,user_id)
);
-- Reassigning the primary owner carries a known estimate to the new assignee,
-- unless that person already has their own estimate. Collaborators keep theirs.
CREATE FUNCTION transfer_primary_estimate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.assignee_id IS NOT NULL AND OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
  AND NOT EXISTS(SELECT 1 FROM task_assignees WHERE task_id=NEW.id AND user_id=OLD.assignee_id) THEN
  INSERT INTO task_estimates(task_id,user_id,seconds,updated_at)
   SELECT NEW.id,NEW.assignee_id,seconds,mutation_timestamp() FROM task_estimates WHERE task_id=NEW.id AND user_id=OLD.assignee_id
   ON CONFLICT(task_id,user_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_estimate_reassign AFTER UPDATE OF assignee_id ON tasks FOR EACH ROW EXECUTE FUNCTION transfer_primary_estimate();
ALTER TABLE automation_rules ADD COLUMN conditions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE automation_rules ADD COLUMN schedule_json TEXT;
ALTER TABLE automation_rules ADD COLUMN activated_at TEXT;
UPDATE automation_rules SET activated_at=to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE automation_runs ADD COLUMN trigger_key TEXT;
CREATE UNIQUE INDEX automation_runs_trigger_key ON automation_runs(rule_id,task_id,trigger_key) WHERE trigger_key IS NOT NULL;

CREATE TABLE automation_event_queue (
 rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 event_id TEXT NOT NULL REFERENCES business_events(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 created_at TEXT NOT NULL, processed_at TEXT,
 PRIMARY KEY(rule_id,event_id)
);
CREATE INDEX automation_event_pending ON automation_event_queue(created_at) WHERE processed_at IS NULL;
CREATE FUNCTION enqueue_typed_automation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source NOT IN ('automation','import','migration') AND NEW.causation_id IS NULL THEN
  INSERT INTO automation_event_queue(rule_id,event_id,task_id,created_at)
   SELECT id,NEW.id,NEW.task_id,NEW.occurred_at FROM automation_rules
   WHERE workspace_id=NEW.workspace_id AND project_id=NEW.project_id AND enabled=1 AND trigger=NEW.type;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_event_enqueue AFTER INSERT ON business_events FOR EACH ROW EXECUTE FUNCTION enqueue_typed_automation();

-- ponytail: scan only active timers on ACL changes; add workspace targeting if large fleets make this measurable.
-- Close timers in the same transaction that removes access. No destructive
-- cleanup: entries and timer history survive soft deletion and permission loss.
CREATE FUNCTION close_invalid_work_timers() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE timer RECORD; at_time TEXT := mutation_timestamp(); plan_record JSONB; allowed BOOLEAN;
BEGIN
 FOR timer IN SELECT wt.*,t.deleted_at,t.project_id,t.team_id,p.access_mode,p.archived_at project_archived,
  w.suspended_at,u.disabled_at,wm.role,wm.member_type,pm.role project_role,tm.role team_role,team.archived_at team_archived,
  s.plan,s.status subscription_status,s.current_period_end
  FROM work_timers wt JOIN tasks t ON t.id=wt.task_id JOIN projects p ON p.id=t.project_id
  JOIN workspaces w ON w.id=wt.workspace_id JOIN users u ON u.id=wt.user_id
  LEFT JOIN workspace_members wm ON wm.workspace_id=wt.workspace_id AND wm.user_id=wt.user_id
  LEFT JOIN project_members pm ON pm.project_id=t.project_id AND pm.user_id=wt.user_id
  LEFT JOIN team_members tm ON tm.team_id=p.team_id AND tm.user_id=wt.user_id
  LEFT JOIN teams team ON team.id=p.team_id
  LEFT JOIN subscriptions s ON s.workspace_id=wt.workspace_id
  WHERE wt.closed_at IS NULL FOR UPDATE OF wt
 LOOP
  SELECT item INTO plan_record FROM app_settings setting,jsonb_array_elements(setting.value::jsonb) item
   WHERE setting.key='plans' AND item->>'id'=timer.plan LIMIT 1;
  allowed := timer.deleted_at IS NULL AND timer.project_archived IS NULL AND timer.team_archived IS NULL
   AND timer.suspended_at IS NULL AND timer.disabled_at IS NULL AND timer.role IS NOT NULL
   AND timer.subscription_status IN ('active','trialing') AND timer.current_period_end>at_time
   AND (CASE WHEN plan_record ? 'entitlements' THEN plan_record->'entitlements' ? 'time_tracking' ELSE timer.plan IN ('team','business') END)
   AND (timer.access_mode<>'private' OR CASE WHEN plan_record ? 'entitlements' THEN plan_record->'entitlements' ? 'projects.private' ELSE timer.plan IN ('team','business') END)
   AND (timer.member_type<>'guest' OR CASE WHEN plan_record ? 'entitlements' THEN plan_record->'entitlements' ? 'guests' ELSE timer.plan='business' END)
   AND ((timer.member_type='member' AND timer.role IN ('owner','admin')) OR timer.project_role IN ('editor','manager')
    OR (timer.project_role IS NULL AND timer.member_type='member' AND (timer.access_mode='workspace' OR timer.access_mode='team' AND timer.team_role IS NOT NULL)));
  IF NOT coalesce(allowed,false) THEN
   UPDATE work_timers SET closed_at=greatest(started_at,at_time),close_reason='permission_changed' WHERE id=timer.id;
   INSERT INTO time_entries(id,workspace_id,task_id,user_id,started_at,ended_at,duration_seconds,source,timer_id,created_at,updated_at)
    VALUES('time_'||gen_random_uuid(),timer.workspace_id,timer.task_id,timer.user_id,timer.started_at,greatest(timer.started_at,at_time),
     greatest(0,floor(extract(epoch FROM at_time::timestamptz-timer.started_at::timestamptz)))::bigint,'timer',timer.id,at_time,at_time)
    ON CONFLICT(timer_id) DO NOTHING;
  END IF;
 END LOOP;
 RETURN;
END $$;
CREATE FUNCTION close_invalid_work_timers_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN PERFORM close_invalid_work_timers(); RETURN NULL; END $$;
CREATE TRIGGER task_timer_access AFTER UPDATE OF deleted_at,project_id ON tasks FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER project_timer_access AFTER UPDATE ON projects FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER project_member_timer_access AFTER INSERT OR UPDATE OR DELETE ON project_members FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER workspace_member_timer_access AFTER UPDATE OR DELETE ON workspace_members FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER team_member_timer_access AFTER UPDATE OR DELETE ON team_members FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER team_timer_access AFTER UPDATE ON teams FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER workspace_timer_access AFTER UPDATE ON workspaces FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER user_timer_access AFTER UPDATE ON users FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER subscription_timer_access AFTER UPDATE OR DELETE ON subscriptions FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
CREATE TRIGGER plan_timer_access AFTER UPDATE ON app_settings FOR EACH STATEMENT EXECUTE FUNCTION close_invalid_work_timers_trigger();
