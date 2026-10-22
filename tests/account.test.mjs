import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, user, addMember } from "./roadmap-helpers.mjs";

async function setup(t, options = {}) {
  let now = Date.parse("2026-09-22T01:00:00Z");
  const mails = [];
  const server = await boot(t, {
    clock: () => new Date(now),
    passwordResetTransport: { sendMail: async (mail) => { mails.push(mail); } },
    ...options,
  });
  return Object.assign(server, {
    mails,
    advance: (milliseconds) => { now += milliseconds; },
    code: () => mails.findLast((mail) => /Mã xác nhận/.test(mail.subject)).text.match(/\b\d{6}\b/)[0],
  });
}
const requestChange = (server, actor, body) =>
  call(server, "/me/email-change", { method: "POST", cookie: actor.cookie, body });
const confirmChange = (server, actor, code) =>
  call(server, "/me/email-change/confirm", { method: "POST", cookie: actor.cookie, body: { code } });
const login = (server, email, password = "Password123!") =>
  call(server, "/auth/login", { method: "POST", body: { email, password } });
const otherCode = (code) => (code === "000000" ? "000001" : "000000");
const storedEmail = (server, actor) =>
  server.db.prepare("SELECT email FROM users WHERE id = ?").get(actor.user.id).email;

test("users can rename themselves and see the new name across the workspace", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "account-owner@example.test");
  const member = await user(server, "account-member@example.test");
  addMember(server, owner, member);
  const updated = await call(server, "/me", {
    method: "PATCH", cookie: member.cookie,
    body: { name: "  Nguyễn Thị An  " },
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.user, {
    id: member.user.id, name: "Nguyễn Thị An", email: "account-member@example.test",
    role: "member", memberType: "member", isPlatformAdmin: false,
  });
  const me = await call(server, "/me", { cookie: member.cookie });
  assert.deepEqual(me.body.user, updated.body.user);
  const unchanged = await call(server, "/me", { cookie: owner.cookie });
  assert.deepEqual(unchanged.body.user, owner.user);
  const dashboard = await call(server, "/dashboard", { cookie: owner.cookie });
  assert.equal(dashboard.body.members.find((row) => row.id === member.user.id).name, "Nguyễn Thị An");
});

test("profile updates reject invalid input, direct email changes and privilege changes", async (t) => {
  const server = await boot(t);
  const first = await user(server, "account-first@example.test");
  const second = await user(server, "account-second@example.test");
  const anonymous = await call(server, "/me", { method: "PATCH", body: { name: "Anonymous" } });
  assert.equal(anonymous.status, 401);
  for (const body of [
    {}, [], { name: " " }, { name: "a".repeat(121) }, { name: 123 },
    { name: null }, { email: "" }, { email: "invalid" }, { email: ["a@b.test"] },
    { email: "new-first@example.test" },
    { name: "Must not persist", email: second.user.email.toUpperCase() },
    { name: "Changed", id: second.user.id },
    { name: "Changed", isPlatformAdmin: true },
    { role: "admin" }, { password: "NewPassword123!" },
  ]) {
    const response = await call(server, "/me", { method: "PATCH", cookie: first.cookie, body });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const direct = await call(server, "/me", { method: "PATCH", cookie: first.cookie, body: { email: "new-first@example.test" } });
  assert.match(direct.body.error, /xác nhận riêng/);
  const me = await call(server, "/me", { cookie: first.cookie });
  assert.deepEqual(me.body.user, first.user);
  const other = await call(server, "/me", { cookie: second.cookie });
  assert.deepEqual(other.body.user, second.user);
});

test("email change needs the current password and a code sent to the new address", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "change-me@example.test");
  const wrong = await requestChange(s, actor, { email: "changed@example.test", password: "WrongPassword123!" });
  assert.equal(wrong.status, 403);
  const missing = await requestChange(s, actor, { email: "changed-too@example.test" });
  assert.equal(missing.status, 403);
  assert.equal((await requestChange(s, actor, { email: actor.user.email, password: "Password123!" })).status, 400);
  assert.equal((await requestChange(s, actor, { email: "not-an-email", password: "Password123!" })).status, 400);
  assert.equal(s.mails.length, 0);
  assert.equal((await call(s, "/me", { cookie: actor.cookie })).status, 200, "a wrong password does not sign the user out");

  const requested = await requestChange(s, actor, { email: " CHANGED@EXAMPLE.TEST ", password: "Password123!" });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  assert.equal(requested.body.email, "changed@example.test");
  assert.equal(requested.body.retryAfterSeconds, 60);
  assert.equal(requested.body.expiresAt, "2026-09-22T01:15:00.000Z");
  assert.equal(s.mails.length, 1);
  assert.equal(s.mails[0].to, "changed@example.test");
  assert.equal(storedEmail(s, actor), "change-me@example.test");
  assert.deepEqual((await call(s, "/me/email-change", { cookie: actor.cookie })).body.pending,
    { email: "changed@example.test", expiresAt: "2026-09-22T01:15:00.000Z" });
  const stored = s.db.prepare("SELECT * FROM email_change_requests WHERE user_id = ?").get(actor.user.id);
  assert.ok(!JSON.stringify(stored).includes(s.code()), "the code is stored only as a keyed digest");

  const code = s.code();
  const guess = await confirmChange(s, actor, otherCode(code));
  assert.equal(guess.status, 400);
  assert.equal(Number(s.db.prepare("SELECT attempts FROM email_change_requests WHERE user_id = ?").get(actor.user.id).attempts), 1);
  assert.equal(storedEmail(s, actor), "change-me@example.test");

  const confirmed = await confirmChange(s, actor, code);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.user.email, "changed@example.test");
  assert.equal(storedEmail(s, actor), "changed@example.test");
  assert.equal((await call(s, "/me", { cookie: actor.cookie })).body.user.email, "changed@example.test");
  assert.equal((await login(s, "change-me@example.test")).status, 401);
  assert.equal((await login(s, "changed@example.test")).status, 200);
  const notice = s.mails.at(-1);
  assert.equal(notice.to, "change-me@example.test");
  assert.match(notice.text, /changed@example\.test/);
  assert.equal((await call(s, "/me/email-change", { cookie: actor.cookie })).body.pending, null);
  assert.equal((await confirmChange(s, actor, code)).status, 400, "a code works only once");
});

