// @vitest-environment node

import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withLogbook } from "../../host/logbook-methods";
import { LogbookStore } from "./logbook-store";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-logbook-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("logbook", () => {
  it("appends lines and lists the newest first", async () => {
    const logbook = new LogbookStore(root);
    await logbook.initialize();
    await logbook.record("bot.created", "Atlas");
    await logbook.record("key.created", "metrics");
    await logbook.record("key.shown", "metrics", "failed");
    expect(logbook.list().map((entry) => [entry.action, entry.target, entry.outcome])).toEqual([
      ["key.shown", "metrics", "failed"],
      ["key.created", "metrics", "done"],
      ["bot.created", "Atlas", "done"],
    ]);
    expect(logbook.list(1)).toHaveLength(1);
  });

  it("survives a restart and skips a line cut short by a crash", async () => {
    const logbook = new LogbookStore(root);
    await logbook.initialize();
    await logbook.record("bot.created", "Atlas");
    await appendFile(join(root, "logbook.jsonl"), '{"id":"broken","time":');
    const reopened = new LogbookStore(root);
    await reopened.initialize();
    expect(reopened.list().map((entry) => entry.target)).toEqual(["Atlas"]);
  });

  it("offers no way to change or remove a line", () => {
    const methods = Object.getOwnPropertyNames(LogbookStore.prototype);
    expect(methods.sort()).toEqual(["constructor", "initialize", "list", "record", "size"]);
  });

  it("writes names only, one JSON object per line", async () => {
    const logbook = new LogbookStore(root);
    await logbook.initialize();
    await logbook.record("key.created", "metrics");
    const lines = (await readFile(join(root, "logbook.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(Object.keys(JSON.parse(lines[0] ?? "{}")).sort()).toEqual([
      "action",
      "actor",
      "id",
      "outcome",
      "target",
      "time",
    ]);
  });
});

describe("logbook recording of host methods", () => {
  const names = {
    botName: (id: string) => `bot:${id}`,
    keyName: (id: string) => `key:${id}`,
    roundName: (id: string) => `round:${id}`,
  };

  async function setup(methods: Record<string, (input: unknown) => unknown>) {
    const logbook = new LogbookStore(root);
    await logbook.initialize();
    return { logbook, wrapped: withLogbook(methods, logbook, names) };
  }

  it("records what was done, by name, and never the secret that was sent", async () => {
    const { logbook, wrapped } = await setup({
      "keyring.create": async () => ({ name: "metrics" }),
      "keyring.reveal": async () => ({ value: "s3cret" }),
      "agent.deleteBot": async () => undefined,
      "agent.listBots": async () => [],
    });
    await wrapped["keyring.create"]?.({ name: "metrics", value: "the-password" });
    await wrapped["keyring.reveal"]?.("k1");
    await wrapped["agent.deleteBot"]?.("atlas");
    await wrapped["agent.listBots"]?.(null);
    expect(logbook.list().map((entry) => `${entry.action} ${entry.target}`)).toEqual([
      "bot.deleted bot:atlas",
      "key.shown key:k1",
      "key.created metrics",
    ]);
    expect(await readFile(join(root, "logbook.jsonl"), "utf8")).not.toContain("the-password");
    expect(await readFile(join(root, "logbook.jsonl"), "utf8")).not.toContain("s3cret");
  });

  it("records a refused action as failed and still reports the error", async () => {
    const { logbook, wrapped } = await setup({
      "keyring.create": async () => {
        throw new Error('A key named "metrics" already exists.');
      },
    });
    await expect(wrapped["keyring.create"]?.({ name: "metrics", value: "x" })).rejects.toThrow(
      "already exists",
    );
    expect(logbook.list()[0]).toMatchObject({
      action: "key.created",
      target: "metrics",
      outcome: "failed",
    });
  });

  it("only logs a bot update when its name changed", async () => {
    const update = vi.fn(async () => ({ name: "Atlas" }));
    const { logbook, wrapped } = await setup({ "agent.updateBot": update });
    await wrapped["agent.updateBot"]?.({ botId: "a", model: "claude-sonnet-5" });
    expect(logbook.size).toBe(0);
    await wrapped["agent.updateBot"]?.({ botId: "a", name: "Atlas" });
    expect(logbook.list()[0]).toMatchObject({ action: "bot.renamed", target: "Atlas" });
  });

  it("serves the logbook through logbook.list", async () => {
    const { logbook, wrapped } = await setup({});
    await logbook.record("setup.saved", "claude");
    expect(wrapped["logbook.list"]?.({ limit: 5 })).toHaveLength(1);
  });
});
