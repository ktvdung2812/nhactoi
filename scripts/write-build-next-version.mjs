import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const distDir = process.env.NHACTOI_DIST_DIR || ".next";
const buildIdPath = join(root, distDir, "BUILD_ID");

try {
  readFileSync(buildIdPath, "utf8");
} catch {
  process.exit(0);
}

const nextVersion = JSON.parse(
  readFileSync(join(root, "node_modules", "next", "package.json"), "utf8"),
).version;

writeFileSync(join(root, distDir, "BUILD_NEXT_VERSION"), `${nextVersion}\n`, "utf8");
