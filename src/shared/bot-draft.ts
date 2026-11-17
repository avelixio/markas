import { type Schedule, validateSchedule } from "../backend/rounds/schedule";
import { type AccessLevel, DEFAULT_ACCESS, isAccessLevel } from "./access";
import {
  type AgentModelId,
  type AgentProviderId,
  BOT_AVATAR_SHAPES,
  type BotAvatarColor,
  type BotAvatarShape,
  type BotSummary,
  isAgentModel,
  isClaudeModel,
} from "./ipc";

/**
 * A bot draft: everything needed to create a bot, before it exists.
 * Dispatch produces one from a chat, a bot file parses into one, and the review screen edits one.
 * A draft is data only. Nothing in it is ever run.
 */
export interface BotDraft {
  name: string;
  /** One line saying what the bot is for. */
  role: string;
  /** The bot's standing instructions, as plain text or Markdown. */
  instructions: string;
  sigil: BotSigil;
  /** The engine the bot should start on. Left out, Markas uses the person's default. */
  engine?: AgentProviderId;
  /** A specific model. When given it decides the engine. */
  model?: AgentModelId;
  access: AccessLevel;
  tags: string[];
  category?: string;
  author?: string;
  /** A round to create together with the bot. */
  round?: DraftRound;
  /** Where the bot's own folder goes. Only the person can set this, never a model or a file. */
  folder?: string;
  /** The person's explicit yes to using a folder that already has files in it. */
  adoptExistingFolder?: boolean;
}

export interface DraftRound {
  name?: string;
  /** What the bot is told to do each time. */
  instruction: string;
  schedule: Schedule;
}

export const SIGIL_COLORS = [
  "mint",
  "amber",
  "coral",
  "sky",
  "violet",
  "rose",
  "lime",
  "sand",
] as const;
export type SigilColor = (typeof SIGIL_COLORS)[number];
export const SIGIL_PATTERN_COUNT = 8;

/** A bot's badge: one of eight patterns in one of eight colours. */
export interface BotSigil {
  pattern: number;
  color: SigilColor;
}

export const BOT_ENGINES = ["claude", "codex"] as const satisfies readonly AgentProviderId[];

/** Tags the interface knows how to draw. Other short tags are allowed and shown as plain text. */
export const KNOWN_BOT_TAGS = [
  "Browser",
  "Files",
  "Commands",
  "Needs a key",
  "Asks before sending",
] as const;

export const BOT_DRAFT_LIMITS = {
  name: 60,
  role: 120,
  instructions: 8_000,
  tags: 6,
  tag: 24,
  category: 40,
  author: 80,
  roundName: 80,
  roundInstruction: 2_000,
  folder: 1_024,
} as const;

export type BotDraftParse =
  | {
      ok: true;
      draft: BotDraft;
      /** What was changed to make the draft safe, in plain words, for the review screen. */
      adjusted: string[];
    }
  | { ok: false; problem: string };

export interface ParseBotDraftOptions {
  /**
   * True only for a draft the person has looked at in the review screen.
   * Such a draft may ask for full access and name a folder, and anything wrong with it is
   * reported instead of quietly repaired.
   */
  reviewed?: boolean;
}

class DraftProblem extends Error {}

type Cap = (text: string, limit: number, label: string) => string;

/**
 * Turns anything into a bot draft, or says why it cannot.
 * By default the input is treated as untrusted (a model's output): unknown fields are dropped,
 * text is capped, full access is lowered to ask first, and a folder is never accepted.
 */
