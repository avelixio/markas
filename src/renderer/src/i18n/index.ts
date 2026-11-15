import { createSignal } from "solid-js";
import { en, type MessageKey } from "./en";
import { id } from "./id";

export const LANGUAGES = ["en", "id"] as const;
export type Language = (typeof LANGUAGES)[number];

const TABLES: Record<Language, Record<MessageKey, string>> = { en, id };
const STORAGE_KEY = "markas:language";

/** The saved choice, else the browser's language, else English. */
export function detectLanguage(saved: string | null, browser: string | undefined): Language {
  if (saved === "en" || saved === "id") return saved;
  return browser?.toLowerCase().startsWith("id") ? "id" : "en";
}

function readSaved(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const [language, setLanguageSignal] = createSignal<Language>(
  detectLanguage(readSaved(), typeof navigator === "undefined" ? undefined : navigator.language),
);

export { language };

export function setLanguage(next: Language): void {
  setLanguageSignal(next);
  document.documentElement.lang = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private windows may refuse storage; the choice then lasts for this visit only.
  }
}

/**
 * The text for `key` in the current language. Reads the language signal, so anything
 * rendered with it updates when the language changes. `{name}` placeholders are filled from `values`.
 */
export function t(key: MessageKey, values?: Record<string, string | number>): string {
  const text = TABLES[language()][key];
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]),
  );
}

/** The keys that have a `.one` and a `.other` form, without that ending. */
type CountKey = MessageKey extends infer Key
  ? Key extends `${infer Base}.one`
    ? Base
    : never
  : never;

/**
 * Counted text: `<key>.one` for exactly one, `<key>.other` for any other number.
 * `{count}` is filled in with the number.
 */
export function tCount(
  key: CountKey,
  count: number,
  values?: Record<string, string | number>,
): string {
  return t(`${key}.${count === 1 ? "one" : "other"}` as MessageKey, { ...values, count });
}

export type { MessageKey };
