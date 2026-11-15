import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  type BotDraft,
  type ImportBotFileResult,
  type LibraryBotSummary,
  roundCadence,
} from "../../shared/bot-draft";
import {
  BOT_FILE_EXTENSION,
  BOT_FILE_MAX_BYTES,
  botFileTooLarge,
  parseBotFile,
} from "../../shared/bot-file";

/** A library never lists more files than this, however many are in the folder. */
const LIBRARY_MAX_FILES = 500;
const LIBRARY_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The ready-made bots: the bot files in the `bots/` folder that ships with Markas.
 * Files are read fresh each time and only ever parsed as data.
 */
export class BotLibrary {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  /** Every ready-made bot that parses, by name. A file that does not parse is left out. */
  async list(): Promise<LibraryBotSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.#root);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const ids = names
      .filter((name) => name.endsWith(BOT_FILE_EXTENSION))
      .map((name) => name.slice(0, -BOT_FILE_EXTENSION.length))
      .filter((id) => LIBRARY_ID.test(id))
      .sort()
      .slice(0, LIBRARY_MAX_FILES);
    const summaries: LibraryBotSummary[] = [];
    for (const id of ids) {
      // One bad file must not hide the others.
      const result = await readBotFile(this.#path(id)).catch((error: unknown) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }));
      if (result.ok) summaries.push(summarize(id, result.draft));
      else console.error(`Ready-made bot ${id} was left out: ${result.message}`);
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** One ready-made bot as a draft, ready for the review screen. */
  async read(id: string): Promise<BotDraft> {
    if (!LIBRARY_ID.test(id)) throw new Error("That is not a ready-made bot.");
    const result = await readBotFile(this.#path(id)).catch((error: unknown) => {
      if (isMissing(error)) throw new Error("That ready-made bot is no longer there.");
      throw error;
    });
    if (!result.ok) throw new Error(`${result.fileName} cannot be used: ${result.message}`);
    return result.draft;
  }

  #path(id: string): string {
    return join(this.#root, `${id}${BOT_FILE_EXTENSION}`);
  }
}

/** Reads a bot file's text into a draft, or into the problems that stop it. */
export function importBotFileText(text: string, fileName: string | null): ImportBotFileResult {
  const parsed = parseBotFile(text);
  if (parsed.ok) return { ok: true, fileName, draft: parsed.draft };
  return {
    ok: false,
    fileName,
    message: parsed.problems[0]?.message ?? "The file could not be read.",
    problems: parsed.problems,
  };
}

/**
 * Reads a bot file from this computer.
 * Only a regular file with a bot file's name and size is opened, so this cannot be used to
 * read some other file.
 */
export async function readBotFile(path: string): Promise<ImportBotFileResult> {
  if (!isAbsolute(path)) throw new Error("Give the bot file as a full path.");
  const fileName = basename(path);
  if (!fileName.toLowerCase().endsWith(".md")) {
    throw new Error("A bot file's name ends in .bot.md.");
  }
  const entry = await lstat(path);
  if (!entry.isFile()) throw new Error(`${fileName} is not a file.`);
  if (entry.size > BOT_FILE_MAX_BYTES) {
    const problem = botFileTooLarge();
    return { ok: false, fileName, message: problem.message, problems: [problem] };
  }
  return importBotFileText(await readFile(path, "utf8"), fileName);
}

function summarize(id: string, draft: BotDraft): LibraryBotSummary {
  return {
    id,
    name: draft.name,
    role: draft.role,
    sigil: draft.sigil,
    tags: draft.tags,
    category: draft.category ?? null,
    author: draft.author ?? null,
    engine: draft.engine ?? null,
    access: draft.access,
    roundCadence: draft.round ? roundCadence(draft.round.schedule) : null,
  };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
