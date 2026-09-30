import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withTransaction } from './database-helpers.mjs';
import { createApp } from './database-helpers.mjs';

async function boot(dbPath = ":memory:") {
  const app = createApp({ dbPath, env: { NODE_ENV: "test" } });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app,
    base,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      app.locals.close();
    },
  };
}

function client(base) {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async request(path, { method = "GET", body } = {}) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return { status: response.status, body: await response.json() };
    },
  };
}

async function register(api, email, name, workspaceName) {
  const result = await api.request("/api/auth/register", {
    method: "POST",
    body: {
      email,
      name,
      password: "Tickets2026!",
      workspaceName,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

test("tickets isolate by requester and workspace, support expired workspaces, and reopen on customer reply", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const first = client(server.base);
  const second = client(server.base);
  const otherWorkspace = client(server.base);
  const firstUser = await register(first, "first-ticket@example.test", "Người Một", "Không gian Một");
  const secondUser = await register(second, "second-ticket@example.test", "Người Hai", "Không gian Riêng");
  server.app.locals.db
    .prepare(
      "INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)",
    )
    .run(firstUser.workspace.id, secondUser.user.id, new Date().toISOString());
  const switched = await second.request("/api/workspaces/switch", {
    method: "POST",
    body: { workspaceId: firstUser.workspace.id },
  });
  assert.equal(switched.status, 200, JSON.stringify(switched.body));
  await register(otherWorkspace, "other-ticket@example.test", "Người Ba", "Không gian Hai");

  const created = await first.request("/api/tickets", {
    method: "POST",
    body: {
      subject: "Không truy cập được hóa đơn",
      category: "billing",
      priority: "high",
      message: "Tôi cần hỗ trợ hóa đơn tháng này.",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const ticket = created.body.ticket;
  assert.equal(ticket.status, "open");
  assert.equal(ticket.messageCount, 1);
  assert.equal(created.body.messages[0].isStaff, false);
  assert.equal(created.body.events[0].type, "created");

  assert.equal((await second.request(`/api/tickets/${ticket.id}`)).status, 404);
  assert.equal((await otherWorkspace.request(`/api/tickets/${ticket.id}`)).status, 404);
  assert.equal((await second.request("/api/tickets")).body.total, 0);
  assert.equal((await otherWorkspace.request("/api/tickets")).body.total, 0);

  // Ticket support remains available when ordinary workspace writes are blocked.
  server.app.locals.db
    .prepare(
      "UPDATE subscriptions SET status = 'expired', current_period_end = '2020-01-01T00:00:00.000Z' WHERE workspace_id = ?",
    )
    .run(firstUser.workspace.id);
  server.app.locals.db
    .prepare("UPDATE workspaces SET suspended_at = ? WHERE id = ?")
    .run(new Date().toISOString(), firstUser.workspace.id);
  const supportWhileBlocked = await first.request("/api/tickets", {
    method: "POST",
    body: {
      subject: "Vẫn cần hỗ trợ",
      category: "account",
      priority: "normal",
      message: "Tài khoản vẫn cần hỗ trợ khi workspace bị khóa.",
    },
  });
  assert.equal(supportWhileBlocked.status, 201);
});

test("tenant validation, customer reopen, and platform-admin ticket workflow", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const customer = client(server.base);
  const platform = client(server.base);
  const customerData = await register(customer, "customer-ticket@example.test", "Khách hàng", "Workspace Tickets");
  const platformData = await register(platform, "platform-ticket@example.test", "Quản trị", "Platform Workspace");

  const forged = await customer.request("/api/tickets", {
    method: "POST",
    body: {
      subject: "Giả mạo",
      category: "technical",
      priority: "normal",
      message: "Không được gán trạng thái.",
      status: "resolved",
      authorId: platformData.user.id,
    },
  });
  assert.equal(forged.status, 400);

  const created = await customer.request("/api/tickets", {
    method: "POST",
    body: {
      subject: "Lỗi tài khoản",
      category: "account",
      priority: "normal",
      message: "Xin kiểm tra tài khoản.",
    },
  });
  assert.equal(created.status, 201);
  const ticketId = created.body.ticket.id;
  assert.equal(
    (await customer.request(`/api/tickets/${ticketId}/messages`, {
      method: "POST",
      body: { body: "resolved", status: "resolved", isStaff: true },
    })).status,
    400,
  );

  // Grant the second registered user platform-admin access after its session
  // was created; the middleware must read that flag from the current row.
  server.app.locals.db
    .prepare("UPDATE users SET is_platform_admin = 1 WHERE id = ?")
    .run(platformData.user.id);
  const adminList = await platform.request("/api/admin/tickets", {
    method: "GET",
  });
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.total, 1);
  assert.equal(adminList.body.items[0].requester.id, customerData.user.id);
  assert.deepEqual(adminList.body.counts, {
    open: 1,
    in_progress: 0,
    waiting_customer: 0,
    resolved: 0,
  });

  const adminReply = await platform.request(`/api/admin/tickets/${ticketId}/messages`, {
    method: "POST",
    body: { body: "Đã tiếp nhận.", status: "waiting_customer" },
  });
  assert.equal(adminReply.status, 201, JSON.stringify(adminReply.body));
  assert.equal(adminReply.body.ticket.status, "waiting_customer");
  assert.equal(adminReply.body.messages.at(-1).isStaff, true);
  assert.equal(adminReply.body.events.at(-1).type, "status");

  const adminPatch = await platform.request(`/api/admin/tickets/${ticketId}`, {
    method: "PATCH",
    body: { status: "resolved", priority: "high" },
  });
  assert.equal(adminPatch.status, 200, JSON.stringify(adminPatch.body));
  assert.equal(adminPatch.body.ticket.status, "resolved");
  assert.equal(adminPatch.body.ticket.priority, "high");
  assert.deepEqual(
    adminPatch.body.events.slice(-2).map((event) => event.type),
    ["status", "priority"],
  );

  const customerReply = await customer.request(`/api/tickets/${ticketId}/messages`, {
    method: "POST",
    body: { body: "Tôi đã bổ sung thông tin." },
  });
  assert.equal(customerReply.status, 201);
  assert.equal(customerReply.body.ticket.status, "open");
  assert.equal(customerReply.body.messages.at(-1).isStaff, false);

  assert.equal(
    (await platform.request(`/api/admin/tickets/${ticketId}`, { method: "GET" })).status,
    200,
  );
  assert.equal(
    (await platform.request(`/api/admin/tickets/${ticketId}`, {
      method: "PATCH",
      body: {},
    })).status,
    400,
  );
  assert.equal(
    (await customer.request("/api/tickets?status=bogus")).status,
    400,
  );
  assert.equal(
    (await customer.request("/api/tickets", {
      method: "POST",
      body: { subject: "", category: "other", priority: "low", message: "x" },
    })).status,
    400,
  );
});

test("ticket data survives a database restart and ticket writes remain transactional", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nhactoi-tickets-restart-"));
  const dbPath = join(dir, "tickets.sqlite");
  let firstServer;
  let secondServer;
  try {
    firstServer = await boot(dbPath);
    const first = client(firstServer.base);
    const account = await register(first, "restart-ticket@example.test", "Bền vững", "Lưu trữ");
    const created = await first.request("/api/tickets", {
      method: "POST",
      body: {
        subject: "Sau khi khởi động lại",
        category: "technical",
        priority: "low",
        message: "Giữ nguyên nội dung.",
      },
    });
    assert.equal(created.status, 201);
    const ticketId = created.body.ticket.id;
    await firstServer.close();

    secondServer = await boot(dbPath);
    const second = client(secondServer.base);
    const login = await second.request("/api/auth/login", {
      method: "POST",
      body: { email: "restart-ticket@example.test", password: "Tickets2026!" },
    });
    assert.equal(login.status, 200);
    const detail = await second.request(`/api/tickets/${ticketId}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.ticket.number, created.body.ticket.number);
    assert.equal(detail.body.messages[0].body, "Giữ nguyên nội dung.");

    const db = secondServer.app.locals.db;
    assert.throws(
      () =>
        withTransaction(db, () => {
          db.prepare("UPDATE tickets SET status = 'resolved' WHERE id = ?").run(ticketId);
          throw new Error("ticket rollback");
        }),
      /ticket rollback/,
    );
    assert.equal(
      db.prepare("SELECT status FROM tickets WHERE id = ?").get(ticketId).status,
      "open",
    );
    assert.equal(account.workspace.id, created.body.ticket.workspace.id);
  } finally {
    if (firstServer && !secondServer) firstServer.app.locals.close();
    if (secondServer) await secondServer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
