ALTER TABLE user_appearance ADD COLUMN platform TEXT NOT NULL DEFAULT 'all' CHECK (platform IN ('all', 'web', 'mobile'));
ALTER TABLE user_appearance DROP CONSTRAINT user_appearance_pkey;
ALTER TABLE user_appearance ADD PRIMARY KEY (workspace_id, user_id, scope, platform);
CREATE TABLE user_appearance_sync (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('web', 'mobile')),
  separate BIGINT NOT NULL DEFAULT 0 CHECK (separate IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id, platform),
  FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE
);
