import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, user } from "./roadmap-helpers.mjs";
import {
  licenseTypes,
  nextFutureServiceDate,
  nextServiceDate,
  serviceStatus,
} from "../shared/service-renewal.mjs";
import { processServiceReminders } from "../server/services.mjs";

const fixedClock = (value) => () => new Date(value);

test("shared renewal contract keeps exact enums, statuses, and anchored dates", () => {
  assert.deepEqual(licenseTypes, [
    "subscription",
    "perpetual",
    "trial",
    "support",
    "domain",
    "other",
  ]);
  assert.equal(serviceStatus({ nextDate: "2026-09-30", remindDays: 14, enabled: true }, "2026-09-15"), "ok");
  assert.equal(serviceStatus({ nextDate: "2026-09-30", remindDays: 14, enabled: true }, "2026-09-20"), "due_soon");
  assert.equal(serviceStatus({ nextDate: "2026-09-20", remindDays: 14, enabled: true }, "2026-09-21"), "expired");
  assert.equal(serviceStatus({ nextDate: "2026-09-20", remindDays: 14, enabled: false }, "2026-09-21"), "disabled");
  assert.equal(nextServiceDate("2028-02-29", "year", 1), "2029-02-28");
  assert.equal(nextServiceDate("2026-01-31", "month", 1), "2026-02-28");
  assert.equal(nextFutureServiceDate("2026-01-31", "month", 1, "2026-03-01"), "2026-03-31");
});

test("service migration/API backfills legacy amount and computes quantity totals", async (t) => {
  const s = await boot(t, { clock: fixedClock("2026-09-21T02:00:00.000Z") });
  const owner = await user(s, "service-fields@example.test");
  const legacy = await call(s, "/services", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Legacy", nextDate: "2026-10-01", cycle: "month", amount: 100000 },
  });
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assert.equal(legacy.body.service.quantity, 1);
  assert.equal(legacy.body.service.unitPrice, 100000);
  assert.equal(legacy.body.service.amount, 100000);

  const created = await call(s, "/services", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      name: "Cloud seats",
      provider: "Acme",
      licenseType: "subscription",
      quantity: 3,
      unitPrice: 125000,
      actualPaid: 400000,
      purchaseDate: "2026-09-01",
      nextDate: "2026-11-01",
      cycle: "month",
      intervalCount: 1,
      remindDays: 14,
      accountHint: "ops@example.test",
      paymentAccount: "Vietcombank ****1234",
      paymentMethod: "bank",
      portalUrl: "https://portal.example.test/account",
      providerContact: "support@example.test",
      invoiceType: "invoice",
      enabled: true,
      syncCalendar: true,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.service.quantity, 3);
  assert.equal(created.body.service.unitPrice, 125000);
  assert.equal(created.body.service.amount, 375000);
  assert.equal(created.body.service.actualPaid, 400000);
  assert.equal(created.body.service.portalUrl, "https://portal.example.test/account");
  assert.equal(created.body.service.syncCalendar, true);
  assert.equal(created.body.service.status, "ok");
  assert.equal(typeof created.body.service.canEdit, "boolean");

  const columns = s.db.prepare("PRAGMA table_info(service_contracts)").all().map((row) => row.name);
  assert.ok(columns.includes("license_type"));
  assert.ok(columns.includes("last_renewed_at"));
  assert.ok(s.db.prepare("PRAGMA table_info(notifications)").all().some((row) => row.name === "service_id"));
});

test("service input rejects unsafe numbers, invalid dates, URLs, invoice types, and unknown fields", async (t) => {
  const s = await boot(t, { clock: fixedClock("2026-09-21T02:00:00.000Z") });
  const owner = await user(s, "service-validation@example.test");
  const base = { name: "Validation", nextDate: "2026-10-01", amount: 100 };
  for (const body of [
    { ...base, portalUrl: "javascript:alert(1)" },
    { ...base, purchaseDate: "2026-10-02" },
    { ...base, quantity: Number.MAX_SAFE_INTEGER, unitPrice: 2 },
    { ...base, invoiceType: "receipt" },
    { ...base, unsupported: true },
  ]) {
    const response = await call(s, "/services", { method: "POST", cookie: owner.cookie, body });
    assert.equal(response.status, 400, JSON.stringify({ body, response: response.body }));
  }
});

