import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, posix, win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MINIMUM_CODEX_VERSION = [0, 144, 1] as const;

export interface CodexCliInfo {
  executable: string;
  version: string;
}

export interface ClaudeCliInfo {
  executable: string;
  version: string;
}

export interface OpenCodeCliInfo {
  executable: string;
  version: string;
}

/** The engine programs Markas looks for, by the name they are started with. */
export type CliCommand = "codex" | "claude" | "opencode";

export class CodexCliError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid" | "outdated",
  ) {
    super(message);
    this.name = "CodexCliError";
  }
}

/** Programs the person pointed Markas at. They are looked at before the usual places. */
const preferredPaths = new Map<CliCommand, string>();

/** Makes detection try this program first. Null forgets it. */
export function preferCliPath(command: CliCommand, path: string | null): void {
  if (path?.trim()) preferredPaths.set(command, path.trim());
  else preferredPaths.delete(command);
}

export async function resolveCodexCli(): Promise<CodexCliInfo> {
  const candidates = await collectCandidates("codex", process.env.MARKAS_CODEX_PATH);
  const failures: CodexCliError[] = [];

  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;

    try {
      const stdout = await readCliVersion(candidate);
      const version = parseCodexVersion(stdout);
      if (!isMinimumVersion(version)) {
        throw new CodexCliError(
          `Codex CLI ${version} is too old. Markas requires 0.144.1 or newer.`,
          "outdated",
        );
      }

      return { executable: candidate, version };
    } catch (error) {
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError("Codex CLI was found but could not be started.", "invalid"),
      );
    }
  }

  const outdated = failures.find((failure) => failure.code === "outdated");
  if (outdated) throw outdated;
  if (failures.length > 0) {
    throw new CodexCliError(
      "Codex CLI was found but could not be started. Run `codex --version` in a new terminal.",
      "invalid",
    );
  }

  throw new CodexCliError(
    "Codex CLI was not found. Install Codex, run `codex login`, then restart Markas.",
    "missing",
  );
}

export async function resolveClaudeCli(): Promise<ClaudeCliInfo> {
  const candidates = await collectCandidates("claude", process.env.MARKAS_CLAUDE_PATH);
  let foundCandidate = false;

  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;
    foundCandidate = true;

    try {
      const stdout = await readCliVersion(candidate);
      return { executable: candidate, version: parseClaudeVersion(stdout) };
    } catch {
      // Try the next executable candidate.
    }
  }

  if (foundCandidate) {
    throw new CodexCliError(
      "Claude CLI was found but could not be started. Run `claude --version` in a new terminal.",
      "invalid",
    );
  }

  throw new CodexCliError(
    "Claude CLI was not found. Install Claude Code, run `claude auth login`, then restart Markas.",
    "missing",
  );
}

export async function resolveOpenCodeCli(): Promise<OpenCodeCliInfo> {
  const candidates = await collectCandidates("opencode", process.env.MARKAS_OPENCODE_PATH);
  let foundCandidate = false;

  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;
    foundCandidate = true;

    try {
      const stdout = await readCliVersion(candidate);
      return { executable: candidate, version: parseOpenCodeVersion(stdout) };
    } catch {
      // Try the next executable candidate.
    }
  }

  if (foundCandidate) {
    throw new CodexCliError(
      "OpenCode was found but could not be started. Run `opencode --version` in a new terminal.",
      "invalid",
    );
  }

  throw new CodexCliError(
    "OpenCode was not found. Install OpenCode, run `opencode auth login`, then restart Markas.",
    "missing",
  );
}

/** OpenCode prints its version as a bare number, sometimes with a pre-release tag. */
export function parseOpenCodeVersion(output: string): string {
  const match = output.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/m);
  if (!match) throw new CodexCliError("Unable to read the OpenCode version.", "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseCodexVersion(output: string): string {
  const match = output.match(/(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) throw new CodexCliError("Unable to read the Codex CLI version.", "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseClaudeVersion(output: string): string {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)(?:\s+\(Claude Code\))?/i);
  if (!match) throw new CodexCliError("Unable to read the Claude CLI version.", "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function isMinimumVersion(version: string): boolean {
  const parts = version.split(".").map(Number);
  for (let index = 0; index < MINIMUM_CODEX_VERSION.length; index += 1) {
    if (parts[index] > MINIMUM_CODEX_VERSION[index]) return true;
    if (parts[index] < MINIMUM_CODEX_VERSION[index]) return false;
  }
  return true;
}

async function collectCandidates(
  command: CliCommand,
  configuredPath: string | undefined,
): Promise<string[]> {
  const candidates: string[] = [];
  const override = configuredPath?.trim();
  if (override) return [override];
  const preferred = preferredPaths.get(command);
  if (preferred) candidates.push(preferred);

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", [command], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
      });
      candidates.push(
        ...stdout
          .split(/\r?\n/u)
          .map((path) => path.trim())
          .filter(Boolean),
      );
    } catch {
      // Known Windows install locations are checked next.
    }
    candidates.push(...windowsFallbackPaths(command));
  } else {
    candidates.push(...posixPathCandidates(command, process.env.PATH));
    // An app opened from the Dock or a desktop menu gets a short PATH, so the person's own login
    // shell is asked as well: it reads the files where installers add their folders.
    const shell = loginShellFor(process.platform, process.env.SHELL);
    const found = lastAbsolutePath(await askLoginShell(shell, `command -v ${command}`));
    if (found) candidates.push(found);
    candidates.push(...posixFallbackPaths(command));
  }

  return [...new Set(candidates)];
}

