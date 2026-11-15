import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  BrowserControlAction,
  BrowserControlSession,
  BrowserControlState,
  BrowserHandOff,
  BrowserResumeInput,
  BrowserTab,
  BrowserTabView,
  BrowserTakeControlInput,
  BrowserVisibilityInput,
} from "../../shared/ipc";
import type { BrowserCaller, BrowserSecretFill, BrowserService } from "../browser-tools";
import { SecretRedactor } from "../keyring/redact";
import type { DynamicToolCallParams, DynamicToolResult } from "../protocol";
import type { BrowserFinder } from "./browser-finder";
import {
  type BrowserDriver,
  type BrowserTarget,
  type DriverContext,
  DriverError,
  type DriverPage,
  type DriverPageEvent,
} from "./driver";
import {
  BROWSER_CLOSED,
  BrowserProblem,
  ELEMENT_MISSING,
  PAGE_CHANGED,
  PAGE_CRASHED,
  PROFILE_LOCKED,
  TAB_CLOSED,
  TAB_CLOSED_BY_PERSON,
  TAB_UNKNOWN,
} from "./problems";

export interface BotBrowserOptions {
  /** One folder per bot is made here for its browser profile. */
  profilesRoot: string;
  finder: BrowserFinder;
  driver: BrowserDriver;
  /** Without windows. The person cannot take over then, so this is for checks only. */
  headless?: boolean;
  navigationTimeoutMs?: number;
  actionTimeoutMs?: number;
  /** How long one `hand_off` call waits for the person before it reports "still waiting". */
  handOffWaitMs?: number;
  /** Told when a long page was cut before a bot read it, with how many characters were left out. */
  onTrimmed?: (botId: string, cutCharacters: number) => void;
}

type GoneReason = "closed" | "closed-by-person" | "browser-closed";

interface TabRecord {
  id: string;
  botId: string;
  threadId: string | null;
  page: DriverPage;
  title: string;
  url: string;
  loading: boolean;
  /** Changes whenever the page is read or navigates, so stale element references are refused. */
  revision: number;
  crashed: boolean;
  /** True once Markas itself is closing the tab. */
  closing: boolean;
  /** Actions in one tab run one after another. */
  queue: Promise<unknown>;
}

type WaitOutcome =
  | { outcome: "returned"; note: string }
  | { outcome: "waiting" }
  | { outcome: "stopped" }
  | { outcome: "closed" };

interface Waiter {
  threadId: string;
  turnId: string;
  finish(outcome: WaitOutcome): void;
}

interface HandOffRecord {
  info: BrowserHandOff;
  waiters: Set<Waiter>;
}

const MAX_PAGE_TEXT = 80_000;
const MAX_REMEMBERED_CLOSED_TABS = 200;
const SCROLL_STEP = 600;

/**
 * The bot browser: one real browser per bot, each with its own profile folder, driven for
 * the bots and watched by the person.
 */
export class BotBrowserService implements BrowserService {
  readonly #profilesRoot: string;
  readonly #finder: BrowserFinder;
  readonly #driver: BrowserDriver;
  readonly #headless: boolean;
  readonly #navigationTimeoutMs: number;
  readonly #actionTimeoutMs: number;
  readonly #handOffWaitMs: number;
  readonly #onTrimmed: ((botId: string, cutCharacters: number) => void) | undefined;

  readonly #contexts = new Map<string, Promise<DriverContext>>();
  /** Browsers that are shutting down; a new one for the same bot waits for the profile. */
  readonly #closing = new Map<string, Promise<void>>();
  readonly #tabs = new Map<string, TabRecord>();
  readonly #byPage = new Map<DriverPage, TabRecord>();
  readonly #gone = new Map<string, { botId: string; reason: GoneReason }>();
  readonly #lastThread = new Map<string, string | null>();
  /** Secrets Markas filled for each bot, so they can be taken out of anything the bot reads. */
  readonly #redactors = new Map<string, SecretRedactor>();
  readonly #sessions = new Map<string, BrowserControlSession>();
  readonly #handOffs = new Map<string, HandOffRecord>();
  readonly #changedListeners = new Set<(tabs: BrowserTab[], activeTabId: string | null) => void>();
  readonly #controlListeners = new Set<(state: BrowserControlState) => void>();
  #activeTabId: string | null = null;
  #destroyed = false;

