import { execFile } from "node:child_process";
import { randomUUID, type UUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import {
  type CanUseTool,
  createSdkMcpServer,
  getSessionMessages,
  type HookCallback,
  type PermissionResult,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { STANDING_PERMISSION_TYPES, type StandingPermissionType } from "../shared/access";
import type { BotContextBreakdown } from "../shared/ipc";
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
import type { ClaudeCliInfo } from "./cli";
import {
  KEYRING_LIST_TOOL,
  KEYRING_REQUEST_TOOL,
  KEYRING_SIGN_IN_TOOL,
  KEYRING_TOOL_DESCRIPTIONS,
} from "./keyring/key-tools";
import {
  type AppServerNotification,
  type AppServerRequest,
  getString,
  isRecord,
  type RequestId,
  type RpcError,
  type ThreadResponse,
} from "./protocol";
import {
  PROPOSE_TEAMMATE_DESCRIPTION,
  PROPOSE_TEAMMATE_TOOL,
  TEAMMATE_NAME_MAX,
  TEAMMATE_PURPOSE_MAX,
  TEAMMATE_ROLE_MAX,
} from "./teammate-tool";
import { MARKAS_VERSION } from "./version";

const execFileAsync = promisify(execFile);

/** How long a bot waits for the person's yes or no before the request lapses: a week. */
const PERMISSION_WAIT_SECONDS = 7 * 24 * 60 * 60;
/** What sets two messages of one turn apart in the reply. */
const MESSAGE_GAP = "\n\n";
const DENIED_MESSAGE =
  "The person did not allow this. Do not retry it or look for another way to do the same thing; ask them what they would like instead.";

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

interface ThreadConfig {
  cwd: string;
  model?: string;
  effort?: string;
  developerInstructions: string;
  additionalDirectories: string[];
  access: AccessScope;
}

interface ActiveTurn {
  id: string;
  itemId: string;
  text: string;
  assistantMessages: Map<string, string>;
  /** True once a new message of the bot started after some text, so the next text is set apart. */
  newMessage: boolean;
}

interface ThreadRuntime {
  id: string;
  config: ThreadConfig;
  input: AsyncMessageQueue;
  query: Query;
  activeTurn: ActiveTurn | null;
  consume: Promise<void>;
  /** What the person allowed for the rest of this chat. */
  grants: Grant[];
  /** What the round behind the current turn may do without asking. Empty for any other turn. */
  standing: StandingGrant[];
  /** Tool calls of the current turn whose standing permission was already reported. */
  standingReported: Set<string>;
  /** True once this runtime was shut down on purpose, so its ending is not an error. */
  closed: boolean;
  /** How many tokens the conversation held at the last call to the model. */
  contextTokens: number | null;
  /** How many tokens the model can hold. Known once a turn has finished. */
  contextWindow: number | null;
}

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type QueryFactory = (params: Parameters<typeof query>[0]) => Query;

export class ClaudeAgentClient extends EventEmitter<ClientEvents> {
  readonly provider: AgentProvider = "claude";
  readonly #cli: ClaudeCliInfo;
  readonly #createQuery: QueryFactory;
  readonly #threads = new Map<string, ThreadRuntime>();
  readonly #pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  #running = false;

  constructor(cli: ClaudeCliInfo, createQuery: QueryFactory = query) {
    super();
    this.#cli = cli;
    this.#createQuery = createQuery;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.#running = false;
    for (const runtime of this.#threads.values()) {
      runtime.input.close();
      runtime.query.close();
    }
    await Promise.allSettled([...this.#threads.values()].map((runtime) => runtime.consume));
    this.#threads.clear();
    for (const pending of this.#pendingServerRequests.values()) {
      pending.reject(new Error("Claude session stopped."));
    }
    this.#pendingServerRequests.clear();
  }

  async closeThread(threadId: string): Promise<void> {
    const runtime = this.#threads.get(threadId);
    if (!runtime) return;
    runtime.closed = true;
    runtime.input.close();
    runtime.query.close();
    this.#threads.delete(threadId);
    await runtime.consume.catch(() => undefined);
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (!this.#running) throw new Error("Claude Agent SDK is not running.");

    switch (method) {
      case "initialize":
        return {} as T;
      case "account/read":
        return (await this.#readAccount()) as T;
      case "account/rateLimits/read":
        return { rateLimits: null, rateLimitsByLimitId: null } as T;
      case "model/list":
        return { data: CLAUDE_MODELS } as T;
      case "plugin/list":
        return { marketplaces: [] } as T;
      case "thread/start": {
        const threadId = randomUUID();
        await this.#startThread(threadId, readThreadConfig(params), false);
        return { thread: { id: threadId } } as T;
      }
      case "thread/resume": {
        const threadId = requiredString(params, "threadId");
        if (!this.#threads.has(threadId)) {
          await this.#startThread(threadId, readThreadConfig(params), true);
        }
        return { thread: { id: threadId } } as T;
      }
      case "thread/read":
        return (await this.#readThread(requiredString(params, "threadId"))) as T;
      case "turn/start":
        return (await this.#startTurn(params)) as T;
      case "turn/interrupt": {
        const runtime = this.#requireThread(requiredString(params, "threadId"));
        await runtime.query.interrupt();
        return {} as T;
      }
      case "thread/compact/start":
        // Claude Code manages its own context compaction.
        return {} as T;
      default:
        throw new Error(`Claude adapter does not implement ${method}.`);
    }
  }

  notify(): void {
    // Claude Agent SDK has no initialize notification.
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

  async #readAccount(): Promise<unknown> {
    try {
      const { stdout } = await execFileAsync(this.#cli.executable, ["auth", "status", "--json"], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        shell: process.platform === "win32",
      });
      const status: unknown = JSON.parse(stdout);
      if (!isRecord(status) || status.loggedIn !== true) {
        return { account: null, requiresOpenaiAuth: false };
      }
      return {
        account: {
          type: "claude",
          email: typeof status.email === "string" ? status.email : null,
          planType: typeof status.subscriptionType === "string" ? status.subscriptionType : null,
        },
        requiresOpenaiAuth: false,
      };
    } catch {
      return { account: null, requiresOpenaiAuth: false };
    }
  }

  async #startThread(threadId: string, config: ThreadConfig, resume: boolean): Promise<void> {
    const input = new AsyncMessageQueue();
    // Every tool call is judged twice by the same rule: in a hook that runs before Claude's
    // own permission settings, and again here if Claude still asks. Neither the person's
    // Claude settings nor anything the bot writes can widen what the bot's level allows.
    const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
      if (toolName === "AskUserQuestion") {
        return this.#requestUserInput(threadId, toolInput, options.toolUseID ?? randomUUID());
      }
      const toolUseId = options.toolUseID ?? randomUUID();
      const allowed = await this.#permit(threadId, toolName, toolInput, toolUseId, options.signal);
      return allowed
        ? ({ behavior: "allow", updatedInput: toolInput } satisfies PermissionResult)
        : ({ behavior: "deny", message: DENIED_MESSAGE } satisfies PermissionResult);
    };
    const judgeBeforeUse: HookCallback = async (hookInput, toolUseId, options) => {
      if (hookInput.hook_event_name !== "PreToolUse") return { continue: true };
      // Questions to the person go through canUseTool, which collects the answer.
      if (hookInput.tool_name === "AskUserQuestion") return { continue: true };
      const allowed = await this.#permit(
        threadId,
        hookInput.tool_name,
        hookInput.tool_input,
        toolUseId ?? hookInput.tool_use_id,
        options.signal,
      );
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: allowed ? "allow" : "deny",
          ...(allowed ? {} : { permissionDecisionReason: DENIED_MESSAGE }),
        },
      };
    };
    const full = config.access.level === "full";
    const mcpServers = this.#createMarkasServers(threadId);
    const claudeQuery = this.#createQuery({
      prompt: input,
      options: {
        cwd: config.cwd,
        pathToClaudeCodeExecutable: this.#cli.executable,
        ...(config.model ? { model: normalizeClaudeModel(config.model) } : {}),
        ...(config.effort ? { effort: normalizeClaudeEffort(config.effort) } : {}),
        ...(resume ? { resume: threadId } : { sessionId: threadId }),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: config.developerInstructions,
        },
        // Below full access the bot's own folder is not a source of settings: a bot could
        // otherwise write itself permissions or hooks there.
        settingSources: full ? ["user", "project", "local"] : ["user"],
        permissionMode: full ? "bypassPermissions" : "default",
        allowDangerouslySkipPermissions: full,
        hooks: { PreToolUse: [{ hooks: [judgeBeforeUse], timeout: PERMISSION_WAIT_SECONDS }] },
        includePartialMessages: true,
        additionalDirectories: config.additionalDirectories,
        canUseTool,
        mcpServers,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: `markas/${MARKAS_VERSION}` },
      },
    });
    const runtime: ThreadRuntime = {
      id: threadId,
      config,
      input,
      query: claudeQuery,
      activeTurn: null,
      consume: Promise.resolve(),
      grants: [],
      standing: [],
      standingReported: new Set(),
      closed: false,
      contextTokens: null,
      contextWindow: null,
    };
    runtime.consume = this.#consume(runtime);
    this.#threads.set(threadId, runtime);
  }

  async #startTurn(params: unknown): Promise<unknown> {
    const threadId = requiredString(params, "threadId");
    let runtime = this.#requireThread(threadId);
    if (runtime.activeTurn) throw new Error("The Claude thread already has an active turn.");

    // The level can differ per turn: the person may change it, and a turn done for
    // another bot runs at the lower of the two. A changed level restarts the session,
    // so settings and permissions loaded under the old level do not linger.
    const access = readAccess(params, runtime.config.cwd, runtime.config.additionalDirectories);
    if (access.level !== runtime.config.access.level) {
      runtime.closed = true;
      runtime.input.close();
      runtime.query.close();
      await runtime.consume.catch(() => undefined);
      this.#threads.delete(threadId);
      await this.#startThread(threadId, { ...runtime.config, access }, true);
      runtime = this.#requireThread(threadId);
    } else {
      runtime.config.access = access;
    }
    // Set fresh for every turn, so a round's permissions never carry over into a chat turn.
    runtime.standing = readStanding(params);
    runtime.standingReported.clear();

    const requestedModel = getString(params, "model");
    if (requestedModel && requestedModel !== runtime.config.model) {
      await runtime.query.setModel(normalizeClaudeModel(requestedModel));
      runtime.config.model = requestedModel;
    }
    const requestedEffort = getString(params, "effort");
    if (requestedEffort && requestedEffort !== runtime.config.effort) {
      await runtime.query.setMaxThinkingTokens(thinkingTokens(requestedEffort));
      runtime.config.effort = requestedEffort;
    }

    const clientId = getString(params, "clientUserMessageId");
    const turnId = clientId && isUuid(clientId) ? clientId : randomUUID();
    const text = readInputText(params);
    const activeTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      text: "",
      assistantMessages: new Map<string, string>(),
      newMessage: false,
    };
    runtime.activeTurn = activeTurn;
    this.emit("notification", {
      method: "turn/started",
      params: { threadId, turn: { id: turnId, status: "inProgress" } },
    });
    runtime.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid: turnId as UUID,
      session_id: threadId,
    });
    return { turn: { id: turnId, status: "inProgress" } };
  }

  async #consume(runtime: ThreadRuntime): Promise<void> {
    try {
      for await (const message of runtime.query) this.#handleMessage(runtime, message);
      if (runtime.closed) return;
      if (this.#running) this.#fail(new Error("Claude session stream ended unexpectedly."));
    } catch (error) {
      if (!this.#running || runtime.closed) return;
      const activeTurn = runtime.activeTurn;
      if (activeTurn) this.#completeTurn(runtime, "failed", error);
      this.#fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #fail(error: Error): void {
    if (!this.#running) return;
    this.#running = false;
    this.emit("exit", error);
  }

  #handleMessage(runtime: ThreadRuntime, message: SDKMessage): void {
    if (message.type === "stream_event" && message.parent_tool_use_id === null) {
      const event = message.event as unknown;
      const delta = isRecord(event) ? event.delta : null;
      // What the bot says before and after using a tool are separate messages; without a
      // break between them they would run together into one sentence.
      if (isRecord(event) && event.type === "message_start" && runtime.activeTurn?.text) {
        runtime.activeTurn.newMessage = true;
      }
      if (
        event &&
        isRecord(event) &&
        event.type === "content_block_delta" &&
        isRecord(delta) &&
        delta.type === "text_delta" &&
        typeof delta.text === "string"
      ) {
        const turn = runtime.activeTurn;
        const gap = turn?.newMessage ? MESSAGE_GAP : "";
        if (turn) turn.newMessage = false;
        this.#appendDelta(runtime, gap + delta.text);
      }
      return;
    }

    // Claude Code folds a long conversation by itself and says how full it was before.
    if (message.type === "system" && message.subtype === "compact_boundary") {
      this.emit("notification", {
        method: "thread/compacted",
        params: {
          threadId: runtime.id,
          compaction: { preTokens: message.compact_metadata.pre_tokens },
        },
      });
      return;
    }

    if (message.type === "assistant") {
      if (message.parent_tool_use_id !== null) return;
      this.#noteContext(runtime, (message.message as { usage?: unknown }).usage);
      const turn = runtime.activeTurn;
      const text = messageText(message.message);
      if (!turn || !text) return;
      turn.assistantMessages.set(message.uuid, text);
      const completeText = [...turn.assistantMessages.values()].join(MESSAGE_GAP);
      if (completeText.startsWith(turn.text)) {
        this.#appendDelta(runtime, completeText.slice(turn.text.length));
      }
      return;
    }

    if (message.type !== "result") return;
    const windows = isRecord(message.modelUsage)
      ? Object.values(message.modelUsage).map((usage) =>
          isRecord(usage) && typeof usage.contextWindow === "number" ? usage.contextWindow : 0,
        )
      : [];
    const window = Math.max(0, ...windows);
    if (window > 0) {
      runtime.contextWindow = window;
      this.#reportContext(runtime);
    }
    const fallback = message.subtype === "success" ? message.result : "";
    const turn = runtime.activeTurn;
    if (turn) {
      const completeText = [...turn.assistantMessages.values()].join(MESSAGE_GAP);
      if (completeText) turn.text = completeText;
      else if (!turn.text && fallback) this.#appendDelta(runtime, fallback);
    }
    const interrupted =
      message.terminal_reason === "aborted_streaming" ||
      message.terminal_reason === "aborted_tools" ||
      ("errors" in message && message.errors.some((error) => /interrupt|abort/i.test(error)));
    const status = interrupted
      ? "interrupted"
      : message.subtype === "success"
        ? "completed"
        : "failed";
    this.#completeTurn(runtime, status, "errors" in message ? message.errors.join("\n") : null);
  }

  /** What one call to the model was sent is how full the conversation is. */
  #noteContext(runtime: ThreadRuntime, usage: unknown): void {
    if (!isRecord(usage)) return;
    const part = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
    const tokens =
      part("input_tokens") + part("cache_read_input_tokens") + part("cache_creation_input_tokens");
    if (tokens <= 0) return;
    runtime.contextTokens = tokens;
    this.#reportContext(runtime);
  }

  /** Tells the host how full the conversation is, once both numbers are known. */
  #reportContext(runtime: ThreadRuntime): void {
    if (runtime.contextTokens === null || runtime.contextWindow === null) return;
    this.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: runtime.id,
        tokenUsage: {
          last: { totalTokens: runtime.contextTokens },
          modelContextWindow: runtime.contextWindow,
        },
      },
    });
  }

  #appendDelta(runtime: ThreadRuntime, delta: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    turn.text += delta;
    this.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        itemId: turn.itemId,
        delta,
      },
    });
  }

  #completeTurn(runtime: ThreadRuntime, status: string, error: unknown): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
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
        params: { threadId: runtime.id, turnId: turn.id, message: String(error) },
      });
    }
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: runtime.id, turn: { id: turn.id, status } },
    });
    runtime.activeTurn = null;
  }

  async #readThread(threadId: string): Promise<ThreadResponse> {
    const runtime = this.#threads.get(threadId);
    const messages = await getSessionMessages(threadId, {
      ...(runtime?.config.cwd ? { dir: runtime.config.cwd } : {}),
    });
    const turns: NonNullable<ThreadResponse["thread"]["turns"]> = [];
    let current: (typeof turns)[number] | null = null;
    for (const message of messages) {
      if (message.parent_tool_use_id) continue;
      const text = messageText(message.message);
      if (message.type === "user") {
        // Notes the engine leaves for itself are stored like messages from the person.
        // They are not, so they are not shown as such; replies after one stay in the
        // turn they belong to.
        if (!text || isEngineNote(text)) continue;
        current = {
          id: message.uuid,
          status: "completed",
          items: [
            {
              id: message.uuid,
              type: "userMessage",
              clientId: message.uuid,
              content: [{ type: "text", text }],
            },
          ],
        };
        turns.push(current);
      } else if (message.type === "assistant" && text) {
        if (!current) {
          current = { id: message.uuid, status: "completed", items: [] };
          turns.push(current);
        }
        current.items?.push({ id: message.uuid, type: "agentMessage", text });
      }
    }
    return { thread: { id: threadId, turns } };
  }

  #createMarkasServers(threadId: string) {
    const call = (namespace: string, name: string, args: unknown) =>
      this.#callDynamicTool(threadId, namespace, name, args);
    return {
      markas_browser: createSdkMcpServer({
        name: "markas_browser",
        version: MARKAS_VERSION,
        tools: [
          tool(
            "open",
            "Open an HTTP(S) URL in Markas's private browser.",
            { url: z.string() },
            (args) => call("markas_browser", "open", args),
          ),
          tool("list_tabs", "List Markas browser tabs.", {}, (args) =>
            call("markas_browser", "list_tabs", args),
          ),
          tool(
            "snapshot",
            "Read a browser page and get element references.",
            { tabId: z.string() },
            (args) => call("markas_browser", "snapshot", args),
          ),
          tool(
            "act",
            "Click, type, press a key, scroll, navigate, or reload in Markas's browser.",
            {
              tabId: z.string(),
              revision: z.number().int(),
              action: z.object({
                type: z.enum(["click", "type", "key", "scroll", "back", "forward", "reload"]),
                ref: z.string().optional(),
                text: z.string().optional(),
                submit: z.boolean().optional(),
                key: z.string().optional(),
                deltaY: z.number().optional(),
              }),
            },
            (args) => call("markas_browser", "act", args),
          ),
          tool("screenshot", "Capture the visible browser page.", { tabId: z.string() }, (args) =>
            call("markas_browser", "screenshot", args),
          ),
          tool("close_tab", "Close a Markas browser tab.", { tabId: z.string() }, (args) =>
            call("markas_browser", "close_tab", args),
          ),
          tool(
            "hand_off",
            "Pass a step to the person that only they can do, such as a code sent to their phone or a CAPTCHA. The person takes over the tab, and this waits until they give it back.",
            { tabId: z.string(), reason: z.string() },
            (args) => call("markas_browser", "hand_off", args),
          ),
        ],
      }),
      markas: createSdkMcpServer({
        name: "markas",
        version: MARKAS_VERSION,
        tools: [
          tool("list_agents", "List Markas agents that can receive local messages.", {}, (args) =>
            call("markas", "list_agents", args),
          ),
          tool(
            "send_message",
            "Send an asynchronous message or local files to Markas teammates.",
            {
              recipientBotIds: z.array(z.string()).min(1).max(32),
              text: z.string().min(1).max(100_000),
              paths: z.array(z.string()).max(10).optional(),
              replyToMessageId: z.string().nullable().optional(),
            },
            (args) => call("markas", "send_message", args),
          ),
          tool(
            PROPOSE_TEAMMATE_TOOL,
            PROPOSE_TEAMMATE_DESCRIPTION,
            {
              name: z.string().min(1).max(TEAMMATE_NAME_MAX),
              role: z.string().min(1).max(TEAMMATE_ROLE_MAX),
              description: z.string().min(1).max(TEAMMATE_PURPOSE_MAX),
            },
            (args) => call("markas", PROPOSE_TEAMMATE_TOOL, args),
          ),
          tool(KEYRING_LIST_TOOL, KEYRING_TOOL_DESCRIPTIONS[KEYRING_LIST_TOOL], {}, (args) =>
            call("markas", KEYRING_LIST_TOOL, args),
          ),
          tool(
            KEYRING_SIGN_IN_TOOL,
            KEYRING_TOOL_DESCRIPTIONS[KEYRING_SIGN_IN_TOOL],
            { keyName: z.string().optional(), keyId: z.string().optional() },
            (args) => call("markas", KEYRING_SIGN_IN_TOOL, args),
          ),
          tool(
            KEYRING_REQUEST_TOOL,
            KEYRING_TOOL_DESCRIPTIONS[KEYRING_REQUEST_TOOL],
            {
              site: z.string().min(1).max(2048),
              reason: z.string().min(1).max(300),
              kind: z.enum(["login", "token"]).optional(),
              username: z.string().max(200).optional(),
              keyName: z.string().max(100).optional(),
            },
            (args) => call("markas", KEYRING_REQUEST_TOOL, args),
          ),
        ],
      }),
    };
  }

  async contextBreakdown(threadId: string): Promise<Omit<BotContextBreakdown, "botId"> | null> {
    const runtime = this.#threads.get(threadId);
    if (!runtime) return null;
    const usage = await runtime.query.getContextUsage();
    const kinds = usage.categories.filter(
      (category) => category.tokens > 0 && !/free space|autocompact buffer/i.test(category.name),
    );
    const bySize = (a: { tokens: number }, b: { tokens: number }) => b.tokens - a.tokens;
    return {
      usedTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      model: usage.model || null,
      categories: kinds
        .filter((category) => !category.isDeferred)
        .map(({ name, tokens }) => ({ name, tokens }))
        .sort(bySize),
      notLoaded: kinds
        .filter((category) => category.isDeferred)
        .map(({ name, tokens }) => ({ name, tokens }))
        .sort(bySize),
      autoCompactAt:
        usage.isAutoCompactEnabled && typeof usage.autoCompactThreshold === "number"
          ? usage.autoCompactThreshold
          : null,
    };
  }

  async #callDynamicTool(
    threadId: string,
    namespace: string,
    name: string,
    args: unknown,
  ): Promise<CallToolResult> {
    const runtime = this.#requireThread(threadId);
    const result = await this.#callServerRequest("item/tool/call", {
      threadId,
      turnId: runtime.activeTurn?.id ?? randomUUID(),
      callId: randomUUID(),
      namespace,
      tool: name,
      arguments: args,
    });
    if (!isRecord(result)) return { content: [{ type: "text" as const, text: String(result) }] };
    const content: CallToolResult["content"] = [];
    if (Array.isArray(result.contentItems)) {
      for (const item of result.contentItems) content.push(...dynamicContent(item));
    }
    return { content, isError: result.success === false };
  }

  async #requestUserInput(
    threadId: string,
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<PermissionResult> {
    const runtime = this.#requireThread(threadId);
    const rawQuestions = Array.isArray(input.questions) ? input.questions.filter(isRecord) : [];
    const questions = rawQuestions.map((question, index) => ({
      id: `question-${index}`,
      header: typeof question.header === "string" ? question.header : "Question",
      question:
        typeof question.question === "string"
          ? question.question
          : "Claude needs more information.",
      options: Array.isArray(question.options) ? question.options : undefined,
    }));
    const result = await this.#callServerRequest("item/tool/requestUserInput", {
      threadId,
      turnId: runtime.activeTurn?.id ?? randomUUID(),
      itemId: toolUseId,
      questions,
    });
    const responseAnswers = isRecord(result) && isRecord(result.answers) ? result.answers : {};
    const answers = Object.fromEntries(
      questions.map((question) => {
        const entry = responseAnswers[question.id];
        const values = isRecord(entry) && Array.isArray(entry.answers) ? entry.answers : [];
        return [
          question.question,
          values.filter((value): value is string => typeof value === "string").join(", "),
        ];
      }),
    );
    return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
  }

  /** True when the tool call may go ahead: allowed by the bot's level, or by the person. */
  async #permit(
    threadId: string,
    toolName: string,
    toolInput: unknown,
    toolUseId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const runtime = this.#threads.get(threadId);
    if (!runtime) return false;
    const standing = runtime.activeTurn ? runtime.standing : [];
    const verdict = judgeTool(runtime.config.access, toolName, toolInput, standing);
    if (verdict.decision === "allow") {
      // The hook and the permission callback can both judge one call; it is reported once.
      if (verdict.standing && !runtime.standingReported.has(toolUseId)) {
        runtime.standingReported.add(toolUseId);
        this.emit("notification", {
          method: "standing/used",
          params: {
            threadId,
            turnId: runtime.activeTurn?.id ?? null,
            itemId: toolUseId,
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
        threadId,
        turnId: runtime.activeTurn?.id ?? randomUUID(),
        itemId: toolUseId,
        kind: verdict.kind,
        detail: verdict.detail,
        grant: verdict.grant,
      },
      signal,
    ).catch(() => null);
    const decision = isRecord(answer) ? answer.decision : null;
    if (decision === "chat" && verdict.grant) runtime.grants.push(verdict.grant);
    return decision === "once" || decision === "chat";
  }

  #callServerRequest(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
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

  #requireThread(threadId: string): ThreadRuntime {
    const runtime = this.#threads.get(threadId);
    if (!runtime) throw new Error(`Unknown Claude thread: ${threadId}`);
    return runtime;
  }
}

