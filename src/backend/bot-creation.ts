import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  type BotDraft,
  type BotFolderPreview,
  type CreateBotFromDraftResult,
  sigilToAvatar,
} from "../shared/bot-draft";
import { slugify } from "../shared/bot-file";
import type { AgentService } from "./agent-service";
import type { BotStore } from "./bot-store";
import type { RoundsStore } from "./rounds/rounds-store";

/**
 * Makes a bot from a draft, all of it or none of it.
 * The folder, the bot and its round are created in that order, and whatever was created is
 * taken back if a later step fails. A folder that already has files in it is never written over.
 */
export class BotCreator {
  readonly #store: BotStore;
  readonly #service: Pick<AgentService, "createBotFromProfile">;
  readonly #rounds: Pick<RoundsStore, "create">;
  /** Creations run one at a time, so two of them can never claim the same folder. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    store: BotStore,
    service: Pick<AgentService, "createBotFromProfile">,
    rounds: Pick<RoundsStore, "create">,
  ) {
    this.#store = store;
    this.#service = service;
    this.#rounds = rounds;
  }

  /** Where a bot with this name would live, and whether that folder is free. */
  async previewFolder(name: string, folder?: string): Promise<BotFolderPreview> {
    const target = folder
      ? await this.#customFolder(folder)
      : join(await canonical(this.#store.botsRoot), slugify(name));
    const owners = await this.#botFolders();
    const usedByBot = owners.find((owner) => overlaps(owner.folder, target))?.name ?? null;
    const hasFiles = (await folderState(target)) === "has-files";
    if (!usedByBot && !hasFiles) {
      return {
        folder: target,
        inUse: false,
        usedByBot: null,
        canAdopt: false,
        suggestedName: null,
        suggestedFolder: null,
      };
    }
    const suggestedFolder = await freeSibling(target, owners);
    return {
      folder: target,
      inUse: true,
      usedByBot,
      canAdopt: !usedByBot,
      suggestedName: basename(suggestedFolder),
      suggestedFolder,
    };
  }

  /** Expects a draft the person has reviewed; see `parseBotDraft` with `reviewed`. */
  create(draft: BotDraft): Promise<CreateBotFromDraftResult> {
    const run = this.#queue.then(() => this.#create(draft));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #create(draft: BotDraft): Promise<CreateBotFromDraftResult> {
    const plan = await this.previewFolder(draft.name, draft.folder);
    if (plan.usedByBot || (plan.inUse && !draft.adoptExistingFolder)) {
      return { ok: false, reason: "folder-in-use", message: folderInUseMessage(plan), ...plan };
    }

    // The topmost folder that does not exist yet is exactly what to take back on failure.
    const firstMade = await firstMissing(plan.folder);
    await mkdir(plan.folder, { recursive: true, mode: 0o700 });
    try {
      let round: { id: string; name: string } | null = null;
      const bot = await this.#service.createBotFromProfile(
        {
          name: draft.name,
          role: draft.role,
          description: draft.instructions,
          ...sigilToAvatar(draft.sigil),
          access: draft.access,
          engine: draft.engine,
          model: draft.model,
          workspacePath: plan.folder,
        },
        async (created) => {
          if (!draft.round) return;
          const made = await this.#rounds.create({
            name: draft.round.name ?? `${created.name} round`,
            botId: created.id,
            instruction: draft.round.instruction,
            schedule: draft.round.schedule,
          });
          round = { id: made.id, name: made.name };
        },
      );
      return { ok: true, bot, round };
    } catch (error) {
      await removeMadeFolders(plan.folder, firstMade);
      throw error;
    }
  }

  /** A folder the person chose, refused when it would overlap Markas's own files. */
  async #customFolder(folder: string): Promise<string> {
    if (!isAbsolute(folder)) {
      throw new Error("Give the bot's folder as a full path, starting from the drive or the root.");
    }
    const target = await canonical(folder);
    const botsRoot = await canonical(this.#store.botsRoot);
    if (isInside(target, botsRoot)) return target;
    const reserved = await Promise.all(
      [this.#store.dataRoot, this.#store.sharedRoot, this.#store.downloadsRoot, botsRoot].map(
        canonical,
      ),
    );
    if (reserved.some((root) => overlaps(root, target))) {
      throw new Error(
        "Markas keeps its own files there, so a bot cannot have that folder. Choose another one.",
      );
    }
    return target;
  }

  async #botFolders(): Promise<Array<{ name: string; folder: string }>> {
    return Promise.all(
      this.#store
        .list()
        .map(async (bot) => ({ name: bot.name, folder: await canonical(bot.workspacePath) })),
    );
  }
}

function folderInUseMessage(plan: BotFolderPreview): string {
  if (plan.usedByBot) {
    return `${plan.folder} is already the folder of ${plan.usedByBot}. Every bot gets its own folder: use ${plan.suggestedName} or choose another one.`;
  }
  return `${plan.folder} already exists and has files in it. Markas never writes over a folder: use ${plan.suggestedName}, choose another folder, or adopt this one if it is this bot's old folder.`;
}

/** The first free folder beside one that is taken: scout, then scout-2, scout-3 and so on. */
async function freeSibling(
  taken: string,
  owners: Array<{ name: string; folder: string }>,
): Promise<string> {
  const parent = dirname(taken);
  const base = basename(taken).replace(/-\d+$/, "") || "bot";
  for (let number = 2; number <= 200; number += 1) {
    const candidate = join(parent, `${base}-${number}`);
    if (owners.some((owner) => overlaps(owner.folder, candidate))) continue;
    if ((await folderState(candidate).catch(() => "has-files")) !== "has-files") return candidate;
  }
  return join(parent, `${base}-${randomUUID().slice(0, 8)}`);
}

async function folderState(path: string): Promise<"missing" | "empty" | "has-files"> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw error;
  }
  if (!entry.isDirectory()) throw new Error(`${path} is a file, not a folder. Choose a folder.`);
  return (await readdir(path)).length === 0 ? "empty" : "has-files";
}

/** The highest folder on the way to `path` that does not exist yet, or undefined when all do. */
async function firstMissing(path: string): Promise<string | undefined> {
  let missing: string | undefined;
  let current = resolve(path);
  for (;;) {
    try {
      await lstat(current);
      return missing;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    missing = current;
    const parent = dirname(current);
    if (parent === current) return missing;
    current = parent;
  }
}

/** Removes the folders one creation made, deepest first. A folder with anything in it is kept. */
async function removeMadeFolders(folder: string, firstMade: string | undefined): Promise<void> {
  if (!firstMade) return;
  const stop = resolve(firstMade);
  let current = resolve(folder);
  for (;;) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    if (samePath(current, stop)) return;
    const parent = dirname(current);
    if (parent === current || !isInside(current, stop)) return;
    current = parent;
  }
}

/** The path with links followed as far as it exists, so a link cannot hide where it leads. */
async function canonical(path: string): Promise<string> {
  const full = resolve(path);
  const missing: string[] = [];
  let current = full;
  for (;;) {
    try {
      return join(await realpath(current), ...missing.reverse());
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) return full;
      missing.push(basename(current));
      current = parent;
    }
  }
}

const fold = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
const samePath = (a: string, b: string) => fold(a) === fold(b);

/** True when `child` is somewhere below `parent`. */
function isInside(child: string, parent: string): boolean {
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return fold(child).startsWith(fold(prefix));
}

/** True when two folders are the same, or one holds the other. */
function overlaps(a: string, b: string): boolean {
  return samePath(a, b) || isInside(a, b) || isInside(b, a);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
