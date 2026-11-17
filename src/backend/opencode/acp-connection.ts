import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { redactDiagnostic } from "../app-server-client";
import { JsonLineDecoder } from "../jsonl";
import { isRecord, type RequestId, type RpcMessage } from "../protocol";

export interface ConnectionEvents {
  /** The agent tells us something and expects no answer. */
  notification: [method: string, params: unknown];
  /** The agent asks us something; it must be answered with `respond` or `respondError`. */
  request: [id: RequestId, method: string, params: unknown];
  diagnostic: [message: string];
  /** The program ended. Emitted once, and not after `stop`. */
  exit: [error: Error];
}

/**
 * One conversation partner speaking the Agent Client Protocol: JSON-RPC, one message per line.
 * The real one is a child process; tests put a fake in its place.
 */
export interface AcpConnection extends EventEmitter<ConnectionEvents> {
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>;
  notify(method: string, params: unknown): void;
  respond(id: RequestId, result: unknown): void;
  respondError(id: RequestId, code: number, message: string): void;
  stop(): Promise<void>;
}

export interface AcpStart {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type AcpConnector = (start: AcpStart) => AcpConnection;

export class AcpError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "AcpError";
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
}

/** Starts the program and speaks the protocol with it over its standard input and output. */
export class StdioAcpConnection extends EventEmitter<ConnectionEvents> implements AcpConnection {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #decoder = new JsonLineDecoder();
  readonly #pending = new Map<RequestId, Pending>();
  #nextId = 1;
  #ended = false;
  #stopping = false;

  constructor(start: AcpStart) {
    super();
    const viaShell = process.platform === "win32";
    this.#child = spawn(viaShell ? `"${start.executable}"` : start.executable, start.args, {
      cwd: start.cwd,
      env: start.env,
      stdio: ["pipe", "pipe", "pipe"],
      // On Windows the engines are usually small launcher scripts, which only a shell can start.
      shell: viaShell,
      windowsHide: true,
    });
    this.#child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const message of this.#decoder.push(chunk)) this.#handle(message);
      } catch (error) {
        this.#fail(new Error(`The engine sent something that could not be read: ${String(error)}`));
      }
    });
    this.#child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.emit("diagnostic", redactDiagnostic(text));
    });
    this.#child.stdin.on("error", () => undefined);
    this.#child.once("error", (error) => this.#fail(error));
    this.#child.once("exit", (code, signal) => {
      this.#fail(new Error(`The engine ended (${signal ? `signal ${signal}` : `code ${code}`}).`));
    });
  }

  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (this.#ended) return Promise.reject(new Error("The engine is not running."));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.#pending.delete(id);
            reject(new Error(`The engine did not answer in time: ${method}`));
          }, timeoutMs)
        : null;
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.#write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.#write({ jsonrpc: "2.0", method, params });
  }

  respond(id: RequestId, result: unknown): void {
    this.#write({ jsonrpc: "2.0", id, result });
  }

  respondError(id: RequestId, code: number, message: string): void {
    this.#write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#ended) return;
    const child = this.#child;
    const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    // The engine ends by itself when nobody is talking to it any more.
    child.stdin.end();
    const patient = await Promise.race([
      gone.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (patient) return;
    await killTree(child);
    await Promise.race([gone, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
    this.#fail(new Error("The engine was stopped."));
  }

  #write(message: unknown): void {
    if (this.#ended) return;
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handle(message: RpcMessage): void {
    if ("method" in message) {
      if ("id" in message && message.id !== undefined && message.id !== null) {
        this.emit("request", message.id, message.method, message.params);
      } else {
        this.emit("notification", message.method, message.params);
      }
      return;
    }
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      const code = typeof message.error.code === "number" ? message.error.code : -1;
      const text = typeof message.error.message === "string" ? message.error.message : "Unknown";
      pending.reject(new AcpError(text, code));
      return;
    }
    pending.resolve(message.result);
  }

  #fail(error: Error): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    if (!this.#stopping) this.emit("exit", error);
  }
}

/** Ends the program and everything it started. A shell on Windows does not pass a plain kill on. */
function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill("SIGKILL");
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () =>
      resolve(),
    );
  });
}
