import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decryptRecord, encryptRecord } from "./crypto";
import { loadOrCreateMasterKey, type MasterKeyStore } from "./key-store";
import { normalizeOrigin } from "./origin";
import { SecretRedactor } from "./redact";
import {
  formatTotp,
  generateTotp,
  parseTotpInput,
  TOTP_DEFAULTS,
  type TotpAlgorithm,
  type TotpDigits,
  type TotpSettings,
} from "./totp";

export const KEY_KINDS = ["login", "token", "variable"] as const;
/**
 * login: a username and password for one exact website, with an optional two-step code key.
 * token: a secret sent to one exact website by the host, never handed to a bot.
 * variable: a secret placed in a bot's command environment under a name.
 */
export type KeyKind = (typeof KEY_KINDS)[number];

export const FILL_POLICIES = ["auto", "ask", "handoff"] as const;
/** auto: the host fills it unattended. ask: it asks first. handoff: only the person may use it. */
export type FillPolicy = (typeof FILL_POLICIES)[number];

/** What is safe to show: everything about a key except its secret values. */
export interface KeySummary {
  id: string;
  /** Unique, chosen by the person. Bots ask for a key by this name. */
  name: string;
  kind: KeyKind;
  /** Exact website (scheme, host, port) for login and token; null for variable. */
  origin: string | null;
  username: string | null;
  /** The environment variable name, for kind variable. */
  variable: string | null;
  hasTwoStepCode: boolean;
  fillPolicy: FillPolicy;
  /** The only bots that may use this key. */
  sharedWith: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

interface KeySecret {
  /** The password, token or variable value. */
  value: string;
  /** Base32 setup key for two-step codes, when the site uses an authenticator app. */
  twoStepSeed?: string;
  /** How the site's codes are made, kept only when it differs from the usual settings. */
  twoStep?: { algorithm: TotpAlgorithm; digits: TotpDigits; periodSeconds: number };
}

interface StoredKey extends Omit<KeySummary, "hasTwoStepCode"> {
  hasTwoStepCode: boolean;
  sealed: string;
}

interface StoredState {
  version: 1;
  keys: StoredKey[];
}

export interface CreateKeyInput {
  name: string;
  kind: KeyKind;
  origin?: string;
  username?: string;
  variable?: string;
  value: string;
  /**
   * The site's two-step setup key: base32 as the site shows it, or the whole
   * `otpauth://totp/...` address behind its QR code. Sealed with the password.
   */
  twoStepSeed?: string;
  fillPolicy?: FillPolicy;
  sharedWith?: string[];
  note?: string;
}

export type UpdateKeyInput = Partial<Omit<CreateKeyInput, "kind">> & { id: string };

/** A key opened for use by the host. Never give this to a bot or write it anywhere. */
export interface OpenedKey {
  summary: KeySummary;
  value: string;
  /** The current two-step code, when the key has a setup key. */
  twoStepCode: string | null;
  /** The two-step code for another moment, for a site whose clock runs a little off. */
  twoStepCodeAt: ((timeMs: number) => string) | null;
  /** How often the code changes, in seconds; null without a setup key. */
  twoStepPeriodSeconds: number | null;
}

/** How a bot names the key it means. */
export type KeyRequest = { name: string } | { id: string } | { origin: string };

export class KeyringError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "name-taken" | "not-found" | "not-shared" | "ambiguous",
  ) {
    super(message);
    this.name = "KeyringError";
  }
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VARIABLE_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/;

/**
 * The keyring: logins and other secrets that bots can use but never read.
 *
 * A key is identified by its own name and bound to one exact website, never to a parent
 * domain. One site can hold several named keys, sibling hosts never share a key, and a key is
 * offered only to the bots it is shared with.
 */
export class KeyringStore {
  readonly #statePath: string;
  readonly #keyStore: MasterKeyStore;
  #masterKey: Buffer | null = null;
  #state: StoredState = { version: 1, keys: [] };
  #writeQueue: Promise<void> = Promise.resolve();
  /** Every secret value the keyring holds, for scrubbing tool output, messages and logs. */
  readonly redactor = new SecretRedactor();

  constructor(dataRoot: string, keyStore: MasterKeyStore) {
    this.#statePath = join(dataRoot, "keyring.json");
    this.#keyStore = keyStore;
  }

