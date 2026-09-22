import {removeRoadmapSchema} from "./migration-helpers.mjs";
import {SCHEMA_VERSION} from "../server/db.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createApp } from "../server/index.mjs";
import { openDatabase } from "../server/db.mjs";

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-trash-"));
  const dbPath = join(dir, "trash.sqlite");
  const app = createApp({
    dbPath,
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" },
  });
  const server = await new Promise((resolve) =>
    {
      const value = app.listen(0, "127.0.0.1", () => resolve(value));
    },
  );
  return {
    app,
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
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
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
  return {
    response,
    json,
    cookie: setCookie?.split(";")[0] || cookie || "",
  };
}

async function register(server, email, name) {
  return request(server.base, "/api/auth/register", {
    method: "POST",
    body: {
      name,
      email,
      password: "password123",
      workspaceName: `${name} Workspace`,
    },
  });
}

test("trash lists deleted records, restores dependencies atomically, and purges permanently", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "trash-owner@example.test", "Chủ");
  assert.equal(owner.response.status, 201);

  const customer = await request(server.base, "/api/customers", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Khách bị xoá", company: "Công ty" },
  });
  const task = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      title: "Công việc khôi phục",
      customerId: customer.json.customer.id,
      dueAt: "2026-01-02T09:00:00.000Z",
    },
  });
  const transaction = await request(server.base, "/api/transactions", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      type: "income",
      amount: 100000,
      title: "Giao dịch cần dọn",
      customerId: customer.json.customer.id,
      date: "2026-01-01",
    },
  });
  assert.equal(task.response.status, 201);
  assert.equal(transaction.response.status, 201);

  assert.equal(
    (
      await request(server.base, `/api/customers/${customer.json.customer.id}`, {
        method: "DELETE",
        cookie: owner.cookie,
      })
    ).response.status,
    200,
  );
  assert.equal(
    (
      await request(server.base, `/api/tasks/${task.json.task.id}`, {
        method: "DELETE",
        cookie: owner.cookie,
      })
    ).response.status,
    200,
  );
  assert.equal(
    (
      await request(server.base, `/api/transactions/${transaction.json.transaction.id}`, {
        method: "DELETE",
        cookie: owner.cookie,
      })
    ).response.status,
    200,
  );

  const listed = await request(server.base, "/api/trash");
  // The cookie belongs to the owner session created by registration.
  const ownerTrash = await request(server.base, "/api/trash", {
    cookie: owner.cookie,
  });
  assert.equal(listed.response.status, 401);
  assert.equal(ownerTrash.response.status, 200);
  assert.equal(ownerTrash.json.summary.total, 3);
  assert.equal(ownerTrash.json.summary.task, 1);
  assert.equal(ownerTrash.json.summary.customer, 1);
  assert.equal(ownerTrash.json.summary.transaction, 1);

  const taskItem = ownerTrash.json.items.find(
    (item) => item.entityId === task.json.task.id,
  );
  const customerItem = ownerTrash.json.items.find(
    (item) => item.entityId === customer.json.customer.id,
  );
  assert.equal(taskItem.canRestore, false);
  assert.match(taskItem.restoreBlockedReason, /khách hàng/i);

  const taskOnly = await request(server.base, "/api/trash/restore", {
    method: "POST",
    cookie: owner.cookie,
    body: { ids: [taskItem.id] },
  });
  assert.equal(taskOnly.response.status, 409);
  assert.equal(
    server.app.locals.db
      .prepare("SELECT deleted_at FROM tasks WHERE id = ?")
      .get(task.json.task.id).deleted_at !== null,
    true,
  );

  const restored = await request(server.base, "/api/trash/restore", {
    method: "POST",
    cookie: owner.cookie,
    body: { ids: [taskItem.id, customerItem.id] },
  });
  assert.deepEqual(restored.json, { restored: 2 });
  assert.equal(
    server.app.locals.db
      .prepare("SELECT deleted_at FROM tasks WHERE id = ?")
      .get(task.json.task.id).deleted_at,
    null,
  );

  const transactionItem = (
    await request(server.base, "/api/trash?type=transaction", {
      cookie: owner.cookie,
    })
  ).json.items[0];
  const invalidPurge = await request(server.base, "/api/trash/purge", {
    method: "POST",
    cookie: owner.cookie,
    body: { ids: [transactionItem.id], confirmation: "DELETE" },
  });
  assert.equal(invalidPurge.response.status, 400);
  const purged = await request(server.base, "/api/trash/purge", {
    method: "POST",
    cookie: owner.cookie,
    body: { ids: [transactionItem.id], confirmation: "XOA VINH VIEN" },
  });
  assert.deepEqual(purged.json, { purged: 1 });
  assert.equal(
    server.app.locals.db
      .prepare("SELECT id FROM transactions WHERE id = ?")
      .get(transaction.json.transaction.id),
    undefined,
  );
});

