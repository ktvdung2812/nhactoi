import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { createApp } from './database-helpers.mjs';
import { openDatabase } from './database-helpers.mjs';

const tempPaths = [];

async function boot({ transport, now = "2026-01-01T00:00:00.000Z" } = {}) {
  const path = `/tmp/nhactoi-mobile-${process.pid}-${tempPaths.length}-${Date.now()}.sqlite`;
  tempPaths.push(path);
  let current = new Date(now);
  const app = createApp({
    dbPath: path,
    clock: () => current,
    fcmTransport: transport,
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" },
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  return {
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    db: app.locals.db,
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

async function request(base, path, {
  method = "GET",
  body,
  rawBody,
  cookie,
  token,
  headers: extraHeaders = {},
} = {}) {
  const headers = {
    ...(body === undefined && rawBody === undefined ? {} : { "content-type": "application/json" }),
    ...extraHeaders,
  };
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: rawBody === undefined
      ? body === undefined
        ? undefined
        : JSON.stringify(body)
      : rawBody,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { response, json, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie || "" };
}

async function requestBytes(base, path, {
  method = "GET",
  rawBody,
  token,
  headers: extraHeaders = {},
} = {}) {
  const headers = { ...extraHeaders };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: rawBody,
  });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
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

async function mobileLogin(server, email) {
  const result = await request(server.base, "/api/mobile/auth/login", {
    method: "POST",
    body: { email, password: "password123" },
  });
  assert.equal(result.response.status, 200);
  return result.json;
}

test("mobile bearer sessions switch workspace in place and preserve web cookies", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "mobile-owner@example.test", "Chủ");
  assert.equal(owner.response.status, 201);
  const firstWorkspace = owner.json.workspace.id;
  const userId = owner.json.user.id;
  const secondWorkspace = "workspace_mobile_second";
  server.db.prepare("INSERT INTO workspaces(id,name,industry,created_at) VALUES (?,?,?,?)")
    .run(secondWorkspace, "Doanh nghiệp hai", "Dịch vụ", "2026-01-01T00:00:00.000Z");
  server.db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,?,?)")
    .run(secondWorkspace, userId, "member", "2026-01-01T00:00:00.000Z");
  server.db.prepare("INSERT INTO subscriptions(workspace_id,plan,cycle,status,current_period_end,updated_at) VALUES (?,?,?,?,?,?)")
    .run(secondWorkspace, "starter", "monthly", "active", "2030-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");

  const session = await mobileLogin(server, "mobile-owner@example.test");
  const stored = server.db.prepare("SELECT kind, token_hash FROM sessions WHERE user_id=?").all(userId);
  assert.ok(stored.some((row) => row.kind === "mobile"));
  assert.ok(!stored.some((row) => row.token_hash === session.token));

  const switched = await request(server.base, "/api/mobile/workspaces/switch", {
    method: "POST",
    token: session.token,
    body: { workspaceId: secondWorkspace },
  });
  assert.equal(switched.response.status, 200);
  assert.equal(switched.json.token, session.token);
  assert.equal(switched.json.workspace.id, secondWorkspace);
  const mobileMe = await request(server.base, "/api/me", { token: session.token });
  assert.equal(mobileMe.json.workspace.id, secondWorkspace);
  const webMe = await request(server.base, "/api/me", { cookie: owner.cookie });
  assert.equal(webMe.response.status, 200);
  assert.equal(webMe.json.workspace.id, firstWorkspace);
});

test("mobile devices are bound to the account and active mobile session", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const first = await register(server, "mobile-device-one@example.test", "Một");
  const second = await register(server, "mobile-device-two@example.test", "Hai");
  const firstSession = await mobileLogin(server, "mobile-device-one@example.test");
  const secondSession = await mobileLogin(server, "mobile-device-two@example.test");
  const registered = await request(server.base, "/api/mobile/devices/install-one", {
    method: "PUT",
    token: firstSession.token,
    body: { fcmToken: "fcm-shared-token", platform: "android" },
  });
  assert.equal(registered.response.status, 200);
  const collision = await request(server.base, "/api/mobile/devices/install-two", {
    method: "PUT",
    token: secondSession.token,
    body: { fcmToken: "fcm-shared-token", platform: "android" },
  });
  assert.equal(collision.response.status, 409);
  const foreignDelete = await request(server.base, "/api/mobile/devices/install-one", {
    method: "DELETE",
    token: secondSession.token,
  });
  assert.equal(foreignDelete.response.status, 404);
  const ownerDelete = await request(server.base, "/api/mobile/devices/install-one", {
    method: "DELETE",
    token: firstSession.token,
  });
  assert.equal(ownerDelete.response.status, 200);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM mobile_devices").get().n, 0);
  assert.ok(first.json.user.id !== second.json.user.id);
});

