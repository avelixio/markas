// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentService } from "../backend/agent-service";
import { BotStore } from "../backend/bot-store";
import { UnavailableBrowserService } from "../backend/browser-host";
import { MailboxStore } from "../backend/mailbox-store";
import { RoundsStore } from "../backend/rounds/rounds-store";
import { RoundsScheduler } from "../backend/rounds/scheduler";
import { FakeAgentClient, fakeClientFactory } from "../backend/testing/fake-agent-client";
import { BOT_TRASH_DAYS } from "../shared/ipc";
import { createRoundsMethods, type RoundSummary } from "./rounds-methods";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-bot-trash-"));
});

afterEach(async () => {
  await service?.stop();
  service = null;
  await rm(root, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;

async function waitFor(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 400 && !check(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!check()) throw new Error("The wait ran out.");
}

/** A running service with one bot, Atlas, that has answered one message. */
async function harness() {
  const data = join(root, "data");
  const store = new BotStore(data, data);
  const mailbox = new MailboxStore(data, store.sharedRoot);
  const agents = new AgentService(
    store,
    mailbox,
    new UnavailableBrowserService(),
    null,
    5_000,
    "claude",
    fakeClientFactory({ claude: new FakeAgentClient({ provider: "claude", autoReply: "Done." }) }),
  );
  service = agents;
  let turnsEnded = 0;
  agents.on("event", (event: { type?: string }) => {
    if (event.type === "turn-completed") turnsEnded += 1;
  });
  await agents.initialize();
  const atlas = await agents.createBot();
  await agents.sendMessage({ botId: atlas.id, text: "Count the stock." });
  // A turn is over only once its last write is done, which is when the service says so.
  await waitFor(() => turnsEnded === 1);
  return { agents, store, mailbox, atlas, data, turnsEnded: () => turnsEnded };
}

describe("the trash for deleted bots", () => {
  it("takes a deleted bot off the list and says until when it can come back", async () => {
    const { agents, atlas } = await harness();
    await agents.deleteBot(atlas.id);

    expect(agents.listBots()).toEqual([]);
    const [entry] = agents.listDeletedBots();
    expect(entry?.bot.id).toBe(atlas.id);
    expect(
      new Date(entry?.purgeAt ?? "").getTime() - new Date(entry?.deletedAt ?? "").getTime(),
    ).toBe(BOT_TRASH_DAYS * DAY);
  });

  it("puts a bot back with its messages, and announces it", async () => {
    const { agents, atlas, turnsEnded } = await harness();
    await agents.deleteBot(atlas.id);
    const seen: string[][] = [];
    agents.on("event", (event) => {
      if (event.type === "bots-changed") seen.push(event.bots.map((bot) => bot.id));
    });

    const back = await agents.restoreBot(atlas.id);

    expect(back.id).toBe(atlas.id);
    expect(agents.listBots().map((bot) => bot.id)).toEqual([atlas.id]);
    expect(agents.listDeletedBots()).toEqual([]);
    expect(seen.at(-1)).toEqual([atlas.id]);
    expect(agents.listQueue(atlas.id).deliveries.map((delivery) => delivery.status)).toEqual([
      "completed",
    ]);
    // It works again after coming back.
    await agents.sendMessage({ botId: atlas.id, text: "Count it once more." });
    await waitFor(() => turnsEnded() === 2);
    expect(agents.listQueue(atlas.id).deliveries.map((delivery) => delivery.status)).toEqual([
      "completed",
      "completed",
    ]);
  });

  it("refuses a message for a deleted bot instead of making a second bot", async () => {
    const { agents, atlas } = await harness();
    await agents.deleteBot(atlas.id);

    await expect(agents.sendMessage({ botId: atlas.id, text: "Hello?" })).rejects.toThrow(
      "That bot was deleted.",
    );
    expect(agents.listBots()).toEqual([]);
  });

  it("removes the messages only when the bot is removed for good", async () => {
    const { agents, mailbox, atlas } = await harness();
    await agents.deleteBot(atlas.id);
    expect(mailbox.listQueue(atlas.id).deliveries).toHaveLength(1);

    await agents.purgeBot(atlas.id);

    expect(agents.listDeletedBots()).toEqual([]);
    expect(mailbox.listQueue(atlas.id).deliveries).toEqual([]);
    await expect(agents.restoreBot(atlas.id)).rejects.toThrow("not among the deleted bots");
  });

  it("takes away the bot's empty folder when the bot is removed for good", async () => {
    const { agents, atlas } = await harness();
    await agents.deleteBot(atlas.id);
    expect((await stat(atlas.workspacePath)).isDirectory()).toBe(true);

    await agents.purgeBot(atlas.id);

    await expect(stat(atlas.workspacePath)).rejects.toThrow();
  });

  it("keeps the bot's folder when it still holds files", async () => {
    const { agents, atlas } = await harness();
    await writeFile(join(atlas.workspacePath, "notes.md"), "Keep me.");
    await agents.deleteBot(atlas.id);

    await agents.purgeBot(atlas.id);

    expect(await readFile(join(atlas.workspacePath, "notes.md"), "utf8")).toBe("Keep me.");
  });

  it("keeps a folder the person chose, even an empty one", async () => {
    const data = join(root, "data");
    const store = new BotStore(data, data);
    await store.initialize();
    const chosen = join(root, "chosen");
    await mkdir(chosen);
    const bot = await store.createBot({
      name: "Pico",
      role: "",
      description: "",
      model: "claude-opus-5",
      reasoningEffort: "high",
      access: "ask",
      workspacePath: chosen,
    });
    await store.trashBot(bot.id);

    await store.purgeTrashed(bot.id);

    expect((await stat(chosen)).isDirectory()).toBe(true);
  });

  it("removes for good only a bot that was deleted first", async () => {
    const { agents, atlas } = await harness();
    await expect(agents.purgeBot(atlas.id)).rejects.toThrow("not among the deleted bots");
    expect(agents.listBots().map((bot) => bot.id)).toEqual([atlas.id]);
  });

  it("keeps the trash across a restart, and reads a file saved before the trash existed", async () => {
    const { agents, atlas, data } = await harness();
    await agents.deleteBot(atlas.id);
    await agents.stop();
    service = null;

    const reopened = new BotStore(data, data);
    await reopened.initialize();
    expect(reopened.listTrash().map((entry) => entry.bot.id)).toEqual([atlas.id]);

    const path = join(data, "bots.json");
    const saved = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete saved.trash;
    await writeFile(path, JSON.stringify(saved));
    const older = new BotStore(data, data);
    await older.initialize();
    expect(older.listTrash()).toEqual([]);
  });

  it("refuses a state file whose trash repeats a bot on the list", async () => {
    const { agents, atlas, data } = await harness();
    await agents.stop();
    service = null;
    const path = join(data, "bots.json");
    const saved = JSON.parse(await readFile(path, "utf8")) as { bots: unknown[]; trash: unknown[] };
    saved.trash = [{ bot: saved.bots[0], deletedAt: new Date().toISOString() }];
    await writeFile(path, JSON.stringify(saved));

    await expect(new BotStore(data, data).initialize()).rejects.toThrow("duplicate bot ids");
    expect(atlas.id).toBeTruthy();
  });
});

describe("rounds of a deleted bot", () => {
  it("rest while the bot is deleted, are not listed, and do not run late when it returns", async () => {
    const { agents, atlas, data } = await harness();
    const rounds = new RoundsStore(data);
    await rounds.initialize();
    let now = new Date("2026-11-11T08:00:00");
    const delivered: string[] = [];
    const away = (botId: string) =>
      agents.listDeletedBots().some((entry) => entry.bot.id === botId);
    const scheduler = new RoundsScheduler(
      rounds,
      {
        deliver: async (botId) => {
          delivered.push(botId);
          return { deliveryId: `delivery-${delivered.length}` };
        },
        isBusy: () => false,
        botExists: (botId) => agents.listBots().some((bot) => bot.id === botId),
        botAway: away,
        deliveryStatus: () => "completed",
        changed: () => undefined,
      },
      () => now,
    );
    const methods = createRoundsMethods(rounds, scheduler, () => null, away);
    const listed = () => methods["rounds.list"]?.(undefined) as RoundSummary[];
    const round = await rounds.create(
      {
        name: "Morning stock check",
        botId: atlas.id,
        instruction: "Check stock levels.",
        schedule: { kind: "daily", times: ["09:00"], weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
      now,
    );
    expect(listed().map((item) => item.id)).toEqual([round.id]);

    await agents.deleteBot(atlas.id);
    expect(listed()).toEqual([]);
    now = new Date("2026-11-11T09:00:30");
    await scheduler.tick();
    expect(delivered).toEqual([]);
    expect(rounds.runs(round.id)).toEqual([]);

    await agents.restoreBot(atlas.id);
    expect(listed().map((item) => item.id)).toEqual([round.id]);
    now = new Date("2026-11-11T09:05:00");
    await scheduler.tick();
    expect(delivered).toEqual([]);

    now = new Date("2026-11-12T09:00:30");
    await scheduler.tick();
    expect(delivered).toEqual([atlas.id]);
  });
});