test("confirming an email change keeps this session and signs out every other one", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "sessions@example.test");
  const secondWeb = await login(s, actor.user.email);
  assert.equal(secondWeb.status, 200);
  const mobile = await call(s, "/mobile/auth/login", { method: "POST", body: { email: actor.user.email, password: "Password123!" } });
  assert.equal(mobile.status, 200);
  const bearer = () => fetch(`${s.base}/api/me`, { headers: { authorization: `Bearer ${mobile.body.token}` } });
  assert.equal((await bearer()).status, 200);
  // A recovery code sent to the old mailbox must not survive the change.
  assert.equal((await call(s, "/auth/forgot-password", { method: "POST", body: { email: actor.user.email } })).status, 200);
  const recoveryCode = s.mails.at(-1).text.match(/\b\d{6}\b/)[0];

  assert.equal((await requestChange(s, actor, { email: "sessions-new@example.test", password: "Password123!" })).status, 200);
  assert.equal((await confirmChange(s, actor, s.code())).status, 200);
  assert.equal((await call(s, "/me", { cookie: actor.cookie })).status, 200);
  assert.equal((await call(s, "/me", { cookie: secondWeb.cookie })).status, 401);
  assert.equal((await bearer()).status, 401);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM password_reset_codes WHERE user_id = ?").get(actor.user.id).n, 0);
  for (const email of ["sessions@example.test", "sessions-new@example.test"]) {
    const reset = await call(s, "/auth/reset-password", { method: "POST", body: { email, code: recoveryCode, password: "Stolen123456!" } });
    assert.equal(reset.status, 400);
  }
});

test("email change rejects addresses that are or become registered", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "dup-a@example.test");
  const other = await user(s, "dup-b@example.test");
  const taken = await requestChange(s, actor, { email: other.user.email.toUpperCase(), password: "Password123!" });
  assert.equal(taken.status, 409);
  assert.equal(s.mails.length, 0);

  assert.equal((await requestChange(s, actor, { email: "dup-c@example.test", password: "Password123!" })).status, 200);
  const code = s.code();
  await user(s, "dup-c@example.test");
  const raced = await confirmChange(s, actor, code);
  assert.equal(raced.status, 409);
  assert.equal(storedEmail(s, actor), "dup-a@example.test");
  assert.equal((await call(s, "/me/email-change", { cookie: actor.cookie })).body.pending, null);
});

