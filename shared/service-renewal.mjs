// Shared renewal values and calendar arithmetic. Renewal dates are calendar
// dates in Vietnam (UTC+07:00), so no machine-local timezone is consulted.

export const licenseTypes = Object.freeze([
  "subscription",
  "perpetual",
  "trial",
  "support",
  "domain",
  "other",
]);

export const licenseTypeLabels = Object.freeze({
  subscription: "Thuê bao",
  perpetual: "Vĩnh viễn / bảo trì",
  trial: "Dùng thử",
  support: "Hỗ trợ / bảo trì",
  domain: "Tên miền / SSL",
  other: "Khác",
});

export const invoiceTypes = Object.freeze(["bill", "invoice"]);
export const invoiceTypeLabels = Object.freeze({
  bill: "Bill thanh toán",
  invoice: "Hóa đơn",
});

export const serviceStatuses = Object.freeze([
  "ok",
  "due_soon",
  "expired",
  "disabled",
]);

export const serviceStatusLabels = Object.freeze({
  ok: "Còn hạn",
  due_soon: "Sắp hết hạn",
  expired: "Quá hạn",
  disabled: "Tắt theo dõi",
});

// Migration 19 is kept in the shared module so the database migration and the
// API's field contract cannot drift apart. It only adds nullable/defaulted
// columns and preserves the legacy amount column for older clients.
export const SERVICE_RENEWAL_SCHEMA = `
ALTER TABLE service_contracts ADD COLUMN license_type TEXT NOT NULL DEFAULT 'subscription'
  CHECK (license_type IN ('subscription', 'perpetual', 'trial', 'support', 'domain', 'other'));
ALTER TABLE service_contracts ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
  CHECK (quantity BETWEEN 1 AND 1000000);
ALTER TABLE service_contracts ADD COLUMN unit_price INTEGER
  CHECK (unit_price IS NULL OR unit_price >= 0);
ALTER TABLE service_contracts ADD COLUMN actual_paid INTEGER
  CHECK (actual_paid IS NULL OR actual_paid >= 0);
ALTER TABLE service_contracts ADD COLUMN purchase_date TEXT;
ALTER TABLE service_contracts ADD COLUMN account_hint TEXT;
ALTER TABLE service_contracts ADD COLUMN payment_account TEXT;
ALTER TABLE service_contracts ADD COLUMN payment_method TEXT;
ALTER TABLE service_contracts ADD COLUMN portal_url TEXT;
ALTER TABLE service_contracts ADD COLUMN provider_contact TEXT;
ALTER TABLE service_contracts ADD COLUMN invoice_type TEXT
  CHECK (invoice_type IS NULL OR invoice_type IN ('bill', 'invoice'));
ALTER TABLE service_contracts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1
  CHECK (enabled IN (0, 1));
ALTER TABLE service_contracts ADD COLUMN sync_calendar INTEGER NOT NULL DEFAULT 0
  CHECK (sync_calendar IN (0, 1));
ALTER TABLE service_contracts ADD COLUMN last_renewed_at TEXT;

UPDATE service_contracts
SET unit_price = amount
WHERE unit_price IS NULL;

ALTER TABLE notifications ADD COLUMN service_id TEXT
  REFERENCES service_contracts(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notifications_service_idx
  ON notifications(service_id, created_at);
CREATE INDEX IF NOT EXISTS service_contracts_reminder_idx
  ON service_contracts(workspace_id, enabled, next_date, archived_at);
`;

const DAY_MS = 86400000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function calendarDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getTime() + VIETNAM_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
  }
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text)
      return text;
    return null;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

