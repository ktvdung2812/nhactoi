-- The "domain" (Tên miền / SSL) license type is retired. Existing rows keep
-- their data and move to 'other'; the CHECK no longer accepts 'domain'.
ALTER TABLE service_contracts DROP CONSTRAINT IF EXISTS service_contracts_license_type_check;
UPDATE service_contracts SET license_type = 'other' WHERE license_type = 'domain';
ALTER TABLE service_contracts ADD CONSTRAINT service_contracts_license_type_check
  CHECK (license_type IN ('subscription', 'perpetual', 'trial', 'support', 'other'));
