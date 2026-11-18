import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STANDING_PERMISSION_TYPES, type StandingPermissionType } from "../shared/access";
import { type BotContextBreakdown, isOpenCodeModel, openCodeModelName } from "../shared/ipc";
import {
  type AccessScope,
  covers,
  DEFAULT_ACCESS,
  type Grant,
  isAccessLevel,
  judgeTool,
  type StandingGrant,
} from "./access/policy";
import type { AgentProvider } from "./agent-client";
import type { OpenCodeCliInfo } from "./cli";
import {
  type AcpConnection,
  type AcpConnector,
  StdioAcpConnection,
} from "./opencode/acp-connection";
import { type JudgedCall, judgedCalls, sessionSettings } from "./opencode/rules";
import { LocalToolServer, type OfferedTool, type ToolAnswer } from "./opencode/tool-server";
import {
  type AppServerNotification,
  type AppServerRequest,
  getString,
  isRecord,
  type RequestId,
  type RpcError,
  type ThreadResponse,
} from "./protocol";
import { MARKAS_VERSION } from "./version";

const START_TIMEOUT_MS = 60_000;
const LIST_TIMEOUT_MS = 30_000;
/** How long the model list is trusted before OpenCode is asked again. */
const MODELS_FRESH_MS = 60_000;
/**
 * OpenCode does not say when the model's service refuses a request: it tries again in
 * silence. A turn in which nothing at all happens for this long is ended with a plain reason.
 */
const QUIET_TURN_MS = 5 * 60_000;
/** Put in front of each message so a turn can be found again when the history is read back. */
const TURN_MARK = "markas-turn:";

export const SILENT_TURN_MESSAGE =
  'OpenCode stopped answering. The model\'s service may have refused the request, for example because its free use or credit ran out. Run `opencode run "hello"` in a terminal to see what it says, or choose another model for this bot.';
export const EMPTY_TURN_MESSAGE =
  'OpenCode ended the turn without an answer. The model\'s service may have refused the request. Run `opencode run "hello"` in a terminal to see what it says, or choose another model for this bot.';

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

interface ThreadConfig {
  cwd: string;
  developerInstructions: string;
  ownRoots: string[];
  access: AccessScope;
  tools: Map<string, OfferedTool[]>;
}

interface ActiveTurn {
  id: string;
  itemId: string;
  text: string;
  /** The OpenCode message the last piece of text belonged to. */
  messageId: string | null;
  sawTool: boolean;
  cancelled: boolean;
  /** Ends every question of this turn that is still open. */
  abort: AbortController;
  /** Tool calls OpenCode has started and not finished. */
  running: Set<string>;
  /** Questions to the person or the host that are still open. */
  waiting: number;
  quiet: NodeJS.Timeout | null;
}

interface ThreadRuntime {
  /** The OpenCode session id, which is also the thread id. */
  id: string;
  /** What the tool server knows this conversation by. */
  key: string;
  config: ThreadConfig;
  connection: AcpConnection;
  /** Holds the instructions file. Outside the bot's folder, so the bot cannot rewrite it. */
  directory: string;
  activeTurn: ActiveTurn | null;
  /** What the person allowed for the rest of this chat. */
  grants: Grant[];
  /** What the round behind the current turn may do without asking. */
  standing: StandingGrant[];
  standingReported: Set<string>;
  /** What OpenCode has told us about each tool call: its tool and what it was given. */
  calls: Map<string, { tool: string; input: unknown }>;
  /** Calls already let through in this turn, so a second question about one is not repeated. */
  passed: Set<string>;
  /** The model and effort the session was last set to. */
  modelKey: string | null;
  /** Collects the history while it is being read back; null at all other times. */
  replay: ReplayedUpdate[] | null;
  usedTokens: number | null;
  maxTokens: number | null;
  closed: boolean;
}

interface ReplayedUpdate {
  kind: "user" | "agent";
  messageId: string;
  text: string;
  audience: string[];
}

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface OpenCodeModel {
  /** `<provider>/<model>`, as OpenCode names it. */
  name: string;
  label: string;
  /** The names of the model's own variants, such as "high". */
  variants: string[];
}

export interface OpenCodeClientOptions {
  connect?: AcpConnector;
  /** Runs `opencode` with these arguments and returns what it printed. */
  runCli?: (args: string[]) => Promise<string>;
  quietTurnMs?: number;
  /**
   * Providers Markas adds for its own OpenCode processes, such as a model server on this
   * computer the person connected. They are never written into the person's OpenCode settings.
   */
  providers?: () => Record<string, unknown>;
}

