// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findChromium, installPaths, SystemBrowserFinder } from "./browser-finder";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-finder-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const WINDOWS_ENV = {
  PROGRAMFILES: "C:\\Program Files",
  "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
};

function finder(present: string[], options: Record<string, unknown> = {}) {
  return new SystemBrowserFinder({
    browsersRoot: root,
    platform: "win32",
    env: WINDOWS_ENV,
    exists: (path) => present.includes(path),
    ...options,
  });
}

async function placeChromium(build: string, ...parts: string[]): Promise<string> {
  const folder = join(root, build, ...parts.slice(0, -1));
  await mkdir(folder, { recursive: true });
  const file = join(folder, parts.at(-1) ?? "");
  await writeFile(file, "");
  return file;
}

describe("SystemBrowserFinder", () => {
  it("lists Chrome before Edge, and only what is installed", () => {
    const paths = installPaths("win32", WINDOWS_ENV);
    const chrome = paths.chrome[0] ?? "";
    const edge = paths.msedge[1] ?? "";
    expect(finder([chrome, edge]).installed()).toEqual([
      { kind: "channel", channel: "chrome", label: "Chrome" },
      { kind: "channel", channel: "msedge", label: "Edge" },
    ]);
    expect(finder([edge]).installed()).toEqual([
      { kind: "channel", channel: "msedge", label: "Edge" },
    ]);
    expect(finder([]).installed()).toEqual([]);
  });

  it("puts a browser the person chose first", () => {
    const chosen = "D:\\Browsers\\chromium.exe";
    const targets = finder([chosen], {
      env: { ...WINDOWS_ENV, MARKAS_BOT_BROWSER: chosen },
    }).installed();
    expect(targets).toEqual([{ kind: "executable", path: chosen, label: "the browser you chose" }]);
  });

  it("knows where Chrome and Edge live on macOS and Linux", () => {
    expect(installPaths("darwin", { HOME: "/Users/me" }).chrome).toContain(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
    expect(installPaths("linux", {}).msedge).toEqual(["/opt/microsoft/msedge/msedge"]);
  });

  it("finds a Chromium downloaded earlier, the newest build first", async () => {
    expect(finder([]).downloaded()).toBeNull();
    await placeChromium("chromium-1200", "chrome-win64", "chrome.exe");
    const newest = await placeChromium("chromium-1254", "chrome-win64", "chrome.exe");
    // Other downloads in the same folder are not browsers Markas can show.
    await placeChromium("chromium_headless_shell-1254", "chrome-win64", "chrome.exe");
    await placeChromium("ffmpeg-1013", "ffmpeg.exe");
    expect(findChromium(root)).toBe(newest);
    expect(finder([]).downloaded()).toEqual({
      kind: "executable",
      path: newest,
      label: "Markas's own Chromium",
    });
  });

  it("finds the browser inside a macOS app bundle", async () => {
    const app = await placeChromium(
      "chromium-1254",
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    );
    expect(findChromium(root)).toBe(app);
  });

  it("downloads once for callers that ask at the same time", async () => {
    let runs = 0;
    const downloading = finder([], {
      runDownload: async (folder: string) => {
        runs += 1;
        expect(folder).toBe(root);
        await placeChromium("chromium-1254", "chrome-win64", "chrome.exe");
      },
    });
    const [first, second] = await Promise.all([downloading.download(), downloading.download()]);
    expect(runs).toBe(1);
    expect(first).toEqual(second);
    expect(first.kind).toBe("executable");
  });

  it("passes on why a download failed, and can try again", async () => {
    let works = false;
    const downloading = finder([], {
      runDownload: async () => {
        if (!works) throw new Error("the network is unreachable");
        await placeChromium("chromium-1254", "chrome-win64", "chrome.exe");
      },
    });
    await expect(downloading.download()).rejects.toThrow("the network is unreachable");
    works = true;
    await expect(downloading.download()).resolves.toMatchObject({ kind: "executable" });
  });

  it("says so when a download leaves no browser behind", async () => {
    const empty = finder([], { runDownload: async () => undefined });
    await expect(empty.download()).rejects.toThrow("no browser was found in it");
  });
});
