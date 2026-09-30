import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createApp } from './database-helpers.mjs';
import { openDatabase } from './database-helpers.mjs';

function request(base, path, { method = "GET", body, cookie, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  let requestBody = body;
  if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== "string") {
    requestHeaders["content-type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  if (cookie) requestHeaders.cookie = cookie;
  return fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
  }).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    return {
      response,
      json: data,
      cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || "",
    };
  });
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

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-task-files-"));
  const dbPath = join(dir, "files.sqlite");
  const uploadsA = join(dir, "uploads-a");
  const uploadsB = join(dir, "uploads-b");
  const app = createApp({
    dbPath,
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" },
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  let closed = false;
  async function stopForRestart() {
    if (closed) return;
    closed = true;
    app.locals.close();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  return {
    app,
    dbPath,
    uploadsA,
    uploadsB,
    base: `http://127.0.0.1:${server.address().port}`,
    stopForRestart,
    async close() {
      await stopForRestart();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function promotePlatformAdmin(server, userId) {
  server.app.locals.db.prepare("UPDATE users SET is_platform_admin = 1 WHERE id = ?").run(userId);
}

async function saveStorage(server, owner, localPath, maxFileSizeMb = 10) {
  const result = await request(server.base, "/api/admin/storage", {
    method: "PATCH",
    cookie: owner.cookie,
    body: { enabled: true, maxFileSizeMb, localPath, reason: "test storage update" },
  });
  assert.equal(result.response.status, 200);
  return result.json;
}

async function createTask(server, owner, title = "Tệp cần lưu") {
  const result = await request(server.base, "/api/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title, dueAt: "2030-01-02T09:00:00.000Z" },
  });
  assert.equal(result.response.status, 201);
  return result.json.task.id;
}

async function upload(server, taskId, owner, name, bytes) {
  return request(server.base, `/api/tasks/${taskId}/files`, {
    method: "POST",
    cookie: owner.cookie,
    body: bytes,
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": encodeURIComponent(name),
    },
  });
}

test("file attachments stream bytes, hide storage metadata, and enforce download headers", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "task-files-owner@example.test", "Chủ tệp");
  assert.equal(owner.response.status, 201);
  promotePlatformAdmin(server, owner.json.user.id);
  assert.deepEqual(
    await saveStorage(server, owner, server.uploadsA),
    { enabled: true, maxFileSizeMb: 10, localPath: server.uploadsA },
  );
  const taskId = await createTask(server, owner);
  const bytes = Buffer.from("nội dung nhị phân\0\xff", "utf8");
  const uploaded = await upload(server, taskId, owner, "hợp đồng.txt", bytes);
  assert.equal(uploaded.response.status, 201);
  assert.deepEqual(uploaded.json.attachment, {
    id: uploaded.json.attachment.id,
    title: "hợp đồng.txt",
    kind: "file",
    originalName: "hợp đồng.txt",
    sizeBytes: bytes.length,
    mimeType: "application/octet-stream",
    downloadUrl: `/api/tasks/${taskId}/attachments/${uploaded.json.attachment.id}/download`,
    createdAt: uploaded.json.attachment.createdAt,
    createdByName: "Chủ tệp",
  });
  assert.equal("storageRoot" in uploaded.json.attachment, false);
  assert.equal("storageKey" in uploaded.json.attachment, false);

  const detail = await request(server.base, `/api/tasks/${taskId}/detail`, { cookie: owner.cookie });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.attachments[0].kind, "file");
  const downloaded = await request(server.base, uploaded.json.attachment.downloadUrl, { cookie: owner.cookie });
  assert.equal(downloaded.response.status, 200);
  assert.deepEqual(downloaded.json, bytes);
  assert.equal(downloaded.response.headers.get("content-type"), "application/octet-stream");
  assert.equal(downloaded.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(downloaded.response.headers.get("cache-control"), "private, no-store");
  assert.match(downloaded.response.headers.get("content-disposition"), /attachment; filename="hop dong\.txt"/);
  assert.match(downloaded.response.headers.get("content-disposition"), /filename\*=UTF-8''/);
});

test("upload policy and file access enforce tenants and subscription expiry", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "task-files-boundary-owner@example.test", "Chủ");
  const outsider = await register(server, "task-files-boundary-outsider@example.test", "Ngoài");
  const taskId = await createTask(server, owner);
  const uploaded = await upload(server, taskId, owner, "boundary.bin", Buffer.from("boundary"));
  assert.equal(uploaded.response.status, 201);
  const url = uploaded.json.attachment.downloadUrl;
  assert.equal((await request(server.base, `/api/tasks/${taskId}/upload-policy`, { cookie: outsider.cookie })).response.status, 404);
  assert.equal((await request(server.base, url, { cookie: outsider.cookie })).response.status, 404);
  assert.equal((await request(server.base, url)).response.status, 401);

  // A read remains available after subscription expiry, while upload remains a write.
  server.app.locals.db.prepare("UPDATE subscriptions SET current_period_end = ? WHERE workspace_id = ?").run("2020-01-01T00:00:00.000Z", owner.json.workspace.id);
  assert.equal((await request(server.base, url, { cookie: owner.cookie })).response.status, 200);
  assert.equal((await upload(server, taskId, owner, "expired.bin", Buffer.from("x"))).response.status, 402);
});

