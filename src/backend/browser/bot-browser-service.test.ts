// @vitest-environment node

import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserControlState, BrowserTab } from "../../shared/ipc";
import type { DynamicToolResult } from "../protocol";
import {
  CHROME,
  EDGE,
  FakeBrowserDriver,
  FakeBrowserFinder,
  type FakePage,
  OWN_CHROMIUM,
} from "../testing/fake-browser-driver";
import { BotBrowserService } from "./bot-browser-service";
import { BrowserProblem } from "./problems";

const SITE = "https://shop.example.com";
const SECRET = "correct-horse-battery";

let root: string;
let driver: FakeBrowserDriver;
let finder: FakeBrowserFinder;
let browser: BotBrowserService;
let calls = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-browser-test-"));
  driver = new FakeBrowserDriver();
  finder = new FakeBrowserFinder([CHROME, EDGE]);
  browser = create();
});

afterEach(async () => {
  await browser.destroy();
  await rm(root, { recursive: true, force: true });
});

function create(options: { handOffWaitMs?: number } = {}): BotBrowserService {
  return new BotBrowserService({ profilesRoot: root, finder, driver, ...options });
}

/** Calls a browser tool the way a bot's engine does. */
function tool(botId: string, name: string, args: unknown = {}, turnId = "turn-1") {
  calls += 1;
  return browser.handleDynamicTool(
    {
      threadId: `thread-${botId}`,
      turnId,
      callId: `call-${calls}`,
      namespace: "markas_browser",
      tool: name,
      arguments: args,
    },
    { botId },
  );
}

const textOf = (result: DynamicToolResult): string =>
  result.contentItems.map((item) => (item.type === "inputText" ? item.text : "")).join("\n");

async function openTab(botId = "atlas", url = `${SITE}/login`): Promise<BrowserTab> {
  return browser.open(url, `thread-${botId}`, botId);
}

/** Reads the page as the bot and returns the revision its references belong to. */
async function read(botId: string, tabId: string): Promise<number> {
  const result = await tool(botId, "snapshot", { tabId });
  return Number(/Revision: (\d+)/.exec(textOf(result))?.[1]);
}

const pageOf = (index = 0): FakePage => {
  const page = driver.last.pages()[index];
  if (!page) throw new Error("No page.");
  return page;
};

describe("choosing a browser", () => {
  it("drives Chrome first, and Edge when Chrome will not start", async () => {
    await openTab();
    expect(driver.launches.map((launch) => launch.target.label)).toEqual(["Chrome"]);

    driver.broken.add("Chrome");
    await openTab("juno");
    expect(driver.last.options.target.label).toBe("Edge");
    expect(finder.downloads).toBe(0);
  });

  it("downloads its own browser only when neither is installed, and reuses it", async () => {
    finder.targets = [];
    await openTab();
    expect(finder.downloads).toBe(1);
    expect(driver.last.options.target).toEqual(OWN_CHROMIUM);

    await openTab("juno");
    expect(finder.downloads).toBe(1);
  });

  it("says what to do when there is no browser and the download fails, and recovers later", async () => {
    finder.targets = [];
    finder.downloadProblem = "the network is unreachable";
    await expect(openTab()).rejects.toThrow(
      /Chrome and Edge were not found on this computer, and its own browser could not be downloaded \(the network is unreachable\)\. Install Chrome or Edge/,
    );
    expect(browser.listTabs()).toEqual([]);

    finder.downloadProblem = null;
    await expect(openTab()).resolves.toMatchObject({ url: `${SITE}/login` });
  });
});

