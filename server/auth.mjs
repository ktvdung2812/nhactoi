import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export function createId(prefix = "") {
  return `${prefix}${randomUUID()}`;
}

export function createToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const cost = 16384;
  const blockSize = 8;
  const parallelism = 1;
  const derived = scryptSync(String(password), salt, 64, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: 32 * 1024 * 1024,
  });
  return `scrypt$${cost}$${blockSize}$${parallelism}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltText, hashText] = String(encoded).split("$");
    if (algorithm !== "scrypt" || !n || !r || !p || !saltText || !hashText)
      return false;
    const expected = Buffer.from(hashText, "base64url");
    const actual = scryptSync(
      String(password),
      Buffer.from(saltText, "base64url"),
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: 32 * 1024 * 1024,
      },
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

let dummyPasswordHash;
// Unknown emails still pay for one scrypt run, so login response time does
// not reveal whether an account exists.
export function verifyPasswordOrDummy(password, encoded) {
  if (encoded) return verifyPassword(password, encoded);
  verifyPassword(password, (dummyPasswordHash ||= hashPassword(createToken())));
  return false;
}

export function safeEqualText(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
