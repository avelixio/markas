import type { BrowserFinder } from "../browser/browser-finder";
import {
  type BrowserDriver,
  type BrowserLaunchOptions,
  type BrowserTarget,
  type DriverContext,
  DriverError,
  type DriverFailure,
  type DriverPage,
  type DriverPageEvent,
  type SecretTarget,
} from "../browser/driver";

/** A computer for tests: which browsers it has, and whether a download would work. */
export class FakeBrowserFinder implements BrowserFinder {
  targets: BrowserTarget[];
  own: BrowserTarget | null = null;
  downloadProblem: string | null = null;
  downloads = 0;

  constructor(targets: BrowserTarget[] = [CHROME]) {
    this.targets = targets;
  }

  installed(): BrowserTarget[] {
    return this.targets;
  }

  downloaded(): BrowserTarget | null {
    return this.own;
  }

  async download(): Promise<BrowserTarget> {
    this.downloads += 1;
    if (this.downloadProblem) throw new Error(this.downloadProblem);
    this.own = OWN_CHROMIUM;
    return this.own;
  }
}

export const CHROME: BrowserTarget = { kind: "channel", channel: "chrome", label: "Chrome" };
export const EDGE: BrowserTarget = { kind: "channel", channel: "msedge", label: "Edge" };
export const OWN_CHROMIUM: BrowserTarget = {
  kind: "executable",
  path: "/markas/browsers/chromium-1/chrome",
  label: "Markas's own Chromium",
};

/**
 * A browser for tests. It keeps pages in memory and does what the service asks,
 * and a test can make it fail the way a real browser does.
 */
export class FakeBrowserDriver implements BrowserDriver {
  readonly launches: BrowserLaunchOptions[] = [];
  readonly contexts: FakeContext[] = [];
  /** Labels of browsers that refuse to start. */
  readonly broken = new Set<string>();
  /** Profile folders another program is using. */
  readonly lockedProfiles = new Set<string>();
  /** How each address behaves when opened; anything else loads at once. */
  readonly addresses = new Map<string, DriverFailure>();

  async launch(options: BrowserLaunchOptions): Promise<DriverContext> {
    this.launches.push(options);
    if (this.lockedProfiles.has(options.profileDir)) {
      throw new DriverError("profile-locked", "The profile is in use.");
    }
    if (this.broken.has(options.target.label)) {
      throw new DriverError("launch-failed", "The browser did not start.");
    }
    const context = new FakeContext(this, options);
    this.contexts.push(context);
    return context;
  }

  /** The most recently started browser. */
  get last(): FakeContext {
    const context = this.contexts.at(-1);
    if (!context) throw new Error("No browser was started.");
    return context;
  }
}

export class FakeContext implements DriverContext {
  readonly options: BrowserLaunchOptions;
  readonly driver: FakeBrowserDriver;
  readonly #pages: FakePage[] = [];
  readonly #pageListeners: Array<(page: DriverPage) => void> = [];
  readonly #closedListeners: Array<() => void> = [];
  closed = false;

  constructor(driver: FakeBrowserDriver, options: BrowserLaunchOptions) {
    this.driver = driver;
    this.options = options;
    // A real browser starts with one empty page.
    this.#pages.push(new FakePage(this));
  }

  pages(): FakePage[] {
    return this.#pages.filter((page) => !page.closed);
  }

  async newPage(): Promise<FakePage> {
    if (this.closed) throw new DriverError("closed", "The browser has been closed.");
    const page = new FakePage(this);
    this.#pages.push(page);
    for (const listener of this.#pageListeners) listener(page);
    return page;
  }

  onPage(listener: (page: DriverPage) => void): void {
    this.#pageListeners.push(listener);
  }

  onClosed(listener: () => void): void {
    this.#closedListeners.push(listener);
  }

  async close(): Promise<void> {
    this.#end();
  }

  /** A website opens a window of its own. */
  async popup(url: string): Promise<FakePage> {
    const page = await this.newPage();
    page.land(url);
    return page;
  }

  /** The person closes the browser window. */
  closeWindow(): void {
    this.#end();
  }

  #end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const page of this.#pages) page.end();
    for (const listener of this.#closedListeners) listener();
  }
}

export class FakePage implements DriverPage {
  readonly context: FakeContext;
  readonly actions: string[] = [];
  /** What each field holds, by reference, selector or field kind. */
  readonly fields = new Map<string, string>();
  /** Values in password fields and fields Markas filled. */
  readonly secrets: string[] = [];
  closed = false;
  crashed = false;
  /** Makes the next action on an element fail this way. */
  nextFailure: DriverFailure | null = null;
  #url = "about:blank";
  #title = "";
  readonly #listeners: Array<(event: DriverPageEvent) => void> = [];

