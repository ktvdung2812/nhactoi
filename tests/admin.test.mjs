import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from './database-helpers.mjs';
import { openDatabase } from './database-helpers.mjs';
import { createId, hashPassword } from "../server/auth.mjs";
import { runAdminCommand } from "../server/admin.mjs";

async function boot({ now = "2026-01-01T00:00:00.000Z" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-admin-"));
  const dbPath = join(dir, "admin.sqlite");
  let current = new Date(now);
  const app = createApp({
    dbPath,
    clock: () => current,
    env: {
      NODE_ENV: "test",
      FRONTEND_ORIGIN: "http://localhost:5173",
      PUBLIC_APP_URL: "http://localhost:5173",
    },
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  return {
    app,
    db: app.locals.db,
    base: `http://127.0.0.1:${server.address().port}`,
    setNow(value) {
      current = new Date(value);
    },
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
      // Synchronous fixture seeding blocks this same client/server event loop;
      // do not reuse an idle socket whose keep-alive timer expired meanwhile.
      connection: "close",
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
      password: "AdminTest2026!",
      workspaceName: `${name} Workspace`,
    },
  });
}

function makePlatformAdmin(server, email) {
  server.db
    .prepare("UPDATE users SET is_platform_admin = 1 WHERE email = ?")
    .run(email);
}

function insertUser(db, { email, name = "Thành viên" } = {}) {
  const id = createId("user_");
  db.prepare(
    "INSERT INTO users(id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, name, email, hashPassword("AdminTest2026!"), "2026-01-01T00:00:00.000Z");
  return id;
}

test("platform admin guard, lists, pagination, Unicode search, and settings", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const admin = await register(server, "admin@example.test", "Quản trị");
  const target = await register(server, "do@example.test", "Đỗ Nam");
  makePlatformAdmin(server, "admin@example.test");

  const denied = await request(server.base, "/api/admin/overview", {
    cookie: target.cookie,
  });
  assert.equal(denied.response.status, 403);

  const overview = await request(server.base, "/api/admin/overview", {
    cookie: admin.cookie,
  });
  assert.equal(overview.response.status, 200);
  assert.deepEqual(Object.keys(overview.json.stats).sort(), [
    "activeSubscriptions",
    "mrr",
    "paidRevenue",
    "pendingOrders",
    "suspendedWorkspaces",
    "users",
    "workspaces",
  ]);
  assert.ok(Array.isArray(overview.json.recentWorkspaces));
  assert.ok(Array.isArray(overview.json.recentOrders));
  for (const workspace of overview.json.recentWorkspaces) {
    assert.equal("taskCount" in workspace, false);
    assert.equal("memberCount" in workspace, false);
  }

  const users = await request(server.base, "/api/admin/users?q=do&page=1", {
    cookie: admin.cookie,
  });
  assert.equal(users.response.status, 200);
  assert.equal(users.json.total, 1);
  assert.equal(users.json.items[0].name, "Đỗ Nam");

  for (let index = 0; index < 21; index += 1)
    insertUser(server.db, {
      email: `list-${index}@example.test`,
      name: `Danh sách ${index}`,
    });
  const page = await request(server.base, "/api/admin/users?page=2", {
    cookie: admin.cookie,
  });
  assert.equal(page.response.status, 200);
  assert.equal(page.json.page, 2);
  assert.equal(page.json.pageSize, 20);
  assert.equal(page.json.total, 23);
  assert.equal(page.json.items.length, 3);

  for (const path of [
    "/api/admin/workspaces",
    "/api/admin/subscriptions",
    "/api/admin/orders",
    "/api/admin/audit",
  ]) {
    const result = await request(server.base, path, { cookie: admin.cookie });
    assert.equal(result.response.status, 200, path);
    assert.equal(result.json.pageSize, 20, path);
    assert.ok(Array.isArray(result.json.items), path);
  }
  for (const workspace of (
    await request(server.base, "/api/admin/workspaces", { cookie: admin.cookie })
  ).json.items) {
    assert.equal("taskCount" in workspace, false);
    assert.equal("memberCount" in workspace, false);
  }
  const settings = await request(server.base, "/api/admin/settings", {
    cookie: admin.cookie,
  });
  assert.equal(settings.response.status, 200);
  assert.equal(settings.json.smtpConfigured, false);
  assert.deepEqual(Object.keys(settings.json.plans[0]).sort(), [
    "id",
    "monthly",
    "name",
    "seats",
    "yearly",
  ]);

  // The session was created before this direct revocation; the guard must
  // query the current users row instead of trusting its old auth context.
  server.db
    .prepare("UPDATE users SET is_platform_admin = 0 WHERE email = ?")
    .run("admin@example.test");
  const stale = await request(server.base, "/api/admin/overview", {
    cookie: admin.cookie,
  });
  assert.equal(stale.response.status, 403);
});

test("suspension blocks tenant writes, invitation acceptance, and reminders while reads and billing remain available", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const admin = await register(server, "platform@example.test", "Platform Admin");
  const tenant = await register(server, "owner@example.test", "Chủ doanh nghiệp");
  makePlatformAdmin(server, "platform@example.test");
  const task = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: tenant.cookie,
    body: {
      title: "Nhắc sau khi mở lại",
      dueAt: "2026-01-03T00:00:00.000Z",
      remindAt: "2025-12-31T00:00:00.000Z",
    },
  });
  assert.equal(task.response.status, 201);
  const invitation = await request(server.base, "/api/invitations", {
    method: "POST",
    cookie: tenant.cookie,
    body: { email: "invitee@example.test", role: "member" },
  });
  assert.equal(invitation.response.status, 201);
  const token = new URLSearchParams(new URL(invitation.json.inviteUrl).hash.slice(1)).get("invite");

  const suspended = await request(
    server.base,
    `/api/admin/workspaces/${tenant.json.workspace.id}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: { suspended: true, reason: "Kiểm tra tạm ngưng" },
    },
  );
  assert.equal(suspended.response.status, 200);
  assert.ok(suspended.json.workspace.suspendedAt);

  const read = await request(server.base, "/api/dashboard", {
    cookie: tenant.cookie,
  });
  assert.equal(read.response.status, 200);
  const billing = await request(server.base, "/api/billing", {
    cookie: tenant.cookie,
  });
  assert.equal(billing.response.status, 200);
  const blockedWrite = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: tenant.cookie,
    body: { title: "Không được ghi", dueAt: "2026-01-04T00:00:00.000Z" },
  });
  assert.equal(blockedWrite.response.status, 423);
  const blockedAccept = await request(server.base, "/api/invitations/accept", {
    method: "POST",
    body: { token, name: "Người được mời", password: "AdminTest2026!" },
  });
  assert.equal(blockedAccept.response.status, 423);
  assert.deepEqual(server.app.locals.processReminders(), []);

  const me = await request(server.base, "/api/me", { cookie: tenant.cookie });
  assert.equal(me.response.status, 200);
  assert.ok(me.json.workspace.suspendedAt);
  const reactivated = await request(
    server.base,
    `/api/admin/workspaces/${tenant.json.workspace.id}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: { suspended: false, reason: "Tạm ngưng đã xử lý" },
    },
  );
  assert.equal(reactivated.response.status, 200);
  assert.equal(reactivated.json.workspace.suspendedAt, null);
  assert.equal(server.app.locals.processReminders().length, 1);
  const audit = await request(server.base, "/api/admin/audit?q=tạm ngưng", {
    cookie: admin.cookie,
  });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.json.total, 2);
});

