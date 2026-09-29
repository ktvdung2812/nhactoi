import {removeRoadmapSchema} from "./migration-helpers.mjs";
import {SCHEMA_VERSION} from "../server/db.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../server/index.mjs";
import { openDatabase } from "../server/db.mjs";

const tempPaths = [];

async function boot({ now = "2026-01-01T00:00:00.000Z" } = {}) {
  const path = `/tmp/nhactoi-task-detail-${process.pid}-${tempPaths.length}-${Date.now()}.sqlite`;
  tempPaths.push(path);
  let current = new Date(now);
  const app = createApp({
    dbPath: path,
    clock: () => current,
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" },
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

async function request(base, path, { method = "GET", body, cookie } = {}) {
  const headers = {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
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

async function register(server, email, name = "Người dùng") {
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

test("task detail migration is present on fresh and upgraded databases", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-task-detail-migration-"));
  const path = join(dir, "task-detail.sqlite");
  let db;
  try {
    db = openDatabase(path);
    assert.deepEqual(
      db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version),
      Array.from({length:SCHEMA_VERSION},(_,i)=>i+1),
    );
    for (const table of [
      "task_activity",
      "task_comments",
      "task_attachments",
      "task_checklist_items",
      "task_checklists",
    ]) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }
    db.close();
    db = null;

    // Simulate a v7 database by removing only the additive v8-v10 objects and
    // their migration markers. Reopening must apply all three exactly once.
    db = openDatabase(path);
    removeRoadmapSchema(db);
    db.exec("DROP TABLE task_activity");
    db.exec("DROP TABLE task_comments");
    db.exec("DROP TABLE task_attachments");
    db.exec("DROP TABLE task_checklist_items");
    db.exec("DROP TABLE task_checklists");
    db.exec("DROP TABLE task_file_cleanup");
    db.prepare("DELETE FROM schema_migrations WHERE version >= 8").run();
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, SCHEMA_VERSION);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM task_activity").get().count, 0);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("task details persist child records, truthful activity, and cascade only on purge", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "task-detail-owner@example.test", "Chủ");
  assert.equal(owner.response.status, 201);

  const created = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      title: "Chuẩn bị hợp đồng",
      description: "Gọi cho khách hàng",
      dueAt: "2026-01-02T09:00:00.000Z",
    },
  });
  assert.equal(created.response.status, 201);
  const taskId = created.json.task.id;

  const initial = await request(server.base, `/api/tasks/${taskId}/detail`, {
    cookie: owner.cookie,
  });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.json.task.createdByName, "Chủ");
  assert.equal(initial.json.task.assigneeName, null);
  assert.equal(initial.json.canWrite, true);
  assert.equal(initial.json.activity[0].action, "task_created");

  const checklist = await request(server.base, `/api/tasks/${taskId}/checklists`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Các bước" },
  });
  assert.equal(checklist.response.status, 201);
  const checklistId = checklist.json.checklist.id;
  const item = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Gửi báo giá" },
  });
  assert.equal(item.response.status, 201);
  const itemId = item.json.item.id;
  const editedItem = await request(
    server.base,
    `/api/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`,
    {
      method: "PATCH",
      cookie: owner.cookie,
      body: { completed: true, title: "Đã gửi báo giá" },
    },
  );
  assert.equal(editedItem.response.status, 200);
  assert.equal(editedItem.json.item.completed, true);

  const attachment = await request(server.base, `/api/tasks/${taskId}/attachments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Tài liệu hợp đồng", url: "https://example.com/contract" },
  });
  assert.equal(attachment.response.status, 201);
  const comment = await request(server.base, `/api/tasks/${taskId}/comments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { body: "Mình đã kiểm tra tài liệu." },
  });
  assert.equal(comment.response.status, 201);
  assert.equal(comment.json.comment.authorName, "Chủ");

  const updatedTask = await request(server.base, `/api/tasks/${taskId}`, {
    method: "PATCH",
    cookie: owner.cookie,
    body: { title: "Chuẩn bị hợp đồng mới", status: "doing" },
  });
  assert.equal(updatedTask.response.status, 200);

  const detail = await request(server.base, `/api/tasks/${taskId}/detail`, {
    cookie: owner.cookie,
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.task.title, "Chuẩn bị hợp đồng mới");
  assert.equal(detail.json.checklists[0].items[0].completed, true);
  assert.equal(detail.json.attachments[0].url, "https://example.com/contract");
  assert.equal(detail.json.comments[0].body, "Mình đã kiểm tra tài liệu.");
  assert.deepEqual(
    detail.json.activity.map((entry) => entry.action),
    [
      "task_created",
      "checklist_created",
      "checklist_item_added",
      "checklist_item_completed",
      "checklist_item_updated",
      "attachment_added",
      "comment_added",
      "task_updated",
    ],
  );
  assert.match(detail.json.activity.at(-1).summary, /tên công việc/);

  const invalidUrl = await request(server.base, `/api/tasks/${taskId}/attachments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Sai", url: "javascript:alert(1)" },
  });
  assert.equal(invalidUrl.response.status, 400);
  const invalidComment = await request(server.base, `/api/tasks/${taskId}/comments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { body: "x".repeat(5001) },
  });
  assert.equal(invalidComment.response.status, 400);

  const deleted = await request(server.base, `/api/tasks/${taskId}`, {
    method: "DELETE",
    cookie: owner.cookie,
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(
    (await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: owner.cookie })).response.status,
    404,
  );
  assert.equal(server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM task_comments WHERE task_id = ?").get(taskId).count, 1);

  const trash = await request(server.base, "/api/trash?type=task", { cookie: owner.cookie });
  const trashId = trash.json.items.find((item) => item.entityId === taskId).id;
  assert.equal(
    (await request(server.base, "/api/trash/restore", {
      method: "POST",
      cookie: owner.cookie,
      body: { ids: [trashId] },
    })).response.status,
    200,
  );
  const restored = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: owner.cookie });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.json.comments.length, 1);

  await request(server.base, `/api/tasks/${taskId}`, { method: "DELETE", cookie: owner.cookie });
  const secondTrash = await request(server.base, "/api/trash?type=task", { cookie: owner.cookie });
  const secondTrashId = secondTrash.json.items.find((item) => item.entityId === taskId).id;
  assert.equal(
    (await request(server.base, "/api/trash/purge", {
      method: "POST",
      cookie: owner.cookie,
      body: { confirmation: "XOA VINH VIEN", ids: [secondTrashId] },
    })).response.status,
    200,
  );
  assert.equal(server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM task_comments WHERE task_id = ?").get(taskId).count, 0);
  assert.equal(server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM task_activity WHERE task_id = ?").get(taskId).count, 0);
});

