import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import {
  type AgentClientFactory,
  AgentService,
  createInstalledCliClient,
} from "../backend/agent-service";
import { BotCreator } from "../backend/bot-creation";
import { BotStore } from "../backend/bot-store";
import type { BrowserService } from "../backend/browser-tools";
import { preferCliPath, resolveClaudeCli, resolveCodexCli } from "../backend/cli";
import { DispatchService } from "../backend/dispatch/dispatch-service";
import { type MasterKeyStore, resolveMasterKeyStore } from "../backend/keyring/key-store";
import { KeyringStore } from "../backend/keyring/keyring-store";
import { BotLibrary } from "../backend/library/bot-library";
import { LogbookStore } from "../backend/logbook/logbook-store";
import { MailboxStore } from "../backend/mailbox-store";
import { findCommandFilter } from "../backend/optimizer/command-filter";
import { OptimizerStore } from "../backend/optimizer/optimizer-store";
import { RoomsStore } from "../backend/rooms/rooms-store";
import { RoundsStore } from "../backend/rounds/rounds-store";
import { RoundsScheduler } from "../backend/rounds/scheduler";
import { ENGINE_NAMES } from "../backend/setup/engine-install";
import { EngineSetup } from "../backend/setup/engine-setup";
import { NodeProcessRunner, type ProcessRunner } from "../backend/setup/process-runner";
import { isRecord } from "../shared/bot-draft";
import type { AgentProviderId, SetupState } from "../shared/ipc";
import { isClaudeModel } from "../shared/ipc";
import { CHARS_PER_TOKEN } from "../shared/optimizer";
import { AgentInitializationGate } from "./agent-initialization";
import { createBrowserMethods, createBrowserService } from "./browser-methods";
import { createDispatchMethods } from "./dispatch-methods";
import { EventHub } from "./event-hub";
import { createFilesMethods } from "./files-methods";
import { createFuelMethods } from "./fuel-methods";
import { createHostHandler } from "./handler";
import { createBotKeyTools, createKeyringMethods } from "./keyring-methods";
import { createBotDraftMethods, createLibraryMethods } from "./library-methods";
import { withLogbook } from "./logbook-methods";
import {
  createHostMethods,
  type HostContext,
  type HostMethod,
  importAttachments,
  openWithOperatingSystem,
} from "./methods";
import { createOptimizerMethods } from "./optimizer-methods";
import { requireString } from "./parsers";
import { type HostPaths, resolveHostPaths, resolvePort } from "./paths";
import { createRoomsMethods } from "./rooms-methods";
import { createRoundsMethods, followRounds } from "./rounds-methods";
import { resolveLibraryRoot, resolveUiRoot } from "./runtime";
import { createSetupMethods } from "./setup-methods";
import { SetupStore } from "./setup-store";
import { ensureToken } from "./token";

export const APP_NAME = "Markas";
export const APP_VERSION: string = packageJson.version;
const REQUEST_TIMEOUT_MS = 30_000;

export interface RunningHost {
  port: number;
  url: string;
  paths: HostPaths;
  stop(): Promise<void>;
}

export interface HostRecord {
  port: number;
  pid: number;
  startedAt: string;
  version: string;
}

/** Starts the Markas host: stores, agent service, HTTP API, event stream and web UI. */
export interface StartHostOptions {
  /** Replaces the installed engine CLIs; the end-to-end test injects an in-process engine. */
  createClient?: AgentClientFactory;
  /** Replaces the operating system's secret store; tests use an in-memory one. */
  masterKeyStore?: MasterKeyStore;
  /** Replaces the bot browser; tests use one that drives no real browser. */
  browser?: BrowserService;
  /** Replaces how setup starts installers and sign-ins; tests use one that starts nothing. */
  processRunner?: ProcessRunner;
}

