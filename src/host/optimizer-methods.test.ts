// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentService, LEAN_INSTRUCTIONS } from "../backend/agent-service";
import { BotStore } from "../backend/bot-store";
import { UnavailableBrowserService } from "../backend/browser-host";
import { MailboxStore } from "../backend/mailbox-store";
import { findCommandFilter } from "../backend/optimizer/command-filter";
import { MAX_RECENT_SAVINGS, OptimizerStore } from "../backend/optimizer/optimizer-store";
import { FakeAgentClient, fakeClientFactory } from "../backend/testing/fake-agent-client";
import type { BotSummary } from "../shared/ipc";
import type { OptimizerReport, OptimizerSettings } from "../shared/optimizer";
import { createOptimizerMethods } from "./optimizer-methods";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-optimizer-"));
});

afterEach(async () => {
  await service?.stop();
  service = null;
  await rm(root, { recursive: true, force: true });
});

const bot = (id: string, name: string, model: string) => ({ id, name, model }) as BotSummary;

async function harness(usage: ReturnType<AgentService["contextUsage"]> = []) {
  const store = new OptimizerStore(root, new Date("2026-11-13T00:00:00.000Z"));
  await store.initialize();
  const methods = createOptimizerMethods({
    store,
    bots: () => [bot("atlas", "Atlas", "claude-fable-5"), bot("pico", "Pico", "gpt-5.6-luna")],
    contextUsage: () => usage,
    findCommandFilter: async () => ({ installed: false, version: null }),
  });
  const call = <T>(name: string, input?: unknown) =>
    Promise.resolve().then(() => methods[name]?.(input) as T);
  return { call, store };
}

describe("optimizer methods", () => {
  it("starts with nothing saved and the careful defaults", async () => {
    const { call } = await harness();
    const report = await call<OptimizerReport>("optimizer.read");
    expect(report).toMatchObject({
      settings: { autoCompact: true, compactAt: 0.8, lean: false },
      since: "2026-11-13T00:00:00.000Z",
      measuredTokens: 0,
      estimatedTokens: 0,
      perBot: [],
      recent: [],
      commandFilter: { installed: false, version: null },
    });
    expect(report.context).toEqual([
      {
        botId: "atlas",
        name: "Atlas",
        engine: "claude",
        usedTokens: null,
        contextWindow: null,
        compacting: false,
      },
      {
        botId: "pico",
        name: "Pico",
        engine: "codex",
        usedTokens: null,
        contextWindow: null,
        compacting: false,
      },
    ]);
  });

  it("keeps what an engine counted apart from what was worked out from text", async () => {
    const { call, store } = await harness([
      { botId: "atlas", usedTokens: 571_900, contextWindow: 1_000_000, compacting: false },
    ]);
    store.record("compact", "atlas", 120_000);
    store.record("trim", "pico", 2_500.4);
    store.record("trim", "gone", 1_000);
    // A saving of nothing, or of nonsense, is not a saving.
    store.record("trim", "pico", 0);
    store.record("compact", "pico", Number.NaN);

    const report = await call<OptimizerReport>("optimizer.read");
    expect(report.measuredTokens).toBe(120_000);
    expect(report.estimatedTokens).toBe(3_500);
    expect(report.totals).toEqual({
      compact: { events: 1, tokens: 120_000 },
      trim: { events: 2, tokens: 3_500 },
    });
    // A deleted bot's saving stays in the total but has no line of its own.
    expect(report.perBot).toEqual([
      { botId: "atlas", name: "Atlas", tokens: 120_000 },
      { botId: "pico", name: "Pico", tokens: 2_500 },
    ]);
    expect(report.recent.map((event) => [event.kind, event.botName])).toEqual([
      ["trim", ""],
      ["trim", "Pico"],
      ["compact", "Atlas"],
    ]);
    expect(report.context[0]).toMatchObject({ usedTokens: 571_900, contextWindow: 1_000_000 });
  });

  it("saves a setting, refuses a wrong one, and remembers both across a restart", async () => {
    const { call, store } = await harness();
    expect(await call<OptimizerSettings>("optimizer.save", { lean: true, compactAt: 0.7 })).toEqual(
      {
        autoCompact: true,
        compactAt: 0.7,
        lean: true,
      },
    );
    await expect(call("optimizer.save", { compactAt: 0.2 })).rejects.toThrow("between 50% and 95%");
    await expect(call("optimizer.save", { autoCompact: "yes" })).rejects.toThrow(
      "autoCompact must be true or false.",
    );
    await expect(call("optimizer.save", null)).rejects.toThrow("Send what to change.");
    store.record("compact", "atlas", 500);
    await store.flush();

    const again = await harness();
    const report = await again.call<OptimizerReport>("optimizer.read");
    expect(report.settings).toEqual({ autoCompact: true, compactAt: 0.7, lean: true });
    expect(report.measuredTokens).toBe(500);
    expect(JSON.parse(await readFile(join(root, "optimizer.json"), "utf8")).version).toBe(1);
  });

  it("starts the count over when its file cannot be read, and keeps only the newest savings to show", async () => {
    await writeFile(join(root, "optimizer.json"), "{not json");
    const { call, store } = await harness();
    for (let index = 0; index < MAX_RECENT_SAVINGS + 5; index += 1) store.record("trim", null, 10);
    const report = await call<OptimizerReport>("optimizer.read");
    expect(report.recent).toHaveLength(MAX_RECENT_SAVINGS);
    expect(report.totals.trim).toEqual({
      events: MAX_RECENT_SAVINGS + 5,
      tokens: (MAX_RECENT_SAVINGS + 5) * 10,
    });
  });
});