  async initialize(): Promise<void> {
    this.#masterKey = await loadOrCreateMasterKey(this.#keyStore);
    this.#state = await this.#read();
    for (const key of this.#state.keys) this.#protect(this.#openSecret(key));
  }

  /** Every key, for the person managing the keyring. */
  list(): KeySummary[] {
    return this.#state.keys
      .map(toSummary)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Only the keys shared with this bot. */
  listForBot(botId: string): KeySummary[] {
    return this.list().filter((key) => key.sharedWith.includes(botId));
  }

  async create(input: CreateKeyInput): Promise<KeySummary> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const fields = this.#validate(input, null);
    const secret = toSecret(input.value, input.twoStepSeed);
    const stored: StoredKey = {
      id,
      ...fields,
      hasTwoStepCode: secret.twoStepSeed !== undefined,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      sealed: this.#seal(id, secret),
    };
    this.#state.keys.push(stored);
    this.#protect(secret);
    await this.#persist();
    return toSummary(stored);
  }

  async update(input: UpdateKeyInput): Promise<KeySummary> {
    const stored = this.#require(input.id);
    const current = this.#openSecret(stored);
    const fields = this.#validate(
      {
        name: input.name ?? stored.name,
        kind: stored.kind,
        origin: input.origin ?? stored.origin ?? undefined,
        username: input.username ?? stored.username ?? undefined,
        variable: input.variable ?? stored.variable ?? undefined,
        value: input.value ?? current.value,
        fillPolicy: input.fillPolicy ?? stored.fillPolicy,
        sharedWith: input.sharedWith ?? stored.sharedWith,
        note: input.note ?? stored.note,
      },
      stored.id,
    );
    const kept = totpSettings(current);
    const secret = toSecret(
      input.value ?? current.value,
      // An empty string removes the setup key; leaving it out keeps the one already saved.
      input.twoStepSeed === undefined ? (kept ? formatTotp(kept) : undefined) : input.twoStepSeed,
    );
    Object.assign(stored, fields, {
      hasTwoStepCode: secret.twoStepSeed !== undefined,
      updatedAt: new Date().toISOString(),
      sealed: this.#seal(stored.id, secret),
    });
    this.#protect(secret);
    await this.#persist();
    return toSummary(stored);
  }

  /** Replaces the list of bots that may use a key. */
  share(id: string, botIds: string[]): Promise<KeySummary> {
    return this.update({ id, sharedWith: botIds });
  }

  async remove(id: string): Promise<void> {
    this.#require(id);
    this.#state.keys = this.#state.keys.filter((key) => key.id !== id);
    await this.#persist();
  }

  /** Drops a deleted bot from every key it was shared with. */
  async forgetBot(botId: string): Promise<void> {
    let changed = false;
    for (const key of this.#state.keys) {
      if (!key.sharedWith.includes(botId)) continue;
      key.sharedWith = key.sharedWith.filter((id) => id !== botId);
      changed = true;
    }
    if (changed) await this.#persist();
  }

  /** Shows a key's secret to the person, on their explicit request. */
  reveal(id: string): { value: string; twoStepSeed: string | null } {
    const secret = this.#openSecret(this.#require(id));
    const twoStep = totpSettings(secret);
    return { value: secret.value, twoStepSeed: twoStep ? formatTotp(twoStep) : null };
  }

