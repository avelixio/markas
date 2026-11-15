// @vitest-environment node

import { describe, expect, it } from "vitest";
import { type BotDraft, parseBotDraft } from "./bot-draft";
import {
  BOT_FILE_MAX_BYTES,
  botFileName,
  parseBotFile,
  serializeBotFile,
  slugify,
} from "./bot-file";

const GOOD = [
  "---",
  "format: 1",
  "name: Scout",
  "role: Watches public status pages and reports incidents",
  "sigil: 1 coral",
  "engine: claude",
  "access: ask",
  "tags: Browser, Files",
  "category: Monitoring",
  "author: Someone",
  "round: daily at 08:30",
  "round-name: Morning check",
  "round-instruction: Check the pages and report.",
  "---",
  "",
  "# What you do",
  "",
  "Check the pages.",
  "",
].join("\n");

/** The good file with one line replaced, or removed when the replacement is null. */
function withLine(prefix: string, replacement: string | null): string {
  return GOOD.split("\n")
    .flatMap((line) =>
      line.startsWith(prefix) ? (replacement === null ? [] : [replacement]) : [line],
    )
    .join("\n");
}

function problemsOf(text: string): string[] {
  const parsed = parseBotFile(text);
  if (parsed.ok) throw new Error("Expected the file to be refused.");
  return parsed.problems.map((problem) => problem.message);
}

