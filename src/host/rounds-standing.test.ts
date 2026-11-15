// @vitest-environment node

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentService } from "../backend/agent-service";
import { BotStore } from "../backend/bot-store";
import { UnavailableBrowserService } from "../backend/browser-host";
import { LogbookStore } from "../backend/logbook/logbook-store";
import { MailboxStore } from "../backend/mailbox-store";
import { RoundsStore } from "../backend/rounds/rounds-store";
import { RoundsScheduler } from "../backend/rounds/scheduler";
import { FakeAgentClient, fakeClientFactory } from "../backend/testing/fake-agent-client";
import type { AgentEvent } from "../shared/ipc";
import { withLogbook } from "./logbook-methods";
import { createRoundsMethods, followRounds, type RoundSummary } from "./rounds-methods";

let root: string;
let reports: string;
let service: AgentService | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-round-standing-"));
  reports = join(root, "reports");
  await mkdir(reports, { recursive: true });
});

afterEach(async () => {
  await service?.stop();
  service = null;
  await rm(root, { recursive: true, force: true });
});

/** The host's rounds wiring with an in-process engine that judges tool calls like Claude does. */
async function harness() {
  const data = join(root, "data");
  const client = new FakeAgentClient({ provider: "claude" });
  const store = new BotStore(data, data);
  const mailbox = new MailboxStore(data, store.sharedRoot);
  await store.initialize();
  await mailbox.initialize();
  const agents = new AgentService(
    store,
    mailbox,
    new UnavailableBrowserService(),
    null,
    5_000,
    "claude",
    fakeClientFactory({ claude: client }),
  );
  service = agents;
  const events: AgentEvent[] = [];
  agents.on("event", (event) => events.push(event));
  await agents.initialize();

  const rounds = new RoundsStore(data);
  await rounds.initialize();
  const logbook = new LogbookStore(data);
  await logbook.initialize();
  const findBot = (botId: string) => agents.listBots().find((bot) => bot.id === botId);
  const scheduler = new RoundsScheduler(rounds, {
    deliver: async (botId, text, roundId) => {
      const receipt = await agents.sendMessage({ botId, text }, { roundId });
      return { deliveryId: receipt.deliveries[0]?.id ?? "" };
    },
    isBusy: () => false,
    botExists: (botId) => findBot(botId) !== undefined,
    deliveryStatus: (deliveryId) => mailbox.getDelivery(deliveryId)?.delivery.status ?? null,
    changed: () => undefined,
  });
  followRounds(agents, rounds, logbook);
  agents.on("event", (event) => {
    if (event.type === "queue-changed") void scheduler.reconcile();
  });
  const methods = withLogbook(
    createRoundsMethods(rounds, scheduler, (botId) => {
      const bot = findBot(botId);
      return bot ? { access: bot.access, engine: "claude" } : null;
    }),
    logbook,
    {
      botName: (id) => id,
      keyName: (id) => id,
      roundName: (id) => rounds.list().find((round) => round.id === id)?.name ?? id,
    },
  );
  const call = <T>(name: string, input?: unknown) => methods[name]?.(input) as Promise<T>;
  const turns = () =>
    events.filter(
      (event): event is Extract<AgentEvent, { type: "turn-started" }> =>
        event.type === "turn-started",
    );
  const prompts = () =>
    events.filter(
      (event): event is Extract<AgentEvent, { type: "prompt" }> => event.type === "prompt",
    );
  const logged = (action: string) => logbook.list().filter((entry) => entry.action === action);
  return { agents, client, rounds, logbook, call, turns, prompts, logged, events };
}

const schedule = { kind: "daily", times: ["09:00"], weekdays: [1, 2, 3, 4, 5] };

