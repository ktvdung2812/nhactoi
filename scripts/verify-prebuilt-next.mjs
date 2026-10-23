import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const distDir = process.env.NHACTOI_DIST_DIR || ".next";
const expectedPath = join(root, distDir, "BUILD_NEXT_VERSION");

let expected;
try {
  expected = readFileSync(expectedPath, "utf8").trim();
} catch {
  process.exit(0);
}

const runtime = JSON.parse(
  readFileSync(join(root, "node_modules", "next", "package.json"), "utf8"),
).version;

if (expected !== runtime) {
  console.error(
    `[nhactoi] Prebuilt .next was built with Next.js ${expected}, but node_modules has ${runtime}.`,
  );
  console.error(
    "[nhactoi] Run npm ci --omit=dev in this release (do not reuse an old node_modules).",
  );
  process.exit(1);
}
