import test from "node:test";
import assert from "node:assert/strict";

import { addMember, boot, call, task, user } from "./roadmap-helpers.mjs";

test("task extras are workspace scoped and keep secondary assignees and labels", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "extras-owner@example.test");
  const member = await user(server, "extras-member@example.test");
  const other = await user(server, "extras-other@example.test");
  addMember(server, owner, member);

  const label = await call(server, "/task-labels", {
    method: "POST",
    cookie: owner.cookie,
    body: { name: "Urgent", color: "rose" },
  });
  assert.equal(label.status, 201, JSON.stringify(label.body));
  const card = await task(server, owner, "Shared task");
  const saved = await call(server, `/tasks/${card.id}/extras`, {
    method: "PUT",
    cookie: owner.cookie,
    body: { assigneeIds: [member.user.id], labelIds: [label.body.label.id] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.assigneeIds, [member.user.id]);
  assert.deepEqual(saved.body.labelIds, [label.body.label.id]);
  assert.deepEqual(saved.body.labels, [label.body.label]);
  assert.equal(saved.body.members.some((row) => row.id === member.user.id), true);
  assert.deepEqual(saved.body.checklists, []);

  const readBack = await call(server, `/tasks/${card.id}/extras`, { cookie: member.cookie });
  assert.equal(readBack.status, 200);
  assert.deepEqual(readBack.body.assigneeIds, [member.user.id]);

  const foreignRead = await call(server, `/tasks/${card.id}/extras`, { cookie: other.cookie });
  assert.equal(foreignRead.status, 404);
  const foreignWrite = await call(server, `/tasks/${card.id}/extras`, {
    method: "PUT",
    cookie: other.cookie,
    body: { assigneeIds: [], labelIds: [] },
  });
  assert.equal(foreignWrite.status, 404);
});

test("checklist templates, copies, ordering, and conversion stay on the task board", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "extras-checklist@example.test");
  const source = await task(server, owner, "Source");

  const checklist = await call(server, `/tasks/${source.id}/checklists`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Release steps" },
  });
  assert.equal(checklist.status, 201, JSON.stringify(checklist.body));
  const checklistId = checklist.body.checklist.id;
  const first = await call(server, `/tasks/${source.id}/checklists/${checklistId}/items`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Publish" },
  });
  const second = await call(server, `/tasks/${source.id}/checklists/${checklistId}/items`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Verify" },
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const template = await call(server, "/task-templates", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      sourceTaskId: source.id,
      checklistId,
      kind: "checklist",
      name: "Release template",
    },
  });
  assert.equal(template.status, 201, JSON.stringify(template.body));
  assert.equal(template.body.template.canDelete, true);

  const target = await task(server, owner, "Target");
  const applied = await call(server, `/task-templates/${template.body.template.id}/apply`, {
    method: "POST",
    cookie: owner.cookie,
    body: { taskId: target.id },
  });
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.equal(applied.body.checklist.items.length, 2);

  const copied = await call(server, `/tasks/${source.id}/checklists/${checklistId}/copy`, {
    method: "POST",
    cookie: owner.cookie,
    body: {},
  });
  assert.equal(copied.status, 201, JSON.stringify(copied.body));
  const copiedId = copied.body.checklist.id;
  const order = await call(server, `/tasks/${source.id}/checklists/${copiedId}/order`, {
    method: "PUT",
    cookie: owner.cookie,
    body: { ids: copied.body.checklist.items.map((item) => item.id).reverse() },
  });
  assert.equal(order.status, 200, JSON.stringify(order.body));
  assert.equal(order.body.items[0].title, "Verify");

  const converted = await call(
    server,
    `/tasks/${source.id}/checklists/${checklistId}/items/${first.body.item.id}/convert`,
    {
      method: "POST",
      cookie: owner.cookie,
      body: { dueAt: "2030-04-01T10:00:00Z" },
    },
  );
  assert.equal(converted.status, 201, JSON.stringify(converted.body));
  assert.ok(converted.body.task.id);
  assert.equal(
    server.db.prepare("SELECT COUNT(*) AS count FROM task_checklist_items WHERE id = ?").get(first.body.item.id).count,
    0,
  );
});

test("task copy omits attachments, comments, and the source activity history", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "extras-copy@example.test");
  const source = await task(server, owner, "Copy source");
  const attachment = await call(server, `/tasks/${source.id}/attachments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { title: "Reference", url: "https://example.com/reference" },
  });
  const comment = await call(server, `/tasks/${source.id}/comments`, {
    method: "POST",
    cookie: owner.cookie,
    body: { body: "Source-only note" },
  });
  assert.equal(attachment.status, 201);
  assert.equal(comment.status, 201);

  const copied = await call(server, `/tasks/${source.id}/copy`, {
    method: "POST",
    cookie: owner.cookie,
    body: { dueAt: "2030-05-01T10:00:00Z" },
  });
  assert.equal(copied.status, 201, JSON.stringify(copied.body));
  const copiedId = copied.body.task.id;
  assert.equal(server.db.prepare("SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = ?").get(copiedId).count, 0);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS count FROM task_comments WHERE task_id = ?").get(copiedId).count, 0);
  assert.equal(
    server.db.prepare("SELECT COUNT(*) AS count FROM task_activity WHERE task_id = ?").get(copiedId).count,
    1,
  );
});
