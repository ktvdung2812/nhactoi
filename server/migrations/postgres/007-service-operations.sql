-- NULL time preserves the pre-upgrade daily behavior. New API records use 09:00.
ALTER TABLE service_contracts ADD COLUMN reminder_time TEXT CHECK(reminder_time IS NULL OR reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE service_contracts ADD COLUMN reminder_mode TEXT NOT NULL DEFAULT 'daily' CHECK(reminder_mode IN ('daily','milestone'));
ALTER TABLE service_contracts ADD COLUMN renewal_anchor TEXT;
UPDATE service_contracts SET renewal_anchor=next_date;
ALTER TABLE service_renewals ADD COLUMN expense_id TEXT REFERENCES transactions(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE service_renewals ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
CREATE TABLE service_cycle_tasks (
 service_id TEXT NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 period_date TEXT NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
 PRIMARY KEY(service_id,period_date),
 UNIQUE(task_id)
);