describe("profiles", () => {
  it("gives every bot its own profile folder and its own browser", async () => {
    await openTab("atlas");
    await openTab("juno");
    const folders = driver.launches.map((launch) => launch.profileDir);
    expect(folders).toEqual([join(root, "atlas"), join(root, "juno")]);
    expect(driver.contexts).toHaveLength(2);
    // An odd id can never climb out of the profiles folder.
    expect(browser.profileDir("../../elsewhere")).toMatch(/[0-9a-f]{32}$/);
  });

  it("reuses a bot's browser for more tabs and lets go of it with the last tab", async () => {
    const first = await openTab();
    const second = await openTab("atlas", `${SITE}/orders`);
    expect(driver.contexts).toHaveLength(1);
    await browser.close(first.id);
    expect(driver.last.closed).toBe(false);
    await browser.close(second.id);
    expect(driver.last.closed).toBe(true);
  });

  it("says so when the profile is in use by another program, and works once it is free", async () => {
    driver.lockedProfiles.add(join(root, "atlas"));
    await expect(openTab()).rejects.toThrow(/browser profile is in use by another program/);
    // A locked profile is never worked around by trying another browser on it.
    expect(driver.launches).toHaveLength(1);

    driver.lockedProfiles.clear();
    await expect(openTab()).resolves.toMatchObject({ ownerBotId: "atlas" });
  });

  it("removes a deleted bot's profile and closes its browser", async () => {
    await openTab();
    await writeFile(join(root, "atlas", "Cookies"), "x");
    await browser.forgetBot("atlas");
    expect(driver.last.closed).toBe(true);
    expect(existsSync(join(root, "atlas"))).toBe(false);
    expect(browser.listTabs()).toEqual([]);
  });
});

describe("the bot's tools", () => {
  it("opens, lists, reads, acts, takes a picture and closes", async () => {
    const opened = await tool("atlas", "open", { url: `${SITE}/login` });
    expect(opened.success).toBe(true);
    const tabId = /Opened tab (\w+)/.exec(textOf(opened))?.[1] ?? "";
    expect(browser.listTabs()).toMatchObject([
      { id: tabId, url: `${SITE}/login`, ownerBotId: "atlas", ownerThreadId: "thread-atlas" },
    ]);

    expect(textOf(await tool("atlas", "list_tabs"))).toContain(
      `${tabId} | Page at shop.example.com`,
    );

    const page = await tool("atlas", "snapshot", { tabId });
    expect(textOf(page)).toContain('button "Go" [ref=e1]');
    const revision = Number(/Revision: (\d+)/.exec(textOf(page))?.[1]);

    for (const action of [
      { type: "type", ref: "e2", text: "atlas@example.com" },
      { type: "click", ref: "e1" },
      { type: "key", key: "Enter" },
      { type: "scroll" },
      { type: "back" },
      { type: "forward" },
    ]) {
      const result = await tool("atlas", "act", { tabId, revision, action });
      expect(textOf(result)).toContain("Done.");
    }
    expect(pageOf().actions).toEqual([
      "type e2",
      "click e1",
      "key Enter",
      "scroll 600",
      "back",
      "forward",
    ]);

    const picture = await tool("atlas", "screenshot", { tabId });
    expect(picture.contentItems[0]).toMatchObject({
      type: "inputImage",
      imageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });

    expect((await tool("atlas", "close_tab", { tabId })).success).toBe(true);
    expect(browser.listTabs()).toEqual([]);
  });

  it("refuses an element reference from an older reading of the page", async () => {
    const tab = await openTab();
    const revision = await read("atlas", tab.id);
    pageOf().land(`${SITE}/home`);
    const stale = await tool("atlas", "act", {
      tabId: tab.id,
      revision,
      action: { type: "click", ref: "e1" },
    });
    expect(stale.success).toBe(false);
    expect(textOf(stale)).toContain("The page has changed since you last read it");
    expect(pageOf().actions).toEqual([]);
  });

  it("keeps one bot out of another bot's tabs", async () => {
    const tab = await openTab("atlas");
    const result = await tool("juno", "snapshot", { tabId: tab.id });
    expect(result.success).toBe(false);
    expect(textOf(result)).toContain("There is no tab with that id");
    expect(textOf(await tool("juno", "list_tabs"))).toBe("No tabs are open.");
  });

  it("refuses addresses that are not web pages, and callers it cannot identify", async () => {
    const file = await tool("atlas", "open", { url: "file:///etc/passwd" });
    expect(textOf(file)).toContain("only opens http and https addresses");
    expect(driver.launches).toHaveLength(0);

    const unknown = await browser.handleDynamicTool({
      threadId: "t",
      turnId: "t",
      callId: "c",
      namespace: "markas_browser",
      tool: "list_tabs",
      arguments: {},
    });
    expect(unknown.success).toBe(false);
    await expect(browser.open(SITE, null, null)).rejects.toThrow(/Choose which bot/);
  });

  it("adopts a window a website opens as a tab of the same bot", async () => {
    await openTab();
    await driver.last.popup("https://login.example.com/start");
    expect(browser.listTabs().map((tab) => [tab.url, tab.ownerBotId, tab.ownerThreadId])).toEqual([
      [`${SITE}/login`, "atlas", "thread-atlas"],
      ["https://login.example.com/start", "atlas", "thread-atlas"],
    ]);
  });

  it("shows the bot acting during a call and waiting between calls, until its turn ends", async () => {
    const states: BrowserControlState[] = [];
    browser.onControlChanged((state) => states.push(state));
    const tab = await openTab();
    await read("atlas", tab.id);
    expect(states.map((state) => state.sessions[0]?.phase)).toEqual(["acting", "waiting"]);
    expect(states[0]?.sessions[0]).toMatchObject({ action: "snapshot", tabId: tab.id });

    browser.endControl("thread-atlas", "turn-1");
    expect(browser.getControlState().sessions).toEqual([]);
  });
});

