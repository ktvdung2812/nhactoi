// VC Billing (formerly BillGateway) helpers. Everything here is pure or takes
// its dependencies as arguments, so index.mjs keeps only the routes.
import { randomBytes } from 'node:crypto';

export const VC_BILLING_DEFAULT_API_URL = 'https://billing.vce.codes';
export const DEFAULT_SKU_PREFIX = 'NHACTOI';
// 32 symbols without 0/O/1/I: one random byte & 31 picks a symbol without bias.
export const PAYMENT_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PAYMENT_CODE_RANDOM_LENGTH = 8;
export const BILLING_ORDER_STATUSES = ['pending', 'partially_paid', 'paid', 'failed', 'canceled', 'expired', 'refunded'];
export const TAX_CODE_PATTERN = /^\d{10}(-\d{3})?$/;

export const VC_BILLING_MESSAGES = Object.freeze({
  paymentCodePrefix: 'Tiền tố mã thanh toán chỉ gồm 2–10 chữ in hoa hoặc số',
  taxRate: 'Thuế VAT phải từ 0 đến 100%',
  skuPrefix: 'Tiền tố SKU chỉ gồm chữ in hoa, số và dấu gạch ngang (tối đa 20 ký tự)',
  liveApiKey: 'Payment API cần project API key (bg_proj_…), không dùng API key truy vấn giao dịch (bg_live_…)',
  otherApiKey: 'Khóa API phải là project API key bắt đầu bằng bg_proj_',
  testMissing: 'Cần nhập địa chỉ API và project API key trước khi kiểm tra',
  taxCode: 'Mã số thuế gồm 10 hoặc 13 số (dạng 0312345678-001)',
  notCancelable: 'Hóa đơn không thể hủy',
  notConfigured: 'Chưa cấu hình VC Billing: cần project API key và webhook secret (BILLGATE_API_KEY, BILLGATE_WEBHOOK_SECRET hoặc trang Quản trị → Cài đặt)',
});

// bg_proj_ keys call the Payment API; bg_live_ keys only query bank transactions.
export function apiKeyKind(key) {
  const value = String(key || '').trim();
  if (!value) return null;
  if (value.startsWith('bg_proj_')) return 'project';
  if (value.startsWith('bg_live_')) return 'live';
  return 'other';
}

// Each normalizer returns the stored value, or null when the input is invalid.
export function normalizePaymentCodePrefix(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  return text === '' || /^[A-Z0-9]{2,10}$/.test(text) ? text : null;
}

export function normalizeSkuPrefix(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{0,19}$/.test(text) ? text : null;
}

export function normalizeTaxRate(value) {
  let number;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) number = Number(value);
  else return null;
  if (!Number.isFinite(number) || number < 0 || number > 100) return null;
  const hundredths = Math.round(number * 100);
  if (Math.abs(hundredths - number * 100) > 1e-6) return null;
  return hundredths / 100;
}

// VAT is added on top of the plan price. Integer hundredths of a percent keep
// the half-unit rounding exact (e.g. 8.25% of 199 000 = 16 417.5 → 16 418).
export function billingTotals(subtotal, taxRate = 0) {
  const rate = normalizeTaxRate(taxRate) ?? 0;
  const taxAmount = Math.round((subtotal * Math.round(rate * 100)) / 10000);
  return { subtotal, taxRate: rate, taxAmount, total: subtotal + taxAmount };
}

export function generatePaymentCode(prefix, random = randomBytes) {
  const bytes = random(PAYMENT_CODE_RANDOM_LENGTH);
  let code = String(prefix || '');
  for (let index = 0; index < PAYMENT_CODE_RANDOM_LENGTH; index++)
    code += PAYMENT_CODE_ALPHABET[bytes[index] & 31];
  return code;
}

export function planSku(skuPrefix, planId, cycle) {
  return `${skuPrefix || DEFAULT_SKU_PREFIX}-${String(planId).toUpperCase()}-${cycle === 'yearly' ? 'Y' : 'M'}`;
}

// Empty fields are omitted so VC Billing never stores blank invoice details.
export function paymentCustomer(profile, user) {
  const customer = {
    name: profile?.companyName || user?.name || '',
    email: profile?.email || user?.email || '',
    taxCode: profile?.taxCode || '',
    address: profile?.address || '',
  };
  return Object.fromEntries(Object.entries(customer).filter(([, value]) => value));
}

export function buildPaymentRequest({ orderId, plan, cycle, totals, code, skuPrefix, customer }) {
  const yearly = cycle === 'yearly';
  return {
    ...(code ? { code } : {}),
    externalId: orderId,
    description: `Nhắc tôi ${plan.name} – ${yearly ? '12 tháng' : '1 tháng'}`,
    currency: 'VND',
    customer,
    items: [{
      description: `Gói ${plan.name} (${yearly ? 'năm' : 'tháng'})`,
      unit: yearly ? 'Năm' : 'Tháng',
      sku: planSku(skuPrefix, plan.id, cycle),
      quantity: 1,
      unitAmount: totals.subtotal,
      taxRate: totals.taxRate,
    }],
    taxRate: totals.taxRate,
    totalAmount: totals.total,
    metadata: { nhacToiOrderId: orderId, plan: plan.id, cycle },
  };
}

