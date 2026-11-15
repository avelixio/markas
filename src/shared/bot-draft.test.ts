// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  avatarToSigil,
  type BotDraft,
  defaultSigil,
  isSigil,
  parseBotDraft,
  roundCadence,
  SIGIL_COLORS,
  sigilToAvatar,
} from "./bot-draft";
import { BOT_AVATAR_COLORS, BOT_AVATAR_SHAPES } from "./ipc";

const draftOf = (value: unknown, reviewed = false): BotDraft => {
  const parsed = parseBotDraft(value, { reviewed });
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.draft;
};

const BASE = { name: "Scout", role: "Watches pages", instructions: "Check the pages." };

describe("parseBotDraft, for a draft from a model", () => {
  it("accepts a complete draft and changes nothing", () => {
    const draft = {
      ...BASE,
      sigil: { pattern: 1, color: "coral" },
      engine: "claude",
      model: "claude-sonnet-5",
      access: "read",
      tags: ["Browser"],
      category: "Monitoring",
      author: "Dispatch",
      round: {
        name: "Morning",
        instruction: "Check.",
        schedule: { kind: "daily", times: ["08:30"], weekdays: [1, 2, 3, 4, 5] },
      },
    };
    expect(parseBotDraft(draft)).toEqual({ ok: true, draft, adjusted: [] });
  });

  it("fills in what a short draft leaves out, carefully", () => {
    expect(draftOf({ name: "Scout", instructions: "Check." })).toEqual({
      name: "Scout",
      role: "",
      instructions: "Check.",
      sigil: defaultSigil("Scout"),
      access: "ask",
      tags: [],
    });
  });

  it.each([
    [null, "The draft is not a set of fields."],
    ["Scout", "The draft is not a set of fields."],
    [[BASE], "The draft is not a set of fields."],
    [{ ...BASE, name: "  " }, "The draft has no name."],
    [{ ...BASE, name: 7 }, "The draft has no name."],
    [{ ...BASE, instructions: "\n \n" }, "The draft has no instructions."],
  ])("refuses %j", (value, problem) => {
    expect(parseBotDraft(value)).toEqual({ ok: false, problem });
  });

  it("drops fields it does not know", () => {
    const draft = draftOf({ ...BASE, command: "rm -rf /", __proto__: { access: "full" }, id: "x" });
    expect(Object.keys(draft).sort()).toEqual(
      ["access", "instructions", "name", "role", "sigil", "tags"].sort(),
    );
  });

  it("never lets a model ask for full access", () => {
    const parsed = parseBotDraft({ ...BASE, access: "full" });
    expect(parsed).toMatchObject({ ok: true, draft: { access: "ask" } });
    expect(parsed.ok && parsed.adjusted).toEqual([
      "The draft asked for full access. It was lowered to ask first; you can raise it yourself.",
    ]);
  });

  it("never lets a model choose the folder or adopt one", () => {
    const draft = draftOf({ ...BASE, folder: "/home/someone", adoptExistingFolder: true });
    expect(draft.folder).toBeUndefined();
    expect(draft.adoptExistingFolder).toBeUndefined();
  });

  it("caps every length and says so", () => {
    const parsed = parseBotDraft({
      name: "n".repeat(200),
      role: "r".repeat(500),
      instructions: "i".repeat(20_000),
      tags: ["t".repeat(100), "a", "b", "c", "d", "e", "f"],
      category: "c".repeat(100),
      author: "a".repeat(200),
    });
    if (!parsed.ok) throw new Error(parsed.problem);
    expect(parsed.draft.name).toHaveLength(60);
    expect(parsed.draft.role).toHaveLength(120);
    expect(parsed.draft.instructions).toHaveLength(8_000);
    expect(parsed.draft.tags).toHaveLength(6);
    expect(parsed.draft.tags[0]).toHaveLength(24);
    expect(parsed.draft.category).toHaveLength(40);
    expect(parsed.draft.author).toHaveLength(80);
    expect(parsed.adjusted).toContain("The name is longer than 60 characters. It was cut.");
    expect(parsed.adjusted).toContain(
      "The instructions are longer than 8,000 characters. They were cut.",
    );
    expect(parsed.adjusted).toContain("There are more than 6 tags. The extra ones were left out.");
  });

  it("keeps one-line fields on one line and strips characters that cannot be shown", () => {
    const draft = draftOf({
      name: "Sc\u0000out\nthe  second",
      role: "a\tb",
      instructions: "one\r\ntwo\u0007\n\n",
    });
    expect(draft.name).toBe("Scout the second");
    expect(draft.role).toBe("a b");
    expect(draft.instructions).toBe("one\ntwo");
  });

  it("repairs a bad sigil, access level, engine, model and tags, and notes each repair", () => {
    const parsed = parseBotDraft({
      ...BASE,
      sigil: { pattern: 9, color: "teal" },
      access: "root",
      engine: "other",
      model: "some-model",
      tags: "Browser",
    });
    if (!parsed.ok) throw new Error(parsed.problem);
    expect(parsed.draft).toEqual({
      ...BASE,
      sigil: defaultSigil("Scout"),
      access: "ask",
      tags: [],
    });
    expect(parsed.adjusted).toHaveLength(5);
  });

  it("lets the model decide the engine when the two disagree", () => {
    const parsed = parseBotDraft({ ...BASE, engine: "codex", model: "claude-opus-5" });
    expect(parsed).toMatchObject({ ok: true, draft: { engine: "claude", model: "claude-opus-5" } });
  });

  it("leaves out a round that cannot run, and says why", () => {
    const parsed = parseBotDraft({
      ...BASE,
      round: { instruction: "Check.", schedule: { kind: "interval", everyMinutes: 1 } },
    });
    if (!parsed.ok) throw new Error(parsed.problem);
    expect(parsed.draft.round).toBeUndefined();
    expect(parsed.adjusted).toEqual([
      "The round's schedule cannot be used: A repeating round runs at most every 5 minutes. The round was left out.",
    ]);
    expect(
      draftOf({ ...BASE, round: { schedule: { kind: "interval", everyMinutes: 30 } } }).round,
    ).toBeUndefined();
    expect(draftOf({ ...BASE, round: "daily" }).round).toBeUndefined();
  });
});

