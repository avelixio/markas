import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type {
  AgentModelOption,
  AgentProviderId,
  AgentProviderStatus,
  DesktopPlatform,
  SetupEngineStatus,
  SetupEvent,
  SetupInstallCommand,
  SetupInstallFailure,
  SetupInstallResult,
  SetupLocateResult,
  SetupModels,
  SetupSignInState,
} from "../../shared/ipc";
import {
  classifyInstallFailure,
  ENGINE_NAMES,
  installCommand,
  installFailureMessage,
  installPlan,
  signInArgs,
  signInCommand,
} from "./engine-install";
import { type ProcessRunner, ProcessStartError } from "./process-runner";

export const ENGINES: readonly AgentProviderId[] = ["claude", "codex"];

/** How long setup waits for the person to finish signing in before it gives up. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const SIGN_IN_POLL_MS = 3_000;
/** An installer that prints nothing for this long in total is stopped. */
const INSTALL_TIMEOUT_MS = 15 * 60_000;
const VERSION_TIMEOUT_MS = 10_000;

/**
 * What setup needs from the part of Markas that already finds and talks to the engines.
 * Setup never looks for an engine itself, so there is one answer to "is it ready".
 */
export interface EngineProbe {
  /** Looks for the engine again and says what it found. */
  check(engine: AgentProviderId): Promise<AgentProviderStatus>;
  /** The program detection would start for this engine. Rejects when there is none. */
  executable(engine: AgentProviderId): Promise<string>;
  /** The engine's models. `listed` is false when the engine could not list them itself. */
  models(engine: AgentProviderId): { models: AgentModelOption[]; listed: boolean };
  /** Makes detection look at this program first from now on. Null forgets it. */
  prefer(engine: AgentProviderId, path: string | null): void;
}

export interface EngineSetupOptions {
  runner: ProcessRunner;
  probe: EngineProbe;
  emit: (event: SetupEvent) => void;
  /** Keeps a located program across restarts. */
  remember: (engine: AgentProviderId, path: string) => Promise<void>;
  /** Where a located program was last remembered, for showing it. */
  remembered?: (engine: AgentProviderId) => string | null;
  platform?: DesktopPlatform;
  now?: () => number;
  /** Waits between two looks at whether the person has signed in. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** True when the path is an existing file. */
  isFile?: (path: string) => Promise<boolean>;
  signInTimeoutMs?: number;
}

/**
 * The parts of setup that act on an engine: say how it stands, install it, accept a
 * program the person points at, start its own sign-in and wait for it, and list its models.
 * It never reads, asks for or stores an engine's password or token: signing in is always
 * the engine's own flow, and all setup learns is whether it worked.
 */
export class EngineSetup {
  readonly #options: EngineSetupOptions;
  readonly #platform: DesktopPlatform;
  readonly #installs = new Map<AgentProviderId, AbortController>();
  readonly #signIns = new Map<AgentProviderId, AbortController>();

  constructor(options: EngineSetupOptions) {
    this.#options = options;
    this.#platform = options.platform ?? (process.platform as DesktopPlatform);
  }

