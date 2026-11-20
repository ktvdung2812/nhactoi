-- VC Billing: partial payments and owner-cancelled invoices are real states,
-- each order keeps its VAT breakdown and the payment code shown to the payer,
-- and a workspace owner can keep a billing profile for invoices.
ALTER TABLE billing_orders DROP CONSTRAINT billing_orders_status_check;
ALTER TABLE billing_orders ADD CONSTRAINT billing_orders_status_check
  CHECK (status IN ('pending', 'partially_paid', 'paid', 'failed', 'canceled', 'refunded', 'expired'));

ALTER TABLE billing_orders ADD COLUMN payment_code TEXT;
ALTER TABLE billing_orders ADD COLUMN subtotal_amount BIGINT;
ALTER TABLE billing_orders ADD COLUMN tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0
  CHECK (tax_rate >= 0 AND tax_rate <= 100);
ALTER TABLE billing_orders ADD COLUMN tax_amount BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE billing_orders ADD COLUMN amount_paid BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);
ALTER TABLE billing_orders ADD COLUMN last_checked_at TEXT;
-- Orders created before VAT existed were quoted at the plan price, and a paid
-- order was only settled after the full amount arrived.
UPDATE billing_orders SET subtotal_amount = amount WHERE subtotal_amount IS NULL;
UPDATE billing_orders SET amount_paid = amount WHERE status = 'paid';
CREATE UNIQUE INDEX billing_orders_payment_code_idx
  ON billing_orders(payment_code) WHERE payment_code IS NOT NULL;
CREATE INDEX billing_orders_reconcile_idx
  ON billing_orders(status, created_at) WHERE status IN ('pending', 'partially_paid');

CREATE TABLE billing_profiles (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  company_name TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  updated_at TEXT NOT NULL
);
