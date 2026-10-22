-- A login email changes only after the new mailbox confirms a one-time code.
CREATE TABLE email_change_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  previous_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE UNIQUE INDEX email_change_requests_active_idx ON email_change_requests(user_id) WHERE consumed_at IS NULL;
CREATE INDEX email_change_requests_expiry_idx ON email_change_requests(expires_at);
