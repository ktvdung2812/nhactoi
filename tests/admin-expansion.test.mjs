import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from './database-helpers.mjs';
import { createId, hashPassword, hashToken } from "../server/auth.mjs";

async function boot({ env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-admin-expansion-"));
  const dbPath = join(dir, "admin.sqlite");
  const app = createApp({
    dbPath,
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
    env: {
      NODE_ENV: "test",
      FRONTEND_ORIGIN: "http://localhost:5173",
      PUBLIC_APP_URL: "http://localhost:5173",
      ...env,
    },
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  return {
    app,
    db: app.locals.db,
    dbPath,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      app.locals.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function request(base, path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return {
    response,
    json,
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || "",
  };
}

async function register(server, email, name) {
  return request(server.base, "/api/auth/register", {
    method: "POST",
    body: {
      name,
      email,
      password: "AdminExpansion2026!",
      workspaceName: `${name} Workspace`,
    },
  });
}

function makePlatformAdmin(server, id) {
  server.db
    .prepare("UPDATE users SET is_platform_admin = 1 WHERE id = ?")
    .run(id);
}

function insertUser(db, email, name = "Thành viên") {
  const id = createId("user_");
  db.prepare(
    "INSERT INTO users(id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    id,
    name,
    email,
    hashPassword("AdminExpansion2026!"),
    "2026-01-01T00:00:00.000Z",
  );
  return id;
}

test("admin detail endpoints expose support and billing data without tenant operations", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const admin = await register(server, "expansion-admin@example.test", "Quản trị");
  const target = await register(server, "expansion-target@example.test", "Mục tiêu");
  makePlatformAdmin(server, admin.json.user.id);

  const denied = await request(
    server.base,
    `/api/admin/users/${target.json.user.id}`,
    { cookie: target.cookie },
  );
  assert.equal(denied.response.status, 403);
  const workspaceDenied = await request(
    server.base,
    `/api/admin/workspaces/${target.json.workspace.id}`,
    { cookie: target.cookie },
  );
  assert.equal(workspaceDenied.response.status, 403);

  const openTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: target.cookie,
    body: {
      title: "Công việc đang mở",
      assigneeId: target.json.user.id,
      dueAt: "2026-01-04T00:00:00.000Z",
    },
  });
  assert.equal(openTask.response.status, 201);
  const completedTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: target.cookie,
    body: {
      title: "Công việc hoàn thành",
      assigneeId: target.json.user.id,
      dueAt: "2026-01-04T00:00:00.000Z",
    },
  });
  assert.equal(completedTask.response.status, 201);
  const completed = await request(
    server.base,
    `/api/tasks/${completedTask.json.task.id}`,
    { method: "PATCH", cookie: target.cookie, body: { status: "done" } },
  );
  assert.equal(completed.response.status, 200);
  const customer = await request(server.base, "/api/customers", {
    method: "POST",
    cookie: target.cookie,
    body: { name: "Khách hàng" },
  });
  assert.equal(customer.response.status, 201);
  const income = await request(server.base, "/api/transactions", {
    method: "POST",
    cookie: target.cookie,
    body: {
      type: "income",
      amount: 700000,
      title: "Thu nhập",
      date: "2026-01-01",
    },
  });
  assert.equal(income.response.status, 201);
  server.db
    .prepare(
      `INSERT INTO billing_orders
        (id, workspace_id, plan, cycle, amount, currency, status, provider_payment_id, created_at, paid_at)
       VALUES (?, ?, 'starter', 'monthly', 199000, 'VND', 'paid', ?, ?, ?)` ,
    )
    .run(
      "order_admin_scope",
      target.json.workspace.id,
      "payment_admin_scope",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

  const userDetail = await request(
    server.base,
    `/api/admin/users/${target.json.user.id}`,
    { cookie: admin.cookie },
  );
  assert.equal(userDetail.response.status, 200);
  assert.equal("stats" in userDetail.json, false);
  assert.equal("tasks" in userDetail.json, false);
  assert.equal("role" in userDetail.json.workspaces[0], false);
  assert.equal(userDetail.json.user.email, "expansion-target@example.test");
  assert.ok(userDetail.json.user.workspaceCount >= 1);
  assert.ok(Array.isArray(userDetail.json.audit));
  assert.equal(userDetail.json.workspaces[0].plan, "starter");
  assert.equal(userDetail.json.workspaces[0].status, "trialing");

  const duplicate = await request(
    server.base,
    `/api/admin/users/${target.json.user.id}/profile`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: { name: "Đổi tên", email: admin.json.user.email, reason: "Kiểm tra trùng" },
    },
  );
  assert.equal(duplicate.response.status, 409);
  assert.equal(
    server.db
      .prepare("SELECT COUNT(*) AS n FROM admin_audit_logs WHERE target_id = ?")
      .get(target.json.user.id).n,
    0,
  );

  const profile = await request(
    server.base,
    `/api/admin/users/${target.json.user.id}/profile`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: {
        name: "Mục tiêu đã sửa",
        email: "edited-target@example.test",
        reason: "Chuẩn hóa hồ sơ",
      },
    },
  );
  assert.equal(profile.response.status, 200);
  assert.equal(profile.json.user.name, "Mục tiêu đã sửa");
  assert.equal(profile.json.user.isPlatformAdmin, false);
  assert.equal(
    server.db
      .prepare("SELECT action FROM admin_audit_logs WHERE target_id = ?")
      .get(target.json.user.id).action,
    "user.profile.update",
  );

  const workspaceId = target.json.workspace.id;
  const workspaceDetail = await request(
    server.base,
    `/api/admin/workspaces/${workspaceId}`,
    { cookie: admin.cookie },
  );
  assert.equal(workspaceDetail.response.status, 200);
  assert.deepEqual(Object.keys(workspaceDetail.json.owner).sort(), [
    "email",
    "id",
    "name",
  ]);
  assert.equal(workspaceDetail.json.owner.email, "edited-target@example.test");
  assert.equal("stats" in workspaceDetail.json, false);
  assert.equal("members" in workspaceDetail.json, false);
  assert.equal(workspaceDetail.json.workspace.note, "");
  assert.equal(workspaceDetail.json.workspace.contactEmail, "");
  assert.equal(workspaceDetail.json.subscription.plan, "starter");
  assert.equal(workspaceDetail.json.subscription.memberCount, 1);
  assert.equal(workspaceDetail.json.orders[0].providerPaymentId, "payment_admin_scope");
  assert.ok(Array.isArray(workspaceDetail.json.audit));

  const workspaceList = await request(server.base, "/api/admin/workspaces", {
    cookie: admin.cookie,
  });
  assert.equal(workspaceList.response.status, 200);
  const listedWorkspace = workspaceList.json.items.find(
    (item) => item.id === workspaceId,
  );
  assert.ok(listedWorkspace);
  assert.equal("taskCount" in listedWorkspace, false);
  assert.equal("memberCount" in listedWorkspace, false);

  const workspaceProfile = await request(
    server.base,
    `/api/admin/workspaces/${workspaceId}/profile`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: {
        name: "Doanh nghiệp đã sửa",
        industry: "Dịch vụ",
        contactEmail: "contact@example.test",
        phone: "0900000000",
        address: "Hà Nội",
        website: "https://example.test/company",
        taxCode: "0101234567",
        note: "Ghi chú nội bộ",
        reason: "Cập nhật hồ sơ doanh nghiệp",
      },
    },
  );
  assert.equal(workspaceProfile.response.status, 200);
  assert.equal(workspaceProfile.json.workspace.website, "https://example.test/company");
  const invalidWebsite = await request(
    server.base,
    `/api/admin/workspaces/${workspaceId}/profile`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: { website: "https://user:password@example.test", reason: "Sai URL" },
    },
  );
  assert.equal(invalidWebsite.response.status, 400);
  const workspaceAfter = await request(
    server.base,
    `/api/admin/workspaces/${workspaceId}`,
    { cookie: admin.cookie },
  );
  assert.equal(workspaceAfter.json.workspace.name, "Doanh nghiệp đã sửa");
  assert.equal(workspaceAfter.json.workspace.contactEmail, "contact@example.test");
  assert.equal(workspaceAfter.json.workspace.note, "Ghi chú nội bộ");
  assert.equal("stats" in workspaceAfter.json, false);
  assert.equal("members" in workspaceAfter.json, false);
  assert.ok(
    workspaceAfter.json.audit.some(
      (row) => row.action === "workspace.profile.update",
    ),
  );
});