test("disabled users lose sessions and reminders; admin mutation protections and subscription seat validation are atomic", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const admin = await register(server, "admin@example.test", "Admin");
  const target = await register(server, "target@example.test", "Target");
  const secondAdmin = await register(server, "second-admin@example.test", "Second Admin");
  makePlatformAdmin(server, "admin@example.test");
  makePlatformAdmin(server, "second-admin@example.test");

  const task = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: target.cookie,
    body: {
      title: "Lời nhắc người dùng bị khóa",
      dueAt: "2026-01-03T00:00:00.000Z",
      remindAt: "2025-12-31T00:00:00.000Z",
    },
  });
  assert.equal(task.response.status, 201);
  const disabled = await request(
    server.base,
    `/api/admin/users/${target.json.user.id}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: { disabled: true, reason: "Vi phạm chính sách" },
    },
  );
  assert.equal(disabled.response.status, 200);
  assert.ok(disabled.json.user.disabledAt);
  assert.equal((await request(server.base, "/api/me", { cookie: target.cookie })).response.status, 401);
  const loginDisabled = await request(server.base, "/api/auth/login", {
    method: "POST",
    body: { email: "target@example.test", password: "AdminTest2026!" },
  });
  assert.equal(loginDisabled.response.status, 403);
  assert.deepEqual(server.app.locals.processReminders(), []);

  const self = await request(
    server.base,
    `/api/admin/users/${admin.json.user.id}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: { disabled: true, reason: "Tự khóa" },
    },
  );
  assert.equal(self.response.status, 403);
  const protectedAdmin = await request(
    server.base,
    `/api/admin/users/${secondAdmin.json.user.id}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: { disabled: true, reason: "Khóa admin" },
    },
  );
  assert.equal(protectedAdmin.response.status, 403);
  const reactivated = await request(
    server.base,
    `/api/admin/users/${target.json.user.id}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: { disabled: false, reason: "Đã xử lý" },
    },
  );
  assert.equal(reactivated.response.status, 200);
  const loginAgain = await request(server.base, "/api/auth/login", {
    method: "POST",
    body: { email: "target@example.test", password: "AdminTest2026!" },
  });
  assert.equal(loginAgain.response.status, 200);

  const memberIds = [
    insertUser(server.db, { email: "seat-one@example.test" }),
    insertUser(server.db, { email: "seat-two@example.test" }),
  ];
  for (const memberId of memberIds)
    server.db
      .prepare(
        "INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)",
      )
      .run(tenantWorkspaceId(server, target), memberId, "2026-01-01T00:00:00.000Z");
  const workspaceId = target.json.workspace.id;
  server.db
    .prepare("UPDATE subscriptions SET plan = 'team' WHERE workspace_id = ?")
    .run(workspaceId);
  const pending = await request(server.base, "/api/invitations", {
    method: "POST",
    cookie: loginAgain.cookie,
    body: { email: "seat-pending@example.test", role: "member" },
  });
  assert.equal(pending.response.status, 201);
  const beforeAudits = server.db
    .prepare("SELECT COUNT(*) AS n FROM admin_audit_logs")
    .get().n;
  const rejectedPlan = await request(
    server.base,
    `/api/admin/subscriptions/${workspaceId}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: {
        plan: "starter",
        cycle: "monthly",
        status: "active",
        currentPeriodEnd: "2026-12-31T00:00:00.000Z",
        reason: "Hạ gói",
      },
    },
  );
  assert.equal(rejectedPlan.response.status, 409);
  assert.match(rejectedPlan.json.error, /thành viên|lời mời/);
  assert.equal(
    server.db.prepare("SELECT plan FROM subscriptions WHERE workspace_id = ?").get(workspaceId).plan,
    "team",
  );
  assert.equal(
    server.db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs").get().n,
    beforeAudits,
  );
  const invalid = await request(
    server.base,
    `/api/admin/subscriptions/${workspaceId}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: {
        plan: "unknown",
        cycle: "monthly",
        status: "active",
        currentPeriodEnd: "2026-12-31T00:00:00.000Z",
        reason: "Sai gói",
      },
    },
  );
  assert.equal(invalid.response.status, 400);
  const updated = await request(
    server.base,
    `/api/admin/subscriptions/${workspaceId}`,
    {
      method: "PATCH",
      cookie: admin.cookie,
      body: {
        plan: "business",
        cycle: "yearly",
        status: "active",
        currentPeriodEnd: "2027-01-01T00:00:00.000Z",
        reason: "Điều chỉnh gói",
      },
    },
  );
  assert.equal(updated.response.status, 200);
  const audit = await request(server.base, "/api/admin/audit?q=điều chỉnh", {
    cookie: admin.cookie,
  });
  assert.equal(audit.response.status, 200);
  assert.equal(audit.json.total, 1);
  assert.equal(audit.json.items[0].action, "subscription.update");
});

function tenantWorkspaceId(server, target) {
  return target.json.workspace.id;
}

test("admin CLI writes auditable grants and protects the last active admin and disabled accounts", () => {
  const db = openDatabase(":memory:");
  try {
    const first = insertUser(db, { email: "first@example.test", name: "First" });
    const second = insertUser(db, { email: "second@example.test", name: "Second" });
    const disabled = insertUser(db, { email: "disabled@example.test", name: "Disabled" });
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(
      "2026-01-01T00:00:00.000Z",
      disabled,
    );
    assert.equal(runAdminCommand({ db, command: "grant", email: "first@example.test" }).isPlatformAdmin, true);
    assert.equal(runAdminCommand({ db, command: "grant", email: "second@example.test" }).isPlatformAdmin, true);
    assert.equal(runAdminCommand({ db, command: "revoke", email: "first@example.test" }).isPlatformAdmin, false);
    assert.throws(
      () => runAdminCommand({ db, command: "revoke", email: "second@example.test" }),
      /cuối cùng/,
    );
    assert.throws(
      () => runAdminCommand({ db, command: "grant", email: "disabled@example.test" }),
      /bị khóa/,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM admin_audit_logs").get().n,
      3,
    );
  } finally {
    db.close();
  }
});