  constructor(options: BotBrowserOptions) {
    this.#profilesRoot = options.profilesRoot;
    this.#finder = options.finder;
    this.#driver = options.driver;
    this.#headless = options.headless ?? false;
    this.#navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;
    this.#actionTimeoutMs = options.actionTimeoutMs ?? 10_000;
    this.#handOffWaitMs = options.handOffWaitMs ?? 240_000;
    this.#onTrimmed = options.onTrimmed;
  }

  /** The folder that holds one bot's cookies, sign-ins and site data. */
  profileDir(botId: string): string {
    const safe = /^[A-Za-z0-9_-]{1,64}$/.test(botId)
      ? botId
      : createHash("sha256").update(botId).digest("hex").slice(0, 32);
    return join(this.#profilesRoot, safe);
  }

  onChanged(listener: (tabs: BrowserTab[], activeTabId: string | null) => void): () => void {
    this.#changedListeners.add(listener);
    return () => this.#changedListeners.delete(listener);
  }

  onControlChanged(listener: (state: BrowserControlState) => void): () => void {
    this.#controlListeners.add(listener);
    return () => this.#controlListeners.delete(listener);
  }

  getControlState(): BrowserControlState {
    return {
      sessions: [...this.#sessions.values()].map((session) => ({ ...session })),
      handOffs: [...this.#handOffs.values()].map((record) => ({ ...record.info })),
    };
  }

  /** A turn ended: its bot is no longer acting, and stops waiting for the person. */
  endControl(threadId: string, turnId: string): void {
    const removed = this.#sessions.delete(sessionKey(threadId, turnId));
    let released = false;
    for (const record of this.#handOffs.values()) {
      for (const waiter of [...record.waiters]) {
        if (waiter.threadId !== threadId || waiter.turnId !== turnId) continue;
        waiter.finish({ outcome: "stopped" });
        released = true;
      }
    }
    if (removed || released) this.#emitControl();
  }

  /** The engines stopped. Hand-offs stay: a tab the person holds is theirs until they resume. */
  clearControls(): void {
    const hadSessions = this.#sessions.size > 0;
    this.#sessions.clear();
    for (const record of this.#handOffs.values()) {
      for (const waiter of [...record.waiters]) waiter.finish({ outcome: "stopped" });
    }
    if (hadSessions) this.#emitControl();
  }

  listTabs(): BrowserTab[] {
    return [...this.#tabs.values()].map(summary);
  }

  async open(
    url: string,
    ownerThreadId: string | null = null,
    ownerBotId: string | null = null,
  ): Promise<BrowserTab> {
    const address = httpAddress(url);
    if (!ownerBotId) {
      throw new BrowserProblem(
        "invalid-request",
        "Choose which bot this tab is for. Every tab uses one bot's own browser profile.",
      );
    }
    if (this.#destroyed) throw new BrowserProblem("action-failed", "The browser is shutting down.");
    const tab = await this.#newTab(ownerBotId, ownerThreadId);
    this.#activeTabId = tab.id;
    this.#emitChanged();
    await this.#enqueue(tab, async () => {
      try {
        await tab.page.goto(address, this.#navigationTimeoutMs);
      } catch (error) {
        throw this.#explain(error, tab, "open");
      }
    });
    this.#refresh(tab);
    return summary(tab);
  }

  async activate(tabId: string): Promise<void> {
    const tab = this.#tab(tabId);
    this.#activeTabId = tab.id;
    this.#emitChanged();
  }

  async close(tabId: string): Promise<void> {
    const tab = this.#tabs.get(tabId);
    // Closing a tab that is already gone is what was wanted.
    if (!tab) return;
    tab.closing = true;
    await tab.page.close();
    this.#removeTab(tab, "closed");
  }

  /**
   * The bot's tab lives in a window of its own, not inside the Markas window, so there is
   * nothing to place. `bringToFront` raises that window when the person asks for it.
   */
  async setVisible(_input: BrowserVisibilityInput): Promise<void> {}

  async takeControl(input: BrowserTakeControlInput): Promise<BrowserHandOff> {
    const tab = this.#tab(input.tabId);
    const record = this.#handOff(tab, "person", input.reason?.trim() || "You took over this tab.");
    // Taking over is the person asking to use the tab, so its window comes to them.
    await tab.page.bringToFront().catch(() => undefined);
    return { ...record.info };
  }

  resumeControl(input: BrowserResumeInput): void {
    const record = this.#handOffs.get(input.tabId);
    if (!record) return;
    this.#handOffs.delete(input.tabId);
    const tab = this.#tabs.get(input.tabId);
    // Whatever the person did, the bot's old references no longer describe the page.
    if (tab) tab.revision += 1;
    const note = input.note?.trim() ?? "";
    for (const waiter of [...record.waiters]) waiter.finish({ outcome: "returned", note });
    this.#emitControl();
  }

  async viewTab(tabId: string): Promise<BrowserTabView> {
    const tab = this.#tab(tabId);
    let image: string | null = null;
    let problem: string | null = null;
    if (tab.crashed) {
      problem = PAGE_CRASHED;
    } else {
      try {
        image = jpegDataUrl(await tab.page.screenshot(this.#actionTimeoutMs));
      } catch (error) {
        problem = this.#explain(error, tab, "look").message;
      }
    }
    // The tab may have closed while the picture was taken.
    if (!this.#tabs.has(tabId)) throw this.#goneProblem(tabId, tab.botId);
    const handOff = this.#handOffs.get(tabId)?.info ?? null;
    return {
      tab: summary(tab),
      controller: handOff ? "person" : "bot",
      handOff: handOff ? { ...handOff } : null,
      image,
      capturedAt: new Date().toISOString(),
      problem,
    };
  }

  async bringToFront(tabId: string): Promise<void> {
    const tab = this.#tab(tabId);
    if (this.#headless) {
      throw new BrowserProblem(
        "action-failed",
        "The bot browser is running without windows, so there is no window to show.",
      );
    }
    try {
      await tab.page.bringToFront();
    } catch (error) {
      throw this.#explain(error, tab, "look");
    }
    this.#activeTabId = tab.id;
    this.#emitChanged();
  }

  async fillSecret(input: BrowserSecretFill): Promise<void> {
    const tab = this.#tabs.get(input.tabId);
    if (!tab || tab.botId !== input.botId) throw this.#goneProblem(input.tabId, input.botId);
    this.#requireBotControl(tab);
    if (tab.crashed) throw new BrowserProblem("page-crashed", PAGE_CRASHED);
    // Registered before anything else, so the value is hidden even if the fill half works.
    this.#redactor(tab.botId).add(input.value);
    await this.#enqueue(tab, async () => {
      // Checked at the last moment: the page may have moved on while earlier actions ran.
      const actual = originOf(tab.page.url());
      if (!actual || actual !== input.origin) {
        throw new BrowserProblem(
          "wrong-site",
          `This tab is on ${actual ?? "a page without a website"}, not on ${input.origin}, so nothing was filled.`,
        );
      }
      try {
        await tab.page.fill(input.target, input.value, this.#actionTimeoutMs);
      } catch (error) {
        // Deliberately not `#explain`: nothing from the underlying error may be passed on.
        const failure = error instanceof DriverError ? error.failure : "other";
        if (failure === "crashed") tab.crashed = true;
        throw new BrowserProblem(
          failure === "not-found" ? "element-missing" : "action-failed",
          failure === "not-found"
            ? "Markas could not find that field on the page, so nothing was filled."
            : "Markas could not fill that field. Read the page again to see what it shows.",
        );
      }
    });
  }

  async forgetBot(botId: string): Promise<void> {
    await this.#closeBrowser(botId);
    this.#redactors.delete(botId);
    this.#lastThread.delete(botId);
    for (const [tabId, gone] of this.#gone) {
      if (gone.botId === botId) this.#gone.delete(tabId);
    }
    await rm(this.profileDir(botId), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }

  async destroy(): Promise<void> {
    this.#destroyed = true;
    await Promise.all([...this.#contexts.keys()].map((botId) => this.#closeBrowser(botId)));
    await Promise.all([...this.#closing.values()]);
    this.#sessions.clear();
  }

  async handleDynamicTool(
    params: DynamicToolCallParams,
    caller?: BrowserCaller,
  ): Promise<DynamicToolResult> {
    const botId = caller?.botId ?? null;
    if (!botId) {
      return failure("Markas could not tell which bot is asking, so the browser was not used.");
    }
    try {
      return await this.#runTool(botId, params);
    } catch (error) {
      const problem = error instanceof BrowserProblem ? error : this.#explain(error, null, "act");
      return failure(this.#redactor(botId).redact(problem.message));
    }
  }

  async #runTool(botId: string, params: DynamicToolCallParams): Promise<DynamicToolResult> {
    const args = isRecord(params.arguments) ? params.arguments : {};
    const redact = (value: string) => this.#redactor(botId).redact(value);
    switch (params.tool) {
      case "open": {
        const url = requireText(args.url, "url");
        return this.#acting(params, "open", null, async (session) => {
          const tab = await this.open(url, params.threadId, botId);
          session.tabId = tab.id;
          return text(
            redact(
              `Opened tab ${tab.id}.\nTitle: ${tab.title || "(none yet)"}\nAddress: ${tab.url}\nRead it with snapshot before you act on it.`,
            ),
          );
        });
      }
      case "list_tabs":
        return this.#acting(params, "list-tabs", null, async () => {
          const tabs = [...this.#tabs.values()].filter((tab) => tab.botId === botId);
          if (tabs.length === 0) return text("No tabs are open.");
          return text(redact(tabs.map((tab) => this.#describe(tab)).join("\n")));
        });
      case "snapshot": {
        const tab = this.#botTab(botId, args.tabId);
        return this.#acting(params, "snapshot", tab.id, () => this.#read(tab));
      }
      case "act": {
        const tab = this.#botTab(botId, args.tabId);
        const action = parseAction(args.action);
        return this.#acting(params, action.type, tab.id, () =>
          this.#act(tab, action, args.revision),
        );
      }
      case "screenshot": {
        const tab = this.#botTab(botId, args.tabId);
        return this.#acting(params, "screenshot", tab.id, async () => {
          this.#requireUsable(tab);
          const image = await this.#enqueue(tab, async () => {
            try {
              return await tab.page.screenshot(this.#actionTimeoutMs);
            } catch (error) {
              throw this.#explain(error, tab, "look");
            }
          });
          return {
            success: true,
            contentItems: [{ type: "inputImage", imageUrl: jpegDataUrl(image) }],
          };
        });
      }
      case "close_tab": {
        const tab = this.#botTab(botId, args.tabId);
        return this.#acting(params, "close-tab", tab.id, async () => {
          this.#requireBotControl(tab);
          await this.close(tab.id);
          return text(`Closed tab ${tab.id}.`);
        });
      }
      case "hand_off": {
        const tab = this.#botTab(botId, args.tabId);
        return this.#waitForPerson(tab, params, requireText(args.reason, "reason"));
      }
      default:
        throw new BrowserProblem(
          "invalid-request",
          `The browser has no tool called ${params.tool}.`,
        );
    }
  }

  async #read(tab: TabRecord): Promise<DynamicToolResult> {
    this.#requireUsable(tab);
    return this.#enqueue(tab, async () => {
      let page: string;
      try {
        page = await tab.page.read(this.#actionTimeoutMs);
      } catch (error) {
        throw this.#explain(error, tab, "read");
      }
      const redactor = this.#redactor(tab.botId);
      // What the person typed into a password field is theirs, not the bot's.
      for (const value of await tab.page.sensitiveValues().catch(() => [])) redactor.add(value);
      tab.revision += 1;
      this.#refresh(tab);
      if (page.length > MAX_PAGE_TEXT) this.#onTrimmed?.(tab.botId, page.length - MAX_PAGE_TEXT);
      const body =
        page.length > MAX_PAGE_TEXT
          ? `${page.slice(0, MAX_PAGE_TEXT)}\n(The page is longer than this. Scroll and read again to see more.)`
          : page;
      return text(
        redactor.redact(
          `Tab ${tab.id}\nTitle: ${tab.title}\nAddress: ${tab.page.url()}\nRevision: ${tab.revision}\n\n${body}`,
        ),
      );
    });
  }

  async #act(tab: TabRecord, action: ParsedAction, revision: unknown): Promise<DynamicToolResult> {
    this.#requireBotControl(tab);
    if (tab.crashed && action.type !== "reload") {
      throw new BrowserProblem("page-crashed", PAGE_CRASHED);
    }
    return this.#enqueue(tab, async () => {
      // References belong to one reading of the page; an older reading may point elsewhere.
      if (action.ref !== null && revision !== tab.revision) {
        throw new BrowserProblem("page-changed", PAGE_CHANGED);
      }
      const page = tab.page;
      try {
        switch (action.type) {
          case "click":
            await page.click(action.ref ?? "", this.#actionTimeoutMs);
            break;
          case "type":
            await page.type(action.ref, action.text, action.submit, this.#actionTimeoutMs);
            break;
          case "key":
            await page.press(action.key);
            break;
          case "scroll":
            await page.scroll(action.deltaY);
            break;
          case "back":
            await page.back(this.#navigationTimeoutMs);
            break;
          case "forward":
            await page.forward(this.#navigationTimeoutMs);
            break;
          case "reload":
            await page.reload(this.#navigationTimeoutMs);
            tab.crashed = false;
            break;
        }
      } catch (error) {
        const navigating = ["back", "forward", "reload"].includes(action.type);
        throw this.#explain(error, tab, navigating ? "open" : "act");
      }
      this.#refresh(tab);
      return text(
        this.#redactor(tab.botId).redact(
          `Done. The tab is on ${page.url()}. Read it again to see the result.`,
        ),
      );
    });
  }

  /** The bot passes the tab to the person and waits, for a while, until they give it back. */
  async #waitForPerson(
    tab: TabRecord,
    params: DynamicToolCallParams,
    reason: string,
  ): Promise<DynamicToolResult> {
    // Calling again while the person still has the tab simply keeps waiting.
    const record = this.#handOffs.get(tab.id) ?? this.#handOff(tab, "bot", reason);
    const outcome = await new Promise<WaitOutcome>((resolve) => {
      const waiter: Waiter = {
        threadId: params.threadId,
        turnId: params.turnId,
        finish: (result) => {
          clearTimeout(timer);
          record.waiters.delete(waiter);
          resolve(result);
        },
      };
      const timer = setTimeout(() => waiter.finish({ outcome: "waiting" }), this.#handOffWaitMs);
      record.waiters.add(waiter);
    });
    switch (outcome.outcome) {
      case "returned":
        return text(
          `The person finished and gave the tab back.${outcome.note ? ` They said: ${outcome.note}` : ""}\nRead the page again before you carry on.`,
        );
      case "waiting":
        return text(
          "The person has not finished yet and still controls this tab. Call hand_off again to keep waiting, or end your turn and say what you are waiting for.",
        );
      case "closed":
        return failure(TAB_CLOSED_BY_PERSON);
      case "stopped":
        return failure("The turn ended while waiting. The person still controls the tab.");
    }
  }

  #handOff(tab: TabRecord, requestedBy: "bot" | "person", reason: string): HandOffRecord {
    const existing = this.#handOffs.get(tab.id);
    if (existing) return existing;
    const record: HandOffRecord = {
      info: {
        tabId: tab.id,
        botId: tab.botId,
        threadId: tab.threadId,
        reason,
        requestedBy,
        startedAt: new Date().toISOString(),
      },
      waiters: new Set(),
    };
    this.#handOffs.set(tab.id, record);
    this.#emitControl();
    return record;
  }

  /** Shows the bot as acting for the length of one tool call, then as waiting for its next. */
  async #acting(
    params: DynamicToolCallParams,
    action: BrowserControlAction,
    tabId: string | null,
    run: (session: BrowserControlSession) => Promise<DynamicToolResult>,
  ): Promise<DynamicToolResult> {
    const key = sessionKey(params.threadId, params.turnId);
    const session: BrowserControlSession = {
      id: randomUUID(),
      threadId: params.threadId,
      turnId: params.turnId,
      callId: params.callId,
      tabId,
      action,
      phase: "acting",
      startedAt: new Date().toISOString(),
    };
    this.#sessions.set(key, session);
    this.#emitControl();
    try {
      return await run(session);
    } finally {
      // The turn may have ended, or a later call may have taken over, while this one ran.
      if (this.#sessions.get(key) === session) {
        session.phase = "waiting";
        this.#emitControl();
      }
    }
  }

  async #newTab(botId: string, threadId: string | null): Promise<TabRecord> {
    const context = await this.#contextFor(botId);
    this.#lastThread.set(botId, threadId);
    try {
      // A browser starts with one empty page; the first tab uses it.
      const spare = context
        .pages()
        .find((page) => !this.#byPage.has(page) && page.url() === "about:blank");
      const page = spare ?? (await context.newPage());
      const tab = this.#adopt(botId, page);
      tab.threadId = threadId;
      return tab;
    } catch (error) {
      throw this.#explain(error, null, "open");
    }
  }

  #adopt(botId: string, page: DriverPage): TabRecord {
    const known = this.#byPage.get(page);
    if (known) return known;
    const tab: TabRecord = {
      id: randomUUID().slice(0, 8),
      botId,
      threadId: this.#lastThread.get(botId) ?? null,
      page,
      title: "",
      url: page.url(),
      loading: false,
      revision: 0,
      crashed: false,
      closing: false,
      queue: Promise.resolve(),
    };
    this.#tabs.set(tab.id, tab);
    this.#byPage.set(page, tab);
    page.on((event) => this.#pageEvent(tab, event));
    this.#emitChanged();
    return tab;
  }

  #pageEvent(tab: TabRecord, event: DriverPageEvent): void {
    if (!this.#tabs.has(tab.id)) return;
    switch (event) {
      case "loading":
        tab.loading = true;
        tab.crashed = false;
        tab.revision += 1;
        this.#refresh(tab);
        break;
      case "loaded":
        tab.loading = false;
        this.#refresh(tab);
        break;
      case "crashed":
        tab.crashed = true;
        tab.loading = false;
        this.#emitChanged();
        break;
      case "closed":
        this.#removeTab(tab, tab.closing ? "closed" : "closed-by-person");
        break;
    }
  }

  /** Brings the tab's address and title up to date and tells the listeners. */
  #refresh(tab: TabRecord): void {
    if (!this.#tabs.has(tab.id)) return;
    tab.url = tab.page.url();
    this.#emitChanged();
    void tab.page.title().then(
      (title) => {
        if (title === tab.title || !this.#tabs.has(tab.id)) return;
        tab.title = title;
        this.#emitChanged();
      },
      () => undefined,
    );
  }

  #removeTab(tab: TabRecord, reason: GoneReason): void {
    if (!this.#tabs.delete(tab.id)) return;
    this.#byPage.delete(tab.page);
    this.#gone.set(tab.id, { botId: tab.botId, reason });
    if (this.#gone.size > MAX_REMEMBERED_CLOSED_TABS) {
      const oldest = this.#gone.keys().next().value;
      if (oldest !== undefined) this.#gone.delete(oldest);
    }
    const handOff = this.#handOffs.get(tab.id);
    if (handOff) {
      this.#handOffs.delete(tab.id);
      for (const waiter of [...handOff.waiters]) waiter.finish({ outcome: "closed" });
    }
    let controlChanged = handOff !== undefined;
    for (const session of this.#sessions.values()) {
      if (session.tabId !== tab.id) continue;
      session.tabId = null;
      controlChanged = true;
    }
    if (this.#activeTabId === tab.id) {
      this.#activeTabId = [...this.#tabs.keys()].pop() ?? null;
    }
    this.#emitChanged();
    if (controlChanged) this.#emitControl();
    // A bot with no tabs needs no browser, and letting go frees its profile.
    if (![...this.#tabs.values()].some((other) => other.botId === tab.botId)) {
      void this.#closeBrowser(tab.botId);
    }
  }

  async #contextFor(botId: string): Promise<DriverContext> {
    await this.#closing.get(botId);
    let pending = this.#contexts.get(botId);
    if (!pending) {
      pending = this.#launch(botId);
      this.#contexts.set(botId, pending);
      pending.catch(() => {
        // A failed start is not remembered: the next try starts fresh.
        if (this.#contexts.get(botId) === pending) this.#contexts.delete(botId);
      });
    }
    return pending;
  }

  async #launch(botId: string): Promise<DriverContext> {
    const profileDir = this.profileDir(botId);
    await mkdir(profileDir, { recursive: true });
    const failed: string[] = [];
    const start = async (target: BrowserTarget): Promise<DriverContext | null> => {
      try {
        return await this.#driver.launch({ target, profileDir, headless: this.#headless });
      } catch (error) {
        if (error instanceof DriverError && error.failure === "profile-locked") {
          throw new BrowserProblem("profile-locked", PROFILE_LOCKED);
        }
        failed.push(`${target.label} did not start`);
        return null;
      }
    };

    let context: DriverContext | null = null;
    for (const target of this.#finder.installed()) {
      context = await start(target);
      if (context) break;
    }
    if (!context) {
      // Only now, with no installed browser that works, does Markas use its own.
      let own = this.#finder.downloaded();
      if (!own) {
        try {
          own = await this.#finder.download();
        } catch (error) {
          const found = failed.length > 0 ? `${failed.join(", ")}, and` : "";
          throw new BrowserProblem(
            "no-browser",
            `Markas could not start a browser. ${found || "Chrome and Edge were not found on this computer, and"} its own browser could not be downloaded (${reasonOf(error)}). Install Chrome or Edge, or check the internet connection, then try again.`.replace(
              /\s+/g,
              " ",
            ),
          );
        }
      }
      context = await start(own);
    }
    if (!context) {
      throw new BrowserProblem(
        "no-browser",
        `Markas could not start a browser: ${failed.join(", ")}. Install or repair Chrome or Edge, then try again.`,
      );
    }

    const launched = context;
    launched.onPage((page) => {
      // A page a website opened itself, such as a sign-in window, becomes a tab of the same bot.
      if (this.#contexts.has(botId)) this.#adopt(botId, page);
    });
    launched.onClosed(() => this.#browserGone(botId, launched));
    return launched;
  }

  /** The browser ended on its own: the person closed its window, or it died. */
  #browserGone(botId: string, context: DriverContext): void {
    const pending = this.#contexts.get(botId);
    if (!pending) return;
    void pending.then(
      (current) => {
        if (current !== context) return;
        this.#contexts.delete(botId);
        for (const tab of [...this.#tabs.values()]) {
          if (tab.botId === botId) this.#removeTab(tab, "browser-closed");
        }
      },
      () => undefined,
    );
  }

  #closeBrowser(botId: string): Promise<void> {
    const pending = this.#contexts.get(botId);
    if (!pending) return this.#closing.get(botId) ?? Promise.resolve();
    this.#contexts.delete(botId);
    for (const tab of [...this.#tabs.values()]) {
      if (tab.botId !== botId) continue;
      tab.closing = true;
      this.#removeTab(tab, "closed");
    }
    const closing = pending
      .then(
        (context) => context.close(),
        () => undefined,
      )
      .catch(() => undefined)
      .finally(() => {
        if (this.#closing.get(botId) === closing) this.#closing.delete(botId);
      });
    this.#closing.set(botId, closing);
    return closing;
  }

  #enqueue<T>(tab: TabRecord, action: () => Promise<T>): Promise<T> {
    const result = tab.queue.then(action, action);
    tab.queue = result.catch(() => undefined);
    return result;
  }

  #tab(tabId: string): TabRecord {
    const tab = this.#tabs.get(tabId);
    if (!tab) throw this.#goneProblem(tabId, null);
    return tab;
  }

  /** A bot reaches only its own tabs; another bot's tab does not exist for it. */
  #botTab(botId: string, tabId: unknown): TabRecord {
    const id = requireText(tabId, "tabId");
    const tab = this.#tabs.get(id);
    if (!tab || tab.botId !== botId) throw this.#goneProblem(id, botId);
    return tab;
  }

  #goneProblem(tabId: string, botId: string | null): BrowserProblem {
    const gone = this.#gone.get(tabId);
    if (!gone || (botId !== null && gone.botId !== botId)) {
      return new BrowserProblem("tab-closed", TAB_UNKNOWN);
    }
    const message =
      gone.reason === "closed-by-person"
        ? TAB_CLOSED_BY_PERSON
        : gone.reason === "browser-closed"
          ? BROWSER_CLOSED
          : TAB_CLOSED;
    return new BrowserProblem("tab-closed", message);
  }

  #requireBotControl(tab: TabRecord): void {
    const handOff = this.#handOffs.get(tab.id);
    if (!handOff) return;
    throw new BrowserProblem(
      "person-in-control",
      `The person is controlling this tab right now (${handOff.info.reason}). Call hand_off to wait until they give it back.`,
    );
  }

  #requireUsable(tab: TabRecord): void {
    this.#requireBotControl(tab);
    if (tab.crashed) throw new BrowserProblem("page-crashed", PAGE_CRASHED);
  }

