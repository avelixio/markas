import { type Schedule, validateSchedule } from "../backend/rounds/schedule";
import type { AccessLevel } from "./access";
import {
  BOT_DRAFT_LIMITS,
  type BotDraft,
  type BotFileProblem,
  type DraftRound,
  engineForModel,
  formatCount,
  isControlCode,
  isEngine,
  isSigilColor,
  manyLines,
  oneLine,
  SIGIL_COLORS,
  SIGIL_PATTERN_COUNT,
} from "./bot-draft";

/**
 * The bot file format: one Markdown file, `<slug>.bot.md`.
 * A details block between two `---` lines holds one `field: value` per line, and everything
 * after it is the bot's instructions.
 * This is not YAML: a value is the plain text after the colon, with no quoting and no nesting.
 * A bot file is data. Nothing in it is ever run.
 */
export const BOT_FILE_FORMAT = 1;
export const BOT_FILE_EXTENSION = ".bot.md";
/** The most a bot file may weigh. Anything larger is refused before it is read further. */
export const BOT_FILE_MAX_BYTES = 64 * 1024;

export type BotFileParse =
  | { ok: true; draft: BotDraft }
  | { ok: false; problems: BotFileProblem[] };

const FIELDS = [
  "format",
  "name",
  "role",
  "sigil",
  "engine",
  "access",
  "tags",
  "category",
  "author",
  "round",
  "round-name",
  "round-instruction",
] as const;
type Field = (typeof FIELDS)[number];

/** How an empty or missing field is named in a message. */
const FIELD_LABELS: Record<Field, string> = {
  format: "format number",
  name: "name",
  role: "role",
  sigil: "sigil",
  engine: "engine",
  access: "access level",
  tags: "tags",
  category: "category",
  author: "author",
  round: "round time",
  "round-name": "round name",
  "round-instruction": "round instruction",
};

const REQUIRED: Array<{ field: Field; example: string }> = [
  { field: "format", example: "format: 1" },
  { field: "name", example: "name: Scout" },
  { field: "role", example: "role: Watches public status pages and reports incidents" },
  { field: "sigil", example: "sigil: 1 coral" },
];

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const ROUND_EXAMPLES =
  '"daily at 08:30", "weekdays at 08:30", "mon, thu at 09:00" or "every 60 minutes"';

/** The problem reported for a file over the size limit, which is never read further. */
export function botFileTooLarge(): BotFileProblem {
  const limit = BOT_FILE_MAX_BYTES / 1024;
  return {
    line: 1,
    message: `line 1 starts a file larger than ${limit} KB, the most a bot file may be`,
  };
}

