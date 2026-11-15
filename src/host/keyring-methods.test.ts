// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryKeyStore } from "../backend/keyring/key-store";
import { KeyringStore } from "../backend/keyring/keyring-store";
import { LogbookStore } from "../backend/logbook/logbook-store";
import { createKeyringMethods } from "./keyring-methods";
import { withLogbook } from "./logbook-methods";
import type { HostMethod } from "./methods";

const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const PASSWORD = "a-long-password-1";

let root: string;
let methods: Record<string, HostMethod>;
let logbook: LogbookStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-keyring-methods-test-"));
  const keyring = new KeyringStore(root, new MemoryKeyStore());
  await keyring.initialize();
  logbook = new LogbookStore(root);
  await logbook.initialize();
  methods = withLogbook(createKeyringMethods(keyring), logbook, {
    botName: (id) => id,
    keyName: (id) => keyring.list().find((key) => key.id === id)?.name ?? id,
    roundName: (id) => id,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const call = (name: string, input?: unknown) => {
  const method = methods[name];
  if (!method) throw new Error(`No host method ${name}`);
  return Promise.resolve().then(() => method(input));
};

const login = {
  name: "work-login",
  kind: "login",
  origin: "app.example.com",
  username: "juno",
  value: PASSWORD,
};

describe("keyring host methods and two-step setup keys", () => {
  it("saves a setup key with a login and answers only that there is one", async () => {
    const created = (await call("keyring.create", { ...login, twoStepSeed: SEED })) as {
      id: string;
      hasTwoStepCode: boolean;
    };
    expect(created.hasTwoStepCode).toBe(true);
    const text = JSON.stringify([created, await call("keyring.list")]);
    expect(text).not.toContain(SEED);
    expect(text).not.toContain(PASSWORD);
  });

  it("shows the setup key only through reveal, and records that it was shown", async () => {
    const created = (await call("keyring.create", { ...login, twoStepSeed: SEED })) as {
      id: string;
    };
    expect(await call("keyring.reveal", created.id)).toEqual({
      value: PASSWORD,
      twoStepSeed: SEED,
    });
    expect(logbook.list()[0]).toMatchObject({
      actor: "you",
      action: "key.shown",
      target: "work-login",
    });
    const onDisk = await readFile(join(root, "logbook.jsonl"), "utf8");
    expect(onDisk).not.toContain(SEED);
    expect(onDisk).not.toContain(PASSWORD);
  });

  it("adds, replaces and removes the setup key through update", async () => {
    const created = (await call("keyring.create", login)) as {
      id: string;
      hasTwoStepCode: boolean;
    };
    expect(created.hasTwoStepCode).toBe(false);
    const withKey = (await call("keyring.update", {
      id: created.id,
      twoStepSeed: `otpauth://totp/x?secret=${SEED}&digits=8`,
    })) as { hasTwoStepCode: boolean };
    expect(withKey.hasTwoStepCode).toBe(true);
    const removed = (await call("keyring.update", { id: created.id, twoStepSeed: "" })) as {
      hasTwoStepCode: boolean;
    };
    expect(removed.hasTwoStepCode).toBe(false);
  });

  it("refuses a bad setup key with a message that does not repeat it", async () => {
    await expect(call("keyring.create", { ...login, twoStepSeed: "GEZDGNBV" })).rejects.toThrow(
      "too short",
    );
    await expect(call("keyring.create", { ...login, twoStepSeed: 123456 })).rejects.toThrow(
      "Invalid twoStepSeed",
    );
    const error = await call("keyring.create", {
      ...login,
      twoStepSeed: `otpauth://totp/x?secret=${SEED}&digits=9`,
    }).catch((caught: Error) => caught);
    expect((error as Error).message).toContain("6 or 8 digits");
    expect((error as Error).message).not.toContain(SEED);
    expect(await call("keyring.list")).toEqual([]);
  });

  it("checks a pasted setup key for the dialog without giving back the key or a code", async () => {
    expect(await call("keyring.checkTwoStep", SEED)).toEqual({
      algorithm: "SHA1",
      digits: 6,
      periodSeconds: 30,
    });
    const checked = await call(
      "keyring.checkTwoStep",
      `otpauth://totp/x?secret=${SEED}&algorithm=SHA512&digits=8&period=60`,
    );
    expect(checked).toEqual({ algorithm: "SHA512", digits: 8, periodSeconds: 60 });
    expect(JSON.stringify(checked)).not.toContain(SEED);
    await expect(call("keyring.checkTwoStep", "nope!")).rejects.toThrow("not valid");
    await expect(call("keyring.checkTwoStep", "")).rejects.toThrow();
    // Checking is not a change, so it leaves no line.
    expect(logbook.list()).toEqual([]);
  });
});