test("task detail applies team visibility, archive read-only, and tenant ownership", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "detail-team-owner@example.test", "Chủ team");
  const member = await register(server, "detail-team-member@example.test", "Thành viên");
  const outsider = await register(server, "detail-team-outsider@example.test", "Ngoài team");

  const invite = await request(server.base, "/api/invitations", {
    method: "POST",
    cookie: owner.cookie,
    body: { email: member.json.user.email, role: "member" },
  });
  const token = new URL(invite.json.inviteUrl).searchParams.get("invite");
  const accepted = await request(server.base, "/api/invitations/accept", {
    method: "POST",
    body: { token },
    cookie: member.cookie,
  });
  assert.equal(accepted.response.status, 200);
  member.cookie = accepted.cookie;

  const team = await request(server.base, "/api/teams", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      name: "Sản phẩm",
      description: "",
      color: "blue",
      members: [
        { userId: owner.json.user.id, role: "lead" },
        { userId: member.json.user.id, role: "member" },
      ],
    },
  });
  assert.equal(team.response.status, 201);
  const teamId = team.json.team.id;
  const task = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Việc của team", dueAt: "2026-01-02T09:00:00.000Z", teamId },
  });
  assert.equal(task.response.status, 201);
  const taskId = task.json.task.id;

  const visible = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: member.cookie });
  assert.equal(visible.response.status, 200);
  assert.equal(visible.json.canWrite, true);
  assert.equal(
    (await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: outsider.cookie })).response.status,
    404,
  );

  const archived = await request(server.base, `/api/teams/${teamId}`, {
    method: "PATCH",
    cookie: owner.cookie,
    body: { archived: true },
  });
  assert.equal(archived.response.status, 200);
  const archivedDetail = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: member.cookie });
  assert.equal(archivedDetail.response.status, 200);
  assert.equal(archivedDetail.json.canWrite, false);
  assert.equal(
    (await request(server.base, `/api/tasks/${taskId}/comments`, {
      method: "POST",
      cookie: member.cookie,
      body: { body: "Không thể sửa" },
    })).response.status,
    409,
  );

  const admin = await request(server.base, `/api/teams/${teamId}`, {
    method: "PATCH",
    cookie: owner.cookie,
    body: { archived: false },
  });
  assert.equal(admin.response.status, 200);
  const removed = await request(server.base, `/api/teams/${teamId}/members`, {
    method: "PUT",
    cookie: owner.cookie,
    body: { members: [{ userId: owner.json.user.id, role: "lead" }] },
  });
  assert.equal(removed.response.status, 200);
  assert.equal(
    (await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: member.cookie })).response.status,
    404,
  );

  const foreignTask = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: outsider.cookie,
    body: { title: "Ngoài workspace", dueAt: "2026-01-02T09:00:00.000Z" },
  });
  assert.equal(
    (await request(server.base, `/api/tasks/${foreignTask.json.task.id}/comments`, {
      method: "POST",
      cookie: owner.cookie,
      body: { body: "Không được" },
    })).response.status,
    404,
  );
});