test("members see only their own visible task trash, never customer or finance trash", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "trash-member-owner@example.test", "Chủ");
  const invite = await request(server.base, "/api/invitations", {
    method: "POST",
    cookie: owner.cookie,
    body: { email: "trash-member@example.test", role: "member" },
  });
  assert.equal(invite.response.status, 201);
  const token = new URL(invite.json.inviteUrl).searchParams.get("invite");
  const member = await request(server.base, "/api/invitations/accept", {
    method: "POST",
    body: { token, name: "Thành viên", password: "password123" },
  });
  assert.equal(member.response.status, 200);

  const ownerTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Việc của chủ", dueAt: "2026-01-02T09:00:00.000Z" },
  });
  await request(server.base, `/api/tasks/${ownerTask.json.task.id}`, {
    method: "DELETE",
    cookie: owner.cookie,
  });
  const memberTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: member.cookie,
    body: { title: "Việc của thành viên", dueAt: "2026-01-03T09:00:00.000Z" },
  });
  await request(server.base, `/api/tasks/${memberTask.json.task.id}`, {
    method: "DELETE",
    cookie: member.cookie,
  });
  const customer = await request(server.base, "/api/customers", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Khách riêng" },
  });
  await request(server.base, `/api/customers/${customer.json.customer.id}`, {
    method: "DELETE",
    cookie: owner.cookie,
  });

  const memberTrash = await request(server.base, "/api/trash", {
    cookie: member.cookie,
  });
  assert.equal(memberTrash.response.status, 200);
  assert.deepEqual(
    memberTrash.json.items.map((item) => item.entityId),
    [memberTask.json.task.id],
  );
  assert.deepEqual(memberTrash.json.summary, {
    total: 1,
    task: 1,
    customer: 0,
    transaction: 0,
  });

  const ownerTrash = await request(server.base, "/api/trash", {
    cookie: owner.cookie,
  });
  assert.equal(ownerTrash.json.summary.total, 3);
});