/**
 * Drives OpenCode through its Agent Client Protocol mode and presents it to the rest of
 * Markas like the other engines.
 *
 * Every conversation gets its own OpenCode process, because the things that differ per bot
 * can only be set for a whole process: its instructions, its permission rules and where its
 * Markas tools are.
 */
export class OpenCodeAgentClient extends EventEmitter<ClientEvents> {
  readonly provider: AgentProvider = "opencode";
  readonly #cli: OpenCodeCliInfo;
  readonly #connect: AcpConnector;
  readonly #runCli: (args: string[]) => Promise<string>;
  readonly #quietTurnMs: number;
  readonly #providers: () => Record<string, unknown>;
  readonly #threads = new Map<string, ThreadRuntime>();
  readonly #byKey = new Map<string, ThreadRuntime>();
  /** How each known conversation is set up, so one whose process ended can be started again. */
  readonly #configs = new Map<string, ThreadConfig>();
  readonly #opening = new Map<string, Promise<ThreadRuntime>>();
  readonly #pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  readonly #tools: LocalToolServer;
  #models: { at: number; list: OpenCodeModel[] } | null = null;
  #running = false;

  constructor(cli: OpenCodeCliInfo, options: OpenCodeClientOptions = {}) {
    super();
    this.#cli = cli;
    this.#connect = options.connect ?? ((start) => new StdioAcpConnection(start));
    this.#providers = options.providers ?? (() => ({}));
    this.#runCli =
      options.runCli ?? ((args) => runOpenCode(cli.executable, args, this.#providers()));
    this.#quietTurnMs = options.quietTurnMs ?? QUIET_TURN_MS;
    this.#tools = new LocalToolServer((key, namespace, tool, args) =>
      this.#callTool(key, namespace, tool, args),
    );
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.#running = false;
    await Promise.allSettled([...this.#opening.values()]);
    await Promise.allSettled([...this.#threads.values()].map((runtime) => this.#close(runtime)));
    this.#configs.clear();
    for (const pending of this.#pendingServerRequests.values()) {
      pending.reject(new Error("OpenCode session stopped."));
    }
    this.#pendingServerRequests.clear();
    await this.#tools.stop();
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (!this.#running) throw new Error("OpenCode is not running.");

    switch (method) {
      case "initialize":
        return {} as T;
      case "account/read": {
        // OpenCode has no single account: it is ready when it has at least one model to run.
        const models = await this.#listModels(true).catch(() => []);
        return {
          account: models.length ? { type: "opencode", email: null, planType: null } : null,
          requiresOpenaiAuth: false,
        } as T;
      }
      case "account/rateLimits/read":
        return { rateLimits: null, rateLimitsByLimitId: null } as T;
      case "model/list":
        return {
          // Asked fresh after the person connected a provider; otherwise a recent list will do.
          data: (await this.#listModels(isRecord(params) && params.fresh === true)).map(
            (model) => ({
              model: `opencode:${model.name}`,
              displayName: model.label,
              // OpenCode's effort variants are its own settings per model, and some send what the
              // model refuses (its "high" for Claude Opus 5 asks for a kind of thinking that model
              // no longer takes). Each model runs as OpenCode sets it up, so no effort is offered.
              supportedReasoningEfforts: [],
            }),
          ),
        } as T;
      case "plugin/list":
        return { marketplaces: [] } as T;
      case "thread/start": {
        const runtime = await this.#open(readThreadConfig(params), null);
        return { thread: { id: runtime.id } } as T;
      }
      case "thread/resume": {
        const threadId = requiredString(params, "threadId");
        if (!this.#threads.has(threadId)) await this.#open(readThreadConfig(params), threadId);
        return { thread: { id: threadId } } as T;
      }
      case "thread/read":
        return (await this.#readThread(requiredString(params, "threadId"), params)) as T;
      case "turn/start":
        return (await this.#startTurn(params)) as T;
      case "turn/interrupt": {
        const runtime = this.#requireThread(requiredString(params, "threadId"));
        this.#interrupt(runtime);
        return {} as T;
      }
      case "thread/compact/start":
        // OpenCode folds a long conversation by itself.
        return {} as T;
      default:
        throw new Error(`OpenCode adapter does not implement ${method}.`);
    }
  }

  notify(): void {
    // OpenCode is told nothing at this level; each session is set up when it starts.
  }

  respond(id: RequestId, result: unknown): void {
    const pending = this.#pendingServerRequests.get(id);
    if (!pending) return;
    this.#pendingServerRequests.delete(id);
    pending.resolve(result);
  }

  respondError(id: RequestId, error: RpcError): void {
    const pending = this.#pendingServerRequests.get(id);
    if (!pending) return;
    this.#pendingServerRequests.delete(id);
    pending.reject(new Error(error.message));
  }

  /** OpenCode says how full the conversation is, but not what fills it. */
  async contextBreakdown(threadId: string): Promise<Omit<BotContextBreakdown, "botId"> | null> {
    const runtime = this.#threads.get(threadId);
    if (!runtime || runtime.usedTokens === null || runtime.maxTokens === null) return null;
    return {
      usedTokens: runtime.usedTokens,
      maxTokens: runtime.maxTokens,
      model: runtime.modelKey ?? null,
      categories: [{ name: "Conversation", tokens: runtime.usedTokens }],
      notLoaded: [],
      autoCompactAt: null,
    };
  }

  async #listModels(fresh: boolean): Promise<OpenCodeModel[]> {
    const cached = this.#models;
    if (!fresh && cached && Date.now() - cached.at < MODELS_FRESH_MS) return cached.list;
    const list = parseOpenCodeModels(await this.#runCli(["models", "--verbose"]));
    this.#models = { at: Date.now(), list };
    return list;
  }

  /** Starts the process for one conversation: a new one, or `resumeId` carried on. */
  #open(config: ThreadConfig, resumeId: string | null): Promise<ThreadRuntime> {
    if (resumeId) {
      const already = this.#opening.get(resumeId);
      if (already) return already;
    }
    const opening = this.#openNow(config, resumeId).finally(() => {
      if (resumeId) this.#opening.delete(resumeId);
    });
    if (resumeId) this.#opening.set(resumeId, opening);
    return opening;
  }

  async #openNow(config: ThreadConfig, resumeId: string | null): Promise<ThreadRuntime> {
    await this.#tools.start();
    const key = randomUUID();
    const directory = await mkdtemp(join(tmpdir(), "markas-opencode-"));
    let connection: AcpConnection | null = null;
    try {
      const instructionsFile = join(directory, "instructions.md");
      await writeFile(instructionsFile, config.developerInstructions, "utf8");
      const endpoint = this.#tools.register(key, config.tools);
      const full = config.access.level === "full";
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(
          sessionSettings({
            level: config.access.level,
            instructionsFile,
            tools: Object.fromEntries(
              [...config.tools.keys()].map((namespace) => [
                namespace,
                { url: endpoint.urlFor(namespace), token: endpoint.token },
              ]),
            ),
            providers: this.#providers(),
          }),
        ),
        OPENCODE_DISABLE_AUTOUPDATE: "1",
      };
      // Rules set from outside the settings above would be read after them.
      delete env.OPENCODE_PERMISSION;
      // Below full access the bot's own folder is not a source of settings: a bot could
      // otherwise write itself rules, tools or plugins there.
      if (!full) env.OPENCODE_DISABLE_PROJECT_CONFIG = "1";

      connection = this.#connect({
        executable: this.#cli.executable,
        args: ["acp"],
        cwd: config.cwd,
        env,
      });
      const runtime: ThreadRuntime = {
        id: resumeId ?? "",
        key,
        config,
        connection,
        directory,
        activeTurn: null,
        grants: [],
        standing: [],
        standingReported: new Set(),
        calls: new Map(),
        passed: new Set(),
        modelKey: null,
        // Reading the history back is how a session is carried on; what comes back is not new.
        replay: resumeId ? [] : null,
        usedTokens: null,
        maxTokens: null,
        closed: false,
      };
      this.#bind(runtime);
      await connection.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "markas", title: "Markas", version: MARKAS_VERSION },
        },
        START_TIMEOUT_MS,
      );
      if (resumeId) {
        await connection.request(
          "session/load",
          { sessionId: resumeId, cwd: config.cwd, mcpServers: [] },
          START_TIMEOUT_MS,
        );
        runtime.replay = null;
      } else {
        const session = await connection.request<unknown>(
          "session/new",
          { cwd: config.cwd, mcpServers: [] },
          START_TIMEOUT_MS,
        );
        runtime.id = requiredString(session, "sessionId");
      }
      this.#threads.set(runtime.id, runtime);
      this.#byKey.set(key, runtime);
      this.#configs.set(runtime.id, config);
      return runtime;
    } catch (error) {
      this.#tools.unregister(key);
      await connection?.stop().catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  #bind(runtime: ThreadRuntime): void {
    const { connection } = runtime;
    connection.on("notification", (method, params) => {
      if (method !== "session/update" || !isRecord(params) || !isRecord(params.update)) return;
      this.#handleUpdate(runtime, params.update);
    });
    connection.on("request", (id, method, params) => {
      if (method === "session/request_permission") {
        void this.#answerPermission(runtime, id, params);
        return;
      }
      if (method === "fs/write_text_file") {
        // OpenCode writes the file itself; this only offers an editor the new text.
        connection.respond(id, {});
        return;
      }
      connection.respondError(id, -32601, `Markas does not offer ${method}.`);
    });
    connection.on("diagnostic", (message) => this.emit("diagnostic", message));
    connection.once("exit", (error) => {
      if (runtime.closed) return;
      // One conversation's process ending is not the engine failing: only that
      // conversation is affected, and it is started again when it is next needed.
      this.#finishTurn(runtime, "failed", error.message);
      void this.#close(runtime);
    });
  }

