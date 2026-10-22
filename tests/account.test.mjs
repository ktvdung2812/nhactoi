import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, user, addMember } from "./roadmap-helpers.mjs";
import { enableGoogle } from "./google-helpers.mjs";

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

test("requesting another account's address looks like a normal request but mails only a notice", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "dup-a@example.test");
  const other = await user(s, "dup-b@example.test");
  const fresh = await user(s, "dup-fresh@example.test");
  const taken = await requestChange(s, actor, { email: other.user.email.toUpperCase(), password: "Password123!" });
  const normal = await requestChange(s, fresh, { email: "dup-unused@example.test", password: "Password123!" });
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  assert.deepEqual(Object.keys(taken.body).sort(), Object.keys(normal.body).sort());
  assert.deepEqual(taken.body, { ...normal.body, email: other.user.email });
  const notice = s.mails.find((mail) => mail.to === other.user.email);
  assert.ok(notice);
  assert.doesNotMatch(notice.text, /\b\d{6}\b/, "no code goes to an address that is already registered");
  assert.match(notice.text, /không thay đổi gì/);
  assert.equal(s.mails.filter((mail) => mail.to === other.user.email).length, 1);
  // Reloading, resending and cancelling behave as for any pending change.
  assert.deepEqual((await call(s, "/me/email-change", { cookie: actor.cookie })).body.pending,
    { email: other.user.email, expiresAt: taken.body.expiresAt });
  assert.equal((await requestChange(s, actor, { email: other.user.email, password: "Password123!" })).status, 429);
  for (const code of ["000000", "123456", "999999"]) assert.equal((await confirmChange(s, actor, code)).status, 400);
  assert.equal(storedEmail(s, actor), "dup-a@example.test");
  assert.equal(storedEmail(s, other), "dup-b@example.test");

  s.advance(61_000);
  assert.equal((await requestChange(s, actor, { email: "dup-c@example.test", password: "Password123!" })).status, 200);
  const code = s.code();
  await user(s, "dup-c@example.test");
  const raced = await confirmChange(s, actor, code);
  assert.equal(raced.status, 409, "the address was registered after the code was sent");
  assert.equal(storedEmail(s, actor), "dup-a@example.test");
  assert.equal((await call(s, "/me/email-change", { cookie: actor.cookie })).body.pending, null);
});

test("cancelling does not reset the resend cooldown; neither does confirming", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "cancel-cooldown@example.test");
  assert.equal((await requestChange(s, actor, { email: "cancel-1@example.test", password: "Password123!" })).status, 200);
  assert.deepEqual((await call(s, "/me/email-change", { method: "DELETE", cookie: actor.cookie })).body, { ok: true });
  assert.equal((await call(s, "/me/email-change", { cookie: actor.cookie })).body.pending, null);
  s.advance(5_000);
  const resend = await fetch(`${s.base}/api/me/email-change`, { method: "POST",
    headers: { "content-type": "application/json", cookie: actor.cookie },
    body: JSON.stringify({ email: "cancel-2@example.test", password: "Password123!" }) });
  assert.equal(resend.status, 429);
  const retryAfter = Number(resend.headers.get("retry-after"));
  assert.ok(retryAfter > 0 && retryAfter <= 60, String(retryAfter));
  assert.equal(s.mails.length, 1);
  s.advance(55_001);
  assert.equal((await requestChange(s, actor, { email: "cancel-2@example.test", password: "Password123!" })).status, 200);
  assert.equal((await confirmChange(s, actor, s.code())).status, 200);
  // Accepted trade-off: a new change right after confirming also waits.
  assert.equal((await requestChange(s, actor, { email: "cancel-3@example.test", password: "Password123!" })).status, 429);
  s.advance(60_001);
  assert.equal((await requestChange(s, actor, { email: "cancel-3@example.test", password: "Password123!" })).status, 200);
});

test("wrong passwords cannot lock another person's address; codes per address are limited after the password", async (t) => {
  const s = await setup(t);
  const attacker = await user(s, "target-attacker@example.test");
  const owner = await user(s, "target-owner@example.test");
  for (let attempt = 0; attempt < 5; attempt++)
    assert.equal((await requestChange(s, attacker, { email: "wanted@example.test", password: `Wrong${attempt}Password!` })).status, 403);
  assert.equal((await requestChange(s, owner, { email: "wanted@example.test", password: "Password123!" })).status, 200,
    "failed passwords do not count against the address");
  for (let sent = 1; sent < 5; sent++) {
    s.advance(61_000);
    assert.equal((await requestChange(s, owner, { email: "wanted@example.test", password: "Password123!" })).status, 200, `send ${sent + 1}`);
  }
  s.advance(61_000);
  const limited = await requestChange(s, owner, { email: "wanted@example.test", password: "Password123!" });
  assert.equal(limited.status, 429, "a sixth code to the same address within the hour");
  assert.equal(s.mails.filter((mail) => mail.to === "wanted@example.test").length, 5);
  assert.equal((await requestChange(s, owner, { email: "other-wanted@example.test", password: "Password123!" })).status, 200,
    "a rejected address does not start the cooldown");
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

test("email change locks password guessing per account, whatever address is requested", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "guesses@example.test");
  for (let attempt = 0; attempt < 5; attempt++) {
    const guess = await requestChange(s, actor, { email: `guess-${attempt}@example.test`, password: `Wrong${attempt}Password!` });
    assert.equal(guess.status, 403, JSON.stringify(guess.body));
  }
  const locked = await requestChange(s, actor, { email: "guess-right@example.test", password: "Password123!" });
  assert.equal(locked.status, 429, "the right password is refused once the account is locked");
  assert.equal(s.mails.length, 0);
  const other = await user(s, "guesses-other@example.test");
  assert.equal((await requestChange(s, other, { email: "other-new@example.test", password: "Password123!" })).status, 200,
    "the lock belongs to one account only");
  s.advance(15 * 60_000 + 1);
  assert.equal((await requestChange(s, actor, { email: "guess-right@example.test", password: "Password123!" })).status, 200);
});

