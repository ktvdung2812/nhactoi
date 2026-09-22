import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, user, addMember } from "./roadmap-helpers.mjs";
import { migrateDatabase } from "../server/db.mjs";

const clock = () => new Date("2030-01-01T09:00:00Z");
const fields = {
  title: "Lịch hẹn trên board",
  description: "Giữ nguyên thời gian và lời nhắc",
  startsAt: "2030-01-01T10:00:00Z",
  endsAt: "2030-01-01T11:00:00Z",
  remindAt: "2030-01-01T08:55:00Z",
};
async function create(s, actor, extra = {}) {
  const result = await call(s, "/calendar-events", {
    cookie: actor.cookie, method: "POST", body: { ...fields, ...extra },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.id;
}
const change = (s, actor, id, status) => call(s, `/calendar-events/${id}/status`, {
  cookie: actor.cookie, method: "PATCH", body: { status },
});

test("appointment status is shared by web/mobile and legacy edits preserve it", async t => {
  const s = await boot(t, { clock });
  const actor = await user(s, "board-owner@example.test");
  const id = await create(s, actor);
  const mobile = await call(s, "/mobile/auth/login", {
    method: "POST", body: { email: actor.user.email, password: "Password123!" },
  });
  assert.equal((await call(s, `/calendar-events/${id}`, { cookie: actor.cookie })).body.event.status, "todo");
  const response = await fetch(`${s.base}/api/calendar-events/${id}/status`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${mobile.body.token}` },
    body: JSON.stringify({ status: "doing" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await call(s, "/calendar-events", { cookie: actor.cookie })).body.events.find(e => e.id === id).status, "doing");
  const edited = await call(s, `/calendar-events/${id}`, {
    method: "PUT", cookie: actor.cookie, body: { ...fields, title: "Đổi tên" },
  });
  assert.equal(edited.status, 200);
  const event = (await call(s, `/calendar-events/${id}`, { cookie: actor.cookie })).body.event;
  assert.equal(event.status, "doing");
  assert.equal(event.title, "Đổi tên");
  assert.equal(event.starts_at, new Date(fields.startsAt).toISOString());
  assert.equal((await change(s, actor, id, "done")).body.event.status, "done");
  assert.equal((await change(s, actor, id, "invalid")).status, 400);
  assert.equal((await change(s, actor, id, undefined)).status, 400);
  assert.equal((await call(s, "/calendar-events", { method: "POST", cookie: actor.cookie, body: { ...fields, status: "invalid" } })).status, 400);
});

test("appointment board actions enforce workspace, creator and subscription permissions", async t => {
  const s = await boot(t, { clock });
  const owner = await user(s, "board-acl-owner@example.test");
  const member = await user(s, "board-acl-member@example.test");
  const outsider = await user(s, "board-acl-other@example.test");
  addMember(s, owner, member);
  const id = await create(s, owner);
  assert.equal((await change(s, outsider, id, "done")).status, 404);
  assert.equal((await change(s, member, id, "done")).status, 403);
  assert.equal((await call(s, `/calendar-events/${id}`, { cookie: member.cookie })).body.event.canEdit, false);
  const own = await create(s, member);
  assert.equal((await change(s, member, own, "doing")).status, 200);
  assert.equal((await change(s, owner, own, "done")).status, 200);
  s.db.prepare("UPDATE subscriptions SET status='expired' WHERE workspace_id=?").run(owner.workspace.id);
  assert.equal((await change(s, owner, id, "done")).status, 402);
  assert.equal(s.db.prepare("SELECT status FROM calendar_events WHERE id=?").get(id).status, "todo");
});

test("completed appointments stop reminders and reopening retains idempotent delivery", async t => {
  const s = await boot(t, { clock });
  const actor = await user(s, "board-reminder@example.test");
  const id = await create(s, actor, { status: "done" });
  assert.equal(s.app.locals.processEventReminders(), 0);
  await change(s, actor, id, "doing");
  assert.equal(s.app.locals.processEventReminders(), 1);
  await change(s, actor, id, "done");
  await change(s, actor, id, "todo");
  assert.equal(s.app.locals.processEventReminders(), 0);
});

test("board migration preserves existing appointments and may be safely replayed", async t => {
  const s = await boot(t, { clock });
  const actor = await user(s, "board-migration@example.test");
  const id = await create(s, actor);
  const before = s.db.prepare("SELECT * FROM calendar_events WHERE id=?").get(id);
  s.db.exec("ALTER TABLE calendar_events DROP COLUMN status; DELETE FROM schema_migrations WHERE version=22;");
  migrateDatabase(s.db);
  assert.deepEqual(s.db.prepare("SELECT * FROM calendar_events WHERE id=?").get(id), before);
  await change(s, actor, id, "done");
  s.db.exec("DELETE FROM schema_migrations WHERE version=22;");
  migrateDatabase(s.db);
  migrateDatabase(s.db);
  assert.equal(s.db.prepare("SELECT status FROM calendar_events WHERE id=?").get(id).status, "done");
});