  async closeThread(threadId: string): Promise<void> {
    // Forgotten first, so a process still being opened is not started again later.
    this.#configs.delete(threadId);
    const opening = this.#opening.get(threadId);
    if (opening) await opening.catch(() => undefined);
    const runtime = this.#threads.get(threadId);
    if (runtime) await this.#close(runtime);
  }

  async #close(runtime: ThreadRuntime): Promise<void> {
    if (runtime.closed) return;
    runtime.closed = true;
    runtime.activeTurn?.abort.abort();
    if (this.#threads.get(runtime.id) === runtime) this.#threads.delete(runtime.id);
    this.#byKey.delete(runtime.key);
    this.#tools.unregister(runtime.key);
    await runtime.connection.stop().catch(() => undefined);
    await rm(runtime.directory, { recursive: true, force: true }).catch(() => undefined);
  }

  async #startTurn(params: unknown): Promise<unknown> {
    const threadId = requiredString(params, "threadId");
    let runtime = await this.#liveThread(threadId);
    if (runtime.activeTurn) throw new Error("The OpenCode thread already has an active turn.");

    // The level can differ per turn: the person may change it, and a turn done for another
    // bot runs at the lower of the two. OpenCode takes its rules when it starts, so a
    // changed level starts the conversation's process again.
    const access = readAccess(params, runtime.config.cwd, runtime.config.ownRoots);
    if (access.level !== runtime.config.access.level) {
      const config = { ...runtime.config, access };
      const grants = runtime.grants;
      await this.#close(runtime);
      runtime = await this.#open(config, threadId);
      // A yes "for this chat" was for the chat, not for the process that happened to run it.
      runtime.grants = grants;
    } else {
      runtime.config.access = access;
    }
    // Set fresh for every turn, so a round's permissions never carry over into a chat turn.
    runtime.standing = readStanding(params);
    runtime.standingReported.clear();
    runtime.calls.clear();
    runtime.passed.clear();

