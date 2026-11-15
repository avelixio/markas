import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type AccessLevel, DEFAULT_ACCESS, isAccessLevel } from "../shared/access";
import { BOT_DRAFT_LIMITS } from "../shared/bot-draft";
import {
  type AgentModelId,
  type AgentReasoningEffort,
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  type BotAvatarColor,
  type BotAvatarShape,
  type BotSummary,
  isAgentModel,
  isAvatarColor,
  isAvatarShape,
  isClaudeModel,
  isReasoningEffort,
  type UpdateBotInput,
} from "../shared/ipc";
import { isRecord } from "./protocol";

type StoredBot = BotSummary;

/** A deleted bot, off the roster but not yet gone. */
export interface TrashedBot {
  bot: StoredBot;
  deletedAt: string;
}

interface StoredState {
  version: 1;
  examplesInitialized: boolean;
  bots: StoredBot[];
  /** Deleted bots that can still be put back. Files saved before the trash existed have none. */
  trash: TrashedBot[];
}

export const DEFAULT_AGENT_MODEL: AgentModelId = "gpt-5.6-luna";
export const DEFAULT_REASONING_EFFORT: AgentReasoningEffort = "medium";
/** A bot's instructions are stored as its description, so both share one limit. */
const DESCRIPTION_MAX = BOT_DRAFT_LIMITS.instructions;

/** Everything a new bot starts with when it is made from a draft. */
export interface NewBotProfile {
  name: string;
  role: string;
  description: string;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
  access: AccessLevel;
  /** The bot's own folder. Left out, it goes under the bots folder, named after the bot's id. */
  workspacePath?: string;
}

export class BotStore {
  readonly #dataRoot: string;
  readonly #statePath: string;
  readonly #botsRoot: string;
  readonly #sharedRoot: string;
  readonly #downloadsRoot: string;
  #state: StoredState = { version: 1, examplesInitialized: false, bots: [], trash: [] };
  #writeQueue: Promise<void> = Promise.resolve();

  /**
   * @param userDataPath where host state files live
   * @param workspaceRoot parent of every bot home, the shared folder and downloads
   */
  constructor(userDataPath: string, workspaceRoot: string) {
    this.#dataRoot = userDataPath;
    this.#statePath = join(userDataPath, "bots.json");
    this.#botsRoot = join(workspaceRoot, "bots");
    this.#sharedRoot = join(workspaceRoot, "shared");
    this.#downloadsRoot = join(workspaceRoot, "downloads");
  }

  /** Where Markas keeps its own state, including the sign-in token and the keyring. */
  get dataRoot(): string {
    return this.#dataRoot;
  }

  get sharedRoot(): string {
    return this.#sharedRoot;
  }

  get downloadsRoot(): string {
    return this.#downloadsRoot;
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.#botsRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.#sharedRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.#downloadsRoot, { recursive: true, mode: 0o700 }),
      mkdir(dirname(this.#statePath), { recursive: true, mode: 0o700 }),
    ]);

    this.#state = await this.#readState();
    if (!this.#state.examplesInitialized) {
      this.#state.examplesInitialized = true;
    }
    await this.#persist();
  }

  list(): BotSummary[] {
    return this.#state.bots.map((bot) => ({ ...bot }));
  }

  /** Where bot folders go unless the person chose another place. */
  get botsRoot(): string {
    return this.#botsRoot;
  }

  /**
   * Creates a bot: a blank one, or one with a finished profile.
   * If saving fails the bot is taken out again, so memory and disk agree.
   */
  async createBot(profile?: NewBotProfile): Promise<BotSummary> {
    const record = this.#createRecord(`bot-${randomUUID()}`, "New bot", "New teammate");
    if (profile) {
      Object.assign(record, {
        name: requiredText(profile.name, "Bot name", 80),
        role: profile.role.trim().slice(0, 120),
        description: profile.description.trim().slice(0, DESCRIPTION_MAX),
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        avatarShape: profile.avatarShape,
        avatarColor: profile.avatarColor,
        access: profile.access,
        workspacePath: profile.workspacePath ?? record.workspacePath,
        madeInFull: true,
      } satisfies Partial<StoredBot>);
    }
    this.#state.bots.unshift(record);
    try {
      await mkdir(record.workspacePath, { recursive: true, mode: 0o700 });
      await this.#persist();
    } catch (error) {
      this.#state.bots = this.#state.bots.filter((bot) => bot !== record);
      throw error;
    }
    return { ...record };
  }

