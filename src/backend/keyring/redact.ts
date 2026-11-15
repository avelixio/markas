export const REDACTED = "[redacted]";

/** Values shorter than this are too likely to match ordinary text to be worth hiding. */
const MIN_SECRET_LENGTH = 4;

/**
 * Hides secret values wherever they would otherwise be shown or stored: tool results before an
 * agent sees them, messages before they are saved, and logs.
 * Each value is matched as typed and in the encodings a web page or a tool tends to echo back.
 */
export class SecretRedactor {
  #needles: string[] = [];

  /** Registers a secret. Safe to call again with the same value. */
  add(value: string): void {
    if (value.length < MIN_SECRET_LENGTH) return;
    const forms = new Set(this.#needles);
    for (const form of encodedForms(value)) forms.add(form);
    // Longest first, so a value is never left half visible by a shorter form matching inside it.
    this.#needles = [...forms].sort((left, right) => right.length - left.length);
  }

  get size(): number {
    return this.#needles.length;
  }

  redact(text: string): string {
    let result = text;
    for (const needle of this.#needles) {
      if (result.includes(needle)) result = result.split(needle).join(REDACTED);
    }
    return result;
  }

  /**
   * Redacts text that arrives in pieces. A secret split across two pieces is still caught,
   * because the end of each piece is held back until the next one arrives.
   */
  stream(): { push(chunk: string): string; flush(): string } {
    let held = "";
    return {
      push: (chunk) => {
        const text = this.redact(held + chunk);
        const keep = Math.min(text.length, Math.max(0, this.#longest() - 1));
        held = text.slice(text.length - keep);
        return text.slice(0, text.length - keep);
      },
      flush: () => {
        const text = this.redact(held);
        held = "";
        return text;
      },
    };
  }

  #longest(): number {
    return this.#needles[0]?.length ?? 0;
  }
}

function encodedForms(value: string): string[] {
  const uri = encodeURIComponent(value);
  const base64 = Buffer.from(value, "utf8").toString("base64");
  return [
    value,
    uri,
    // Form posts encode a space as "+".
    uri.replaceAll("%20", "+"),
    base64,
    base64.replace(/=+$/, ""),
    base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
    // As it appears inside a JSON string.
    JSON.stringify(value).slice(1, -1),
  ].filter((form) => form.length >= MIN_SECRET_LENGTH);
}
