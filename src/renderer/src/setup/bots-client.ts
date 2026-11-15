import type { AccessLevel } from "../../../shared/access";
import type { DraftRound } from "../../../shared/bot-draft";
import type { SigilColor } from "../ui/Sigil";
import type { EngineId } from "./setup-client";

/** A bot that does not exist yet: everything the review screen shows and the person can change. */
export interface BotDraft {
  name: string;
  role: string;
  instructions: string;
  sigil: { pattern: number; color: SigilColor };
  engine: EngineId | null;
  model: string | null;
  access: AccessLevel;
  /** Where the bot will live. Empty means the default folder under Markas's data. */
  folder: string;
  /** A round the draft suggests, such as "Every day at 08:30". Null when it suggests none. */
  round: { label: string; schedule: string; enabled: boolean } | null;
  /** The same round as the host creates it. The label and schedule above are its words. */
  roundSpec?: DraftRound | null;
  tags: string[];
}

export interface ReadyBot {
  id: string;
  name: string;
  summary: string;
  author: string;
  category: string;
  tags: string[];
  sigil: { pattern: number; color: SigilColor };
}

export interface DispatchMessage {
  id: string;
  from: "you" | "dispatch";
  text: string;
  /** Short answers Dispatch offers, shown as buttons. */
  quickReplies?: string[];
  /** Set on the message where Dispatch proposes a bot. */
  draft?: BotDraft;
}

export type DispatchTurn =
  | { ok: true; messages: DispatchMessage[] }
  | {
      ok: false;
      /** limit: the engine's plan is used up. unavailable: Dispatch could not start. failed: this turn broke. */
      reason: "limit" | "unavailable" | "failed";
      message: string;
      /** Another engine Dispatch could run on instead, when there is one. */
      otherEngine: EngineId | null;
      /** What was said so far is never lost. */
      messages: DispatchMessage[];
    };

export type ImportResult =
  | { ok: true; draft: BotDraft }
  | { ok: false; message: string; line: number | null };

export type CreateResult =
  | {
      ok: true;
      botId: string;
      /** The first run shows the person what the bot does. It can fail without undoing the bot. */
      testRun: { state: "passed" | "skipped" } | { state: "failed"; message: string };
    }
  | { ok: false; reason: "folder-in-use"; folder: string; suggestedFolder: string }
  | { ok: false; reason: "failed"; message: string };

/** Everything the bot steps of setup ask of the host. */
export interface BotsClient {
  listReady(): Promise<ReadyBot[]>;
  readReady(id: string): Promise<BotDraft>;
  importFile(name: string, text: string): Promise<ImportResult>;
  /** The conversation so far with Dispatch, starting it when there is none. */
  openDispatch(): Promise<DispatchTurn>;
  sayToDispatch(text: string): Promise<DispatchTurn>;
  /** Ask Dispatch to turn the conversation so far into a draft again. */
  redraft(): Promise<DispatchTurn>;
  /** Run Dispatch on another engine, for when the first one is out of plan or broken. */
  moveDispatch(engine: EngineId): Promise<DispatchTurn>;
  /** Ask Dispatch to repair a bot file that failed to import. */
  repairFile(name: string, text: string): Promise<ImportResult>;
  create(
    draft: BotDraft,
    options?: { adoptExistingFolder?: boolean; skipTestRun?: boolean },
  ): Promise<CreateResult>;
  runTest(botId: string): Promise<{ state: "passed" } | { state: "failed"; message: string }>;
}

export const EMPTY_DRAFT: BotDraft = {
  name: "",
  role: "",
  instructions: "",
  sigil: { pattern: 1, color: "mint" },
  engine: null,
  model: null,
  access: "ask",
  folder: "",
  round: null,
  tags: [],
};
