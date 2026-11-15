import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  ACCESS_LEVELS,
  type AccessLevel,
  type AskKind,
  type StandingGrant,
} from "../../shared/access";

export {
  ACCESS_LEVELS,
  type AccessLevel,
  type AskKind,
  DEFAULT_ACCESS,
  isAccessLevel,
  lowerAccess,
  type StandingGrant,
  type StandingPermission,
} from "../../shared/access";

export interface AccessScope {
  level: AccessLevel;
  /** The bot's working folder; relative paths start here. */
  cwd: string;
  /** Folders the bot may use freely: its own folder and the shared one. */
  ownRoots: string[];
  /** Folders that always need a yes below full access: Markas's own data, with its token and keys. */
  protectedRoots: string[];
}

/** Something the person can allow for the rest of the chat, not only once. */
export type Grant =
  | { type: "folder"; kind: "read" | "write"; root: string }
  | { type: "tool"; name: string }
  /** One saved key on the one exact site it belongs to. */
  | { type: "key"; id: string; origin: string }
  /** One exact website: scheme, full host and port. Never a parent domain. */
  | { type: "site"; origin: string };

export type Verdict =
  | {
      decision: "allow";
      /** Set when only a round's standing permission allowed this, so its use can be recorded. */
      standing?: StandingGrant;
    }
  | {
      decision: "ask";
      kind: AskKind;
      /** What exactly is being asked for: a path, a command, an address or a tool name. */
      detail: string;
      /** What "allow for this chat" would cover, or null when only once is offered. */
      grant: Grant | null;
    };

const ALLOW: Verdict = { decision: "allow" };

/** Tools that only organise the bot's own work. What they start is judged on its own. */
const INTERNAL_TOOLS = new Set([
  "AskUserQuestion",
  "TodoWrite",
  "TodoRead",
  "Task",
  "Agent",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "TaskStop",
  "EnterPlanMode",
  "ExitPlanMode",
  "Skill",
  "ToolSearch",
  "BashOutput",
  "KillShell",
  "KillBash",
]);
const READ_TOOLS: Record<string, string[]> = {
  Read: ["file_path"],
  NotebookRead: ["notebook_path"],
  LS: ["path"],
  Glob: ["path", "pattern"],
  Grep: ["path"],
};
const WRITE_TOOLS: Record<string, string[]> = {
  Write: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"],
};
const COMMAND_TOOLS = new Set(["Bash", "PowerShell"]);
const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch"]);
/**
 * Markas's own tools reach only what the host itself allows.
 * The browser tools are judged again in the host, one website at a time, by `judgeSite`.
 */
const OWN_TOOL_PREFIXES = ["mcp__markas__", "mcp__markas_browser__"];

/** Tools that run a command. A command can do anything, so nothing standing ever covers one. */
export const isCommandTool = (toolName: string): boolean => COMMAND_TOOLS.has(toolName);

/** Tools that open an address. A round reaches these one exact site at a time. */
export const isAddressTool = (toolName: string): boolean => toolName === "WebFetch";

/**
 * Decides whether a tool call may go ahead or needs the person's yes.
 * `standing` is what a round was given in advance. It is empty for everything that is not
 * a run of that round, and it can only turn an "ask" the person could have allowed for a
 * chat into an "allow": never a command, and never Markas's own data folder.
 */
export function judgeTool(
  scope: AccessScope,
  toolName: string,
  input: unknown,
  standing: readonly StandingGrant[] = [],
): Verdict {
  const verdict = judgeByLevel(scope, toolName, input);
  if (verdict.decision === "allow") return verdict;
  const used = standing.find((grant) => standingCovers(scope, grant, verdict, toolName, input));
  return used ? { decision: "allow", standing: used } : verdict;
}

function standingCovers(
  scope: AccessScope,
  grant: StandingGrant,
  verdict: Extract<Verdict, { decision: "ask" }>,
  toolName: string,
  input: unknown,
): boolean {
  // Given when the bot was trusted with more than it is now: it no longer counts.
  if (ACCESS_LEVELS.indexOf(grant.level) > ACCESS_LEVELS.indexOf(scope.level)) return false;
  // What can only ever be allowed one time in a chat cannot be allowed in advance either.
  if (verdict.kind === "command" || verdict.kind === "protected") return false;
  switch (grant.type) {
    case "read-folder":
      return verdict.kind === "read" && inside(verdict.detail, real(resolve(grant.path)));
    case "change-folder":
      return (
        (verdict.kind === "read" || verdict.kind === "write") &&
        inside(verdict.detail, real(resolve(grant.path)))
      );
    case "tool":
      return (
        !isCommandTool(toolName) &&
        !isAddressTool(toolName) &&
        verdict.grant?.type === "tool" &&
        verdict.grant.name === grant.name
      );
    case "site":
      return (
        isAddressTool(toolName) &&
        verdict.kind === "network" &&
        onSite(grant.origin, text(isRecord(input) ? input.url : undefined))
      );
    default:
      return false;
  }
}

/**
 * The exact site of an address: scheme, full host and port. Null when it is not a plain
 * http or https address, or hides a username in front of the host.
 */
export function siteOf(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || !url.hostname) return null;
  // URL.origin lower-cases the host and drops the default port.
  return url.origin;
}

function onSite(origin: string, address: string): boolean {
  const site = siteOf(address);
  return site !== null && site === siteOf(origin);
}

