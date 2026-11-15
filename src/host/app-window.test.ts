// @vitest-environment node

import { describe, expect, it } from "vitest";
import { appWindowArgs, appWindowCandidates, findAppBrowser, openAppWindow } from "./app-window";

describe("app window", () => {
  it("looks for Edge and Chrome in the usual Windows folders", () => {
    const candidates = appWindowCandidates("win32", {
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    });
    expect(candidates).toHaveLength(6);
    expect(candidates.some((path) => path.endsWith("msedge.exe"))).toBe(true);
    expect(candidates.some((path) => path.endsWith("chrome.exe"))).toBe(true);
  });

  it("looks for Chrome, Edge and Chromium on macOS and Linux", () => {
    expect(appWindowCandidates("darwin", {})[0]).toContain("Google Chrome.app");
    const linux = appWindowCandidates("linux", {});
    expect(linux).toContain("/usr/bin/chromium");
    expect(linux).toContain("/usr/bin/google-chrome");
  });

  it("puts the browser named by MARKAS_BROWSER first", () => {
    expect(appWindowCandidates("linux", { MARKAS_BROWSER: "/opt/brave" })[0]).toBe("/opt/brave");
  });

  it("picks the first installed browser, or none", () => {
    const candidates = ["/a/edge", "/b/chrome"];
    expect(findAppBrowser((path) => path === "/b/chrome", candidates)).toBe("/b/chrome");
    expect(findAppBrowser(() => false, candidates)).toBeNull();
  });

  it("opens the address as a standalone app window", () => {
    expect(appWindowArgs("http://127.0.0.1:4780/#token=abc")[0]).toBe(
      "--app=http://127.0.0.1:4780/#token=abc",
    );
  });

  it("reports that it could not open a window when no browser is installed", () => {
    expect(openAppWindow("http://127.0.0.1:4780/", null)).toBe(false);
  });
});
