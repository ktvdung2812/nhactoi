CREATE TABLE zalo_oa_connections (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id), oa_id TEXT NOT NULL UNIQUE,
 authorized_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('active','disconnected','revoked')),
 contract_json TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE zalo_oa_templates (
 connection_id TEXT NOT NULL REFERENCES zalo_oa_connections(id), template_id TEXT NOT NULL, version TEXT NOT NULL,
 status TEXT NOT NULL, purpose TEXT NOT NULL, definition_json TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(connection_id,template_id)
);
CREATE TABLE zalo_oa_recipients (
 id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES zalo_oa_connections(id), recipient_key TEXT NOT NULL,
 user_id TEXT REFERENCES users(id), customer_id TEXT REFERENCES customers(id), eligibility_json TEXT NOT NULL,
 opted_out INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(connection_id,recipient_key)
);
CREATE TABLE zalo_oa_deliveries (
 id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES zalo_oa_connections(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 actor_id TEXT NOT NULL REFERENCES users(id), source_kind TEXT NOT NULL CHECK(source_kind IN ('task','service')), source_id TEXT NOT NULL,
 cycle TEXT NOT NULL, recipient_id TEXT NOT NULL REFERENCES zalo_oa_recipients(id), purpose TEXT NOT NULL, template_id TEXT NOT NULL,
 generation INTEGER NOT NULL, payload_json TEXT NOT NULL, source_json TEXT NOT NULL, status TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, lease_token TEXT, lease_until TEXT, provider_message_id TEXT,
 last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(connection_id,source_kind,source_id,cycle,recipient_id,purpose)
);
CREATE INDEX zalo_oa_delivery_due ON zalo_oa_deliveries(status,next_attempt_at);
CREATE UNIQUE INDEX zalo_oa_message_identity ON zalo_oa_deliveries(connection_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE zalo_oa_attempts (
 id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES zalo_oa_deliveries(id), attempt INTEGER NOT NULL,
 status TEXT NOT NULL, provider_reference TEXT, error_code TEXT, started_at TEXT NOT NULL, finished_at TEXT,
 UNIQUE(delivery_id,attempt)
);
CREATE TABLE zalo_oa_callbacks (
 connection_id TEXT NOT NULL REFERENCES zalo_oa_connections(id), event_id TEXT NOT NULL,
 delivery_id TEXT NOT NULL REFERENCES zalo_oa_deliveries(id), status TEXT NOT NULL, received_at TEXT NOT NULL,
 PRIMARY KEY(connection_id,event_id)
);