export function vietnamDate(value = new Date()) {
  return calendarDate(value) || new Date(Date.now() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

export function addCalendarDays(value, days) {
  const source = calendarDate(value);
  if (!source || !Number.isSafeInteger(days)) return null;
  const date = new Date(`${source}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDaysBetween(from, to) {
  const a = calendarDate(from);
  const b = calendarDate(to);
  if (!a || !b) return null;
  return Math.trunc((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS);
}

/** Calendar-safe month/year addition with end-of-month clamping. */
export function nextServiceDate(value, cycle, count = 1, anchor = value) {
  const source = calendarDate(value);
  if (!source || !["month", "year"].includes(cycle) || !Number.isSafeInteger(count) || count < 1)
    return null;
  const month = Number(source.slice(5, 7));
  const day = Number((calendarDate(anchor) || source).slice(8));
  const monthOffset = (cycle === "year" ? 12 : 1) * count;
  const result = new Date(`${source.slice(0, 7)}-01T00:00:00Z`);
  result.setUTCMonth(month - 1 + monthOffset);
  if (!Number.isFinite(result.getTime()) || result.getUTCFullYear() > 9999) return null;
  const end = new Date(result); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  const lastDay = end.getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString().slice(0, 10);
}

/** Advance by whole configured cycles until the next date is after today. */
export function nextFutureServiceDate(value, cycle, count = 1, today = vietnamDate(), anchor = value) {
  let periods = 1;
  let result = nextServiceDate(value, cycle, count * periods, anchor);
  const current = calendarDate(today);
  if (!result || !current) return result;
  let guard = 0;
  while (result <= current && guard++ < 10000) {
    periods += 1;
    const total = count * periods;
    if (!Number.isSafeInteger(total)) return null;
    // Always add from the original date. This keeps January 31 anchored to
    // March 31 after February is clamped to February 28.
    result = nextServiceDate(value, cycle, total, anchor);
  }
  return result && result > current ? result : null;
}

/** Daily sends only today's reminder; milestones catch up only the newest
 * eligible point (the configured lead day or the expiry day), never a backlog. */
export function serviceReminderSchedule(service, now = new Date()) {
  if (service.archived_at || !service.enabled) return null;
  const today = vietnamDate(now);
  if (!['due_soon', 'expired'].includes(serviceStatus(service, today))) return null;
  const time = service.reminder_time ?? null;
  const localTime = new Date(new Date(now).getTime() + VIETNAM_OFFSET_MS).toISOString().slice(11, 16);
  if (time && localTime < time) return null;
  if (service.reminder_mode !== 'milestone') {
    return { key: `${service.next_date}/${today}`, scheduledDate: today };
  }
  const points = [...new Set([addCalendarDays(service.next_date, -service.remind_days), service.next_date])].sort();
  const scheduledDate = points.filter(day => day < today || day === today && (!time || localTime >= time)).at(-1);
  return scheduledDate ? { key: `${service.next_date}/milestone/${scheduledDate}`, scheduledDate } : null;
}

function rowValue(row, camel, snake, fallback = undefined) {
  if (row?.[camel] !== undefined) return row[camel];
  if (row?.[snake] !== undefined) return row[snake];
  return fallback;
}

/** Pure status used by API responses, filters, and the reminder worker. */
export function serviceStatus(row, today = vietnamDate()) {
  const enabled = rowValue(row, "enabled", "enabled", true);
  if (enabled === false || enabled === 0 || enabled === "0") return "disabled";
  const nextDate = calendarDate(rowValue(row, "nextDate", "next_date"));
  const current = calendarDate(today);
  if (!nextDate || !current) return "ok";
  if (nextDate < current) return "expired";
  const remindDays = rowValue(row, "remindDays", "remind_days", 0);
  const days = Number.isSafeInteger(remindDays) ? Math.max(0, remindDays) : Number(remindDays) || 0;
  const horizon = addCalendarDays(current, days);
  return horizon && nextDate <= horizon ? "due_soon" : "ok";
}

/** Compute a safe VND total while preserving the old amount field semantics. */
export function serviceAmount(row) {
  const quantity = rowValue(row, "quantity", "quantity", 1);
  const unitPrice = rowValue(row, "unitPrice", "unit_price");
  const legacyAmount = rowValue(row, "amount", "amount", 0);
  if (unitPrice === null || unitPrice === undefined || unitPrice === "") {
    return Number.isSafeInteger(Number(legacyAmount)) && Number(legacyAmount) >= 0
      ? Number(legacyAmount)
      : 0;
  }
  const q = Number(quantity);
  const price = Number(unitPrice);
  const total = q * price;
  return Number.isSafeInteger(q) && q >= 1 && Number.isSafeInteger(price) && price >= 0 && Number.isSafeInteger(total)
    ? total
    : null;
}

export function isValidCalendarDate(value) {
  return calendarDate(value) !== null && /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}