export function windowsFallbackPaths(
  command: CliCommand,
  userHome = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const paths: string[] = [];
  const appData = environment.APPDATA?.trim();
  const localAppData = environment.LOCALAPPDATA?.trim();

  if (command === "codex" && localAppData) {
    paths.push(win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
  }
  if (command === "claude" && localAppData) {
    paths.push(win32.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"));
  }
  if (command === "opencode") {
    paths.push(win32.join(userHome, ".opencode", "bin", "opencode.exe"));
  }
  if (appData) paths.push(win32.join(appData, "npm", `${command}.cmd`));
  paths.push(
    win32.join(userHome, ".local", "bin", `${command}.exe`),
    win32.join(userHome, ".bun", "bin", `${command}.exe`),
    win32.join(userHome, ".bun", "bin", `${command}.cmd`),
  );
  if (localAppData) {
    paths.push(
      win32.join(localAppData, "pnpm", `${command}.exe`),
      win32.join(localAppData, "pnpm", `${command}.cmd`),
    );
  }

  return paths;
}

/**
 * Runs one command in the person's interactive login shell and gives back what it printed, or
 * nothing when it fails or takes longer than five seconds.
 *
 * An interactive shell takes over the terminal it shares with Markas. When Markas runs in the
 * background of a terminal, that stops the shell and Markas with it, and a stopped shell never
 * answers a polite SIGTERM. So the shell gets a session of its own, with no terminal and nothing
 * to read, and is killed outright if it is late.
 */
function askLoginShell(shell: string, script: string): Promise<string> {
  return new Promise((resolve) => {
    let output = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, ["-lic", script], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve("");
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (output.length < 64 * 1024) output += chunk;
    });
    const finish = (text: string) => {
      clearTimeout(timer);
      resolve(text);
    };
    child.on("error", () => finish(""));
    child.on("close", (code) => finish(code === 0 ? output : ""));
  });
}

/** The program in each folder of PATH, in order, the way a terminal would look for it. */
export function posixPathCandidates(
  command: CliCommand,
  pathVariable: string | undefined,
): string[] {
  return (pathVariable ?? "")
    .split(":")
    .map((folder) => folder.trim())
    .filter((folder) => folder.startsWith("/"))
    .map((folder) => posix.join(folder, command));
}

/**
 * The person's own shell, which knows where their installers put programs. Most Linux computers
 * have no zsh, so it is only assumed on macOS, where it is the default.
 */
export function loginShellFor(platform: NodeJS.Platform, shell: string | undefined): string {
  const own = shell?.trim();
  if (own?.startsWith("/")) return own;
  return platform === "darwin" ? "/bin/zsh" : "/bin/sh";
}

/** A shell's startup files can print lines of their own; the answer is the last full path. */
export function lastAbsolutePath(output: string): string | null {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"));
  return lines.at(-1) ?? null;
}

function posixFallbackPaths(command: CliCommand): string[] {
  const paths = [join(homedir(), ".local", "bin", command)];
  if (command === "claude") paths.push(join(homedir(), ".claude", "local", "claude"));
  if (command === "opencode") paths.push(join(homedir(), ".opencode", "bin", "opencode"));
  paths.push(
    join(homedir(), ".bun", "bin", command),
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
    `/usr/bin/${command}`,
  );
  return paths;
}

async function readCliVersion(candidate: string): Promise<string> {
  if (process.platform === "win32" && [".bat", ".cmd"].includes(extname(candidate).toLowerCase())) {
    const commandProcessor = process.env.ComSpec?.trim() || "cmd.exe";
    const escapedCandidate = candidate.replaceAll("%", "%%");
    const { stdout } = await execFileAsync(
      commandProcessor,
      ["/d", "/s", "/c", `""${escapedCandidate}" --version"`],
      {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    );
    return stdout;
  }

  const { stdout } = await execFileAsync(candidate, ["--version"], {
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    windowsHide: process.platform === "win32",
  });
  return stdout;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