  #describe(tab: TabRecord): string {
    const handOff = this.#handOffs.get(tab.id);
    const state = tab.crashed
      ? " | crashed"
      : handOff
        ? ` | the person controls it (${handOff.info.reason})`
        : tab.loading
          ? " | loading"
          : "";
    return `- ${tab.id} | ${tab.title || "(no title)"} | ${tab.url}${state}`;
  }

  #redactor(botId: string): SecretRedactor {
    let redactor = this.#redactors.get(botId);
    if (!redactor) {
      redactor = new SecretRedactor();
      this.#redactors.set(botId, redactor);
    }
    return redactor;
  }

  /** Turns a driver failure into a sentence that says what happened and what to do next. */
  #explain(error: unknown, tab: TabRecord | null, doing: "open" | "act" | "read" | "look") {
    if (error instanceof BrowserProblem) return error;
    const failure = error instanceof DriverError ? error.failure : "other";
    const seconds = (ms: number) => Math.round(ms / 1_000);
    switch (failure) {
      case "timeout":
        if (doing === "open") {
          return new BrowserProblem(
            "navigation-timeout",
            `The page took longer than ${seconds(this.#navigationTimeoutMs)} seconds to load.${tab ? ` The tab is still open as ${tab.id}: read it to see what did load, or reload it.` : ""}`,
          );
        }
        return new BrowserProblem(
          "action-failed",
          doing === "act"
            ? `That part of the page did not respond within ${seconds(this.#actionTimeoutMs)} seconds. It may be hidden, disabled or covered. Read the page again and try another way.`
            : `The page did not answer within ${seconds(this.#actionTimeoutMs)} seconds. It may still be loading; try again in a moment.`,
        );
      case "crashed":
        if (tab) tab.crashed = true;
        return new BrowserProblem("page-crashed", PAGE_CRASHED);
      case "closed":
        return new BrowserProblem(
          "tab-closed",
          tab && !tab.closing ? TAB_CLOSED_BY_PERSON : TAB_CLOSED,
        );
      case "not-found":
        return new BrowserProblem("element-missing", ELEMENT_MISSING);
      case "unreachable":
        return new BrowserProblem(
          "unreachable",
          `That address could not be reached (${reasonOf(error)}). Check the address and the internet connection.${tab ? ` The tab is still open as ${tab.id}.` : ""}`,
        );
      case "profile-locked":
        return new BrowserProblem("profile-locked", PROFILE_LOCKED);
      default:
        return new BrowserProblem(
          "action-failed",
          `The browser could not do that (${reasonOf(error)}).`,
        );
    }
  }

  #emitChanged(): void {
    const tabs = this.listTabs();
    for (const listener of this.#changedListeners) listener(tabs, this.#activeTabId);
  }

  #emitControl(): void {
    const state = this.getControlState();
    for (const listener of this.#controlListeners) listener(state);
  }
}

