import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from './database-helpers.mjs';
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("dev-accounts and dev-login endpoints operate properly in dev and are disabled in production", async (t) => {
  const devApp = createApp({ dbPath: ":memory:", env: { NODE_ENV: "development", NHACTOI_DEV_LOGIN: "true" } });
  const devServer = await new Promise((res) => {
    const s = devApp.listen(0, "127.0.0.1", () => res(s));
  });
  const devBase = `http://127.0.0.1:${devServer.address().port}`;

  t.after(() => {
    devServer.close();
    devApp.locals.close();
  });

  // 1. GET /api/auth/dev-accounts in dev
  const devAccountsRes = await fetch(`${devBase}/api/auth/dev-accounts`);
  assert.equal(devAccountsRes.status, 200);
  const devAccountsData = await devAccountsRes.json();
  assert.equal(devAccountsData.enabled, true);
  assert.equal(Array.isArray(devAccountsData.accounts), true);
  assert.equal(devAccountsData.accounts.length, 3);

  const [owner, admin, member] = devAccountsData.accounts;
  assert.equal(owner.email, "demo@nhactoi.local");
  assert.equal(owner.badge, "Owner");
  assert.equal(admin.email, "an@nhactoi.local");
  assert.equal(admin.badge, "Admin");
  assert.equal(member.email, "minh@nhactoi.local");
  assert.equal(member.badge, "Member");

  // 2. POST /api/auth/dev-login in dev for each account
  for (const acc of devAccountsData.accounts) {
    const loginRes = await fetch(`${devBase}/api/auth/dev-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: acc.email }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.equal(loginData.user.email, acc.email);
    assert.ok(loginData.workspace);
    assert.ok(loginData.subscription);
    const cookie = loginRes.headers.get("set-cookie");
    assert.ok(cookie);
    assert.ok(cookie.includes("nt_session="));
  }

  // 3. POST /api/auth/dev-login with unknown email fails with 404
  const unknownRes = await fetch(`${devBase}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "unknown@example.com" }),
  });
  assert.equal(unknownRes.status, 404);

  // 3b. A real account outside the demo allow-list cannot be opened without a password.
  const register = await fetch(`${devBase}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Real admin", email: "real-admin@example.com", password: "Password123!", workspaceName: "Real" }),
  });
  assert.equal(register.status, 201);
  devApp.locals.db.prepare("UPDATE users SET is_platform_admin = 1 WHERE email = ?").run("real-admin@example.com");
  const realRes = await fetch(`${devBase}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "real-admin@example.com" }),
  });
  assert.equal(realRes.status, 404);
  assert.equal(realRes.headers.get("set-cookie"), null);

  // 4. Production mode disables dev-accounts and dev-login
  const prodApp = createApp({ dbPath: ":memory:", env: { NODE_ENV: "production", NHACTOI_DEV_LOGIN: "true" } });
  const prodServer = await new Promise((res) => {
    const s = prodApp.listen(0, "127.0.0.1", () => res(s));
  });
  const prodBase = `http://127.0.0.1:${prodServer.address().port}`;

  t.after(() => {
    prodServer.close();
    prodApp.locals.close();
  });

  const prodAccountsRes = await fetch(`${prodBase}/api/auth/dev-accounts`);
  assert.equal(prodAccountsRes.status, 200);
  const prodAccountsData = await prodAccountsRes.json();
  assert.equal(prodAccountsData.enabled, false);
  assert.deepEqual(prodAccountsData.accounts, []);

  const prodLoginRes = await fetch(`${prodBase}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@nhactoi.local" }),
  });
  assert.equal(prodLoginRes.status, 404);
});

test("development without NHACTOI_DEV_LOGIN keeps passwordless login closed", async (t) => {
  const app = createApp({ dbPath: ":memory:", env: { NODE_ENV: "development" } });
  const server = await new Promise((res) => {
    const s = app.listen(0, "127.0.0.1", () => res(s));
  });
  t.after(() => {
    server.close();
    app.locals.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const accounts = await fetch(`${base}/api/auth/dev-accounts`);
  assert.deepEqual(await accounts.json(), { enabled: false, accounts: [] });
  const login = await fetch(`${base}/api/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@nhactoi.local" }),
  });
  assert.equal(login.status, 404);
  assert.equal(login.headers.get("x-powered-by"), null);
  assert.equal(app.locals.db.prepare("SELECT COUNT(*) AS count FROM users WHERE email = ?").get("demo@nhactoi.local").count, 0);
});

test("dev quick login CSS classes and Dark mode rules are defined", () => {
  const stylesCss = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
  const designSystemCss = readFileSync(resolve(process.cwd(), "src/design-system.css"), "utf8");

  assert.ok(stylesCss.includes(".dev-quick-login-wrap"));
  assert.ok(stylesCss.includes(".dev-quick-login-btn"));
  assert.ok(stylesCss.includes(".dev-accounts-panel"));
  assert.ok(stylesCss.includes(".dev-account-card"));
  assert.ok(stylesCss.includes('[data-theme="dark"] .dev-quick-login-btn'));
  assert.ok(stylesCss.includes('[data-theme="dark"] .dev-accounts-panel'));
  assert.ok(stylesCss.includes('[data-theme="dark"] .dev-account-card'));

  assert.ok(designSystemCss.includes(".dev-accounts-panel"));
  assert.ok(designSystemCss.includes(".dev-account-card"));
});

test("[SQLite legacy] sessions carry auth_method; dev login records 'dev' and password sign-ins 'password'", async (t) => {
  const app = createApp({ dbPath: ":memory:", env: { NODE_ENV: "development", NHACTOI_DEV_LOGIN: "true" } });
  const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  t.after(() => { server.close(); app.locals.close(); });
  const db = app.locals.db;
  const base = `http://127.0.0.1:${server.address().port}`;
  if (db.dialect !== "postgres")
    assert.ok(db.prepare("PRAGMA table_info(sessions)").all().some((column) => column.name === "auth_method"));
  const post = (path, body) => fetch(`${base}/api${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const dev = await post("/auth/dev-login", { email: "demo@nhactoi.local" });
  assert.equal(dev.status, 200);
  const devUser = (await dev.json()).user.id;
  assert.deepEqual(db.prepare("SELECT auth_method FROM sessions WHERE user_id = ?").all(devUser).map((row) => row.auth_method), ["dev"]);
  const registered = await post("/auth/register", {
    name: "Legacy", email: "legacy-auth-method@example.test", password: "Password123!", workspaceName: "Legacy",
  });
  assert.equal(registered.status, 201);
  const userId = (await registered.json()).user.id;
  assert.equal((await post("/auth/login", { email: "legacy-auth-method@example.test", password: "Password123!" })).status, 200);
  assert.deepEqual(db.prepare("SELECT auth_method FROM sessions WHERE user_id = ?").all(userId).map((row) => row.auth_method), ["password", "password"]);
});
