import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import type { BrowserTarget } from "./driver";

/**
 * Where the bot browser comes from.
 * Small on purpose, so tests can stand in for the computer and for the download.
 */
export interface BrowserFinder {
  /** Installed browsers Markas may drive, the preferred one first. */
  installed(): BrowserTarget[];
  /** The Chromium Markas downloaded earlier, or null. */
  downloaded(): BrowserTarget | null;
  /** Downloads Chromium into Markas's own folder. Rejects with a plain reason. */
  download(): Promise<BrowserTarget>;
}

export interface SystemBrowserFinderOptions {
  /** Where a downloaded Chromium is kept: `~/.markas/browsers`. */
  browsersRoot: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  /** Runs the download; injectable so tests need no network. */
  runDownload?: (browsersRoot: string) => Promise<void>;
}

const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const CHROMIUM_EXECUTABLES = new Set([
  "chrome.exe",
  "chrome",
  "Chromium",
  "Google Chrome for Testing",
]);

/** Finds Chrome, then Edge, and downloads Chromium only when asked to. */
export class SystemBrowserFinder implements BrowserFinder {
  readonly #root: string;
  readonly #platform: NodeJS.Platform;
  readonly #env: NodeJS.ProcessEnv;
  readonly #exists: (path: string) => boolean;
  readonly #runDownload: (browsersRoot: string) => Promise<void>;
  #download: Promise<BrowserTarget> | null = null;

  constructor(options: SystemBrowserFinderOptions) {
    this.#root = options.browsersRoot;
    this.#platform = options.platform ?? process.platform;
    this.#env = options.env ?? process.env;
    this.#exists = options.exists ?? existsSync;
    this.#runDownload = options.runDownload ?? downloadChromium;
  }

  installed(): BrowserTarget[] {
    const targets: BrowserTarget[] = [];
    const chosen = this.#env.MARKAS_BOT_BROWSER?.trim();
    if (chosen && this.#exists(chosen)) {
      targets.push({ kind: "executable", path: chosen, label: "the browser you chose" });
    }
    const paths = installPaths(this.#platform, this.#env);
    if (paths.chrome.some((path) => this.#exists(path))) {
      targets.push({ kind: "channel", channel: "chrome", label: "Chrome" });
    }
    if (paths.msedge.some((path) => this.#exists(path))) {
      targets.push({ kind: "channel", channel: "msedge", label: "Edge" });
    }
    return targets;
  }

  downloaded(): BrowserTarget | null {
    const path = findChromium(this.#root);
    return path ? { kind: "executable", path, label: "Markas's own Chromium" } : null;
  }

  download(): Promise<BrowserTarget> {
    // Two bots that need a browser at once share one download.
    this.#download ??= this.#fetch().finally(() => {
      this.#download = null;
    });
    return this.#download;
  }

  async #fetch(): Promise<BrowserTarget> {
    await mkdir(this.#root, { recursive: true });
    await this.#runDownload(this.#root);
    const target = this.downloaded();
    if (!target) throw new Error("the download finished but no browser was found in it");
    return target;
  }
}

/** The places Chrome and Edge install themselves, per operating system. */
export function installPaths(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { chrome: string[]; msedge: string[] } {
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
      (root): root is string => Boolean(root),
    );
    return {
      chrome: roots.map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe")),
      msedge: roots.map((root) => join(root, "Microsoft", "Edge", "Application", "msedge.exe")),
    };
  }
  if (platform === "darwin") {
    const roots = ["/Applications", posix.join(env.HOME ?? homedir(), "Applications")];
    return {
      chrome: roots.map((root) =>
        posix.join(root, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      ),
      msedge: roots.map((root) =>
        posix.join(root, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
      ),
    };
  }
  return {
    chrome: ["/opt/google/chrome/chrome"],
    msedge: ["/opt/microsoft/msedge/msedge"],
  };
}

/** Looks for the browser inside a `chromium-<build>` folder of the download folder. */
export function findChromium(browsersRoot: string): string | null {
  const builds = list(browsersRoot)
    .filter((name) => /^chromium-\d+$/.test(name))
    // The newest build first.
    .sort((left, right) => Number(right.slice(9)) - Number(left.slice(9)));
  for (const build of builds) {
    const found = search(join(browsersRoot, build), 5);
    if (found) return found;
  }
  return null;
}

function search(folder: string, depth: number): string | null {
  const names = list(folder);
  const direct = names.find((name) => CHROMIUM_EXECUTABLES.has(name));
  if (direct && isFile(join(folder, direct))) return join(folder, direct);
  if (depth === 0) return null;
  for (const name of names) {
    if (!/^chrome-|\.app$|^Contents$|^MacOS$/.test(name)) continue;
    const found = search(join(folder, name), depth - 1);
    if (found) return found;
  }
  return null;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function list(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch {
    return [];
  }
}

/** Runs the driving library's own installer, pointed at Markas's folder. */
function downloadChromium(browsersRoot: string): Promise<void> {
  let cli: string;
  try {
    const require = createRequire(import.meta.url);
    cli = join(dirname(require.resolve("playwright-core/package.json")), "cli.js");
  } catch {
    return Promise.reject(new Error("this build of Markas does not include the downloader"));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "install", "chromium", "--no-shell"], {
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browsersRoot,
        // A packaged Markas is a Bun executable; this makes it run the installer script.
        BUN_BE_BUN: "1",
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let problem = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      problem = (problem + chunk.toString("utf8")).slice(-2_000);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the download took longer than 15 minutes"));
    }, DOWNLOAD_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(lastLine(problem) || `the downloader stopped with code ${code}`));
    });
  });
}

function lastLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? ""
  );
}
