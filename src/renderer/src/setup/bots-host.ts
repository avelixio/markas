import {
  type CreateBotFromDraftResult,
  engineForModel,
  type DispatchTurn as HostDispatchTurn,
  type BotDraft as HostDraft,
  type ImportBotFileResult,
  type LibraryBotSummary,
} from "../../../shared/bot-draft";
import type { AgentModelId } from "../../../shared/ipc";
import { callHost } from "../host-client";
import { t } from "../i18n";
import { describeSchedule } from "../rounds/RoundsPage";
import type {
  BotDraft,
  BotsClient,
  CreateResult,
  DispatchTurn,
  ImportResult,
  ReadyBot,
} from "./bots-client";

// ----- The host speaks its own shapes. These turn them into what the screens use. -----

export function readyFromHost(bot: LibraryBotSummary): ReadyBot {
  return {
    id: bot.id,
    name: bot.name,
    summary: bot.role,
    author: bot.author ?? "",
    category: bot.category ?? "",
    tags: bot.tags,
    sigil: bot.sigil,
  };
}

export function draftFromHost(draft: HostDraft): BotDraft {
  const when = draft.round ? describeSchedule(draft.round.schedule) : "";
  return {
    name: draft.name,
    role: draft.role,
    instructions: draft.instructions,
    sigil: draft.sigil,
    engine: draft.engine ?? (draft.model ? engineForModel(draft.model) : null),
    model: draft.model ?? null,
    access: draft.access,
    folder: "",
    round: draft.round ? { label: draft.round.name ?? when, schedule: when, enabled: true } : null,
    roundSpec: draft.round ?? null,
    tags: draft.tags,
  };
}

/** What the person reviewed, as the host creates it. A round they switched off is left out. */
export function draftToHost(draft: BotDraft, adoptExistingFolder = false): HostDraft {
  const out: HostDraft = {
    name: draft.name.trim(),
    role: draft.role.trim(),
    instructions: draft.instructions,
    sigil: draft.sigil,
    access: draft.access,
    tags: draft.tags,
  };
  if (draft.engine) out.engine = draft.engine;
  if (draft.model) out.model = draft.model as AgentModelId;
  if (draft.folder.trim()) out.folder = draft.folder.trim();
  if (adoptExistingFolder) out.adoptExistingFolder = true;
  if (draft.round?.enabled && draft.roundSpec) out.round = draft.roundSpec;
  return out;
}

export function importFromHost(result: ImportBotFileResult): ImportResult {
  if (result.ok) return { ok: true, draft: draftFromHost(result.draft) };
  // The host's sentence already names the line, so the line is not given a second time.
  return { ok: false, message: result.message, line: null };
}

export function createFromHost(result: CreateBotFromDraftResult): CreateResult {
  if (result.ok) return { ok: true, botId: result.bot.id, testRun: { state: "skipped" } };
  return {
    ok: false,
    reason: "folder-in-use",
    folder: result.folder,
    suggestedFolder: result.suggestedFolder ?? result.folder,
  };
}

type FirstRun = { state: "passed" } | { state: "failed"; message: string };

/**
 * The bot's first run: it is asked to say hello, so the person sees it answer.
 * The message waits in the bot's queue. A bot that cannot take it still exists.
 */
async function sayHello(botId: string): Promise<FirstRun> {
  try {
    await callHost("agent.sendMessage", { botId, text: t("review.hello.message") });
    return { state: "passed" };
  } catch (error) {
    return { state: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Dispatch's turn as the screens show it: each proposed draft in the review screen's shape. */
export function dispatchFromHost(turn: HostDispatchTurn): DispatchTurn {
  const messages = turn.messages.map(({ draft, ...message }) =>
    draft ? { ...message, draft: draftFromHost(draft) } : message,
  );
  return turn.ok ? { ok: true, messages } : { ...turn, messages };
}

const dispatch = async (method: string, input?: unknown): Promise<DispatchTurn> =>
  dispatchFromHost(await callHost<HostDispatchTurn>(method, input));

/** The bot steps of setup, served by the Markas host. */
export const botsClient: BotsClient = {
  listReady: async () => (await callHost<LibraryBotSummary[]>("library.list")).map(readyFromHost),
  readReady: async (id) => draftFromHost(await callHost<HostDraft>("library.read", id)),
  importFile: async (name, text) =>
    importFromHost(
      await callHost<ImportBotFileResult>("library.importFile", { text, fileName: name }),
    ),
  openDispatch: () => dispatch("dispatch.open"),
  sayToDispatch: (text) => dispatch("dispatch.say", { text }),
  redraft: () => dispatch("dispatch.redraft"),
  moveDispatch: (engine) => dispatch("dispatch.move", { engine }),
  repairFile: async (name, text) =>
    importFromHost(
      await callHost<ImportBotFileResult>("dispatch.repairFile", { text, fileName: name }),
    ),
  create: async (draft, options) => {
    const created = createFromHost(
      await callHost<CreateBotFromDraftResult>(
        "agent.createBotFromDraft",
        draftToHost(draft, options?.adoptExistingFolder),
      ),
    );
    if (!created.ok || options?.skipTestRun) return created;
    return { ...created, testRun: await sayHello(created.botId) };
  },
  runTest: sayHello,
};
