import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** 80 bits, the shortest setup key sites hand out. Anything shorter is a paste cut short. */
const MIN_SEED_BYTES = 10;
const MAX_PERIOD_SECONDS = 300;

export const TOTP_ALGORITHMS = ["SHA1", "SHA256", "SHA512"] as const;
export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number];
export type TotpDigits = 6 | 8;

/** Everything needed to produce a site's one-time codes. The seed is a secret. */
export interface TotpSettings {
  /** The setup key as upper-case base32 without spaces or padding. */
  seed: string;
  algorithm: TotpAlgorithm;
  digits: TotpDigits;
  periodSeconds: number;
}

export const TOTP_DEFAULTS = { algorithm: "SHA1", digits: 6, periodSeconds: 30 } as const;

export class TotpSeedError extends Error {
  constructor(message = "The two-step code key is not valid. Paste the setup key the site shows.") {
    super(message);
    this.name = "TotpSeedError";
  }
}

/** Decodes a base32 setup key as sites show it: spaces, dashes, lower case and padding allowed. */
export function decodeTotpSeed(seed: string): Buffer {
  const clean = cleanSeed(seed);
  if (!clean || [...clean].some((char) => !BASE32.includes(char))) throw new TotpSeedError();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    // Only the bits not yet written out are kept, so a long key cannot overflow.
    value = ((value << 5) | BASE32.indexOf(char)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  if (bytes.length === 0) throw new TotpSeedError();
  return Buffer.from(bytes);
}

/**
 * Reads what a person pastes into the two-step field: either the base32 setup key on its own,
 * or the `otpauth://totp/...` address behind a site's QR code.
 * Throws a TotpSeedError that says what is wrong, and never repeats the value itself.
 */
export function parseTotpInput(input: string): TotpSettings {
  const trimmed = input.trim();
  if (!trimmed) throw new TotpSeedError("The two-step code key is empty.");
  if (/^otpauth:/i.test(trimmed)) return parseOtpauth(trimmed);
  return { seed: checkedSeed(trimmed), ...TOTP_DEFAULTS };
}

/**
 * The form shown back to the person: the plain setup key when the site uses the usual settings,
 * else an otpauth address that carries the settings, so pasting it back gives the same codes.
 */
export function formatTotp(settings: TotpSettings): string {
  if (
    settings.algorithm === TOTP_DEFAULTS.algorithm &&
    settings.digits === TOTP_DEFAULTS.digits &&
    settings.periodSeconds === TOTP_DEFAULTS.periodSeconds
  ) {
    return settings.seed;
  }
  return `otpauth://totp/key?secret=${settings.seed}&algorithm=${settings.algorithm}&digits=${settings.digits}&period=${settings.periodSeconds}`;
}

/** Which code window a moment falls in. The code changes when this number changes. */
export function totpWindow(timeMs: number, periodSeconds: number = 30): number {
  return Math.floor(timeMs / 1000 / periodSeconds);
}

/** A time-based one-time code (RFC 6238), the kind authenticator apps produce. */
export function generateTotp(
  seed: string | TotpSettings,
  timeMs: number = Date.now(),
  options: { digits?: number; periodSeconds?: number; algorithm?: TotpAlgorithm } = {},
): string {
  const settings = typeof seed === "string" ? { seed, ...TOTP_DEFAULTS } : seed;
  const digits = options.digits ?? settings.digits;
  const periodSeconds = options.periodSeconds ?? settings.periodSeconds;
  const algorithm = options.algorithm ?? settings.algorithm;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(totpWindow(timeMs, periodSeconds)));
  const digest = createHmac(algorithm.toLowerCase(), decodeTotpSeed(settings.seed))
    .update(counter)
    .digest();
  // RFC 4226 dynamic truncation: the last nibble picks which four bytes become the code.
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function parseOtpauth(input: string): TotpSettings {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TotpSeedError("The two-step code address is not complete. Copy it again in full.");
  }
  const type = url.host.toLowerCase();
  if (type === "hotp") {
    throw new TotpSeedError(
      "This is a counter-based code. Markas supports time-based codes only, the kind that change every half minute.",
    );
  }
  if (type !== "totp") {
    throw new TotpSeedError("The two-step code address must start with otpauth://totp/.");
  }
  const secret = url.searchParams.get("secret");
  if (!secret) throw new TotpSeedError("The two-step code address has no secret in it.");

  const algorithm = (url.searchParams.get("algorithm") ?? TOTP_DEFAULTS.algorithm)
    .toUpperCase()
    .replace(/^(HMAC)?-?SHA-?/, "SHA");
  if (!TOTP_ALGORITHMS.includes(algorithm as TotpAlgorithm)) {
    throw new TotpSeedError("The two-step code must use SHA1, SHA256 or SHA512.");
  }
  const digits = wholeNumber(url.searchParams.get("digits"), TOTP_DEFAULTS.digits);
  if (digits !== 6 && digits !== 8) {
    throw new TotpSeedError("A two-step code must be 6 or 8 digits long.");
  }
  const periodSeconds = wholeNumber(url.searchParams.get("period"), TOTP_DEFAULTS.periodSeconds);
  if (!(periodSeconds >= 1 && periodSeconds <= MAX_PERIOD_SECONDS)) {
    throw new TotpSeedError(
      `A two-step code must change every 1 to ${MAX_PERIOD_SECONDS} seconds.`,
    );
  }
  return {
    seed: checkedSeed(secret),
    algorithm: algorithm as TotpAlgorithm,
    digits,
    periodSeconds,
  };
}

function checkedSeed(seed: string): string {
  if (decodeTotpSeed(seed).byteLength < MIN_SEED_BYTES) {
    throw new TotpSeedError(
      "The two-step code key is too short. Copy the whole setup key the site shows.",
    );
  }
  return cleanSeed(seed);
}

function cleanSeed(seed: string): string {
  return seed.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
}

function wholeNumber(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  return /^\d{1,4}$/.test(value) ? Number(value) : Number.NaN;
}
