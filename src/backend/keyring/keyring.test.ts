// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMasterKey, decryptRecord, encryptRecord } from "./crypto";
import { FileKeyStore, loadOrCreateMasterKey, MemoryKeyStore } from "./key-store";
import { KeyringStore } from "./keyring-store";
import { isSameOrigin, normalizeOrigin } from "./origin";
import { REDACTED, SecretRedactor } from "./redact";
import { decodeTotpSeed, generateTotp } from "./totp";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-keyring-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function openKeyring(keyStore = new MemoryKeyStore()) {
  const keyring = new KeyringStore(root, keyStore);
  await keyring.initialize();
  return { keyring, keyStore };
}

describe("keyring encryption", () => {
  it("opens what it sealed, and only with the same key and record", () => {
    const key = createMasterKey();
    const sealed = encryptRecord(key, "record-1", "s3cret value");
    expect(sealed).not.toContain("s3cret");
    expect(decryptRecord(key, "record-1", sealed)).toBe("s3cret value");
    expect(() => decryptRecord(key, "record-2", sealed)).toThrow("could not be opened");
    expect(() => decryptRecord(createMasterKey(), "record-1", sealed)).toThrow(
      "could not be opened",
    );
  });

  it("refuses a record that was changed", () => {
    const key = createMasterKey();
    const parts = encryptRecord(key, "record-1", "value").split(":");
    parts[4] = Buffer.from("tampered").toString("base64");
    expect(() => decryptRecord(key, "record-1", parts.join(":"))).toThrow("could not be opened");
    expect(() => decryptRecord(key, "record-1", "not-a-record")).toThrow("format");
  });

  it("seals the same value differently every time", () => {
    const key = createMasterKey();
    expect(encryptRecord(key, "r", "same")).not.toBe(encryptRecord(key, "r", "same"));
  });

  it("creates the master key once and reuses it", async () => {
    const store = new FileKeyStore(join(root, "nested", "keyring.key"));
    const first = await loadOrCreateMasterKey(store);
    expect(first.byteLength).toBe(32);
    expect((await loadOrCreateMasterKey(store)).equals(first)).toBe(true);
  });
});