class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  readonly #values: SDKUserMessage[] = [];
  readonly #waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  #closed = false;

  push(value: SDKUserMessage): void {
    if (this.#closed) throw new Error("Claude input queue is closed.");
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

const CLAUDE_MODELS = [
  {
    model: "claude-fable-5",
    displayName: "Claude Fable 5",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({
      reasoningEffort,
    })),
  },
  {
    model: "claude-opus-5",
    displayName: "Claude Opus 5",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({
      reasoningEffort,
    })),
  },
  {
    model: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({
      reasoningEffort,
    })),
  },
];

const ENGINE_NOTE_TAGS = [
  "task-notification",
  "system-reminder",
  "local-command-stdout",
  "local-command-stderr",
  "local-command-caveat",
  "command-name",
  "command-message",
  "user-prompt-submit-hook",
];

/** True for text the engine wrote into the session for itself, such as a helper's report. */
export function isEngineNote(text: string): boolean {
  const start = text.trimStart();
  return ENGINE_NOTE_TAGS.some((tag) => start.startsWith(`<${tag}>`));
}

function readThreadConfig(params: unknown): ThreadConfig {
  const roots =
    isRecord(params) && Array.isArray(params.runtimeWorkspaceRoots)
      ? params.runtimeWorkspaceRoots.filter((value): value is string => typeof value === "string")
      : [];
  const cwd = requiredString(params, "cwd");
  return {
    cwd,
    model: getString(params, "model") ?? undefined,
    effort: getString(params, "effort") ?? undefined,
    developerInstructions: getString(params, "developerInstructions") ?? "",
    additionalDirectories: [...new Set([cwd, ...roots])],
    access: readAccess(params, cwd, [cwd, ...roots]),
  };
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

function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

function dynamicContent(value: unknown): CallToolResult["content"] {
  if (!isRecord(value)) return [];
  if (value.type === "inputText" && typeof value.text === "string") {
    return [{ type: "text" as const, text: value.text }];
  }
  if (value.type === "inputImage" && typeof value.imageUrl === "string") {
    const match = value.imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) return [{ type: "image" as const, mimeType: match[1], data: match[2] }];
  }
  return [];
}

function normalizeClaudeModel(model: string): string {
  return model.startsWith("claude-") ? model : "claude-opus-5";
}

function normalizeClaudeEffort(effort: string): "low" | "medium" | "high" | "xhigh" | "max" {
  return ["low", "medium", "high", "xhigh", "max"].includes(effort)
    ? (effort as "low" | "medium" | "high" | "xhigh" | "max")
    : "high";
}

function thinkingTokens(effort: string): number {
  return { low: 2_000, medium: 8_000, high: 16_000, xhigh: 32_000, max: 64_000 }[effort] ?? 16_000;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