  async updateBot(input: UpdateBotInput): Promise<BotSummary> {
    const bot = this.#requireBot(input.botId);
    if (input.name !== undefined) bot.name = requiredText(input.name, "Agent name", 80);
    if (input.role !== undefined) bot.role = input.role.trim().slice(0, 120);
    if (input.description !== undefined) {
      bot.description = input.description.trim().slice(0, DESCRIPTION_MAX);
    }
    if (input.notifications !== undefined) bot.notifications = input.notifications;
    if (input.model !== undefined) {
      if (isClaudeModel(input.model) !== isClaudeModel(bot.model)) bot.threadId = null;
      bot.model = input.model;
    }
    if (input.reasoningEffort !== undefined) bot.reasoningEffort = input.reasoningEffort;
    if (input.avatarShape !== undefined) bot.avatarShape = input.avatarShape;
    if (input.avatarColor !== undefined) bot.avatarColor = input.avatarColor;
    if (input.access !== undefined) bot.access = input.access;
    bot.updatedAt = new Date().toISOString();
    await this.#persist();
    return { ...bot };
  }

  async deleteBot(id: string): Promise<BotSummary> {
    const bot = this.#requireBot(id);
    this.#state.bots = this.#state.bots.filter((candidate) => candidate.id !== id);
    await this.#persist();
    return { ...bot };
  }

  /** Deleted bots that can still be put back, the newest delete first. */
  listTrash(): TrashedBot[] {
    return this.#state.trash.map((entry) => ({ ...entry, bot: { ...entry.bot } }));
  }

  /**
   * Takes a bot off the roster and keeps it in the trash.
   * Nothing the bot had is touched, so putting it back needs no repair.
   */
  async trashBot(id: string, now: Date = new Date()): Promise<BotSummary> {
    const bot = this.#requireBot(id);
    const previous = { bots: this.#state.bots, trash: this.#state.trash };
    this.#state.bots = this.#state.bots.filter((candidate) => candidate.id !== id);
    this.#state.trash = [{ bot, deletedAt: now.toISOString() }, ...this.#state.trash];
    await this.#persistOrUndo(previous);
    return { ...bot };
  }

  /** Puts a deleted bot back on the roster. */
  async restoreBot(id: string): Promise<BotSummary> {
    const entry = this.#requireTrashed(id);
    const previous = { bots: this.#state.bots, trash: this.#state.trash };
    this.#state.trash = this.#state.trash.filter((candidate) => candidate !== entry);
    this.#state.bots = [entry.bot, ...this.#state.bots];
    await this.#persistOrUndo(previous);
    return { ...entry.bot };
  }

  /** Drops a deleted bot from the trash. After this it cannot be put back. */
  async purgeTrashed(id: string): Promise<BotSummary> {
    const entry = this.#requireTrashed(id);
    const previous = { bots: this.#state.bots, trash: this.#state.trash };
    this.#state.trash = this.#state.trash.filter((candidate) => candidate !== entry);
    await this.#persistOrUndo(previous);
    return { ...entry.bot };
  }

  async getOrCreate(id: string, name?: string, role?: string): Promise<BotSummary> {
    validateBotId(id);
    // A message for a deleted bot must not quietly make a second bot with the same id.
    if (this.#state.trash.some((entry) => entry.bot.id === id)) {
      throw new Error("That bot was deleted. Restore it in Settings to use it again.");
    }
    const existing = this.#state.bots.find((bot) => bot.id === id);
    if (existing) {
      await mkdir(existing.workspacePath, { recursive: true, mode: 0o700 });
      return { ...existing };
    }

    const record = this.#createRecord(id, name ?? titleFromId(id), role ?? "Local teammate");
    this.#state.bots.push(record);
    await mkdir(record.workspacePath, { recursive: true, mode: 0o700 });
    await this.#persist();
    return { ...record };
  }

  async setThreadId(id: string, threadId: string): Promise<void> {
    const bot = this.#requireBot(id);
    bot.threadId = threadId;
    bot.updatedAt = new Date().toISOString();
    await this.#persist();
  }

  async updatePreview(id: string, preview: string): Promise<void> {
    const bot = this.#requireBot(id);
    bot.preview = preview.slice(0, 180);
    bot.updatedAt = new Date().toISOString();
    await this.#persist();
  }

  async #readState(): Promise<StoredState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#statePath, "utf8"));
      if (
        !isRecord(parsed) ||
        parsed.version !== 1 ||
        typeof parsed.examplesInitialized !== "boolean" ||
        !Array.isArray(parsed.bots) ||
        !parsed.bots.every(isStoredBot)
      ) {
        throw new Error(
          "Agent state is corrupt or from a newer Markas version; refusing to overwrite it.",
        );
      }

      const storedTrash: unknown = parsed.trash ?? [];
      if (!Array.isArray(storedTrash) || !storedTrash.every(isTrashedBot)) {
        throw new Error(
          "Agent state is corrupt or from a newer Markas version; refusing to overwrite it.",
        );
      }

      // Bots saved before access levels existed start at the careful default.
      const withAccess = (bot: StoredBot): StoredBot => ({
        ...bot,
        access: isAccessLevel(bot.access) ? bot.access : DEFAULT_ACCESS,
      });
      const bots = parsed.bots.map(withAccess);
      const trash = storedTrash.map((entry) => ({
        bot: withAccess(entry.bot),
        deletedAt: entry.deletedAt,
      }));
      const ids = [...bots, ...trash.map((entry) => entry.bot)].map((bot) => bot.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Agent state contains duplicate bot ids; refusing to overwrite it.");
      }
      return { version: 1, examplesInitialized: parsed.examplesInitialized, bots, trash };
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        return { version: 1, examplesInitialized: false, bots: [], trash: [] };
      }
      throw error;
    }
  }

