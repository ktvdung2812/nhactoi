import test from "node:test";
import assert from "node:assert/strict";
import {
  canReadOffline,
  cacheScope,
  OFFLINE_TTL,
  isWritable,
} from "../src/core/policy.ts";
test("offline permission expires at earliest of 24h verification and session expiry", () => {
  const now = Date.parse("2026-09-22T10:00:00Z");
  assert.equal(
    canReadOffline(
      {
        expiresAt: new Date(now + 1000).toISOString(),
        verifiedAt: now - OFFLINE_TTL + 1,
      },
      now,
    ),
    true,
  );
  assert.equal(
    canReadOffline(
      {
        expiresAt: new Date(now + 1000).toISOString(),
        verifiedAt: now - OFFLINE_TTL,
      },
      now,
    ),
    false,
  );
  assert.equal(
    canReadOffline(
      { expiresAt: new Date(now).toISOString(), verifiedAt: now - 1 },
      now,
    ),
    false,
  );
  assert.equal(
    canReadOffline(
      { expiresAt: new Date(now + 1000).toISOString(), verifiedAt: now + 1 },
      now,
    ),
    false,
  );
});
test("cache identity cannot cross server, account, or workspace", () => {
  const keys = [
    cacheScope("https://a", "u", "w"),
    cacheScope("https://b", "u", "w"),
    cacheScope("https://a", "other", "w"),
    cacheScope("https://a", "u", "other"),
  ];
  assert.equal(new Set(keys).size, 4);
  assert.notEqual(cacheScope("a", "b|c", "d"), cacheScope("a", "b", "c|d"));
});
test("writes require connection, active workspace and unexpired subscription", () => {
  const session = {
    workspace: { suspendedAt: null },
    subscription: {
      status: "trialing",
      currentPeriodEnd: new Date(Date.now() + 60000).toISOString(),
    },
  };
  assert.equal(isWritable(session, true), true);
  assert.equal(isWritable(session, false), false);
  assert.equal(
    isWritable(
      { ...session, workspace: { suspendedAt: new Date().toISOString() } },
      true,
    ),
    false,
  );
  assert.equal(
    isWritable(
      {
        ...session,
        subscription: { ...session.subscription, status: "canceled" },
      },
      true,
    ),
    false,
  );
  assert.equal(
    isWritable(
      {
        ...session,
        subscription: {
          ...session.subscription,
          currentPeriodEnd: "2020-01-01",
        },
      },
      true,
    ),
    false,
  );
});