  constructor(context: FakeContext) {
    this.context = context;
  }

  url(): string {
    return this.#url;
  }

  async title(): Promise<string> {
    this.#alive();
    return this.#title;
  }

  async goto(url: string): Promise<void> {
    this.#alive();
    const failure = this.context.driver.addresses.get(url);
    if (failure === "timeout") {
      // The address is reached but the page never finishes loading.
      this.#url = url;
      this.#emit("loading");
      throw new DriverError("timeout", "Timeout exceeded.");
    }
    if (failure) throw new DriverError(failure, `net::ERR_FAILED at ${url}`);
    this.land(url);
  }

  async read(): Promise<string> {
    this.#alive();
    const lines = [`- heading "${this.#title}"`, '- button "Go" [ref=e1]'];
    for (const [name, value] of this.fields) lines.push(`- textbox "${name}": ${value}`);
    return lines.join("\n");
  }

  async click(ref: string): Promise<void> {
    this.#element();
    this.actions.push(`click ${ref}`);
  }

  async type(ref: string | null, text: string, submit: boolean): Promise<void> {
    this.#element();
    this.fields.set(ref ?? "focused", text);
    this.actions.push(`type ${ref ?? "focused"}${submit ? " submit" : ""}`);
  }

  async press(key: string): Promise<void> {
    this.#alive();
    this.actions.push(`key ${key}`);
  }

  async scroll(deltaY: number): Promise<void> {
    this.#alive();
    this.actions.push(`scroll ${deltaY}`);
  }

  async back(): Promise<void> {
    this.#alive();
    this.actions.push("back");
  }

  async forward(): Promise<void> {
    this.#alive();
    this.actions.push("forward");
  }

  async reload(): Promise<void> {
    if (this.closed) throw new DriverError("closed", "The page has been closed.");
    this.crashed = false;
    this.actions.push("reload");
    this.land(this.#url);
  }

  async fill(target: SecretTarget, value: string): Promise<void> {
    try {
      this.#element();
    } catch (error) {
      // As the real driver does: nothing of the original error is passed on.
      throw new DriverError((error as DriverError).failure, "The field could not be filled.");
    }
    const name =
      "ref" in target ? target.ref : "selector" in target ? target.selector : target.field;
    this.fields.set(name, value);
    this.secrets.push(value);
    this.actions.push(`fill ${name}`);
  }

  async sensitiveValues(): Promise<string[]> {
    return [...this.secrets];
  }

  async screenshot(): Promise<Uint8Array> {
    this.#alive();
    return new Uint8Array([0xff, 0xd8, 0xff]);
  }

  async bringToFront(): Promise<void> {
    this.#alive();
    this.actions.push("bringToFront");
  }

  async close(): Promise<void> {
    this.end();
  }

  on(listener: (event: DriverPageEvent) => void): void {
    this.#listeners.push(listener);
  }

  /** The page arrives at an address, as after a navigation. */
  land(url: string, title = `Page at ${new URL(url).host}`): void {
    this.#url = url;
    this.#title = title;
    this.#emit("loading");
    this.#emit("loaded");
  }

  /** The person types into a password field themselves. */
  personTypesPassword(value: string): void {
    this.fields.set("Password", value);
    this.secrets.push(value);
  }

  crash(): void {
    this.crashed = true;
    this.#emit("crashed");
  }

  /** The person closes the tab. */
  closeByPerson(): void {
    this.end();
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.#emit("closed");
  }

  #alive(): void {
    if (this.closed) throw new DriverError("closed", "The page has been closed.");
    if (this.crashed) throw new DriverError("crashed", "The page crashed.");
  }

  #element(): void {
    this.#alive();
    const failure = this.nextFailure;
    this.nextFailure = null;
    if (failure) throw new DriverError(failure, "The element could not be used.");
  }

  #emit(event: DriverPageEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