test("service reminders are daily in Vietnam, durable per user, and scoped to enabled active rows", async (t) => {
  const s = await boot(t, { clock: fixedClock("2026-09-20T02:00:00.000Z") });
  const owner = await user(s, "service-reminder@example.test");
  const created = await call(s, "/services", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Daily reminder", nextDate: "2026-09-22", cycle: "month", amount: 100000, remindDays: 3 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const serviceId = created.body.service.id;
  const sent = [];
  const email = ({ recipient, service, message }) => sent.push({ recipient, service, message });

  assert.equal(processServiceReminders({ db: s.db, clock: fixedClock("2026-09-20T16:30:00.000Z"), sendEmail: email }), 1);
  assert.equal(processServiceReminders({ db: s.db, clock: fixedClock("2026-09-20T16:45:00.000Z"), sendEmail: email }), 0);
  // 16:30 UTC is 23:30 Vietnam on Sep 20; after midnight Vietnam this is a
  // new durable reminder day even though the UTC date remains Sep 20.
  assert.equal(processServiceReminders({ db: s.db, clock: fixedClock("2026-09-20T17:05:00.000Z"), sendEmail: email }), 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].service.id, serviceId);
  assert.equal(sent[0].recipient.email, "service-reminder@example.test");
  const notification = s.db.prepare("SELECT service_id FROM notifications WHERE type='service_renewal' ORDER BY created_at LIMIT 1").get();
  assert.equal(notification.service_id, serviceId);

  const disabled = await call(s, "/services", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Disabled reminder", nextDate: "2026-09-20", amount: 100, enabled: false },
  });
  assert.equal(disabled.status, 201, JSON.stringify(disabled.body));
  assert.equal(processServiceReminders({ db: s.db, clock: fixedClock("2026-09-21T02:00:00.000Z") }), 0);
  await call(s, `/services/${serviceId}/archive`, { method: "PUT", cookie: owner.cookie, body: { archived: true } });
  assert.equal(processServiceReminders({ db: s.db, clock: fixedClock("2026-09-21T03:00:00.000Z") }), 0);
});

