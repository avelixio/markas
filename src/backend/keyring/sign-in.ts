import { type AccessLevel, covers, type Grant, judgeKeyUse } from "../access/policy";
import { KeyringCryptoError } from "./crypto";
import {
  type KeyKind,
  KeyringError,
  type KeyringStore,
  type KeySummary,
  type OpenedKey,
} from "./keyring-store";
import { isSameOrigin } from "./origin";
import { totpWindow } from "./totp";

export type SecretField = "username" | "password" | "otp";

/**
 * The one door through which a secret reaches a web page.
 *
 * This is where the real bot browser plugs in: implement this interface on top of the browser
 * and pass it to `KeySignIn` (see `createBotKeyTools` in `src/host/keyring-methods.ts`).
 * The sign-in logic depends on nothing else from the browser.
 *
 * Rules for an implementation:
 * - Every method acts on the bot's current tab, the one the bot itself is working in.
 * - `fillSecret` types into the top-level page only, never into a frame from another site, and
 *   only while that page is on exactly `site` (scheme, host and port). It checks this itself at
 *   the moment of typing and answers "wrong-site" otherwise, because only the browser can make
 *   that check and the typing one step.
 * - `fillSecret` replaces what the field holds; it does not add to it.
 * - A value given to `fillSecret` is never logged, put in an event, an error message or a
 *   control record, and is not shown back to the bot in a later snapshot or screenshot.
 * - `submit` sends the form the last field belongs to and resolves once the page has settled
 *   (the next page has loaded, or nothing more is loading).
 * - An error may be thrown for a browser fault. Its message is never shown or stored.
 */
export interface SecretFiller {
  /** The address of the bot's current tab, or null when it has none. */
  currentUrl(botId: string): Promise<string | null>;
  /** Whether the current page shows a field of this kind. Nothing is typed. */
  hasField(botId: string, field: SecretField): Promise<boolean>;
  /** Types a value into the field of this kind, if the page has one and is on `site`. */
  fillSecret(
    botId: string,
    field: SecretField,
    value: string,
    site: string,
  ): Promise<"filled" | "not-found" | "wrong-site">;
  submit(botId: string): Promise<void>;
}

/** Stands in until the bot browser exists: there is never a tab, so nothing is ever typed. */
export class NoBrowserSecretFiller implements SecretFiller {
  async currentUrl(): Promise<string | null> {
    return null;
  }
  async hasField(): Promise<boolean> {
    return false;
  }
  async fillSecret(): Promise<"not-found"> {
    return "not-found";
  }
  async submit(): Promise<void> {}
}

export type SignInOutcome =
  | "signed-in"
  | "wrong-site"
  | "no-page"
  | "not-shared"
  | "not-a-login"
  | "not-allowed"
  | "handed-over"
  | "key-removed"
  | "key-changed"
  | "keyring-unavailable"
  | "browser-failed";

/** All a bot ever learns about a sign-in: how it ended, in plain words. Never a secret. */
export interface SignInResult {
  outcome: SignInOutcome;
  message: string;
}

/** What a bot may know about a key shared with it. */
export interface BotKey {
  id: string;
  name: string;
  kind: KeyKind;
  /** The exact site the key works on; null for a variable. */
  site: string | null;
  hasTwoStepCode: boolean;
}

export type KeyUseDecision = "once" | "chat" | "deny";

export interface SignInRequest {
  botId: string;
  /** The chat the bot is working in. A yes "for this chat" is remembered under it. */
  chatId: string;
  /** The access level the bot's current turn runs at. */
  level: AccessLevel;
  key: { name: string } | { id: string };
  /** Asks the person. Anything but an explicit yes is a no. */
  ask(detail: string, canAllowForChat: boolean): Promise<KeyUseDecision>;
}

export interface KeySignInOptions {
  /** Null when the keyring could not be opened. */
  keyring: KeyringStore | null;
  filler: SecretFiller;
  botName(botId: string): string;
  /** Writes one logbook line. The sentence holds names and sites only. */
  record(sentence: string, outcome: "done" | "failed"): Promise<void>;
  now?: () => number;
}

const KEYRING_UNAVAILABLE =
  "The keyring cannot be opened right now, so no saved key can be used. Tell the person; they can check it on the Keyring screen.";

/** Ends a sign-in early with the answer the bot gets and the reason the logbook keeps. */
class Stop extends Error {
  constructor(
    readonly result: SignInResult,
    readonly reason: string,
  ) {
    super(result.outcome);
  }
}

interface PageLook {
  onSite: boolean;
  /** Where the tab is, as a site and never a full address. */
  site: string;
  password: boolean;
  otp: boolean;
}

