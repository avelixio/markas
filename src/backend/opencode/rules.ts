import { resolve } from "node:path";
import type { AccessLevel } from "../../shared/access";
import { isRecord } from "../protocol";

/** How long OpenCode may wait for one of Markas's tools: a week, like a question to the person. */
const TOOL_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

/** The names OpenCode gives its own permissions. A name missing here is covered by "*". */
const ASKED = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "external_directory",
  "webfetch",
  "websearch",
  "codesearch",
  "lsp",
  "skill",
  "doom_loop",
];

/**
 * The permission rules one OpenCode session runs under.
 *
 * Below full access OpenCode is told to ask about everything, so every tool call comes to
 * Markas and is judged by the same rule as for the other engines. The answer OpenCode gets
 * is always for that one call, so it never remembers a yes by itself.
 *
 * Three things are switched off because OpenCode cannot pass their questions on over this
 * connection, and a question nobody hears would leave the bot waiting for ever: helpers of
 * its own (`task`), its question tool, and its plan mode.
 */
export function permissionRules(level: AccessLevel): Record<string, string> {
  if (level === "full") {
    return {
      "*": "allow",
      read: "allow",
      external_directory: "allow",
      doom_loop: "allow",
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
    };
  }
  return {
    "*": "ask",
    ...Object.fromEntries(ASKED.map((name) => [name, "ask"])),
    task: "deny",
    question: "deny",
    plan_enter: "deny",
    plan_exit: "deny",
    todowrite: "allow",
    todoread: "allow",
    // Markas's own tools reach only what the host allows, and the host judges them itself.
    "markas_*": "allow",
  };
}

export interface ToolEndpoint {
  url: string;
  token: string;
}

/**
 * The settings handed to one OpenCode process. They are given last, so they win over the
 * person's own OpenCode settings wherever the two say different things.
 */
export function sessionSettings(input: {
  level: AccessLevel;
  instructionsFile: string;
  tools: Record<string, ToolEndpoint>;
  /** Providers Markas adds, such as a model server on this computer the person connected. */
  providers?: Record<string, unknown>;
}): Record<string, unknown> {
  const permission = permissionRules(input.level);
  return {
    autoupdate: false,
    share: "disabled",
    instructions: [input.instructionsFile],
    experimental: {
      mcp_timeout: TOOL_WAIT_MS,
      // Without this a "no" ends the turn on the spot, and the person is left with a reply
      // cut off mid-sentence. With it the bot hears the "no" and can say what it could not do.
      // Whatever it tries next is asked about again.
      continue_loop_on_deny: true,
    },
    mcp: Object.fromEntries(
      Object.entries(input.tools).map(([name, endpoint]) => [
        name,
        {
          type: "remote",
          url: endpoint.url,
          headers: { Authorization: `Bearer ${endpoint.token}` },
          oauth: false,
          enabled: true,
        },
      ]),
    ),
    ...(input.providers && Object.keys(input.providers).length > 0
      ? { provider: input.providers }
      : {}),
    permission,
    // The rules of the agent itself are read after everything else, so they are repeated here.
    agent: { build: { permission } },
  };
}

/** A tool call as Markas's access rules name it. */
export interface JudgedCall {
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Says what an OpenCode tool call is in the words of Markas's access rules, so one rule
 * judges all engines. `permission` is what OpenCode asks for, `tool` and `input` are the
 * call it belongs to when OpenCode has told us, and `details` came with the question.
 *
 * A call that cannot be read is given a name the rules do not know. That always asks the
 * person; it is never let through.
 */
export function judgedCalls(
  cwd: string,
  permission: string,
  tool: string | null,
  input: unknown,
  details: unknown,
): JudgedCall[] {
  const fields = isRecord(input) ? input : {};
  const extra = isRecord(details) ? details : {};
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const name = (tool ?? permission).toLowerCase();
  const file = text(fields.filePath) || text(extra.filepath);

  switch (name) {
    case "bash":
      return [{ toolName: "Bash", input: { command: text(fields.command) } }];
    case "read":
      return [{ toolName: "Read", input: { file_path: file } }];
    case "edit":
    case "multiedit":
      return [{ toolName: "Edit", input: { file_path: file } }];
    case "write":
      return [{ toolName: "Write", input: { file_path: file } }];
    case "patch":
    case "apply_patch": {
      // One patch can change several files; each is judged on its own.
      const files = Array.isArray(extra.files)
        ? extra.files.filter(isRecord).flatMap((entry) => {
            const moved = text(entry.movePath);
            const path = text(entry.filePath);
            return [path, moved].filter(Boolean);
          })
        : [];
      if (files.length === 0) return [{ toolName: "opencode:patch", input: {} }];
      return files.map((path) => ({
        toolName: "Write",
        input: { file_path: resolve(cwd, path) },
      }));
    }
    case "glob":
      return [
        { toolName: "Glob", input: { path: text(fields.path), pattern: text(fields.pattern) } },
      ];
    case "grep":
      return [{ toolName: "Grep", input: { path: text(fields.path) } }];
    case "list":
      return [{ toolName: "LS", input: { path: text(fields.path) } }];
    case "webfetch":
      return [{ toolName: "WebFetch", input: { url: text(fields.url) || text(extra.url) } }];
    case "websearch":
    case "codesearch":
      return [{ toolName: "WebSearch", input: { query: text(fields.query) || text(extra.query) } }];
    case "todowrite":
    case "todoread":
      return [{ toolName: "TodoWrite", input: {} }];
    default:
      return [{ toolName: `opencode:${name}`, input: fields }];
  }
}
