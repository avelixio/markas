// @vitest-environment node

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentService } from "../backend/agent-service";
import { BotCreator } from "../backend/bot-creation";
import { BotStore } from "../backend/bot-store";
import { UnavailableBrowserService } from "../backend/browser-host";
import { BotLibrary } from "../backend/library/bot-library";
import { LogbookStore } from "../backend/logbook/logbook-store";
import { MailboxStore } from "../backend/mailbox-store";
import { RoundsStore } from "../backend/rounds/rounds-store";
import { fakeClientFactory } from "../backend/testing/fake-agent-client";
import type {
  BotDraft,
  CreateBotFromDraftResult,
  ExportBotResult,
  ImportBotFileResult,
  LibraryBotSummary,
} from "../shared/bot-draft";
import { parseBotFile } from "../shared/bot-file";
import { createBotDraftMethods, createLibraryMethods } from "./library-methods";
import { withLogbook } from "./logbook-methods";
import type { HostMethod } from "./methods";

const SHIPPED = fileURLToPath(new URL("../../bots", import.meta.url));

let root: string;
let store: BotStore;
let service: AgentService;
let rounds: RoundsStore;
let logbook: LogbookStore;
let methods: Record<string, HostMethod>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "markas-library-methods-test-")));
  store = new BotStore(root, root);
  await store.initialize();
  const mailbox = new MailboxStore(root, store.sharedRoot);
  await mailbox.initialize();
  service = new AgentService(
    store,
    mailbox,
    new UnavailableBrowserService(),
    null,
    5_000,
    "codex",
    fakeClientFactory({}),
  );
  rounds = new RoundsStore(root);
  await rounds.initialize();
  logbook = new LogbookStore(root);
  await logbook.initialize();
  const name = (id: string) => id;
  methods = withLogbook(
    {
      ...createLibraryMethods({
        library: new BotLibrary(SHIPPED),
        listBots: () => service.listBots(),
        listRounds: () => rounds.list(),
      }),
      ...createBotDraftMethods(new BotCreator(store, service, rounds)),
    },
    logbook,
    { botName: name, keyName: name, roundName: name },
  );
});

afterEach(async () => {
  await service.stop();
  await rm(root, { recursive: true, force: true });
});

async function call<T>(name: string, input?: unknown): Promise<T> {
  const method = methods[name];
  if (!method) throw new Error(`No such method: ${name}`);
  return (await method(input)) as T;
}

