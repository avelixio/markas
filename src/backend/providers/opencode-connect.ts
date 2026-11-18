import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { redactDiagnostic } from "../app-server-client";
import { isRecord } from "../protocol";

/** One way to sign in to a provider, as OpenCode describes it. */
export interface SignInMethod {
  /** Its place in OpenCode's list, which is how OpenCode is told which one was chosen. */
  index: number;
  kind: "browser" | "key";
  label: string;
  /** Questions to answer first, such as which deployment to use. */
  questions: Array<{
    key: string;
    message: string;
    kind: "text" | "select";
    options: Array<{ label: string; value: string }>;
    placeholder: string | null;
    /** Asked only when an earlier answer has this value. */
    when: { key: string; value: string } | null;
  }>;
}

/** A model provider OpenCode can use, as the Providers page shows it. */
export interface OpenCodeProvider {
  id: string;
  name: string;
  connected: boolean;
  models: number;
  methods: SignInMethod[];
}

/** What starting a browser sign-in gives back. */
export interface BrowserSignIn {
  url: string;
  /** "wait": the browser tells OpenCode by itself. "code": the page shows a code to paste back. */
  finish: "wait" | "code";
  instructions: string;
}

export interface OpenCodeConnectOptions {
  /** The OpenCode program to start. */
  executable: () => Promise<string>;
  /** Settings given to OpenCode, such as the local model servers the person connected. */
  settings?: () => Record<string, unknown>;
  /** How long the server is kept after it was last used. */
  idleMs?: number;
  fetchImpl?: typeof fetch;
}

const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** A browser sign-in waits this long for the person before it gives up. */
const SIGN_IN_WAIT_MS = 5 * 60_000;
const IDLE_MS = 2 * 60_000;
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;

interface Server {
  child: ChildProcess;
  url: string;
  authorization: string;
}

/**
 * Connects model providers to OpenCode from inside Markas, the way OpenCode's own app does.
 * It runs OpenCode's local server only while it is needed, on this computer only and behind a
 * password made for that run. Sign-ins and keys are kept by OpenCode, never by Markas.
 */
export class OpenCodeConnect {
  readonly #options: OpenCodeConnectOptions;
  readonly #fetch: typeof fetch;
  #server: Promise<Server> | null = null;
  #idle: NodeJS.Timeout | null = null;
  #busy = 0;
  /** Providers whose sign-in the person cancelled while Markas waited for the browser. */
  readonly #cancelled = new Set<string>();

  constructor(options: OpenCodeConnectOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  /** Every provider OpenCode knows, the connected ones first. */
  async providers(): Promise<OpenCodeProvider[]> {
    const [listed, auth] = await Promise.all([
      this.#call<unknown>("GET", "/provider"),
      this.#call<unknown>("GET", "/provider/auth"),
    ]);
    const all = isRecord(listed) && Array.isArray(listed.all) ? listed.all.filter(isRecord) : [];
    const connected = new Set(
      isRecord(listed) && Array.isArray(listed.connected)
        ? listed.connected.filter((id): id is string => typeof id === "string")
        : [],
    );
    const methods = isRecord(auth) ? auth : {};
    const rows: OpenCodeProvider[] = all.flatMap((provider) => {
      if (typeof provider.id !== "string") return [];
      const id = provider.id;
      const own = Array.isArray(methods[id]) ? (methods[id] as unknown[]) : [];
      return [
        {
          id,
          name: typeof provider.name === "string" && provider.name ? provider.name : id,
          connected: connected.has(id),
          models: isRecord(provider.models) ? Object.keys(provider.models).length : 0,
          // A provider OpenCode lists no way in for still takes a key.
          methods: own.length > 0 ? own.map(readMethod) : [keyMethod(0)],
        },
      ];
    });
    return rows.sort(
      (a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name),
    );
  }

  /** Starts a browser sign-in and gives the page to open. */
  async startSignIn(
    providerId: string,
    method: number,
    answers: Record<string, string> = {},
  ): Promise<BrowserSignIn> {
    this.#cancelled.delete(providerId);
    const answer = await this.#call<unknown>(
      "POST",
      `/provider/${checkedId(providerId)}/oauth/authorize`,
      { method, inputs: answers },
    );
    if (!isRecord(answer) || typeof answer.url !== "string" || !/^https?:\/\//.test(answer.url)) {
      throw new Error("OpenCode did not give a sign-in page for this provider.");
    }
    return {
      url: answer.url,
      finish: answer.method === "code" ? "code" : "wait",
      instructions: typeof answer.instructions === "string" ? answer.instructions : "",
    };
  }

  /**
   * Finishes a browser sign-in: waits for the browser, or hands over the code the page showed.
   * True once OpenCode says the provider is connected.
   */
  async finishSignIn(providerId: string, method: number, code?: string): Promise<boolean> {
    try {
      const answer = await this.#call<unknown>(
        "POST",
        `/provider/${checkedId(providerId)}/oauth/callback`,
        { method, ...(code ? { code: code.trim() } : {}) },
        SIGN_IN_WAIT_MS,
      );
      return answer === true || (isRecord(answer) && answer.success !== false);
    } catch (error) {
      // A wait the person cancelled is not a failure: it simply did not connect.
      if (this.#cancelled.delete(providerId)) return false;
      throw error;
    }
  }

  /**
   * Stops waiting for a browser sign-in. OpenCode has no way to call one off, so its server is
   * stopped, which ends the wait; the next request starts it again.
   */
  async cancelSignIn(providerId: string): Promise<void> {
    this.#cancelled.add(providerId);
    await this.stop();
  }

