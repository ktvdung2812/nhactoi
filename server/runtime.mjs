import { createApp } from "./index.mjs";

// Next dev reloads modules. Keep one database connection and one worker per
// server process, shared by instrumentation and every API request.
const runtimeKey = Symbol.for("nhactoi.server.runtime");

export function getRuntime() {
  if (!globalThis[runtimeKey]) {
    const app = createApp({ startWorker: process.env.DISABLE_BACKGROUND_WORKER !== "true" });
    globalThis[runtimeKey] = app;
    process.once("exit", () => app.locals.close());
  }
  return globalThis[runtimeKey];
}
