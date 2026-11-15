// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BotDraft, DraftRound } from "../shared/bot-draft";
import type { AgentEvent } from "../shared/ipc";
import { AgentService } from "./agent-service";
import { BotCreator } from "./bot-creation";
import { BotStore } from "./bot-store";
import { UnavailableBrowserService } from "./browser-host";
import { MailboxStore } from "./mailbox-store";
import { RoundsStore } from "./rounds/rounds-store";
import { fakeClientFactory } from "./testing/fake-agent-client";

let root: string;
let data: string;
let store: BotStore;
let service: AgentService;
let rounds: RoundsStore;
let creator: BotCreator;
let events: AgentEvent[];

const DRAFT: BotDraft = {
  name: "Scout",
  role: "Watches public status pages",
  instructions: "Check the pages.",
  sigil: { pattern: 1, color: "coral" },
  access: "ask",
  tags: ["Browser"],
};
const ROUND: DraftRound = {
  name: "Morning check",
  instruction: "Check and report.",
  schedule: { kind: "daily", times: ["08:30"], weekdays: [1, 2, 3, 4, 5] },
};

async function newService(preferred: "codex" | "claude" = "codex"): Promise<AgentService> {
  const mailbox = new MailboxStore(data, store.sharedRoot);
  await mailbox.initialize();
  const made = new AgentService(
    store,
    mailbox,
    new UnavailableBrowserService(),
    null,
    5_000,
    preferred,
    fakeClientFactory({}),
  );
  events = [];
  made.on("event", (event) => events.push(event));
  return made;
}

beforeEach(async () => {
  // The real path, because the creator follows links and macOS keeps its temp folder behind one.
  root = await realpath(await mkdtemp(join(tmpdir(), "markas-creation-test-")));
  data = join(root, "data");
  store = new BotStore(data, data);
  await store.initialize();
  service = await newService();
  rounds = new RoundsStore(data);
  await rounds.initialize();
  creator = new BotCreator(store, service, rounds);
});

afterEach(async () => {
  await service.stop();
  await rm(root, { recursive: true, force: true });
});

const savedBots = async () =>
  JSON.parse(await readFile(join(data, "bots.json"), "utf8")).bots as Array<{ name: string }>;

