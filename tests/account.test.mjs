import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, user, addMember } from "./roadmap-helpers.mjs";

test("users can update their own profile and sign in with the new email", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "account-owner@example.test");
  const member = await user(server, "account-member@example.test");
  addMember(server, owner, member);
  const updated = await call(server, "/me", {
    method: "PATCH", cookie: member.cookie,
    body: { name: "  Nguyễn Thị An  ", email: "  NEW-EMAIL@EXAMPLE.TEST  " },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.user, {
    id: member.user.id, name: "Nguyễn Thị An", email: "new-email@example.test",
    role: "member", memberType: "member", isPlatformAdmin: false,
  });
  const me = await call(server, "/me", { cookie: member.cookie });
  assert.deepEqual(me.body.user, updated.body.user);
  const unchanged = await call(server, "/me", { cookie: owner.cookie });
  assert.deepEqual(unchanged.body.user, owner.user);
  const dashboard = await call(server, "/dashboard", { cookie: owner.cookie });
  assert.equal(dashboard.body.members.find((row) => row.id === member.user.id).name, "Nguyễn Thị An");
  const oldLogin = await call(server, "/auth/login", {
    method: "POST", body: { email: member.user.email, password: "Password123!" },
  });
  assert.equal(oldLogin.status, 401);
  const login = await call(server, "/auth/login", {
    method: "POST", body: { email: "new-email@example.test", password: "Password123!" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, member.user.id);
});

test("profile updates reject invalid input, duplicate emails and privilege changes atomically", async (t) => {
  const server = await boot(t);
  const first = await user(server, "account-first@example.test");
  const second = await user(server, "account-second@example.test");
  const anonymous = await call(server, "/me", { method: "PATCH", body: { name: "Anonymous" } });
  assert.equal(anonymous.status, 401);
  for (const body of [
    {}, [], { name: " " }, { name: "a".repeat(121) }, { name: 123 },
    { name: null }, { email: "" }, { email: "invalid" }, { email: ["a@b.test"] },
    { email: `${"a".repeat(320)}@example.test` },
    { name: "Changed", id: second.user.id },
    { name: "Changed", isPlatformAdmin: true },
    { role: "admin" }, { password: "NewPassword123!" },
  ]) {
    const response = await call(server, "/me", { method: "PATCH", cookie: first.cookie, body });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const duplicate = await call(server, "/me", {
    method: "PATCH", cookie: first.cookie,
    body: { name: "Must not persist", email: second.user.email.toUpperCase() },
  });
  assert.equal(duplicate.status, 409);
  const me = await call(server, "/me", { cookie: first.cookie });
  assert.deepEqual(me.body.user, first.user);
  const other = await call(server, "/me", { cookie: second.cookie });
  assert.deepEqual(other.body.user, second.user);
});

test("partial and repeated profile updates preserve Google identity and account access", async (t) => {
  const server = await boot(t);
  const actor = await user(server, "account-google@example.test");
  server.db.prepare("INSERT INTO google_identities(sub, user_id, created_at) VALUES (?, ?, ?)")
    .run("google-account-subject", actor.user.id, new Date().toISOString());
  server.db.prepare("UPDATE subscriptions SET current_period_end = ? WHERE workspace_id = ?")
    .run("2000-01-01T00:00:00.000Z", actor.workspace.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await call(server, "/me", {
      method: "PATCH", cookie: actor.cookie, body: { name: "Tên mới" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, actor.user.email);
  }
  const response = await call(server, "/me", {
    method: "PATCH", cookie: actor.cookie, body: { email: "google-new@example.test" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.user.name, "Tên mới");
  const config = await call(server, "/auth/google/config", { cookie: actor.cookie });
  assert.equal(config.body.linked, true);
  server.db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
    .run(new Date().toISOString(), actor.user.id);
  const disabled = await call(server, "/me", {
    method: "PATCH", cookie: actor.cookie, body: { name: "Blocked" },
  });
  assert.equal(disabled.status, 401);
});
