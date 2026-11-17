// The tool definitions and the service contract live here, free of any browser
// library, so the agent service can load without a browser implementation.
import type {
  BrowserControlState,
  BrowserHandOff,
  BrowserPersonInput,
  BrowserResumeInput,
  BrowserTab,
  BrowserTabView,
  BrowserTakeControlInput,
  BrowserVisibilityInput,
} from "../shared/ipc";
import type { SecretTarget } from "./browser/driver";
import type { SecretFiller } from "./keyring/sign-in";
import type { DynamicToolCallParams, DynamicToolResult } from "./protocol";

export const MARKAS_BROWSER_NAMESPACE = "markas_browser";

export const BROWSER_DYNAMIC_TOOLS = [
  {
    type: "namespace",
    name: MARKAS_BROWSER_NAMESPACE,
    description: "Operate Markas's private, persistent local browser.",
    tools: [
      functionTool("open", "Open an HTTP(S) URL in a new tab.", {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      }),
      functionTool("list_tabs", "List the browser tabs.", emptySchema()),
      functionTool("snapshot", "Read a page and obtain current element references.", {
        type: "object",
        properties: { tabId: { type: "string" } },
        required: ["tabId"],
        additionalProperties: false,
      }),
      functionTool("act", "Click, type, press a key, scroll, navigate back/forward, or reload.", {
        type: "object",
        properties: {
          tabId: { type: "string" },
          revision: { type: "integer" },
          action: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["click", "type", "key", "scroll", "back", "forward", "reload"],
              },
              ref: { type: "string" },
              text: { type: "string" },
              submit: { type: "boolean" },
              key: { type: "string" },
              deltaY: { type: "number" },
            },
            required: ["type"],
            additionalProperties: false,
          },
        },
        required: ["tabId", "revision", "action"],
        additionalProperties: false,
      }),
      functionTool("screenshot", "Capture the visible page as an image.", {
        type: "object",
        properties: { tabId: { type: "string" } },
        required: ["tabId"],
        additionalProperties: false,
      }),
      functionTool("close_tab", "Close a browser tab.", {
        type: "object",
        properties: { tabId: { type: "string" } },
        required: ["tabId"],
        additionalProperties: false,
      }),
      functionTool(
        "hand_off",
        "Pass a step to the person that only they can do, such as a code sent to their phone or a CAPTCHA. The person takes over the tab, and this waits until they give it back.",
        {
          type: "object",
          properties: { tabId: { type: "string" }, reason: { type: "string" } },
          required: ["tabId", "reason"],
          additionalProperties: false,
        },
      ),
    ],
  },
] as const;

/** Who is calling a browser tool. The host works this out; a bot cannot claim to be another. */
export interface BrowserCaller {
  botId: string | null;
}

/** A secret for the host to put into a sign-in form on a bot's behalf. */
export interface BrowserSecretFill {
  botId: string;
  tabId: string;
  /**
   * The exact site the secret belongs to: scheme, full host and port.
   * The fill is refused when the tab is on any other site.
   */
  origin: string;
  target: SecretTarget;
  value: string;
}

/**
 * The browser contract the agent service and the host routes depend on.
 * `BotBrowserService` is the real one; `UnavailableBrowserService` stands in when no browser
 * can be driven on this computer.
 */
export interface BrowserService {
  onChanged(listener: (tabs: BrowserTab[], activeTabId: string | null) => void): () => void;
  onControlChanged(listener: (state: BrowserControlState) => void): () => void;
  getControlState(): BrowserControlState;
  endControl(threadId: string, turnId: string): void;
  clearControls(): void;
  listTabs(): BrowserTab[];
  open(url: string, ownerThreadId?: string | null, ownerBotId?: string | null): Promise<BrowserTab>;
  activate(tabId: string): Promise<void>;
  close(tabId: string): Promise<void>;
  setVisible(input: BrowserVisibilityInput): Promise<void>;
  handleDynamicTool(
    params: DynamicToolCallParams,
    caller?: BrowserCaller,
  ): Promise<DynamicToolResult>;
  /** The person takes over a tab. The bot's actions in it are refused until they resume. */
  takeControl(input: BrowserTakeControlInput): Promise<BrowserHandOff>;
  /** The person gives a tab back to its bot. */
  resumeControl(input: BrowserResumeInput): void;
  /** One look at a tab, for the Browser panel: a picture and who controls it. */
  viewTab(tabId: string): Promise<BrowserTabView>;
  /** What the person does on a tab they have taken over: a click, typing, a key or scrolling. */
  personInput(input: BrowserPersonInput): Promise<void>;
  /** Raises the tab's window on the person's screen, when the browser has one. */
  bringToFront(tabId: string): Promise<void>;
  /**
   * Puts a secret into a form field without the bot ever seeing it.
   * For host code only: this is never a bot tool and never a host route, and the value is
   * never logged, returned or put in an error.
   */
  fillSecret(input: BrowserSecretFill): Promise<void>;
  /**
   * The door the Keyring uses to type a sign-in into the bot's current tab.
   * For host code only, like `fillSecret`.
   */
  secretFiller(): SecretFiller;
  /** Closes a deleted bot's browser and removes its profile. */
  forgetBot(botId: string): Promise<void>;
  destroy(): Promise<void>;
}

function functionTool(name: string, description: string, inputSchema: Record<string, unknown>) {
  return { type: "function" as const, name, description, inputSchema };
}

function emptySchema() {
  return { type: "object", properties: {}, additionalProperties: false };
}