    await this.#setModel(runtime, getString(params, "model"));

    const turnId = getString(params, "clientUserMessageId") || randomUUID();
    const turn: ActiveTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      text: "",
      messageId: null,
      sawTool: false,
      cancelled: false,
      abort: new AbortController(),
      running: new Set(),
      waiting: 0,
      quiet: null,
    };
    runtime.activeTurn = turn;
    this.emit("notification", {
      method: "turn/started",
      params: { threadId, turn: { id: turnId, status: "inProgress" } },
    });
    this.#touch(runtime);
    void this.#runPrompt(runtime, turn, readInputText(params));
    return { turn: { id: turnId, status: "inProgress" } };
  }

  async #runPrompt(runtime: ThreadRuntime, turn: ActiveTurn, text: string): Promise<void> {
    try {
      await runtime.connection.request<unknown>("session/prompt", {
        sessionId: runtime.id,
        prompt: [
          // Shown to nobody and not part of the message. OpenCode would also read a message
          // that starts with a slash as one of its own commands; this line prevents that.
          { type: "text", text: `${TURN_MARK}${turn.id}\n`, annotations: { audience: ["user"] } },
          { type: "text", text },
        ],
      });
      if (runtime.activeTurn !== turn) return;
      if (turn.cancelled) return this.#finishTurn(runtime, "interrupted", null);
      // OpenCode reports a refused request as a turn that ended normally, so the only sign
      // is that nothing was said and nothing was done.
      const answered = turn.text.length > 0 || turn.sawTool;
      if (!answered) return this.#finishTurn(runtime, "failed", EMPTY_TURN_MESSAGE);
      this.#finishTurn(runtime, "completed", null);
    } catch (error) {
      if (runtime.activeTurn !== turn) return;
      if (turn.cancelled) return this.#finishTurn(runtime, "interrupted", null);
      this.#finishTurn(runtime, "failed", error instanceof Error ? error.message : String(error));
    }
  }

  #interrupt(runtime: ThreadRuntime): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    turn.cancelled = true;
    turn.abort.abort();
    runtime.connection.notify("session/cancel", { sessionId: runtime.id });
  }

  /** Sets the session to the bot's model, as OpenCode sets that model up (see model/list). */
  async #setModel(runtime: ThreadRuntime, model: string | null): Promise<void> {
    if (!model || !isOpenCodeModel(model)) return;
    if (runtime.modelKey === model) return;
    await runtime.connection.request<unknown>(
      "session/set_model",
      { sessionId: runtime.id, modelId: openCodeModelName(model) },
      START_TIMEOUT_MS,
    );
    runtime.modelKey = model;
  }

  #handleUpdate(runtime: ThreadRuntime, update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (runtime.replay) {
      if (kind !== "user_message_chunk" && kind !== "agent_message_chunk") return;
      const content = isRecord(update.content) ? update.content : {};
      if (content.type !== "text" || typeof content.text !== "string") return;
      const annotations = isRecord(content.annotations) ? content.annotations : {};
      runtime.replay.push({
        kind: kind === "user_message_chunk" ? "user" : "agent",
        messageId: typeof update.messageId === "string" ? update.messageId : "",
        text: content.text,
        audience: Array.isArray(annotations.audience)
          ? annotations.audience.filter((value): value is string => typeof value === "string")
          : [],
      });
      return;
    }

    if (kind === "usage_update") {
      if (typeof update.used === "number" && typeof update.size === "number") {
        runtime.usedTokens = update.used;
        runtime.maxTokens = update.size;
        this.emit("notification", {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: runtime.id,
            tokenUsage: { last: { totalTokens: update.used }, modelContextWindow: update.size },
          },
        });
      }
      return;
    }

    const turn = runtime.activeTurn;
    if (!turn) return;
    this.#touch(runtime);
    const callId = typeof update.toolCallId === "string" ? update.toolCallId : null;
    switch (kind) {
      case "agent_message_chunk": {
        const content = isRecord(update.content) ? update.content : {};
        if (content.type !== "text" || typeof content.text !== "string" || !content.text) return;
        const messageId = typeof update.messageId === "string" ? update.messageId : null;
        // What the bot says before and after using a tool are separate messages in OpenCode.
        const gap = turn.text && messageId !== turn.messageId ? "\n\n" : "";
        turn.messageId = messageId;
        this.#appendDelta(runtime, gap + content.text);
        return;
      }
      case "tool_call": {
        if (!callId) return;
        turn.sawTool = true;
        turn.running.add(callId);
        runtime.calls.set(callId, {
          tool: typeof update.title === "string" ? update.title : "",
          input: update.rawInput,
        });
        return;
      }
      case "tool_call_update": {
        if (!callId) return;
        const known = runtime.calls.get(callId);
        const given = isRecord(update.rawInput) && Object.keys(update.rawInput).length > 0;
        runtime.calls.set(callId, {
          tool:
            typeof update.title === "string" && update.title ? update.title : (known?.tool ?? ""),
          input: given ? update.rawInput : known?.input,
        });
        if (update.status === "completed" || update.status === "failed") {
          turn.running.delete(callId);
        } else {
          turn.running.add(callId);
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Starts the wait for the next sign of life again. While a tool runs or a question is
   * open the turn is not silent, however long that takes.
   */
  #touch(runtime: ThreadRuntime): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    if (turn.quiet) clearTimeout(turn.quiet);
    turn.quiet = setTimeout(() => {
      if (runtime.activeTurn !== turn) return;
      if (turn.running.size > 0 || turn.waiting > 0) return this.#touch(runtime);
      turn.abort.abort();
      runtime.connection.notify("session/cancel", { sessionId: runtime.id });
      this.#finishTurn(runtime, "failed", SILENT_TURN_MESSAGE);
    }, this.#quietTurnMs);
    turn.quiet.unref?.();
  }

  #appendDelta(runtime: ThreadRuntime, delta: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    turn.text += delta;
    this.emit("notification", {
      method: "item/agentMessage/delta",
      params: { threadId: runtime.id, turnId: turn.id, itemId: turn.itemId, delta },
    });
  }

  #finishTurn(runtime: ThreadRuntime, status: string, error: string | null): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    if (turn.quiet) clearTimeout(turn.quiet);
    turn.abort.abort();
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id: turn.itemId, type: "agentMessage", text: turn.text },
      },
    });
    if (status === "failed" && error) {
      this.emit("notification", {
        method: "error",
        params: { threadId: runtime.id, turnId: turn.id, message: error },
      });
    }
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: runtime.id, turn: { id: turn.id, status } },
    });
    runtime.activeTurn = null;
  }

  async #answerPermission(runtime: ThreadRuntime, id: RequestId, params: unknown): Promise<void> {
    const toolCall = isRecord(params) && isRecord(params.toolCall) ? params.toolCall : {};
    const options = isRecord(params) && Array.isArray(params.options) ? params.options : [];
    const option = (kind: string, fallback: string): string => {
      const found = options.find((entry) => isRecord(entry) && entry.kind === kind);
      return isRecord(found) && typeof found.optionId === "string" ? found.optionId : fallback;
    };
    const turn = runtime.activeTurn;
    if (!turn || turn.cancelled) {
      runtime.connection.respond(id, { outcome: { outcome: "cancelled" } });
      return;
    }
    turn.waiting += 1;
    let allowed = false;
    try {
      allowed = await this.#permit(
        runtime,
        turn,
        typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : randomUUID(),
        typeof toolCall.title === "string" ? toolCall.title : "",
        toolCall.rawInput,
      );
    } catch {
      allowed = false;
    } finally {
      turn.waiting -= 1;
      if (runtime.activeTurn === turn) this.#touch(runtime);
    }
    // The yes is always for this one call. OpenCode's own "always" is never used, so it
    // keeps asking and Markas keeps deciding.
    runtime.connection.respond(id, {
      outcome: {
        outcome: "selected",
        optionId: allowed ? option("allow_once", "once") : option("reject_once", "reject"),
      },
    });
  }

  /** True when the tool call may go ahead: allowed by the bot's level, or by the person. */
  async #permit(
    runtime: ThreadRuntime,
    turn: ActiveTurn,
    callId: string,
    permission: string,
    details: unknown,
  ): Promise<boolean> {
    const call = runtime.calls.get(callId);
    const judged = judgedCalls(
      runtime.config.cwd,
      permission,
      call?.tool || null,
      call?.input,
      details,
    );
    for (const one of judged) {
      // OpenCode can ask twice about one call, for example for the folder and then the file.
      const key = `${callId}|${one.toolName}|${JSON.stringify(one.input)}`;
      if (runtime.passed.has(key)) continue;
      if (!(await this.#permitOne(runtime, turn, callId, one))) return false;
      runtime.passed.add(key);
    }
    return true;
  }

  async #permitOne(
    runtime: ThreadRuntime,
    turn: ActiveTurn,
    callId: string,
    call: JudgedCall,
  ): Promise<boolean> {
    const verdict = judgeTool(runtime.config.access, call.toolName, call.input, runtime.standing);
    if (verdict.decision === "allow") {
      if (verdict.standing && !runtime.standingReported.has(callId)) {
        runtime.standingReported.add(callId);
        this.emit("notification", {
          method: "standing/used",
          params: {
            threadId: runtime.id,
            turnId: turn.id,
            itemId: callId,
            grant: verdict.standing,
          },
        });
      }
      return true;
    }
    if (covers(runtime.grants, verdict)) return true;
    const answer = await this.#callServerRequest(
      "item/permission/request",
      {
        threadId: runtime.id,
        turnId: turn.id,
        itemId: callId,
        kind: verdict.kind,
        detail: verdict.detail,
        grant: verdict.grant,
      },
      turn.abort.signal,
    ).catch(() => null);
    const decision = isRecord(answer) ? answer.decision : null;
    if (decision === "chat" && verdict.grant) runtime.grants.push(verdict.grant);
    return decision === "once" || decision === "chat";
  }

  /** One of Markas's own tools, called by the bot through the local tool server. */
  async #callTool(
    key: string,
    namespace: string,
    tool: string,
    args: unknown,
  ): Promise<ToolAnswer> {
    const runtime = this.#byKey.get(key);
    const turn = runtime?.activeTurn;
    if (!runtime || !turn) {
      return {
        content: [{ type: "text", text: "This tool can only be used while the bot is working." }],
        isError: true,
      };
    }
    turn.waiting += 1;
    try {
      const result = await this.#callServerRequest(
        "item/tool/call",
        {
          threadId: runtime.id,
          turnId: turn.id,
          callId: randomUUID(),
          namespace,
          tool,
          arguments: args,
        },
        turn.abort.signal,
      );
      if (!isRecord(result))
        return { content: [{ type: "text", text: String(result) }], isError: false };
      const content: ToolAnswer["content"] = [];
      if (Array.isArray(result.contentItems)) {
        for (const item of result.contentItems) content.push(...toolContent(item));
      }
      return { content, isError: result.success === false };
    } finally {
      turn.waiting -= 1;
      if (runtime.activeTurn === turn) this.#touch(runtime);
    }
  }

  #callServerRequest(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("The turn was stopped."));
      this.#pendingServerRequests.set(id, { resolve, reject });
      // A stopped turn takes its open question with it.
      signal?.addEventListener(
        "abort",
        () => {
          if (this.#pendingServerRequests.delete(id)) reject(new Error("The turn was stopped."));
        },
        { once: true },
      );
      this.emit("request", { id, method, params });
    });
  }

  /**
   * The conversation as OpenCode has it stored. OpenCode gives it by playing it back, so it
   * is read from the conversation's own process when it has one that is idle, and otherwise
   * from a short-lived process that is given no tools and is never asked to do anything.
   */
  async #readThread(threadId: string, params: unknown): Promise<ThreadResponse> {
    const runtime = this.#threads.get(threadId);
    if (runtime?.activeTurn) throw new Error("The OpenCode thread is in the middle of a turn.");
    const cwd = runtime?.config.cwd ?? this.#configs.get(threadId)?.cwd ?? getString(params, "cwd");
    if (!cwd) throw new Error("The folder of this OpenCode thread is not known yet.");
    if (runtime) {
      runtime.replay = [];
      try {
        await runtime.connection.request(
          "session/load",
          { sessionId: threadId, cwd, mcpServers: [] },
          START_TIMEOUT_MS,
        );
        return { thread: { id: threadId, turns: turnsFromReplay(runtime.replay) } };
      } finally {
        runtime.replay = null;
      }
    }

    const connection = this.#connect({
      executable: this.#cli.executable,
      args: ["acp"],
      cwd,
      env: {
        ...process.env,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      },
    });
    const replay: ReplayedUpdate[] = [];
    const reader = { replay } as ThreadRuntime;
    connection.on("notification", (method, update) => {
      if (method !== "session/update" || !isRecord(update) || !isRecord(update.update)) return;
      this.#handleUpdate(reader, update.update);
    });
    connection.on("request", (id, method) => {
      connection.respondError(id, -32601, `Markas does not offer ${method}.`);
    });
    connection.once("exit", () => undefined);
    try {
      await connection.request(
        "initialize",
        {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "markas", title: "Markas", version: MARKAS_VERSION },
        },
        START_TIMEOUT_MS,
      );
      await connection.request(
        "session/load",
        { sessionId: threadId, cwd, mcpServers: [] },
        START_TIMEOUT_MS,
      );
      return { thread: { id: threadId, turns: turnsFromReplay(replay) } };
    } finally {
      await connection.stop().catch(() => undefined);
    }
  }

  /** The conversation's process, started again when it ended since it was last used. */
  async #liveThread(threadId: string): Promise<ThreadRuntime> {
    const runtime = this.#threads.get(threadId);
    if (runtime) return runtime;
    const config = this.#configs.get(threadId);
    if (!config) throw new Error(`Unknown OpenCode thread: ${threadId}`);
    return this.#open(config, threadId);
  }

  #requireThread(threadId: string): ThreadRuntime {
    const runtime = this.#threads.get(threadId);
    if (!runtime) throw new Error(`Unknown OpenCode thread: ${threadId}`);
    return runtime;
  }
}

