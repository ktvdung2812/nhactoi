import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { rmSync } from "node:fs";

import { createApp } from "../server/index.mjs";

const tempPaths = [];

async function boot({ env = {}, now = "2026-01-01T00:00:00.000Z" } = {}) {
  const path = `/tmp/nhactoi-test-${process.pid}-${tempPaths.length}-${Date.now()}.sqlite`;
  tempPaths.push(path);
  let current = new Date(now);
  const app = createApp({
    dbPath: path,
    clock: () => current,
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173", ...env },
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  return {
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    setNow(value) {
      current = new Date(value);
    },
    async close() {
      app.locals.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      try {
        rmSync(path);
      } catch {}
    },
  };
}

async function request(
  base,
  path,
  { method = "GET", body, cookie, headers = {} } = {},
) {
  const requestHeaders = {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...headers,
  };
  if (cookie) requestHeaders.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { response, json, cookie: setCookie?.split(";")[0] || cookie || "" };
}

async function register(server, email, name = "Người dùng") {
  return request(server.base, "/api/auth/register", {
    method: "POST",
    body: {
      name,
      email,
      password: "password123",
      workspaceName: `${name} Workspace`,
      industry: "Dịch vụ",
    },
  });
}

test("registration, tenant isolation, and workspace switching", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const first = await register(server, "one@example.test", "Một");
  const second = await register(server, "two@example.test", "Hai");
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);

  const task = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: first.cookie,
    body: { title: "Riêng tư", dueAt: "2026-01-02T09:00:00.000Z" },
  });
  assert.equal(task.response.status, 201);
  const dashboard = await request(server.base, "/api/dashboard", {
    cookie: second.cookie,
  });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.json.tasks.length, 0);
  const crossTenant = await request(
    server.base,
    `/api/tasks/${task.json.task.id}`,
    {
      method: "PATCH",
      cookie: second.cookie,
      body: { title: "Không được sửa" },
    },
  );
  assert.equal(crossTenant.response.status, 404);

  const workspaces = await request(server.base, "/api/workspaces", {
    cookie: first.cookie,
  });
  assert.equal(workspaces.response.status, 200);
  assert.equal(workspaces.json.workspaces.length, 1);
  const deniedSwitch = await request(server.base, "/api/workspaces/switch", {
    method: "POST",
    cookie: first.cookie,
    body: { workspaceId: second.json.workspace.id },
  });
  assert.equal(deniedSwitch.response.status, 403);
});

test("finance permissions and dashboard visibility", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "owner@example.test", "Chủ");
  const invite = await request(server.base, "/api/invitations", {
    method: "POST",
    cookie: owner.cookie,
    body: { email: "member@example.test", role: "member" },
  });
  assert.equal(invite.response.status, 201);
  const token = new URL(invite.json.inviteUrl).searchParams.get("invite");
  const member = await request(server.base, "/api/invitations/accept", {
    method: "POST",
    body: { token, name: "Thành viên", password: "password123" },
  });
  assert.equal(member.response.status, 200);
  const denied = await request(server.base, "/api/transactions", {
    method: "POST",
    cookie: member.cookie,
    body: {
      type: "income",
      amount: 100000,
      title: "Không được ghi",
      date: "2026-01-01",
    },
  });
  assert.equal(denied.response.status, 403);
  const dashboard = await request(server.base, "/api/dashboard", {
    cookie: member.cookie,
  });
  assert.deepEqual(dashboard.json.transactions, []);
  const created = await request(server.base, "/api/transactions", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      type: "income",
      amount: 100000,
      title: "Doanh thu",
      date: "2026-01-01",
    },
  });
  assert.equal(created.response.status, 201);
  const memberAfter = await request(server.base, "/api/dashboard", {
    cookie: member.cookie,
  });
  assert.deepEqual(memberAfter.json.transactions, []);
});

test("recurrence uses Vietnamese calendar and reminder delivery is idempotent", async (t) => {
  const server = await boot({ now: "2026-01-30T18:00:00.000Z" });
  t.after(() => server.close());
  const owner = await register(server, "recurrence@example.test", "Lịch");
  const task = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      title: "Hạn cuối tháng",
      dueAt: "2026-01-30T18:00:00.000Z",
      remindAt: "2026-01-29T18:00:00.000Z",
      recurrence: "monthly",
    },
  });
  assert.equal(task.response.status, 201);
  const reminderOne = server.app.locals.processReminders();
  const reminderTwo = server.app.locals.processReminders();
  assert.equal(reminderOne.length, 1);
  assert.equal(reminderTwo.length, 0);
  const completed = await request(
    server.base,
    `/api/tasks/${task.json.task.id}`,
    {
      method: "PATCH",
      cookie: owner.cookie,
      body: { status: "done" },
    },
  );
  assert.equal(completed.response.status, 200);
  assert.equal(completed.json.nextTask.dueAt, "2026-02-27T18:00:00.000Z"); // Feb 28 01:00 ICT
  const repeated = await request(
    server.base,
    `/api/tasks/${task.json.task.id}`,
    {
      method: "PATCH",
      cookie: owner.cookie,
      body: { status: "todo" },
    },
  );
  assert.equal(repeated.response.status, 200);
  const completedAgain = await request(
    server.base,
    `/api/tasks/${task.json.task.id}`,
    {
      method: "PATCH",
      cookie: owner.cookie,
      body: { status: "done" },
    },
  );
  assert.equal(completedAgain.response.status, 200);
  assert.equal(completedAgain.json.nextTask, null);
});

