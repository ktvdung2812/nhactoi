import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, user } from "./roadmap-helpers.mjs";
import { migrateDatabase, SCHEMA_VERSION } from "../server/db.mjs";
import { createApp } from "../server/index.mjs";
import { join } from "node:path";

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
    clock: () => new Date(now),
    advance: (milliseconds) => { now += milliseconds; },
    code: () => mails.at(-1).text.match(/\b\d{6}\b/)[0],
  });
}
const post = (server, path, body) => call(server, path, { method: "POST", body });
const forgot = (server, email) => post(server, "/auth/forgot-password", { email });
const reset = (server, email, code, password = "NewPassword123!") =>
  post(server, "/auth/reset-password", { email, code, password });

test("web and mobile registration share validation and return the correct session kind", async (t) => {
  const s = await setup(t);
  const body = { name: "Nguyễn An", email: " NEW@EXAMPLE.TEST ", password: "Password123!", workspaceName: "Nhóm An" };
  const mobile = await post(s, "/mobile/auth/register", body);
  assert.equal(mobile.status, 201);
  assert.equal(mobile.cookie, undefined);
  assert.ok(mobile.body.token);
  assert.equal(mobile.body.user.email, "new@example.test");
  assert.equal(mobile.body.user.role, "owner");
  assert.equal(mobile.body.subscription.status, "trialing");
  const me = await fetch(`${s.base}/api/me`, { headers: { authorization: `Bearer ${mobile.body.token}` } });
  assert.equal(me.status, 200);
  const cookieAbuse = await call(s, "/me", { cookie: `nt_session=${mobile.body.token}` });
  assert.equal(cookieAbuse.status, 401);
  const duplicate = await post(s, "/auth/register", body);
  assert.equal(duplicate.status, 409);
  const invalid = await post(s, "/mobile/auth/register", { ...body, email: "other@example.test", password: "short" });
  assert.equal(invalid.status, 400);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM workspaces").get().n, 1);
});

test("password reset sends a secret code, changes password once and revokes web/mobile sessions", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "recover@example.test");
  const other = await user(s, "unaffected@example.test");
  const mobile = await post(s, "/mobile/auth/login", { email: actor.user.email, password: "Password123!" });
  s.db.prepare("INSERT INTO google_identities(sub,user_id,created_at) VALUES (?,?,?)")
    .run("google-sub", actor.user.id, new Date().toISOString());
  const response = await forgot(s, " RECOVER@EXAMPLE.TEST ");
  assert.equal(response.status, 200);
  assert.equal(response.body.retryAfterSeconds, 60);
  assert.equal(s.mails.length, 1);
  assert.equal(s.mails[0].to, actor.user.email);
  const code = s.code();
  const row = s.db.prepare("SELECT * FROM password_reset_codes").get();
  assert.equal(row.code_hash.length, 64);
  assert.notEqual(row.code_hash, code);
  assert.equal(JSON.stringify(response.body).includes(code), false);
  assert.equal((await reset(s, actor.user.email, code, "short")).status, 400);
  assert.equal((await reset(s, actor.user.email, code)).status, 200);
  assert.equal((await reset(s, actor.user.email, code)).status, 400);
  assert.equal((await call(s, "/me", { cookie: actor.cookie })).status, 401);
  assert.equal((await fetch(`${s.base}/api/me`, { headers: { authorization: `Bearer ${mobile.body.token}` } })).status, 401);
  assert.equal((await call(s, "/me", { cookie: other.cookie })).status, 200);
  assert.equal((await post(s, "/auth/login", { email: actor.user.email, password: "Password123!" })).status, 401);
  assert.equal((await post(s, "/auth/login", { email: actor.user.email, password: "NewPassword123!" })).status, 200);
  assert.equal((await post(s, "/mobile/auth/login", { email: actor.user.email, password: "NewPassword123!" })).status, 200);
  assert.equal(s.db.prepare("SELECT user_id FROM google_identities WHERE sub='google-sub'").get().user_id, actor.user.id);
});

test("unknown and disabled email responses are neutral and resends are throttled", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "neutral@example.test");
  const disabled = await user(s, "disabled@example.test");
  s.db.prepare("UPDATE users SET disabled_at=? WHERE id=?").run(new Date().toISOString(), disabled.user.id);
  const known = await forgot(s, actor.user.email);
  const unknown = await forgot(s, "missing@example.test");
  const blocked = await forgot(s, disabled.user.email);
  assert.deepEqual(unknown.body, known.body);
  assert.deepEqual(blocked.body, known.body);
  assert.equal(s.mails.length, 1);
  assert.equal((await forgot(s, actor.user.email.toUpperCase())).status, 429);
  assert.equal((await forgot(s, "missing@example.test")).status, 429);
  const firstCode = s.code();
  s.advance(60_001);
  assert.equal((await forgot(s, actor.user.email)).status, 200);
  assert.equal(s.mails.length, 2);
  if (firstCode !== s.code()) assert.equal((await reset(s, actor.user.email, firstCode)).status, 400);
  assert.equal((await reset(s, actor.user.email, s.code())).status, 200);
});