describe("hand-off", () => {
  it("passes a step to the person and carries on when they give the tab back", async () => {
    const tab = await openTab();
    const states: BrowserControlState[] = [];
    browser.onControlChanged((state) => states.push(state));

    const waiting = tool("atlas", "hand_off", { tabId: tab.id, reason: "Enter the phone code" });
    expect(browser.getControlState().handOffs).toMatchObject([
      { tabId: tab.id, botId: "atlas", reason: "Enter the phone code", requestedBy: "bot" },
    ]);

    // While the person has the tab, the bot can neither act in it nor look at it.
    for (const [name, args] of [
      ["snapshot", { tabId: tab.id }],
      ["screenshot", { tabId: tab.id }],
      ["act", { tabId: tab.id, revision: 1, action: { type: "key", key: "Enter" } }],
      ["close_tab", { tabId: tab.id }],
    ] as const) {
      const refused = await tool("atlas", name, args);
      expect(refused.success).toBe(false);
      expect(textOf(refused)).toContain("The person is controlling this tab right now");
    }

    browser.resumeControl({ tabId: tab.id, note: "The code was accepted" });
    const result = await waiting;
    expect(result.success).toBe(true);
    expect(textOf(result)).toContain("gave the tab back. They said: The code was accepted");
    expect(browser.getControlState().handOffs).toEqual([]);
    expect(states.at(-1)?.handOffs).toEqual([]);
    expect((await tool("atlas", "snapshot", { tabId: tab.id })).success).toBe(true);
  });

  it("lets the person take over at any time, and brings the window to them", async () => {
    const tab = await openTab();
    const handOff = await browser.takeControl({ tabId: tab.id });
    expect(handOff).toMatchObject({ requestedBy: "person", reason: "You took over this tab." });
    expect(pageOf().actions).toContain("bringToFront");
    expect((await browser.viewTab(tab.id)).controller).toBe("person");

    // A bot that finds the tab taken waits with the same tool.
    const waiting = tool("atlas", "hand_off", { tabId: tab.id, reason: "ignored" });
    browser.resumeControl({ tabId: tab.id });
    expect(textOf(await waiting)).toContain("gave the tab back.");
  });

  it("reports that the person is not done yet, and keeps their control", async () => {
    await browser.destroy();
    browser = create({ handOffWaitMs: 20 });
    const tab = await openTab();
    const result = await tool("atlas", "hand_off", { tabId: tab.id, reason: "Solve the CAPTCHA" });
    expect(result.success).toBe(true);
    expect(textOf(result)).toContain("has not finished yet");
    expect(browser.getControlState().handOffs).toHaveLength(1);
  });

  it("stops waiting when the turn ends or the tab closes", async () => {
    const tab = await openTab();
    const stopped = tool("atlas", "hand_off", { tabId: tab.id, reason: "Phone code" });
    browser.endControl("thread-atlas", "turn-1");
    expect(textOf(await stopped)).toContain("The turn ended while waiting");
    expect(browser.getControlState().handOffs).toHaveLength(1);

    const closed = tool("atlas", "hand_off", { tabId: tab.id, reason: "Phone code" }, "turn-2");
    pageOf().closeByPerson();
    expect(textOf(await closed)).toContain("closed in the browser window");
    expect(browser.getControlState().handOffs).toEqual([]);
  });

  it("does not let the bot read what the person typed into a password field", async () => {
    const tab = await openTab();
    await browser.takeControl({ tabId: tab.id });
    pageOf().personTypesPassword(SECRET);
    browser.resumeControl({ tabId: tab.id });
    const page = textOf(await tool("atlas", "snapshot", { tabId: tab.id }));
    expect(page).toContain("Password");
    expect(page).not.toContain(SECRET);
  });
});