export function parseBotDraft(value: unknown, options: ParseBotDraftOptions = {}): BotDraftParse {
  const reviewed = options.reviewed === true;
  const adjusted: string[] = [];
  /** Untrusted input is repaired and the repair noted; reviewed input is refused instead. */
  const issue = (problem: string, repair: string) => {
    if (reviewed) throw new DraftProblem(problem);
    const note = `${problem} ${repair}`;
    if (!adjusted.includes(note)) adjusted.push(note);
  };
  const capped: Cap = (text, limit, label) => {
    if (text.length <= limit) return text;
    const plural = label.endsWith("s");
    issue(
      `The ${label} ${plural ? "are" : "is"} longer than ${formatCount(limit)} characters.`,
      plural ? "They were cut." : "It was cut.",
    );
    return text.slice(0, limit).trimEnd();
  };

  try {
    if (!isRecord(value)) throw new DraftProblem("The draft is not a set of fields.");

    const name = capped(oneLine(value.name), BOT_DRAFT_LIMITS.name, "name");
    if (!name) throw new DraftProblem("The draft has no name.");
    const role = capped(oneLine(value.role), BOT_DRAFT_LIMITS.role, "role");
    const instructions = capped(
      manyLines(value.instructions),
      BOT_DRAFT_LIMITS.instructions,
      "instructions",
    );
    if (!instructions) throw new DraftProblem("The draft has no instructions.");

    const draft: BotDraft = {
      name,
      role,
      instructions,
      sigil: defaultSigil(name),
      access: DEFAULT_ACCESS,
      tags: [],
    };

    if (value.sigil !== undefined) {
      if (isSigil(value.sigil)) {
        draft.sigil = { pattern: value.sigil.pattern, color: value.sigil.color };
      } else {
        issue("The sigil is not a pattern from 0 to 7 with a known colour.", "One was chosen.");
      }
    }

    if (value.access !== undefined) {
      if (!isAccessLevel(value.access)) {
        issue("The access level is not one Markas knows.", "Ask first is used.");
      } else if (value.access === "full" && !reviewed) {
        adjusted.push(
          "The draft asked for full access. It was lowered to ask first; you can raise it yourself.",
        );
      } else {
        draft.access = value.access;
      }
    }

    if (value.model !== undefined) {
      if (isAgentModel(value.model)) draft.model = value.model;
      else issue("The model is not one Markas knows.", "Your default is used.");
    }
    if (value.engine !== undefined) {
      if (isEngine(value.engine)) draft.engine = value.engine;
      else issue("The engine is not Claude Code or Codex.", "Your default is used.");
    }
    if (draft.model && draft.engine && engineForModel(draft.model) !== draft.engine) {
      issue("The model does not run on the chosen engine.", "The model's own engine is used.");
      draft.engine = engineForModel(draft.model);
    }

    if (value.tags !== undefined) {
      if (!Array.isArray(value.tags)) {
        issue("The tags are not a list.", "They were left out.");
      } else {
        const tags = value.tags.map(oneLine).filter(Boolean);
        const unique = [...new Set(tags.map((tag) => capped(tag, BOT_DRAFT_LIMITS.tag, "tag")))];
        if (unique.length > BOT_DRAFT_LIMITS.tags) {
          issue(
            `There are more than ${BOT_DRAFT_LIMITS.tags} tags.`,
            "The extra ones were left out.",
          );
        }
        draft.tags = unique.slice(0, BOT_DRAFT_LIMITS.tags);
      }
    }

    const category = capped(oneLine(value.category), BOT_DRAFT_LIMITS.category, "category");
    if (category) draft.category = category;
    const author = capped(oneLine(value.author), BOT_DRAFT_LIMITS.author, "author");
    if (author) draft.author = author;

    if (value.round !== undefined && value.round !== null) {
      const round = parseRound(value.round, capped);
      if (typeof round === "string") issue(round, "The round was left out.");
      else draft.round = round;
    }

    if (reviewed) {
      if (value.folder !== undefined && value.folder !== null) {
        if (typeof value.folder !== "string") throw new DraftProblem("The folder is not text.");
        const folder = value.folder.trim();
        if (folder.length > BOT_DRAFT_LIMITS.folder) {
          throw new DraftProblem("The folder path is too long.");
        }
        if (hasControlCharacter(folder)) {
          throw new DraftProblem("The folder path has a character that cannot be used.");
        }
        if (folder) draft.folder = folder;
      }
      if (value.adoptExistingFolder === true) draft.adoptExistingFolder = true;
    }

    return { ok: true, draft, adjusted };
  } catch (error) {
    if (error instanceof DraftProblem) return { ok: false, problem: error.message };
    throw error;
  }
}

