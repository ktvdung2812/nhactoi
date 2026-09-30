import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { createApp } from './database-helpers.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

// This provider fixture follows billgateway/server/src/services/payment.service.ts:
// the payment id is data.payment.id; transactionId is a DIFFERENT bank identifier.
test("BillGateway checkout, exact signed envelope, and polling settle only the matching fully paid invoice", async (t) => {
  const secret = "isolated-contract-test-secret";
  const projectId = "project_contract";
  const payments = new Map();
  const requests = [];
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const payload = body ? JSON.parse(body) : null;
    requests.push({
      method: req.method,
      url: req.url,
      key: req.headers["x-api-key"],
      payload,
    });
    res.setHeader("content-type", "application/json");
    if (req.headers["x-api-key"] !== "bg_proj_contract_fixture") {
      res.writeHead(401);
      return res.end(JSON.stringify({ success: false }));
    }
    if (req.method === "POST" && req.url === "/api/v1/integration/payments") {
      const id = `payment_${payments.size + 1}`;
      const totalAmount =
        payload.totalAmount ??
        payload.items?.reduce(
          (sum, item) => sum + item.quantity * item.unitAmount,
          0,
        );
      const payment = {
        id,
        projectId,
        code: `NHAC${payments.size + 1}`,
        externalId: payload.externalId,
        currency: payload.currency,
        totalAmount,
        subtotalAmount: totalAmount,
        amountPaid: 0,
        balance: totalAmount,
        status: "open",
        hostedUrl: `/pay/${id}`,
        hostedPath: `/pay/${id}`,
        metadata: payload.metadata,
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      };
      payments.set(id, payment);
      res.writeHead(201);
      return res.end(JSON.stringify({ success: true, data: payment }));
    }
    const id = decodeURIComponent(req.url.split("/").at(-1));
    if (req.method === "GET" && payments.has(id))
      return res.end(JSON.stringify({ success: true, data: payments.get(id) }));
    res.writeHead(404);
    res.end(JSON.stringify({ success: false }));
  });
  const providerUrl = await listen(provider);
  t.after(() => close(provider));
  const app = createApp({
    dbPath: ":memory:",
    env: {
      NODE_ENV: "test",
      BILLGATE_API_URL: providerUrl,
      BILLGATE_API_KEY: "bg_proj_contract_fixture",
      BILLGATE_WEBHOOK_SECRET: secret,
      BILLGATE_PROJECT_ID: projectId,
    },
  });
  const server = createServer(app);
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    app.locals.close();
  });
  let cookie = "";
  async function request(path, body, method = body ? "POST" : "GET") {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return { status: response.status, body: await response.json() };
  }
  async function webhook(
    payment,
    {
      event = "payment.paid",
      id = "evt_paid_1",
      header = event,
      signature,
      project = projectId,
      delivery,
    } = {},
  ) {
    const raw = JSON.stringify({
      id,
      event,
      createdAt: "2026-09-21T08:00:00.000Z",
      project: { id: project, slug: "nhac-toi" },
      data: { payment, transactionId: "bank_transaction_987" },
    });
    const response = await fetch(`${base}/api/billing/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-billgate-event": header,
        "x-billgate-delivery": delivery || `delivery_${id}`,
        "x-billgate-signature":
          signature ||
          `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
      },
      body: raw,
    });
    return { status: response.status, body: await response.json() };
  }
  assert.equal(
    (
      await request("/api/auth/register", {
        name: "Contract Test",
        email: "contract@example.test",
        password: "ContractTest2026!",
        workspaceName: "Contract Test",
      })
    ).status,
    201,
  );
  const initial = await request("/api/me");
  const initialEnd = initial.body.subscription.currentPeriodEnd;
  const checkout = await request("/api/billing/checkout", {
    plan: "team",
    cycle: "yearly",
    amount: 1,
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  assert.equal(requests[0].url, "/api/v1/integration/payments");
  assert.equal(requests[0].key, "bg_proj_contract_fixture");
  const payment = payments.values().next().value;
  assert.equal(
    payment.totalAmount,
    4990000,
    "amount must come from the server plan, never the browser",
  );
  assert.equal(payment.externalId, checkout.body.orderId);
  assert.equal(
    checkout.body.checkoutUrl,
    `${providerUrl}/pay/${payment.id}`,
    "relative hostedUrl must resolve against provider origin",
  );
  let billing = await request("/api/billing");
  assert.equal(
    billing.body.orders[0].checkoutUrl,
    checkout.body.checkoutUrl,
    "pending invoice can be resumed",
  );

  assert.equal(
    (await webhook(payment, { signature: "sha256=" + "0".repeat(64) })).status,
    401,
  );
  const spoofed = await webhook(payment, {
    event: "payment.created",
    header: "payment.paid",
    id: "evt_created",
  });
  assert.equal(
    spoofed.body.extended === true,
    false,
    "unsigned event header must not activate an open payment",
  );
  assert.equal(
    (await request("/api/me")).body.subscription.currentPeriodEnd,
    initialEnd,
  );

  const paid = {
    ...payment,
    status: "paid",
    amountPaid: payment.totalAmount,
    balance: 0,
    paidAt: "2026-09-21T08:00:00.000Z",
  };
  const wrongId = await webhook(
    { ...paid, id: "other_payment" },
    { id: "evt_wrong_id" },
  );
  assert.ok(wrongId.status >= 400, "wrong provider payment id rejected");
  const wrongAmount = await webhook(
    { ...paid, totalAmount: 1 },
    { id: "evt_wrong_total" },
  );
  assert.ok(wrongAmount.status >= 400, "wrong invoice total rejected");
  assert.ok(
    (
      await webhook(
        { ...paid, totalAmount: paid.totalAmount + 0.01 },
        { id: "evt_wrong_decimal" },
      )
    ).status >= 400,
    "amount comparison must not round away mismatches",
  );
  const wrongCurrency = await webhook(
    { ...paid, currency: "USD" },
    { id: "evt_wrong_currency" },
  );
  assert.ok(wrongCurrency.status >= 400, "wrong currency rejected");
  const underpaid = await webhook(
    { ...paid, amountPaid: 1, balance: payment.totalAmount - 1 },
    { id: "evt_underpaid" },
  );
  assert.notEqual(
    underpaid.body.extended,
    true,
    "underpaid invoice must not activate even if status says paid",
  );
  assert.equal(
    (await request("/api/me")).body.subscription.currentPeriodEnd,
    initialEnd,
  );
  const wrongProject = await webhook(paid, {
    id: "evt_wrong_project",
    project: "other_project",
  });
  assert.ok(wrongProject.status >= 400, "wrong configured project rejected");

  const settled = await webhook(paid);
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal(settled.body.extended, true);
  const settledEnd = (await request("/api/me")).body.subscription
    .currentPeriodEnd;
  assert.notEqual(settledEnd, initialEnd);
  const duplicate = await webhook(
    { ...paid, updatedAt: "2026-09-21T08:05:00.000Z" },
    { delivery: "a-new-transport-delivery" },
  );
  assert.equal(duplicate.status, 200);
  assert.equal(
    duplicate.body.duplicate,
    true,
    "provider event id is authoritative even if raw bytes change",
  );
  await webhook(paid, { id: "evt_second_delivery" });
  assert.equal(
    (await request("/api/me")).body.subscription.currentPeriodEnd,
    settledEnd,
  );

  // A missed webhook can be recovered on demand using the project-key API.
  const renewal = await request("/api/billing/checkout", {
    plan: "team",
    cycle: "monthly",
  });
  assert.equal(renewal.status, 201);
  const nextPayment = [...payments.values()].find(
    (p) => p.externalId === renewal.body.orderId,
  );
  nextPayment.status = "paid";
  nextPayment.amountPaid = nextPayment.totalAmount;
  nextPayment.balance = 0;
  nextPayment.paidAt = "2026-09-22T08:00:00.000Z";
  nextPayment.updatedAt = nextPayment.paidAt;
  const refresh = await request(
    `/api/billing/orders/${renewal.body.orderId}/refresh`,
    {},
  );
  assert.equal(refresh.status, 200, JSON.stringify(refresh.body));
  assert.equal(refresh.body.extended, true);
  const renewedEnd = (await request("/api/me")).body.subscription
    .currentPeriodEnd;
  assert.notEqual(renewedEnd, settledEnd);
  await request(`/api/billing/orders/${renewal.body.orderId}/refresh`, {});
  assert.equal(
    (await request("/api/me")).body.subscription.currentPeriodEnd,
    renewedEnd,
  );
  billing = await request("/api/billing");
  assert.equal(
    billing.body.orders.filter((o) => o.status === "paid").length,
    2,
  );
  const changedPlan = await request("/api/billing/checkout", {
    plan: "business",
    cycle: "monthly",
  });
  assert.equal(changedPlan.status, 201);
  const changePayment = [...payments.values()].find(
    (p) => p.externalId === changedPlan.body.orderId,
  );
  changePayment.status = "paid";
  changePayment.amountPaid = changePayment.totalAmount;
  changePayment.balance = 0;
  assert.equal(
    (await webhook(changePayment, { id: "evt_plan_change" })).body.extended,
    true,
  );
  const changedEnd = (await request("/api/me")).body.subscription
    .currentPeriodEnd;
  assert.ok(
    new Date(changedEnd) < new Date(renewedEnd),
    "a plan change must not turn unused cheap-plan months into expensive-plan time",
  );
  assert.ok(
    new Date(changedEnd) > new Date(),
    "the purchased new plan remains active",
  );
});
