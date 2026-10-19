CREATE TABLE workspace_ai_settings (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 name TEXT NOT NULL DEFAULT 'Vyvy' CHECK(length(name) BETWEEN 1 AND 60),
 handle TEXT NOT NULL DEFAULT 'vyvy' CHECK(handle ~ '^[a-z][a-z0-9_]{1,31}$'),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 updated_at TEXT NOT NULL
);

ALTER TABLE task_comments ADD COLUMN author_type TEXT NOT NULL DEFAULT 'human' CHECK(author_type IN ('human','assistant'));
ALTER TABLE task_comments ADD COLUMN author_name_snapshot TEXT;
ALTER TABLE task_comments ADD COLUMN reply_to_comment_id TEXT REFERENCES task_comments(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE task_comments ADD COLUMN ai_run_id TEXT;
ALTER TABLE task_comments ADD COLUMN ai_metadata TEXT NOT NULL DEFAULT '{}';

CREATE TABLE ai_comment_runs (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 comment_id TEXT UNIQUE REFERENCES task_comments(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
 requested_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
 request_body TEXT NOT NULL,
 assistant_name TEXT NOT NULL,
 assistant_handle TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','reading','executing','completed','failed','cancelled')),
 error TEXT,
 reply_comment_id TEXT REFERENCES task_comments(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
 state_json TEXT NOT NULL DEFAULT '{}',
 sources_json TEXT NOT NULL DEFAULT '[]',
 actions_json TEXT NOT NULL DEFAULT '[]',
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 lease_until TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX ai_comment_runs_queue_idx ON ai_comment_runs(status,created_at,id);
CREATE INDEX ai_comment_runs_task_idx ON ai_comment_runs(workspace_id,task_id,created_at,id);
ALTER TABLE task_comments ADD CONSTRAINT task_comments_ai_run_fk FOREIGN KEY(ai_run_id) REFERENCES ai_comment_runs(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
CREATE UNIQUE INDEX task_comments_ai_reply_idx ON task_comments(ai_run_id) WHERE ai_run_id IS NOT NULL;