describe("parseBotFile", () => {
  it("reads every field of a good file", () => {
    expect(parseBotFile(GOOD)).toEqual({
      ok: true,
      draft: {
        name: "Scout",
        role: "Watches public status pages and reports incidents",
        instructions: "# What you do\n\nCheck the pages.",
        sigil: { pattern: 1, color: "coral" },
        engine: "claude",
        access: "ask",
        tags: ["Browser", "Files"],
        category: "Monitoring",
        author: "Someone",
        round: {
          name: "Morning check",
          instruction: "Check the pages and report.",
          schedule: { kind: "daily", times: ["08:30"], weekdays: [0, 1, 2, 3, 4, 5, 6] },
        },
      },
    });
  });

  it("needs only the format, name, role, sigil and instructions", () => {
    const parsed = parseBotFile(
      "---\nformat: 1\nname: Quill\nrole: Writes\nsigil: 0 sky\n---\nWrite.",
    );
    expect(parsed).toEqual({
      ok: true,
      draft: {
        name: "Quill",
        role: "Writes",
        instructions: "Write.",
        sigil: { pattern: 0, color: "sky" },
        access: "ask",
        tags: [],
      },
    });
  });

  it("accepts Windows line endings, a byte order mark, comments and blank lines", () => {
    const text = `﻿${GOOD.replace("format: 1", "# a note\n\nformat: 1").replaceAll("\n", "\r\n")}`;
    const parsed = parseBotFile(text);
    expect(parsed.ok && parsed.draft.name).toBe("Scout");
    expect(parsed.ok && parsed.draft.instructions).toBe("# What you do\n\nCheck the pages.");
  });

  it("keeps a --- line inside the instructions", () => {
    const parsed = parseBotFile(`${GOOD}\n---\n\nMore.\n`);
    expect(parsed.ok && parsed.draft.instructions).toBe(
      "# What you do\n\nCheck the pages.\n\n---\n\nMore.",
    );
  });

  it("reads each way of writing a round time", () => {
    const schedule = (time: string) => {
      const parsed = parseBotFile(withLine("round:", `round: ${time}`));
      return parsed.ok ? parsed.draft.round?.schedule : parsed.problems;
    };
    expect(schedule("weekdays at 08:30")).toEqual({
      kind: "daily",
      times: ["08:30"],
      weekdays: [1, 2, 3, 4, 5],
    });
    expect(schedule("Mon, thu at 16:00, 09:00")).toEqual({
      kind: "daily",
      times: ["09:00", "16:00"],
      weekdays: [1, 4],
    });
    expect(schedule("every 60 minutes")).toEqual({ kind: "interval", everyMinutes: 60 });
    expect(schedule("every 2 hours")).toEqual({ kind: "interval", everyMinutes: 120 });
  });

  it("says a line has no name, as the import screen shows it", () => {
    const text = "---\nformat: 1\nrole: Watches\nname:\nsigil: 1 coral\n---\nDo it.";
    expect(parseBotFile(text)).toEqual({
      ok: false,
      problems: [{ line: 4, message: "line 4 has no name" }],
    });
  });

  it.each([
    ["no opening line", `name: Scout\n${GOOD}`, "line 1 must be --- to open the details block"],
    [
      "a block that never closes",
      "---\nformat: 1\nname: Scout",
      "line 1 opens a details block that never closes; add a line with only --- after the last field",
    ],
    [
      "a line that is not a field",
      withLine("author:", "just some words"),
      'line 10 is not a field; write it as "name: value"',
    ],
    [
      "an unknown field",
      withLine("author:", "colour: red"),
      'line 10 has a field Markas does not know: "colour"',
    ],
    [
      "a repeated field",
      withLine("author:", "name: Scout again"),
      'line 10 repeats the field "name", already given on line 3',
    ],
    ["an empty role", withLine("role:", "role:   "), "line 4 has no role"],
    ["an empty sigil", withLine("sigil:", "sigil:"), "line 5 has no sigil"],
    ["an empty round time", withLine("round:", "round:"), "line 11 has no round time"],
    [
      "a missing name",
      withLine("name:", null),
      'line 13 closes the details block, but it has no name; add a line such as "name: Scout"',
    ],
    [
      "a missing format",
      withLine("format:", null),
      'line 13 closes the details block, but it has no format number; add a line such as "format: 1"',
    ],
    [
      "a missing sigil",
      withLine("sigil:", null),
      'line 13 closes the details block, but it has no sigil; add a line such as "sigil: 1 coral"',
    ],
    [
      "a newer format",
      withLine("format:", "format: 2"),
      "line 2 says format 2, which this version of Markas cannot read; update Markas",
    ],
    [
      "a format that is not a number",
      withLine("format:", "format: one"),
      'line 2 must say "format: 1"',
    ],
    [
      "a name that is too long",
      withLine("name:", `name: ${"n".repeat(61)}`),
      "line 3 has a name longer than 60 characters",
    ],
    [
      "a role that is too long",
      withLine("role:", `role: ${"r".repeat(121)}`),
      "line 4 has a role longer than 120 characters",
    ],
    [
      "a sigil pattern out of range",
      withLine("sigil:", "sigil: 8 coral"),
      'line 5 needs a sigil pattern from 0 to 7 and then a colour, such as "1 coral"',
    ],
    [
      "a sigil with no colour",
      withLine("sigil:", "sigil: coral"),
      'line 5 needs a sigil pattern from 0 to 7 and then a colour, such as "1 coral"',
    ],
    [
      "an unknown sigil colour",
      withLine("sigil:", "sigil: 1 teal"),
      'line 5 has a sigil colour Markas does not know: "teal"; use one of mint, amber, coral, sky, violet, rose, lime, sand',
    ],
    [
      "an unknown engine",
      withLine("engine:", "engine: other"),
      'line 6 has an engine Markas does not know: "other"; use claude or codex, or leave the line out',
    ],
    [
      "full access",
      withLine("access:", "access: full"),
      "line 7 asks for full access, which a bot file may not do; use ask or read, and raise it yourself after adding the bot",
    ],
    [
      "an unknown access level",
      withLine("access:", "access: everything"),
      'line 7 has an access level Markas does not know: "everything"; use ask or read',
    ],
    [
      "too many tags",
      withLine("tags:", "tags: a, b, c, d, e, f, g"),
      "line 8 has more than 6 tags",
    ],
    [
      "a tag that is too long",
      withLine("tags:", `tags: Browser, ${"t".repeat(25)}`),
      `line 8 has a tag longer than 24 characters: "${"t".repeat(25)}"`,
    ],
    [
      "a category that is too long",
      withLine("category:", `category: ${"c".repeat(41)}`),
      "line 9 has a category longer than 40 characters",
    ],
    [
      "a round time that cannot be read",
      withLine("round:", "round: sometimes"),
      'line 11 has a round time Markas cannot read; write it like "daily at 08:30", "weekdays at 08:30", "mon, thu at 09:00" or "every 60 minutes"',
    ],
    [
      "a round day that does not exist",
      withLine("round:", "round: funday at 08:30"),
      'line 11 has a round time Markas cannot read; write it like "daily at 08:30", "weekdays at 08:30", "mon, thu at 09:00" or "every 60 minutes"',
    ],
    [
      "a round time that is not a time",
      withLine("round:", "round: daily at 25:00"),
      "line 11 has a round time Markas cannot use: Give at least one time as HH:MM, for example 09:00.",
    ],
    [
      "a round that repeats too often",
      withLine("round:", "round: every 1 minute"),
      "line 11 has a round time Markas cannot use: A repeating round runs at most every 5 minutes.",
    ],
    [
      "a round with no instruction",
      withLine("round-instruction:", null),
      'line 11 sets a round, but the file has no "round-instruction" line saying what the bot does each time',
    ],
    [
      "a round instruction with no round",
      withLine("round:", null),
      'line 11 gives a round name, but the file has no "round" line saying when it runs',
    ],
    [
      "no instructions",
      GOOD.split("---\n").slice(0, 2).join("---\n").concat("---\n\n  \n"),
      "line 15 is where the instructions should start, but the file has none",
    ],
    [
      "instructions that are too long",
      `${GOOD}${"x".repeat(8_001)}`,
      "line 16 starts instructions longer than 8,000 characters",
    ],
    [
      "a character that cannot be shown",
      withLine("author:", "author: Some\u0000one"),
      "line 10 has a character that cannot be shown; delete it",
    ],
  ])("refuses %s", (_case, text, message) => {
    expect(problemsOf(text)[0]).toBe(message);
  });

  it("refuses a file over the size limit without reading it further", () => {
    expect(problemsOf(`${GOOD}${"x".repeat(BOT_FILE_MAX_BYTES)}`)).toEqual([
      "line 1 starts a file larger than 64 KB, the most a bot file may be",
    ]);
  });

  it("reports every problem at once, in line order", () => {
    const text = withLine("sigil:", "sigil: 9 coral").replace("access: ask", "access: full");
    expect(parseBotFile(text)).toMatchObject({
      ok: false,
      problems: [{ line: 5 }, { line: 7 }],
    });
  });

  it("produces a draft the draft parser accepts unchanged", () => {
    const parsed = parseBotFile(GOOD);
    if (!parsed.ok) throw new Error("Expected a draft.");
    expect(parseBotDraft(parsed.draft)).toEqual({ ok: true, draft: parsed.draft, adjusted: [] });
  });
});

