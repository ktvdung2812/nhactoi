import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createApp } from "./database-helpers.mjs";
import { boot, call, user } from "./roadmap-helpers.mjs";

const login = (s, email, mobile = false, password = "wrong-password") => call(s,
  mobile ? "/mobile/auth/login" : "/auth/login",
  { method: "POST", body: { email, password } });

test("web/mobile logins share an IP limit across rotating emails and expire old buckets", async t => {
  let now = Date.parse("2026-10-01T00:00:00Z");
  const s = await boot(t, { clock: () => new Date(now) });
  for (let index = 0; index < 30; index++) {
    // A large, malformed mobile email must not become a retained bucket key.
    const email = index === 1 ? "x".repeat(10_000) : `rotate-${index}@example.test`;
    assert.equal((await login(s, email, index % 2 === 1)).status, 401);
  }
  assert.equal((await login(s, "new-web@example.test")).status, 429);
  assert.equal((await login(s, "new-mobile@example.test", true)).status, 429);
  const buckets = s.db.prepare("SELECT bucket FROM auth_request_limits WHERE bucket LIKE 'login:%'").all();
  // One IP bucket plus a per-email quota and a failure counter for each email.
  assert.equal(buckets.length, 61);
  assert.ok(buckets.every(row => row.bucket.length < 100 && !row.bucket.includes("@")));

  now += 60_001;
  assert.equal((await login(s, "after-expiry@example.test", true)).status, 401);
  // Minute buckets expired; the 15-minute per-email quotas remain.
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM auth_request_limits WHERE bucket LIKE 'login:%'").get().n, 33);
});

test("one account accepts at most 20 login attempts per 15 minutes across rotating IPs", async t => {
  let now = Date.parse("2026-10-01T00:00:00Z");
  const s = await boot(t, { clock: () => new Date(now) });
  const actor = await user(s, "spray-target@example.test");
  // The test client is on loopback, the only trusted proxy hop.
  const from = (ip, email, password, mobile = false) => fetch(`${s.base}/api${mobile ? "/mobile/auth/login" : "/auth/login"}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
  for (let index = 0; index < 20; index++)
    assert.equal((await from(`198.51.100.${index + 1}`, actor.user.email, "wrong-password", index % 2 === 1)).status, 401);
  const blocked = await from("203.0.113.9", actor.user.email.toUpperCase(), "Password123!");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 60);
  assert.equal((await from("203.0.113.9", actor.user.email, "Password123!", true)).status, 429);
  assert.equal((await from("203.0.113.9", "someone-else@example.test", "wrong-password")).status, 401);
  now += 15 * 60_000 + 1;
  assert.equal((await from("203.0.113.10", actor.user.email, "Password123!")).status, 200);
});

test("successful login resets account failures but does not reset the shared IP quota", async t => {
  const s = await boot(t);
  const actor = await user(s, "login-limit@example.test");
  for (let index = 0; index < 4; index++) assert.equal((await login(s, actor.user.email)).status, 401);
  assert.equal((await login(s, actor.user.email.toUpperCase(), true, "Password123!")).status, 200);
  for (let index = 0; index < 5; index++) assert.equal((await login(s, actor.user.email, index % 2 === 0)).status, 401);
  assert.equal((await login(s, actor.user.email, false, "Password123!")).status, 429);
  for (let index = 0; index < 19; index++) assert.equal((await login(s, `other-${index}@example.test`, true)).status, 401);
  assert.equal((await login(s, "ip-quota@example.test")).status, 429);
});

test("login quotas survive app recreation and release after cooldown", async t => {
  let now = Date.parse("2026-10-01T00:00:00Z");
  const clock = () => new Date(now);
  const s = await boot(t, { clock });
  for (let index = 0; index < 5; index++) assert.equal((await login(s, "restart@example.test")).status, 401);
  const app = createApp({ db: s.db, dbPath: join(s.dir, "test.sqlite"),
    env: { NODE_ENV: "test", FRONTEND_ORIGIN: "http://localhost:5173" }, clock });
  const server = await new Promise(resolve => {
    const running = app.listen(0, "127.0.0.1", () => resolve(running));
  });
  try {
    const restarted = { base: `http://127.0.0.1:${server.address().port}` };
    const denied = await fetch(`${restarted.base}/api/mobile/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: " RESTART@EXAMPLE.TEST ", password: "wrong-password" }),
    });
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("retry-after"), "60");
    now += 60_001;
    assert.equal((await login(restarted, "restart@example.test", true)).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    app.locals.close();
  }
});