test("notification outbox is durable, retries failures, and rechecks revoked accounts", async (t) => {
  const attempts = [];
  const server = await boot({
    transport: async ({ token, notification }) => {
      attempts.push({ token, notification });
      if (token === "fcm-failing-token" && attempts.filter((item) => item.token === token).length === 1) throw new Error("temporary FCM outage");
      return { ok: true };
    },
  });
  t.after(() => server.close());
  const owner = await register(server, "mobile-push@example.test", "Push");
  const session = await mobileLogin(server, "mobile-push@example.test");
  const installation = await request(server.base, "/api/mobile/devices/push-install", {
    method: "PUT",
    token: session.token,
    body: { fcmToken: "fcm-push-token" },
  });
  assert.equal(installation.response.status, 200);
  const secondInstallation = await request(server.base, "/api/mobile/devices/push-install-two", {
    method: "PUT",
    token: session.token,
    body: { fcmToken: "fcm-failing-token" },
  });
  assert.equal(secondInstallation.response.status, 200);
  const taskResult = await request(server.base, "/api/tasks", {method:"POST",cookie:owner.cookie,body:{title:"Push task",dueAt:"2026-01-02T00:00:00Z"}});
  assert.equal(taskResult.response.status,201);
  const notificationId = "notification_mobile_outbox";
  server.db.prepare(
    `INSERT INTO notifications(id,workspace_id,user_id,type,title,message,entity_type,entity_id,created_at,task_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(notificationId, owner.json.workspace.id, owner.json.user.id, "task_reminder", "Nhắc", "Nội dung", "task", taskResult.json.task.id, "2026-01-01T00:00:00.000Z", taskResult.json.task.id);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 1);
  const firstRun = await server.app.locals.processNotificationOutbox();
  assert.deepEqual(firstRun, { processed: 1, sent: 0, failed: 1, skipped: 0 });
  assert.equal(server.db.prepare("SELECT status FROM notification_outbox WHERE id LIKE 'outbox_%'").get().status, "pending");
  server.setNow("2026-01-01T00:00:03.000Z");
  const secondRun = await server.app.locals.processNotificationOutbox();
  assert.equal(secondRun.sent, 1);
  assert.equal(attempts.length, 3);
  assert.equal(attempts.filter((item) => item.token === "fcm-push-token").length, 1);

  server.db.prepare("UPDATE users SET disabled_at=? WHERE id=?").run("2026-01-01T00:00:04.000Z", owner.json.user.id);
  const secondNotification = "notification_mobile_revoked";
  server.db.prepare(
    "INSERT INTO notifications(id,workspace_id,user_id,type,title,message,created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(secondNotification, owner.json.workspace.id, owner.json.user.id, "task_reminder", "Nhắc", "Nội dung", "2026-01-01T00:00:04.000Z");
  server.setNow("2026-01-01T00:00:05.000Z");
  const revokedRun = await server.app.locals.processNotificationOutbox();
  assert.equal(revokedRun.sent, 0);
  assert.equal(attempts.length, 3);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM mobile_devices").get().n, 0);
});

test("[SQLite legacy] mobile migration is additive and preserves legacy rows when replayed", () => {
  const path = `/tmp/nhactoi-mobile-migration-${process.pid}-${Date.now()}.sqlite`;
  let db = openDatabase(path);
  try {
    db.prepare("INSERT INTO users(id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)")
      .run("legacy-mobile-user", "Legacy", "legacy-mobile@example.test", "hash", "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)")
      .run("legacy-mobile-workspace", "Legacy", "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,?,?)")
      .run("legacy-mobile-workspace", "legacy-mobile-user", "owner", "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO sessions(id,token_hash,user_id,workspace_id,expires_at,created_at) VALUES (?,?,?,?,?,?)")
      .run("legacy-mobile-session", "legacy-token", "legacy-mobile-user", "legacy-mobile-workspace", "2030-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    // Replay the post-mobile migrations as if this were a legacy v18 file;
    // v19 service columns and v20 per-device delivery state must be additive.
    db.exec("DROP TABLE notification_outbox_deliveries");
    db.prepare("DELETE FROM schema_migrations WHERE version>=19").run();
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("SELECT name FROM users WHERE id=?").get("legacy-mobile-user").name, "Legacy");
    assert.equal(db.prepare("SELECT kind FROM sessions WHERE id=?").get("legacy-mobile-session").kind, "web");
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notification_outbox'").get());
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notification_outbox_deliveries'").get());
  } finally {
    db?.close();
    try { rmSync(path); } catch {}
  }
});

test("mobile notification access rechecks calendar event existence and team membership", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = await register(server, "mobile-calendar-owner@example.test", "Lịch chủ");
  const member = await register(server, "mobile-calendar-member@example.test", "Lịch thành viên");
  const memberSession = await mobileLogin(server, "mobile-calendar-member@example.test");
  const workspaceId = owner.json.workspace.id;
  const memberId = member.json.user.id;
  const now = "2026-01-01T00:00:00.000Z";
  const teamId = "mobile-calendar-acl-team";
  const eventId = "mobile-calendar-acl-event";
  const notificationId = "mobile-calendar-acl-notification";

  server.db.prepare(
    "INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES (?,?,?,?)",
  ).run(workspaceId, memberId, "member", now);
  server.db.prepare(
    `INSERT INTO teams(id,workspace_id,name,description,color,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(teamId, workspaceId, "Calendar ACL", "", "green", now, now);
  server.db.prepare(
    "INSERT INTO team_members(team_id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)",
  ).run(teamId, workspaceId, memberId, "member", now);
  server.db.prepare(
    `INSERT INTO calendar_events
      (id,workspace_id,team_id,title,description,starts_at,ends_at,remind_at,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(eventId, workspaceId, teamId, "Private calendar title", "Private calendar body", "2026-01-02T00:00:00.000Z", "2026-01-02T01:00:00.000Z", null, owner.json.user.id, now, now);
  server.db.prepare(
    `INSERT INTO notifications
      (id,workspace_id,user_id,type,title,message,entity_type,entity_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(notificationId, workspaceId, memberId, "calendar_event", "Private calendar title", "Private calendar body", "calendar_event", eventId, now);
  const switched = await request(server.base, "/api/mobile/workspaces/switch", {
    method: "POST",
    token: memberSession.token,
    body: { workspaceId },
  });
  assert.equal(switched.response.status, 200);

  const visible = await request(server.base, `/api/mobile/notifications?workspaceId=${workspaceId}`, {
    token: memberSession.token,
  });
  assert.equal(visible.response.status, 200);
  assert.equal(visible.json.notifications.find((item) => item.id === notificationId)?.title, "Private calendar title");
  const genericVisible = await request(server.base, "/api/notifications", { token: memberSession.token });
  assert.equal(genericVisible.response.status, 200);
  assert.equal(genericVisible.json.notifications.some((item) => item.id === notificationId), true);
  const dashboardVisible = await request(server.base, "/api/dashboard", { token: memberSession.token });
  assert.equal(dashboardVisible.response.status, 200);
  assert.equal(dashboardVisible.json.notifications.some((item) => item.id === notificationId), true);

  server.db.prepare("DELETE FROM team_members WHERE team_id=? AND user_id=?").run(teamId, memberId);
  const removedFromTeam = await request(server.base, `/api/mobile/notifications?workspaceId=${workspaceId}`, {
    token: memberSession.token,
  });
  assert.equal(removedFromTeam.response.status, 200);
  assert.equal(removedFromTeam.json.notifications.some((item) => item.id === notificationId), false);
  const genericRemovedFromTeam = await request(server.base, "/api/notifications", { token: memberSession.token });
  assert.equal(genericRemovedFromTeam.response.status, 200);
  assert.equal(genericRemovedFromTeam.json.notifications.some((item) => item.id === notificationId), false);
  const dashboardRemovedFromTeam = await request(server.base, "/api/dashboard", { token: memberSession.token });
  assert.equal(dashboardRemovedFromTeam.response.status, 200);
  assert.equal(dashboardRemovedFromTeam.json.notifications.some((item) => item.id === notificationId), false);
  const removedRead = await request(server.base, `/api/mobile/notifications/${notificationId}/read`, {
    method: "PATCH",
    token: memberSession.token,
  });
  assert.equal(removedRead.response.status, 404);
  const genericRemovedRead = await request(server.base, `/api/notifications/${notificationId}/read`, {
    method: "PATCH",
    token: memberSession.token,
  });
  assert.equal(genericRemovedRead.response.status, 404);

  server.db.prepare(
    "INSERT INTO team_members(team_id,workspace_id,user_id,role,created_at) VALUES (?,?,?,?,?)",
  ).run(teamId, workspaceId, memberId, "member", now);
  server.db.prepare("DELETE FROM calendar_events WHERE id=?").run(eventId);
  const deletedEvent = await request(server.base, `/api/mobile/notifications?workspaceId=${workspaceId}`, {
    token: memberSession.token,
  });
  assert.equal(deletedEvent.response.status, 200);
  assert.equal(deletedEvent.json.notifications.some((item) => item.id === notificationId), false);
  const deletedRead = await request(server.base, `/api/mobile/notifications/${notificationId}/read`, {
    method: "PATCH",
    token: memberSession.token,
  });
  assert.equal(deletedRead.response.status, 404);
});

test("notification outbox serializes overlapping workers per database", async (t) => {
  let entered;
  let release;
  const firstSend = new Promise((resolve) => { entered = resolve; });
  const sendGate = new Promise((resolve) => { release = resolve; });
  let sendCount = 0;
  const server = await boot({
    transport: async () => {
      sendCount += 1;
      entered();
      await sendGate;
      return { ok: true };
    },
  });
  t.after(() => server.close());
  const owner = await register(server, "mobile-overlap@example.test", "Chạy song song");
  const session = await mobileLogin(server, "mobile-overlap@example.test");
  const device = await request(server.base, "/api/mobile/devices/overlap-install", {
    method: "PUT",
    token: session.token,
    body: { fcmToken: "fcm-overlap-token" },
  });
  assert.equal(device.response.status, 200);
  const taskResult = await request(server.base, "/api/tasks", {method:"POST",cookie:owner.cookie,body:{title:"Overlap task",dueAt:"2026-01-02T00:00:00Z"}});
  assert.equal(taskResult.response.status,201);
  server.db.prepare(
    "INSERT INTO notifications(id,workspace_id,user_id,task_id,type,title,message,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run("mobile-overlap-notification", owner.json.workspace.id, owner.json.user.id, taskResult.json.task.id, "task_reminder", "Nhắc", "Nội dung", "2026-01-01T00:00:00.000Z");

  const first = server.app.locals.processNotificationOutbox();
  await firstSend;
  const second = server.app.locals.processNotificationOutbox();
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(sendCount, 1);
  assert.equal(firstResult.sent, 1);
  assert.equal(secondResult.processed, 0);
});

test("mobile bearer can use CRUD APIs while a different tenant is denied", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const first = await register(server, "mobile-crud-one@example.test", "CRUD một");
  const firstSession = await mobileLogin(server, "mobile-crud-one@example.test");
  const taskCreated = await request(server.base, "/api/tasks", {
    method: "POST",
    token: firstSession.token,
    body: {
      title: "Mobile CRUD task",
      description: "Created through the bearer API",
      dueAt: "2026-01-03T00:00:00.000Z",
    },
  });
  assert.equal(taskCreated.response.status, 201);
  const taskId = taskCreated.json.task.id;
  const taskRead = await request(server.base, `/api/tasks/${taskId}`, { token: firstSession.token });
  assert.equal(taskRead.response.status, 200);
  const taskUpdated = await request(server.base, `/api/tasks/${taskId}`, {
    method: "PATCH",
    token: firstSession.token,
    body: { title: "Mobile CRUD task updated" },
  });
  assert.equal(taskUpdated.response.status, 200);

  const checklistCreated = await request(server.base, `/api/tasks/${taskId}/checklists`, {
    method: "POST",
    token: firstSession.token,
    body: { title: "Release checklist" },
  });
  assert.equal(checklistCreated.response.status, 201);
  const checklistId = checklistCreated.json.checklist.id;
  const itemCreated = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items`, {
    method: "POST",
    token: firstSession.token,
    body: { title: "Verify mobile access" },
  });
  assert.equal(itemCreated.response.status, 201);
  const itemId = itemCreated.json.item.id;
  const itemUpdated = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`, {
    method: "PATCH",
    token: firstSession.token,
    body: { completed: true },
  });
  assert.equal(itemUpdated.response.status, 200);
  assert.equal(itemUpdated.json.item.completed, true);

  const commentCreated = await request(server.base, `/api/tasks/${taskId}/comments`, {
    method: "POST",
    token: firstSession.token,
    body: { body: "Mobile comment" },
  });
  assert.equal(commentCreated.response.status, 201);
  const commentId = commentCreated.json.comment.id;
  const commentUpdated = await request(server.base, `/api/tasks/${taskId}/comments/${commentId}`, {
    method: "PATCH",
    token: firstSession.token,
    body: { body: "Mobile comment updated" },
  });
  assert.equal(commentUpdated.response.status, 200);
  const commentDeleted = await request(server.base, `/api/tasks/${taskId}/comments/${commentId}`, {
    method: "DELETE",
    token: firstSession.token,
  });
  assert.equal(commentDeleted.response.status, 200);

  const fileCreated = await request(server.base, `/api/tasks/${taskId}/files`, {
    method: "POST",
    token: firstSession.token,
    rawBody: Buffer.from("mobile file contents"),
    headers: { "content-type": "application/octet-stream", "x-file-name": "mobile.txt" },
  });
  assert.equal(fileCreated.response.status, 201);
  const attachmentId = fileCreated.json.attachment.id;
  const fileRead = await requestBytes(server.base, `/api/tasks/${taskId}/attachments/${attachmentId}/download`, {
    token: firstSession.token,
  });
  assert.equal(fileRead.response.status, 200);
  assert.equal(fileRead.bytes.toString(), "mobile file contents");

  const detail = await request(server.base, `/api/tasks/${taskId}/detail`, { token: firstSession.token });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.task.title, "Mobile CRUD task updated");
  assert.equal(detail.json.checklists[0].items[0].completed, true);
  assert.equal(detail.json.attachments[0].id, attachmentId);

  const eventCreated = await request(server.base, "/api/calendar-events", {
    method: "POST",
    token: firstSession.token,
    body: {
      title: "Mobile calendar event",
      description: "Calendar CRUD",
      startsAt: "2026-01-04T00:00:00.000Z",
      endsAt: "2026-01-04T01:00:00.000Z",
      remindAt: null,
      teamId: null,
    },
  });
  assert.equal(eventCreated.response.status, 201);
  const eventId = eventCreated.json.id;
  const eventRead = await request(server.base, `/api/calendar-events/${eventId}`, { token: firstSession.token });
  assert.equal(eventRead.response.status, 200);
  const eventUpdated = await request(server.base, `/api/calendar-events/${eventId}`, {
    method: "PUT",
    token: firstSession.token,
    body: {
      title: "Mobile calendar event updated",
      description: "Calendar CRUD updated",
      startsAt: "2026-01-04T00:00:00.000Z",
      endsAt: "2026-01-04T02:00:00.000Z",
      remindAt: null,
      teamId: null,
    },
  });
  assert.equal(eventUpdated.response.status, 200);
  const eventReadUpdated = await request(server.base, `/api/calendar-events/${eventId}`, { token: firstSession.token });
  assert.equal(eventReadUpdated.json.event.title, "Mobile calendar event updated");

  const second = await register(server, "mobile-crud-two@example.test", "CRUD hai");
  const secondSession = await mobileLogin(server, "mobile-crud-two@example.test");
  for (const path of [
    `/api/tasks/${taskId}`,
    `/api/tasks/${taskId}/detail`,
    `/api/tasks/${taskId}/attachments/${attachmentId}/download`,
    `/api/calendar-events/${eventId}`,
  ]) {
    const denied = path.endsWith("/download")
      ? await requestBytes(server.base, path, { token: secondSession.token })
      : await request(server.base, path, { token: secondSession.token });
    assert.equal(denied.response.status, 404, `cross-tenant access should be denied for ${path}`);
  }
  assert.notEqual(first.json.workspace.id, second.json.workspace.id);

  const fileDeleted = await request(server.base, `/api/tasks/${taskId}/attachments/${attachmentId}`, {
    method: "DELETE",
    token: firstSession.token,
  });
  assert.equal(fileDeleted.response.status, 200);
  const itemDeleted = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`, {
    method: "DELETE",
    token: firstSession.token,
  });
  assert.equal(itemDeleted.response.status, 200);
  const checklistDeleted = await request(server.base, `/api/tasks/${taskId}/checklists/${checklistId}`, {
    method: "DELETE",
    token: firstSession.token,
  });
  assert.equal(checklistDeleted.response.status, 200);
  const eventDeleted = await request(server.base, `/api/calendar-events/${eventId}`, {
    method: "DELETE",
    token: firstSession.token,
  });
  assert.equal(eventDeleted.response.status, 200);
  const taskDeleted = await request(server.base, `/api/tasks/${taskId}`, {
    method: "DELETE",
    token: firstSession.token,
  });
  assert.equal(taskDeleted.response.status, 200);
});