test("codes expire and stop accepting guesses after five failures", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "attempts@example.test");
  await forgot(s, actor.user.email);
  const code = s.code();
  const wrong = code === "000000" ? "000001" : "000000";
  for (let index = 0; index < 5; index++) assert.equal((await reset(s, actor.user.email, wrong)).status, 400);
  assert.equal(s.db.prepare("SELECT attempts FROM password_reset_codes").get().attempts, 5);
  assert.equal((await reset(s, actor.user.email, code)).status, 400);
  assert.equal((await call(s, "/me", { cookie: actor.cookie })).status, 200);
  s.advance(60_001);
  await forgot(s, actor.user.email);
  s.advance(15 * 60_000);
  assert.equal((await reset(s, actor.user.email, s.code())).status, 400);
});

test("codes do not reset a different, renamed or disabled account", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "bound@example.test");
  const other = await user(s, "bound-other@example.test");
  await forgot(s, actor.user.email);
  assert.equal((await reset(s, other.user.email, s.code())).status, 400);
  s.db.prepare("UPDATE users SET email=? WHERE id=?").run("renamed@example.test", actor.user.id);
  assert.equal((await reset(s, actor.user.email, s.code())).status, 400);
  assert.equal((await reset(s, "renamed@example.test", s.code())).status, 400);
  s.advance(60_001);
  await forgot(s, "renamed@example.test");
  s.db.prepare("UPDATE users SET disabled_at=? WHERE id=?").run(new Date().toISOString(), actor.user.id);
  assert.equal((await reset(s, "renamed@example.test", s.code())).status, 400);
});

test("missing SMTP is actionable; delivery failures are neutral and invalidate undelivered codes", async (t) => {
  const unavailable = await setup(t, { passwordResetTransport: null, env: { NODE_ENV: "test", SMTP_HOST: "" } });
  assert.equal((await forgot(unavailable, "missing@example.test")).status, 503);
  const failed = await setup(t, { passwordResetTransport: { sendMail: async () => { throw new Error("smtp failed"); } } });
  const actor = await user(failed, "delivery@example.test");
  assert.equal((await forgot(failed, actor.user.email)).status, 200);
  assert.equal(failed.db.prepare("SELECT COUNT(*) n FROM password_reset_codes").get().n, 0);
});

test("migration adds reset storage to existing databases without losing accounts", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "migration-recovery@example.test");
  s.db.exec("DROP TABLE password_reset_codes; DROP TABLE auth_request_limits; DELETE FROM schema_migrations WHERE version=21;");
  migrateDatabase(s.db);
  migrateDatabase(s.db);
  assert.equal(s.db.prepare("SELECT MAX(version) version FROM schema_migrations").get().version, SCHEMA_VERSION);
  assert.equal((await call(s, "/me", { cookie: actor.cookie })).status, 200);
  assert.equal((await forgot(s, actor.user.email)).status, 200);
  assert.equal((await reset(s, actor.user.email, s.code())).status, 200);
});

test("resend hourly and IP limits apply equally to nonexistent addresses", async (t) => {
  const s = await setup(t);
  for (let index = 0; index < 5; index++) {
    assert.equal((await forgot(s, "hourly@example.test")).status, 200);
    s.advance(60_001);
  }
  assert.equal((await forgot(s, "hourly@example.test")).status, 429);
  for (let index = 0; index < 15; index++)
    assert.equal((await forgot(s, `ip-${index}@example.test`)).status, 200);
  assert.equal((await forgot(s, "ip-overflow@example.test")).status, 429);
  assert.equal(s.mails.length, 0);
});

test("concurrent resets consume one code only", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "concurrent@example.test");
  await forgot(s, actor.user.email);
  const results = await Promise.all([
    reset(s, actor.user.email, s.code()), reset(s, actor.user.email, s.code()),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
});

test("recreated API instances preserve code attempts and email cooldowns", async (t) => {
  const s = await setup(t);
  const actor = await user(s, "persistent@example.test");
  await forgot(s, actor.user.email);
  const code = s.code();
  const wrong = code === "000000" ? "000001" : "000000";
  await reset(s, actor.user.email, wrong);
  const app = createApp({
    dbPath: join(s.dir, "test.sqlite"), clock: s.clock,
    env: { NODE_ENV: "test" },
    passwordResetTransport: { sendMail: async () => assert.fail("cooldown should prevent email") },
  });
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const restarted = { base: `http://127.0.0.1:${listener.address().port}` };
  try {
    assert.equal((await forgot(restarted, actor.user.email)).status, 429);
    assert.equal(app.locals.db.prepare("SELECT attempts FROM password_reset_codes").get().attempts, 1);
    assert.equal((await reset(restarted, actor.user.email, code)).status, 200);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
    app.locals.close();
  }
});