describe("exact websites", () => {
  it("keeps the full host and never the parent domain", () => {
    expect(normalizeOrigin("metrics.example.com")).toBe("https://metrics.example.com");
    expect(normalizeOrigin("https://Admin.Example.com/login?next=1")).toBe(
      "https://admin.example.com",
    );
    expect(normalizeOrigin("https://admin.example.com:8443/")).toBe(
      "https://admin.example.com:8443",
    );
    expect(normalizeOrigin("https://admin.example.com:443")).toBe("https://admin.example.com");
    expect(normalizeOrigin("metrics.example.com")).not.toBe(normalizeOrigin("admin.example.com"));
  });

  it("refuses insecure, credentialed and malformed addresses", () => {
    expect(() => normalizeOrigin("http://metrics.example.com")).toThrow("https");
    expect(() => normalizeOrigin("https://user:pass@example.com")).toThrow("username and password");
    expect(() => normalizeOrigin("")).toThrow("required");
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("matches a page only on exactly the saved site", () => {
    expect(isSameOrigin("https://admin.example.com", "https://admin.example.com/a/b")).toBe(true);
    expect(isSameOrigin("https://admin.example.com", "https://evil.admin.example.com/")).toBe(
      false,
    );
    expect(isSameOrigin("https://admin.example.com", "https://example.com/")).toBe(false);
    expect(isSameOrigin("https://admin.example.com", "http://admin.example.com/")).toBe(false);
    expect(isSameOrigin("https://admin.example.com", "not a url")).toBe(false);
  });
});

describe("keyring", () => {
  it("keeps two logins with the same username on sibling hosts apart", async () => {
    const { keyring } = await openKeyring();
    const metrics = await keyring.create({
      name: "metrics",
      kind: "login",
      origin: "metrics.example.com",
      username: "sam@example.com",
      value: "metrics-password",
      sharedWith: ["atlas"],
    });
    const admin = await keyring.create({
      name: "admin",
      kind: "login",
      origin: "admin.example.com",
      username: "sam@example.com",
      value: "admin-password",
      sharedWith: ["juno"],
    });

    // Saving either one again leaves the other intact.
    await keyring.update({ id: metrics.id, value: "metrics-password-2" });
    await keyring.update({ id: admin.id, note: "rotated" });
    expect(keyring.list().map((key) => key.name)).toEqual(["admin", "metrics"]);
    expect(
      (await keyring.openForBot("atlas", { origin: "https://metrics.example.com" })).value,
    ).toBe("metrics-password-2");
    expect((await keyring.openForBot("juno", { origin: "admin.example.com" })).value).toBe(
      "admin-password",
    );
  });

  it("offers a key only to the bots it is shared with", async () => {
    const { keyring } = await openKeyring();
    await keyring.create({
      name: "metrics",
      kind: "login",
      origin: "metrics.example.com",
      username: "sam",
      value: "metrics-password",
      sharedWith: ["atlas"],
    });
    expect(keyring.listForBot("atlas")).toHaveLength(1);
    expect(keyring.listForBot("juno")).toEqual([]);
    await expect(keyring.openForBot("juno", { name: "metrics" })).rejects.toMatchObject({
      code: "not-shared",
    });
    await expect(
      keyring.openForBot("juno", { origin: "metrics.example.com" }),
    ).rejects.toMatchObject({
      code: "not-shared",
    });
    // A missing key reads the same as one that is not shared.
    await expect(keyring.openForBot("juno", { name: "nothing" })).rejects.toMatchObject({
      code: "not-shared",
    });
  });

  it("holds several named logins for one site and never guesses between them", async () => {
    const { keyring } = await openKeyring();
    for (const name of ["admin-read", "admin-write"]) {
      await keyring.create({
        name,
        kind: "login",
        origin: "admin.example.com",
        username: name,
        value: `${name}-password`,
        sharedWith: ["juno"],
      });
    }
    await expect(keyring.openForBot("juno", { origin: "admin.example.com" })).rejects.toThrow(
      "Name the one to use: admin-read, admin-write.",
    );
    expect((await keyring.openForBot("juno", { name: "admin-write" })).value).toBe(
      "admin-write-password",
    );
  });

  it("takes any name the person writes, as they wrote it", async () => {
    const { keyring } = await openKeyring();
    const base = { kind: "login" as const, origin: "app.example.com", username: "u", value: "p" };
    for (const [written, kept] of [
      ["app.example.com", "app.example.com"],
      ["  Web   Example ", "Web Example"],
      ["Admin.Example.com", "Admin.Example.com"],
      ["login\tfor\nwork", "login for work"],
      ["café key", "café key"],
    ]) {
      expect((await keyring.create({ ...base, name: written })).name).toBe(kept);
    }
    // Capitals and spaces do not make another name.
    await expect(keyring.create({ ...base, name: "web example" })).rejects.toMatchObject({
      code: "name-taken",
    });
    await expect(keyring.create({ ...base, name: "APP.example.com" })).rejects.toMatchObject({
      code: "name-taken",
    });
  });

  it("validates names, kinds, sites and values", async () => {
    const { keyring } = await openKeyring();
    const base = {
      kind: "login" as const,
      origin: "a.example.com",
      username: "u",
      value: "password",
    };
    await keyring.create({ ...base, name: "one" });
    await expect(keyring.create({ ...base, name: "one" })).rejects.toMatchObject({
      code: "name-taken",
    });
    for (const bad of ["   ", "x".repeat(101), "bell\u0007"]) {
      await expect(keyring.create({ ...base, name: bad })).rejects.toMatchObject({
        code: "invalid",
      });
    }
    await expect(
      keyring.create({ ...base, name: "two", origin: "http://a.example.com" }),
    ).rejects.toThrow("https");
    await expect(keyring.create({ ...base, name: "two", username: " " })).rejects.toThrow(
      "username",
    );
    await expect(keyring.create({ ...base, name: "two", value: "" })).rejects.toThrow("value");
    await expect(
      keyring.create({ ...base, name: "two", twoStepSeed: "not base32!" }),
    ).rejects.toThrow("two-step");
    await expect(
      keyring.create({ name: "three", kind: "variable", variable: "lower", value: "x1234" }),
    ).rejects.toThrow("upper-case");
  });

  it("never writes a secret to disk in the clear and survives a restart", async () => {
    const { keyring, keyStore } = await openKeyring();
    await keyring.create({
      name: "metrics",
      kind: "login",
      origin: "metrics.example.com",
      username: "sam",
      value: "correct horse battery",
      twoStepSeed: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      sharedWith: ["atlas"],
    });
    const onDisk = await readFile(join(root, "keyring.json"), "utf8");
    expect(onDisk).not.toContain("correct horse battery");
    expect(onDisk).not.toContain("GEZDGNBV");
    expect(onDisk).toContain("metrics.example.com");

    const reopened = (await openKeyring(keyStore)).keyring;
    expect(reopened.list()[0]).toMatchObject({ name: "metrics", hasTwoStepCode: true });
    expect(reopened.reveal(reopened.list()[0]?.id ?? "").value).toBe("correct horse battery");
    expect(reopened.redactor.redact("x correct horse battery y")).toBe(`x ${REDACTED} y`);
  });

  it("cannot be opened with another master key", async () => {
    const { keyring } = await openKeyring();
    await keyring.create({
      name: "k",
      kind: "token",
      origin: "api.example.com",
      value: "tok_12345",
    });
    await expect(openKeyring(new MemoryKeyStore())).rejects.toThrow("could not be opened");
  });

  it("gives the current two-step code, records use, and hands variables to the right bot", async () => {
    const { keyring } = await openKeyring();
    await keyring.create({
      name: "metrics",
      kind: "login",
      origin: "metrics.example.com",
      username: "sam",
      value: "metrics-password",
      twoStepSeed: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      sharedWith: ["atlas"],
    });
    await keyring.create({
      name: "chat-cli",
      kind: "variable",
      variable: "CHAT_TOKEN",
      value: "chat-token-value",
      sharedWith: ["pico"],
    });
    const opened = await keyring.openForBot("atlas", { name: "metrics" }, 59_000);
    expect(opened.twoStepCode).toBe("287082");
    expect(opened.summary.lastUsedAt).toBe(new Date(59_000).toISOString());
    expect(keyring.variablesForBot("pico")).toEqual({ CHAT_TOKEN: "chat-token-value" });
    expect(keyring.variablesForBot("atlas")).toEqual({});
  });

  it("changes sharing, forgets deleted bots and removes keys", async () => {
    const { keyring } = await openKeyring();
    const key = await keyring.create({
      name: "k",
      kind: "token",
      origin: "api.example.com",
      value: "tok_12345",
      sharedWith: ["atlas", "juno", "atlas"],
    });
    expect(key.sharedWith).toEqual(["atlas", "juno"]);
    expect((await keyring.share(key.id, ["juno"])).sharedWith).toEqual(["juno"]);
    await keyring.forgetBot("juno");
    expect(keyring.list()[0]?.sharedWith).toEqual([]);
    await keyring.remove(key.id);
    expect(keyring.list()).toEqual([]);
    await expect(keyring.remove(key.id)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("two-step codes", () => {
  const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890", the RFC 6238 test key

  it("matches the RFC 6238 test values", () => {
    expect(generateTotp(seed, 59_000, { digits: 8 })).toBe("94287082");
    expect(generateTotp(seed, 1_111_111_109_000, { digits: 8 })).toBe("07081804");
    expect(generateTotp(seed, 1_234_567_890_000, { digits: 8 })).toBe("89005924");
    expect(generateTotp(seed, 59_000)).toBe("287082");
  });

  it("accepts setup keys as sites show them and refuses others", () => {
    expect(decodeTotpSeed("gezd gnbv-GY3T QOJQ gezd gnbv GY3T QOJQ").toString()).toBe(
      "12345678901234567890",
    );
    expect(() => decodeTotpSeed("")).toThrow();
    expect(() => decodeTotpSeed("1890")).toThrow();
  });
});

describe("redaction", () => {
  it("hides a secret as typed and in the encodings pages echo back", () => {
    const redactor = new SecretRedactor();
    const secret = "p@ss word/1+2";
    redactor.add(secret);
    const forms = [
      secret,
      encodeURIComponent(secret),
      encodeURIComponent(secret).replaceAll("%20", "+"),
      Buffer.from(secret).toString("base64"),
      JSON.stringify(secret).slice(1, -1),
    ];
    for (const form of forms) {
      const out = redactor.redact(`before ${form} after`);
      expect(out, form).toBe(`before ${REDACTED} after`);
    }
  });

  it("leaves ordinary text and very short values alone", () => {
    const redactor = new SecretRedactor();
    redactor.add("abc");
    redactor.add("long-enough-secret");
    expect(redactor.redact("abc is fine")).toBe("abc is fine");
    expect(redactor.redact("nothing here")).toBe("nothing here");
  });

  it("catches a secret split across streamed pieces", () => {
    const redactor = new SecretRedactor();
    redactor.add("super-secret-token");
    const stream = redactor.stream();
    const out =
      stream.push("the value is super-sec") + stream.push("ret-token, keep it") + stream.flush();
    expect(out).toBe(`the value is ${REDACTED}, keep it`);
    expect(out).not.toContain("secret");
  });

  it("streams text with no secrets unchanged", () => {
    const redactor = new SecretRedactor();
    redactor.add("super-secret-token");
    const stream = redactor.stream();
    expect(stream.push("hello ") + stream.push("world") + stream.flush()).toBe("hello world");
  });
});
