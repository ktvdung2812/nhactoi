import test from "node:test";
import assert from "node:assert/strict";
import { serialQueue } from "../src/core/serial.ts";
test("logout erase runs after an already queued slow cache write", async () => {
  const run = serialQueue();
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const storage: string[] = [];
  const write = run(async () => {
    await pending;
    storage.push("private task");
  });
  const erase = run(async () => {
    storage.length = 0;
  });
  release();
  await Promise.all([write, erase]);
  assert.deepEqual(storage, []);
});
test("failed cache operation does not prevent following erase", async () => {
  const run = serialQueue();
  let erased = false;
  const fail = run(async () => {
    throw new Error("disk");
  });
  const clear = run(async () => {
    erased = true;
  });
  await assert.rejects(fail);
  await clear;
  assert.equal(erased, true);
});