export function vcBillingEndpoint(base, path) {
  if (!base) return null;
  if (/\/api(?:\/v1)?$/i.test(base)) return `${base}${path}`;
  return `${base}/api/v1${path}`;
}

// A provider payment status read through the API becomes the webhook event it
// corresponds to, so polling and webhooks share one settlement path.
export function paymentStatusEvent(status) {
  const value = String(status || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
  if (['paid', 'success', 'succeeded', 'completed'].includes(value)) return 'payment.paid';
  if (['partially_paid', 'partial', 'partial_paid', 'partiallypaid'].includes(value)) return 'payment.partially_paid';
  if (['canceled', 'cancelled', 'void', 'voided'].includes(value)) return 'payment.canceled';
  if (value === 'expired') return 'payment.expired';
  if (value === 'refunded') return 'payment.refunded';
  if (value === 'failed') return 'payment.failed';
  return `payment.${value || 'unknown'}`;
}

// created → record only; paid → settle; the rest set the order status.
export function billingEventKind(eventType) {
  const value = String(eventType || '').toLowerCase().replace(/_/g, '.');
  if (value.includes('partial')) return 'partially_paid';
  if (value.includes('refund')) return 'refunded';
  if (value.includes('cancel')) return 'canceled';
  if (value.includes('expire')) return 'expired';
  if (value.includes('fail')) return 'failed';
  if (['payment.paid', 'paid', 'payment.success', 'payment.succeeded', 'payment.completed'].includes(value)) return 'paid';
  if (value === 'payment.created' || value === 'created') return 'created';
  return 'other';
}

export function paymentAmountPaid(payment) {
  const raw = payment?.amountPaid ?? payment?.paidAmount;
  if (raw === undefined || raw === null || raw === '') return null;
  const amount = Number(raw);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function paymentCodeFrom(payment) {
  const code = payment?.code;
  return typeof code === 'string' && code.trim() && code.length <= 100 ? code.trim() : null;
}

function connectionReason(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'quá thời gian chờ';
  const cause = error?.cause;
  return String(cause?.code || cause?.message || error?.message || 'lỗi không xác định');
}

// Lists one payment to prove the URL and project key work. Never echoes the key.
export async function testVcBillingConnection({ endpoint, apiKey, fetchImpl = fetch, now = () => new Date(), timeoutMs = 10000 }) {
  const checkedAt = () => now().toISOString();
  if (apiKeyKind(apiKey) === 'live')
    return { ok: false, httpStatus: null, latencyMs: 0, checkedAt: checkedAt(), message: VC_BILLING_MESSAGES.liveApiKey };
  const started = performance.now();
  const latency = () => Math.max(0, Math.round(performance.now() - started));
  const redact = text => (apiKey ? String(text).split(apiKey).join('***') : String(text));
  try {
    const response = await fetchImpl(endpoint, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try { body = await response.json(); } catch {}
    const latencyMs = latency();
    const base = { httpStatus: response.status, latencyMs, checkedAt: checkedAt() };
    if (response.ok && body?.success !== false)
      return { ok: true, ...base, message: 'Kết nối VC Billing thành công' };
    if (response.status === 401 || response.status === 403)
      return { ok: false, ...base, message: `VC Billing từ chối khóa API (${response.status})` };
    return { ok: false, ...base, message: `VC Billing trả lỗi (HTTP ${response.status})` };
  } catch (error) {
    return { ok: false, httpStatus: null, latencyMs: latency(), checkedAt: checkedAt(),
      message: redact(`Không kết nối được VC Billing: ${connectionReason(error)}`).slice(0, 300) };
  }
}

// Open invoices that missed a webhook. Reading them back is the only recovery:
// VC Billing does not retry webhook deliveries.
export function reconcileCandidates(db, { now, limit = 20, staleMs = 5 * 60 * 1000, maxAgeMs = 30 * 86400 * 1000 }) {
  const at = now.getTime();
  return db.prepare(`SELECT * FROM billing_orders
    WHERE status IN ('pending', 'partially_paid') AND provider_payment_id IS NOT NULL
      AND created_at >= ? AND (last_checked_at IS NULL OR last_checked_at < ?)
    ORDER BY COALESCE(last_checked_at, '') ASC, created_at ASC, id ASC LIMIT ?`)
    .all(new Date(at - maxAgeMs).toISOString(), new Date(at - staleMs).toISOString(), limit);
}

// Marks one order as checked unless another process claimed it first.
export function claimReconcile(db, orderId, { now, staleMs = 5 * 60 * 1000 }) {
  return db.prepare(`UPDATE billing_orders SET last_checked_at = ?
    WHERE id = ? AND status IN ('pending', 'partially_paid') AND (last_checked_at IS NULL OR last_checked_at < ?)`)
    .run(now.toISOString(), orderId, new Date(now.getTime() - staleMs).toISOString()).changes === 1;
}