describe("filling a secret", () => {
  const fill = (overrides: Record<string, unknown> = {}) =>
    browser.fillSecret({
      botId: "atlas",
      tabId: "",
      origin: SITE,
      target: { field: "password" },
      value: SECRET,
      ...overrides,
    });

  it("fills the field, and the bot never sees the value afterwards", async () => {
    const tab = await openTab();
    await fill({ tabId: tab.id });
    expect(pageOf().fields.get("password")).toBe(SECRET);

    const page = textOf(await tool("atlas", "snapshot", { tabId: tab.id }));
    expect(page).toContain("[redacted]");
    expect(page).not.toContain(SECRET);
    // Not even when a site puts it in an address.
    pageOf().land(`${SITE}/welcome?echo=${SECRET}`);
    expect(textOf(await tool("atlas", "list_tabs"))).not.toContain(SECRET);
  });

  it("refuses when the tab is on any other site, even a sibling", async () => {
    const tab = await openTab("atlas", "https://admin.example.com/login");
    await expect(fill({ tabId: tab.id })).rejects.toThrow(
      "This tab is on https://admin.example.com, not on https://shop.example.com, so nothing was filled.",
    );
    expect(pageOf().actions).toEqual([]);
  });

  it("refuses another bot's tab and a tab the person controls", async () => {
    const tab = await openTab("juno");
    await expect(fill({ tabId: tab.id })).rejects.toThrow("There is no tab with that id");

    const own = await openTab("atlas");
    await browser.takeControl({ tabId: own.id });
    await expect(fill({ tabId: own.id })).rejects.toThrow("The person is controlling this tab");
  });

  it("never puts the value in an error", async () => {
    const tab = await openTab();
    for (const failure of ["not-found", "timeout", "other"] as const) {
      pageOf().nextFailure = failure;
      const error = await fill({ tabId: tab.id }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BrowserProblem);
      expect(String((error as Error).message)).not.toContain(SECRET);
      expect(JSON.stringify(error)).not.toContain(SECRET);
    }
    pageOf().nextFailure = "not-found";
    await expect(fill({ tabId: tab.id })).rejects.toThrow(
      "Markas could not find that field on the page, so nothing was filled.",
    );
  });
});

