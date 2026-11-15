import { execFile, spawn } from "node:child_process";
import { extname } from "node:path";

export interface RunOptions {
  /** Stops the program, and everything it started, when aborted. */
  signal?: AbortSignal;
  /** Stops the program after this long. Without it the program runs until it ends. */
  timeoutMs?: number;
  /** Called for every line the program prints, in order. */
  onLine?: (line: string) => void;
}

export interface ProcessOutcome {
  /** The exit code, or null when the program was stopped. */
  code: number | null;
  /** True when it was stopped through the signal. */
  aborted: boolean;
  /** True when it was stopped because it ran too long. */
  timedOut: boolean;
  /** The last lines it printed, for telling why it failed. Never shown as is. */
  output: string;
}

/** Why a program could not be started at all. */
export class ProcessStartError extends Error {
  constructor(
    message: string,
    readonly code: "not-found" | "not-permitted" | "failed",
  ) {
    super(message);
    this.name = "ProcessStartError";
  }
}

/**
 * The one way setup starts programs: installers, an engine's version check and an engine's
 * own sign-in. Tests replace it, so nothing is ever installed or opened in a test.
 */
export interface ProcessRunner {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<ProcessOutcome>;
}

/** How many of the last printed lines are kept. */
const TAIL_LINES = 60;
const MAX_LINE = 500;

const ESCAPE = String.fromCharCode(27);
/** A colour or cursor code: the escape character, a bracket, numbers, and one closing letter. */
const ANSI = new RegExp(`${ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/** Makes a printed line safe to show: no colour codes, no control characters, not endless. */
export function cleanLine(line: string): string {
  let text = "";
  for (const character of line.replace(ANSI, "")) {
    const code = character.charCodeAt(0);
    // A tab is kept; every other control character is dropped.
    if (code === 9 || (code >= 32 && code !== 127)) text += character;
  }
  return text.trimEnd().slice(0, MAX_LINE);
}

/** Starts real programs on this computer. */
export class NodeProcessRunner implements ProcessRunner {
  run(command: string, args: readonly string[], options: RunOptions = {}): Promise<ProcessOutcome> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        resolve({ code: null, aborted: true, timedOut: false, output: "" });
        return;
      }
      const windows = process.platform === "win32";
      // A .cmd or .bat file is not a program; Windows runs it through its command processor.
      const shim = windows && [".cmd", ".bat"].includes(extname(command).toLowerCase());
      const child = shim
        ? spawn(
            process.env.ComSpec?.trim() || "cmd.exe",
            ["/d", "/s", "/c", `""${command.replaceAll("%", "%%")}" ${args.join(" ")}"`],
            {
              windowsHide: true,
              windowsVerbatimArguments: true,
              stdio: ["ignore", "pipe", "pipe"],
            },
          )
        : spawn(command, [...args], {
            windowsHide: true,
            // Its own group, so stopping it also stops what it started.
            detached: !windows,
            stdio: ["ignore", "pipe", "pipe"],
          });

      const tail: string[] = [];
      let aborted = false;
      let timedOut = false;
      let settled = false;
      const pending = { stdout: "", stderr: "" };
      const take = (stream: "stdout" | "stderr", chunk: string, flush = false) => {
        const lines = (pending[stream] + chunk).split(/\r?\n|\r/);
        pending[stream] = flush ? "" : (lines.pop() ?? "");
        for (const raw of lines) {
          const line = cleanLine(raw);
          if (!line) continue;
          tail.push(line);
          if (tail.length > TAIL_LINES) tail.shift();
          options.onLine?.(line);
        }
      };
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => take("stdout", chunk));
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => take("stderr", chunk));

      const stop = () => {
        if (child.pid === undefined) return;
        if (windows) {
          execFile(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            { windowsHide: true },
            () => {
              // Already gone is fine.
            },
          );
          return;
        }
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      };
      const onAbort = () => {
        aborted = true;
        stop();
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            stop();
          }, options.timeoutMs)
        : null;
      const finish = () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };

      child.once("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        finish();
        const code =
          error.code === "ENOENT"
            ? "not-found"
            : error.code === "EACCES" || error.code === "EPERM"
              ? "not-permitted"
              : "failed";
        reject(new ProcessStartError(error.message, code));
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        finish();
        take("stdout", "\n", true);
        take("stderr", "\n", true);
        resolve({
          code: aborted || timedOut ? null : code,
          aborted,
          timedOut,
          output: tail.join("\n"),
        });
      });
    });
  }
}