/** Reads a bot file. Every problem names its line, in words a person can act on. */
export function parseBotFile(text: string): BotFileParse {
  const problems: BotFileProblem[] = [];
  const problem = (line: number, what: string) => {
    problems.push({ line, message: `line ${line} ${what}` });
  };
  const failed = (): BotFileParse => ({
    ok: false,
    problems: problems.sort((a, b) => a.line - b.line),
  });

  if (new TextEncoder().encode(text).length > BOT_FILE_MAX_BYTES) {
    return { ok: false, problems: [botFileTooLarge()] };
  }

  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  lines.forEach((line, index) => {
    for (let at = 0; at < line.length; at += 1) {
      if (isControlCode(line.charCodeAt(at))) {
        problem(index + 1, "has a character that cannot be shown; delete it");
        return;
      }
    }
  });
  if (problems.length > 0) return failed();

  if (lines[0]?.trimEnd() !== "---") {
    problem(1, "must be --- to open the details block");
    return failed();
  }
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (closing === -1) {
    problem(
      1,
      "opens a details block that never closes; add a line with only --- after the last field",
    );
    return failed();
  }

  const values = new Map<Field, { line: number; value: string }>();
  for (let index = 1; index < closing; index += 1) {
    const number = index + 1;
    const raw = (lines[index] ?? "").trim();
    if (!raw || raw.startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z-]*)\s*:(.*)$/.exec(raw);
    if (!match) {
      problem(number, 'is not a field; write it as "name: value"');
      continue;
    }
    const key = (match[1] ?? "").toLowerCase();
    if (!isField(key)) {
      problem(number, `has a field Markas does not know: "${key}"`);
      continue;
    }
    const earlier = values.get(key);
    if (earlier) {
      problem(number, `repeats the field "${key}", already given on line ${earlier.line}`);
      continue;
    }
    const value = (match[2] ?? "").trim();
    values.set(key, { line: number, value });
    if (!value) problem(number, `has no ${FIELD_LABELS[key]}`);
  }

  for (const { field, example } of REQUIRED) {
    if (values.has(field)) continue;
    problem(
      closing + 1,
      `closes the details block, but it has no ${FIELD_LABELS[field]}; add a line such as "${example}"`,
    );
  }

  /** A field that was given a value, or null when it is absent or was already reported empty. */
  const given = (field: Field) => {
    const entry = values.get(field);
    return entry?.value ? entry : null;
  };
  const shortText = (field: Field, limit: number): string | undefined => {
    const entry = given(field);
    if (!entry) return undefined;
    if (entry.value.length > limit) {
      problem(
        entry.line,
        `has a ${FIELD_LABELS[field]} longer than ${formatCount(limit)} characters`,
      );
    }
    return oneLine(entry.value);
  };

  const format = given("format");
  if (format && format.value !== String(BOT_FILE_FORMAT)) {
    if (/^\d+$/.test(format.value) && Number(format.value) > BOT_FILE_FORMAT) {
      problem(
        format.line,
        `says format ${format.value}, which this version of Markas cannot read; update Markas`,
      );
    } else {
      problem(format.line, `must say "format: ${BOT_FILE_FORMAT}"`);
    }
  }

  const name = shortText("name", BOT_DRAFT_LIMITS.name) ?? "";
  const role = shortText("role", BOT_DRAFT_LIMITS.role) ?? "";

  let sigil: BotDraft["sigil"] = { pattern: 0, color: "mint" };
  const sigilEntry = given("sigil");
  if (sigilEntry) {
    const match = /^(\d+)\s+(\S+)$/.exec(sigilEntry.value);
    const pattern = match ? Number(match[1]) : Number.NaN;
    const color = match?.[2]?.toLowerCase();
    if (!match || !(pattern >= 0 && pattern < SIGIL_PATTERN_COUNT)) {
      problem(
        sigilEntry.line,
        'needs a sigil pattern from 0 to 7 and then a colour, such as "1 coral"',
      );
    } else if (!isSigilColor(color)) {
      problem(
        sigilEntry.line,
        `has a sigil colour Markas does not know: "${color}"; use one of ${SIGIL_COLORS.join(", ")}`,
      );
    } else {
      sigil = { pattern, color };
    }
  }

  let engine: BotDraft["engine"];
  const engineEntry = given("engine");
  if (engineEntry) {
    const value = engineEntry.value.toLowerCase();
    if (isEngine(value)) engine = value;
    else {
      problem(
        engineEntry.line,
        `has an engine Markas does not know: "${engineEntry.value}"; use claude or codex, or leave the line out`,
      );
    }
  }

  let access: AccessLevel = "ask";
  const accessEntry = given("access");
  if (accessEntry) {
    const value = accessEntry.value.toLowerCase();
    if (value === "ask" || value === "read") access = value;
    else if (value === "full") {
      problem(
        accessEntry.line,
        "asks for full access, which a bot file may not do; use ask or read, and raise it yourself after adding the bot",
      );
    } else {
      problem(
        accessEntry.line,
        `has an access level Markas does not know: "${accessEntry.value}"; use ask or read`,
      );
    }
  }

  let tags: string[] = [];
  const tagsEntry = given("tags");
  if (tagsEntry) {
    tags = [...new Set(tagsEntry.value.split(",").map(oneLine).filter(Boolean))];
    if (tags.length > BOT_DRAFT_LIMITS.tags) {
      problem(tagsEntry.line, `has more than ${BOT_DRAFT_LIMITS.tags} tags`);
    }
    const long = tags.find((tag) => tag.length > BOT_DRAFT_LIMITS.tag);
    if (long) {
      problem(
        tagsEntry.line,
        `has a tag longer than ${BOT_DRAFT_LIMITS.tag} characters: "${long}"`,
      );
    }
  }

  const category = shortText("category", BOT_DRAFT_LIMITS.category);
  const author = shortText("author", BOT_DRAFT_LIMITS.author);

  let round: DraftRound | undefined;
  const roundEntry = values.get("round");
  const roundName = shortText("round-name", BOT_DRAFT_LIMITS.roundName);
  const roundInstruction = shortText("round-instruction", BOT_DRAFT_LIMITS.roundInstruction);
  if (roundEntry) {
    const instructionEntry = values.get("round-instruction");
    if (!instructionEntry) {
      problem(
        roundEntry.line,
        'sets a round, but the file has no "round-instruction" line saying what the bot does each time',
      );
    }
    if (roundEntry.value) {
      const schedule = parseRoundTime(roundEntry.value);
      if (typeof schedule === "string") problem(roundEntry.line, schedule);
      else if (roundInstruction) {
        round = { instruction: roundInstruction, schedule };
        if (roundName) round.name = roundName;
      }
    }
  } else {
    for (const field of ["round-name", "round-instruction"] as const) {
      const entry = values.get(field);
      if (!entry) continue;
      problem(
        entry.line,
        `gives a ${FIELD_LABELS[field]}, but the file has no "round" line saying when it runs`,
      );
    }
  }

  const instructions = manyLines(lines.slice(closing + 1).join("\n"));
  const firstBodyLine = lines.findIndex((line, index) => index > closing && line.trim() !== "");
  if (!instructions) {
    problem(closing + 2, "is where the instructions should start, but the file has none");
  } else if (instructions.length > BOT_DRAFT_LIMITS.instructions) {
    problem(
      firstBodyLine + 1,
      `starts instructions longer than ${formatCount(BOT_DRAFT_LIMITS.instructions)} characters`,
    );
  }

  if (problems.length > 0) return failed();

  const draft: BotDraft = { name, role, instructions, sigil, access, tags };
  if (engine) draft.engine = engine;
  if (category) draft.category = category;
  if (author) draft.author = author;
  if (round) draft.round = round;
  return { ok: true, draft };
}

