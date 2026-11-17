import type {
  BrowserControlState,
  BrowserHandOff,
  BrowserTab,
  BrowserTabView,
} from "../shared/ipc";
import type { BrowserService } from "./browser-tools";
import { NoBrowserSecretFiller, type SecretFiller } from "./keyring/sign-in";
import type { DynamicToolResult } from "./protocol";

export const BROWSER_UNAVAILABLE_MESSAGE = "The Markas browser cannot be used on this computer.";

/**
 * The stand-in used when no browser can be driven at all: it holds no tabs and refuses every
 * action with a clear message, so bots and the web UI see an honest "unavailable" instead of
 * a silent no-op.
 */
export class UnavailableBrowserService implements BrowserService {
  readonly #message: string;

  /** `reason` is a plain sentence saying why, shown after the general message. */
  constructor(reason?: string) {
    this.#message = reason
      ? `${BROWSER_UNAVAILABLE_MESSAGE} ${reason}`
      : BROWSER_UNAVAILABLE_MESSAGE;
  }

  onChanged(): () => void {
    return () => undefined;
  }

  onControlChanged(): () => void {
    return () => undefined;
  }

  getControlState(): BrowserControlState {
    return { sessions: [], handOffs: [] };
  }

  /** With no browser there is never a tab, so nothing is ever typed. */
  secretFiller(): SecretFiller {
    return new NoBrowserSecretFiller();
  }

  endControl(): void {}

  clearControls(): void {}

  listTabs(): BrowserTab[] {
    return [];
  }

  async open(): Promise<BrowserTab> {
    throw new Error(this.#message);
  }

  async activate(): Promise<void> {
    throw new Error(this.#message);
  }

  async close(): Promise<void> {
    throw new Error(this.#message);
  }

  async setVisible(): Promise<void> {}

  async handleDynamicTool(): Promise<DynamicToolResult> {
    return {
      success: false,
      contentItems: [{ type: "inputText", text: this.#message }],
    };
  }

  async takeControl(): Promise<BrowserHandOff> {
    throw new Error(this.#message);
  }

  resumeControl(): void {}

  async viewTab(): Promise<BrowserTabView> {
    throw new Error(this.#message);
  }

  async personInput(): Promise<void> {
    throw new Error(this.#message);
  }

  async bringToFront(): Promise<void> {
    throw new Error(this.#message);
  }

  async fillSecret(): Promise<void> {
    throw new Error(this.#message);
  }

  async forgetBot(): Promise<void> {}

  async destroy(): Promise<void> {}
}