test("renewal guards stale dates, advances overdue cadence, and preserves history", async (t) => {
  const s = await boot(t, { clock: fixedClock("2026-03-01T02:00:00.000Z") });
  const owner = await user(s, "service-renew@example.test");
  const created = await call(s, "/services", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Anchored", nextDate: "2026-01-31", cycle: "month", amount: 100000 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.service.id;
  const stale = await call(s, `/services/${id}/renew`, {
    method: "POST",
    cookie: owner.cookie,
    body: { expectedDate: "2026-01-01", amount: 110000 },
  });
  assert.equal(stale.status, 409);
  const renewed = await call(s, `/services/${id}/renew`, {
    method: "POST",
    cookie: owner.cookie,
    body: { expectedDate: "2026-01-31", amount: 110000 },
  });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(renewed.body.nextDate, "2026-03-31");
  const history = await call(s, `/services/${id}/history`, { cookie: owner.cookie });
  assert.equal(history.status, 200);
  assert.equal(history.body.history.length, 1);
  assert.equal(history.body.history[0].previous_date, "2026-01-31");
  assert.equal(history.body.history[0].next_date, "2026-03-31");
  const row = s.db.prepare("SELECT enabled,last_renewed_at,actual_paid FROM service_contracts WHERE id=?").get(id);
  assert.equal(row.enabled, 1);
  assert.ok(row.last_renewed_at);
  assert.equal(row.actual_paid, 110000);
});

test("duplicate copies metadata without renewal history or reminder rows", async (t) => {
  const s = await boot(t, { clock: fixedClock("2026-09-21T02:00:00.000Z") });
  const owner = await user(s, "service-duplicate@example.test");
  const source = await call(s, "/services", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Source", nextDate: "2026-10-01", amount: 100, quantity: 2, unitPrice: 50, licenseType: "domain" },
  });
  assert.equal(source.status, 201, JSON.stringify(source.body));
  const duplicated = await call(s, `/services/${source.body.service.id}/duplicate`, { method: "POST", cookie: owner.cookie, body: {} });
  assert.equal(duplicated.status, 201, JSON.stringify(duplicated.body));
  const copy = duplicated.body.service;
  assert.notEqual(copy.id, source.body.service.id);
  assert.equal(copy.name, "Source (bản sao)");
  assert.equal(copy.amount, 100);
  assert.equal(copy.licenseType, "domain");
  assert.equal((await call(s, `/services/${copy.id}/history`, { cookie: owner.cookie })).body.history.length, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS count FROM service_reminders WHERE service_id=?").get(copy.id).count, 0);
});

test("bulk service actions are all-or-nothing and enforce expected dates", async (t) => {
  const s = await boot(t, { clock: fixedClock("2026-09-21T02:00:00.000Z") });
  const owner = await user(s, "service-bulk@example.test");
  const first = await call(s, "/services", { method: "POST", cookie: owner.cookie, body: { name: "Bulk one", nextDate: "2026-09-22", amount: 100 } });
  const second = await call(s, "/services", { method: "POST", cookie: owner.cookie, body: { name: "Bulk two", nextDate: "2026-09-23", amount: 200 } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  const a = first.body.service;
  const b = second.body.service;
  const failed = await call(s, "/services/bulk", {
    method: "POST",
    cookie: owner.cookie,
    body: { action: "renew", items: [{ id: a.id, expectedDate: a.nextDate }, { id: "service_missing", expectedDate: b.nextDate }] },
  });
  assert.equal(failed.status, 404);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS count FROM service_renewals").get().count, 0);
  assert.equal(s.db.prepare("SELECT archived_at FROM service_contracts WHERE id=?").get(a.id).archived_at, null);

  const archived = await call(s, "/services/bulk", {
    method: "POST",
    cookie: owner.cookie,
    body: { action: "archive", items: [{ id: a.id, expectedDate: a.nextDate }, { id: b.id, expectedDate: b.nextDate }] },
  });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.ok(s.db.prepare("SELECT archived_at FROM service_contracts WHERE id=?").get(a.id).archived_at);
  assert.ok(s.db.prepare("SELECT archived_at FROM service_contracts WHERE id=?").get(b.id).archived_at);
  const restored = await call(s, "/services/bulk", {
    method: "POST",
    cookie: owner.cookie,
    body: { action: "restore", items: [{ id: a.id }, { id: b.id }] },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(s.db.prepare("SELECT archived_at FROM service_contracts WHERE id=?").get(a.id).archived_at, null);
});

test("archived services require an exact name before permanent deletion", async (t) => {
  const s = await boot(t, { clock: fixedClock("2026-09-21T02:00:00.000Z") });
  const owner = await user(s, "service-delete@example.test");
  const created = await call(s, "/services", { method: "POST", cookie: owner.cookie, body: { name: "Delete me", nextDate: "2026-10-01", amount: 100 } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.service.id;
  assert.equal((await call(s, `/services/${id}`, { method: "DELETE", cookie: owner.cookie, body: { confirmName: "Delete me" } })).status, 409);
  assert.equal((await call(s, `/services/${id}/archive`, { method: "PUT", cookie: owner.cookie, body: { archived: true } })).status, 200);
  assert.equal((await call(s, `/services/${id}`, { method: "DELETE", cookie: owner.cookie, body: { confirmName: "delete me" } })).status, 400);
  const removed = await call(s, `/services/${id}`, { method: "DELETE", cookie: owner.cookie, body: { confirmName: "Delete me" } });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(s.db.prepare("SELECT 1 FROM service_contracts WHERE id=?").get(id), undefined);
});

test("legacy service API remains scoped and preserves interactions/history routes", async (t) => {
  const s = await boot(t, { clock: fixedClock("2026-09-21T02:00:00.000Z") });
  const owner = await user(s, "owner-service@example.test");
  const other = await user(s, "other-service@example.test");
  const created = await call(s, "/services", { method: "POST", cookie: owner.cookie, body: { name: "Bảo trì", nextDate: "2026-09-22", cycle: "month", amount: 100000 } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.service.id;
  assert.equal((await call(s, `/services/${id}/history`, { cookie: other.cookie })).status, 404);
  assert.equal((await call(s, `/services/${id}`, { method: "PATCH", cookie: owner.cookie, body: { nextDate: "2026-02-30" } })).status, 400);
  assert.equal((await call(s, `/services/${id}/archive`, { method: "PUT", cookie: owner.cookie, body: { archived: true } })).status, 200);
  assert.equal((await call(s, `/services/${id}/renew`, { method: "POST", cookie: owner.cookie, body: { expectedDate: "2026-09-22" } })).status, 409);
});