function judgeByLevel(scope: AccessScope, toolName: string, input: unknown): Verdict {
  if (scope.level === "full") return ALLOW;
  if (INTERNAL_TOOLS.has(toolName)) return ALLOW;
  if (OWN_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))) return ALLOW;

  const fields = isRecord(input) ? input : {};
  const readFields = READ_TOOLS[toolName];
  const writeFields = WRITE_TOOLS[toolName];
  if (readFields || writeFields) {
    const kind = readFields ? "read" : "write";
    const path = targetPath(scope, toolName, fields, readFields ?? writeFields ?? []);
    if (insideAny(path, scope.ownRoots)) return ALLOW;
    if (insideAny(path, scope.protectedRoots)) {
      return { decision: "ask", kind: "protected", detail: path, grant: null };
    }
    if (kind === "read" && scope.level === "read") return ALLOW;
    const root = kind === "read" && toolName !== "Read" ? path : dirname(path);
    return { decision: "ask", kind, detail: path, grant: { type: "folder", kind, root } };
  }
  if (COMMAND_TOOLS.has(toolName)) {
    // A command can do anything, so it is never allowed for a whole chat.
    return { decision: "ask", kind: "command", detail: text(fields.command), grant: null };
  }
  if (NETWORK_TOOLS.has(toolName)) {
    return {
      decision: "ask",
      kind: "network",
      detail: text(fields.url) || text(fields.query),
      grant: { type: "tool", name: toolName },
    };
  }
  return {
    decision: "ask",
    kind: "tool",
    detail: toolName,
    grant: { type: "tool", name: toolName },
  };
}

/** What the access rules need to know about a saved key. Never its value. */
export interface KeyUse {
  id: string;
  name: string;
  /** The exact site the key belongs to. */
  origin: string;
  /** The person asked to be asked on every use of this key, whatever the bot's level. */
  askEveryTime: boolean;
}

/**
 * Decides whether a bot may sign in with a saved key or needs the person's yes.
 * Signing in acts as the person on a website, so below full access the first use of a key in
 * a chat always asks. A key marked "ask" asks every time, even for a bot with full access:
 * the key's own setting can only make this stricter, never looser.
 */
export function judgeKeyUse(level: AccessLevel, key: KeyUse): Verdict {
  const detail = `Sign in to ${key.origin} with the key "${key.name}"`;
  if (key.askEveryTime) return { decision: "ask", kind: "tool", detail, grant: null };
  if (level === "full") return ALLOW;
  return {
    decision: "ask",
    kind: "tool",
    detail,
    grant: { type: "key", id: key.id, origin: key.origin },
  };
}

/**
 * Decides whether a bot may use its browser on a website.
 * A website is the internet, so below full access it needs a yes.
 * The yes can cover one exact site for the rest of the chat, never the whole internet.
 * `address` is the page being opened, or the page a tab is on when the bot acts in it.
 */
export function judgeSite(level: AccessLevel, address: string): Verdict {
  if (level === "full") return ALLOW;
  // An empty tab has nothing on it and reaches nothing.
  if (address === "about:blank") return ALLOW;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { decision: "ask", kind: "network", detail: address, grant: null };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { decision: "ask", kind: "network", detail: address, grant: null };
  }
  return {
    decision: "ask",
    kind: "network",
    detail: address,
    grant: { type: "site", origin: url.origin },
  };
}

/** True when an earlier "allow for this chat" already covers this request. */
export function covers(grants: readonly Grant[], verdict: Verdict): boolean {
  if (verdict.decision === "allow") return true;
  const wanted = verdict.grant;
  if (!wanted) return false;
  return grants.some((grant) => {
    if (grant.type === "tool") return wanted.type === "tool" && wanted.name === grant.name;
    if (grant.type === "key") {
      // A yes for a key is for that key on that site; a key moved to another site asks again.
      return wanted.type === "key" && wanted.id === grant.id && wanted.origin === grant.origin;
    }
    if (grant.type === "site") return wanted.type === "site" && wanted.origin === grant.origin;
    if (wanted.type !== "folder") return false;
    // Permission to change a folder includes reading it.
    const kindCovers = grant.kind === wanted.kind || grant.kind === "write";
    return kindCovers && inside(wanted.root, grant.root);
  });
}

function targetPath(
  scope: AccessScope,
  toolName: string,
  fields: Record<string, unknown>,
  names: string[],
): string {
  let raw = "";
  for (const name of names) {
    const value = text(fields[name]);
    if (!value) continue;
    // A search pattern only says where it looks when it starts at a fixed place.
    if (name === "pattern") {
      if (!isAbsolute(value)) continue;
      raw = value.split(/[*?[{]/)[0] ?? "";
      break;
    }
    raw = value;
    break;
  }
  if (!raw && toolName !== "Glob" && toolName !== "Grep" && toolName !== "LS") {
    // A file tool without a path cannot be judged, so it is treated as outside everything.
    return resolve(scope.cwd, "..", "unknown-path");
  }
  return real(resolve(scope.cwd, raw || "."));
}

/** Follows links as far as the path exists, so a link inside the bot's folder cannot point out of it. */
export function real(path: string): string {
  let existing = path;
  const missing: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(existing), ...missing.reverse());
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return path;
      missing.push(existing.slice(parent.length).replace(/^[\\/]/, ""));
      existing = parent;
    }
  }
}

/** True when the path is in one of the folders, with the folders' links followed. */
export function insideAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => inside(path, real(resolve(root))));
}

export function inside(path: string, root: string): boolean {
  const fold = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  const offset = relative(fold(resolve(root)), fold(resolve(path)));
  return (
    offset === "" || (!offset.startsWith("..") && !isAbsolute(offset) && offset !== `..${sep}`)
  );
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
