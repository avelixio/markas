import { BotBrowserService } from "../backend/browser/bot-browser-service";
import { SystemBrowserFinder } from "../backend/browser/browser-finder";
import { PlaywrightDriver } from "../backend/browser/playwright-driver";
import { UnavailableBrowserService } from "../backend/browser-host";
import type { BrowserService } from "../backend/browser-tools";
import {
  BROWSER_PERSON_KEYS,
  type BrowserPersonInput,
  type BrowserResumeInput,
  type BrowserTakeControlInput,
} from "../shared/ipc";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";
import type { HostPaths } from "./paths";

const MAX_NOTE_LENGTH = 500;

/**
 * The bot browser over HTTP, for the person watching it in the Browser panel.
 * These let the person look at a tab, take it over, use the page and give it back.
 * Filling a saved login is deliberately not here: `BrowserService.fillSecret` is called by
 * host code only, so a secret never travels through a route a bot or a page could reach.
 */
export function createBrowserMethods(browser: BrowserService): Record<string, HostMethod> {
  return {
    "browser.viewTab": (tabId) => browser.viewTab(requireString(tabId, "tabId")),
    "browser.takeControl": (input) => browser.takeControl(parseTakeControl(input)),
    "browser.resumeControl": (input) => browser.resumeControl(parseResume(input)),
    "browser.personInput": (input) => browser.personInput(parsePersonInput(input)),
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
    // The page is used in the Markas Browser panel. MARKAS_BROWSER_WINDOW=1 gives the browser a
    // window of its own as well, for looking into a problem.
    headless: env.MARKAS_BROWSER_WINDOW !== "1",
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

const MAX_TYPED_LENGTH = 2_000;
const MAX_SCROLL = 4_000;

function parsePersonInput(value: unknown): BrowserPersonInput {
  if (!isObject(value)) throw new Error("Invalid page input.");
  const tabId = requireString(value.tabId, "tabId");
  const share = (field: string): number => {
    const number = value[field];
    if (typeof number !== "number" || !(number >= 0 && number <= 1)) {
      throw new Error(`Invalid ${field}.`);
    }
    return number;
  };
  switch (value.kind) {
    case "click":
      return { tabId, kind: "click", x: share("x"), y: share("y") };
    case "type": {
      if (typeof value.text !== "string" || value.text.length === 0)
        throw new Error("Invalid text.");
      return { tabId, kind: "type", text: value.text.slice(0, MAX_TYPED_LENGTH) };
    }
    case "key": {
      const key = BROWSER_PERSON_KEYS.find((known) => known === value.key);
      if (!key) throw new Error("That key is not passed on to the page.");
      return { tabId, kind: "key", key };
    }
    case "scroll": {
      if (typeof value.deltaY !== "number" || !Number.isFinite(value.deltaY)) {
        throw new Error("Invalid scroll.");
      }
      return {
        tabId,
        kind: "scroll",
        deltaY: Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, Math.round(value.deltaY))),
      };
    }
    default:
      throw new Error("Invalid page input.");
  }
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