describe("creating a bot from a draft", () => {
  it("creates the bot, its folder and its round together", async () => {
    const result = await creator.create({ ...DRAFT, round: ROUND });

    if (!result.ok) throw new Error(result.message);
    expect(result.bot).toMatchObject({
      name: "Scout",
      role: "Watches public status pages",
      description: "Check the pages.",
      avatarShape: "pebble",
      avatarColor: "red",
      access: "ask",
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      workspacePath: join(data, "bots", "scout"),
      threadId: null,
    });
    expect(existsSync(join(data, "bots", "scout"))).toBe(true);
    expect(rounds.list()).toMatchObject([
      { id: result.round?.id, name: "Morning check", botId: result.bot.id, enabled: true },
    ]);
    expect(result.round?.name).toBe("Morning check");
    expect(await savedBots()).toMatchObject([{ name: "Scout" }]);
    expect(events.filter((event) => event.type === "bots-changed")).toHaveLength(1);
  });

  it("creates no round when the draft suggests none, and names an unnamed round", async () => {
    const plain = await creator.create(DRAFT);
    expect(plain).toMatchObject({ ok: true, round: null });
    expect(rounds.list()).toEqual([]);

    const named = await creator.create({
      ...DRAFT,
      name: "Herald",
      round: { instruction: "Brief me.", schedule: { kind: "interval", everyMinutes: 60 } },
    });
    expect(named).toMatchObject({ ok: true, round: { name: "Herald round" } });
  });

  it("starts the bot on the chosen engine or model, or the person's default", async () => {
    const onClaude = await creator.create({ ...DRAFT, name: "A", engine: "claude" });
    expect(onClaude).toMatchObject({ bot: { model: "claude-opus-5", reasoningEffort: "high" } });
    const onModel = await creator.create({ ...DRAFT, name: "B", model: "claude-sonnet-5" });
    expect(onModel).toMatchObject({ bot: { model: "claude-sonnet-5", reasoningEffort: "high" } });

    await service.stop();
    service = await newService("claude");
    creator = new BotCreator(store, service, rounds);
    const onDefault = await creator.create({ ...DRAFT, name: "C" });
    expect(onDefault).toMatchObject({ bot: { model: "claude-opus-5" } });
    const onCodex = await creator.create({ ...DRAFT, name: "D", engine: "codex" });
    expect(onCodex).toMatchObject({ bot: { model: "gpt-5.6-luna" } });
  });

  it("keeps full access only because the person chose it", async () => {
    const result = await creator.create({ ...DRAFT, access: "full" });
    expect(result).toMatchObject({ ok: true, bot: { access: "full" } });
  });

  it("leaves nothing behind when the round cannot be created", async () => {
    const failing = new BotCreator(store, service, {
      create: async () => {
        throw new Error("The disk is full.");
      },
    });

    await expect(failing.create({ ...DRAFT, round: ROUND })).rejects.toThrow("The disk is full.");

    expect(store.list()).toEqual([]);
    expect(service.listBots()).toEqual([]);
    expect(await savedBots()).toEqual([]);
    expect(existsSync(join(data, "bots", "scout"))).toBe(false);
    expect(rounds.list()).toEqual([]);
    expect(events).toEqual([]);
    // The name is free again, so trying once more works.
    expect(await creator.create(DRAFT)).toMatchObject({
      ok: true,
      bot: { workspacePath: join(data, "bots", "scout") },
    });
  });

  it("takes back every folder it made, and only those", async () => {
    const failing = new BotCreator(store, service, {
      create: async () => {
        throw new Error("No.");
      },
    });
    const outside = join(root, "work");
    await mkdir(outside);
    const folder = join(outside, "deep", "er", "scout");
    const round = { instruction: "Go.", schedule: { kind: "interval", everyMinutes: 30 } } as const;

    await expect(failing.create({ ...DRAFT, folder, round })).rejects.toThrow("No.");

    expect(existsSync(outside)).toBe(true);
    expect(await readdir(outside)).toEqual([]);
  });

  it("keeps an adopted folder and its files when creation fails", async () => {
    const failing = new BotCreator(store, service, {
      create: async () => {
        throw new Error("No.");
      },
    });
    const folder = join(data, "bots", "scout");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "notes.md"), "keep me");
    const round = { instruction: "Go.", schedule: { kind: "interval", everyMinutes: 30 } } as const;

    await expect(failing.create({ ...DRAFT, adoptExistingFolder: true, round })).rejects.toThrow(
      "No.",
    );

    expect(await readFile(join(folder, "notes.md"), "utf8")).toBe("keep me");
    expect(store.list()).toEqual([]);
  });

  it("takes the bot out of memory when it cannot be saved", async () => {
    // A folder where the state file should be makes the save fail.
    await rm(join(data, "bots.json"));
    await mkdir(join(data, "bots.json"));

    await expect(creator.create(DRAFT)).rejects.toThrow();

    expect(store.list()).toEqual([]);
    expect(existsSync(join(data, "bots", "scout"))).toBe(false);
  });
});