  /**
   * What a bot may know about the one key it means: never a secret value.
   * A key that is not shared with the bot is reported exactly like one that does not exist.
   */
  summaryForBot(botId: string, request: KeyRequest): KeySummary {
    return toSummary(this.#forBot(botId, request));
  }

  /**
   * Opens the one key a bot means, by name or by the site it is on.
   * By site, the bot must name the key when it has more than one there: the host never guesses.
   */
  async openForBot(
    botId: string,
    request: KeyRequest,
    now: number = Date.now(),
  ): Promise<OpenedKey> {
    const stored = this.#forBot(botId, request);
    const secret = this.#openSecret(stored);
    const twoStep = totpSettings(secret);
    stored.lastUsedAt = new Date(now).toISOString();
    await this.#persist();
    return {
      summary: toSummary(stored),
      value: secret.value,
      twoStepCode: twoStep ? generateTotp(twoStep, now) : null,
      twoStepCodeAt: twoStep ? (timeMs) => generateTotp(twoStep, timeMs) : null,
      twoStepPeriodSeconds: twoStep?.periodSeconds ?? null,
    };
  }

  /** The command environment for a bot: every variable key shared with it. */
  variablesForBot(botId: string): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const key of this.#state.keys) {
      if (key.kind !== "variable" || !key.variable || !key.sharedWith.includes(botId)) continue;
      variables[key.variable] = this.#openSecret(key).value;
    }
    return variables;
  }

  #forBot(botId: string, request: KeyRequest): StoredKey {
    if ("name" in request) return this.#byName(botId, request.name);
    if ("origin" in request) return this.#byOrigin(botId, request.origin);
    const stored = this.#state.keys.find((key) => key.id === request.id);
    if (!stored?.sharedWith.includes(botId)) {
      throw new KeyringError("No key with that id is shared with this bot.", "not-shared");
    }
    return stored;
  }

  #byName(botId: string, name: string): StoredKey {
    const stored = this.#state.keys.find((key) => key.name === name);
    // A key that exists but is not shared is reported exactly like one that does not exist,
    // so a bot cannot learn which names are taken.
    if (!stored?.sharedWith.includes(botId)) {
      throw new KeyringError(`No key named "${name}" is shared with this bot.`, "not-shared");
    }
    return stored;
  }

  #byOrigin(botId: string, origin: string): StoredKey {
    const exact = normalizeOrigin(origin);
    const matches = this.#state.keys.filter(
      (key) => key.origin === exact && key.sharedWith.includes(botId),
    );
    const [only] = matches;
    if (!only) throw new KeyringError(`No key for ${exact} is shared with this bot.`, "not-shared");
    if (matches.length > 1) {
      const names = matches
        .map((key) => key.name)
        .sort()
        .join(", ");
      throw new KeyringError(
        `This bot has ${matches.length} keys for ${exact}. Name the one to use: ${names}.`,
        "ambiguous",
      );
    }
    return only;
  }

  #validate(input: CreateKeyInput, ownId: string | null) {
    const name = input.name.trim();
    if (!NAME_PATTERN.test(name)) {
      throw new KeyringError(
        "A key name uses lower-case letters, digits and dashes, and starts with a letter or digit.",
        "invalid",
      );
    }
    if (this.#state.keys.some((key) => key.name === name && key.id !== ownId)) {
      throw new KeyringError(`A key named "${name}" already exists.`, "name-taken");
    }
    if (!KEY_KINDS.includes(input.kind)) throw new KeyringError("Unknown key kind.", "invalid");
    const fillPolicy = input.fillPolicy ?? "auto";
    if (!FILL_POLICIES.includes(fillPolicy))
      throw new KeyringError("Unknown fill policy.", "invalid");
    if (!input.value) throw new KeyringError("A key needs a value.", "invalid");

    let origin: string | null = null;
    let username: string | null = null;
    let variable: string | null = null;
    if (input.kind === "variable") {
      variable = input.variable?.trim() ?? "";
      if (!VARIABLE_PATTERN.test(variable)) {
        throw new KeyringError(
          "A variable name uses upper-case letters, digits and underscores.",
          "invalid",
        );
      }
    } else {
      try {
        origin = normalizeOrigin(input.origin ?? "");
      } catch (error) {
        throw new KeyringError(error instanceof Error ? error.message : String(error), "invalid");
      }
      if (input.kind === "login") {
        username = input.username?.trim() ?? "";
        if (!username) throw new KeyringError("A login needs a username.", "invalid");
      }
    }
    return {
      name,
      kind: input.kind,
      origin,
      username,
      variable,
      fillPolicy,
      sharedWith: [...new Set(input.sharedWith ?? [])],
      note: input.note?.trim() ?? "",
    };
  }

  #require(id: string): StoredKey {
    const stored = this.#state.keys.find((key) => key.id === id);
    if (!stored) throw new KeyringError("That key no longer exists.", "not-found");
    return stored;
  }

  #seal(id: string, secret: KeySecret): string {
    return encryptRecord(this.#key(), id, JSON.stringify(secret));
  }

  #openSecret(stored: StoredKey): KeySecret {
    return JSON.parse(decryptRecord(this.#key(), stored.id, stored.sealed)) as KeySecret;
  }

  #protect(secret: KeySecret): void {
    this.redactor.add(secret.value);
    if (secret.twoStepSeed) this.redactor.add(secret.twoStepSeed);
  }

  #key(): Buffer {
    if (!this.#masterKey) throw new Error("The keyring is not initialized.");
    return this.#masterKey;
  }

  async #read(): Promise<StoredState> {
    try {
      const parsed = JSON.parse(await readFile(this.#statePath, "utf8")) as StoredState;
      if (parsed.version !== 1 || !Array.isArray(parsed.keys)) {
        throw new Error("The keyring file is not in a format this version can read.");
      }
      return parsed;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { version: 1, keys: [] };
      }
      throw error;
    }
  }

  /** Writes are queued and atomic, so a crash leaves either the old file or the new one. */
  #persist(): Promise<void> {
    const snapshot = `${JSON.stringify(this.#state)}\n`;
    const write = this.#writeQueue.then(async () => {
      await mkdir(join(this.#statePath, ".."), { recursive: true, mode: 0o700 });
      const temporary = `${this.#statePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.#statePath);
    });
    this.#writeQueue = write.catch(() => undefined);
    return write;
  }
}

function toSecret(value: string, twoStepSeed: string | undefined): KeySecret {
  if (!twoStepSeed?.trim()) return { value };
  let settings: TotpSettings;
  try {
    settings = parseTotpInput(twoStepSeed);
  } catch (error) {
    // These messages say what is wrong with the setup key and never repeat it.
    throw new KeyringError(error instanceof Error ? error.message : String(error), "invalid");
  }
  const { seed, ...twoStep } = settings;
  const usual =
    twoStep.algorithm === TOTP_DEFAULTS.algorithm &&
    twoStep.digits === TOTP_DEFAULTS.digits &&
    twoStep.periodSeconds === TOTP_DEFAULTS.periodSeconds;
  return usual ? { value, twoStepSeed: seed } : { value, twoStepSeed: seed, twoStep };
}

function totpSettings(secret: KeySecret): TotpSettings | null {
  if (!secret.twoStepSeed) return null;
  return { seed: secret.twoStepSeed, ...TOTP_DEFAULTS, ...secret.twoStep };
}

function toSummary(stored: StoredKey): KeySummary {
  const { sealed: _sealed, ...summary } = stored;
  return { ...summary, sharedWith: [...summary.sharedWith] };
}
