export async function register() {
  // Builds must never open or migrate the live database or start job timers.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { getRuntime } = await import("./server/runtime.mjs");
    getRuntime();
  }
}
