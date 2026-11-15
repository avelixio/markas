import type { AccessLevel } from "../../shared/access";
import {
  type AgentExchangeSummary,
  type AgentModelId,
  type AgentReasoningEffort,
  type AttachmentSummary,
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  type BotAvatarColor,
  type BotAvatarShape,
  type MessageReaction,
} from "../../shared/ipc";
import type { MessageKey } from "./i18n";

export type BotAccent = "teal" | "orange" | "purple" | "blue" | "violet" | "coral" | "neutral";

export const AVATAR_SHAPES: BotAvatarShape[] = [...BOT_AVATAR_SHAPES];

export const AVATAR_COLORS: BotAvatarColor[] = [...BOT_AVATAR_COLORS];

export type MessageKind = "text" | "thinking" | "exchange";

/**
 * A status line under a message, kept as a translation key and not as text,
 * so it follows the language when the language changes.
 */
export interface MessageStatus {
  key: MessageKey;
  values?: Record<string, string | number>;
}

/** The focus areas a new bot offers, in the order they are shown. */
export const ONBOARDING_TOPICS = ["work", "research", "sales"] as const;
export type OnboardingTopic = (typeof ONBOARDING_TOPICS)[number];

/** What the host stores as a bot's preview before it has any message. */
const HOST_EMPTY_PREVIEW = "No messages yet";

/** Names a bot has before anyone names it: the host's, an older host's, and the interface's in each language. */
const DEFAULT_BOT_NAMES = new Set(["new bot", "new agent", "bot baru"]);

export function isDefaultBotName(name: string): boolean {
  return DEFAULT_BOT_NAMES.has(name.trim().toLowerCase());
}

/** The preview to show for a bot, or an empty string when it has no message yet. */
export function cleanPreview(preview: string): string {
  const cleaned = preview
    .replace(/\binbox\s+at\s+zero\b[:,]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned === HOST_EMPTY_PREVIEW ? "" : cleaned;
}

export interface BotMessage {
  id: string;
  turnId?: string;
  author: "you" | "bot";
  body: string;
  time: string;
  streaming?: boolean;
  animate?: boolean;
  itemType?: string;
  kind?: MessageKind;
  status?: MessageStatus;
  senderBotId?: string;
  replyToMessageId?: string | null;
  attachments?: AttachmentSummary[];
  exchange?: AgentExchangeSummary;
  reaction?: MessageReaction | null;
  items?: string[];
}

export interface BotProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  notifications: boolean;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  threadId: string | null;
  accent: BotAccent;
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
  access: AccessLevel;
  /** Empty when the bot has no activity yet. */
  time: string;
  /** Empty when the bot has no message yet. */
  preview: string;
  /** True for a bot made with its whole profile. It skips the first-time questions. */
  madeInFull?: boolean;
}

export function accentForAvatarColor(color: BotAvatarColor): BotAccent {
  const accents: Record<BotAvatarColor, BotAccent> = {
    black: "neutral",
    brown: "coral",
    red: "coral",
    orange: "orange",
    yellow: "orange",
    green: "teal",
    cyan: "teal",
    blue: "blue",
    violet: "violet",
    magenta: "purple",
    gray: "neutral",
  };
  return accents[color];
}

export function accentForBot(id: string): BotAccent {
  const accents: BotAccent[] = ["teal", "orange", "purple", "blue", "violet", "coral"];
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return accents[hash % accents.length] ?? "neutral";
}
