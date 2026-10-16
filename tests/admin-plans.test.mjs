import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { boot, call, user, addMember } from "./roadmap-helpers.mjs";
import { createApp } from './database-helpers.mjs';
import { migrateDatabase } from './database-helpers.mjs';
import { isValidRoute, readRoute } from "../src/routes.js";

const draft = { id: "enterprise", name: "Doanh nghiệp lớn", monthly: 1500000, yearly: 15000000, seats: 100, features: ["Hỗ trợ ưu tiên"], active: true, reason: "Bổ sung gói cho doanh nghiệp" };

test("plan catalog validates and persists admin changes, enforces seats and keeps audit", async (t) => {
  const s = await boot(t);
  const admin = await user(s, "admin-plans@example.test");
  const customer = await user(s, "customer-plans@example.test");
  assert.equal((await call(s, "/admin/plans")).status, 401);
  for (const method of ["GET", "POST", "PATCH"])
    assert.equal((await call(s, "/admin/plans" + (method === "PATCH" ? "/starter" : ""), { method, cookie: admin.cookie, ...(method !== "GET" ? { body: draft } : {}) })).status, 403);
  s.db.prepare("UPDATE users SET is_platform_admin = 1 WHERE id = ?").run(admin.user.id);
  const write = (path, body, method = "PATCH") => call(s, path, { method, cookie: admin.cookie, body });
  for (const body of [
    { ...draft, reason: "" }, { ...draft, id: "../bad" }, { ...draft, id: "a".repeat(21) },
    { ...draft, monthly: 0 }, { ...draft, yearly: 1.1 }, { ...draft, monthly: 1000000001 },
    { ...draft, seats: 0 }, { ...draft, active: "false" }, { ...draft, features: [""] },
    { ...draft, features: ["x".repeat(201)] }, { ...draft, features: Array(31).fill("Quyền lợi") },
  ]) assert.equal((await write("/admin/plans", body, "POST")).status, 400);
  const created = await write("/admin/plans", { ...draft, id: " enterprise " }, "POST");
  assert.equal(created.status, 201);
  const plan = created.body.plans.find((p) => p.id === draft.id);
  assert.deepEqual(plan.features, ["Hỗ trợ ưu tiên", "Tối đa 100 thành viên"]);
  assert.equal(plan.subscriptionCount, 0);
  assert.equal((await write("/admin/plans", draft, "POST")).status, 409);
  assert.equal((await write("/admin/plans/missing", { reason: "Không tồn tại" })).status, 404);
  assert.equal((await write("/admin/plans/enterprise", { id: "rename", reason: "Đổi mã gói" })).status, 400);
  const assigned = await write(`/admin/subscriptions/${customer.workspace.id}`, { plan: "enterprise", reason: "Đổi gói hỗ trợ" });
  assert.equal(assigned.status, 200);
  addMember(s, customer, admin);
  const before = s.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs").get().n;
  assert.equal((await write("/admin/plans/enterprise", { seats: 1, reason: "Hạ số chỗ" })).status, 409);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs").get().n, before);
  const updated = await write("/admin/plans/enterprise", { name: "Enterprise Plus", monthly: 1600000, features: Array(30).fill("Hỗ trợ"), active: false, reason: "Cập nhật danh mục" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.plans.find((p) => p.id === "enterprise").subscriptionCount, 1);
  // A normalized seat feature must not prevent subsequent edits at the limit.
  assert.equal((await write("/admin/plans/enterprise", { yearly: 16000000, reason: "Cập nhật giá năm" })).status, 200);
  assert.equal((await write(`/admin/subscriptions/${admin.workspace.id}`, { plan: "enterprise", reason: "Gán gói ngừng bán" })).status, 409);
  assert.equal((await write(`/admin/subscriptions/${customer.workspace.id}`, { status: "active", reason: "Hỗ trợ gói cũ" })).status, 200);
  const publicData = await call(s, "/billing", { cookie: customer.cookie });
  assert.equal(publicData.body.plans.some((p) => p.id === "enterprise"), false);
  assert.equal(publicData.body.subscription.plan, "enterprise");
  assert.equal(publicData.body.subscription.planName, "Enterprise Plus");
  assert.equal(publicData.body.subscription.status, "active");
  const session = await call(s, "/me", { cookie: customer.cookie });
  assert.deepEqual(session.body.subscription, publicData.body.subscription);
  const mobileLogin = await call(s, "/mobile/auth/login", { method: "POST", body: {
    email: "customer-plans@example.test", password: "Password123!", workspaceId: customer.workspace.id,
  } });
  assert.equal(mobileLogin.status, 200);
  assert.deepEqual(mobileLogin.body.subscription, publicData.body.subscription);
  const mobileResponse = await fetch(s.base + "/api/mobile/workspaces/switch", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${mobileLogin.body.token}` },
    body: JSON.stringify({ workspaceId: customer.workspace.id }),
  });
  assert.equal(mobileResponse.status, 200);
  assert.deepEqual((await mobileResponse.json()).subscription, publicData.body.subscription);
  const legacy = await call(s, "/admin/settings", { cookie: admin.cookie });
  assert.equal((await write("/admin/settings", { plans: legacy.body.plans.filter((p) => p.id !== "enterprise"), reason: "Thử xóa gói" })).status, 400);
  assert.equal((await write("/admin/settings", { plans: legacy.body.plans, reason: "Giữ cấu hình cũ" })).status, 200);
  assert.equal(s.app.locals.config.plans.find((p) => p.id === "enterprise").active, false);
  const reopened = createApp({ dbPath: join(s.dir, "test.sqlite"), env: { NODE_ENV: "test" } });
  t.after(() => reopened.locals.close());
  const persisted = reopened.locals.config.plans.find((p) => p.id === "enterprise");
  assert.equal(persisted.name, "Enterprise Plus");
  assert.equal(persisted.active, false);
  assert.equal(persisted.features.length, 31);
  const audit = s.db.prepare("SELECT * FROM admin_audit_logs WHERE action = 'plan.update' ORDER BY created_at DESC, id DESC LIMIT 1").get();
  assert.equal(audit.target_id, "enterprise");
  assert.equal(JSON.parse(audit.after_json).yearly, 16000000);
  assert.equal((await write("/admin/plans/enterprise", { active: true, reason: "Bật bán lại" })).status, 200);
  assert.equal((await call(s, "/billing", { cookie: customer.cookie })).body.plans.find((p) => p.id === "enterprise").monthlyPrice, 1600000);
  assert.equal(isValidRoute("/admin/plans"), true);
  assert.equal(readRoute("/admin/plans"), "admin/plans");
});

test("custom plan checkout preserves quotes and settles after the plan stops selling", async (t) => {
  let payment;
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    payment = { id: "payment_custom", externalId: body.externalId, totalAmount: body.totalAmount, currency: "VND", hostedUrl: "/pay/custom" };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: payment }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => provider.close(resolve)));
  const secret = "custom-plan-fixture";
  const s = await boot(t, { env: { NODE_ENV: "test", BILLGATE_API_URL: `http://127.0.0.1:${provider.address().port}`, BILLGATE_API_KEY: "test", BILLGATE_WEBHOOK_SECRET: secret } });
  const admin = await user(s, "checkout-plans@example.test");
  s.db.prepare("UPDATE users SET is_platform_admin = 1 WHERE id = ?").run(admin.user.id);
  const write = (path, body, method = "POST") => call(s, path, { method, cookie: admin.cookie, body });
  assert.equal((await write("/admin/plans", draft)).status, 201);
  const checkout = await write("/billing/checkout", { plan: "enterprise", cycle: "yearly" });
  assert.equal(checkout.status, 201);
  assert.equal(payment.totalAmount, draft.yearly);
  assert.equal((await write("/admin/plans/enterprise", { yearly: 20000000, active: false, reason: "Ngừng bán phiên bản cũ" }, "PATCH")).status, 200);
  assert.equal((await write("/billing/checkout", { plan: "enterprise", cycle: "yearly" })).status, 409);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM billing_orders").get().n, 1);
  const raw = JSON.stringify({ id: "evt_custom", event: "payment.paid", data: { payment: { ...payment, status: "paid", amountPaid: draft.yearly } } });
  const response = await fetch(s.base + "/api/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "x-billgate-event": "payment.paid", "x-billgate-signature": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }, body: raw });
  assert.equal(response.status, 200, await response.text());
  const order = s.db.prepare("SELECT * FROM billing_orders").get();
  assert.equal(order.amount, draft.yearly);
  assert.equal(order.status, "paid");
  assert.equal(s.db.prepare("SELECT plan FROM subscriptions WHERE workspace_id = ?").get(admin.workspace.id).plan, "enterprise");
});

test("[SQLite legacy] plan migration preserves existing billing rows, indexes and foreign keys", async (t) => {
  const s = await boot(t);
  const owner = await user(s, "migration-plans@example.test");
  s.db.prepare(`INSERT INTO billing_orders(id, workspace_id, plan, cycle, amount, status, provider_payment_id, created_at, checkout_url) VALUES ('old-order', ?, 'starter', 'monthly', 199000, 'pending', 'old-payment', '2026-01-01', 'https://example.test/pay')`).run(owner.workspace.id);
  const subscriptions = s.db.prepare("SELECT * FROM subscriptions").all();
  const orders = s.db.prepare("SELECT * FROM billing_orders").all();
  // Rebuild the exact legacy plan CHECK on a disposable database, then upgrade.
  for (const table of ["subscriptions", "billing_orders"]) {
    const sql = s.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
    const indexes = s.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table);
    s.db.exec(sql.replace(`CREATE TABLE "${table}"`, `CREATE TABLE ${table}_legacy`).replace("CHECK (length(plan) BETWEEN 1 AND 20)", "CHECK (plan IN ('starter', 'team', 'business'))"));
    s.db.exec(`INSERT INTO ${table}_legacy SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_legacy RENAME TO ${table};`);
    for (const { sql } of indexes) s.db.exec(sql);
  }
  s.db.exec("DELETE FROM schema_migrations WHERE version = 26");
  migrateDatabase(s.db);
  assert.deepEqual(s.db.prepare("SELECT * FROM subscriptions").all(), subscriptions);
  assert.deepEqual(s.db.prepare("SELECT * FROM billing_orders").all(), orders);
  assert.deepEqual(s.db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.throws(() => s.db.prepare("INSERT INTO billing_orders SELECT 'duplicate', workspace_id, plan, cycle, amount, currency, status, provider_payment_id, created_at, paid_at, checkout_url FROM billing_orders").run(), /UNIQUE/);
  s.db.prepare("UPDATE subscriptions SET plan = 'enterprise' WHERE workspace_id = ?").run(owner.workspace.id);
  migrateDatabase(s.db);
  assert.equal(s.db.prepare("SELECT plan FROM subscriptions").get().plan, "enterprise");
});