test("parallel wrong passwords cannot outrun the per-account guess limit", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "parallel-guesses@example.test");
  const results = await Promise.all(Array.from({ length: 10 }, (_, attempt) =>
    requestChange(s, actor, { email: `parallel-${attempt}@example.test`, password: `Wrong${attempt}Password!` })));
  assert.deepEqual(results.map((result) => result.status).sort(), [...Array(5).fill(403), ...Array(5).fill(429)]);
  assert.equal((await requestChange(s, actor, { email: "parallel-right@example.test", password: "Password123!" })).status, 429);
  s.advance(14 * 60_000);
  assert.equal((await requestChange(s, actor, { email: "parallel-right@example.test", password: "Password123!" })).status, 429,
    "still locked inside the 15-minute window");
  s.advance(60_000 + 1);
  assert.equal((await requestChange(s, actor, { email: "parallel-right@example.test", password: "Password123!" })).status, 200);
  assert.equal(s.mails.length, 1);
});

test("the right password clears earlier wrong guesses", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "clear-guesses@example.test");
  for (let attempt = 0; attempt < 3; attempt++)
    assert.equal((await requestChange(s, actor, { email: "clear-new@example.test", password: "WrongPassword123!" })).status, 403);
  assert.equal((await requestChange(s, actor, { email: "clear-new@example.test", password: "Password123!" })).status, 200);
  for (let attempt = 0; attempt < 5; attempt++)
    assert.equal((await requestChange(s, actor, { email: "clear-other@example.test", password: "WrongPassword123!" })).status, 403, `guess ${attempt + 1}`);
  assert.equal((await requestChange(s, actor, { email: "clear-other@example.test", password: "Password123!" })).status, 429);
});

test("only a Google sign-in from the last 10 minutes may skip the password; profile edits preserve the Google link", async (t) => {
  const s = await setup(t);
  const google = await enableGoogle(t, s, { sub: "google-account-subject", email: "account-google@gmail.test" });
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
  const passwordSession = await requestChange(s, actor, { email: "google-new@example.test" });
  assert.equal(passwordSession.status, 403, "a password session of a Google-linked account still needs the password");
  assert.equal(passwordSession.body.code, undefined);

  const viaGoogle = { ...actor, cookie: await google.signIn() };
  assert.equal((await requestChange(s, viaGoogle, { email: "google-new@example.test", password: "WrongPassword123!" })).status, 403,
    "a supplied password is still checked");
  assert.equal((await requestChange(s, viaGoogle, { email: "google-new@example.test" })).status, 200);
  const confirmed = await confirmChange(s, viaGoogle, s.code());
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.user.name, "Tên mới");
  assert.equal(confirmed.body.user.email, "google-new@example.test");
  const config = await call(s, "/auth/google/config", { cookie: viaGoogle.cookie });
  assert.equal(config.body.linked, true);

  s.advance(10 * 60_000 + 1000);
  const stale = await requestChange(s, viaGoogle, { email: "google-later@example.test" });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, "reauth_required");
  assert.match(stale.body.error, /đăng nhập lại bằng Google/);
  const fresh = { ...actor, cookie: await google.signIn() };
  assert.equal((await requestChange(s, fresh, { email: "google-later@example.test" })).status, 200);

  const plain = await user(s, "no-google@example.test");
  assert.equal((await requestChange(s, plain, { email: "no-google-new@example.test" })).status, 403);

  s.db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(new Date().toISOString(), actor.user.id);
  const disabled = await call(s, "/me", { method: "PATCH", cookie: fresh.cookie, body: { name: "Blocked" } });
  assert.equal(disabled.status, 401);
});

test("switching workspace keeps how and when the session signed in", async (t) => {
  const s = await setup(t);
  const google = await enableGoogle(t, s, { sub: "switch-google", email: "switch@gmail.test" });
  const actor = await user(s, "switch@example.test");
  const owner = await user(s, "switch-owner@example.test");
  s.db.prepare("INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)")
    .run(owner.workspace.id, actor.user.id, new Date().toISOString());
  s.db.prepare("INSERT INTO google_identities(sub, user_id, created_at) VALUES (?, ?, ?)")
    .run("switch-google", actor.user.id, new Date().toISOString());
  const switchTo = async (cookie, workspaceId) => {
    const switched = await call(s, "/workspaces/switch", { method: "POST", cookie, body: { workspaceId } });
    assert.equal(switched.status, 200, JSON.stringify(switched.body));
    return switched.cookie;
  };

  const fromPassword = { ...actor, cookie: await switchTo(actor.cookie, owner.workspace.id) };
  assert.equal((await requestChange(s, fromPassword, { email: "switch-new@example.test" })).status, 403,
    "a password session does not become a Google session by switching");

  const signedIn = await google.signIn();
  s.advance(9 * 60_000);
  const fromGoogle = { ...actor, cookie: await switchTo(signedIn, actor.workspace.id) };
  s.advance(2 * 60_000);
  const stale = await requestChange(s, fromGoogle, { email: "switch-new@example.test" });
  assert.equal(stale.status, 403, "the switched session is as old as the Google sign-in");
  assert.equal(stale.body.code, "reauth_required");
  assert.deepEqual(s.db.prepare("SELECT auth_method FROM sessions WHERE user_id = ? AND auth_method = 'google'").all(actor.user.id).length, 1);
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