describe("parseBotDraft, for a draft the person reviewed", () => {
  it("allows full access, a folder and adopting it", () => {
    const draft = draftOf(
      { ...BASE, access: "full", folder: "  /work/scout ", adoptExistingFolder: true },
      true,
    );
    expect(draft).toMatchObject({
      access: "full",
      folder: "/work/scout",
      adoptExistingFolder: true,
    });
  });

  it("only adopts a folder on an explicit true", () => {
    expect(
      draftOf({ ...BASE, adoptExistingFolder: "yes" }, true).adoptExistingFolder,
    ).toBeUndefined();
  });

  it.each([
    [{ ...BASE, name: "n".repeat(61) }, "The name is longer than 60 characters."],
    [{ ...BASE, access: "root" }, "The access level is not one Markas knows."],
    [{ ...BASE, model: "some-model" }, "The model is not one Markas knows."],
    [{ ...BASE, engine: "other" }, "The engine is not Claude Code or Codex."],
    [
      { ...BASE, sigil: { pattern: 1 } },
      "The sigil is not a pattern from 0 to 7 with a known colour.",
    ],
    [{ ...BASE, folder: 7 }, "The folder is not text."],
    [{ ...BASE, folder: "/a\nb" }, "The folder path has a character that cannot be used."],
    [
      { ...BASE, round: { instruction: "", schedule: { kind: "interval", everyMinutes: 30 } } },
      "The round does not say what the bot should do each time.",
    ],
    [
      {
        ...BASE,
        round: { instruction: "Go.", schedule: { kind: "daily", times: [], weekdays: [1] } },
      },
      "The round's schedule cannot be used: Give at least one time as HH:MM, for example 09:00.",
    ],
  ])("reports a problem instead of repairing %j", (value, problem) => {
    expect(parseBotDraft(value, { reviewed: true })).toEqual({ ok: false, problem });
  });
});

describe("sigils", () => {
  it("maps every sigil to a stored avatar and back", () => {
    for (let pattern = 0; pattern < 8; pattern += 1) {
      for (const color of SIGIL_COLORS) {
        const avatar = sigilToAvatar({ pattern, color });
        expect(avatarToSigil(avatar.avatarShape, avatar.avatarColor)).toEqual({ pattern, color });
      }
    }
  });

  it("gives every stored avatar a valid sigil", () => {
    for (const shape of BOT_AVATAR_SHAPES) {
      for (const color of BOT_AVATAR_COLORS)
        expect(isSigil(avatarToSigil(shape, color))).toBe(true);
    }
  });

  it("gives a name the same valid sigil every time", () => {
    expect(defaultSigil("Scout")).toEqual(defaultSigil("scout"));
    expect(isSigil(defaultSigil("Anything at all"))).toBe(true);
  });

  it("names how often a round runs", () => {
    expect(roundCadence({ kind: "daily", times: ["08:00"], weekdays: [1, 2, 3, 4, 5] })).toBe(
      "daily",
    );
    expect(roundCadence({ kind: "daily", times: ["08:00"], weekdays: [1] })).toBe("weekly");
    expect(roundCadence({ kind: "interval", everyMinutes: 30 })).toBe("repeating");
    expect(roundCadence({ kind: "once", at: "2030-01-01T00:00:00.000Z" })).toBe("once");
  });
});