/**
 * Signs a bot in to a website with a saved key, without the bot ever holding the key.
 *
 * The bot names a key. The host checks that the key is shared with that bot, that the bot's
 * tab is on the key's exact site, and that the person allows it; then it types the username,
 * the password and the one-time code itself. The bot gets back a sentence about how it went.
 */
export class KeySignIn {
  readonly #keyring: KeyringStore | null;
  readonly #filler: SecretFiller;
  readonly #botName: (botId: string) => string;
  readonly #record: KeySignInOptions["record"];
  readonly #now: () => number;
  /** What the person allowed for the rest of each chat. */
  readonly #grants = new Map<string, Grant[]>();
  /** One sign-in at a time per bot, so two calls cannot type into the same page at once. */
  readonly #queues = new Map<string, Promise<void>>();

  constructor(options: KeySignInOptions) {
    this.#keyring = options.keyring;
    this.#filler = options.filler;
    this.#botName = options.botName;
    this.#record = options.record;
    this.#now = options.now ?? Date.now;
  }

  /** The names and sites of the keys shared with a bot, so it knows what to ask for. */
  listForBot(botId: string): BotKey[] | null {
    if (!this.#keyring) return null;
    return this.#keyring.listForBot(botId).map((key) => ({
      id: key.id,
      name: key.name,
      kind: key.kind,
      site: key.origin,
      hasTwoStepCode: key.hasTwoStepCode,
    }));
  }

  /** Forgets what was allowed for a chat: its session ended or the bot's level changed. */
  forgetChat(chatId: string): void {
    this.#grants.delete(chatId);
  }

  forgetAllChats(): void {
    this.#grants.clear();
  }

  signIn(request: SignInRequest): Promise<SignInResult> {
    const previous = this.#queues.get(request.botId) ?? Promise.resolve();
    const run = previous.then(() => this.#signIn(request));
    this.#queues.set(
      request.botId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async #signIn(request: SignInRequest): Promise<SignInResult> {
    const keyring = this.#keyring;
    if (!keyring) return { outcome: "keyring-unavailable", message: KEYRING_UNAVAILABLE };

    let key: KeySummary;
    try {
      key = keyring.summaryForBot(request.botId, request.key);
    } catch (error) {
      // Nothing is recorded here: no key was touched, and the name is only what the bot typed.
      return unresolved(error, request.key);
    }
    const site = key.origin;
    if (key.kind !== "login" || !site || !key.username) {
      return {
        outcome: "not-a-login",
        message: `The key "${key.name}" is not a website login, so it cannot be used to sign in.`,
      };
    }

    try {
      const result = await this.#use(keyring, request, key, site);
      await this.#log(request.botId, key.name, site, null);
      return result;
    } catch (error) {
      const stop = error instanceof Stop ? error : unexpected(error, key.name);
      await this.#log(request.botId, key.name, site, stop.reason);
      return stop.result;
    }
  }

  async #use(
    keyring: KeyringStore,
    request: SignInRequest,
    key: KeySummary,
    site: string,
  ): Promise<SignInResult> {
    const { botId } = request;
    if (key.fillPolicy === "handoff") {
      throw new Stop(
        handedOver(`The key "${key.name}" is kept for the person to use themselves.`, site),
        "the key is kept for the person",
      );
    }
    await this.#requireOnSite(botId, key.name, site);
    await this.#requireYes(request, key, site);

    // The person may have taken a while to answer. Everything is checked again before a
    // secret is opened: the key, who it is shared with, and where the tab is now.
    const current = stillShared(keyring, botId, key);
    // What the person said yes to is this key on this site under this setting. A new password
    // or username is simply used; anything else is a different question.
    if (
      current.origin !== key.origin ||
      current.kind !== key.kind ||
      current.fillPolicy !== key.fillPolicy ||
      !current.username
    ) {
      throw new Stop(
        {
          outcome: "key-changed",
          message: `The key "${key.name}" was changed in the keyring just now. Use keyring_list to see it as it is, then try again.`,
        },
        "the key was changed meanwhile",
      );
    }
    await this.#requireOnSite(botId, key.name, site);

    const opened = await keyring.openForBot(botId, { id: key.id }, this.#now());
    return this.#fillAndSubmit(
      botId,
      opened.summary.name,
      site,
      opened.summary.username ?? current.username,
      opened,
    );
  }

  async #requireYes(request: SignInRequest, key: KeySummary, site: string): Promise<void> {
    const verdict = judgeKeyUse(request.level, {
      id: key.id,
      name: key.name,
      origin: site,
      askEveryTime: key.fillPolicy === "ask",
    });
    const grants = this.#grants.get(request.chatId) ?? [];
    if (verdict.decision === "allow" || covers(grants, verdict)) return;
    const decision = await request
      .ask(verdict.detail, verdict.grant !== null)
      .catch((): KeyUseDecision => "deny");
    if (decision === "chat" && verdict.grant) {
      this.#grants.set(request.chatId, [...grants, verdict.grant]);
    }
    if (decision !== "once" && decision !== "chat") {
      throw new Stop(
        {
          outcome: "not-allowed",
          message: `The person did not allow using the key "${key.name}" this time. Do not retry it or work around it; say what you needed and ask how to continue.`,
        },
        "not allowed",
      );
    }
  }

  async #fillAndSubmit(
    botId: string,
    keyName: string,
    site: string,
    username: string,
    opened: OpenedKey,
  ): Promise<SignInResult> {
    const type = (field: SecretField, value: string) =>
      this.#type(botId, keyName, site, field, value);
    const codeAt = opened.twoStepCodeAt;
    const period = opened.twoStepPeriodSeconds ?? 30;
    /** The moment the last typed code was made for, or null when none was typed. */
    const tried: { codeTime: number | null } = { codeTime: null };
    const typeCode = async (timeMs: number): Promise<boolean> => {
      if (!codeAt || (await type("otp", codeAt(timeMs))) !== "filled") return false;
      tried.codeTime = timeMs;
      return true;
    };

    const user = await type("username", username);
    let password = await type("password", opened.value);
    if (user === "filled" && password === "not-found") {
      // A site that asks for the username first and the password on the next page.
      await this.#filler.submit(botId);
      password = await type("password", opened.value);
      if (password === "not-found") {
        throw new Stop(
          handedOver("The password field was not found on this page.", site),
          "the password field was not found",
        );
      }
    }
    if (password === "filled") {
      // Some sites ask for the code on the same page as the password.
      await typeCode(this.#now());
    } else if (!(await typeCode(this.#now()))) {
      // Not even a page that only asks for the code.
      throw new Stop(
        handedOver("The sign-in fields were not found on this page.", site),
        "the sign-in fields were not found",
      );
    }

    let page = await this.#submitAndLook(botId, site);
    if (page.onSite && page.otp && !page.password && codeAt && tried.codeTime === null) {
      // The code is asked for on its own page, after the password.
      if (await typeCode(this.#now())) page = await this.#submitAndLook(botId, site);
    }
    if (page.onSite && page.otp && !page.password && codeAt && tried.codeTime !== null) {
      // The site still asks for a code, so it refused the one it got. The usual reason is a
      // clock that runs a little off, so the neighbouring code is tried, once.
      if (await typeCode(neighbouringCodeTime(tried.codeTime, this.#now(), period))) {
        page = await this.#submitAndLook(botId, site);
      }
    }

    if (!page.onSite) {
      return {
        outcome: "signed-in",
        message: `The sign-in details of the key "${keyName}" were sent to ${site}. The site then moved the tab to ${page.site}; take a snapshot to see where you are.`,
      };
    }
    if (page.password) {
      throw new Stop(
        handedOver(
          `${site} still asks for the password after the key "${keyName}" was used, so the saved key may be out of date. Do not try the key again.`,
          site,
        ),
        "the site still asked for the password",
      );
    }
    if (page.otp) {
      throw new Stop(
        handedOver(
          codeAt
            ? `${site} did not accept the one-time code of the key "${keyName}". Do not try the key again.`
            : `${site} asks for a one-time code and the key "${keyName}" has none saved.`,
          site,
        ),
        codeAt ? "the one-time code was not accepted" : "the site asked for a one-time code",
      );
    }
    return { outcome: "signed-in", message: `Signed in to ${site} with the key "${keyName}".` };
  }

  /** Types one value, after checking once more that the tab is on the key's exact site. */
  async #type(
    botId: string,
    keyName: string,
    site: string,
    field: SecretField,
    value: string,
  ): Promise<"filled" | "not-found"> {
    await this.#requireOnSite(botId, keyName, site);
    const typed = await this.#filler.fillSecret(botId, field, value, site);
    if (typed === "filled" || typed === "not-found") return typed;
    // The page moved between the check and the typing; the browser refused, as it must.
    const url = await this.#filler.currentUrl(botId);
    const tabSite =
      url === null ? "a closed tab" : isSameOrigin(site, url) ? "another site" : siteOf(url);
    throw wrongSite(keyName, site, tabSite);
  }

  /** Refuses unless the bot's tab is on exactly the key's site. */
  async #requireOnSite(botId: string, keyName: string, site: string): Promise<void> {
    const url = await this.#filler.currentUrl(botId);
    if (url === null) {
      throw new Stop(
        {
          outcome: "no-page",
          message: `You have no browser tab open. Open the sign-in page on ${site} first, then use the key "${keyName}" again.`,
        },
        "no browser tab was open",
      );
    }
    if (!isSameOrigin(site, url)) throw wrongSite(keyName, site, siteOf(url));
  }

  async #submitAndLook(botId: string, site: string): Promise<PageLook> {
    await this.#filler.submit(botId);
    const url = await this.#filler.currentUrl(botId);
    if (url === null || !isSameOrigin(site, url)) {
      return {
        onSite: false,
        site: url === null ? "a closed tab" : siteOf(url),
        password: false,
        otp: false,
      };
    }
    return {
      onSite: true,
      site,
      password: await this.#filler.hasField(botId, "password"),
      otp: await this.#filler.hasField(botId, "otp"),
    };
  }

  /** One logbook line per use. A failure to write it must not undo or hide the sign-in. */
  async #log(botId: string, keyName: string, site: string, failure: string | null): Promise<void> {
    const bot = this.#botName(botId);
    const sentence =
      failure === null
        ? `${bot} signed in to ${site} with key ${keyName}`
        : `${bot} did not sign in to ${site} with key ${keyName}: ${failure}`;
    try {
      await this.#record(sentence, failure === null ? "done" : "failed");
    } catch {
      console.error("The logbook could not record the use of a key.");
    }
  }
}

/** The moment whose code to try after a refusal: the window next to the one already tried. */
export function neighbouringCodeTime(
  triedMs: number,
  nowMs: number,
  periodSeconds: number,
): number {
  // The clock has moved into a new window since the first try: the current code is the neighbour.
  if (totpWindow(nowMs, periodSeconds) !== totpWindow(triedMs, periodSeconds)) return nowMs;
  const periodMs = periodSeconds * 1000;
  // Early in a window the site is more likely still on the one before; late, on the one after.
  return triedMs % periodMs < periodMs / 2 ? triedMs - periodMs : triedMs + periodMs;
}

function wrongSite(keyName: string, site: string, tabSite: string): Stop {
  return new Stop(
    {
      outcome: "wrong-site",
      message: `The key "${keyName}" is for ${site}, but your tab is on ${tabSite}. A key is only ever used on its own exact site. Open ${site} and try again.`,
    },
    `the tab was on ${tabSite}`,
  );
}

function handedOver(what: string, site: string): SignInResult {
  return {
    outcome: "handed-over",
    message: `${what} Hand this step over to the person: ask them to sign in to ${site} themselves in the browser, and carry on once they say it is done.`,
  };
}

/** A key that was there a moment ago: says whether it was removed or only unshared. */
function stillShared(keyring: KeyringStore, botId: string, key: KeySummary): KeySummary {
  try {
    return keyring.summaryForBot(botId, { id: key.id });
  } catch {
    const removed = !keyring.list().some((candidate) => candidate.id === key.id);
    throw new Stop(
      removed
        ? {
            outcome: "key-removed",
            message: `The key "${key.name}" was removed from the keyring just now, so it can no longer be used. Ask the person which key to use instead.`,
          }
        : {
            outcome: "not-shared",
            message: `The key "${key.name}" is no longer shared with you. Ask the person to share it again if you still need it.`,
          },
      removed ? "the key was removed meanwhile" : "the key was no longer shared",
    );
  }
}

function unresolved(error: unknown, key: SignInRequest["key"]): SignInResult {
  if (error instanceof KeyringError) {
    const which = "name" in key ? `No key named "${key.name}"` : "No key with that id";
    return {
      outcome: "not-shared",
      message: `${which} is shared with you. Use keyring_list to see the keys you can use, or ask the person to share one.`,
    };
  }
  return { outcome: "keyring-unavailable", message: KEYRING_UNAVAILABLE };
}

/**
 * Turns any other failure into a plain answer.
 * The error's own text is dropped on purpose: a browser or a store may have put a value in it.
 */
function unexpected(error: unknown, keyName: string): Stop {
  if (error instanceof KeyringError && error.code === "not-shared") {
    return new Stop(
      {
        outcome: "key-removed",
        message: `The key "${keyName}" is no longer in the keyring or no longer shared with you. Ask the person which key to use.`,
      },
      "the key was removed meanwhile",
    );
  }
  if (error instanceof KeyringCryptoError) {
    return new Stop(
      {
        outcome: "keyring-unavailable",
        message: `The key "${keyName}" could not be read from the keyring. Tell the person; they can check it on the Keyring screen.`,
      },
      "the key could not be read",
    );
  }
  return new Stop(
    {
      outcome: "browser-failed",
      message:
        "The browser could not finish the sign-in. Take a snapshot to see the page, and hand this step over to the person if it still asks for a sign-in.",
    },
    "the browser could not finish",
  );
}

function siteOf(url: string): string {
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? "a page that is not a website" : origin;
  } catch {
    return "a page that is not a website";
  }
}