function parseRound(value: unknown, capped: Cap): DraftRound | string {
  if (!isRecord(value)) return "The round is not a set of fields.";
  const instruction = capped(
    manyLines(value.instruction),
    BOT_DRAFT_LIMITS.roundInstruction,
    "round instruction",
  );
  if (!instruction) return "The round does not say what the bot should do each time.";
  let schedule: Schedule;
  try {
    schedule = validateSchedule(value.schedule);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `The round's schedule cannot be used: ${reason}`;
  }
  const round: DraftRound = { instruction, schedule };
  const name = capped(oneLine(value.name), BOT_DRAFT_LIMITS.roundName, "round name");
  if (name) round.name = name;
  return round;
}

/** 8000 as "8,000", the same on every computer. */
export function formatCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+$)/g, ",");
}

/** The engine a model runs on. */
export function engineForModel(model: AgentModelId): AgentProviderId {
  return isClaudeModel(model) ? "claude" : "codex";
}

export function isEngine(value: unknown): value is AgentProviderId {
  return value === "claude" || value === "codex";
}

export function isSigilColor(value: unknown): value is SigilColor {
  return SIGIL_COLORS.includes(value as SigilColor);
}

export function isSigil(value: unknown): value is BotSigil {
  return (
    isRecord(value) &&
    typeof value.pattern === "number" &&
    Number.isInteger(value.pattern) &&
    value.pattern >= 0 &&
    value.pattern < SIGIL_PATTERN_COUNT &&
    isSigilColor(value.color)
  );
}

