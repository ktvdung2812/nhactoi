CREATE TABLE google_calendar_connections (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
 account_id TEXT, calendar_id TEXT, status TEXT NOT NULL DEFAULT 'connecting',
 enabled_json TEXT NOT NULL DEFAULT '["personal","deadline"]', generation BIGINT NOT NULL DEFAULT 1,
 sync_token TEXT, sync_requested BIGINT NOT NULL DEFAULT 1, sync_processed BIGINT NOT NULL DEFAULT 0,
 channel_id TEXT, channel_token_hash TEXT, channel_resource TEXT, channel_expires_at TEXT, channel_sequence TEXT,
 lease_token TEXT, lease_until TEXT, last_success_at TEXT, last_error TEXT, next_attempt_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,user_id), UNIQUE(id,workspace_id),
 FOREIGN KEY(workspace_id,user_id) REFERENCES workspace_members(workspace_id,user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE google_calendar_states (
 state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
 callback_uri TEXT NOT NULL, verifier TEXT NOT NULL, expires_at TEXT NOT NULL,
 FOREIGN KEY(workspace_id,user_id) REFERENCES workspace_members(workspace_id,user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE google_calendar_mappings (
 id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, workspace_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('personal','deadline','appointment','renewal')),
 source_id TEXT NOT NULL, event_id TEXT NOT NULL, etag TEXT, base_revision TEXT, base_json TEXT,
 state TEXT NOT NULL DEFAULT 'pending', conflict_json TEXT, last_error TEXT, updated_at TEXT NOT NULL,
 UNIQUE(connection_id,kind,source_id), UNIQUE(connection_id,event_id),
 FOREIGN KEY(connection_id,workspace_id) REFERENCES google_calendar_connections(id,workspace_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE google_calendar_jobs (
 connection_id TEXT NOT NULL, kind TEXT NOT NULL, source_id TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 1,
 attempts BIGINT NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT,
 PRIMARY KEY(connection_id,kind,source_id),
 FOREIGN KEY(connection_id) REFERENCES google_calendar_connections(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX google_calendar_jobs_ready ON google_calendar_jobs(connection_id,next_attempt_at);
CREATE FUNCTION queue_google_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row JSONB; scope_id TEXT; source TEXT; types TEXT[]; owner_id TEXT;
BEGIN
 source_row:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='personal_task_plans' THEN
  source:=source_row->>'task_id';owner_id:=source_row->>'user_id';
  SELECT workspace_id INTO scope_id FROM tasks WHERE id=source;
  types:=ARRAY['personal'];
 ELSE
  source:=source_row->>'id';scope_id:=source_row->>'workspace_id';
  types:=CASE TG_TABLE_NAME WHEN 'tasks' THEN ARRAY['personal','deadline'] WHEN 'calendar_events' THEN ARRAY['appointment'] ELSE ARRAY['renewal'] END;
 END IF;
 INSERT INTO google_calendar_jobs(connection_id,kind,source_id)
  SELECT c.id,k,source FROM google_calendar_connections c CROSS JOIN unnest(types) k
  WHERE c.workspace_id=scope_id AND c.status='active' AND (owner_id IS NULL OR c.user_id=owner_id)
  ON CONFLICT(connection_id,kind,source_id) DO UPDATE SET revision=google_calendar_jobs.revision+1,attempts=0,next_attempt_at=NULL,last_error=NULL;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER google_task_projection AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION queue_google_projection();
CREATE TRIGGER google_plan_projection AFTER INSERT OR UPDATE OR DELETE ON personal_task_plans FOR EACH ROW EXECUTE FUNCTION queue_google_projection();
CREATE TRIGGER google_appointment_projection AFTER INSERT OR UPDATE OR DELETE ON calendar_events FOR EACH ROW EXECUTE FUNCTION queue_google_projection();
CREATE TRIGGER google_renewal_projection AFTER INSERT OR UPDATE OR DELETE ON service_contracts FOR EACH ROW EXECUTE FUNCTION queue_google_projection();