test("task detail stays readable but reports canWrite false after subscription expiry", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "detail-expired@example.test", "Hết hạn");
  const task = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Lịch sử", dueAt: "2026-01-02T09:00:00.000Z" },
  });
  const taskId = task.json.task.id;
  server.app.locals.db.prepare("UPDATE subscriptions SET status = 'expired', current_period_end = ? WHERE workspace_id = ?").run("2025-12-31T00:00:00.000Z", owner.json.workspace.id);
  const detail = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: owner.cookie });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.canWrite, false);
  assert.equal(
    (await request(server.base, `/api/tasks/${taskId}/comments`, {
      method: "POST",
      cookie: owner.cookie,
      body: { body: "Bị chặn" },
    })).response.status,
    402,
  );
});

test("checklist items keep card-member assignees, dates, order, copy, and reminders", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "checklist-card@example.test", "Trần Minh");
  const created = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Plugin tính toán báo giá", dueAt: "2026-04-02T09:00:00.000Z", assigneeId: owner.json.user.id },
  });
  assert.equal(created.response.status, 201);
  const taskId = created.json.task.id;
  const checklist = await request(server.base, `/api/tasks/${taskId}/checklists`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Danh sách công việc" },
  });
  const checklistId = checklist.json.checklist.id;
  const item = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Lên ý tưởng và mô tả dự án" },
  });
  const itemId = item.json.item.id;
  const updated = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`, {
    method: "PATCH",
    cookie: owner.cookie,
    body: {
      startAt: "2026-04-01",
      dueAt: "2026-04-03",
      remindAt: "2020-01-01T00:00:00.000Z",
      assigneeIds: [owner.json.user.id],
    },
  });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.item.startAt, "2026-04-01");
  assert.deepEqual(updated.json.item.assigneeIds, [owner.json.user.id]);

  const outside = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`, {
    method: "PATCH",
    cookie: owner.cookie,
    body: { assigneeIds: ["user_not_on_card"] },
  });
  assert.equal(outside.response.status, 400);
  assert.equal(outside.json.error, "Người phụ trách mục checklist phải là thành viên của thẻ");
  const backwards = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`, {
    method: "PATCH",
    cookie: owner.cookie,
    body: { startAt: "2026-04-04" },
  });
  assert.equal(backwards.response.status, 400);
  assert.equal(backwards.json.error, "Ngày bắt đầu không được sau hạn chót");

  const second = await request(server.base, `/api/tasks/${taskId}/checklists`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Việc sau" },
  });
  const ordered = await request(server.base, `/api/tasks/${taskId}/checklists/order`, {
    method: "PUT",
    cookie: owner.cookie,
    body: { ids: [second.json.checklist.id, checklistId] },
  });
  assert.equal(ordered.response.status, 200, JSON.stringify(ordered.json));
  const copied = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/copy`, {
    method: "POST",
    cookie: owner.cookie,
    body: {},
  });
  assert.equal(copied.response.status, 201, JSON.stringify(copied.json));
  assert.equal(copied.json.checklist.items[0].startAt, "2026-04-01");
  assert.deepEqual(copied.json.checklist.items[0].assigneeIds, [owner.json.user.id]);

  const detail = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: owner.cookie });
  assert.deepEqual(detail.json.checklists.map((list) => list.id), [second.json.checklist.id, checklistId, copied.json.checklist.id]);
  assert.deepEqual(detail.json.checklistMembers.map((member) => member.id), [owner.json.user.id]);

  const sent = server.app.locals.processReminders();
  assert.equal(sent.filter((row) => row.checklistItemId === itemId).length, 1);
  assert.equal(server.app.locals.processReminders().filter((row) => row.checklistItemId === itemId).length, 0);

  const converted = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items/${itemId}/convert`, {
    method: "POST",
    cookie: owner.cookie,
    body: {},
  });
  assert.equal(converted.response.status, 201, JSON.stringify(converted.json));
  const card = await request(server.base, `/api/tasks/${converted.json.task.id}`, { cookie: owner.cookie });
  assert.equal(card.json.task.status, "todo");
  assert.equal(card.json.task.assigneeId, owner.json.user.id);
  assert.equal(card.json.task.dueAt, "2026-04-03T00:00:00.000Z");
});
