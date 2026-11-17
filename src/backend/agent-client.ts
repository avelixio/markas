import type { AgentProviderId, BotContextBreakdown } from "../shared/ipc";
import type { AppServerNotification, AppServerRequest, RequestId, RpcError } from "./protocol";

export type AgentProvider = AgentProviderId;

export interface AgentClient {
  readonly provider: AgentProvider;
  readonly running: boolean;
  start(): void;
  stop(): Promise<void>;
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>;
  notify(method: string, params?: unknown): void;
  respond(id: RequestId, result: unknown): void;
  respondError(id: RequestId, error: RpcError): void;
  /**
   * What fills a thread's context by kind, for an engine that can say.
   * Null when the thread has no live session to ask.
   */
  contextBreakdown?(threadId: string): Promise<Omit<BotContextBreakdown, "botId"> | null>;
  on(event: "notification", listener: (notification: AppServerNotification) => void): this;
  on(event: "request", listener: (request: AppServerRequest) => void): this;
  on(event: "diagnostic", listener: (message: string) => void): this;
  once(event: "exit", listener: (error: Error) => void): this;
}