/** Turns what OpenCode played back into turns: one per message from the person. */
export function turnsFromReplay(
  replay: readonly ReplayedUpdate[],
): NonNullable<ThreadResponse["thread"]["turns"]> {
  const turns: NonNullable<ThreadResponse["thread"]["turns"]> = [];
  let current: (typeof turns)[number] | null = null;
  let userMessageId: string | null = null;
  for (const update of replay) {
    if (update.kind === "user") {
      if (!current || update.messageId !== userMessageId) {
        userMessageId = update.messageId;
        current = {
          id: update.messageId,
          status: "completed",
          items: [
            {
              id: update.messageId,
              type: "userMessage",
              clientId: update.messageId,
              content: [{ type: "text", text: "" }],
            },
          ],
        };
        turns.push(current);
      }
      const message = current.items?.[0];
      if (!message) continue;
      if (update.audience.includes("user") && update.text.startsWith(TURN_MARK)) {
        // The line Markas put in front of the message says which turn this was.
        const turnId = update.text.slice(TURN_MARK.length).trim();
        current.id = turnId;
        message.id = turnId;
        message.clientId = turnId;
        continue;
      }
      // Text OpenCode added for the model only is not something the person said.
      if (update.audience.length > 0) continue;
      const content = message.content?.[0];
      if (content) content.text = (content.text ?? "") + update.text;
      continue;
    }
    if (!update.text) continue;
    if (!current) {
      current = { id: update.messageId, status: "completed", items: [] };
      turns.push(current);
    }
    const existing = current.items?.find(
      (item) => item.type === "agentMessage" && item.id === update.messageId,
    );
    if (existing) existing.text = (existing.text ?? "") + update.text;
    else current.items?.push({ id: update.messageId, type: "agentMessage", text: update.text });
  }
  return turns;
}