export async function startHost(
  env: NodeJS.ProcessEnv = process.env,
  options: StartHostOptions = {},
): Promise<RunningHost> {
  const paths = resolveHostPaths(env);
  const port = resolvePort(env);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const token = await ensureToken(paths.tokenFile);

  const store = new BotStore(paths.root, paths.root);
  await store.initialize();
  const mailbox = new MailboxStore(paths.root, store.sharedRoot);
  await mailbox.initialize();
  const keyring = new KeyringStore(
    paths.root,
    options.masterKeyStore ?? resolveMasterKeyStore(paths.root),
  );
  // A keyring that cannot open must not stop the host: bots still work without saved keys.
  const keyringProblem = await keyring.initialize().then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  if (keyringProblem) console.error(`The keyring could not be opened: ${keyringProblem}`);
  const logbook = new LogbookStore(paths.root);
  await logbook.initialize();
  const optimizer = new OptimizerStore(paths.root);
  await optimizer.initialize();
  const browser =
    options.browser ??
    (await createBrowserService(paths, env, undefined, (botId, cutCharacters) =>
      // A page cut before the bot read it is counted in characters, so the tokens are a rough figure.
      optimizer.record("trim", botId, cutCharacters / CHARS_PER_TOKEN),
    ));
  const setupStore = new SetupStore(paths.setupFile);
  const setup = await setupStore.read();
  // Programs the person pointed Markas at are looked at before the usual places.
  const enginePaths: Partial<Record<AgentProviderId, string>> = { ...setup.enginePaths };
  for (const [engine, path] of Object.entries(enginePaths)) {
    preferCliPath(engine as AgentProviderId, path);
  }
  const service = new AgentService(
    store,
    mailbox,
    browser,
    null,
    REQUEST_TIMEOUT_MS,
    setup.preferredProvider ?? "codex",
    options.createClient,
  );
  service.useOptimizer({
    settings: () => optimizer.settings(),
    compacted: (botId, before, after) => optimizer.record("compact", botId, before - after),
  });
  service.useKeys(
    createBotKeyTools({
      keyring: keyringProblem ? null : keyring,
      // A sign-in from the Keyring is typed into the bot's own browser tab.
      filler: browser.secretFiller(),
      logbook,
      botName: (id) => service.listBots().find((bot) => bot.id === id)?.name ?? "A bot",
    }),
  );

  const events = new EventHub();
  /** New bots start with the model setup chose, when it chose one. */
  const applyBotDefaults = (state: SetupState) =>
    service.setBotDefaults(
      state.defaultModel
        ? {
            model: state.defaultModel,
            reasoningEffort:
              state.defaultReasoningEffort ??
              service.listModels().find((model) => model.id === state.defaultModel)
                ?.defaultReasoningEffort ??
              "medium",
          }
        : null,
    );
  applyBotDefaults(setup);
  /** What setup remembers now, kept current as the person changes it. */
  let setupNow = setup;
  const dispatchRoot = join(paths.root, "dispatch");
  await mkdir(dispatchRoot, { recursive: true, mode: 0o700 });
  const dispatch = new DispatchService({
    createClient: async (provider) =>
      (await (options.createClient ?? createInstalledCliClient)(provider, REQUEST_TIMEOUT_MS))
        .client,
    engines: () => {
      const ready = (service.getStatus().providers ?? [])
        .filter((provider) => provider.state === "available")
        .map((provider) => provider.id);
      const preferred = setupNow.preferredProvider;
      return preferred && ready.includes(preferred)
        ? [preferred, ...ready.filter((engine) => engine !== preferred)]
        : ready;
    },
    model: (engine) => {
      const models = service.modelsFor(engine).models;
      const chosen =
        models.find((model) => model.id === setupNow.defaultModel) ?? models[0] ?? null;
      if (!chosen) return null;
      const effort =
        chosen.id === setupNow.defaultModel && setupNow.defaultReasoningEffort
          ? setupNow.defaultReasoningEffort
          : chosen.defaultReasoningEffort;
      return { model: chosen.id, effort };
    },
    context: () => ({
      existingBotNames: service.listBots().map((bot) => bot.name),
      interfaceLanguage: setupNow.language ?? "en",
    }),
    workspace: dispatchRoot,
    protectedRoot: paths.root,
  });
  const engineSetup = new EngineSetup({
    runner: options.processRunner ?? new NodeProcessRunner(),
    probe: {
      check: (engine) => service.checkProvider(engine),
      executable: async (engine) =>
        (engine === "claude" ? await resolveClaudeCli() : await resolveCodexCli()).executable,
      models: (engine) => service.modelsFor(engine),
      prefer: preferCliPath,
    },
    emit: (event) => events.publish({ channel: "setup", payload: event }),
    remember: async (engine, path) => {
      await setupStore.rememberEnginePath(engine, path);
      enginePaths[engine] = path;
    },
    remembered: (engine) => enginePaths[engine] ?? null,
  });
  const rounds = new RoundsStore(paths.root);
  await rounds.initialize();
  const rooms = new RoomsStore(paths.root);
  await rooms.initialize();
  const active = ["queued", "starting", "running"];
  const findBot = (botId: string) => service.listBots().find((bot) => bot.id === botId);
  const botExists = (botId: string) => findBot(botId) !== undefined;
  const botAway = (botId: string) =>
    service.listDeletedBots().some((entry) => entry.bot.id === botId);
  const scheduler = new RoundsScheduler(rounds, {
    deliver: async (botId, text, roundId) => {
      const receipt = await service.sendMessage({ botId, text }, { roundId });
      const delivery = receipt.deliveries[0];
      if (!delivery) throw new Error("The bot's queue did not accept the message.");
      return { deliveryId: delivery.id };
    },
    isBusy: (botId) =>
      service.listQueue(botId).deliveries.some((delivery) => active.includes(delivery.status)),
    botExists,
    botAway,
    deliveryStatus: (deliveryId) => mailbox.getDelivery(deliveryId)?.delivery.status ?? null,
    changed: () => undefined,
  });
  /** Removes a deleted bot and everything it had: messages, keys, rounds, rooms, sign-ins. */
  const purgeBot = async (id: string): Promise<void> => {
    await service.purgeBot(id);
    if (!keyringProblem) await keyring.forgetBot(id);
    await rounds.forgetBot(id);
    await rooms.forgetBot(id);
    optimizer.forgetBot(id);
    // Its sign-ins go with it. A profile that cannot be removed now must not undo the delete.
    await browser.forgetBot(id).catch((error: unknown) => {
      console.error("The deleted bot's browser profile could not be removed:", error);
    });
  };
  /** Empties the trash of every bot whose time to be put back has passed. */
  const sweepTrash = async (): Promise<void> => {
    const now = Date.now();
    for (const entry of service.listDeletedBots()) {
      if (new Date(entry.purgeAt).getTime() > now) continue;
      await purgeBot(entry.bot.id).catch((error: unknown) => {
        console.error("A deleted bot could not be removed for good:", error);
      });
    }
  };
  const trashTimer = setInterval(() => void sweepTrash(), 60 * 60 * 1000);
  trashTimer.unref?.();
  followRounds(service, rounds, logbook);
  service.on("event", (event: { type?: string }) => {
    events.publish({ channel: "agent", payload: event });
    // A queue change may mean a round's turn has ended.
    if (event.type === "queue-changed") void scheduler.reconcile();
  });
  const initialization = new AgentInitializationGate(() => service.initialize());
  const context: HostContext = {
    name: APP_NAME,
    version: APP_VERSION,
    service,
    mailbox,
    browser,
    setupFile: paths.setupFile,
    exportsRoot: paths.exportsRoot,
    initializeAgent: () => initialization.start(),
  };
  const handler = createHostHandler({
    token,
    port,
    methods: withLogbook(
      {
        ...createHostMethods(context),
        ...createBrowserMethods(browser),
        ...guardKeyring(createKeyringMethods(keyring), keyringProblem),
        ...createSetupMethods({
          store: setupStore,
          engines: engineSetup,
          applied: async (state, changed) => {
            setupNow = state;
            applyBotDefaults(state);
            if (!state.preferredProvider) return;
            if (changed.preferredProvider === undefined && changed.defaultModel === undefined) {
              return;
            }
            await service.setPreferredProvider(state.preferredProvider);
            await initialization.start();
          },
          record: (action, engine, done) =>
            void logbook
              .record(
                action,
                ENGINE_NAMES[engine as AgentProviderId] ?? engine,
                done ? "done" : "failed",
              )
              .catch(() => undefined),
        }),
        // Deleting only moves the bot to the trash. What it had goes when the trash is emptied.
        "agent.deleteBot": (botId) => service.deleteBot(requireString(botId, "botId")),
        "agent.listDeletedBots": () => service.listDeletedBots(),
        "agent.restoreBot": (botId) => service.restoreBot(requireString(botId, "botId")),
        "agent.purgeBot": (botId) => purgeBot(requireString(botId, "botId")),
        ...createRoundsMethods(
          rounds,
          scheduler,
          (botId) => {
            const bot = findBot(botId);
            return bot
              ? { access: bot.access, engine: isClaudeModel(bot.model) ? "claude" : "codex" }
              : null;
          },
          botAway,
        ),
        ...createLibraryMethods({
          library: new BotLibrary(resolveLibraryRoot(env)),
          listBots: () => service.listBots(),
          listRounds: () => rounds.list(),
        }),
        ...forgetDispatchTalk(
          createBotDraftMethods(new BotCreator(store, service, rounds)),
          dispatch,
        ),
        ...createDispatchMethods(dispatch),
        ...createOptimizerMethods({
          store: optimizer,
          bots: () => service.listBots(),
          contextUsage: () => service.contextUsage(),
          findCommandFilter,
        }),
        ...createRoomsMethods({
          rooms,
          bots: () => service.listBots(),
          send: (botId, text) => service.sendMessage({ botId, text }),
        }),
        ...createFilesMethods({
          bots: () => service.listBots(),
          sharedRoot: store.sharedRoot,
          open: openWithOperatingSystem,
        }),
        ...createFuelMethods({
          status: () => service.getStatus(),
          usage: () => service.getUsage(),
          bots: () => service.listBots(),
          turnsSince: (since) => mailbox.turnsSince(since),
        }),
        "archive.list": () => mailbox.listArchive(),
      },
      logbook,
      {
        // A deleted bot still has its name, for the entries about restoring or removing it.
        botName: (id) =>
          service.listBots().find((bot) => bot.id === id)?.name ??
          service.listDeletedBots().find((entry) => entry.bot.id === id)?.bot.name ??
          id,
        keyName: (id) =>
          keyringProblem ? id : (keyring.list().find((key) => key.id === id)?.name ?? id),
        roundName: (id) => rounds.list().find((round) => round.id === id)?.name ?? id,
      },
    ),
    events,
    mailbox,
    importAttachments: (data) => importAttachments(context, data),
    uiRoot: resolveUiRoot(env),
  });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    // Event streams stay open for hours; the hub's keep-alive is the liveness signal.
    idleTimeout: 0,
    fetch: handler,
  });

  const record: HostRecord = {
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    version: APP_VERSION,
  };
  await writeFile(paths.hostFile, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });

  void initialization
    .start()
    .catch((error) => {
      console.error("Unable to initialize the local agent backend:", error);
    })
    // Rounds start once the bots are loaded, so a due round finds its bot.
    .finally(() => {
      scheduler.start();
      void sweepTrash();
    });

  let stopped = false;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    paths,
    async stop() {
      if (stopped) return;
      stopped = true;
      scheduler.stop();
      clearInterval(trashTimer);
      engineSetup.stop();
      await dispatch.stop();
      await optimizer.flush().catch(() => undefined);
      events.close();
      await server.stop(true);
      await browser.destroy();
      await service.stop();
      await rm(paths.hostFile, { force: true });
    },
  };
}

/** Once a bot is made, the talk that led to it is over: the next bot starts from an empty one. */
function forgetDispatchTalk(
  methods: Record<string, HostMethod>,
  dispatch: DispatchService,
): Record<string, HostMethod> {
  const create = methods["agent.createBotFromDraft"];
  if (!create) return methods;
  return {
    ...methods,
    "agent.createBotFromDraft": async (input) => {
      const result = await create(input);
      if (isRecord(result) && result.ok === true) await dispatch.reset().catch(() => undefined);
      return result;
    },
  };
}

/** When the keyring did not open, every keyring call says why instead of failing oddly. */
function guardKeyring(
  methods: Record<string, HostMethod>,
  problem: string | null,
): Record<string, HostMethod> {
  if (!problem) return methods;
  return Object.fromEntries(
    Object.keys(methods).map((name) => [
      name,
      () => {
        throw new Error(`The keyring could not be opened: ${problem}`);
      },
    ]),
  );
}