  /** How one engine stands right now. */
  async status(engine: AgentProviderId): Promise<SetupEngineStatus> {
    const path = this.#options.remembered?.(engine) ?? null;
    try {
      return toSetupStatus(engine, await this.#options.probe.check(engine), path);
    } catch (error) {
      return {
        engine,
        state: "error",
        version: null,
        email: null,
        message: plain(error),
        path,
      };
    }
  }

  statuses(): Promise<SetupEngineStatus[]> {
    return Promise.all(ENGINES.map((engine) => this.status(engine)));
  }

  installCommand(engine: AgentProviderId): SetupInstallCommand {
    return installCommand(engine, this.#platform);
  }

  signInCommand(engine: AgentProviderId): { engine: AgentProviderId; command: string } {
    return { engine, command: signInCommand(engine) };
  }

  /**
   * Installs the engine with its maker's own installer and says how it went.
   * Every line the installer prints is passed on as an event while it runs.
   */
  async install(engine: AgentProviderId): Promise<SetupInstallResult> {
    const manual = this.installCommand(engine);
    const failed = (reason: SetupInstallFailure, needs = ""): SetupInstallResult => ({
      result: "failed",
      engine,
      reason,
      message: installFailureMessage(engine, reason, needs),
      command: manual.command,
    });
    if (this.#installs.has(engine)) return failed("already-running");

    const controller = new AbortController();
    this.#installs.set(engine, controller);
    const finish = (result: SetupInstallResult): SetupInstallResult => {
      this.#options.emit({ type: "install-finished", engine, result });
      return result;
    };
    try {
      this.#options.emit({ type: "install-started", engine, command: manual.command });
      let missing = "";
      for (const step of installPlan(engine, this.#platform)) {
        this.#progress(engine, `Running: ${step.manual}`);
        let outcome: Awaited<ReturnType<ProcessRunner["run"]>>;
        try {
          outcome = await this.#options.runner.run(step.command, step.args, {
            signal: controller.signal,
            timeoutMs: INSTALL_TIMEOUT_MS,
            onLine: (line) => this.#progress(engine, line),
          });
        } catch (error) {
          if (error instanceof ProcessStartError && error.code === "not-found") {
            // The tool this way needs is not here. Try the next way.
            missing = step.needs;
            continue;
          }
          if (error instanceof ProcessStartError && error.code === "not-permitted") {
            return finish(failed("no-permission"));
          }
          return finish(failed("unknown"));
        }
        if (outcome.aborted) {
          return finish({ result: "cancelled", engine, command: manual.command });
        }
        if (outcome.timedOut) return finish(failed("no-internet"));

        if (outcome.code === 0) {
          const status = await this.status(engine);
          if (status.state !== "not-installed") {
            return finish({ result: "installed", engine, status, command: manual.command });
          }
        }
        // A piped installer can end "well" although its download failed, so what it
        // printed is read in both cases.
        const reason = classifyInstallFailure(outcome);
        if (reason === "missing-tool") {
          missing = step.needs;
          continue;
        }
        if (outcome.code === 0 && reason === "unknown") {
          return finish(failed("not-found-after-install"));
        }
        return finish(failed(reason));
      }
      // Every way was missing its tool; the last one is the npm package.
      return finish(failed("node-missing", missing));
    } finally {
      this.#installs.delete(engine);
    }
  }

  /** Stops a running install. True when there was one. */
  cancelInstall(engine: AgentProviderId): boolean {
    const running = this.#installs.get(engine);
    running?.abort();
    return running !== undefined;
  }

  /**
   * Accepts a program the person points at, after making sure it really is that engine by
   * asking it for its version, and remembers it.
   */
  async locate(engine: AgentProviderId, path: string): Promise<SetupLocateResult> {
    const name = ENGINE_NAMES[engine];
    const target = path.trim().replace(/^"(.*)"$/, "$1");
    const refuse = (result: "missing" | "wrong-binary", message: string): SetupLocateResult => ({
      result,
      engine,
      message,
    });
    if (!target || !isAbsolute(target)) {
      return refuse("missing", `Give the full path of the ${name} program.`);
    }
    if (!(await (this.#options.isFile ?? isFile)(target))) {
      return refuse("missing", `There is no program at ${target}.`);
    }
    let printed: string;
    try {
      const outcome = await this.#options.runner.run(target, ["--version"], {
        timeoutMs: VERSION_TIMEOUT_MS,
      });
      if (outcome.code !== 0) {
        return refuse(
          "wrong-binary",
          `${target} did not answer like ${name}. Choose another file.`,
        );
      }
      printed = outcome.output;
    } catch {
      return refuse("wrong-binary", `${target} could not be started. Choose another file.`);
    }
    const version = readEngineVersion(engine, printed);
    if (!version) {
      return refuse("wrong-binary", `${target} is not ${name}. Choose the ${name} program.`);
    }
    await this.#options.remember(engine, target);
    this.#options.probe.prefer(engine, target);
    return { result: "located", engine, path: target, version, status: await this.status(engine) };
  }

  /**
   * Starts the engine's own sign-in, which opens the browser, and then watches until the
   * engine says it is signed in. Returns at once; what happens next arrives as events.
   */
  async signIn(engine: AgentProviderId): Promise<SetupSignInState> {
    const command = signInCommand(engine);
    if (this.#signIns.has(engine)) return this.#signInState(engine, "waiting", null, null);
    const before = await this.status(engine);
    if (before.state === "signed-in") {
      return this.#signInState(engine, "signed-in", null, before.email);
    }
    if (before.state !== "not-signed-in") {
      return this.#signInState(
        engine,
        "failed",
        before.message ?? `${ENGINE_NAMES[engine]} is not ready to sign in.`,
        null,
      );
    }
    let executable: string;
    try {
      executable = await this.#options.probe.executable(engine);
    } catch (error) {
      return this.#signInState(engine, "failed", plain(error), null);
    }

    const controller = new AbortController();
    this.#signIns.set(engine, controller);
    // What the engine prints while signing in is not read or kept: it is the engine's business.
    const login = this.#options.runner
      .run(executable, signInArgs(engine), { signal: controller.signal })
      .then(
        (outcome) => ({ started: true, code: outcome.code }),
        () => ({ started: false, code: null }),
      );
    void this.#watchSignIn(engine, controller, login, command);
    return this.#signInState(engine, "waiting", null, null);
  }

  /** Stops waiting for a sign-in. True when one was being waited for. */
  cancelSignIn(engine: AgentProviderId): boolean {
    const waiting = this.#signIns.get(engine);
    waiting?.abort();
    return waiting !== undefined;
  }

  /**
   * The models of an engine that is ready. When the engine cannot list them, a small
   * built-in list is returned and marked, so setup can carry on.
   */
  async models(engine: AgentProviderId): Promise<SetupModels> {
    const status = await this.status(engine);
    if (status.state !== "signed-in") {
      throw new Error(`Sign in to ${ENGINE_NAMES[engine]} before choosing a model.`);
    }
    const { models, listed } = this.#options.probe.models(engine);
    return { engine, models, fallback: !listed };
  }

  /** Stops everything setup started. */
  stop(): void {
    for (const controller of [...this.#installs.values(), ...this.#signIns.values()]) {
      controller.abort();
    }
  }

  async #watchSignIn(
    engine: AgentProviderId,
    controller: AbortController,
    login: Promise<{ started: boolean; code: number | null }>,
    command: string,
  ): Promise<void> {
    const now = this.#options.now ?? Date.now;
    const wait = this.#options.wait ?? sleep;
    const deadline = now() + (this.#options.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS);
    let ended: { started: boolean; code: number | null } | null = null;
    void login.then((result) => {
      ended = result;
    });
    const end = (
      state: SetupSignInState["state"],
      message: string | null,
      email: string | null,
    ) => {
      this.#signIns.delete(engine);
      // The engine's sign-in program is no longer needed, whichever way this ended.
      controller.abort();
      this.#options.emit({ type: "sign-in", ...this.#signInState(engine, state, message, email) });
    };
    try {
      for (;;) {
        // Give the engine's sign-in a moment to end by itself before the first look.
        await Promise.race([wait(SIGN_IN_POLL_MS, controller.signal), login]);
        if (controller.signal.aborted) return end("cancelled", null, null);
        const status = await this.status(engine);
        if (controller.signal.aborted) return end("cancelled", null, null);
        if (status.state === "signed-in") return end("signed-in", null, status.email);
        const finished = ended as { started: boolean; code: number | null } | null;
        if (finished && (!finished.started || finished.code !== 0)) {
          return end(
            "failed",
            `${ENGINE_NAMES[engine]} could not open its sign-in. Run \`${command}\` in a terminal instead.`,
            null,
          );
        }
        if (now() >= deadline) {
          return end(
            "timed-out",
            `Markas waited 5 minutes and ${ENGINE_NAMES[engine]} is still not signed in. Try again, or run \`${command}\` in a terminal.`,
            null,
          );
        }
        // The sign-in program has ended well but the engine is not signed in yet: keep looking.
        if (finished) await wait(SIGN_IN_POLL_MS, controller.signal);
      }
    } catch (error) {
      end(controller.signal.aborted ? "cancelled" : "failed", plain(error), null);
    }
  }

  #signInState(
    engine: AgentProviderId,
    state: SetupSignInState["state"],
    message: string | null,
    email: string | null,
  ): SetupSignInState {
    return { engine, state, message, email, command: signInCommand(engine) };
  }

  #progress(engine: AgentProviderId, line: string): void {
    this.#options.emit({ type: "install-progress", engine, line });
  }
}

/** Turns what detection found into the five states setup shows. */
export function toSetupStatus(
  engine: AgentProviderId,
  found: AgentProviderStatus,
  path: string | null,
): SetupEngineStatus {
  const name = ENGINE_NAMES[engine];
  const base = { engine, version: found.version, email: null, path };
  switch (found.state) {
    case "available":
      return { ...base, state: "signed-in", email: found.email ?? null, message: null };
    case "sign-in-required":
      return {
        ...base,
        state: "not-signed-in",
        message: `${name} is installed but not signed in.`,
      };
    case "not-installed":
      return {
        ...base,
        state: "not-installed",
        version: null,
        message: `${name} is not installed on this computer.`,
      };
    case "outdated":
      return {
        ...base,
        state: "outdated",
        message: found.message ?? `${name} is too old for Markas. Update it and try again.`,
      };
    case "error":
      return {
        ...base,
        state: "error",
        message: found.message ?? `${name} could not be started.`,
      };
    default:
      return {
        ...base,
        state: "error",
        message: `Markas could not finish checking ${name}. Try again.`,
      };
  }
}

/**
 * The version a program printed, when it printed it the way this engine does.
 * A bare number is not enough: another program must not pass for the engine.
 */
export function readEngineVersion(engine: AgentProviderId, printed: string): string | null {
  const pattern =
    engine === "claude"
      ? /(\d+\.\d+\.\d+)\s*\(Claude Code\)/i
      : /\bcodex(?:-cli)?\s+v?(\d+\.\d+\.\d+)/i;
  return printed.match(pattern)?.[1] ?? null;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

const plain = (error: unknown): string => (error instanceof Error ? error.message : String(error));
