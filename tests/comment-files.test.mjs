import {SCHEMA_VERSION} from "../server/db.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../server/index.mjs";
import { openDatabase } from "../server/db.mjs";

async function start(dbPath) {
  const app = createApp({
    dbPath,
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" },
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  return {
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      app.locals.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function request(base, path, { method = "GET", body, cookie, headers = {} } = {}) {
  const binary = Buffer.isBuffer(body);
  const requestHeaders = {
    ...(body === undefined || binary ? {} : { "content-type": "application/json" }),
    ...headers,
  };
  if (cookie) requestHeaders.cookie = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
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

async function createTask(server, owner, title) {
  const result = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title, dueAt: "2026-01-02T09:00:00.000Z" },
  });
  assert.equal(result.response.status, 201);
  return result.json.task.id;
}

async function upload(server, owner, taskId, name = "report.txt") {
  const result = await request(server.base, `/api/tasks/${taskId}/files`, {
    method: "POST",
    cookie: owner.cookie,
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(name),
    },
    body: Buffer.from(`file:${name}`),
  });
  assert.equal(result.response.status, 201);
  return result.json.attachment;
}

test("file comments are atomic, idempotent on retry, and survive restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-comment-files-"));
  const dbPath = join(dir, "comments.sqlite");
  let server = await start(dbPath);
  try {
    const owner = await register(server, "comment-files-owner@example.test", "Chủ tệp");
    assert.equal(owner.response.status, 201);
    const taskId = await createTask(server, owner, "Đính kèm báo cáo");
    const file = await upload(server, owner, taskId);

    const created = await request(server.base, `/api/tasks/${taskId}/comments`, {
      method: "POST",
      cookie: owner.cookie,
      body: { attachmentIds: [file.id] },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.comment.body, "");
    assert.deepEqual(created.json.comment.attachments, [file]);

    const retry = await request(server.base, `/api/tasks/${taskId}/comments`, {
      method: "POST",
      cookie: owner.cookie,
      body: { body: "", attachmentIds: [file.id] },
    });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.json.comment.id, created.json.comment.id);
    assert.equal(
      server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM task_comments WHERE task_id = ?").get(taskId).count,
      1,
    );

    const detail = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: owner.cookie });
    assert.equal(detail.response.status, 200);
    assert.deepEqual(detail.json.comments[0].attachments, [file]);
    assert.equal(detail.json.attachments.length, 1);

    await server.close();
    server = await start(dbPath);
    const loggedIn = await request(server.base, "/api/auth/login", {
      method: "POST",
      body: { email: "comment-files-owner@example.test", password: "password123" },
    });
    assert.equal(loggedIn.response.status, 200);
    const restarted = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: loggedIn.cookie });
    assert.equal(restarted.response.status, 200);
    assert.equal(restarted.json.comments[0].attachments[0].id, file.id);

    const deleted = await request(server.base, `/api/tasks/${taskId}/attachments/${file.id}`, {
      method: "DELETE",
      cookie: loggedIn.cookie,
    });
    assert.equal(deleted.response.status, 200);
    const afterDelete = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: loggedIn.cookie });
    assert.deepEqual(afterDelete.json.comments[0].attachments, []);
    assert.deepEqual(afterDelete.json.attachments, []);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file comment ownership and invalid IDs roll back without stealing files", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-comment-files-boundary-"));
  const dbPath = join(dir, "comments.sqlite");
  const server = await start(dbPath);
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const owner = await register(server, "comment-files-boundary-owner@example.test", "Chủ");
  const other = await register(server, "comment-files-boundary-other@example.test", "Khác");
  assert.equal(owner.response.status, 201);
  assert.equal(other.response.status, 201);
  const ownerTask = await createTask(server, owner, "Task chính");
  const otherTask = await createTask(server, other, "Task khác");
  const ownerFile = await upload(server, owner, ownerTask, "owner.txt");
  const otherFile = await upload(server, other, otherTask, "other.txt");

  const invalidMixed = await request(server.base, `/api/tasks/${ownerTask}/comments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { body: "Không được ghi dở dang", attachmentIds: [ownerFile.id, otherFile.id] },
  });
  assert.equal(invalidMixed.response.status, 400);
  assert.equal(server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM task_comments").get().count, 0);
  assert.equal(
    server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM task_attachments WHERE comment_id IS NOT NULL").get().count,
    0,
  );

  const invalidId = await request(server.base, `/api/tasks/${ownerTask}/comments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { body: "Cũng phải rollback", attachmentIds: [ownerFile.id, "attachment_missing"] },
  });
  assert.equal(invalidId.response.status, 400);
  const duplicate = await request(server.base, `/api/tasks/${ownerTask}/comments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { body: "Trùng", attachmentIds: [ownerFile.id, ownerFile.id] },
  });
  assert.equal(duplicate.response.status, 400);
  assert.equal(server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM task_comments").get().count, 0);

  // Put the second user in the owner's workspace to exercise current-user
  // ownership while preserving the normal task/workspace access checks.
  const db = server.app.locals.db;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)")
    .run(owner.json.workspace.id, other.json.user.id, now);
  db.prepare("UPDATE sessions SET workspace_id = ? WHERE user_id = ?")
    .run(owner.json.workspace.id, other.json.user.id);
  const stolen = await request(server.base, `/api/tasks/${ownerTask}/comments`, {
    method: "POST",
    cookie: other.cookie,
    body: { body: "Không lấy được", attachmentIds: [ownerFile.id] },
  });
  assert.equal(stolen.response.status, 400);
  assert.equal(db.prepare("SELECT comment_id FROM task_attachments WHERE id = ?").get(ownerFile.id).comment_id, null);
});

test("migration 10 adds comment links to a legacy v9 attachment without losing it", () => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-comment-files-migration-"));
  const dbPath = join(dir, "legacy.sqlite");
  let db = openDatabase(dbPath);
  try {
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare("INSERT INTO users(id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("legacy-user", "Legacy", "legacy-comment-files@example.test", "hash", now);
    db.prepare("INSERT INTO workspaces(id, name, industry, created_at) VALUES (?, ?, ?, ?)")
      .run("legacy-workspace", "Legacy", "", now);
    db.prepare("INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .run("legacy-workspace", "legacy-user", now);
    db.prepare("INSERT INTO tasks(id, workspace_id, title, description, status, priority, due_at, category, recurrence, created_by, created_at, updated_at) VALUES (?, ?, ?, '', 'todo', 'medium', ?, '', 'none', ?, ?, ?)")
      .run("legacy-task", "legacy-workspace", "Legacy task", "2030-01-01T00:00:00.000Z", "legacy-user", now, now);
    db.prepare("INSERT INTO task_attachments(id, task_id, title, url, kind, original_name, mime_type, size_bytes, storage_root, storage_key, created_by, created_at) VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?, ?, ?, ?)")
      .run("legacy-file", "legacy-task", "legacy.txt", "/api/tasks/legacy-task/attachments/legacy-file/download", "legacy.txt", "text/plain", 3, "/tmp", "legacy-file", "legacy-user", now);
    db.exec("DROP INDEX task_attachments_comment_idx");
    db.exec("ALTER TABLE task_attachments DROP COLUMN comment_id");
    db.prepare("DELETE FROM schema_migrations WHERE version = 10").run();
    db.close();
    db = openDatabase(dbPath);
    assert.equal(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get().version, SCHEMA_VERSION);
    assert.equal(db.prepare("SELECT title, kind, comment_id FROM task_attachments WHERE id = ?").get("legacy-file").title, "legacy.txt");
    assert.equal(db.prepare("SELECT comment_id FROM task_attachments WHERE id = ?").get("legacy-file").comment_id, null);
    assert.ok(db.prepare("SELECT name FROM pragma_table_info('task_attachments') WHERE name = 'comment_id'").get());
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
