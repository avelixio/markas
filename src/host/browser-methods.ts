import { BotBrowserService } from "../backend/browser/bot-browser-service";
import { SystemBrowserFinder } from "../backend/browser/browser-finder";
import { PlaywrightDriver } from "../backend/browser/playwright-driver";
import { UnavailableBrowserService } from "../backend/browser-host";
import type { BrowserService } from "../backend/browser-tools";
import type { BrowserResumeInput, BrowserTakeControlInput } from "../shared/ipc";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";
import type { HostPaths } from "./paths";

const MAX_NOTE_LENGTH = 500;

/**
 * The bot browser over HTTP, for the person watching it in the Browser panel.
 * These let the person look at a tab, take it over and give it back.
 * Filling a saved login is deliberately not here: `BrowserService.fillSecret` is called by
 * host code only, so a secret never travels through a route a bot or a page could reach.
 */
export function createBrowserMethods(browser: BrowserService): Record<string, HostMethod> {
  return {
    "browser.viewTab": (tabId) => browser.viewTab(requireString(tabId, "tabId")),
    "browser.takeControl": (input) => browser.takeControl(parseTakeControl(input)),
    "browser.resumeControl": (input) => browser.resumeControl(parseResume(input)),
    "browser.bringToFront": (tabId) => browser.bringToFront(requireString(tabId, "tabId")),
  };
}

/**
 * Builds the bot browser for this computer.
 * It starts no browser yet: one is started, and if need be downloaded, the first time a bot
 * opens a page.
 * When a browser can never be driven here, the stand-in that says so is returned instead.
 */
export async function createBrowserService(
  paths: HostPaths,
  env: NodeJS.ProcessEnv = process.env,
  loadDriver: () => Promise<unknown> = () => import("playwright-core"),
  onTrimmed?: (botId: string, cutCharacters: number) => void,
): Promise<BrowserService> {
  if (env.MARKAS_BOT_BROWSER?.trim().toLowerCase() === "off") {
    return new UnavailableBrowserService("It is switched off with MARKAS_BOT_BROWSER=off.");
  }
  try {
    await loadDriver();
  } catch {
    return new UnavailableBrowserService(
      "This copy of Markas does not include the part that drives a browser.",
    );
  }
  return new BotBrowserService({
    profilesRoot: paths.browserProfilesRoot,
    finder: new SystemBrowserFinder({ browsersRoot: paths.browsersRoot, env }),
    driver: new PlaywrightDriver(),
    headless: env.MARKAS_BROWSER_HEADLESS === "1",
    onTrimmed,
  });
}

function parseTakeControl(value: unknown): BrowserTakeControlInput {
  if (!isObject(value)) throw new Error("Invalid take-over request.");
  return {
    tabId: requireString(value.tabId, "tabId"),
    reason: optionalText(value.reason, "reason"),
  };
}

function parseResume(value: unknown): BrowserResumeInput {
  if (!isObject(value)) throw new Error("Invalid resume request.");
  return {
    tabId: requireString(value.tabId, "tabId"),
    note: optionalText(value.note, "note"),
  };
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${field}.`);
  return value.slice(0, MAX_NOTE_LENGTH);
}
