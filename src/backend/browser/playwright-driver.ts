import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Frame, Locator, Page } from "playwright-core";
import {
  type BrowserDriver,
  type BrowserLaunchOptions,
  type DriverContext,
  DriverError,
  type DriverFailure,
  type DriverPage,
  type DriverPageEvent,
  type SecretTarget,
} from "./driver";

const LAUNCH_TIMEOUT_MS = 30_000;
const SETTLE_MS = 150;
const SETTLE_LOAD_MS = 5_000;
/** Set on a field Markas filled with a secret, so screenshots can cover it. */
const SECRET_MARK = "data-markas-secret";
const SENSITIVE_SELECTOR = `input[type="password"], [${SECRET_MARK}]`;
const REF_PATTERN = /^[A-Za-z0-9]+$/;

/** How sign-in forms usually mark each kind of field, most specific first. */
const FIELD_SELECTORS: Record<"username" | "password" | "one-time-code", string[]> = {
  username: [
    'input[autocomplete="username"]',
    'input[type="email"]',
    'input[autocomplete="email"]',
    'input[name*="user" i]',
    'input[id*="user" i]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[name*="login" i]',
    'input[id*="login" i]',
  ],
  password: ['input[type="password"]'],
  "one-time-code": [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="totp" i]',
    'input[id*="totp" i]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[inputmode="numeric"]',
  ],
};

/** Drives Chrome, Edge or Chromium through playwright-core. */
export class PlaywrightDriver implements BrowserDriver {
  async launch(options: BrowserLaunchOptions): Promise<DriverContext> {
    // Loaded on first use, so a host without the library still starts and says so plainly.
    const { chromium } = await import("playwright-core");
    const { target, profileDir, headless } = options;
    try {
      const context = await chromium.launchPersistentContext(profileDir, {
        ...(target.kind === "channel"
          ? { channel: target.channel }
          : { executablePath: target.path }),
        headless,
        // A window the person can resize; the page follows the window.
        viewport: headless ? { width: 1280, height: 800 } : null,
        timeout: LAUNCH_TIMEOUT_MS,
        args: ["--no-first-run", "--no-default-browser-check"],
      });
      return new PlaywrightContext(context);
    } catch (error) {
      const failure = profileInUse(profileDir) ? "profile-locked" : "launch-failed";
      throw new DriverError(failure, firstLine(error));
    }
  }
}

class PlaywrightContext implements DriverContext {
  readonly #context: BrowserContext;
  readonly #pages = new WeakMap<Page, PlaywrightPage>();

  constructor(context: BrowserContext) {
    this.#context = context;
  }

  pages(): DriverPage[] {
    return this.#context.pages().map((page) => this.#wrap(page));
  }

  async newPage(): Promise<DriverPage> {
    try {
      return this.#wrap(await this.#context.newPage());
    } catch (error) {
      throw classify(error);
    }
  }

  onPage(listener: (page: DriverPage) => void): void {
    this.#context.on("page", (page) => listener(this.#wrap(page)));
  }

  onClosed(listener: () => void): void {
    this.#context.on("close", () => listener());
  }

  async close(): Promise<void> {
    await this.#context.close().catch(() => undefined);
  }

  /** One wrapper per page, so the service can tell pages apart by identity. */
  #wrap(page: Page): PlaywrightPage {
    let wrapped = this.#pages.get(page);
    if (!wrapped) {
      wrapped = new PlaywrightPage(page);
      this.#pages.set(page, wrapped);
    }
    return wrapped;
  }
}

class PlaywrightPage implements DriverPage {
  readonly #page: Page;

  constructor(page: Page) {
    this.#page = page;
  }

  url(): string {
    return this.#page.url();
  }

  title(): Promise<string> {
    return this.#guard(() => this.#page.title());
  }

