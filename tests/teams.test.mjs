import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from './database-helpers.mjs';

async function boot() {
  let now = new Date("2026-09-21T12:00:00.000Z");
  const app = createApp({
    dbPath: ":memory:",
    clock: () => now,
    env: { NODE_ENV: "test" },
  });
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  return {
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    setNow(value) {
      now = new Date(value);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      app.locals.close();
    },
  };
}

function client(base) {
  let cookie = "";
  return {
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
      password: "Teams2026!",
      workspaceName,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

async function joinWorkspace(owner, member, email, role = "member") {
  const invitation = await owner.request("/api/invitations", {
    method: "POST",
    body: { email, role },
  });
  assert.equal(invitation.status, 201, JSON.stringify(invitation.body));
  const token = new URL(invitation.body.inviteUrl).searchParams.get("invite");
  const joined = await member.request("/api/invitations/accept", {
    method: "POST",
    body: { token },
  });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
}

test("team visibility, roster rules, task isolation, moving, and archive restore", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = client(server.base);
  const lead = client(server.base);
  const normal = client(server.base);
  const outsider = client(server.base);
  const ownerData = await register(owner, "team-owner@example.test", "Chủ nhóm", "Doanh nghiệp A");
  const leadData = await register(lead, "team-lead@example.test", "Trưởng nhóm", "Riêng");
  const normalData = await register(normal, "team-member@example.test", "Thành viên", "Riêng nữa");
  await register(outsider, "team-outsider@example.test", "Ngoài nhóm", "Doanh nghiệp B");
  await joinWorkspace(owner, lead, leadData.user.email);
  await joinWorkspace(owner, normal, normalData.user.email);

  const firstTeam = await owner.request("/api/teams", {
    method: "POST",
    body: {
      name: "Sản phẩm",
      description: "Nhóm xử lý sản phẩm",
      color: "blue",
      members: [
        { userId: ownerData.user.id, role: "lead" },
        { userId: leadData.user.id, role: "member" },
        { userId: normalData.user.id, role: "member" },
      ],
    },
  });
  assert.equal(firstTeam.status, 201, JSON.stringify(firstTeam.body));
  const team = firstTeam.body.team;
  assert.equal(team.memberCount, 3);
  assert.deepEqual(new Set(team.memberIds), new Set([ownerData.user.id, leadData.user.id, normalData.user.id]));
  assert.equal(team.canManage, true);
  assert.equal(team.canArchive, true);

  const visibleToLead = await lead.request("/api/teams");
  assert.equal(visibleToLead.status, 200);
  assert.equal(visibleToLead.body.teams.length, 1);
  assert.equal(visibleToLead.body.teams[0].myRole, "member");
  assert.equal(visibleToLead.body.teams[0].canManage, false);
  assert.equal((await outsider.request("/api/teams")).body.teams.length, 0);
  assert.equal((await outsider.request(`/api/teams/${team.id}`)).status, 404);

  const secondTeam = await owner.request("/api/teams", {
    method: "POST",
    body: {
      name: "Kinh doanh",
      description: "",
      color: "green",
      members: [{ userId: ownerData.user.id, role: "lead" }],
    },
  });
  assert.equal(secondTeam.status, 201);

  const common = await owner.request("/api/tasks", {
    method: "POST",
    body: {
      title: "Việc chung",
      dueAt: "2026-09-22T09:00:00.000Z",
    },
  });
  assert.equal(common.status, 201, JSON.stringify(common.body));
  const assigned = await owner.request("/api/tasks", {
    method: "POST",
    body: {
      title: "Việc sản phẩm",
      teamId: team.id,
      assigneeId: normalData.user.id,
      dueAt: "2026-09-22T10:00:00.000Z",
    },
  });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  assert.equal(assigned.body.task.teamId, team.id);
  assert.equal(assigned.body.task.teamName, "Sản phẩm");
  assert.equal(assigned.body.task.teamArchived, false);
  assert.equal((await lead.request("/api/tasks")).body.tasks.length, 2);
  assert.equal((await outsider.request("/api/tasks")).body.tasks.length, 0);
  assert.equal((await outsider.request(`/api/tasks/${assigned.body.task.id}`)).status, 404);

  const leadEdit = await lead.request(`/api/tasks/${assigned.body.task.id}`, {
    method: "PATCH",
    body: { title: "Việc sản phẩm đã nhận" },
  });
  assert.equal(leadEdit.status, 200, JSON.stringify(leadEdit.body));
  assert.equal(leadEdit.body.task.title, "Việc sản phẩm đã nhận");
  assert.equal(
    (
      await lead.request(`/api/tasks/${assigned.body.task.id}`, {
        method: "PATCH",
        body: { teamId: secondTeam.body.team.id },
      })
    ).status,
    403,
  );
  const moved = await owner.request(`/api/tasks/${assigned.body.task.id}`, {
    method: "PATCH",
    body: { teamId: secondTeam.body.team.id },
  });
  assert.equal(moved.status, 400, "moving must reject the old team assignee in the new team");
  const movedWithoutAssignee = await owner.request(`/api/tasks/${assigned.body.task.id}`, {
    method: "PATCH",
    body: { teamId: secondTeam.body.team.id, assigneeId: null },
  });
  assert.equal(movedWithoutAssignee.status, 200, JSON.stringify(movedWithoutAssignee.body));
  assert.equal(movedWithoutAssignee.body.task.teamId, secondTeam.body.team.id);

  // Restore the task to the first team so roster assignment checks exercise it.
  const back = await owner.request(`/api/tasks/${assigned.body.task.id}`, {
    method: "PATCH",
    body: { teamId: team.id, assigneeId: normalData.user.id },
  });
  assert.equal(back.status, 200, JSON.stringify(back.body));

  const promote = await owner.request(`/api/teams/${team.id}/members`, {
    method: "PUT",
    body: {
      members: [
        { userId: ownerData.user.id, role: "lead" },
        { userId: leadData.user.id, role: "lead" },
        { userId: normalData.user.id, role: "member" },
      ],
    },
  });
  assert.equal(promote.status, 200, JSON.stringify(promote.body));
  const forbiddenLeadChange = await lead.request(`/api/teams/${team.id}/members`, {
    method: "PUT",
    body: {
      members: [
        { userId: ownerData.user.id, role: "lead" },
        { userId: leadData.user.id, role: "lead" },
        { userId: normalData.user.id, role: "lead" },
      ],
    },
  });
  assert.equal(forbiddenLeadChange.status, 403);
  const blockedRemoval = await lead.request(`/api/teams/${team.id}/members`, {
    method: "PUT",
    body: [
      { userId: ownerData.user.id, role: "lead" },
      { userId: leadData.user.id, role: "lead" },
    ],
  });
  assert.equal(blockedRemoval.status, 400);
  const blockedAssignedRemoval = await lead.request(`/api/teams/${team.id}/members`, {
    method: "PUT",
    body: {
      members: [
        { userId: ownerData.user.id, role: "lead" },
        { userId: leadData.user.id, role: "lead" },
      ],
    },
  });
  assert.equal(blockedAssignedRemoval.status, 409);
  const done = await owner.request(`/api/tasks/${assigned.body.task.id}`, {
    method: "PATCH",
    body: { status: "done" },
  });
  assert.equal(done.status, 200);
  const removed = await lead.request(`/api/teams/${team.id}/members`, {
    method: "PUT",
    body: {
      members: [
        { userId: ownerData.user.id, role: "lead" },
        { userId: leadData.user.id, role: "lead" },
      ],
    },
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const historicalEdit = await lead.request(`/api/tasks/${assigned.body.task.id}`, {
    method: "PATCH",
    body: { title: "Lịch sử sau khi thành viên rời nhóm" },
  });
  assert.equal(historicalEdit.status, 200, JSON.stringify(historicalEdit.body));
  assert.equal(historicalEdit.body.task.assigneeId, normalData.user.id);
  const reopenWithoutReassignment = await lead.request(
    `/api/tasks/${assigned.body.task.id}`,
    { method: "PATCH", body: { status: "todo" } },
  );
  assert.equal(reopenWithoutReassignment.status, 400);
  const reopenAfterClear = await lead.request(`/api/tasks/${assigned.body.task.id}`, {
    method: "PATCH",
    body: { status: "todo", assigneeId: null },
  });
  assert.equal(reopenAfterClear.status, 200, JSON.stringify(reopenAfterClear.body));
  assert.equal(reopenAfterClear.body.task.assigneeId, null);

  const archived = await owner.request(`/api/teams/${team.id}`, {
    method: "PATCH",
    body: { archived: true },
  });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.equal(archived.body.team.archivedAt !== null, true);
  assert.equal((await lead.request("/api/tasks")).body.tasks.length, 1, "only common task remains globally");
  assert.equal((await lead.request(`/api/teams/${team.id}`)).body.tasks.length, 1, "archived detail keeps history");
  assert.equal(
    (
      await lead.request(`/api/tasks/${assigned.body.task.id}`, {
        method: "PATCH",
        body: { title: "Không sửa" },
      })
    ).status,
    409,
  );
  const restored = await owner.request(`/api/teams/${team.id}`, {
    method: "PATCH",
    body: { archived: false },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.team.archivedAt, null);
});

test("team reminders target current members, preserve recurrence, and hide removed-member notifications", async (t) => {
  const server = await boot();
  t.after(() => server.close());
  const owner = client(server.base);
  const member = client(server.base);
  const ownerData = await register(owner, "reminder-owner@example.test", "Chủ nhắc", "Nhắc nhóm");
  const memberData = await register(member, "reminder-member@example.test", "Người nhận", "Riêng");
  await joinWorkspace(owner, member, memberData.user.email);
  const created = await owner.request("/api/teams", {
    method: "POST",
    body: {
      name: "Nhắc việc",
      description: "",
      color: "rose",
      members: [
        { userId: ownerData.user.id, role: "lead" },
        { userId: memberData.user.id, role: "member" },
      ],
    },
  });
  assert.equal(created.status, 201);
  const task = await owner.request("/api/tasks", {
    method: "POST",
    body: {
      title: "Nhắc cho cả nhóm",
      teamId: created.body.team.id,
      dueAt: "2026-09-21T11:00:00.000Z",
      remindAt: "2026-09-21T11:00:00.000Z",
      recurrence: "weekly",
    },
  });
  assert.equal(task.status, 201, JSON.stringify(task.body));
  const sent = server.app.locals.processReminders();
  assert.equal(sent.length, 2);
  assert.equal((await member.request("/api/notifications")).body.notifications.length, 1);
  const completed = await owner.request(`/api/tasks/${task.body.task.id}`, {
    method: "PATCH",
    body: { status: "done" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.nextTask.teamId, created.body.team.id);

  // Removing a member is allowed because the task is now complete, and the
  // existing notification must disappear from that user's scoped feed.
  const roster = await owner.request(`/api/teams/${created.body.team.id}/members`, {
    method: "PUT",
    body: { members: [{ userId: ownerData.user.id, role: "lead" }] },
  });
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  assert.equal((await member.request("/api/notifications")).body.notifications.length, 0);
  assert.equal(
    (
      await member.request(`/api/notifications/${sent.find((item) => item.userId === memberData.user.id).notificationId}/read`, {
        method: "PATCH",
        body: {},
      })
    ).status,
    404,
  );
});
