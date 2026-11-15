// @vitest-environment node

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBotDraft } from "../../shared/bot-draft";
import { BOT_FILE_MAX_BYTES, parseBotFile, serializeBotFile } from "../../shared/bot-file";
import { BotLibrary, readBotFile } from "./bot-library";

const SHIPPED = fileURLToPath(new URL("../../../bots", import.meta.url));
const NAMES = ["Echo", "Herald", "Ledger", "Lens", "Quill", "Scout", "Sentry", "Sift", "Tally"];

describe("the ready-made bots that ship with Markas", () => {
  it("lists all nine, each one parsing", async () => {
    const bots = await new BotLibrary(SHIPPED).list();
    expect(bots.map((bot) => bot.name)).toEqual(NAMES);
    expect(bots.map((bot) => bot.id)).toEqual(NAMES.map((name) => name.toLowerCase()));
  });

  it("has no file that fails to parse", async () => {
    const files = (await readdir(SHIPPED)).filter((name) => name.endsWith(".bot.md"));
    expect(files).toHaveLength(NAMES.length);
    for (const file of files) {
      const parsed = parseBotFile(await readFile(join(SHIPPED, file), "utf8"));
      expect(parsed.ok ? [] : parsed.problems, file).toEqual([]);
    }
  });

  it("makes every one safe by default and distinct", async () => {
    const library = new BotLibrary(SHIPPED);
    const bots = await library.list();
    for (const bot of bots) {
      expect(bot.access, bot.name).toBe("ask");
      expect(bot.author, bot.name).toBeTruthy();
      expect(bot.category, bot.name).toBeTruthy();
      const draft = await library.read(bot.id);
      expect(draft.instructions.length, bot.name).toBeGreaterThan(800);
      // A shipped file is already in the shape the draft parser and the serializer produce.
      expect(parseBotDraft(draft)).toEqual({ ok: true, draft, adjusted: [] });
      expect(parseBotFile(serializeBotFile(draft))).toEqual({ ok: true, draft });
    }
    const sigils = bots.map((bot) => `${bot.sigil.pattern} ${bot.sigil.color}`);
    expect(new Set(sigils).size).toBe(bots.length);
  });

  it("uses a plain hyphen, never a long dash, and says bot, never agent", async () => {
    for (const file of await readdir(SHIPPED)) {
      const text = await readFile(join(SHIPPED, file), "utf8");
      expect(text.includes(String.fromCharCode(0x2014)), file).toBe(false);
      expect(text, file).not.toMatch(/\bagents?\b/i);
    }
  });

  it("shows the cards the design shows", async () => {
    const bots = await new BotLibrary(SHIPPED).list();
    const card = (name: string) => bots.find((bot) => bot.name === name);
    expect(card("Scout")).toMatchObject({
      role: "Watches public status pages and reports incidents",
      sigil: { pattern: 1, color: "coral" },
      tags: ["Browser"],
      roundCadence: "daily",
    });
    expect(card("Tally")).toMatchObject({ tags: ["Files"], roundCadence: "weekly" });
    expect(card("Sift")).toMatchObject({
      tags: ["Needs a key", "Asks before sending"],
      roundCadence: null,
    });
    expect(card("Sentry")).toMatchObject({ tags: ["Files", "Commands"], engine: null });
  });
});

describe("BotLibrary", () => {
  let root: string;
  const good = "---\nformat: 1\nname: Mine\nrole: Helps\nsigil: 2 lime\n---\nHelp.\n";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "markas-library-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("is empty when the folder is missing", async () => {
    expect(await new BotLibrary(join(root, "nowhere")).list()).toEqual([]);
  });

  it("leaves out a file that does not parse, and anything that is not a bot file", async () => {
    const complaints = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await writeFile(join(root, "mine.bot.md"), good);
    await writeFile(join(root, "broken.bot.md"), "---\nformat: 1\n---\n");
    await writeFile(join(root, "README.md"), "# Notes");
    await writeFile(join(root, "Bad Name.bot.md"), good);
    await mkdir(join(root, "folder.bot.md"));

    const bots = await new BotLibrary(root).list();

    expect(bots).toEqual([
      {
        id: "mine",
        name: "Mine",
        role: "Helps",
        sigil: { pattern: 2, color: "lime" },
        tags: [],
        category: null,
        author: null,
        engine: null,
        access: "ask",
        roundCadence: null,
      },
    ]);
    expect(complaints).toHaveBeenCalled();
  });

  it("reads one bot as a draft", async () => {
    await writeFile(join(root, "mine.bot.md"), good);
    expect(await new BotLibrary(root).read("mine")).toMatchObject({
      name: "Mine",
      instructions: "Help.",
    });
  });

  it("refuses an id that could leave the folder, and a bot that is gone", async () => {
    const library = new BotLibrary(root);
    await expect(library.read("../secret")).rejects.toThrow("That is not a ready-made bot.");
    await expect(library.read("C:\\x")).rejects.toThrow("That is not a ready-made bot.");
    await expect(library.read("gone")).rejects.toThrow("That ready-made bot is no longer there.");
  });

  it("says what is wrong with a broken ready-made bot", async () => {
    await writeFile(join(root, "broken.bot.md"), "---\nformat: 1\nname:\n---\nHi.");
    await expect(new BotLibrary(root).read("broken")).rejects.toThrow(
      "broken.bot.md cannot be used: line 3 has no name",
    );
  });

  it("reads a bot file from a path, with its name", async () => {
    const path = join(root, "mine.bot.md");
    await writeFile(path, good);
    expect(await readBotFile(path)).toMatchObject({
      ok: true,
      fileName: "mine.bot.md",
      draft: { name: "Mine" },
    });
  });

  it("only opens a regular Markdown file of a bot file's size", async () => {
    await writeFile(join(root, "secret.txt"), "token");
    await mkdir(join(root, "folder.md"));
    await writeFile(join(root, "huge.bot.md"), "x".repeat(BOT_FILE_MAX_BYTES + 1));

    await expect(readBotFile("mine.bot.md")).rejects.toThrow("Give the bot file as a full path.");
    await expect(readBotFile(join(root, "secret.txt"))).rejects.toThrow(
      "A bot file's name ends in .bot.md.",
    );
    await expect(readBotFile(join(root, "folder.md"))).rejects.toThrow("folder.md is not a file.");
    expect(await readBotFile(join(root, "huge.bot.md"))).toEqual({
      ok: false,
      fileName: "huge.bot.md",
      message: "line 1 starts a file larger than 64 KB, the most a bot file may be",
      problems: [
        { line: 1, message: "line 1 starts a file larger than 64 KB, the most a bot file may be" },
      ],
    });
  });
});
