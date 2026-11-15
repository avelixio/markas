import type { AgentProviderId } from "./ipc";

/**
 * compact: a long conversation was folded into a summary; counted from the engine's own numbers.
 * trim: Markas cut a tool's output before the bot read it; counted from the characters cut.
 */
export type SavingKind = "compact" | "trim";
export const SAVING_KINDS: SavingKind[] = ["compact", "trim"];

/** Characters per token, for savings that are counted in characters. Roughly right for English. */
export const CHARS_PER_TOKEN = 4;

export interface OptimizerSettings {
  /** Fold a conversation into a summary when it nears the end of the model's memory. */
  autoCompact: boolean;
  /** How full the model's memory may get before that happens, from 0.5 to 0.95. */
  compactAt: number;
  /** Tell every bot to do the smallest thing that works and to answer briefly. */
  lean: boolean;
}

export const DEFAULT_OPTIMIZER_SETTINGS: OptimizerSettings = {
  autoCompact: true,
  compactAt: 0.8,
  lean: false,
};

export const COMPACT_AT_RANGE = { min: 0.5, max: 0.95 } as const;

export interface SavingEvent {
  at: string;
  botId: string | null;
  kind: SavingKind;
  /** Tokens kept out of the model's memory by this one event. */
  tokens: number;
}

export interface SavingTotal {
  events: number;
  tokens: number;
}

/** How full one bot's conversation is, as its engine reports it. */
export interface BotContext {
  botId: string;
  name: string;
  engine: AgentProviderId;
  /** Null until the engine has reported it, which is after the bot's first answer. */
  usedTokens: number | null;
  contextWindow: number | null;
  /** True while the conversation is being folded into a summary. */
  compacting: boolean;
}

/** What the Optimizer page shows. */
export interface OptimizerReport {
  settings: OptimizerSettings;
  /** When counting began on this computer. */
  since: string;
  totals: Record<SavingKind, SavingTotal>;
  /** Savings counted from the engine's own numbers. */
  measuredTokens: number;
  /** Savings worked out from characters, so only roughly right. */
  estimatedTokens: number;
  /** Bots that saved something, the most first. */
  perBot: Array<{ botId: string; name: string; tokens: number }>;
  /** The newest savings first. */
  recent: Array<SavingEvent & { botName: string }>;
  context: BotContext[];
  /** The outside tool that shortens command output, when it is on this computer. */
  commandFilter: { installed: boolean; version: string | null };
}
