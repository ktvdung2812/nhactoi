-- One fenced lease per logical recipient delivery. Existing outbox rows remain
-- the source of payload, authorization and scheduling; no second queue is built.
CREATE TABLE delivery_leases (
 channel TEXT NOT NULL CHECK (channel IN ('email','web_push','fcm')),
 notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 target_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 status TEXT NOT NULL CHECK (status IN ('claimed','sending','retry','sent','suppressed','failed','unknown')),
 lease_token TEXT NOT NULL,
 lease_until TEXT NOT NULL,
 attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 provider_reference TEXT,
 last_error TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (channel, notification_id, target_id)
);
CREATE INDEX delivery_leases_expiry_idx ON delivery_leases(status,lease_until);

ALTER TABLE reminder_email_outbox DROP CONSTRAINT reminder_email_outbox_status_check;
ALTER TABLE reminder_email_outbox ADD CONSTRAINT reminder_email_outbox_status_check CHECK(status IN ('pending','sent','failed','skipped','unknown'));
ALTER TABLE web_push_deliveries DROP CONSTRAINT web_push_deliveries_status_check;
ALTER TABLE web_push_deliveries ADD CONSTRAINT web_push_deliveries_status_check CHECK(status IN ('pending','sent','failed','skipped','unknown'));
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_status_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check CHECK(status IN ('pending','sent','failed','skipped','unknown'));
ALTER TABLE notification_outbox_deliveries DROP CONSTRAINT notification_outbox_deliveries_status_check;
ALTER TABLE notification_outbox_deliveries ADD CONSTRAINT notification_outbox_deliveries_status_check CHECK(status IN ('pending','sent','failed','skipped','unknown'));