type ParsedAction =
  | { type: "click"; ref: string }
  | { type: "type"; ref: string | null; text: string; submit: boolean }
  | { type: "key"; ref: null; key: string }
  | { type: "scroll"; ref: null; deltaY: number }
  | { type: "back" | "forward" | "reload"; ref: null };

function parseAction(value: unknown): ParsedAction {
  const action = isRecord(value) ? value : {};
  const ref = typeof action.ref === "string" && action.ref ? action.ref : null;
  switch (action.type) {
    case "click":
      if (!ref) throw invalid("A click needs the reference of the element to click.");
      return { type: "click", ref };
    case "type":
      if (typeof action.text !== "string") throw invalid("Typing needs the text to type.");
      return { type: "type", ref, text: action.text, submit: action.submit === true };
    case "key":
      return { type: "key", ref: null, key: requireText(action.key, "key") };
    case "scroll":
      return {
        type: "scroll",
        ref: null,
        deltaY:
          typeof action.deltaY === "number" && Number.isFinite(action.deltaY)
            ? action.deltaY
            : SCROLL_STEP,
      };
    case "back":
    case "forward":
    case "reload":
      return { type: action.type, ref: null };
    default:
      throw invalid("Unknown action. Use click, type, key, scroll, back, forward or reload.");
  }
}

function httpAddress(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid(
      `"${value}" is not a web address. Use a full address such as https://example.com.`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalid("The browser only opens http and https addresses.");
  }
  return url.toString();
}

function originOf(address: string): string | null {
  try {
    const url = new URL(address);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function summary(tab: TabRecord): BrowserTab {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    loading: tab.loading,
    ownerThreadId: tab.threadId,
    ownerBotId: tab.botId,
  };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalid(`${field} is required.`);
  return value;
}

const invalid = (message: string) => new BrowserProblem("invalid-request", message);
const sessionKey = (threadId: string, turnId: string) => `${threadId}\n${turnId}`;
const text = (value: string): DynamicToolResult => ({
  success: true,
  contentItems: [{ type: "inputText", text: value }],
});
const failure = (value: string): DynamicToolResult => ({
  success: false,
  contentItems: [{ type: "inputText", text: value }],
});
const jpegDataUrl = (bytes: Uint8Array) =>
  `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
const reasonOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0]?.trim() ||
  "no reason given";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