describe("a bot's folder", () => {
  it("refuses a folder that already has files, and suggests the next free name", async () => {
    const folder = join(data, "bots", "scout");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "notes.md"), "old notes");
    await mkdir(join(data, "bots", "scout-2"));
    await writeFile(join(data, "bots", "scout-2", "x"), "taken too");

    const result = await creator.create(DRAFT);

    expect(result).toEqual({
      ok: false,
      reason: "folder-in-use",
      message: `${folder} already exists and has files in it. Markas never writes over a folder: use scout-3, choose another folder, or adopt this one if it is this bot's old folder.`,
      folder,
      inUse: true,
      usedByBot: null,
      canAdopt: true,
      suggestedName: "scout-3",
      suggestedFolder: join(data, "bots", "scout-3"),
    });
    expect(store.list()).toEqual([]);
    expect(await readFile(join(folder, "notes.md"), "utf8")).toBe("old notes");
    expect(events).toEqual([]);
  });

  it("creates in the suggested folder when the person picks it", async () => {
    await mkdir(join(data, "bots", "scout"), { recursive: true });
    await writeFile(join(data, "bots", "scout", "notes.md"), "old");
    const refused = await creator.create(DRAFT);
    if (refused.ok || !refused.suggestedFolder) throw new Error("Expected a suggestion.");

    const result = await creator.create({ ...DRAFT, folder: refused.suggestedFolder });

    expect(result).toMatchObject({
      ok: true,
      bot: { name: "Scout", workspacePath: join(data, "bots", "scout-2") },
    });
  });

  it("adopts a folder with files only on an explicit yes, and changes nothing in it", async () => {
    const folder = join(data, "bots", "scout");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "notes.md"), "old notes");

    const result = await creator.create({ ...DRAFT, adoptExistingFolder: true });

    expect(result).toMatchObject({ ok: true, bot: { workspacePath: folder } });
    expect(await readdir(folder)).toEqual(["notes.md"]);
    expect(await readFile(join(folder, "notes.md"), "utf8")).toBe("old notes");
  });

  it("uses an empty folder that already exists", async () => {
    await mkdir(join(data, "bots", "scout"), { recursive: true });
    expect(await creator.create(DRAFT)).toMatchObject({
      ok: true,
      bot: { workspacePath: join(data, "bots", "scout") },
    });
  });

  it("never gives two bots the same folder, even when asked to adopt it", async () => {
    const first = await creator.create(DRAFT);
    if (!first.ok) throw new Error(first.message);

    const second = await creator.create({ ...DRAFT, adoptExistingFolder: true });

    expect(second).toMatchObject({
      ok: false,
      reason: "folder-in-use",
      usedByBot: "Scout",
      canAdopt: false,
      suggestedName: "scout-2",
    });
    expect(second.ok ? "" : second.message).toBe(
      `${join(data, "bots", "scout")} is already the folder of Scout. Every bot gets its own folder: use scout-2 or choose another one.`,
    );
    const inside = await creator.create({
      ...DRAFT,
      name: "Inner",
      folder: join(first.bot.workspacePath, "inner"),
    });
    expect(inside).toMatchObject({ ok: false, usedByBot: "Scout" });
    expect(store.list()).toHaveLength(1);
  });

  it("gives two creations at once two different folders", async () => {
    const [first, second] = await Promise.all([creator.create(DRAFT), creator.create(DRAFT)]);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, usedByBot: "Scout", suggestedName: "scout-2" });
  });

  it("accepts a folder elsewhere on the computer", async () => {
    const folder = join(root, "projects", "scout");
    const result = await creator.create({ ...DRAFT, folder });
    expect(result).toMatchObject({ ok: true, bot: { workspacePath: folder } });
    expect(existsSync(folder)).toBe(true);
  });

  it("refuses a folder that overlaps Markas's own files", async () => {
    const own =
      "Markas keeps its own files there, so a bot cannot have that folder. Choose another one.";
    for (const folder of [
      data,
      root,
      store.sharedRoot,
      join(store.sharedRoot, "x"),
      join(data, "bots"),
      join(data, "keys"),
    ]) {
      await expect(creator.create({ ...DRAFT, folder }), folder).rejects.toThrow(own);
    }
    await expect(creator.create({ ...DRAFT, folder: "scout" })).rejects.toThrow(
      "Give the bot's folder as a full path, starting from the drive or the root.",
    );
    const file = join(root, "a-file");
    await writeFile(file, "x");
    await expect(creator.create({ ...DRAFT, folder: file })).rejects.toThrow(
      `${file} is a file, not a folder. Choose a folder.`,
    );
    expect(store.list()).toEqual([]);
  });

  it("previews where a bot would go before anything is created", async () => {
    expect(await creator.previewFolder("Price Watcher")).toEqual({
      folder: join(data, "bots", "price-watcher"),
      inUse: false,
      usedByBot: null,
      canAdopt: false,
      suggestedName: null,
      suggestedFolder: null,
    });
    expect(existsSync(join(data, "bots", "price-watcher"))).toBe(false);

    await creator.create(DRAFT);
    expect(await creator.previewFolder("scout")).toMatchObject({
      inUse: true,
      usedByBot: "Scout",
      suggestedName: "scout-2",
    });
  });
});