describe("serializeBotFile", () => {
  const draft: BotDraft = {
    name: "Price Watcher",
    role: "Tracks numbers",
    instructions: "First line.\n\n- a point\n",
    sigil: { pattern: 4, color: "mint" },
    engine: "codex",
    access: "read",
    tags: ["Browser", "Needs a key"],
    category: "Monitoring",
    author: "Someone",
    round: {
      name: "Weekly look",
      instruction: "Check the numbers.",
      schedule: { kind: "daily", times: ["09:00"], weekdays: [1] },
    },
  };

  it("round-trips a draft through text", () => {
    const text = serializeBotFile(draft);
    expect(text).toBe(
      [
        "---",
        "format: 1",
        "name: Price Watcher",
        "role: Tracks numbers",
        "sigil: 4 mint",
        "engine: codex",
        "access: read",
        "tags: Browser, Needs a key",
        "category: Monitoring",
        "author: Someone",
        "round: mon at 09:00",
        "round-name: Weekly look",
        "round-instruction: Check the numbers.",
        "---",
        "",
        "First line.",
        "",
        "- a point",
        "",
      ].join("\n"),
    );
    expect(parseBotFile(text)).toEqual({
      ok: true,
      draft: { ...draft, instructions: "First line.\n\n- a point" },
    });
    expect(serializeBotFile((parseBotFile(text) as { draft: BotDraft }).draft)).toBe(text);
  });

  it("round-trips an interval round and a weekday round", () => {
    for (const schedule of [
      { kind: "interval", everyMinutes: 90 } as const,
      { kind: "daily", times: ["08:00", "17:30"], weekdays: [1, 2, 3, 4, 5] } as const,
    ]) {
      const round = { instruction: "Go.", schedule: { ...schedule } };
      const parsed = parseBotFile(serializeBotFile({ ...draft, round } as BotDraft));
      expect(parsed.ok && parsed.draft.round).toEqual(round);
    }
  });

  it("never writes full access, a folder, a model name or a one-time round", () => {
    const text = serializeBotFile({
      ...draft,
      engine: undefined,
      access: "full",
      model: "claude-sonnet-5",
      folder: "/somewhere/private",
      adoptExistingFolder: true,
      round: { instruction: "Once.", schedule: { kind: "once", at: "2030-01-01T00:00:00.000Z" } },
    });
    expect(text).toContain("access: ask");
    expect(text).toContain("engine: claude");
    expect(text).not.toMatch(/full|sonnet|somewhere|adopt|round|2030/);
  });

  it("keeps a value on one line, so a field cannot smuggle in another field", () => {
    const text = serializeBotFile({
      ...draft,
      access: "ask",
      name: "Scout\naccess: read\n---",
      tags: ["a,b"],
    });
    expect(text).toContain("name: Scout access: read ---\n");
    expect(text).toContain("tags: a b\n");
    expect(parseBotFile(text)).toMatchObject({
      ok: true,
      draft: { name: "Scout access: read ---", access: "ask", tags: ["a b"] },
    });
  });
});

describe("file names", () => {
  it("turns a name into a safe slug", () => {
    expect(slugify("Scout")).toBe("scout");
    expect(slugify("  Price Watcher 2! ")).toBe("price-watcher-2");
    expect(slugify("Café Señor")).toBe("cafe-senor");
    expect(slugify("../../etc")).toBe("etc");
    expect(slugify("***")).toBe("bot");
    expect(slugify("NUL")).toBe("nul-bot");
    expect(slugify("x".repeat(80))).toHaveLength(40);
    expect(botFileName("Scout")).toBe("scout.bot.md");
  });
});