/**
 * Reads what `opencode models --verbose` prints: for each model a line with its name,
 * followed by its details as JSON.
 */
export function parseOpenCodeModels(printed: string): OpenCodeModel[] {
  const models: OpenCodeModel[] = [];
  const lines = printed.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const name = lines[index].trim();
    if (!/^[\w.@-]+\/[\w.@:/-]+$/.test(name)) continue;
    let details: unknown = null;
    if (lines[index + 1]?.trim() === "{") {
      const end = lines.indexOf("}", index + 1);
      if (end > index) {
        try {
          details = JSON.parse(lines.slice(index + 1, end + 1).join("\n"));
        } catch {
          details = null;
        }
        index = end;
      }
    }
    const info = isRecord(details) ? details : {};
    const provider = name.slice(0, name.indexOf("/"));
    models.push({
      name,
      label: typeof info.name === "string" && info.name ? `${info.name} (${provider})` : name,
      variants: isRecord(info.variants) ? Object.keys(info.variants) : [],
    });
  }
  return models;
}

function runOpenCode(
  executable: string,
  args: string[],
  providers: Record<string, unknown> = {},
): Promise<string> {
  const viaShell = process.platform === "win32";
  return new Promise((resolve, reject) => {
    execFile(
      viaShell ? `"${executable}"` : executable,
      args,
      {
        timeout: LIST_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        shell: viaShell,
        windowsHide: true,
        env: {
          ...process.env,
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          ...(Object.keys(providers).length > 0
            ? { OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: providers }) }
            : {}),
        },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

function readThreadConfig(params: unknown): ThreadConfig {
  const roots =
    isRecord(params) && Array.isArray(params.runtimeWorkspaceRoots)
      ? params.runtimeWorkspaceRoots.filter((value): value is string => typeof value === "string")
      : [];
  const cwd = requiredString(params, "cwd");
  const ownRoots = [...new Set([cwd, ...roots])];
  return {
    cwd,
    developerInstructions: getString(params, "developerInstructions") ?? "",
    ownRoots,
    access: readAccess(params, cwd, ownRoots),
    tools: readTools(params),
  };
}

/** The tools the host offers, grouped the way it names them: `markas` and `markas_browser`. */
function readTools(params: unknown): Map<string, OfferedTool[]> {
  const namespaces = new Map<string, OfferedTool[]>();
  const offered = isRecord(params) && Array.isArray(params.dynamicTools) ? params.dynamicTools : [];
  for (const namespace of offered) {
    if (!isRecord(namespace) || typeof namespace.name !== "string") continue;
    const tools = Array.isArray(namespace.tools) ? namespace.tools : [];
    namespaces.set(
      namespace.name,
      tools.filter(isRecord).flatMap((tool) =>
        typeof tool.name === "string"
          ? [
              {
                name: tool.name,
                description: typeof tool.description === "string" ? tool.description : "",
                inputSchema: isRecord(tool.inputSchema)
                  ? tool.inputSchema
                  : { type: "object", properties: {} },
              },
            ]
          : [],
      ),
    );
  }
  return namespaces;
}

/**
 * The bot's level and folders for a session or a turn.
 * A request that does not say starts at the careful default, never at full access.
 */
function readAccess(params: unknown, cwd: string, ownRoots: string[]): AccessScope {
  const given = isRecord(params) && isRecord(params.markasAccess) ? params.markasAccess : {};
  const protectedRoots = Array.isArray(given.protectedRoots)
    ? given.protectedRoots.filter((value): value is string => typeof value === "string")
    : [];
  return {
    level: isAccessLevel(given.level) ? given.level : DEFAULT_ACCESS,
    cwd,
    ownRoots: [...new Set(ownRoots)],
    protectedRoots,
  };
}

/** A round's standing permissions for one turn. Anything malformed counts as none. */
function readStanding(params: unknown): StandingGrant[] {
  const given = isRecord(params) && isRecord(params.markasAccess) ? params.markasAccess : {};
  if (!Array.isArray(given.standing)) return [];
  return given.standing.filter(
    (grant): grant is StandingGrant =>
      isRecord(grant) &&
      STANDING_PERMISSION_TYPES.includes(grant.type as StandingPermissionType) &&
      isAccessLevel(grant.level),
  );
}

function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}

function readInputText(params: unknown): string {
  if (!isRecord(params) || !Array.isArray(params.input)) return "";
  return params.input
    .filter(isRecord)
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n");
}

function toolContent(value: unknown): ToolAnswer["content"] {
  if (!isRecord(value)) return [];
  if (value.type === "inputText" && typeof value.text === "string") {
    return [{ type: "text", text: value.text }];
  }
  if (value.type === "inputImage" && typeof value.imageUrl === "string") {
    const match = value.imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) return [{ type: "image", mimeType: match[1], data: match[2] }];
  }
  return [];
}