test("admin settings persist encrypted secrets, preserve quotes, and guard seats", async (t) => {
  const settingsKey = "admin-expansion-test-key";
  const server = await boot({
    env: {
      NHACTOI_SETTINGS_KEY: settingsKey,
      BILLGATE_API_URL: "https://env-gateway.example.test",
      BILLGATE_API_KEY: "env-api-key",
      BILLGATE_WEBHOOK_SECRET: "env-webhook-secret",
      BILLGATE_PROJECT_ID: "env-project",
      SMTP_HOST: "env-smtp.example.test",
      SMTP_PASS: "env-smtp-password",
      SMTP_FROM: "env@example.test",
    },
  });
  t.after(() => server.close());
  const admin = await register(server, "settings-admin@example.test", "Settings Admin");
  const target = await register(server, "settings-target@example.test", "Settings Target");
  makePlatformAdmin(server, admin.json.user.id);

  const denied = await request(server.base, "/api/admin/settings", {
    cookie: target.cookie,
  });
  assert.equal(denied.response.status, 403);
  const initial = await request(server.base, "/api/admin/settings", {
    cookie: admin.cookie,
  });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.json.billgateway.hasApiKey, true);
  assert.equal(initial.json.smtp.hasPassword, true);
  assert.equal("apiKey" in initial.json.billgateway, false);
  assert.equal("password" in initial.json.smtp, false);

  const workspaceId = admin.json.workspace.id;
  server.db
    .prepare(
      `INSERT INTO billing_orders
        (id, workspace_id, plan, cycle, amount, currency, status, created_at)
       VALUES (?, ?, 'starter', 'monthly', 199000, 'VND', 'pending', ?)` ,
    )
    .run("order_quoted_settings", workspaceId, "2026-01-01T00:00:00.000Z");

  const changedPlans = initial.json.plans.map((plan) => ({ ...plan }));
  changedPlans[0].monthly = 200000;
  const changed = await request(server.base, "/api/admin/settings", {
    method: "PATCH",
    cookie: admin.cookie,
    body: {
      publicAppUrl: "https://app.example.test",
      plans: changedPlans,
      billgateway: {
        apiUrl: "https://gateway.example.test",
        projectId: "project-new",
        apiKey: "secret-api-key",
        webhookSecret: "secret-webhook",
      },
      smtp: {
        host: "smtp.example.test",
        port: 465,
        secure: true,
        user: "smtp-user",
        from: "from@example.test",
        password: " secret-smtp-password ",
        enabled: true,
      },
      reason: "Cập nhật cấu hình",
    },
  });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.json.plans[0].monthly, 200000);
  assert.equal(changed.json.billgateway.hasApiKey, true);
  assert.equal(changed.json.smtp.hasPassword, true);
  assert.equal(JSON.stringify(changed.json).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(changed.json).includes("secret-smtp-password"), false);
  const stored = server.db
    .prepare("SELECT key, value, encrypted FROM app_settings ORDER BY key")
    .all();
  assert.ok(stored.some((row) => row.key === "billgateway.apiKey" && row.encrypted === 1));
  assert.equal(stored.some((row) => row.value.includes("secret-api-key")), false);
  assert.equal(stored.some((row) => row.value.includes("secret-smtp-password")), false);
  assert.equal(
    server.db
      .prepare("SELECT amount, status FROM billing_orders WHERE id = ?")
      .get("order_quoted_settings").amount,
    199000,
  );

  const repeated = await request(server.base, "/api/admin/settings", {
    method: "PATCH",
    cookie: admin.cookie,
    body: {
      plans: changed.json.plans,
      reason: "Khôi phục giá",
    },
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.json.plans[0].monthly, 200000);

  const memberIds = [
    insertUser(server.db, "settings-member-1@example.test"),
    insertUser(server.db, "settings-member-2@example.test"),
    insertUser(server.db, "settings-member-3@example.test"),
  ];
  for (const userId of memberIds)
    server.db
      .prepare(
        "INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)",
      )
      .run(workspaceId, userId, "2026-01-01T00:00:00.000Z");
  server.db
    .prepare(
      `INSERT INTO invitations
        (id, workspace_id, email, role, token_hash, expires_at, invited_by, created_at)
       VALUES (?, ?, ?, 'member', ?, ?, ?, ?)` ,
    )
    .run(
      "invite_settings_pending",
      workspaceId,
      "settings-pending@example.test",
      hashToken("settings-pending-token"),
      "2026-01-08T00:00:00.000Z",
      admin.json.user.id,
      "2026-01-01T00:00:00.000Z",
    );
  const tooSmall = changed.json.plans.map((plan) => ({ ...plan }));
  tooSmall[0].seats = 3;
  const rejected = await request(server.base, "/api/admin/settings", {
    method: "PATCH",
    cookie: admin.cookie,
    body: { plans: tooSmall, reason: "Hạ giới hạn chỗ" },
  });
  assert.equal(rejected.response.status, 409);
  assert.equal(
    server.db.prepare("SELECT amount, status FROM billing_orders WHERE id = ?").get("order_quoted_settings").status,
    "pending",
  );

  const hostCleared = await request(server.base, "/api/admin/settings", {
    method: "PATCH",
    cookie: admin.cookie,
    body: {
      smtp: { host: "", enabled: false },
      reason: "Tạm tắt SMTP",
    },
  });
  assert.equal(hostCleared.response.status, 200);
  assert.equal(hostCleared.json.smtp.enabled, false);
  assert.equal(hostCleared.json.smtp.hasPassword, true);
  const hostRestored = await request(server.base, "/api/admin/settings", {
    method: "PATCH",
    cookie: admin.cookie,
    body: {
      smtp: { host: "smtp.example.test", enabled: true, from: "from@example.test" },
      reason: "Bật lại SMTP",
    },
  });
  assert.equal(hostRestored.response.status, 200);
  assert.equal(hostRestored.json.smtp.enabled, true);
  assert.equal(hostRestored.json.smtp.hasPassword, true);
  assert.equal(server.app.locals.config.smtp.pass, " secret-smtp-password ");
  const reopened = createApp({
    dbPath: server.dbPath,
    env: { NODE_ENV: "test", NHACTOI_SETTINGS_KEY: settingsKey },
  });
  assert.equal(reopened.locals.config.smtp.pass, " secret-smtp-password ");
  assert.equal(reopened.locals.config.gatewayApiKey, "secret-api-key");
  assert.equal(reopened.locals.config.plans[0].monthlyPrice, 200000);
  reopened.locals.close();
  const auditJson = JSON.stringify(server.db.prepare("SELECT before_json, after_json FROM admin_audit_logs WHERE action = 'settings.update'").all());
  for (const secret of ["secret-api-key", "secret-webhook", "secret-smtp-password"])
    assert.equal(auditJson.includes(secret), false);


  const cleared = await request(server.base, "/api/admin/settings", {
    method: "PATCH",
    cookie: admin.cookie,
    body: {
      billgateway: { clearApiKey: true, clearWebhookSecret: true },
      smtp: { clearPassword: true, enabled: false },
      reason: "Xóa khóa tích hợp",
    },
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.json.billgateway.hasApiKey, false);
  assert.equal(cleared.json.smtp.hasPassword, false);
  assert.equal(cleared.json.smtp.enabled, false);
  assert.equal(JSON.stringify(cleared.json).includes(settingsKey), false);

  const app2 = createApp({
    dbPath: server.dbPath,
    env: {
      NODE_ENV: "test",
      FRONTEND_ORIGIN: "http://localhost:5173",
      NHACTOI_SETTINGS_KEY: settingsKey,
      BILLGATE_API_URL: "https://env-gateway.example.test",
      BILLGATE_API_KEY: "env-api-key",
      BILLGATE_WEBHOOK_SECRET: "env-webhook-secret",
      BILLGATE_PROJECT_ID: "env-project",
      SMTP_HOST: "env-smtp.example.test",
      SMTP_PASS: "env-smtp-password",
      SMTP_FROM: "env@example.test",
    },
  });
  assert.equal(app2.locals.config.publicAppUrl, "https://app.example.test");
  assert.equal(app2.locals.config.gatewayApiKey, "");
  assert.equal(app2.locals.config.smtp?.pass, "");
  assert.equal(app2.locals.config.frontendOrigins.includes("http://localhost:5173"), true);
  app2.locals.close();
});
