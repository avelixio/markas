import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, posix } from "node:path";

/**
 * Markas shows its interface in a window of its own: no tabs, no address bar, its own taskbar
 * entry. That window is a Chromium browser in app mode, so nothing extra has to be shipped.
 * Where no such browser is installed, the caller falls back to a normal browser tab.
 */
export function appWindowCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const override = env.MARKAS_BROWSER?.trim();
  const candidates = override ? [override] : [];
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
      (root): root is string => Boolean(root),
    );
    for (const root of roots) {
      candidates.push(join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
      candidates.push(join(root, "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    for (const directory of ["/usr/bin", "/usr/local/bin", "/snap/bin"]) {
      for (const name of ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"]) {
        candidates.push(posix.join(directory, name));
      }
    }
  }
  return candidates;
}

export function findAppBrowser(
  exists: (path: string) => boolean = existsSync,
  candidates: string[] = appWindowCandidates(),
): string | null {
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

/** The arguments that open `url` as a standalone app window. */
export function appWindowArgs(url: string): string[] {
  return [`--app=${url}`, "--window-size=1320,880", "--no-first-run", "--no-default-browser-check"];
}

/** Opens the app window. Returns false when no suitable browser is installed. */
export function openAppWindow(url: string, browser: string | null = findAppBrowser()): boolean {
  if (!browser) return false;
  const child = spawn(browser, appWindowArgs(url), { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
  return true;
}
