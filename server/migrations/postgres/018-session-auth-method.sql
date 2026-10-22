-- How each session was signed in. Only a fresh Google session may change the
-- login email without the current password; every older session is 'password'.
ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password'
  CHECK (auth_method IN ('password', 'google', 'dev'));
