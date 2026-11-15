import type { BotCreator } from "../backend/bot-creation";
import { type BotLibrary, importBotFileText, readBotFile } from "../backend/library/bot-library";
import type { Round } from "../backend/rounds/rounds-store";
import {
  avatarToSigil,
  BOT_DRAFT_LIMITS,
  type BotDraft,
  type CreateBotFromDraftResult,
  type ExportBotResult,
  type ImportBotFileResult,
  oneLine,
  parseBotDraft,
} from "../shared/bot-draft";
import { botFileName, parseBotFile, serializeBotFile } from "../shared/bot-file";
import type { BotSummary } from "../shared/ipc";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";

export interface LibraryContext {
  library: BotLibrary;
  listBots: () => BotSummary[];
  listRounds: () => Round[];
}

/**
 * Ready-made bots and bot files, for the person adding or sharing a bot in the web UI.
 * A bot file is only ever read as data, and an export holds the bot's profile and nothing else:
 * no keys, no conversation, no folder path.
 */
export function createLibraryMethods(context: LibraryContext): Record<string, HostMethod> {
  return {
    "library.list": () => context.library.list(),
    "library.read": (id) => context.library.read(requireString(id, "id")),
    "library.importFile": (input): ImportBotFileResult | Promise<ImportBotFileResult> => {
      if (!isObject(input)) throw new Error("Send a bot file's text or its path.");
      const hasText = typeof input.text === "string";
      const hasPath = typeof input.path === "string" && input.path.trim() !== "";
      if (hasText === hasPath) throw new Error("Send a bot file's text or its path, not both.");
      if (hasPath) return readBotFile((input.path as string).trim());
      const fileName = oneLine(input.fileName).slice(0, 200) || null;
      return importBotFileText(input.text as string, fileName);
    },
    "library.exportBot": (botId): ExportBotResult => {
      const id = requireString(botId, "botId");
      const bot = context.listBots().find((candidate) => candidate.id === id);
      if (!bot) throw new Error("That bot no longer exists.");
      return exportBot(bot, context.listRounds());
    },
  };
}

/** Creating a bot from a draft the person has reviewed. */
export function createBotDraftMethods(creator: BotCreator): Record<string, HostMethod> {
  return {
    "agent.createBotFromDraft": (input): Promise<CreateBotFromDraftResult> => {
      const parsed = parseBotDraft(input, { reviewed: true });
      if (!parsed.ok) throw new Error(parsed.problem);
      return creator.create(parsed.draft);
    },
    "agent.previewBotFolder": (input) => {
      if (!isObject(input)) throw new Error("Send the bot's name.");
      const name = oneLine(input.name);
      if (!name) throw new Error("The bot needs a name first.");
      if (input.folder !== undefined && typeof input.folder !== "string") {
        throw new Error("The folder is not text.");
      }
      return creator.previewFolder(name, input.folder?.trim() || undefined);
    },
  };
}

/** A bot as a bot file. Only the bot's profile and its first repeating round go in. */
function exportBot(bot: BotSummary, rounds: Round[]): ExportBotResult {
  const name = oneLine(bot.name).slice(0, BOT_DRAFT_LIMITS.name).trim();
  const role = oneLine(bot.role).slice(0, BOT_DRAFT_LIMITS.role).trim();
  if (!role || !bot.description.trim()) {
    throw new Error(
      `Give ${bot.name} a role and instructions first, so the file is useful to the next person.`,
    );
  }
  const draft: BotDraft = {
    name,
    role,
    instructions: bot.description.slice(0, BOT_DRAFT_LIMITS.instructions),
    sigil: avatarToSigil(bot.avatarShape, bot.avatarColor),
    model: bot.model,
    access: bot.access,
    tags: [],
  };
  const round = rounds.find(
    (candidate) => candidate.botId === bot.id && candidate.schedule.kind !== "once",
  );
  const instruction = round
    ? oneLine(round.instruction).slice(0, BOT_DRAFT_LIMITS.roundInstruction).trim()
    : "";
  if (round && instruction) {
    draft.round = { name: round.name, instruction, schedule: round.schedule };
  }
  const text = serializeBotFile(draft);
  // An export that could not be imported again would be a broken promise, so it is checked.
  const check = parseBotFile(text);
  if (!check.ok) {
    throw new Error(`${bot.name} cannot be saved as a bot file: ${check.problems[0]?.message}.`);
  }
  return { fileName: botFileName(name), text };
}
