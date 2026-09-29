import test from "node:test";
import assert from "node:assert/strict";

import { addMember, boot, call, task, user } from "./roadmap-helpers.mjs";

test("boards bootstrap per workspace, keep columns isolated, and let visible members move tasks", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "boards-owner@example.test");
  const member = await user(server, "boards-member@example.test");
  const other = await user(server, "boards-other@example.test");

  const first = await call(server, "/boards", { cookie: owner.cookie });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.columns.map((column) => column.status), ["todo", "doing", "done"]);
  assert.equal(first.body.canManage, true);
  assert.equal(first.body.canWrite, true);

  const foreign = await call(server, "/boards", { cookie: other.cookie });
  assert.equal(foreign.status, 200);
  assert.notEqual(foreign.body.columns[0].id, first.body.columns[0].id);

  const card = await task(server, owner, "Board isolation");
  const stolen = await call(server, `/boards/tasks/${card.id}/move`, {
    method: "POST",
    cookie: other.cookie,
    body: { columnId: first.body.columns[1].id },
  });
  assert.equal(stolen.status, 404);

  addMember(server, owner, member);
  const memberBoard = await call(server, "/boards", { cookie: member.cookie });
  assert.equal(memberBoard.status, 200);
  assert.equal(memberBoard.body.canManage, false);
  assert.equal(memberBoard.body.canWrite, true);
  const createdColumn = await call(server, "/boards/columns", {
    method: "POST",
    cookie: member.cookie,
    body: { teamId: null, name: "Member column", status: "todo", tone: "blue" },
  });
  assert.equal(createdColumn.status, 201, JSON.stringify(createdColumn.body));
  assert.equal(createdColumn.body.column.name, "Member column");
  assert.equal(createdColumn.body.column.status, "todo");
  assert.equal(createdColumn.body.column.tone, "blue");
  const withMemberColumn = await call(server, "/boards", { cookie: member.cookie });
  assert.ok(withMemberColumn.body.columns.some((column) => column.id === createdColumn.body.column.id));
  const renamed = await call(server, `/boards/columns/${createdColumn.body.column.id}`, {
    method: "PATCH",
    cookie: member.cookie,
    body: { name: "Renamed by member" },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.column.name, "Renamed by member");
  assert.equal(renamed.body.canManage, false);

  const moved = await call(server, `/boards/tasks/${card.id}/move`, {
    method: "POST",
    cookie: member.cookie,
    body: { columnId: first.body.columns[1].id },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.task.status, "doing");
  assert.equal(moved.body.task.columnId, first.body.columns[1].id);

  const saved = await call(server, "/boards/preferences", {
    method: "PATCH",
    cookie: member.cookie,
    body: { teamId: null, collapsedIds: [first.body.columns[1].id] },
  });
  assert.deepEqual(saved.body.preferences.collapsedIds, [first.body.columns[1].id]);
  const readBack = await call(server, "/boards", { cookie: member.cookie });
  assert.deepEqual(readBack.body.preferences.collapsedIds, [first.body.columns[1].id]);
});

test("board moves persist order and preserve recurring completion lifecycle", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "boards-order@example.test");
  const board = await call(server, "/boards", { cookie: owner.cookie });
  const doing = board.body.columns.find((column) => column.status === "doing");
  const done = board.body.columns.find((column) => column.status === "done");

  const first = await task(server, owner, "First");
  const second = await task(server, owner, "Second");
  assert.equal(
    (await call(server, `/boards/tasks/${first.id}/move`, {
      method: "POST",
      cookie: owner.cookie,
      body: { columnId: doing.id },
    })).status,
    200,
  );
  assert.equal(
    (await call(server, `/boards/tasks/${second.id}/move`, {
      method: "POST",
      cookie: owner.cookie,
      body: { columnId: doing.id, beforeTaskId: first.id },
    })).status,
    200,
  );
  const order = server.db
    .prepare("SELECT id, board_position FROM tasks WHERE column_id = ? ORDER BY board_position, id")
    .all(doing.id);
  assert.deepEqual(order.map((row) => row.id), [second.id, first.id]);
  assert.ok(order[0].board_position < order[1].board_position);

  const recurring = await call(server, "/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      title: "Weekly",
      dueAt: "2026-01-10T10:00:00Z",
      recurrence: "weekly",
    },
  });
  assert.equal(recurring.status, 201, JSON.stringify(recurring.body));
  const completed = await call(server, `/boards/tasks/${recurring.body.task.id}/move`, {
    method: "POST",
    cookie: owner.cookie,
    body: { columnId: done.id },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.task.status, "done");
  assert.equal(completed.body.nextTask.status, "todo");
  assert.equal(
    server.db.prepare("SELECT column_id FROM tasks WHERE id = ?").get(completed.body.nextTask.id).column_id,
    board.body.columns.find((column) => column.status === "todo").id,
  );
  assert.ok(
    server.db.prepare("SELECT 1 FROM task_activity WHERE task_id = ? AND action = 'task_updated'").get(recurring.body.task.id),
  );
});

test("archiving a populated column requires a target, moves lifecycle status, and restores", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "boards-archive@example.test");
  const board = await call(server, "/boards", { cookie: owner.cookie });
  const todo = board.body.columns.find((column) => column.status === "todo");
  const done = board.body.columns.find((column) => column.status === "done");
  const created = await call(server, "/boards/columns", {
    method: "POST",
    cookie: owner.cookie,
    body: { teamId: null, name: "Review later", status: "todo", tone: "purple" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const card = await call(server, "/tasks", {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Archive me", dueAt: "2030-01-01T00:00:00Z", columnId: created.body.column.id },
  });
  assert.equal(card.status, 201, JSON.stringify(card.body));

  const missingTarget = await call(server, `/boards/columns/${created.body.column.id}/archive`, {
    method: "POST",
    cookie: owner.cookie,
    body: {},
  });
  assert.equal(missingTarget.status, 400);
  const archived = await call(server, `/boards/columns/${created.body.column.id}/archive`, {
    method: "POST",
    cookie: owner.cookie,
    body: { targetColumnId: done.id },
  });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.equal(
    server.db.prepare("SELECT status, column_id FROM tasks WHERE id = ?").get(card.body.task.id).status,
    "done",
  );
  const withArchived = await call(server, "/boards", { cookie: owner.cookie });
  assert.ok(withArchived.body.columns.find((column) => column.id === created.body.column.id).archivedAt);
  const restored = await call(server, `/boards/columns/${created.body.column.id}/restore`, {
    method: "POST",
    cookie: owner.cookie,
    body: {},
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.column.archivedAt, null);
  assert.equal(todo.status, "todo");
});