test("delete, soft-delete/restore, purge, path changes, and restart clean file bytes", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "task-files-cleanup@example.test", "Dọn tệp");
  promotePlatformAdmin(server, owner.json.user.id);
  await saveStorage(server, owner, server.uploadsA);
  const taskId = await createTask(server, owner, "Dọn tệp trực tiếp");
  const first = await upload(server, taskId, owner, "first.bin", Buffer.from("first"));
  assert.equal(first.response.status, 201);
  const firstRow = server.app.locals.db.prepare("SELECT * FROM task_attachments WHERE id = ?").get(first.json.attachment.id);
  const firstPath = join(firstRow.storage_root, firstRow.storage_key);
  assert.equal(existsSync(firstPath), true);
  assert.equal((await request(server.base, `/api/tasks/${taskId}/attachments/${firstRow.id}`, { method: "DELETE", cookie: owner.cookie })).response.status, 200);
  assert.equal(existsSync(firstPath), false);

  const second = await upload(server, taskId, owner, "second.bin", Buffer.from("second"));
  const secondRow = server.app.locals.db.prepare("SELECT * FROM task_attachments WHERE id = ?").get(second.json.attachment.id);
  const secondPath = join(secondRow.storage_root, secondRow.storage_key);
  assert.equal(existsSync(secondPath), true);
  await saveStorage(server, owner, server.uploadsB);
  assert.equal((await request(server.base, second.json.attachment.downloadUrl, { cookie: owner.cookie })).response.status, 200);
  assert.equal(server.app.locals.db.prepare("SELECT storage_root FROM task_attachments WHERE id = ?").get(secondRow.id).storage_root, realpathSync(server.uploadsA));

  const softTask = await createTask(server, owner, "Khôi phục tệp");
  const soft = await upload(server, softTask, owner, "restore.bin", Buffer.from("restore"));
  const softRow = server.app.locals.db.prepare("SELECT * FROM task_attachments WHERE id = ?").get(soft.json.attachment.id);
  const softPath = join(softRow.storage_root, softRow.storage_key);
  await request(server.base, `/api/tasks/${softTask}`, { method: "DELETE", cookie: owner.cookie });
  assert.equal(existsSync(softPath), true);
  const trash = await request(server.base, "/api/trash?type=task", { cookie: owner.cookie });
  const trashId = trash.json.items.find((item) => item.entityId === softTask).id;
  assert.equal((await request(server.base, "/api/trash/restore", { method: "POST", cookie: owner.cookie, body: { ids: [trashId] } })).response.status, 200);
  assert.equal((await request(server.base, soft.json.attachment.downloadUrl, { cookie: owner.cookie })).response.status, 200);

  const purgeTask = await createTask(server, owner, "Xoá vĩnh viễn tệp");
  const purgedFile = await upload(server, purgeTask, owner, "purge.bin", Buffer.from("purge"));
  const purgedRow = server.app.locals.db.prepare("SELECT * FROM task_attachments WHERE id = ?").get(purgedFile.json.attachment.id);
  const purgedPath = join(purgedRow.storage_root, purgedRow.storage_key);
  await request(server.base, `/api/tasks/${purgeTask}`, { method: "DELETE", cookie: owner.cookie });
  const purgeTrash = await request(server.base, "/api/trash?type=task", { cookie: owner.cookie });
  const purgeId = purgeTrash.json.items.find((item) => item.entityId === purgeTask).id;
  assert.equal((await request(server.base, "/api/trash/purge", { method: "POST", cookie: owner.cookie, body: { confirmation: "XOA VINH VIEN", ids: [purgeId] } })).response.status, 200);
  assert.equal(existsSync(purgedPath), false);

  // The first file remains readable across an app restart after a root change.
  appRestart: {
    await server.stopForRestart();
    const reopened = createApp({ dbPath: server.dbPath, env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" } });
    const restarted = await new Promise((resolve) => {
      const value = reopened.listen(0, "127.0.0.1", () => resolve(value));
    });
    const base = `http://127.0.0.1:${restarted.address().port}`;
    const login = await request(base, "/api/auth/login", { method: "POST", body: { email: "task-files-cleanup@example.test", password: "password123" } });
    assert.equal(login.response.status, 200);
    const response = await request(base, second.json.attachment.downloadUrl, { cookie: login.cookie });
    assert.equal(response.response.status, 200);
    assert.deepEqual(response.json, Buffer.from("second"));
    reopened.locals.close();
    await new Promise((resolve, reject) => restarted.close((error) => (error ? reject(error) : resolve())));
  }
});

