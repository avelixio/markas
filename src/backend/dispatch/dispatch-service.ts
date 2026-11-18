import { randomUUID } from "node:crypto";
import {
  type BotDraft,
  type DispatchMessage,
  type DispatchTurn,
  parseBotDraft,
} from "../../shared/bot-draft";
import type { AgentClient, AgentProvider } from "../agent-client";
import {
  type AppServerNotification,
  type AppServerRequest,
  getRecord,
  getString,
  type ThreadResponse,
  type TurnResponse,
} from "../protocol";
import { MARKAS_VERSION } from "../version";
import {
  type DispatchContext,
  dispatchInstructions,
  dispatchTranscript,
  readDispatchReply,
  repairInstructions,
} from "./dispatch";

/** How long Dispatch may take to answer before the turn counts as broken. */
export const DISPATCH_TURN_TIMEOUT_MS = 180_000;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_FILE_LENGTH = 256 * 1024;
const REFUSED = "Dispatch only talks and proposes drafts. This is not available here.";
const LIMIT = /usage limit|rate limit|rate_limit|quota|limit reached|out of credits|\b429\b/i;

export interface DispatchDeps {
  /** Starts an engine of Dispatch's own, so its talk never mixes with a bot's. */
  createClient: (provider: AgentProvider) => Promise<AgentClient>;
  /** The engines that are signed in right now, the preferred one first. */
  engines: () => AgentProvider[];
  /** The model Dispatch runs on for an engine. */
  model: (engine: AgentProvider) => { model: string; effort: string } | null;
  context: () => DispatchContext;
  /** An empty folder of Dispatch's own. It never works in a bot's folder. */
  workspace: string;
  /** Markas's data, which no engine session may touch. */
  protectedRoot: string;
  turnTimeoutMs?: number;
}

interface Session {
  engine: AgentProvider;
  client: AgentClient;
  threadId: string | null;
  /** The turn being waited for. */
  waiting: Waiting | null;
}

interface Waiting {
  turnId: string | null;
  text: string;
  error: string | null;
  finish: (outcome: { status: string }) => void;
}

class DispatchDown extends Error {
  constructor(
    readonly reason: "limit" | "unavailable" | "failed",
    message: string,
  ) {
    super(message);
  }
}

/**
 * The conversation with Dispatch that makes a new bot.
 * Dispatch runs on an engine session of its own that may do nothing but answer: every request
 * to use a tool is refused here, and the draft it writes is parsed as untrusted text.
 */
export class DispatchService {
  readonly #deps: DispatchDeps;
  #messages: DispatchMessage[] = [];
  #session: Session | null = null;
  /** The engine the person moved Dispatch to, when they did. */
  #chosen: AgentProvider | null = null;
  /** True when the engine session has not heard what was said so far. */
  #needsHistory = false;
  #busy = false;
  #stopped = false;

  constructor(deps: DispatchDeps) {
    this.#deps = deps;
  }

