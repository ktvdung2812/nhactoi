import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { openDatabase } from "../database-helpers.mjs";

const projectRoot = process.cwd();
const nextBuildId = join(projectRoot, process.env.NHACTOI_DIST_DIR || ".next", "BUILD_ID");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error("could not reserve a test port");
  return port;
}

function childExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

async function waitForServer(url, child, output) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `next start exited before becoming ready (${child.exitCode ?? child.signalCode})\n${output.join("")}`,
      );
    }
    try {
      const response = await fetch(url);
      return response;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error(
    `timed out waiting for next start: ${lastError?.message || "unknown error"}\n${output.join("")}`,
  );
}

function sessionCookie(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const header = values[0] || response.headers.get("set-cookie") || "";
  return header.split(";", 1)[0];
}

async function request(base, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (
    body !== undefined &&
    body !== null &&
    typeof body === "object" &&
    !ArrayBuffer.isView(body) &&
    !(body instanceof ArrayBuffer)
  ) {
    body = JSON.stringify(body);
    headers["content-type"] ||= "application/json";
  }
  if (options.cookie) headers.cookie = options.cookie;
  return fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers,
    body,
  });
}

async function jsonResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep the original text for assertions against non-JSON Next pages.
  }
  return { body, text };
}

test(
  "Next production runtime serves pages and the internal Express API contract",
  async (t) => {
    assert.ok(
      existsSync(nextBuildId),
      "Next production build is missing; run npm run build before npm run test:next.",
    );
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const tempRoot = mkdtempSync(join(tmpdir(), "nhactoi-next-runtime-"));
    const database = openDatabase();
    const schema = database.schema;
    database.close();
    const output = [];
    const child = spawn(
      process.execPath,
      [
        join(projectRoot, "node_modules", "next", "dist", "bin", "next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: process.env.TEST_DATABASE_URL,
          DATABASE_SCHEMA: schema,
          NHACTOI_DATA_DIR: tempRoot,
          BOOTSTRAP_ADMIN_NAME: "",
          BOOTSTRAP_ADMIN_EMAIL: "",
          BOOTSTRAP_ADMIN_PASSWORD: "",
          PUBLIC_APP_URL: base,
          FRONTEND_ORIGIN: base,
          COOKIE_SECURE: "false",
          DISABLE_BACKGROUND_WORKER: "true",
          WEB_PUSH_PUBLIC_KEY: "",
          WEB_PUSH_PRIVATE_KEY: "",
          NHACTOI_SETTINGS_KEY:
            "1111111111111111111111111111111111111111111111111111111111111111",
          BILLGATE_API_URL: "",
          BILLGATE_API_KEY: "",
          BILLGATE_PROJECT_ID: "",
          BILLGATE_CHECKOUT_URL: "",
          BILLGATE_WEBHOOK_SECRET: "next-runtime-webhook-secret",
          BILLING_GATEWAY_API_URL: "",
          BILLING_GATEWAY_API_KEY: "",
          BILLING_GATEWAY_PROJECT_ID: "",
          BILLING_WEBHOOK_SECRET: "",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => output.push(String(chunk)));
    child.stderr.on("data", (chunk) => output.push(String(chunk)));
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await Promise.race([childExit(child), delay(5_000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      rmSync(tempRoot, { recursive: true, force: true });
    });

    const ready = await waitForServer(`${base}/dashboard`, child, output);
    assert.equal(ready.status, 200);
    const readyPage = await ready.text();
    assert.match(readyPage, /Đang mở không gian làm việc/);

    const credentialsFile = readdirSync(tempRoot).find(name => name.startsWith('bootstrap-admin-'));
    assert.ok(credentialsFile, 'startup saves generated admin credentials');
    const credentials = JSON.parse(readFileSync(join(tempRoot, credentialsFile), 'utf8'));
    const adminLogin = await request(base, '/api/auth/login', { method: 'POST', body: credentials });
    assert.equal(adminLogin.status, 200);
    assert.equal((await request(base, '/api/admin/overview', { cookie: sessionCookie(adminLogin) })).status, 200);

    const manifestResponse = await request(base, '/manifest.webmanifest');
    assert.equal(manifestResponse.status, 200);
    assert.equal((await manifestResponse.json()).display, 'standalone');
    const workerResponse = await request(base, '/sw.js');
    assert.equal(workerResponse.status, 200);
    assert.equal(workerResponse.headers.get('cache-control'), 'no-cache');
    assert.match(await workerResponse.text(), /notificationclick/);
    assert.equal((await request(base, '/icons/icon-192.png')).headers.get('content-type'), 'image/png');
    assert.equal((await request(base, '/offline.html')).status, 200);

    const deepLink = await request(base, "/tasks/direct-deep-link");
    assert.equal(deepLink.status, 200);
    assert.match(await deepLink.text(), /Đang mở không gian làm việc/);

    for (const path of ["/login", "/register", "/forgot-password", "/reset-password", "/inbox", "/today", "/upcoming", "/week"]) {
      const authPage = await request(base, path);
      assert.equal(authPage.status, 200, path);
      assert.match(await authPage.text(), /Đang mở không gian làm việc/);
    }

    const unknownPage = await request(base, "/this-page-does-not-exist");
    assert.equal(unknownPage.status, 404);

    for (const hiddenPath of ["/.env", "/server/index.mjs", "/data/nhactoi.sqlite"]) {
      const hidden = await request(base, hiddenPath);
      assert.equal(hidden.status, 404, hiddenPath);
    }

    const apiMissing = await request(base, "/api/this-route-does-not-exist");
    const apiMissingResult = await jsonResponse(apiMissing);
    assert.equal(apiMissing.status, 404);
    assert.match(apiMissing.headers.get("content-type") || "", /application\/json/);
    assert.equal(apiMissingResult.body?.error, "route was not found");

    const evilOrigin = await request(base, "/api/auth/register", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: {
        name: "Origin test",
        email: `origin-${randomUUID()}@example.test`,
        password: "password123",
        workspaceName: "Origin test workspace",
      },
    });
    const evilOriginResult = await jsonResponse(evilOrigin);
    assert.equal(evilOrigin.status, 403);
    assert.equal(evilOriginResult.body?.error, "request origin is not allowed");

    const malformedJson = await request(base, "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"name":',
    });
    const malformedResult = await jsonResponse(malformedJson);
    assert.equal(malformedJson.status, 400);
    assert.equal(malformedResult.body?.error, "Nội dung JSON không hợp lệ");

    const oversizedJson = `{"data":"${"x".repeat(1_048_700)}"}`;
    const oversized = await request(base, "/api/board-transfer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversizedJson,
    });
    const oversizedResult = await jsonResponse(oversized);
    assert.equal(oversized.status, 413);
    assert.equal(
      oversizedResult.body?.error,
      "Dữ liệu gửi lên vượt quá dung lượng cho phép",
    );

    const email = `next-runtime-${randomUUID()}@example.test`;
    const registration = await request(base, "/api/auth/register", {
      method: "POST",
      body: {
        name: "Next Runtime",
        email,
        password: "password123",
        workspaceName: "Next Runtime Workspace",
        industry: "Dịch vụ",
      },
    });
    const registrationResult = await jsonResponse(registration);
    const cookie = sessionCookie(registration);
    assert.equal(registration.status, 201, registrationResult.text);
    assert.ok(cookie, "registration should issue an HttpOnly session cookie");
    assert.match(registration.headers.get("set-cookie") || "", /HttpOnly/i);

    const me = await request(base, "/api/me", { cookie });
    const meResult = await jsonResponse(me);
    assert.equal(me.status, 200);
    assert.equal(meResult.body?.user?.id, registrationResult.body?.user?.id);

    const pushConfig = await request(base, '/api/web-push/config', { cookie });
    assert.equal(pushConfig.status, 200);
    assert.equal(pushConfig.headers.get('cache-control'), 'private, no-store');
    assert.equal((await pushConfig.json()).enabled, false);

    const captured = await request(base, '/api/tasks', { cookie, method: 'POST', body: { title: 'Inbox qua Next' } });
    const capturedBody = await jsonResponse(captured);
    assert.equal(captured.status, 201, capturedBody.text);
    assert.equal(capturedBody.body.task.dueAt, null);
    const planned = await request(base, `/api/tasks/${capturedBody.body.task.id}/plan`, { cookie, method: 'PATCH', body: { plannedDate: '2030-01-01', plannedTime: '09:00', plannedDuration: 90 } });
    assert.equal(planned.status, 200);
    const personal = await jsonResponse(await request(base, '/api/personal-tasks', { cookie }));
    assert.equal(personal.body.tasks.find(t => t.id === capturedBody.body.task.id).plannedDate, '2030-01-01');
    assert.equal(personal.body.tasks.find(t => t.id === capturedBody.body.task.id).plannedTime, '09:00');
    assert.equal(personal.body.tasks.find(t => t.id === capturedBody.body.task.id).plannedDuration, 90);

    const title = `Next query ${randomUUID()}`;
    const task = await request(base, "/api/tasks", {
      method: "POST",
      cookie,
      body: {
        title,
        description: "Query filter coverage",
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        status: "todo",
      },
    });
    const taskResult = await jsonResponse(task);
    assert.equal(task.status, 201, taskResult.text);
    const taskId = taskResult.body?.task?.id;
    assert.ok(taskId);

    const filtered = await request(
      base,
      `/api/tasks?q=${encodeURIComponent(title)}&status=todo&page=1&pageSize=10`,
      { cookie },
    );
    const filteredResult = await jsonResponse(filtered);
    assert.equal(filtered.status, 200);
    assert.equal(filteredResult.body?.page, 1);
    assert.equal(filteredResult.body?.pageSize, 10);
    assert.equal(filteredResult.body?.total, 1);
    assert.equal(filteredResult.body?.tasks?.[0]?.id, taskId);

    // A malformed percent escape must be parsed by Express from req.url after
    // the Next catch-all query object is removed, without becoming a 500.
    const malformedQuery = await request(
      base,
      "/api/tasks?status=todo&broken=%E0%A4%A",
      { cookie },
    );
    const malformedQueryResult = await jsonResponse(malformedQuery);
    assert.equal(malformedQuery.status, 200, malformedQueryResult.text);
    assert.ok(Array.isArray(malformedQueryResult.body?.tasks));

    const webhookPayload = JSON.stringify({
      id: `next-webhook-${randomUUID()}`,
      event: "payment.paid",
      data: {
        payment: {
          id: "payment-raw-body",
          externalId: "order-does-not-exist",
          status: "paid",
          amountPaid: 1,
          totalAmount: 1,
          currency: "VND",
        },
      },
    });
    const signature = `sha256=${createHmac(
      "sha256",
      "next-runtime-webhook-secret",
    )
      .update(webhookPayload)
      .digest("hex")}`;
    const webhook = await request(base, "/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-billgate-signature": signature,
      },
      body: webhookPayload,
    });
    const webhookResult = await jsonResponse(webhook);
    assert.equal(webhook.status, 404);
    assert.equal(webhookResult.body?.error, "billing order was not found");

    const invalidWebhook = await request(base, "/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-billgate-signature": "sha256=invalid",
      },
      body: webhookPayload,
    });
    const invalidWebhookResult = await jsonResponse(invalidWebhook);
    assert.equal(invalidWebhook.status, 401);
    assert.equal(invalidWebhookResult.body?.error, "invalid webhook signature");

    const bytes = Buffer.from("Next runtime private attachment\0\xff", "utf8");
    const upload = await request(base, `/api/tasks/${taskId}/files`, {
      method: "POST",
      cookie,
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent("next-runtime.bin"),
      },
      body: bytes,
    });
    const uploadResult = await jsonResponse(upload);
    assert.equal(upload.status, 201, uploadResult.text);
    const attachmentId = uploadResult.body?.attachment?.id;
    assert.ok(attachmentId);

    const download = await request(
      base,
      `/api/tasks/${taskId}/attachments/${attachmentId}/download`,
      { cookie },
    );
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  },
);