test("upload limits, disabled storage, admin guard and team boundaries reject invalid access", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "file-limits@example.test");
  assert.equal((await request(server.base, "/api/admin/storage", { cookie: owner.cookie })).response.status, 403);
  assert.equal((await request(server.base, "/api/admin/storage", { method: "PATCH", cookie: owner.cookie, body: { enabled: false, reason: "not admin" } })).response.status, 403);
  promotePlatformAdmin(server, owner.json.user.id);
  await saveStorage(server, owner, server.uploadsA, 1);
  const taskId = await createTask(server, owner);
  assert.equal((await upload(server, taskId, owner, "empty.txt", Buffer.alloc(0))).response.status, 400);
  assert.equal((await upload(server, taskId, owner, "large.bin", Buffer.alloc(1024 * 1024 + 1))).response.status, 413);
  assert.equal((await upload(server, taskId, owner, "../escape.txt", Buffer.from("x"))).response.status, 400);
  assert.equal((await request(server.base, "/api/admin/storage", { method: "PATCH", cookie: owner.cookie, body: { enabled: false, reason: "turn off upload" } })).response.status, 200);
  assert.equal((await upload(server, taskId, owner, "disabled.txt", Buffer.from("x"))).response.status, 503);
  assert.equal(server.app.locals.db.prepare("SELECT COUNT(*) AS n FROM task_attachments").get().n, 0);
  await saveStorage(server, owner, server.uploadsA, 1);
  const team = await request(server.base, "/api/teams", { method: "POST", cookie: owner.cookie, body: { name: "Private team", color: "green", members: [{ userId: owner.json.user.id, role: "lead" }] } });
  assert.equal(team.response.status, 201);
  const teamId = team.json.team.id;
  assert.equal((await request(server.base, `/api/tasks/${taskId}`, { method: "PATCH", cookie: owner.cookie, body: { teamId } })).response.status, 200);
  const file = await upload(server, taskId, owner, "team.txt", Buffer.from("team"));
  assert.equal(file.response.status, 201);
  const member = await register(server, "file-nonmember@example.test");
  const db = server.app.locals.db;
  db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,'member',?)").run(owner.json.workspace.id, member.json.user.id, new Date().toISOString());
  db.prepare("UPDATE sessions SET workspace_id=? WHERE user_id=?").run(owner.json.workspace.id, member.json.user.id);
  assert.equal((await request(server.base, file.json.attachment.downloadUrl, { cookie: member.cookie })).response.status, 404);
  assert.equal((await upload(server, taskId, member, "denied.txt", Buffer.from("x"))).response.status, 404);
  assert.equal((await request(server.base, `/api/teams/${teamId}`, { method: "PATCH", cookie: owner.cookie, body: { archived: true } })).response.status, 200);
  assert.equal((await request(server.base, file.json.attachment.downloadUrl, { cookie: owner.cookie })).response.status, 200);
  assert.equal((await upload(server, taskId, owner, "archived.txt", Buffer.from("x"))).response.status, 409);
});

test("[SQLite legacy] migration 9 adds file metadata and cleanup queue to a fresh database and survives reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-task-files-migration-"));
  const path = join(dir, "legacy.sqlite");
  let db = openDatabase(path);
  try {
    const old = db.prepare("SELECT kind, original_name, mime_type, size_bytes FROM task_attachments").get();
    assert.equal(old, undefined);
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("SELECT kind FROM task_attachments").get(), undefined);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'task_file_cleanup'").get());
    assert.deepEqual(
      db.prepare("SELECT name FROM pragma_table_info('task_attachments') WHERE name IN ('kind','original_name','mime_type','size_bytes','storage_root','storage_key') ORDER BY name").all().map((row) => row.name),
      ["kind", "mime_type", "original_name", "size_bytes", "storage_key", "storage_root"],
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