test("opening an old database backfills legacy soft deletes for admins only", () => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-trash-migration-"));
  const dbPath = join(dir, "legacy.sqlite");
  let db = openDatabase(dbPath);
  const now = "2026-01-01T00:00:00.000Z";
  db.prepare(
    "INSERT INTO users(id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)",
  ).run("legacy-user", "Legacy", "legacy-trash@example.test", "hash", now);
  db.prepare(
    "INSERT INTO workspaces(id,name,industry,created_at) VALUES (?,?,?,?)",
  ).run("legacy-workspace", "Legacy", "", now);
  db.prepare(
    "INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,?,?)",
  ).run("legacy-workspace", "legacy-user", "owner", now);
  db.prepare(
    "INSERT INTO subscriptions(workspace_id,plan,cycle,status,current_period_end,updated_at) VALUES (?,?,?,?,?,?)",
  ).run("legacy-workspace", "starter", "monthly", "active", "2030-01-01", now);
  db.prepare(
    "INSERT INTO customers(id,workspace_id,name,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?)",
  ).run("legacy-customer", "legacy-workspace", "Legacy customer", now, now, now);
  // Simulate a version 6 database before the numbered trash migration.
  removeRoadmapSchema(db);
  db.exec("DROP TABLE trash_items");
  db.exec("DROP TABLE task_activity");
  db.exec("DROP TABLE task_comments");
  db.exec("DROP TABLE task_attachments");
  db.exec("DROP TABLE task_checklist_items");
  db.exec("DROP TABLE task_checklists");
  db.exec("DROP TABLE task_file_cleanup");
  db.prepare("DELETE FROM schema_migrations WHERE version >= 7").run();
  db.close();
  db = openDatabase(dbPath);
  const row = db
    .prepare(
      "SELECT entity_type, entity_id, deleted_by FROM trash_items WHERE workspace_id = ?",
    )
    .get("legacy-workspace");
  assert.deepEqual({ ...row }, {
    entity_type: "customer",
    entity_id: "legacy-customer",
    deleted_by: null,
  });
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("trash keeps tenants and batches isolated, checks archived or removed teams, and retains reminder deliveries", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const first = await register(server, "trash-boundary-one@example.test", "Một");
  const second = await register(server, "trash-boundary-two@example.test", "Hai");

  const firstTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: first.cookie,
    body: { title: "Mục tenant một", dueAt: "2026-01-02T09:00:00.000Z" },
  });
  await request(server.base, `/api/tasks/${firstTask.json.task.id}`, {
    method: "DELETE",
    cookie: first.cookie,
  });
  const firstItem = (
    await request(server.base, "/api/trash", { cookie: first.cookie })
  ).json.items[0];
  const crossTenantList = await request(server.base, "/api/trash", {
    cookie: second.cookie,
  });
  assert.deepEqual(crossTenantList.json.items, []);
  const crossTenantDetail = await request(
    server.base,
    `/api/trash/${firstItem.id}`,
    { cookie: second.cookie },
  );
  assert.equal(crossTenantDetail.response.status, 404);

  const secondTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: second.cookie,
    body: { title: "Mục tenant hai", dueAt: "2026-01-03T09:00:00.000Z" },
  });
  await request(server.base, `/api/tasks/${secondTask.json.task.id}`, {
    method: "DELETE",
    cookie: second.cookie,
  });
  const secondItem = (
    await request(server.base, "/api/trash", { cookie: second.cookie })
  ).json.items[0];
  const mixed = await request(server.base, "/api/trash/restore", {
    method: "POST",
    cookie: first.cookie,
    body: { ids: [firstItem.id, secondItem.id] },
  });
  assert.equal(mixed.response.status, 404);
  assert.notEqual(
    server.app.locals.db
      .prepare("SELECT deleted_at FROM tasks WHERE id = ?")
      .get(firstTask.json.task.id).deleted_at,
    null,
  );

  const invite = await request(server.base, "/api/invitations", {
    method: "POST",
    cookie: first.cookie,
    body: { email: "trash-boundary-member@example.test", role: "member" },
  });
  const member = await request(server.base, "/api/invitations/accept", {
    method: "POST",
    body: {
      token: new URL(invite.json.inviteUrl).searchParams.get("invite"),
      name: "Thành viên đội",
      password: "password123",
    },
  });
  const team = await request(server.base, "/api/teams", {
    method: "POST",
    cookie: first.cookie,
    body: {
      name: "Đội cần kiểm tra",
      color: "green",
      members: [
        { userId: first.json.user.id, role: "lead" },
        { userId: member.json.user.id, role: "member" },
      ],
    },
  });
  assert.equal(team.response.status, 201);
  const teamId = team.json.team.id;
  const archivedTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: first.cookie,
    body: {
      title: "Việc trong đội lưu trữ",
      teamId,
      dueAt: "2026-01-04T09:00:00.000Z",
    },
  });
  await request(server.base, `/api/tasks/${archivedTask.json.task.id}`, {
    method: "DELETE",
    cookie: first.cookie,
  });
  await request(server.base, `/api/teams/${teamId}`, {
    method: "PATCH",
    cookie: first.cookie,
    body: { archived: true },
  });
  const archivedItem = (
    await request(server.base, "/api/trash", { cookie: first.cookie })
  ).json.items.find((item) => item.entityId === archivedTask.json.task.id);
  assert.equal(archivedItem.canRestore, false);
  const archivedRestore = await request(server.base, "/api/trash/restore", {
    method: "POST",
    cookie: first.cookie,
    body: { ids: [archivedItem.id] },
  });
  assert.equal(archivedRestore.response.status, 409);
  assert.match(archivedRestore.json.error, /lưu trữ/i);

  await request(server.base, `/api/teams/${teamId}`, {
    method: "PATCH",
    cookie: first.cookie,
    body: { archived: false },
  });
  const removedMemberTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: first.cookie,
    body: {
      title: "Việc của thành viên đã rời đội",
      teamId,
      dueAt: "2026-01-05T09:00:00.000Z",
    },
  });
  await request(server.base, `/api/tasks/${removedMemberTask.json.task.id}`, {
    method: "DELETE",
    cookie: member.cookie,
  });
  await request(server.base, `/api/teams/${teamId}/members`, {
    method: "PUT",
    cookie: first.cookie,
    body: { members: [{ userId: first.json.user.id, role: "lead" }] },
  });
  const removedList = await request(server.base, "/api/trash", {
    cookie: member.cookie,
  });
  assert.equal(
    removedList.json.items.some(
      (item) => item.entityId === removedMemberTask.json.task.id,
    ),
    false,
  );
  const removedDirect = await request(
    server.base,
    `/api/trash/${
      (
        await request(server.base, "/api/trash", { cookie: first.cookie })
      ).json.items.find((item) => item.entityId === removedMemberTask.json.task.id).id
    }`,
    { cookie: member.cookie },
  );
  assert.equal(removedDirect.response.status, 404);

  const reminderTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: first.cookie,
    body: {
      title: "Lời nhắc giữ nguyên delivery",
      dueAt: "2026-01-01T09:00:00.000Z",
      remindAt: "2026-01-01T08:00:00.000Z",
    },
  });
  const sent = server.app.locals.processReminders();
  assert.equal(sent.length, 2);
  await request(server.base, `/api/tasks/${reminderTask.json.task.id}`, {
    method: "DELETE",
    cookie: first.cookie,
  });
  const reminderItem = (
    await request(server.base, "/api/trash", { cookie: first.cookie })
  ).json.items.find((item) => item.entityId === reminderTask.json.task.id);
  assert.deepEqual(
    (
      await request(server.base, "/api/trash/restore", {
        method: "POST",
        cookie: first.cookie,
        body: { ids: [reminderItem.id] },
      })
    ).json,
    { restored: 1 },
  );
  assert.equal(server.app.locals.processReminders().length, 0);
  assert.equal(
    server.app.locals.db
      .prepare("SELECT COUNT(*) AS n FROM task_reminder_deliveries WHERE task_id = ?")
      .get(reminderTask.json.task.id).n,
    2,
  );
});