  /** Gives OpenCode a key for a provider. The key goes to OpenCode only; Markas does not keep it. */
  async saveKey(providerId: string, key: string): Promise<void> {
    const value = key.trim();
    if (!value) throw new Error("Paste the key first.");
    if (value.length > 4_096) throw new Error("That key is too long.");
    await this.#call("PUT", `/auth/${checkedId(providerId)}`, { type: "api", key: value });
  }

  /** Forgets OpenCode's sign-in for a provider. */
  async disconnect(providerId: string): Promise<void> {
    await this.#call("DELETE", `/auth/${checkedId(providerId)}`);
  }

  async stop(): Promise<void> {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    const running = await server.catch(() => null);
    if (running) await killTree(running.child);
  }

  async #call<T>(method: string, path: string, body?: unknown, timeoutMs = REQUEST_TIMEOUT_MS) {
    this.#busy += 1;
    if (this.#idle) clearTimeout(this.#idle);
    try {
      const server = await this.#ensure();
      const response = await this.#fetch(`${server.url}${path}`, {
        method,
        headers: {
          authorization: server.authorization,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(problemOf(text, response.status));
      return (text ? JSON.parse(text) : null) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("OpenCode took too long to answer. Try again.");
      }
      throw error;
    } finally {
      this.#busy -= 1;
      if (this.#busy === 0) {
        this.#idle = setTimeout(() => void this.stop(), this.#options.idleMs ?? IDLE_MS);
        this.#idle.unref?.();
      }
    }
  }

  #ensure(): Promise<Server> {
    if (!this.#server) {
      this.#server = this.#start().catch((error) => {
        this.#server = null;
        throw error;
      });
    }
    return this.#server;
  }

  async #start(): Promise<Server> {
    const executable = await this.#options.executable();
    const password = randomBytes(24).toString("base64url");
    const settings = this.#options.settings?.() ?? {};
    const viaShell = process.platform === "win32";
    const child = spawn(
      viaShell ? `"${executable}"` : executable,
      ["serve", "--port", "0", "--hostname", "127.0.0.1"],
      {
        env: {
          ...process.env,
          OPENCODE_SERVER_USERNAME: "markas",
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          ...(Object.keys(settings).length > 0
            ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(settings) }
            : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
        shell: viaShell,
        windowsHide: true,
      },
    );
    const url = await new Promise<string>((resolve, reject) => {
      let printed = "";
      const timer = setTimeout(() => {
        reject(new Error("OpenCode did not start in time. Run `opencode serve` to see why."));
      }, START_TIMEOUT_MS);
      const read = (chunk: Buffer) => {
        printed += chunk.toString("utf8");
        const found = printed.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (found) {
          clearTimeout(timer);
          resolve(found[1]);
        }
      };
      child.stdout?.on("data", read);
      child.stderr?.on("data", read);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(
          new Error(
            `OpenCode stopped before it was ready (code ${code}). ${redactDiagnostic(printed.trim())}`.trim(),
          ),
        );
      });
    }).catch(async (error) => {
      await killTree(child);
      throw error;
    });
    child.once("exit", () => {
      this.#server = null;
    });
    return {
      child,
      url,
      authorization: `Basic ${Buffer.from(`markas:${password}`).toString("base64")}`,
    };
  }
}

function readMethod(value: unknown, index: number): SignInMethod {
  const method = isRecord(value) ? value : {};
  const questions = Array.isArray(method.prompts) ? method.prompts.filter(isRecord) : [];
  return {
    index,
    kind: method.type === "oauth" ? "browser" : "key",
    label: typeof method.label === "string" ? method.label : "Sign in",
    questions: questions.flatMap((question) =>
      typeof question.key === "string"
        ? [
            {
              key: question.key,
              message: typeof question.message === "string" ? question.message : question.key,
              kind: question.type === "select" ? ("select" as const) : ("text" as const),
              options: Array.isArray(question.options)
                ? question.options.filter(isRecord).flatMap((option) =>
                    typeof option.value === "string"
                      ? [
                          {
                            value: option.value,
                            label: typeof option.label === "string" ? option.label : option.value,
                          },
                        ]
                      : [],
                  )
                : [],
              placeholder: typeof question.placeholder === "string" ? question.placeholder : null,
              when:
                isRecord(question.when) &&
                typeof question.when.key === "string" &&
                typeof question.when.value === "string"
                  ? { key: question.when.key, value: question.when.value }
                  : null,
            },
          ]
        : [],
    ),
  };
}

function keyMethod(index: number): SignInMethod {
  return { index, kind: "key", label: "API key", questions: [] };
}

function checkedId(providerId: string): string {
  if (!PROVIDER_ID.test(providerId)) throw new Error("That is not a provider OpenCode knows.");
  return encodeURIComponent(providerId);
}

/** OpenCode's own words for what went wrong, when it gave any. */
function problemOf(text: string, status: number): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body)) {
      const data = isRecord(body.data) ? body.data : body;
      if (typeof data.message === "string" && data.message) return redactDiagnostic(data.message);
      if (isRecord(body.error) && typeof body.error.message === "string") {
        return redactDiagnostic(body.error.message);
      }
    }
  } catch {
    // Not JSON: say what is known.
  }
  return `OpenCode refused the request (${status}).`;
}

function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill("SIGTERM");
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () =>
      resolve(),
    );
  });
}