describe("a round with standing permissions", () => {
  it("uses them without a card, logs each use, and still stops for anything else", async () => {
    const { agents, client, rounds, call, turns, prompts, logged } = await harness();
    const bot = await agents.createBot();
    const round = await call<RoundSummary>("rounds.create", {
      name: "Morning check",
      botId: bot.id,
      instruction: "Read the reports and say what changed.",
      schedule,
      standing: [
        { type: "read-folder", path: reports },
        { type: "site", origin: "reports.example.com" },
      ],
    });
    expect(round.standing).toMatchObject([
      { type: "read-folder", path: reports, level: "ask" },
      { type: "site", origin: "https://reports.example.com", level: "ask" },
    ]);
    expect(round.standingApplies).toBe(true);
    expect(round.waitingOn).toBeNull();
    // Giving a round permission in advance is itself on the record.
    expect(logged("round.standing-set")[0]?.target).toBe(
      `Morning check: read folder ${reports}; open site https://reports.example.com`,
    );

    await call("rounds.runNow", round.id);
    await waitFor(() => turns().length === 1);
    const { threadId, turnId } = turns()[0] ?? { threadId: "", turnId: "" };

    // Covered by the round: no card, one Logbook line per use, written by the round.
    expect(await client.useTool(threadId, "Read", { file_path: join(reports, "q3.csv") })).toBe(
      true,
    );
    expect(
      await client.useTool(threadId, "WebFetch", { url: "https://reports.example.com/today" }),
    ).toBe(true);
    expect(prompts()).toEqual([]);
    await waitFor(() => logged("round.standing-used").length === 2);
    expect(logged("round.standing-used").map((entry) => [entry.actor, entry.target])).toEqual([
      ["round", "Morning check: open site https://reports.example.com"],
      ["round", `Morning check: read folder ${reports}`],
    ]);

    // Not covered: the run stops at a card, and its history says it is waiting and for what.
    const command = client.useTool(threadId, "Bash", { command: "git pull" });
    await waitFor(() => prompts().length === 1);
    await waitFor(() => rounds.lastRun(round.id)?.waits.length === 1);
    const [listed] = await call<RoundSummary[]>("rounds.list");
    expect(listed?.lastRun?.status).toBe("running");
    expect(listed?.waitingOn).toMatchObject({ kind: "command", detail: "git pull", answer: null });

    await agents.respondToPrompt({
      requestId: prompts()[0]?.requestId ?? "",
      answers: { permission: ["Don't allow"] },
    });
    expect(await command).toBe(false);
    await waitFor(() => rounds.lastRun(round.id)?.waits[0]?.answer === "denied");
    expect((await call<RoundSummary[]>("rounds.list"))[0]?.waitingOn).toBeNull();
    // A sibling site and a change to the read-only folder ask too.
    void client.useTool(threadId, "WebFetch", { url: "https://admin.example.com/" });
    await waitFor(() => prompts().length === 2);
    void client.useTool(threadId, "Write", { file_path: join(reports, "q3.csv") });
    await waitFor(() => prompts().length === 3);

    client.completeTurn(threadId, turnId, "Nothing changed.");
    await waitFor(() => rounds.lastRun(round.id)?.status === "completed");
    expect(logged("round.standing-used")).toHaveLength(2);
  });

  it("gives nothing to a message the person types, even right after the round ran", async () => {
    const { agents, client, rounds, call, turns, prompts, logged } = await harness();
    const bot = await agents.createBot();
    const round = await call<RoundSummary>("rounds.create", {
      name: "Morning check",
      botId: bot.id,
      instruction: "Read the reports.",
      schedule,
      standing: [{ type: "read-folder", path: reports }],
    });
    await call("rounds.runNow", round.id);
    await waitFor(() => turns().length === 1);
    const first = turns()[0] ?? { threadId: "", turnId: "" };
    expect(await client.useTool(first.threadId, "Read", { file_path: join(reports, "a") })).toBe(
      true,
    );
    client.completeTurn(first.threadId, first.turnId, "Done.");
    await waitFor(() => rounds.lastRun(round.id)?.status === "completed");

    await agents.sendMessage({ botId: bot.id, text: "And now read it again for me." });
    await waitFor(() => turns().length === 2);
    void client.useTool(first.threadId, "Read", { file_path: join(reports, "a") });
    await waitFor(() => prompts().length === 1);
    expect(prompts()[0]?.questions[0]?.permission).toMatchObject({ kind: "read" });
    // The card of a typed message is not a round waiting.
    expect(rounds.lastRun(round.id)?.waits).toEqual([]);
    expect(logged("round.standing-used")).toHaveLength(1);
  });

  it("reads the round's permissions when the turn starts, so removing one counts at once", async () => {
    const { agents, client, call, turns, prompts } = await harness();
    const bot = await agents.createBot();
    const round = await call<RoundSummary>("rounds.create", {
      name: "Morning check",
      botId: bot.id,
      instruction: "Read the reports.",
      schedule,
      standing: [{ type: "read-folder", path: reports }],
    });
    await call("rounds.update", { id: round.id, standing: [] });
    await call("rounds.runNow", round.id);
    await waitFor(() => turns().length === 1);
    void client.useTool(turns()[0]?.threadId ?? "", "Read", { file_path: join(reports, "a") });
    await waitFor(() => prompts().length === 1);
  });

  it("drops what was given at a higher level when the bot is set lower, and logs it", async () => {
    const { agents, rounds, call, logged } = await harness();
    const bot = await agents.createBot();
    await agents.updateBot({ botId: bot.id, access: "read" });
    const round = await call<RoundSummary>("rounds.create", {
      name: "Evening tidy",
      botId: bot.id,
      instruction: "Tidy the reports folder.",
      schedule,
      standing: [{ type: "change-folder", path: reports }],
    });
    expect(round.standing[0]?.level).toBe("read");

    await agents.updateBot({ botId: bot.id, access: "ask" });
    await waitFor(() => rounds.get(round.id).standing.length === 0);
    await waitFor(() => logged("round.standing-dropped").length === 1);
    expect(logged("round.standing-dropped")[0]?.target).toBe(
      `Evening tidy: change folder ${reports}`,
    );
  });

  it("refuses a round that asks for any command or for Markas's own data folder", async () => {
    const { agents, call, rounds } = await harness();
    const bot = await agents.createBot();
    const base = { name: "Too much", botId: bot.id, instruction: "Do it.", schedule };
    await expect(
      call("rounds.create", { ...base, standing: [{ type: "tool", name: "Bash" }] }),
    ).rejects.toThrow(/one at a time/);
    await expect(
      call("rounds.create", {
        ...base,
        standing: [{ type: "read-folder", path: join(root, "data") }],
      }),
    ).rejects.toThrow(/own data folder/);
    expect(rounds.list()).toEqual([]);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
