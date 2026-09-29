import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";
import { readRoute, isValidRoute } from "../src/routes.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

test("customer routes, API endpoint GET /api/customers/:id, and detail page support", async (t) => {
  // 1. Route validation
  assert.equal(readRoute("/customers"), "customers");
  assert.equal(readRoute("/customers/customer_123"), "customers/customer_123");
  assert.equal(isValidRoute("/customers/customer_123"), true);
  assert.equal(isValidRoute("/customers/not_valid/extra"), false);

  // 2. Server API GET /api/customers/:id
  const app = createApp({ dbPath: ":memory:" });
  const server = await new Promise((res) => {
    const s = app.listen(0, "127.0.0.1", () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(() => {
    server.close();
    app.locals.close();
  });

  // Register user
  const authRes = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "test-customer@nhactoi.local",
      password: "Password123!",
      name: "Customer Tester",
      workspaceName: "Customer Space",
    }),
  });
  assert.equal(authRes.status, 201);
  const cookie = authRes.headers.get("set-cookie");

  // Create a customer
  const createRes = await fetch(`${base}/api/customers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      name: "Công ty ABC",
      company: "ABC Corp",
      email: "contact@abc.vn",
      phone: "0987654321",
      service: "Bảo trì web",
    }),
  });
  assert.equal(createRes.status, 201);
  const { customer } = await createRes.json();
  assert.ok(customer.id);
  assert.equal(customer.name, "Công ty ABC");

  // GET /api/customers/:id
  const getRes = await fetch(`${base}/api/customers/${customer.id}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.equal(getData.customer.id, customer.id);
  assert.equal(getData.customer.name, "Công ty ABC");
  assert.equal(getData.customer.company, "ABC Corp");
  assert.equal(getData.customer.email, "contact@abc.vn");

  // GET unknown customer -> 404
  const notFoundRes = await fetch(`${base}/api/customers/customer_nonexistent`, {
    headers: { Cookie: cookie },
  });
  assert.equal(notFoundRes.status, 404);

  // 3. Verify CustomerDetail component and CSS files exist
  const customerDetailPath = resolve(process.cwd(), "src/CustomerDetail.jsx");
  const customerCssPath = resolve(process.cwd(), "src/customer-detail.css");
  assert.equal(existsSync(customerDetailPath), true);
  assert.equal(existsSync(customerCssPath), true);

  const cssContent = readFileSync(customerCssPath, "utf-8");
  assert.ok(cssContent.includes(".customer-detail-page"));
  assert.ok(cssContent.includes(".customer-hero-card"));
  assert.ok(cssContent.includes(".customer-stats-grid"));
  assert.ok(cssContent.includes(".customer-tasks-toolbar"));
  assert.ok(cssContent.includes("[data-theme=\"dark\"]"));

  // 4. Verify automations nav item is hidden from sidebar
  const appJsxContent = readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf-8");
  assert.ok(appJsxContent.includes("n[0] !== \"automations\""));
  assert.ok(appJsxContent.includes("n[0] !== \"templates\""));
});
