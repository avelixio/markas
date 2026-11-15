import { EventEmitter } from "node:events";
import { type AccessScope, isAccessLevel, judgeTool, type StandingGrant } from "../access/policy";
import type { AgentClient, AgentProvider } from "../agent-client";
import type { AgentClientFactory } from "../agent-service";
import type { AppServerNotification, AppServerRequest, RequestId, RpcError } from "../protocol";

interface FakeTurn {
  id: string;
  status: string;
  items: Array<Record<string, unknown>>;
}

export interface FakeAgentClientOptions {
  provider?: AgentProvider;
  /** When set, every turn finishes on its own with this final answer. */
  autoReply?: string;
}

/**
 * An in-process engine that speaks the app-server contract AgentService expects.
 * It needs no executable, so tests using it run the same on every operating system.
 */
export class FakeAgentClient extends EventEmitter implements AgentClient {
  readonly provider: AgentProvider;
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: RequestId; result?: unknown; error?: RpcError }> = [];
  readonly #autoReply: string | undefined;
  readonly #turns = new Map<string, FakeTurn>();
  /** The access each thread's newest turn was started with, as the host sent it. */
  readonly #turnAccess = new Map<string, { scope: AccessScope; standing: StandingGrant[] }>();
  readonly #answers = new Map<RequestId, (result: unknown) => void>();
  #asks = 0;
  #running = false;
  #threads = 0;
  #turnCount = 0;

  constructor(options: FakeAgentClientOptions = {}) {
    super();
    this.provider = options.provider ?? "codex";
    this.#autoReply = options.autoReply;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.#running = false;
  }

  notify(): void {}

  respond(id: RequestId, result: unknown): void {
    this.responses.push({ id, result });
    this.#answers.get(id)?.(result);
    this.#answers.delete(id);
  }

  /**
   * Uses a tool during a thread's current turn the way the Claude engine does: the call is
   * judged by the same policy with what the host sent for the turn, a standing permission
   * that lets it through is reported, and anything else asks the host and waits.
   * Resolves to true when the tool call may go ahead.
   */
  async useTool(threadId: string, toolName: string, input: unknown): Promise<boolean> {
    const access = this.#turnAccess.get(threadId);
    if (!access) throw new Error("The thread has no turn to use a tool in.");
    const verdict = judgeTool(access.scope, toolName, input, access.standing);
    if (verdict.decision === "allow") {
      if (verdict.standing) {
        this.#notify("standing/used", { threadId, grant: verdict.standing });
      }
      return true;
    }
    this.#asks += 1;
    const id = `ask-${this.#asks}`;
    const answer = new Promise<unknown>((resolve) => this.#answers.set(id, resolve));
    this.sendRequest({
      id,
      method: "item/permission/request",
      params: { threadId, kind: verdict.kind, detail: verdict.detail, grant: verdict.grant },
    });
    const decision = ((await answer) as { decision?: string } | null)?.decision;
    return decision === "once" || decision === "chat";
  }

  respondError(id: RequestId, error: RpcError): void {
    this.responses.push({ id, error });
  }

  /** Sends a server-to-client request, as an engine does when it calls a host tool. */
  sendRequest(request: AppServerRequest): void {
    this.emit("request", request);
  }

  /** Finishes a turn with a final answer, as the engine would. */
  completeTurn(threadId: string, turnId: string, text: string): void {
    const item = { type: "agentMessage", id: `message-${turnId}`, text, phase: "final_answer" };
    const turn = this.#turns.get(turnId);
    if (turn) {
      turn.status = "completed";
      turn.items = [item];
    }
    this.#notify("item/completed", { threadId, turnId, item });
    this.#notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    this.requests.push({ method, params });
    return this.#answer(method, params as Record<string, string>) as T;
  }

  #answer(method: string, params: Record<string, string>): unknown {
    switch (method) {
      case "initialize":
        return {};
      case "account/read":
        return {
          account: { type: "chatgpt", email: "fake@example.com" },
          requiresOpenaiAuth: false,
        };
      case "account/rateLimits/read":
        return { rateLimits: null };
      case "model/list":
        return {
          data: [
            {
              model: "gpt-5.6-luna",
              displayName: "GPT-5.6 Luna",
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
            },
          ],
        };
      case "plugin/list":
        return { marketplaces: [] };
      case "thread/start": {
        this.#threads += 1;
        return { thread: { id: `thread-${this.#threads}`, turns: [] } };
      }
      case "thread/resume":
      case "thread/unarchive":
        return { thread: { id: params.threadId, turns: [] } };
      case "thread/read":
        return {
          thread: { id: params.threadId, turns: structuredClone([...this.#turns.values()]) },
        };
      case "turn/start": {
        this.#turnCount += 1;
        const turnId = `turn-${this.#turnCount}`;
        const threadId = params.threadId;
        this.#turnAccess.set(threadId, readTurnAccess(params));
        this.#turns.set(turnId, { id: turnId, status: "inProgress", items: [] });
        queueMicrotask(() => {
          this.#notify("turn/started", { threadId, turn: { id: turnId } });
          if (this.#autoReply !== undefined) {
            const reply = this.#autoReply;
            setTimeout(() => this.completeTurn(threadId, turnId, reply), 5);
          }
        });
        return { turn: { id: turnId, status: "inProgress", items: [] } };
      }
      case "turn/interrupt": {
        const turn = this.#turns.get(params.turnId);
        if (turn) turn.status = "interrupted";
        queueMicrotask(() =>
          this.#notify("turn/completed", {
            threadId: params.threadId,
            turn: { id: params.turnId, status: "interrupted" },
          }),
        );
        return {};
      }
      default:
        return {};
    }
  }

  #notify(method: string, params: unknown): void {
    const notification: AppServerNotification = { method, params };
    this.emit("notification", notification);
  }
}

function readTurnAccess(params: unknown): { scope: AccessScope; standing: StandingGrant[] } {
  const fields = (params ?? {}) as Record<string, unknown>;
  const given = (fields.markasAccess ?? {}) as Record<string, unknown>;
  const cwd = typeof fields.cwd === "string" ? fields.cwd : process.cwd();
  const roots = Array.isArray(fields.runtimeWorkspaceRoots)
    ? (fields.runtimeWorkspaceRoots as string[])
    : [];
  return {
    scope: {
      level: isAccessLevel(given.level) ? given.level : "ask",
      cwd,
      ownRoots: [cwd, ...roots],
      protectedRoots: Array.isArray(given.protectedRoots) ? (given.protectedRoots as string[]) : [],
    },
    standing: Array.isArray(given.standing) ? (given.standing as StandingGrant[]) : [],
  };
}

/** A client factory for AgentService that hands out fake engines and reports the rest missing. */
export function fakeClientFactory(clients: Partial<Record<AgentProvider, FakeAgentClient>>) {
  const factory: AgentClientFactory = async (provider) => {
    const client = clients[provider];
    if (!client) throw new Error(`${provider} is not installed in this test.`);
    return { client, cli: { executable: `fake-${provider}`, version: "0.0.0-fake" } };
  };
  return factory;
}