test("email change codes lock after five guesses, throttle resends and expire after 15 minutes", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "limits@example.test");
  assert.equal((await requestChange(s, actor, { email: "limits-new@example.test", password: "Password123!" })).status, 200);
  const code = s.code();
  const resend = await requestChange(s, actor, { email: "limits-new@example.test", password: "Password123!" });
  assert.equal(resend.status, 429);
  assert.equal((await requestChange(s, actor, { email: "limits-other@example.test", password: "Password123!" })).status, 429,
    "the resend cooldown is per account, not only per address");
  assert.equal(s.mails.length, 1);

  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await confirmChange(s, actor, otherCode(code))).status, 400);
  assert.equal((await confirmChange(s, actor, code)).status, 400, "the right code no longer works after five guesses");
  assert.equal(storedEmail(s, actor), "limits@example.test");
  assert.equal((await call(s, "/me/email-change", { cookie: actor.cookie })).body.pending, null);

  s.advance(61_000);
  assert.equal((await requestChange(s, actor, { email: "limits-new@example.test", password: "Password123!" })).status, 200);
  const fresh = s.code();
  assert.notEqual((await call(s, "/me/email-change", { cookie: actor.cookie })).body.pending, null);
  s.advance(15 * 60_000 + 1);
  assert.equal((await confirmChange(s, actor, fresh)).status, 400);
  assert.equal(storedEmail(s, actor), "limits@example.test");

  assert.equal((await requestChange(s, actor, { email: "limits-cancel@example.test", password: "Password123!" })).status, 200);
  const cancelled = s.code();
  assert.deepEqual((await call(s, "/me/email-change", { method: "DELETE", cookie: actor.cookie })).body, { ok: true });
  assert.equal((await confirmChange(s, actor, cancelled)).status, 400);
});

test("Google-linked accounts may skip the password; profile edits preserve the Google link", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "account-google@example.test");
  s.db.prepare("INSERT INTO google_identities(sub, user_id, created_at) VALUES (?, ?, ?)")
    .run("google-account-subject", actor.user.id, new Date().toISOString());
  s.db.prepare("UPDATE subscriptions SET current_period_end = ? WHERE workspace_id = ?")
    .run("2000-01-01T00:00:00.000Z", actor.workspace.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await call(s, "/me", { method: "PATCH", cookie: actor.cookie, body: { name: "Tên mới" } });
    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, actor.user.email);
  }
  assert.equal((await requestChange(s, actor, { email: "google-new@example.test", password: "WrongPassword123!" })).status, 403,
    "a supplied password is still checked");
  assert.equal((await requestChange(s, actor, { email: "google-new@example.test" })).status, 200);
  const confirmed = await confirmChange(s, actor, s.code());
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.user.name, "Tên mới");
  assert.equal(confirmed.body.user.email, "google-new@example.test");
  const config = await call(s, "/auth/google/config", { cookie: actor.cookie });
  assert.equal(config.body.linked, true);

  const plain = await user(s, "no-google@example.test");
  assert.equal((await requestChange(s, plain, { email: "no-google-new@example.test" })).status, 403);

  s.db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(new Date().toISOString(), actor.user.id);
  const disabled = await call(s, "/me", { method: "PATCH", cookie: actor.cookie, body: { name: "Blocked" } });
  assert.equal(disabled.status, 401);
});

test("email change reports missing SMTP and stays available to guests", async (t) => {
  const server = await boot(t);
  const owner = await user(server, "no-smtp-owner@example.test");
  const guest = await user(server, "no-smtp-guest@example.test");
  addMember(server, owner, guest);
  server.db.prepare("UPDATE workspace_members SET member_type = 'guest' WHERE workspace_id = ? AND user_id = ?")
    .run(owner.workspace.id, guest.user.id);
  assert.equal((await call(server, "/customers", { cookie: guest.cookie })).status, 403);
  assert.deepEqual((await call(server, "/me/email-change", { cookie: guest.cookie })).body, { pending: null });
  const unavailable = await requestChange(server, guest, { email: "no-smtp-new@example.test", password: "Password123!" });
  assert.equal(unavailable.status, 503);
  assert.equal(server.db.prepare("SELECT COUNT(*) AS n FROM email_change_requests").get().n, 0);
});
