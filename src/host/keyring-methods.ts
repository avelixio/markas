import {
  type CreateKeyInput,
  FILL_POLICIES,
  type FillPolicy,
  KEY_KINDS,
  type KeyKind,
  type KeyringStore,
  type UpdateKeyInput,
} from "../backend/keyring/keyring-store";
import { KeySignIn, NoBrowserSecretFiller, type SecretFiller } from "../backend/keyring/sign-in";
import { parseTotpInput } from "../backend/keyring/totp";
import type { LogbookStore } from "../backend/logbook/logbook-store";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";

/**
 * The keyring over HTTP, for the person managing it in the web UI.
 * Bots never call these: they reach keys only through host tools that keep values to the host.
 */
export function createKeyringMethods(keyring: KeyringStore): Record<string, HostMethod> {
  return {
    "keyring.list": () => keyring.list(),
    "keyring.create": (input) => keyring.create(parseCreate(input)),
    "keyring.update": (input) => keyring.update(parseUpdate(input)),
    "keyring.share": (input) => {
      if (!isObject(input)) throw new Error("Invalid share request.");
      return keyring.share(
        requireString(input.id, "id"),
        stringList(input.sharedWith, "sharedWith"),
      );
    },
    "keyring.remove": (id) => keyring.remove(requireString(id, "id")),
    // Showing a value is the person's explicit act, and the logbook records it. The value
    // shown includes the two-step setup key, under the same rule as the password.
    "keyring.reveal": (id) => keyring.reveal(requireString(id, "id")),
    // Lets the Add a key dialog check a pasted two-step setup key before saving. It answers
    // with how the codes are made, never with the key or a code, and throws a plain message
    // when the key is not usable.
    "keyring.checkTwoStep": (input) => {
      const { seed: _seed, ...settings } = parseTotpInput(requireString(input, "twoStepSeed"));
      return settings;
    },
  };
}

export interface BotKeyToolsOptions {
  /** Null when the keyring could not be opened; bots are then told so in plain words. */
  keyring: KeyringStore | null;
  logbook: LogbookStore;
  botName(botId: string): string;
  /**
   * The bot browser, as far as the keyring needs it.
   * THIS IS WHERE THE REAL BROWSER PLUGS IN: pass an object that implements `SecretFiller`
   * (see `src/backend/keyring/sign-in.ts`). Left out, bots are told they have no tab open.
   */
  filler?: SecretFiller;
}

/**
 * Builds what lets bots use keys without reading them: the sign-in and listing tools.
 * Hand the result to `AgentService.useKeys`. Every use leaves a line in the logbook.
 */
export function createBotKeyTools(options: BotKeyToolsOptions): KeySignIn {
  return new KeySignIn({
    keyring: options.keyring,
    filler: options.filler ?? new NoBrowserSecretFiller(),
    botName: options.botName,
    record: (sentence, outcome) => options.logbook.record("key.used", sentence, outcome, "bot"),
  });
}

function parseCreate(value: unknown): CreateKeyInput {
  if (!isObject(value)) throw new Error("Invalid key.");
  const kind = value.kind;
  if (!KEY_KINDS.includes(kind as KeyKind)) throw new Error("Unknown key kind.");
  return {
    ...parseFields(value),
    name: requireString(value.name, "name"),
    kind: kind as KeyKind,
    value: requireString(value.value, "value"),
  };
}

function parseUpdate(value: unknown): UpdateKeyInput {
  if (!isObject(value)) throw new Error("Invalid key.");
  return { ...parseFields(value), id: requireString(value.id, "id") };
}

function parseFields(value: Record<string, unknown>): Partial<CreateKeyInput> {
  const fields: Partial<CreateKeyInput> = {};
  for (const field of [
    "name",
    "origin",
    "username",
    "variable",
    "value",
    "twoStepSeed",
    "note",
  ] as const) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string") throw new Error(`Invalid ${field}.`);
    fields[field] = value[field];
  }
  if (value.fillPolicy !== undefined) {
    if (!FILL_POLICIES.includes(value.fillPolicy as FillPolicy)) {
      throw new Error("Unknown fill policy.");
    }
    fields.fillPolicy = value.fillPolicy as FillPolicy;
  }
  if (value.sharedWith !== undefined)
    fields.sharedWith = stringList(value.sharedWith, "sharedWith");
  return fields;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item)) {
    throw new Error(`Invalid ${field}.`);
  }
  return value as string[];
}
