import {removeRoadmapSchema} from "./migration-helpers.mjs";
import {SCHEMA_VERSION} from './database-helpers.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, withTransaction } from './database-helpers.mjs';
import { createApp } from './database-helpers.mjs';

test("[SQLite legacy] existing version-1 database migrates without data loss; failed transactions roll back", () => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-migration-"));
  let db;
  try {
    const path = join(dir, "test.sqlite");
    db = openDatabase(path);
    db.prepare(
      "INSERT INTO workspaces(id,name,industry,created_at) VALUES (?,?,?,?)",
    ).run("existing", "Giữ dữ liệu", "Dịch vụ", new Date().toISOString());
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)",
    ).run(
      "existing-user",
      "Người dùng cũ",
      "old@example.test",
      "legacy-hash",
      new Date().toISOString(),
    );
    removeRoadmapSchema(db);
    // Reconstruct the prior schema in this disposable fixture, never the local DB.
    db.exec(
      `
        DROP INDEX IF EXISTS users_platform_admin_idx;
        DROP INDEX IF EXISTS users_disabled_idx;
        DROP INDEX IF EXISTS workspaces_suspended_idx;
        DROP INDEX IF EXISTS admin_audit_logs_created_idx;
        DROP INDEX IF EXISTS admin_audit_logs_target_idx;
        DROP INDEX IF EXISTS admin_audit_logs_actor_idx;
        DROP INDEX IF EXISTS tickets_requester_workspace_idx;
        DROP INDEX IF EXISTS tickets_workspace_status_idx;
        DROP INDEX IF EXISTS tickets_updated_idx;
        DROP INDEX IF EXISTS ticket_messages_ticket_idx;
        DROP INDEX IF EXISTS ticket_events_ticket_idx;
        DROP INDEX IF EXISTS teams_workspace_idx;
        DROP INDEX IF EXISTS team_members_workspace_user_idx;
        DROP INDEX IF EXISTS team_members_team_role_idx;
        DROP INDEX IF EXISTS tasks_team_idx;
        DROP TABLE IF EXISTS ticket_events;
        DROP TABLE IF EXISTS ticket_messages;
        DROP TABLE IF EXISTS tickets;
        DROP TABLE IF EXISTS ticket_sequence;
        DROP TABLE IF EXISTS team_members;
        DROP TABLE IF EXISTS teams;
        ALTER TABLE tasks DROP COLUMN team_id;
        DROP TABLE IF EXISTS task_activity;
        DROP TABLE IF EXISTS task_comments;
        DROP TABLE IF EXISTS task_attachments;
        DROP TABLE IF EXISTS task_checklist_items;
        DROP TABLE IF EXISTS task_checklists;
        DROP TABLE IF EXISTS task_file_cleanup;
        DROP TABLE IF EXISTS admin_audit_logs;
        ALTER TABLE users DROP COLUMN disabled_at;
        ALTER TABLE users DROP COLUMN is_platform_admin;
        ALTER TABLE workspaces DROP COLUMN suspended_at;
        ALTER TABLE billing_orders DROP COLUMN checkout_url;
        ALTER TABLE workspaces DROP COLUMN contact_email;
        ALTER TABLE workspaces DROP COLUMN phone;
        ALTER TABLE workspaces DROP COLUMN address;
        ALTER TABLE workspaces DROP COLUMN website;
        ALTER TABLE workspaces DROP COLUMN tax_code;
        ALTER TABLE workspaces DROP COLUMN note;
        DROP TABLE IF EXISTS app_settings;
        DROP TABLE IF EXISTS trash_items;
        DELETE FROM schema_migrations WHERE version >= 2;
      `,
    );
    db.close();
    db = openDatabase(path);
    assert.equal(
      db.prepare("SELECT name FROM workspaces WHERE id=?").get("existing").name,
      "Giữ dữ liệu",
    );
    const migratedUser = db
      .prepare("SELECT is_platform_admin, disabled_at FROM users WHERE id=?")
      .get("existing-user");
    assert.equal(migratedUser.is_platform_admin, 0);
    assert.equal(migratedUser.disabled_at, null);
    assert.ok(
      db
        .prepare("PRAGMA table_info(billing_orders)")
        .all()
        .some((c) => c.name === "checkout_url"),
    );
    assert.throws(
      () =>
        withTransaction(db, () => {
          db.prepare(
            "INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)",
          ).run("rollback", "Rollback", new Date().toISOString());
          throw new Error("test rollback");
        }),
      /test rollback/,
    );
    assert.equal(
      db.prepare("SELECT id FROM workspaces WHERE id=?").get("rollback"),
      undefined,
    );
    db.close();
    db = openDatabase(path);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,
      SCHEMA_VERSION,
    );
    assert.deepEqual(
      db
        .prepare("PRAGMA table_info(users)")
        .all()
        .filter((column) => ["is_platform_admin", "disabled_at"].includes(column.name))
        .map((column) => column.name),
      ["is_platform_admin", "disabled_at"],
    );
    assert.ok(
      db
        .prepare("PRAGMA table_info(workspaces)")
        .all()
        .some((column) => column.name === "suspended_at"),
    );
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_audit_logs'",
        )
        .get(),
    );
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tickets'",
        )
        .get(),
    );
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ticket_messages'",
        )
        .get(),
    );
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'teams'",
        )
        .get(),
    );
    assert.ok(
      db
        .prepare("PRAGMA table_info(tasks)")
        .all()
        .some((column) => column.name === "team_id"),
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("existing invitee signs in as self, switches workspace, and sees only its scoped reminders", async (t) => {
  const app = createApp({ dbPath: ":memory:", env: { NODE_ENV: "test" } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
  });
  function client() {
    let cookie = "";
    return async function request(path, body, method = body ? "POST" : "GET") {
      const response = await fetch(base + path, {
        method,
        headers: { "content-type": "application/json", cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return { status: response.status, body: await response.json() };
    };
  }
  const owner = client(),
    invitee = client(),
    anonymous = client();
  const reg = (email, name) => ({
    email,
    name,
    password: "WorkspaceTest2026!",
    workspaceName: name,
  });
  const a = await owner(
    "/api/auth/register",
    reg("a@example.test", "Không gian A"),
  );
  const b = await invitee(
    "/api/auth/register",
    reg("b@example.test", "Không gian B"),
  );
  const invitation = await owner("/api/invitations", {
    email: "b@example.test",
    role: "member",
  });
  assert.equal(invitation.status, 201);
  const token = new URL(invitation.body.inviteUrl).searchParams.get("invite");
  assert.equal(
    (
      await anonymous("/api/invitations/accept", {
        token,
        name: "Imposter",
        password: "OverwritePassword!",
      })
    ).status,
    401,
  );
  assert.equal(
    (await owner("/api/invitations/accept", { token })).status,
    401,
    "an admin cannot accept for a different existing user",
  );
  assert.equal(
    (await invitee("/api/invitations/accept", { token })).status,
    200,
  );
  assert.equal(
    (await invitee("/api/me")).body.workspace.id,
    a.body.workspace.id,
  );
  assert.equal((await invitee("/api/workspaces")).body.workspaces.length, 2);
  const task = await owner("/api/tasks", {
    title: "A only reminder",
    dueAt: new Date(Date.now() + 3600000).toISOString(),
    remindAt: new Date(Date.now() - 1000).toISOString(),
    assigneeId: b.body.user.id,
  });
  assert.equal(task.status, 201);
  app.locals.processReminders();
  const inA = await invitee("/api/dashboard");
  assert.equal(inA.body.notifications.length, 2);
  assert.ok(inA.body.notifications.some(n=>n.type === "task_update"));
  const notificationId = inA.body.notifications[0].id;
  assert.equal(
    (
      await invitee("/api/workspaces/switch", {
        workspaceId: b.body.workspace.id,
      })
    ).status,
    200,
  );
  const inB = await invitee("/api/dashboard");
  assert.equal(inB.body.tasks.length, 0);
  assert.equal(inB.body.notifications.length, 0);
  assert.equal(
    (await invitee(`/api/notifications/${notificationId}/read`, {}, "PATCH"))
      .status,
    404,
  );
  assert.equal(
    (await invitee("/api/invitations/accept", { token })).status,
    404,
    "invitation is single use",
  );
});

test("customer edits and completion with changed assignee retain the latest submitted values", async (t) => {
  const app = createApp({ dbPath: ":memory:", env: { NODE_ENV: "test" } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
  });
  let cookie = "";
  async function request(path, body, method = body ? "POST" : "GET") {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, body: await response.json() };
  }
  const owner = await request("/api/auth/register", {
    name: "Owner",
    email: "edits@example.test",
    password: "Regression2026!",
    workspaceName: "Edits",
  });
  const customer = await request("/api/customers", {
    name: "Khách mẫu",
    company: "Cũ",
    email: "client@example.test",
  });
  const updated = await request(
    `/api/customers/${customer.body.customer.id}`,
    { company: "Mới", email: "" },
    "PATCH",
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.customer.company, "Mới");
  assert.equal(updated.body.customer.email, "");
  assert.equal(
    (
      await request("/api/transactions", {
        title: "Invalid date",
        type: "income",
        amount: 100,
        date: "2026-02-31",
      })
    ).status,
    400,
  );
  const task = await request("/api/tasks", {
    title: "Cũ",
    description: "Cũ",
    recurrence: "weekly",
    dueAt: "2026-09-21T10:00:00.000Z",
  });
  const done = await request(
    `/api/tasks/${task.body.task.id}`,
    {
      title: "Mới",
      description: "Mới",
      assigneeId: owner.body.user.id,
      status: "done",
    },
    "PATCH",
  );
  assert.equal(done.status, 200);
  assert.equal(done.body.nextTask.title, "Mới");
  assert.equal(done.body.nextTask.description, "Mới");
  assert.equal(done.body.nextTask.assigneeId, owner.body.user.id);
});