  async #persist(): Promise<void> {
    const serialized = `${JSON.stringify(this.#state, null, 2)}\n`;
    const temporaryPath = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;

    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, this.#statePath);
      });
    await this.#writeQueue;
  }

  #createRecord(id: string, name: string, role: string, description = ""): StoredBot {
    validateBotId(id);
    return {
      id,
      name,
      role,
      description,
      notifications: true,
      model: DEFAULT_AGENT_MODEL,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
      threadId: null,
      workspacePath: join(this.#botsRoot, id),
      preview: "No messages yet",
      updatedAt: null,
      avatarShape: defaultAvatarShape(id),
      avatarColor: defaultAvatarColor(id),
      access: DEFAULT_ACCESS,
    };
  }

  #requireBot(id: string): StoredBot {
    const bot = this.#state.bots.find((candidate) => candidate.id === id);
    if (!bot) throw new Error(`Unknown bot: ${id}`);
    return bot;
  }

  #requireTrashed(id: string): TrashedBot {
    const entry = this.#state.trash.find((candidate) => candidate.bot.id === id);
    if (!entry) throw new Error("That bot is not among the deleted bots.");
    return entry;
  }

  /** Saves, and on failure puts memory back as it was so memory and disk agree. */
  async #persistOrUndo(previous: { bots: StoredBot[]; trash: TrashedBot[] }): Promise<void> {
    try {
      await this.#persist();
    } catch (error) {
      this.#state.bots = previous.bots;
      this.#state.trash = previous.trash;
      throw error;
    }
  }
}

function requiredText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed.slice(0, maxLength);
}

function isTrashedBot(value: unknown): value is TrashedBot {
  return (
    isRecord(value) &&
    isStoredBot(value.bot) &&
    typeof value.deletedAt === "string" &&
    !Number.isNaN(Date.parse(value.deletedAt))
  );
}

function validateBotId(id: string): void {
  if (!isValidBotId(id)) {
    throw new Error("Invalid bot id.");
  }
}

function isValidBotId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && basename(id) === id;
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isStoredBot(value: unknown): value is StoredBot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isValidBotId(value.id) &&
    typeof value.name === "string" &&
    typeof value.role === "string" &&
    typeof value.description === "string" &&
    typeof value.notifications === "boolean" &&
    isAgentModel(value.model) &&
    isReasoningEffort(value.reasoningEffort) &&
    (typeof value.threadId === "string" || value.threadId === null) &&
    typeof value.workspacePath === "string" &&
    typeof value.preview === "string" &&
    (typeof value.updatedAt === "string" || value.updatedAt === null) &&
    isAvatarShape(value.avatarShape) &&
    isAvatarColor(value.avatarColor)
  );
}

function avatarIndex(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function defaultAvatarShape(id: string): BotAvatarShape {
  return BOT_AVATAR_SHAPES[avatarIndex(id) % BOT_AVATAR_SHAPES.length] ?? "blob";
}

function defaultAvatarColor(id: string): BotAvatarColor {
  return BOT_AVATAR_COLORS[avatarIndex(`${id}:color`) % BOT_AVATAR_COLORS.length] ?? "orange";
}