describe("the command filter check", () => {
  it("counts only the tool that answers its own report", async () => {
    const found = await findCommandFilter(async (_command, args) =>
      args[0] === "--version" ? "rtk 0.34.1" : "Total saved: 0",
    );
    expect(found).toEqual({ installed: true, version: "0.34.1" });

    // Another program of the same name has no such report.
    const other = await findCommandFilter(async (_command, args) => {
      if (args[0] === "gain") throw new Error("unknown command");
      return "rtk 1.0.0";
    });
    expect(other).toEqual({ installed: false, version: null });

    const missing = await findCommandFilter(async () => {
      throw new Error("not found");
    });
    expect(missing).toEqual({ installed: false, version: null });
  });
});

describe("what the engines tell the Optimizer", () => {
  async function running(provider: "codex" | "claude", settings: Partial<OptimizerSettings> = {}) {
    const data = join(root, "data");
    const bots = new BotStore(data, data);
    const mailbox = new MailboxStore(data, bots.sharedRoot);
    await bots.initialize();
    await mailbox.initialize();
    const client = new FakeAgentClient({ provider });
    const agents = new AgentService(
      bots,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      provider,
      fakeClientFactory({ [provider]: client }),
    );
    service = agents;
    const folds: Array<[string, number, number]> = [];
    agents.useOptimizer({
      settings: () => ({ autoCompact: true, compactAt: 0.8, lean: false, ...settings }),
      compacted: (botId, before, after) => folds.push([botId, before, after]),
    });
    await agents.initialize();
    const made = await agents.createBot();
    await agents.sendMessage({ botId: made.id, text: "Hello" });
    // The turn starts only after the bot knows its session, so news about that session lands.
    const started = () => client.requests.find((request) => request.method === "turn/start");
    for (let tries = 0; tries < 400 && !started(); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const threadId = "thread-1";
    const usage = (totalTokens: number) =>
      client.emit("notification", {
        method: "thread/tokenUsage/updated",
        params: { threadId, tokenUsage: { last: { totalTokens }, modelContextWindow: 100_000 } },
      });
    return { agents, client, made, folds, threadId, usage };
  }

  it("reports how full a conversation is, and what a fold saved", async () => {
    const { agents, client, made, folds, threadId, usage } = await running("codex");
    usage(90_000);
    expect(agents.contextUsage()).toEqual([
      { botId: made.id, usedTokens: 90_000, contextWindow: 100_000, compacting: false },
    ]);
    client.emit("notification", {
      method: "item/completed",
      params: { threadId, turnId: "fold-1", item: { id: "c1", type: "contextCompaction" } },
    });
    usage(20_000);
    expect(folds).toEqual([[made.id, 90_000, 20_000]]);
    // The saving is counted once, not again at every later reading.
    usage(21_000);
    expect(folds).toHaveLength(1);
  });

  it("counts a fold Claude Code did by itself, and never asks Claude Code to fold", async () => {
    const { client, made, folds, threadId, usage } = await running("claude");
    usage(96_000);
    client.emit("notification", {
      method: "thread/compacted",
      params: { threadId, compaction: { preTokens: 150_000 } },
    });
    usage(30_000);
    expect(folds).toEqual([[made.id, 150_000, 30_000]]);
    expect(client.requests.some((request) => request.method === "thread/compact/start")).toBe(
      false,
    );
  });

  it("gives a bot the lean rules only when they are switched on", async () => {
    /** What the bot was told when its session started. */
    const told = (client: FakeAgentClient): string => {
      const start = client.requests.find((request) => request.method === "thread/start");
      const params = (start?.params ?? {}) as { developerInstructions?: string };
      return params.developerInstructions ?? "";
    };
    const lean = await running("codex", { lean: true });
    expect(told(lean.client)).toContain(LEAN_INSTRUCTIONS);
    await lean.agents.stop();

    const first = root;
    root = await mkdtemp(join(tmpdir(), "markas-optimizer-"));
    const plain = await running("codex");
    expect(told(plain.client)).not.toBe("");
    expect(told(plain.client)).not.toContain(LEAN_INSTRUCTIONS);
    await rm(first, { recursive: true, force: true });
  });
});
