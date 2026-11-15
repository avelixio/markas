import type { SecretField, SecretFiller } from "../keyring/sign-in";

/** One page of a made-up website, as far as signing in is concerned. */
export interface FakePage {
  url: string;
  fields: SecretField[];
  /** What the site does when the form is sent: the next page, or nothing to stay put. */
  submit?(values: Partial<Record<SecretField, string>>): FakePage | undefined;
}

/**
 * A stand-in for the bot browser. It remembers everything typed into it and where, so a test
 * can prove that a secret went to the right site and nowhere else.
 */
export class FakeSecretFiller implements SecretFiller {
  page: FakePage | null;
  readonly typed: Array<{ botId: string; url: string; field: SecretField; value: string }> = [];
  submits = 0;
  /** A page the tab jumps to just before the next typing, as a redirect would. */
  moveBeforeTyping: FakePage | null = null;
  /** Makes the next typing fail the way a broken browser would. */
  failTyping: Error | null = null;
  #values: Partial<Record<SecretField, string>> = {};

  constructor(page: FakePage | null = null) {
    this.page = page;
  }

  goTo(page: FakePage | null): void {
    this.page = page;
    this.#values = {};
  }

  /** Every value that ever reached a page. */
  get values(): string[] {
    return this.typed.map((entry) => entry.value);
  }

  async currentUrl(): Promise<string | null> {
    return this.page?.url ?? null;
  }

  async hasField(_botId: string, field: SecretField): Promise<boolean> {
    return this.page?.fields.includes(field) ?? false;
  }

  async fillSecret(
    botId: string,
    field: SecretField,
    value: string,
    site: string,
  ): Promise<"filled" | "not-found" | "wrong-site"> {
    if (this.moveBeforeTyping) {
      this.goTo(this.moveBeforeTyping);
      this.moveBeforeTyping = null;
    }
    if (this.failTyping) {
      const error = this.failTyping;
      this.failTyping = null;
      throw error;
    }
    if (!this.page || new URL(this.page.url).origin !== site) return "wrong-site";
    if (!this.page.fields.includes(field)) return "not-found";
    this.typed.push({ botId, url: this.page.url, field, value });
    this.#values[field] = value;
    return "filled";
  }

  async submit(): Promise<void> {
    this.submits += 1;
    const next = this.page?.submit?.({ ...this.#values });
    if (next) this.goTo(next);
  }
}
