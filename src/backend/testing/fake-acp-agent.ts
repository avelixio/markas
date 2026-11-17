import { EventEmitter } from "node:events";
import type { AcpConnection, AcpStart, ConnectionEvents } from "../opencode/acp-connection";
import type { RequestId } from "../protocol";

type Handler = (params: Record<string, unknown>) => unknown;

/**
 * Stands in for an OpenCode process in tests. It answers what the client asks through
 * `handlers`, and the test makes it say and ask things the way OpenCode does.
 */
export class FakeAcpAgent extends EventEmitter<ConnectionEvents> implements AcpConnection {
  readonly start: AcpStart;
  readonly asked: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly notices: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly handlers: Record<string, Handler> = {
    initialize: () => ({ protocolVersion: 1 }),
    "session/new": () => ({ sessionId: "ses_new" }),
    "session/load": () => ({}),
    "session/set_model": () => ({ _meta: { opencode: { availableVariants: ["high", "max"] } } }),
  };
  stopped = false;
  #nextId = 1;
  readonly #answers = new Map<RequestId, (answer: unknown) => void>();

  constructor(start: AcpStart) {
    super();
    this.start = start;
  }

  /** The settings the process was started with. */
  get settings(): Record<string, unknown> {
    return JSON.parse(this.start.env.OPENCODE_CONFIG_CONTENT ?? "{}");
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    const given = (params ?? {}) as Record<string, unknown>;
    this.asked.push({ method, params: given });
    const handler = this.handlers[method];
    if (!handler) throw new Error(`The fake agent has no answer for ${method}.`);
    return (await handler(given)) as T;
  }

  notify(method: string, params: unknown): void {
    this.notices.push({ method, params: (params ?? {}) as Record<string, unknown> });
  }

  respond(id: RequestId, result: unknown): void {
    this.#answers.get(id)?.(result);
    this.#answers.delete(id);
  }

  respondError(id: RequestId, _code: number, message: string): void {
    this.#answers.get(id)?.({ error: message });
    this.#answers.delete(id);
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  /** Says something about the session, the way OpenCode reports its progress. */
  update(sessionId: string, update: Record<string, unknown>): void {
    this.emit("notification", "session/update", { sessionId, update });
  }

  /** Asks the client something and gives back what it answered. */
  ask(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#answers.set(id, resolve);
      this.emit("request", id, method, params);
    });
  }

  /** Asks for permission the way OpenCode does, and gives back the option that was chosen. */
  async askPermission(sessionId: string, callId: string, permission: string): Promise<string> {
    const answer = (await this.ask("session/request_permission", {
      sessionId,
      toolCall: { toolCallId: callId, status: "pending", title: permission, rawInput: {} },
      options: [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ],
    })) as { outcome: { outcome: string; optionId?: string } };
    return answer.outcome.optionId ?? answer.outcome.outcome;
  }

  /** The process ends by itself. */
  die(message = "The engine ended (code 1)."): void {
    this.emit("exit", new Error(message));
  }
}
