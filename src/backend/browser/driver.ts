// The seam between the bot browser and the library that drives a real browser.
// The service is written against these interfaces, so unit tests run with a fake driver
// and no browser, and the driving library can change without touching the service.

/** A browser Markas can start. */
export type BrowserTarget =
  | { kind: "channel"; channel: "chrome" | "msedge"; label: string }
  | { kind: "executable"; path: string; label: string };

export interface BrowserLaunchOptions {
  target: BrowserTarget;
  /** The bot's own profile folder: cookies, sign-ins and site data live here. */
  profileDir: string;
  /** Without a window. The person cannot take over a headless browser, so this is for checks only. */
  headless: boolean;
}

export type DriverFailure =
  /** The browser could not be started at all. */
  | "launch-failed"
  /** Another process is already using the profile folder. */
  | "profile-locked"
  /** Something took longer than it was given. */
  | "timeout"
  /** The page, or the whole browser, is gone. */
  | "closed"
  | "crashed"
  /** The element asked for is not on the page. */
  | "not-found"
  /** The address could not be reached. */
  | "unreachable"
  | "other";

/**
 * Every failure a driver reports.
 * `message` must never contain a value passed to `fill`.
 */
export class DriverError extends Error {
  readonly failure: DriverFailure;

  constructor(failure: DriverFailure, message: string) {
    super(message);
    this.name = "DriverError";
    this.failure = failure;
  }
}

export type DriverPageEvent = "loading" | "loaded" | "crashed" | "closed";

/** Which form field a secret goes into. */
export type SecretTarget =
  /** An element reference from the latest reading of the page. */
  | { ref: string }
  /** A CSS selector, for a caller that already knows the form. */
  | { selector: string }
  /** The usual field of that kind, found by how sign-in forms are normally marked up. */
  | { field: "username" | "password" | "one-time-code" };

export interface DriverPage {
  url(): string;
  title(): Promise<string>;
  goto(url: string, timeoutMs: number): Promise<void>;
  /** The page as text, with a reference on every element that can be acted on. */
  read(timeoutMs: number): Promise<string>;
  click(ref: string, timeoutMs: number): Promise<void>;
  /** Types into the element, or into whatever has focus when `ref` is null. */
  type(ref: string | null, text: string, submit: boolean, timeoutMs: number): Promise<void>;
  press(key: string): Promise<void>;
  scroll(deltaY: number): Promise<void>;
  back(timeoutMs: number): Promise<void>;
  forward(timeoutMs: number): Promise<void>;
  reload(timeoutMs: number): Promise<void>;
  /**
   * Puts a secret into a field of the page's own document, and marks the field so it is
   * covered in screenshots. Errors never contain the value.
   */
  fill(target: SecretTarget, value: string, timeoutMs: number): Promise<void>;
  /** What is typed into password fields and filled secret fields right now. */
  sensitiveValues(): Promise<string[]>;
  /** A JPEG of the visible page, with secret fields covered. */
  screenshot(timeoutMs: number): Promise<Uint8Array>;
  /** Raises the page's window so the person can see and use it. */
  bringToFront(): Promise<void>;
  close(): Promise<void>;
  on(listener: (event: DriverPageEvent) => void): void;
}

export interface DriverContext {
  pages(): DriverPage[];
  newPage(): Promise<DriverPage>;
  /** Called for every page that appears, whether Markas or a website opened it. */
  onPage(listener: (page: DriverPage) => void): void;
  /** Called once when the browser is gone, however that happened. */
  onClosed(listener: () => void): void;
  close(): Promise<void>;
}

export interface BrowserDriver {
  launch(options: BrowserLaunchOptions): Promise<DriverContext>;
}