  /** The conversation so far. Nothing is started, so opening the screen costs nothing. */
  open(): DispatchTurn {
    if (this.#engine() === null) {
      return this.#down(new DispatchDown("unavailable", "No engine is signed in."));
    }
    return { ok: true, messages: this.#copy() };
  }

  say(text: string): Promise<DispatchTurn> {
    const body = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!body) throw new Error("Write a message first.");
    return this.#exclusive(async () => {
      this.#messages.push({ id: randomUUID(), from: "you", text: body });
      return this.#answer(body);
    });
  }

  /** Tries again: the message that got no answer, or else the draft as it stands. */
  redraft(): Promise<DispatchTurn> {
    return this.#exclusive(async () => {
      const last = this.#messages.at(-1);
      if (!last) return { ok: true, messages: [] };
      if (last.from === "you") return this.#answer(last.text);
      return this.#answer("Please show me the draft again, as it stands now.");
    });
  }

  /** Runs Dispatch on another engine. What was said so far is told to the new one. */
  move(engine: AgentProvider): Promise<DispatchTurn> {
    return this.#exclusive(async () => {
      await this.#close();
      this.#chosen = engine;
      this.#needsHistory = this.#messages.length > 0;
      const last = this.#messages.at(-1);
      if (last?.from === "you") return this.#answer(last.text);
      if (this.#engine() === null) {
        return this.#down(new DispatchDown("unavailable", "That engine is not signed in."));
      }
      return { ok: true, messages: this.#copy() };
    });
  }

  /** Recovers a bot from a file that could not be read. The file is only ever treated as text. */
  repairFile(
    text: string,
  ): Promise<{ ok: true; draft: BotDraft } | { ok: false; message: string }> {
    return this.#exclusive(async () => {
      const engine = this.#engine();
      if (engine === null) return { ok: false, message: "No engine is signed in." };
      let session: Session | null = null;
      try {
        session = await this.#start(engine, repairInstructions());
        const reply = await this.#turn(
          session,
          `The file, between the markers:\n<bot_file>\n${text.slice(0, MAX_FILE_LENGTH)}\n</bot_file>`,
        );
        const read = readDispatchReply(reply);
        const parsed = read.draft ? parseBotDraft(read.draft) : null;
        if (parsed?.ok) return { ok: true, draft: parsed.draft };
        return {
          ok: false,
          message:
            read.text || (parsed && !parsed.ok ? parsed.problem : "The file has no bot in it."),
        };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      } finally {
        if (session) await session.client.stop().catch(() => undefined);
      }
    });
  }

  /** Forgets the conversation, so the next bot starts from an empty one. */
  async reset(): Promise<void> {
    await this.#exclusive(async () => {
      this.#messages = [];
      this.#needsHistory = false;
      this.#chosen = null;
      await this.#close();
    });
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#close();
  }

  async #answer(text: string): Promise<DispatchTurn> {
    try {
      const engine = this.#engine();
      if (engine === null) throw new DispatchDown("unavailable", "No engine is signed in.");
      if (this.#session?.engine !== engine) {
        await this.#close();
        this.#needsHistory = this.#messages.length > 1;
      }
      this.#session ??= await this.#start(engine, dispatchInstructions(this.#deps.context()));
      // The last message is the one being answered, so it is not part of what came before.
      const before = this.#messages.slice(0, -1);
      const input =
        this.#needsHistory && before.length > 0
          ? `What was said so far in this conversation:\n\n${dispatchTranscript(before)}\n\nThe person now says:\n${text}`
          : text;
      const reply = await this.#turn(this.#session, input);
      this.#needsHistory = false;
      this.#messages.push(this.#message(reply));
      return { ok: true, messages: this.#copy() };
    } catch (error) {
      // A broken session is not kept: the next try starts a fresh one and is told the history.
      await this.#close();
      this.#needsHistory = true;
      return this.#down(error);
    }
  }

  #message(reply: string): DispatchMessage {
    const read = readDispatchReply(reply);
    const message: DispatchMessage = { id: randomUUID(), from: "dispatch", text: read.text };
    if (read.quickReplies.length > 0) message.quickReplies = read.quickReplies;
    if (read.draft) {
      const parsed = parseBotDraft(read.draft);
      if (parsed.ok) message.draft = parsed.draft;
    }
    if (!message.text && !message.draft) {
      throw new DispatchDown("failed", "Dispatch sent an empty answer.");
    }
    return message;
  }

  async #start(engine: AgentProvider, instructions: string): Promise<Session> {
    if (this.#stopped) throw new DispatchDown("unavailable", "Markas is shutting down.");
    let client: AgentClient;
    try {
      client = await this.#deps.createClient(engine);
    } catch (error) {
      throw new DispatchDown("unavailable", describe(error));
    }
    const session: Session = { engine, client, threadId: null, waiting: null };
    client.on("notification", (notification) => this.#heard(session, notification));
    client.on("request", (request) => refuse(client, request));
    client.once("exit", (error) => {
      if (session.waiting) {
        session.waiting.error ??= error.message;
        session.waiting.finish({ status: "failed" });
      }
      if (this.#session === session) this.#session = null;
    });
    try {
      client.start();
      await client.request("initialize", {
        clientInfo: { name: "markas", title: "Markas", version: MARKAS_VERSION },
        capabilities: { experimentalApi: true },
      });
      client.notify("initialized");
      const chosen = this.#deps.model(engine);
      const started = await client.request<ThreadResponse>("thread/start", {
        ...(chosen ? { model: chosen.model, effort: chosen.effort } : {}),
        cwd: this.#deps.workspace,
        runtimeWorkspaceRoots: [this.#deps.workspace],
        ...this.#access(engine, false),
        developerInstructions: instructions,
        ephemeral: true,
        serviceName: "markas",
      });
      session.threadId = started.thread.id;
      return session;
    } catch (error) {
      await client.stop().catch(() => undefined);
      throw new DispatchDown(
        LIMIT.test(describe(error)) ? "limit" : "unavailable",
        describe(error),
      );
    }
  }

  /** The most careful setting each engine has. Dispatch may read nothing and change nothing. */
  #access(engine: AgentProvider, turn: boolean): Record<string, unknown> {
    if (engine !== "codex") {
      return { markasAccess: { level: "ask", protectedRoots: [this.#deps.protectedRoot] } };
    }
    return turn
      ? { approvalPolicy: "never", sandboxPolicy: { type: "readOnly" } }
      : { approvalPolicy: "never", sandbox: "read-only" };
  }

  /** Sends one message and waits for the whole answer. */
  async #turn(session: Session, text: string): Promise<string> {
    const threadId = session.threadId;
    if (!threadId) throw new DispatchDown("failed", "Dispatch has no session.");
    const waiting: Waiting = { turnId: null, text: "", error: null, finish: () => undefined };
    const outcome = new Promise<{ status: string }>((resolve) => {
      waiting.finish = resolve;
    });
    session.waiting = waiting;
    const timer = setTimeout(() => {
      waiting.error = "Dispatch took too long to answer.";
      waiting.finish({ status: "failed" });
    }, this.#deps.turnTimeoutMs ?? DISPATCH_TURN_TIMEOUT_MS);
    try {
      const chosen = this.#deps.model(session.engine);
      const started = await session.client.request<TurnResponse>("turn/start", {
        threadId,
        ...(chosen ? { model: chosen.model, effort: chosen.effort } : {}),
        input: [{ type: "text", text }],
        cwd: this.#deps.workspace,
        runtimeWorkspaceRoots: [this.#deps.workspace],
        ...this.#access(session.engine, true),
      });
      waiting.turnId ??= started.turn.id;
      const { status } = await outcome;
      if (status !== "completed") {
        const reason = waiting.error ?? "Dispatch could not finish its answer.";
        throw new DispatchDown(LIMIT.test(reason) ? "limit" : "failed", reason);
      }
      return waiting.text;
    } catch (error) {
      if (error instanceof DispatchDown) throw error;
      throw new DispatchDown(LIMIT.test(describe(error)) ? "limit" : "failed", describe(error));
    } finally {
      clearTimeout(timer);
      session.waiting = null;
    }
  }

  #heard(session: Session, notification: AppServerNotification): void {
    const waiting = session.waiting;
    if (!waiting || getString(notification.params, "threadId") !== session.threadId) return;
    if (notification.method === "item/completed") {
      const item = getRecord(notification.params, "item");
      const text = getString(item, "text");
      // An engine may think aloud first; the last message it finishes is the answer.
      if (item?.type === "agentMessage" && text) waiting.text = text;
      return;
    }
    if (notification.method === "error") {
      waiting.error =
        getString(notification.params, "message") ??
        getString(getRecord(notification.params, "error"), "message") ??
        waiting.error;
      return;
    }
    if (notification.method === "turn/completed") {
      const turn = getRecord(notification.params, "turn");
      waiting.error ??= getString(getRecord(turn, "error"), "message");
      waiting.finish({ status: getString(turn, "status") ?? "failed" });
    }
  }

  /** The engine Dispatch runs on now: the one the person chose, else the first that is signed in. */
  #engine(): AgentProvider | null {
    const ready = this.#deps.engines();
    if (this.#chosen && ready.includes(this.#chosen)) return this.#chosen;
    return ready[0] ?? null;
  }

  #down(error: unknown): DispatchTurn {
    const reason = error instanceof DispatchDown ? error.reason : "failed";
    const current = this.#engine();
    const other = this.#deps.engines().find((engine) => engine !== current) ?? null;
    return {
      ok: false,
      reason,
      message: describe(error),
      engine: current,
      // Trying again on the same engine is offered for a broken turn; another engine otherwise.
      otherEngine: reason === "failed" ? null : other,
      messages: this.#copy(),
    };
  }

  #copy(): DispatchMessage[] {
    return structuredClone(this.#messages);
  }

  async #close(): Promise<void> {
    const session = this.#session;
    this.#session = null;
    if (session) await session.client.stop().catch(() => undefined);
  }

  /** One thing at a time: a second message while Dispatch is answering is refused, not queued. */
  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.#busy) throw new Error("Dispatch is still answering. Wait for it to finish.");
    this.#busy = true;
    try {
      return await work();
    } finally {
      this.#busy = false;
    }
  }
}

/** Dispatch may use no tool and is given no permission, whatever the engine asks for. */
function refuse(client: AgentClient, request: AppServerRequest): void {
  try {
    switch (request.method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        client.respond(request.id, { decision: "decline" });
        return;
      case "applyPatchApproval":
      case "execCommandApproval":
        client.respond(request.id, { decision: "denied" });
        return;
      case "item/permissions/requestApproval":
        client.respond(request.id, { permissions: {}, scope: "session" });
        return;
      case "item/permission/request":
        client.respond(request.id, { decision: "deny" });
        return;
      case "item/tool/call":
        client.respond(request.id, {
          success: false,
          contentItems: [{ type: "inputText", text: REFUSED }],
        });
        return;
      case "item/tool/requestUserInput":
        client.respond(request.id, { answers: {} });
        return;
      case "mcpServer/elicitation/request":
        client.respond(request.id, { action: "decline", content: null, _meta: null });
        return;
      case "currentTime/read":
        client.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1_000) });
        return;
      default:
        client.respondError(request.id, { code: -32601, message: REFUSED });
    }
  } catch {
    // The engine can exit between asking and being answered.
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