describe("library host methods", () => {
  it("lists the ready-made bots for cards", async () => {
    const bots = await call<LibraryBotSummary[]>("library.list");
    expect(bots).toHaveLength(9);
    expect(bots.find((bot) => bot.id === "scout")).toEqual({
      id: "scout",
      name: "Scout",
      role: "Watches public status pages and reports incidents",
      sigil: { pattern: 1, color: "coral" },
      tags: ["Browser"],
      category: "Monitoring",
      author: "Markas contributors",
      engine: null,
      access: "ask",
      roundCadence: "daily",
    });
  });

  it("reads one ready-made bot as a full draft", async () => {
    const draft = await call<BotDraft>("library.read", "scout");
    expect(draft).toMatchObject({
      name: "Scout",
      access: "ask",
      round: {
        name: "Morning status check",
        schedule: { kind: "daily", times: ["08:30"], weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
    });
    expect(draft.instructions).toContain("# What you do");
    await expect(call("library.read", "../package")).rejects.toThrow(
      "That is not a ready-made bot.",
    );
    await expect(call("library.read", "")).rejects.toThrow("id is required.");
  });

  it("imports a bot file from its text", async () => {
    const text = "---\nformat: 1\nname: Mine\nrole: Helps\nsigil: 2 lime\n---\nHelp.\n";
    expect(await call("library.importFile", { text, fileName: "mine.bot.md" })).toEqual({
      ok: true,
      fileName: "mine.bot.md",
      draft: {
        name: "Mine",
        role: "Helps",
        instructions: "Help.",
        sigil: { pattern: 2, color: "lime" },
        access: "ask",
        tags: [],
      },
    });
  });

  it("returns a validation error with its line, and adds nothing", async () => {
    const text = "---\nformat: 1\nrole: Helps\nname:\nsigil: 2 lime\naccess: full\n---\nHelp.\n";
    expect(await call("library.importFile", { text, fileName: "scout.bot.md" })).toEqual({
      ok: false,
      fileName: "scout.bot.md",
      message: "line 4 has no name",
      problems: [
        { line: 4, message: "line 4 has no name" },
        {
          line: 6,
          message:
            "line 6 asks for full access, which a bot file may not do; use ask or read, and raise it yourself after adding the bot",
        },
      ],
    });
    expect(service.listBots()).toEqual([]);
  });

  it("imports a bot file from a path", async () => {
    const path = join(root, "mine.bot.md");
    await writeFile(path, "---\nformat: 1\nname: Mine\nrole: Helps\nsigil: 2 lime\n---\nHelp.\n");
    expect(await call<ImportBotFileResult>("library.importFile", { path })).toMatchObject({
      ok: true,
      fileName: "mine.bot.md",
      draft: { name: "Mine" },
    });
    await expect(call("library.importFile", { path: join(root, "token") })).rejects.toThrow(
      "A bot file's name ends in .bot.md.",
    );
  });

  it("needs exactly one of text and path", async () => {
    await expect(call("library.importFile", {})).rejects.toThrow(
      "Send a bot file's text or its path, not both.",
    );
    await expect(call("library.importFile", { text: "x", path: "/y.bot.md" })).rejects.toThrow(
      "Send a bot file's text or its path, not both.",
    );
    await expect(call("library.importFile", "x")).rejects.toThrow(
      "Send a bot file's text or its path.",
    );
  });

  it("exports a bot as a bot file that imports again", async () => {
    const created = await call<CreateBotFromDraftResult>("agent.createBotFromDraft", {
      ...(await call<BotDraft>("library.read", "scout")),
      access: "full",
      model: "claude-sonnet-5",
    });
    if (!created.ok) throw new Error(created.message);

    const exported = await call<ExportBotResult>("library.exportBot", created.bot.id);

    expect(exported.fileName).toBe("scout.bot.md");
    const parsed = parseBotFile(exported.text);
    if (!parsed.ok) throw new Error(parsed.problems[0]?.message);
    expect(parsed.draft).toMatchObject({
      name: "Scout",
      role: "Watches public status pages and reports incidents",
      sigil: { pattern: 1, color: "coral" },
      engine: "claude",
      // Full access never travels in a file.
      access: "ask",
      round: {
        name: "Morning status check",
        schedule: { kind: "daily", times: ["08:30"], weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
    });
    expect(parsed.draft.instructions).toBe(created.bot.description);
  });

  it("puts nothing in an export but the bot's profile", async () => {
    const created = await call<CreateBotFromDraftResult>("agent.createBotFromDraft", {
      name: "Sift",
      role: "Sorts an inbox",
      instructions: "Sort the inbox.",
      sigil: { pattern: 6, color: "rose" },
      access: "ask",
      tags: [],
    });
    if (!created.ok) throw new Error(created.message);
    await store.setThreadId(created.bot.id, "thread-secret-123");
    await store.updatePreview(created.bot.id, "a private reply");

    const { text } = await call<ExportBotResult>("library.exportBot", created.bot.id);

    expect(text).toBe(
      "---\nformat: 1\nname: Sift\nrole: Sorts an inbox\nsigil: 6 rose\nengine: codex\naccess: ask\n---\n\nSort the inbox.\n",
    );
    for (const secret of ["thread-secret-123", "a private reply", created.bot.id, root]) {
      expect(text).not.toContain(secret);
    }
  });

  it("will not export a bot that has no instructions, or one that is gone", async () => {
    const blank = await service.createBot();
    await expect(call("library.exportBot", blank.id)).rejects.toThrow(
      "Give New bot a role and instructions first, so the file is useful to the next person.",
    );
    await expect(call("library.exportBot", "bot-gone")).rejects.toThrow(
      "That bot no longer exists.",
    );
  });
});

describe("creating a bot from a draft over the host", () => {
  const draft = {
    name: "Scout",
    role: "Watches pages",
    instructions: "Check the pages.",
    sigil: { pattern: 1, color: "coral" },
    access: "ask",
    tags: ["Browser"],
    round: {
      instruction: "Check and report.",
      schedule: { kind: "daily", times: ["08:30"], weekdays: [1, 2, 3, 4, 5] },
    },
  };

  it("creates the bot and its round, and writes it in the logbook", async () => {
    const result = await call<CreateBotFromDraftResult>("agent.createBotFromDraft", draft);

    expect(result).toMatchObject({
      ok: true,
      bot: { name: "Scout", workspacePath: join(root, "bots", "scout") },
      round: { name: "Scout round" },
    });
    expect(rounds.list()).toHaveLength(1);
    expect(logbook.list()).toMatchObject([
      { action: "bot.created", target: "Scout", outcome: "done" },
    ]);
  });

  it("returns folder in use as an answer, not an error, and logs nothing", async () => {
    await call("agent.createBotFromDraft", draft);
    const again = await call<CreateBotFromDraftResult>("agent.createBotFromDraft", draft);

    expect(again).toMatchObject({
      ok: false,
      reason: "folder-in-use",
      usedByBot: "Scout",
      suggestedName: "scout-2",
      suggestedFolder: join(root, "bots", "scout-2"),
    });
    expect(logbook.list()).toHaveLength(1);

    const retried = await call<CreateBotFromDraftResult>("agent.createBotFromDraft", {
      ...draft,
      folder: again.ok ? "" : again.suggestedFolder,
    });
    expect(retried).toMatchObject({
      ok: true,
      bot: { workspacePath: join(root, "bots", "scout-2") },
    });
  });

  it("refuses a draft that is not right, before creating anything", async () => {
    await expect(call("agent.createBotFromDraft", { ...draft, name: "" })).rejects.toThrow(
      "The draft has no name.",
    );
    await expect(call("agent.createBotFromDraft", { ...draft, access: "root" })).rejects.toThrow(
      "The access level is not one Markas knows.",
    );
    await expect(
      call("agent.createBotFromDraft", {
        ...draft,
        round: { instruction: "Go.", schedule: { kind: "interval", everyMinutes: 1 } },
      }),
    ).rejects.toThrow("A repeating round runs at most every 5 minutes.");
    expect(service.listBots()).toEqual([]);
    expect(rounds.list()).toEqual([]);
  });

  it("previews the folder for the review screen", async () => {
    expect(await call("agent.previewBotFolder", { name: "Price Watcher" })).toMatchObject({
      folder: join(root, "bots", "price-watcher"),
      inUse: false,
    });
    await expect(call("agent.previewBotFolder", { name: " " })).rejects.toThrow(
      "The bot needs a name first.",
    );
  });
});
