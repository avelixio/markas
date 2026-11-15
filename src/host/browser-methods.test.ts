// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { BotBrowserService } from "../backend/browser/bot-browser-service";
import { UnavailableBrowserService } from "../backend/browser-host";
import type { BrowserService } from "../backend/browser-tools";
import { createBrowserMethods, createBrowserService } from "./browser-methods";
import { resolveHostPaths } from "./paths";

function methodsFor() {
  const browser = {
    viewTab: vi.fn(async () => "view"),
    takeControl: vi.fn(async () => "hand-off"),
    resumeControl: vi.fn(),
    bringToFront: vi.fn(async () => undefined),
    fillSecret: vi.fn(),
  };
  const methods = createBrowserMethods(browser as unknown as BrowserService);
  const call = (name: string, input?: unknown) => {
    const method = methods[name];
    if (!method) throw new Error(`No method ${name}`);
    return method(input);
  };
  return { browser, methods, call };
}

describe("browser host methods", () => {
  it("lets the person look at a tab, take it over, give it back and raise its window", async () => {
    const { browser, call } = methodsFor();
    await expect(call("browser.viewTab", "tab-1")).resolves.toBe("view");
    expect(browser.viewTab).toHaveBeenCalledWith("tab-1");

    await call("browser.takeControl", { tabId: "tab-1", reason: "I will enter the code" });
    expect(browser.takeControl).toHaveBeenCalledWith({
      tabId: "tab-1",
      reason: "I will enter the code",
    });

    call("browser.resumeControl", { tabId: "tab-1", note: "Done" });
    expect(browser.resumeControl).toHaveBeenCalledWith({ tabId: "tab-1", note: "Done" });

    await call("browser.bringToFront", "tab-1");
    expect(browser.bringToFront).toHaveBeenCalledWith("tab-1");
  });

  it("rejects malformed input", () => {
    const { call } = methodsFor();
    expect(() => call("browser.viewTab", "")).toThrow("tabId is required.");
    expect(() => call("browser.takeControl", "tab-1")).toThrow("Invalid take-over request.");
    expect(() => call("browser.takeControl", { tabId: "tab-1", reason: 5 })).toThrow(
      "Invalid reason.",
    );
    expect(() => call("browser.resumeControl", {})).toThrow("tabId is required.");
  });

  it("offers no route that fills a secret", () => {
    const { methods, browser } = methodsFor();
    expect(Object.keys(methods).sort()).toEqual([
      "browser.bringToFront",
      "browser.resumeControl",
      "browser.takeControl",
      "browser.viewTab",
    ]);
    expect(browser.fillSecret).not.toHaveBeenCalled();
  });
});

describe("createBrowserService", () => {
  const paths = resolveHostPaths({ MARKAS_HOME: "/data/markas" });

  it("builds the real browser when the driving library loads", async () => {
    const service = await createBrowserService(paths, {}, async () => ({}));
    expect(service).toBeInstanceOf(BotBrowserService);
    expect((service as BotBrowserService).profileDir("atlas")).toContain("browser-profiles");
    // Nothing is started until a bot opens a page.
    expect(service.listTabs()).toEqual([]);
    await service.destroy();
  });

  it("falls back to the stand-in that says why, when a browser can never be driven", async () => {
    const missing = await createBrowserService(paths, {}, async () => {
      throw new Error("Cannot find module");
    });
    expect(missing).toBeInstanceOf(UnavailableBrowserService);
    await expect(missing.open("https://example.com")).rejects.toThrow(
      "The Markas browser cannot be used on this computer. This copy of Markas does not include the part that drives a browser.",
    );

    const off = await createBrowserService(paths, { MARKAS_BOT_BROWSER: "off" }, async () => ({}));
    expect(off).toBeInstanceOf(UnavailableBrowserService);
    const refused = await off.handleDynamicTool({
      threadId: "t",
      turnId: "t",
      callId: "c",
      namespace: "markas_browser",
      tool: "open",
      arguments: {},
    });
    expect(refused).toMatchObject({ success: false });
    await expect(
      off.fillSecret({
        botId: "atlas",
        tabId: "tab-1",
        origin: "https://example.com",
        target: { field: "password" },
        value: "x",
      }),
    ).rejects.toThrow("switched off");
  });
});
