CREATE TABLE api_tokens (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by TEXT NOT NULL, name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL, projects_json TEXT NOT NULL,
 created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT,
 FOREIGN KEY(workspace_id,created_by) REFERENCES workspace_members(workspace_id,user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE webhook_subscriptions (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, created_by TEXT NOT NULL, name TEXT NOT NULL,
 url TEXT NOT NULL, projects_json TEXT NOT NULL, events_json TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), key_version BIGINT NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,workspace_id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES workspace_members(workspace_id,user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE webhook_deliveries (
 id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, workspace_id TEXT NOT NULL, event_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','retry','delivered','failed','suppressed')),
 attempt_count BIGINT NOT NULL DEFAULT 0, manual_retries BIGINT NOT NULL DEFAULT 0,
 next_attempt_at TEXT, lease_token TEXT, lease_until TEXT, last_status INTEGER, last_error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(subscription_id,event_id),
 FOREIGN KEY(subscription_id,workspace_id) REFERENCES webhook_subscriptions(id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 FOREIGN KEY(event_id) REFERENCES business_events(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE webhook_attempts (
 id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 attempt_number BIGINT NOT NULL, key_version BIGINT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
 status INTEGER, outcome TEXT NOT NULL, UNIQUE(delivery_id,attempt_number)
);
CREATE INDEX webhook_delivery_ready ON webhook_deliveries(state,next_attempt_at,lease_until);
CREATE FUNCTION queue_public_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF coalesce(mutation_context()->>'suppressSideEffects','false')='true' OR NEW.source IN ('import','migration','restore') THEN RETURN NEW; END IF;
 INSERT INTO webhook_deliveries(id,subscription_id,workspace_id,event_id,created_at,updated_at)
 SELECT 'whd_'||gen_random_uuid(),s.id,NEW.workspace_id,NEW.id,NEW.occurred_at,NEW.occurred_at
 FROM webhook_subscriptions s WHERE s.workspace_id=NEW.workspace_id AND s.active=1
 AND (s.projects_json::jsonb='[]'::jsonb OR s.projects_json::jsonb @> jsonb_build_array(NEW.project_id))
 AND s.events_json::jsonb @> jsonb_build_array(NEW.type)
 ON CONFLICT(subscription_id,event_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER business_event_webhook AFTER INSERT ON business_events FOR EACH ROW EXECUTE FUNCTION queue_public_webhook();

ALTER TABLE business_events ADD COLUMN resource_revision TEXT;
CREATE FUNCTION public_event_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT aggregate_revision::text INTO NEW.resource_revision FROM tasks WHERE id=NEW.task_id;
 RETURN NEW;
END $$;
CREATE TRIGGER business_event_revision BEFORE INSERT ON business_events FOR EACH ROW EXECUTE FUNCTION public_event_revision();
CREATE FUNCTION public_task_updated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.title,NEW.description,NEW.priority,NEW.remind_at,NEW.project_id,NEW.recurrence,NEW.recurrence_options,NEW.start_at)
 IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.priority,OLD.remind_at,OLD.project_id,OLD.recurrence,OLD.recurrence_options,OLD.start_at) THEN
  PERFORM append_task_event(NEW,'task.updated',to_jsonb(OLD),to_jsonb(NEW));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_public_update AFTER UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION public_task_updated();
CREATE FUNCTION public_task_child_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_value JSONB; task_key TEXT; task_row tasks; event_type TEXT;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
 row_value:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='task_checklist_items' THEN SELECT task_id INTO task_key FROM task_checklists WHERE id=row_value->>'checklist_id';
 ELSE task_key:=row_value->>'task_id'; END IF;
 SELECT * INTO task_row FROM tasks WHERE id=task_key;
 IF NOT FOUND THEN RETURN COALESCE(NEW,OLD); END IF;
 event_type:=CASE TG_TABLE_NAME WHEN 'task_label_links' THEN 'task.labels_changed' WHEN 'task_field_values' THEN 'task.fields_changed' ELSE 'task.checklist_changed' END;
 PERFORM append_task_event(task_row,event_type,NULL,to_jsonb(task_row));
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER z_public_checklist AFTER INSERT OR UPDATE OR DELETE ON task_checklists FOR EACH ROW EXECUTE FUNCTION public_task_child_event();
CREATE TRIGGER z_public_checklist_item AFTER INSERT OR UPDATE OR DELETE ON task_checklist_items FOR EACH ROW EXECUTE FUNCTION public_task_child_event();
CREATE TRIGGER z_public_label AFTER INSERT OR UPDATE OR DELETE ON task_label_links FOR EACH ROW EXECUTE FUNCTION public_task_child_event();
CREATE TRIGGER z_public_field AFTER INSERT OR UPDATE OR DELETE ON task_field_values FOR EACH ROW EXECUTE FUNCTION public_task_child_event();
