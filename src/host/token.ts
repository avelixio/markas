import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Reads the host bearer token, creating it (mode 0600) on first run. */
export async function ensureToken(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (TOKEN_PATTERN.test(existing)) return existing;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const token = randomBytes(32).toString("hex");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}

export async function readToken(path: string): Promise<string | null> {
  try {
    const token = (await readFile(path, "utf8")).trim();
    return TOKEN_PATTERN.test(token) ? token : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Constant-time comparison that does not leak the length of either side. */
export function tokensMatch(expected: string, presented: string): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(presented).digest();
  return timingSafeEqual(left, right);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
