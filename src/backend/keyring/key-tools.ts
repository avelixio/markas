// The tools through which a bot uses the keyring. They sit in the "markas" tool namespace
// beside list_agents and send_message, so a bot calls them as markas.keyring_list and
// markas.keyring_sign_in. A bot only ever names a key here; it never receives one.
import type { AccessLevel } from "../access/policy";
import type { KeySignIn, KeyUseDecision } from "./sign-in";

export const KEYRING_LIST_TOOL = "keyring_list";
export const KEYRING_SIGN_IN_TOOL = "keyring_sign_in";
export const KEYRING_REQUEST_TOOL = "keyring_request";

export const KEYRING_TOOL_DESCRIPTIONS = {
  [KEYRING_LIST_TOOL]:
    "List the saved keys the person has shared with you: each key's name and the one exact website it works on. Values are never included.",
  [KEYRING_SIGN_IN_TOOL]:
    "Sign in to a website with a saved key. First open the site's sign-in page in your browser tab, then name the key. Markas types the username, password and one-time code itself and tells you how it went. You never see the values, so do not ask the person for them.",
  [KEYRING_REQUEST_TOOL]:
    "Ask the person to save a login or a token you need, when keyring_list shows none for the site. Give the exact site, what it is for, and the username if you know it. The person types the secret on a card in Markas, never in the chat; you are told only the key's name, then sign in with keyring_sign_in. Never ask for a password or token in the chat instead.",
} as const;

export const KEYRING_DYNAMIC_TOOLS = [
  {
    type: "function",
    name: KEYRING_LIST_TOOL,
    description: KEYRING_TOOL_DESCRIPTIONS[KEYRING_LIST_TOOL],
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: KEYRING_SIGN_IN_TOOL,
    description: KEYRING_TOOL_DESCRIPTIONS[KEYRING_SIGN_IN_TOOL],
    inputSchema: {
      type: "object",
      properties: {
        keyName: { type: "string", description: "The key's name, as keyring_list shows it." },
        keyId: { type: "string", description: "The key's id, instead of its name." },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: KEYRING_REQUEST_TOOL,
    description: KEYRING_TOOL_DESCRIPTIONS[KEYRING_REQUEST_TOOL],
    inputSchema: {
      type: "object",
      properties: {
        site: {
          type: "string",
          description: "The site the key is for, such as https://app.example.com.",
        },
        reason: { type: "string", description: "What you need it for, in one sentence." },
        kind: {
          type: "string",
          enum: ["login", "token"],
          description: "login unless it is an API token.",
        },
        username: { type: "string", description: "The username, when you know it." },
        keyName: {
          type: "string",
          description: "A name for the key, when the site's name is not clear.",
        },
      },
      required: ["site", "reason"],
      additionalProperties: false,
    },
  },
] as const;

export const KEY_REQUEST_REASON_MAX = 300;

export interface ParsedKeyRequest {
  kind: "login" | "token";
  origin: string;
  username: string | null;
  keyName: string | null;
  reason: string;
}

/** Checks a keyring_request call. The answer is a sentence for the bot when it is not usable. */
export function parseKeyRequest(input: unknown): ParsedKeyRequest | { problem: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const site = text(raw.site, 2048);
  let origin = "";
  try {
    const url = new URL(site);
    if (url.protocol === "https:" || url.protocol === "http:") origin = url.origin;
  } catch {
    origin = "";
  }
  if (!origin) {
    return { problem: "Give the exact site the key is for, such as https://app.example.com." };
  }
  const reason = text(raw.reason, KEY_REQUEST_REASON_MAX);
  if (!reason) return { problem: "Say in one sentence what you need the key for." };
  return {
    kind: raw.kind === "token" ? "token" : "login",
    origin,
    username: text(raw.username, 200) || null,
    keyName: text(raw.keyName, 100) || null,
    reason,
  };
}

export function isKeyringTool(tool: string): boolean {
  return tool === KEYRING_LIST_TOOL || tool === KEYRING_SIGN_IN_TOOL;
}

export interface KeyToolCall {
  botId: string;
  chatId: string;
  level: AccessLevel;
  tool: string;
  arguments: unknown;
  ask(detail: string, canAllowForChat: boolean): Promise<KeyUseDecision>;
}

export interface KeyToolResult {
  success: boolean;
  contentItems: Array<{ type: "inputText"; text: string }>;
}

/** Runs one keyring tool call for a bot. The answer holds names, sites and plain words only. */
export async function handleKeyTool(keys: KeySignIn, call: KeyToolCall): Promise<KeyToolResult> {
  if (call.tool === KEYRING_LIST_TOOL) {
    const listed = keys.listForBot(call.botId);
    if (!listed) {
      return answer(false, {
        result: "keyring-unavailable",
        message: "The keyring cannot be opened right now. Tell the person.",
      });
    }
    return answer(true, { keys: listed });
  }
  if (call.tool !== KEYRING_SIGN_IN_TOOL) throw new Error(`Unsupported Markas tool: ${call.tool}`);

  const key = requestedKey(call.arguments);
  if (!key) {
    return answer(false, {
      result: "invalid",
      message: "Name one key: pass keyName, or keyId, as keyring_list shows it.",
    });
  }
  const result = await keys.signIn({
    botId: call.botId,
    chatId: call.chatId,
    level: call.level,
    key,
    ask: call.ask,
  });
  return answer(result.outcome === "signed-in", {
    result: result.outcome,
    message: result.message,
  });
}

function requestedKey(input: unknown): { name: string } | { id: string } | null {
  if (typeof input !== "object" || input === null) return null;
  const { keyName, keyId } = input as { keyName?: unknown; keyId?: unknown };
  const name = typeof keyName === "string" ? keyName.trim() : "";
  const id = typeof keyId === "string" ? keyId.trim() : "";
  // Naming both is refused rather than guessed at: they could point at different keys.
  if (name && id) return null;
  if (id) return { id };
  if (name) return { name };
  return null;
}

function answer(success: boolean, body: Record<string, unknown>): KeyToolResult {
  return { success, contentItems: [{ type: "inputText", text: JSON.stringify(body) }] };
}
