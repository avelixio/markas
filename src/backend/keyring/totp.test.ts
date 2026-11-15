// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryKeyStore } from "./key-store";
import { KeyringStore } from "./keyring-store";
import {
  decodeTotpSeed,
  formatTotp,
  generateTotp,
  parseTotpInput,
  type TotpAlgorithm,
  TotpSeedError,
} from "./totp";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(text: string): string {
  let bits = "";
  for (const byte of Buffer.from(text, "ascii")) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let index = 0; index < bits.length; index += 5) {
    out += BASE32[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return out;
}

// The test keys of RFC 6238, appendix B: the same digits repeated to each hash's length.
const RFC_SEEDS: Record<TotpAlgorithm, string> = {
  SHA1: base32("12345678901234567890"),
  SHA256: base32("12345678901234567890123456789012"),
  SHA512: base32("1234567890123456789012345678901234567890123456789012345678901234"),
};

// RFC 6238, appendix B: time in seconds, then the 8-digit code for each hash.
const RFC_VECTORS: Array<[number, string, string, string]> = [
  [59, "94287082", "46119246", "90693936"],
  [1_111_111_109, "07081804", "68084774", "25091201"],
  [1_111_111_111, "14050471", "67062674", "99943326"],
  [1_234_567_890, "89005924", "91819424", "93441116"],
  [2_000_000_000, "69279037", "90698825", "38618901"],
  [20_000_000_000, "65353130", "77737706", "47863826"],
];

describe("one-time codes (RFC 6238)", () => {
  it("matches every test vector of the RFC, for SHA-1, SHA-256 and SHA-512", () => {
    for (const [seconds, sha1, sha256, sha512] of RFC_VECTORS) {
      const expected: Record<TotpAlgorithm, string> = {
        SHA1: sha1,
        SHA256: sha256,
        SHA512: sha512,
      };
      for (const algorithm of ["SHA1", "SHA256", "SHA512"] as const) {
        const settings = {
          seed: RFC_SEEDS[algorithm],
          algorithm,
          digits: 8 as const,
          periodSeconds: 30,
        };
        expect(generateTotp(settings, seconds * 1000), `${algorithm} at ${seconds}`).toBe(
          expected[algorithm],
        );
      }
    }
  });

  it("gives 6 digits by default, the last six of the 8-digit code", () => {
    expect(generateTotp(RFC_SEEDS.SHA1, 59_000)).toBe("287082");
    expect(generateTotp(RFC_SEEDS.SHA1, 1_111_111_109_000)).toBe("081804");
  });

  it("follows the period: the code holds within a window and changes at its edge", () => {
    const settings = {
      seed: RFC_SEEDS.SHA1,
      algorithm: "SHA1" as const,
      digits: 6 as const,
      periodSeconds: 60,
    };
    expect(generateTotp(settings, 60_000)).toBe(generateTotp(settings, 119_999));
    expect(generateTotp(settings, 60_000)).not.toBe(generateTotp(settings, 120_000));
    // A 60-second window at second 60 is counter 1, the same as a 30-second window at second 30.
    expect(generateTotp(settings, 60_000)).toBe(generateTotp(RFC_SEEDS.SHA1, 30_000));
  });

  it("decodes a long setup key without losing bits", () => {
    expect(decodeTotpSeed(RFC_SEEDS.SHA512).toString("ascii")).toBe(
      "1234567890123456789012345678901234567890123456789012345678901234",
    );
  });
});

describe("reading a pasted two-step setup key", () => {
  it("accepts a base32 key as sites show it", () => {
    expect(parseTotpInput(" gezd gnbv-gy3t qojq gezd gnbv gy3t qojq== ")).toEqual({
      seed: RFC_SEEDS.SHA1,
      algorithm: "SHA1",
      digits: 6,
      periodSeconds: 30,
    });
  });

  it("accepts the otpauth address behind a QR code, with its settings", () => {
    const settings = parseTotpInput(
      `otpauth://totp/Example:juno%40example.com?secret=${RFC_SEEDS.SHA256}&issuer=Example&algorithm=sha256&digits=8&period=60`,
    );
    expect(settings).toEqual({
      seed: RFC_SEEDS.SHA256,
      algorithm: "SHA256",
      digits: 8,
      periodSeconds: 60,
    });
    expect(parseTotpInput(`otpauth://totp/x?secret=${RFC_SEEDS.SHA1.toLowerCase()}`)).toEqual({
      seed: RFC_SEEDS.SHA1,
      algorithm: "SHA1",
      digits: 6,
      periodSeconds: 30,
    });
  });

  it("round-trips through the form shown back to the person", () => {
    const usual = parseTotpInput(RFC_SEEDS.SHA1);
    expect(formatTotp(usual)).toBe(RFC_SEEDS.SHA1);
    const unusual = parseTotpInput(
      `otpauth://totp/x?secret=${RFC_SEEDS.SHA512}&algorithm=SHA512&digits=8&period=45`,
    );
    expect(parseTotpInput(formatTotp(unusual))).toEqual(unusual);
  });

  it("says plainly what is wrong, and never repeats the key", () => {
    const secret = RFC_SEEDS.SHA1;
    const cases: Array<[string, string]> = [
      ["   ", "empty"],
      ["not base32!", "not valid"],
      ["GEZDGNBV", "too short"],
      [`otpauth://hotp/x?secret=${secret}&counter=1`, "counter-based"],
      [`otpauth://push/x?secret=${secret}`, "otpauth://totp/"],
      ["otpauth://totp/x?issuer=Example", "no secret"],
      [`otpauth://totp/x?secret=${secret}&algorithm=MD5`, "SHA1, SHA256 or SHA512"],
      [`otpauth://totp/x?secret=${secret}&digits=7`, "6 or 8 digits"],
      [`otpauth://totp/x?secret=${secret}&digits=six`, "6 or 8 digits"],
      [`otpauth://totp/x?secret=${secret}&period=0`, "1 to 300 seconds"],
      [`otpauth://totp/x?secret=${secret}&period=3600`, "1 to 300 seconds"],
      ["otpauth://totp/x?secret=GEZDGNBV1890GEZDGNBV", "not valid"],
    ];
    for (const [input, expected] of cases) {
      let thrown: unknown;
      try {
        parseTotpInput(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, input).toBeInstanceOf(TotpSeedError);
      const message = (thrown as Error).message;
      expect(message).toContain(expected);
      expect(message).not.toContain(secret);
      expect(message).not.toContain("GEZDGNBV");
    }
  });
});

describe("a two-step setup key in the keyring", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "markas-totp-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const login = {
    name: "work-login",
    kind: "login" as const,
    origin: "app.example.com",
    username: "juno",
    value: "a-long-password-1",
    sharedWith: ["atlas"],
  };

  async function open(keyStore = new MemoryKeyStore()) {
    const keyring = new KeyringStore(root, keyStore);
    await keyring.initialize();
    return { keyring, keyStore };
  }

  it("is sealed with the password, shown only as a yes or no, and revealed on request", async () => {
    const { keyring, keyStore } = await open();
    const uri = `otpauth://totp/Example:juno?secret=${RFC_SEEDS.SHA256}&algorithm=SHA256&digits=8`;
    const created = await keyring.create({ ...login, twoStepSeed: uri });
    expect(created.hasTwoStepCode).toBe(true);
    expect(JSON.stringify(keyring.list())).not.toContain(RFC_SEEDS.SHA256);
    expect(JSON.stringify(keyring.listForBot("atlas"))).not.toContain(RFC_SEEDS.SHA256);

    const onDisk = await readFile(join(root, "keyring.json"), "utf8");
    expect(onDisk).not.toContain(RFC_SEEDS.SHA256);
    expect(onDisk).not.toContain("otpauth");
    expect(onDisk).not.toContain("SHA256");

    const reopened = (await open(keyStore)).keyring;
    const shown = reopened.reveal(created.id);
    expect(shown.value).toBe("a-long-password-1");
    expect(parseTotpInput(shown.twoStepSeed ?? "")).toEqual({
      seed: RFC_SEEDS.SHA256,
      algorithm: "SHA256",
      digits: 8,
      periodSeconds: 30,
    });
    // The setup key is scrubbed from anything passed through the keyring's redactor.
    expect(reopened.redactor.redact(`key ${RFC_SEEDS.SHA256}`)).not.toContain(RFC_SEEDS.SHA256);

    const opened = await reopened.openForBot("atlas", { id: created.id }, 59_000);
    expect(opened.twoStepCode).toBe("46119246");
    expect(opened.twoStepCodeAt?.(1_111_111_109_000)).toBe("68084774");
    expect(opened.twoStepPeriodSeconds).toBe(30);
  });

  it("keeps the setup key and its settings through an unrelated change, and can drop it", async () => {
    const { keyring } = await open();
    const created = await keyring.create({
      ...login,
      twoStepSeed: `otpauth://totp/x?secret=${RFC_SEEDS.SHA512}&algorithm=SHA512&digits=8`,
    });
    await keyring.update({ id: created.id, note: "rotated in spring" });
    expect((await keyring.openForBot("atlas", { name: "work-login" }, 59_000)).twoStepCode).toBe(
      "90693936",
    );

    const without = await keyring.update({ id: created.id, twoStepSeed: "" });
    expect(without.hasTwoStepCode).toBe(false);
    expect(keyring.reveal(created.id).twoStepSeed).toBeNull();
    expect((await keyring.openForBot("atlas", { name: "work-login" })).twoStepCodeAt).toBeNull();
  });

  it("refuses a bad setup key on save with a clear message and saves nothing", async () => {
    const { keyring } = await open();
    await expect(keyring.create({ ...login, twoStepSeed: "GEZDGNBV" })).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("too short"),
    });
    await expect(
      keyring.create({ ...login, twoStepSeed: "otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQ" }),
    ).rejects.toThrow("counter-based");
    expect(keyring.list()).toEqual([]);

    const created = await keyring.create(login);
    await expect(keyring.update({ id: created.id, twoStepSeed: "nope!" })).rejects.toThrow(
      "not valid",
    );
    expect(keyring.list()[0]?.hasTwoStepCode).toBe(false);
  });

  it("opens a key by id only for a bot it is shared with", async () => {
    const { keyring } = await open();
    const created = await keyring.create(login);
    expect(keyring.summaryForBot("atlas", { id: created.id }).name).toBe("work-login");
    expect(() => keyring.summaryForBot("juno", { id: created.id })).toThrow("shared with this bot");
    await expect(keyring.openForBot("juno", { id: created.id })).rejects.toMatchObject({
      code: "not-shared",
    });
  });
});