/** A steady sigil for a name, so the same name always gets the same badge. */
export function defaultSigil(name: string): BotSigil {
  let hash = 0;
  for (const character of name.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return {
    pattern: hash % SIGIL_PATTERN_COUNT,
    color: SIGIL_COLORS[(hash >>> 3) % SIGIL_COLORS.length] ?? "mint",
  };
}

/**
 * Bots are stored with an avatar shape and colour from before sigils existed.
 * The interface draws shape number N as sigil pattern N, and these stored colours as sigil colours.
 */
const SIGIL_TO_AVATAR_COLOR: Record<SigilColor, BotAvatarColor> = {
  mint: "green",
  amber: "orange",
  coral: "red",
  sky: "blue",
  violet: "violet",
  rose: "magenta",
  lime: "yellow",
  sand: "brown",
};

const AVATAR_TO_SIGIL_COLOR: Record<BotAvatarColor, SigilColor> = {
  green: "mint",
  orange: "amber",
  red: "coral",
  blue: "sky",
  violet: "violet",
  magenta: "rose",
  yellow: "lime",
  brown: "sand",
  // Stored colours with no sigil colour of their own take the nearest one.
  cyan: "mint",
  black: "sand",
  gray: "sand",
};

export function sigilToAvatar(sigil: BotSigil): {
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
} {
  return {
    avatarShape: BOT_AVATAR_SHAPES[sigil.pattern] ?? "blob",
    avatarColor: SIGIL_TO_AVATAR_COLOR[sigil.color],
  };
}

export function avatarToSigil(shape: BotAvatarShape, color: BotAvatarColor): BotSigil {
  return {
    pattern: Math.max(0, BOT_AVATAR_SHAPES.indexOf(shape)),
    color: AVATAR_TO_SIGIL_COLOR[color],
  };
}

/** How often a suggested round runs, for a card's chip. */
export type RoundCadence = "daily" | "weekly" | "repeating" | "once";

export function roundCadence(schedule: Schedule): RoundCadence {
  if (schedule.kind === "interval") return "repeating";
  if (schedule.kind === "once") return "once";
  return schedule.weekdays.length === 1 ? "weekly" : "daily";
}

// ----- What the host's library and creation methods take and return -----

/** A ready-made bot as a card shows it. */
export interface LibraryBotSummary {
  /** The file name without `.bot.md`. Pass it to `library.read`. */
  id: string;
  name: string;
  role: string;
  sigil: BotSigil;
  tags: string[];
  category: string | null;
  author: string | null;
  engine: AgentProviderId | null;
  access: AccessLevel;
  /** How often its suggested round runs, or null when it suggests none. */
  roundCadence: RoundCadence | null;
}

/** One thing wrong with a bot file. `message` already names the line: "line 4 has no name". */
export interface BotFileProblem {
  line: number;
  message: string;
}

export interface ImportBotFileInput {
  /** The text of a bot file, for a file the person dropped or picked in the interface. */
  text?: string;
  /** Or the path of a bot file on this computer. */
  path?: string;
  /** The file's name, shown in messages when only its text was sent. */
  fileName?: string;
}

export type ImportBotFileResult =
  | { ok: true; fileName: string | null; draft: BotDraft }
  | {
      ok: false;
      fileName: string | null;
      /** The first problem as one sentence, ready to show. */
      message: string;
      problems: BotFileProblem[];
    };

export interface ExportBotResult {
  /** A suggested file name, such as `scout.bot.md`. */
  fileName: string;
  text: string;
}

/** Where a new bot's folder would go, and whether it is free. */
export interface BotFolderPreview {
  folder: string;
  /** True when the folder already has files in it or belongs to another bot. */
  inUse: boolean;
  /** The name of the bot that already owns the folder. Such a folder cannot be adopted. */
  usedByBot: string | null;
  canAdopt: boolean;
  /** A free name next to it, such as `scout-2`, and its full path. Null when the folder is free. */
  suggestedName: string | null;
  suggestedFolder: string | null;
}

export interface PreviewBotFolderInput {
  name: string;
  folder?: string;
}

export type CreateBotFromDraftResult =
  | { ok: true; bot: BotSummary; round: { id: string; name: string } | null }
  | ({ ok: false; reason: "folder-in-use"; message: string } & BotFolderPreview);

// ----- What the host's Dispatch methods return -----

/** One thing said in the conversation with Dispatch. */
export interface DispatchMessage {
  id: string;
  from: "you" | "dispatch";
  text: string;
  /** Short answers Dispatch offers, shown as buttons. */
  quickReplies?: string[];
  /** Set on the message where Dispatch proposes a bot. */
  draft?: BotDraft;
}

/**
 * Where the conversation with Dispatch stands after a step.
 * limit: the engine's plan is used up. unavailable: Dispatch could not start. failed: this turn broke.
 * What was said so far is always given back, so it is never lost.
 */
export type DispatchTurn =
  | { ok: true; messages: DispatchMessage[] }
  | {
      ok: false;
      reason: "limit" | "unavailable" | "failed";
      message: string;
      /** The engine Dispatch was running on when it went down, when there was one. */
      engine: AgentProviderId | null;
      /** Another engine Dispatch could run on instead, when there is one. */
      otherEngine: AgentProviderId | null;
      messages: DispatchMessage[];
    };

// ----- Text cleaning shared with the bot file format -----

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for characters that cannot be shown: control characters other than tab and line breaks. */
export function isControlCode(code: number): boolean {
  return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
}

/** True when text meant for one line holds a control character or a line break. */
export function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isControlCode(code) || code === 10 || code === 13) return true;
  }
  return false;
}

function stripControls(text: string): string {
  let cleaned = "";
  for (const character of text) {
    if (!isControlCode(character.charCodeAt(0))) cleaned += character;
  }
  return cleaned;
}

/** Text that must fit on one line. Anything that is not text becomes empty. */
export function oneLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return stripControls(value).replace(/\s+/g, " ").trim();
}

/** Text that may span lines, with one kind of line break and no blank edges. */
export function manyLines(value: unknown): string {
  if (typeof value !== "string") return "";
  return stripControls(value.replace(/\r\n?/g, "\n"))
    .replace(/^(?:[ \t]*\n)+/, "")
    .trimEnd();
}
