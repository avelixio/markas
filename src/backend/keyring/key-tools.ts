// The tools through which a bot uses the keyring. They sit in the "markas" tool namespace
// beside list_agents and send_message, so a bot calls them as markas.keyring_list and
// markas.keyring_sign_in. A bot only ever names a key here; it never receives one.
import type { AccessLevel } from "../access/policy";
import type { KeySignIn, KeyUseDecision } from "./sign-in";

export const KEYRING_LIST_TOOL = "keyring_list";
export const KEYRING_SIGN_IN_TOOL = "keyring_sign_in";

export const KEYRING_TOOL_DESCRIPTIONS = {
  [KEYRING_LIST_TOOL]:
    "List the saved keys the person has shared with you: each key's name and the one exact website it works on. Values are never included.",
  [KEYRING_SIGN_IN_TOOL]:
    "Sign in to a website with a saved key. First open the site's sign-in page in your browser tab, then name the key. Markas types the username, password and one-time code itself and tells you how it went. You never see the values, so do not ask the person for them.",
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
] as const;

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