test("signed BillGateway webhook matches payment and is idempotent", async (t) => {
  const secret = "test-webhook-secret";
  const server = await boot({ env: { BILLGATE_WEBHOOK_SECRET: secret } });
  t.after(() => server.close());
  const owner = await register(server, "billing@example.test", "Thanh toán");
  const db = server.app.locals.db;
  const orderId = "order_test_1";
  const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
  db.prepare(
    `
    INSERT INTO billing_orders(id, workspace_id, plan, cycle, amount, currency, status, provider_payment_id, created_at)
    VALUES (?, ?, 'team', 'monthly', 499000, 'VND', 'pending', 'payment_1', ?)
  `,
  ).run(orderId, owner.json.workspace.id, now);
  const before = db
    .prepare(
      "SELECT current_period_end FROM subscriptions WHERE workspace_id = ?",
    )
    .get(owner.json.workspace.id).current_period_end;
  const payload = JSON.stringify({
    id: "delivery_1",
    event: "payment.paid",
    project: { id: "project_test" },
    data: {
      payment: {
        id: "payment_1",
        externalId: orderId,
        status: "paid",
        totalAmount: 499000,
        amountPaid: 499000,
        currency: "VND",
      },
      transactionId: "bank_transaction_1",
    },
  });
  const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const response = await fetch(`${server.base}/api/billing/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-billgate-signature": signature,
    },
    body: payload,
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.extended, true);
  const duplicateResponse = await fetch(`${server.base}/api/billing/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-billgate-signature": signature,
    },
    body: payload,
  });
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicate.duplicate, true);
  const after = db
    .prepare(
      "SELECT current_period_end FROM subscriptions WHERE workspace_id = ?",
    )
    .get(owner.json.workspace.id).current_period_end;
  assert.notEqual(after, before);
  assert.equal(
    db.prepare("SELECT status FROM billing_orders WHERE id = ?").get(orderId)
      .status,
    "paid",
  );
});

test("mutating API checks Origin and expired subscriptions block writes", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "origin@example.test", "Origin");
  const forbidden = await request(server.base, "/api/customers", {
    method: "POST",
    cookie: owner.cookie,
    headers: { origin: "https://attacker.example" },
    body: { name: "Không" },
  });
  assert.equal(forbidden.response.status, 403);
  server.app.locals.db
    .prepare(
      `UPDATE subscriptions SET current_period_end = '2020-01-01T00:00:00.000Z', status = 'expired' WHERE workspace_id = ?`,
    )
    .run(owner.json.workspace.id);
  const blocked = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Bị chặn", dueAt: "2026-01-02T00:00:00Z" },
  });
  assert.equal(blocked.response.status, 402);
});

test("login remember me controls session cookie Max-Age and expiration", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  await register(server, "remember@example.test", "Ghi Nhớ");

  // Login without remember (remember: false)
  const loginNoRemember = await request(server.base, "/api/auth/login", {
    method: "POST",
    body: {
      email: "remember@example.test",
      password: "password123",
      remember: false,
    },
  });
  assert.equal(loginNoRemember.response.status, 200);
  const setCookieNoRemember = loginNoRemember.response.headers.get("set-cookie");
  assert.ok(setCookieNoRemember.includes("nt_session="));
  assert.equal(setCookieNoRemember.includes("Max-Age="), false);

  // Login with remember (remember: true)
  const loginRemember = await request(server.base, "/api/auth/login", {
    method: "POST",
    body: {
      email: "remember@example.test",
      password: "password123",
      remember: true,
    },
  });
  assert.equal(loginRemember.response.status, 200);
  const setCookieRemember = loginRemember.response.headers.get("set-cookie");
  assert.ok(setCookieRemember.includes("nt_session="));
  assert.ok(setCookieRemember.includes("Max-Age="));

  // Default login (omitted remember) defaults to true for backwards compatibility
  const loginDefault = await request(server.base, "/api/auth/login", {
    method: "POST",
    body: {
      email: "remember@example.test",
      password: "password123",
    },
  });
  assert.equal(loginDefault.response.status, 200);
  const setCookieDefault = loginDefault.response.headers.get("set-cookie");
  assert.ok(setCookieDefault.includes("Max-Age="));
});