/**
 * Writes a draft as a bot file.
 * Only what the format knows is written: no folder, no model, and never full access.
 * A round that runs once is left out, because a date means nothing to the next person.
 */
export function serializeBotFile(draft: BotDraft): string {
  const fields: Array<[Field, string]> = [
    ["format", String(BOT_FILE_FORMAT)],
    ["name", oneLine(draft.name)],
    ["role", oneLine(draft.role)],
    ["sigil", `${draft.sigil.pattern} ${draft.sigil.color}`],
  ];
  const engine = draft.engine ?? (draft.model ? engineForModel(draft.model) : undefined);
  if (engine) fields.push(["engine", engine]);
  fields.push(["access", draft.access === "full" ? "ask" : draft.access]);
  const tags = draft.tags.map((tag) => oneLine(tag.replaceAll(",", " "))).filter(Boolean);
  if (tags.length > 0) fields.push(["tags", tags.join(", ")]);
  if (draft.category) fields.push(["category", oneLine(draft.category)]);
  if (draft.author) fields.push(["author", oneLine(draft.author)]);
  if (draft.round && draft.round.schedule.kind !== "once") {
    fields.push(["round", formatRoundTime(draft.round.schedule)]);
    if (draft.round.name) fields.push(["round-name", oneLine(draft.round.name)]);
    fields.push(["round-instruction", oneLine(draft.round.instruction)]);
  }
  const block = fields.map(([field, value]) => `${field}: ${value}`).join("\n");
  return `---\n${block}\n---\n\n${manyLines(draft.instructions)}\n`;
}

/** Reads a round time such as "weekdays at 08:30". Returns the problem as text when it cannot. */
function parseRoundTime(value: string): Schedule | string {
  const unreadable = `has a round time Markas cannot read; write it like ${ROUND_EXAMPLES}`;
  const text = value.toLowerCase().replace(/\s+/g, " ");
  let candidate: unknown;
  const every = /^every (\d+) (minutes?|hours?)$/.exec(text);
  if (every) {
    const count = Number(every[1]);
    candidate = {
      kind: "interval",
      everyMinutes: every[2]?.startsWith("hour") ? count * 60 : count,
    };
  } else {
    const at = /^(.+) at (.+)$/.exec(text);
    if (!at) return unreadable;
    const dayWords = (at[1] ?? "").split(/[ ,]+/).filter(Boolean);
    let weekdays: number[];
    if (dayWords.length === 1 && dayWords[0] === "daily") weekdays = [0, 1, 2, 3, 4, 5, 6];
    else if (dayWords.length === 1 && dayWords[0] === "weekdays") weekdays = [1, 2, 3, 4, 5];
    else weekdays = dayWords.map((word) => DAY_NAMES.indexOf(word as (typeof DAY_NAMES)[number]));
    if (weekdays.length === 0 || weekdays.includes(-1)) return unreadable;
    candidate = {
      kind: "daily",
      weekdays,
      times: (at[2] ?? "")
        .split(",")
        .map((time) => time.trim())
        .filter(Boolean),
    };
  }
  try {
    return validateSchedule(candidate);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `has a round time Markas cannot use: ${reason}`;
  }
}

function formatRoundTime(schedule: Exclude<Schedule, { kind: "once" }>): string {
  if (schedule.kind === "interval") return `every ${schedule.everyMinutes} minutes`;
  const days = [...schedule.weekdays].sort((a, b) => a - b);
  let when: string;
  if (days.length === 7) when = "daily";
  else if (days.join() === "1,2,3,4,5") when = "weekdays";
  else when = days.map((day) => DAY_NAMES[day]).join(", ");
  return `${when} at ${schedule.times.join(", ")}`;
}

function isField(key: string): key is Field {
  return (FIELDS as readonly string[]).includes(key);
}

/** Names Windows keeps for itself; a folder or file may not be called one of them. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/;

/** A name as a safe file and folder name: "Scout 2!" becomes "scout-2". */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (!slug) return "bot";
  return RESERVED_NAMES.test(slug) ? `${slug}-bot` : slug;
}

/** The file name a bot is shared under, such as `scout.bot.md`. */
export function botFileName(name: string): string {
  return `${slugify(name)}${BOT_FILE_EXTENSION}`;
}
