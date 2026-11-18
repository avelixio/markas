// The owner's session for the numbers page: one password, kept only in the Vercel environment
// variable ADMIN_PASSWORD, and a signed cookie that lasts a week. Changing the password ends
// every session, because the cookie's signing key is made from it.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE = "__Host-markas_admin";
const WEEK_SECONDS = 7 * 24 * 60 * 60;
/** A short password could be guessed by trying; a missing one must never let anybody in. */
export const PASSWORD_MIN_LENGTH = 16;

/** The password from the environment, or null when it is missing or too short to be safe. */
export function configuredPassword(env = process.env) {
  const password = env.ADMIN_PASSWORD ?? "";
  return password.length >= PASSWORD_MIN_LENGTH ? password : null;
}

const digest = (text) => createHash("sha256").update(text, "utf8").digest();

/** Compares in constant time, so the answer's timing says nothing about the password. */
export function passwordMatches(given, expected) {
  if (typeof given !== "string" || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

const signingKey = (password) =>
  createHmac("sha256", password).update("markas-admin-session").digest();
const sign = (password, expires) =>
  createHmac("sha256", signingKey(password)).update(`admin|${expires}`).digest("base64url");

/** A cookie value that says "the owner, until this time". */
export function createSession(password, now = Date.now()) {
  const expires = Math.floor(now / 1000) + WEEK_SECONDS;
  return `${expires}.${sign(password, expires)}`;
}

/** True when the cookie was made with this password and has not expired. */
export function sessionIsValid(value, password, now = Date.now()) {
  if (!password || typeof value !== "string") return false;
  const [expiresText, signature] = value.split(".");
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || !signature || expires * 1000 <= now) return false;
  const expected = Buffer.from(sign(password, expires));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function readCookie(request, name = COOKIE) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function sessionCookie(value) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${WEEK_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearedCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

/** The request comes from this site's own page, not from a form on another site. */
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
