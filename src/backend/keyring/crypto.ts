import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const FORMAT = "mk1";
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export const MASTER_KEY_BYTES = KEY_BYTES;

export class KeyringCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyringCryptoError";
  }
}

/**
 * Encrypts one keyring record's secret with AES-256-GCM.
 * Each record gets its own key, derived from the master key and a random salt, and the record
 * id is bound in as associated data, so a ciphertext moved onto another record will not open.
 */
export function encryptRecord(masterKey: Buffer, recordId: string, plaintext: string): string {
  assertMasterKey(masterKey);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", recordKey(masterKey, salt), iv);
  cipher.setAAD(Buffer.from(recordId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [FORMAT, salt, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

export function decryptRecord(masterKey: Buffer, recordId: string, sealed: string): string {
  assertMasterKey(masterKey);
  const [format, salt, iv, tag, ciphertext] = sealed.split(":");
  if (format !== FORMAT || !salt || !iv || !tag || ciphertext === undefined) {
    throw new KeyringCryptoError("The keyring record is not in a format this version can read.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      recordKey(masterKey, Buffer.from(salt, "base64")),
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from(recordId, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, wrong record or a changed byte all fail the same way, on purpose.
    throw new KeyringCryptoError("The keyring record could not be opened.");
  }
}

export function createMasterKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** The master key is already random, so a fast extract-and-expand step is the right derivation. */
function recordKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, salt, "markas-keyring-record", KEY_BYTES));
}

function assertMasterKey(masterKey: Buffer): void {
  if (masterKey.byteLength !== KEY_BYTES) {
    throw new KeyringCryptoError("The keyring master key has the wrong length.");
  }
}
