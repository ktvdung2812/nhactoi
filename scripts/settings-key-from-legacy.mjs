// Prints the 64-hex NHACTOI_SETTINGS_KEY that matches a value accepted by
// releases before the 32-byte requirement. Reads the old value from stdin so
// it never lands in shell history or the process list:
//   printf %s '<old value>' | npm run -s settings-key:migrate
// Writes nothing else and never opens the database.
import { createHash } from "node:crypto";

// Exact copy of the old deriveSettingsKey (git show 49aacda^:server/index.mjs).
// Node's base64 decoder skips characters outside the alphabet, so some
// passphrases (43 base64 characters among spaces/punctuation) were used as
// decoded bytes rather than their SHA-256 digest.
function legacySettingsKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^[a-f0-9]{64}$/i.test(text)) return Buffer.from(text, "hex");
  try {
    const decoded = Buffer.from(text, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(text, "utf8").digest();
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const key = legacySettingsKey(Buffer.concat(chunks).toString("utf8"));
if (!key) {
  process.stderr.write("Không nhận được giá trị cũ. Dùng: printf %s '<giá trị cũ>' | npm run -s settings-key:migrate\n");
  process.exit(1);
}
process.stdout.write(key.toString("hex") + "\n");