  goto(url: string, timeoutMs: number): Promise<void> {
    return this.#guard(async () => {
      await this.#page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
    });
  }

  read(timeoutMs: number): Promise<string> {
    return this.#guard(() => this.#page.ariaSnapshot({ mode: "ai", timeout: timeoutMs }));
  }

  click(ref: string, timeoutMs: number): Promise<void> {
    return this.#guard(async () => {
      await this.#byRef(ref).click({ timeout: timeoutMs });
      await this.#settle();
    });
  }

  type(ref: string | null, text: string, submit: boolean, timeoutMs: number): Promise<void> {
    return this.#guard(async () => {
      if (ref === null) {
        await this.#page.keyboard.type(text);
        if (submit) await this.#page.keyboard.press("Enter");
      } else {
        const element = this.#byRef(ref);
        await element.fill(text, { timeout: timeoutMs });
        if (submit) await element.press("Enter", { timeout: timeoutMs });
      }
      if (submit) await this.#settle();
    });
  }

  press(key: string): Promise<void> {
    return this.#guard(async () => {
      await this.#page.keyboard.press(key);
      await this.#settle();
    });
  }

  scroll(deltaY: number): Promise<void> {
    return this.#guard(() => this.#page.mouse.wheel(0, deltaY));
  }

  back(timeoutMs: number): Promise<void> {
    return this.#guard(async () => {
      await this.#page.goBack({ timeout: timeoutMs, waitUntil: "domcontentloaded" });
    });
  }

  forward(timeoutMs: number): Promise<void> {
    return this.#guard(async () => {
      await this.#page.goForward({ timeout: timeoutMs, waitUntil: "domcontentloaded" });
    });
  }

  reload(timeoutMs: number): Promise<void> {
    return this.#guard(async () => {
      await this.#page.reload({ timeout: timeoutMs, waitUntil: "domcontentloaded" });
    });
  }

  async fill(target: SecretTarget, value: string, timeoutMs: number): Promise<void> {
    // The library's own error text quotes the value being filled, so it is never passed on:
    // every failure here becomes a fixed sentence.
    let failure: DriverFailure = "other";
    try {
      const element = await this.#secretField(target, timeoutMs);
      if (!element) {
        failure = "not-found";
        throw new Error("no field");
      }
      await element.evaluate((node, mark) => node.setAttribute(mark, ""), SECRET_MARK, {
        timeout: timeoutMs,
      });
      await element.fill(value, { timeout: timeoutMs });
    } catch (error) {
      if (failure === "other") failure = classify(error).failure;
      throw new DriverError(failure, "The field could not be filled.");
    }
  }

  async sensitiveValues(): Promise<string[]> {
    const values: string[] = [];
    for (const frame of this.#page.frames()) {
      values.push(...(await frameValues(frame)));
    }
    return values;
  }

  screenshot(timeoutMs: number): Promise<Uint8Array> {
    return this.#guard(() =>
      this.#page.screenshot({
        type: "jpeg",
        quality: 70,
        timeout: timeoutMs,
        mask: [this.#page.locator(`[${SECRET_MARK}]`)],
        maskColor: "#6b7280",
      }),
    );
  }

  bringToFront(): Promise<void> {
    return this.#guard(async () => {
      // A minimised window has to be restored first, or activating its tab shows nothing.
      const session = await this.#page.context().newCDPSession(this.#page);
      try {
        const { windowId, bounds } = await session.send("Browser.getWindowForTarget");
        if (bounds.windowState === "minimized") {
          await session.send("Browser.setWindowBounds", {
            windowId,
            bounds: { windowState: "normal" },
          });
        }
      } catch {
        // A browser without windows, such as a headless one, has nothing to restore.
      } finally {
        await session.detach().catch(() => undefined);
      }
      await this.#page.bringToFront();
    });
  }

  async close(): Promise<void> {
    await this.#page.close().catch(() => undefined);
  }

  on(listener: (event: DriverPageEvent) => void): void {
    const main = (frame: Frame) => frame === this.#page.mainFrame();
    this.#page.on("framenavigated", (frame) => {
      if (main(frame)) listener("loading");
    });
    this.#page.on("load", () => listener("loaded"));
    this.#page.on("crash", () => listener("crashed"));
    this.#page.on("close", () => listener("closed"));
  }

  #byRef(ref: string): Locator {
    if (!REF_PATTERN.test(ref)) throw new DriverError("not-found", "Unknown reference.");
    return this.#page.getByRef(ref);
  }

  /** Secrets only ever go into the page's own document, never into an embedded one. */
  async #secretField(target: SecretTarget, timeoutMs: number): Promise<Locator | null> {
    const frame = this.#page.mainFrame();
    if ("ref" in target) {
      // References inside an embedded document start with "f".
      if (!REF_PATTERN.test(target.ref) || /^f\d/.test(target.ref)) return null;
      return this.#page.getByRef(target.ref);
    }
    if ("selector" in target) {
      const element = frame.locator(target.selector).first();
      return (await present(element, timeoutMs)) ? element : null;
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (const selector of FIELD_SELECTORS[target.field]) {
        const element = frame.locator(selector).filter({ visible: true }).first();
        if ((await element.count()) > 0) return element;
      }
      if (Date.now() >= deadline) return null;
      await this.#page.waitForTimeout(100);
    }
  }

  /** Gives a click or a key press a moment to start a navigation, then waits for the new page. */
  async #settle(): Promise<void> {
    await this.#page.waitForTimeout(SETTLE_MS).catch(() => undefined);
    await this.#page
      .waitForLoadState("domcontentloaded", { timeout: SETTLE_LOAD_MS })
      .catch(() => undefined);
  }

  async #guard<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw classify(error);
    }
  }
}

async function present(element: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await element.waitFor({ state: "attached", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function frameValues(frame: Frame): Promise<string[]> {
  try {
    return await frame.evaluate(
      (selector) =>
        Array.from(document.querySelectorAll(selector))
          .map((node) => (node as HTMLInputElement).value)
          .filter((value) => typeof value === "string" && value.length > 0),
      SENSITIVE_SELECTOR,
    );
  } catch {
    // A frame that is navigating or gone has nothing to read.
    return [];
  }
}

/** Chromium keeps a lock in the profile folder for as long as a browser is using it. */
function profileInUse(profileDir: string): boolean {
  if (existsSync(join(profileDir, "lockfile"))) return true;
  try {
    // A link, not a file: it names the process that holds the profile.
    lstatSync(join(profileDir, "SingletonLock"));
    return true;
  } catch {
    return false;
  }
}

function classify(error: unknown): DriverError {
  if (error instanceof DriverError) return error;
  const message = firstLine(error);
  const name = error instanceof Error ? error.name : "";
  let failure: DriverFailure = "other";
  if (/crash/i.test(message)) failure = "crashed";
  else if (/has been closed|browser has disconnected|Target closed/i.test(message)) {
    failure = "closed";
  } else if (/net::ERR_|NS_ERROR_|Cannot navigate to invalid URL/i.test(message)) {
    failure = "unreachable";
  } else if (name === "TimeoutError" || /Timeout \d+ms exceeded/i.test(message)) {
    failure = "timeout";
  } else if (/No element|not found|Unknown ref|aria-ref|getByRef/i.test(message)) {
    failure = "not-found";
  }
  return new DriverError(failure, message);
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (text.split("\n")[0] ?? "").trim();
}