describe("when something goes wrong", () => {
  it("keeps the tab when a page takes too long to load", async () => {
    driver.addresses.set(`${SITE}/slow`, "timeout");
    const result = await tool("atlas", "open", { url: `${SITE}/slow` });
    expect(result.success).toBe(false);
    expect(textOf(result)).toMatch(
      /took longer than 30 seconds to load\. The tab is still open as \w+/,
    );
    const tabId = /open as (\w+)/.exec(textOf(result))?.[1] ?? "";
    expect((await tool("atlas", "snapshot", { tabId })).success).toBe(true);
  });

  it("says when an address cannot be reached", async () => {
    driver.addresses.set("https://nowhere.example.com/", "unreachable");
    const result = await tool("atlas", "open", { url: "https://nowhere.example.com/" });
    expect(textOf(result)).toContain("That address could not be reached");
  });

  it("reports a crashed page and recovers with a reload", async () => {
    const tab = await openTab();
    const revision = await read("atlas", tab.id);
    pageOf().crash();

    const crashed = await tool("atlas", "snapshot", { tabId: tab.id });
    expect(textOf(crashed)).toContain("The page crashed. Reload it to carry on");
    expect((await browser.viewTab(tab.id)).problem).toContain("The page crashed");

    const reload = await tool("atlas", "act", {
      tabId: tab.id,
      revision,
      action: { type: "reload" },
    });
    expect(reload.success).toBe(true);
    expect((await tool("atlas", "snapshot", { tabId: tab.id })).success).toBe(true);
    expect((await browser.viewTab(tab.id)).problem).toBeNull();
  });

  it("says when the person closed the tab, and opens it again on request", async () => {
    const tab = await openTab();
    const changes: BrowserTab[][] = [];
    browser.onChanged((tabs) => changes.push(tabs));
    pageOf().closeByPerson();
    expect(changes.at(-1)).toEqual([]);

    const result = await tool("atlas", "snapshot", { tabId: tab.id });
    expect(textOf(result)).toContain(
      "That tab was closed in the browser window. Open the page again",
    );
    await expect(browser.viewTab(tab.id)).rejects.toThrow("closed in the browser window");
    await expect(openTab()).resolves.toMatchObject({ url: `${SITE}/login` });
  });

  it("starts a new browser after the person closed the whole window", async () => {
    const tab = await openTab();
    driver.last.closeWindow();
    expect(browser.listTabs()).toEqual([]);
    expect(textOf(await tool("atlas", "snapshot", { tabId: tab.id }))).toMatch(
      /closed in the browser window|browser window was closed/,
    );
    await openTab();
    expect(driver.contexts).toHaveLength(2);
  });

  it("explains an element that does not respond or is gone", async () => {
    const tab = await openTab();
    const revision = await read("atlas", tab.id);
    const click = { tabId: tab.id, revision, action: { type: "click", ref: "e1" } };
    pageOf().nextFailure = "timeout";
    expect(textOf(await tool("atlas", "act", click))).toContain(
      "did not respond within 10 seconds",
    );
    pageOf().nextFailure = "not-found";
    expect(textOf(await tool("atlas", "act", click))).toContain("not on the page any more");
  });
});

describe("what the Browser panel sees", () => {
  it("gives a picture of the tab and who controls it", async () => {
    const tab = await openTab();
    const view = await browser.viewTab(tab.id);
    expect(view).toMatchObject({
      tab: { id: tab.id, url: `${SITE}/login`, title: "Page at shop.example.com" },
      controller: "bot",
      handOff: null,
      problem: null,
    });
    expect(view.image).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("announces tabs as they open, load and close", async () => {
    const seen: Array<[number, string | null]> = [];
    browser.onChanged((tabs, activeTabId) => seen.push([tabs.length, activeTabId]));
    const tab = await openTab();
    expect(seen.at(-1)).toEqual([1, tab.id]);
    await browser.close(tab.id);
    expect(seen.at(-1)).toEqual([0, null]);
  });
});
