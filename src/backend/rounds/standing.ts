import { isAbsolute, parse, resolve } from "node:path";
import {
  ACCESS_LEVELS,
  type AccessLevel,
  MAX_STANDING_PERMISSIONS,
  type StandingGrant,
  type StandingPermission,
  sameStanding,
  standingTarget,
} from "../../shared/access";
import { inside, insideAny, isAddressTool, isCommandTool, real, siteOf } from "../access/policy";

export class StandingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StandingError";
  }
}

/**
 * Checks what a round is asked to be allowed in advance and returns it in its stored form.
 * A standing permission is one named folder, tool or exact site. It is refused when it
 * names a command, Markas's own data folder, or anything wide enough to hold that folder.
 */
export function validateStanding(value: unknown, protectedRoots: readonly string[]) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new StandingError("Standing permissions must be a list.");
  if (value.length > MAX_STANDING_PERMISSIONS) {
    throw new StandingError(
      `A round can hold at most ${MAX_STANDING_PERMISSIONS} standing permissions.`,
    );
  }
  const permissions: StandingPermission[] = [];
  for (const entry of value) {
    const permission = validateOne(entry, protectedRoots);
    if (!permissions.some((known) => sameStanding(known, permission))) permissions.push(permission);
  }
  return permissions;
}

function validateOne(entry: unknown, protectedRoots: readonly string[]): StandingPermission {
  if (typeof entry !== "object" || entry === null) {
    throw new StandingError("A standing permission must name a folder, a tool or a site.");
  }
  const fields = entry as Record<string, unknown>;
  const field = (name: string) => (typeof fields[name] === "string" ? fields[name].trim() : "");
  switch (fields.type) {
    case "read-folder":
    case "change-folder":
      return { type: fields.type, path: validateFolder(field("path"), protectedRoots) };
    case "tool":
      return { type: "tool", name: validateTool(field("name")) };
    case "site":
      return { type: "site", origin: validateSite(field("origin")) };
    default:
      throw new StandingError("A standing permission must name a folder, a tool or a site.");
  }
}

function validateFolder(path: string, protectedRoots: readonly string[]): string {
  if (!path) throw new StandingError("Choose the folder this round may use.");
  if (!isAbsolute(path)) {
    throw new StandingError(`Give the full path of the folder, not "${path}".`);
  }
  const folder = resolve(path);
  if (parse(folder).root === folder) {
    throw new StandingError("A whole drive is too much. Choose one folder.");
  }
  const actual = real(folder);
  if (insideAny(actual, protectedRoots)) {
    throw new StandingError(
      "A round cannot be given Markas's own data folder. It holds the sign-in token and the keyring.",
    );
  }
  if (protectedRoots.some((root) => inside(real(resolve(root)), actual))) {
    throw new StandingError(
      "That folder contains Markas's own data folder. Choose a folder that does not.",
    );
  }
  return folder;
}

function validateTool(name: string): string {
  if (!name) throw new StandingError("Name the tool this round may use.");
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(name)) {
    throw new StandingError(`"${name}" is not the name of one tool.`);
  }
  if (isCommandTool(name)) {
    throw new StandingError(
      "A round cannot be allowed to run any command. Commands are approved one at a time.",
    );
  }
  if (isAddressTool(name)) {
    throw new StandingError("Add the exact site the round may open instead of the whole tool.");
  }
  return name;
}

function validateSite(address: string): string {
  if (!address) throw new StandingError("Give the site this round may open.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`;
  const origin = siteOf(withScheme);
  if (!origin || /[*\s]/.test(address)) {
    throw new StandingError(
      `"${address}" is not one exact site. Use an address such as https://reports.example.com.`,
    );
  }
  const url = new URL(withScheme);
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new StandingError(
      `A standing permission covers a whole site. Leave out everything after ${origin}.`,
    );
  }
  return origin;
}

/**
 * Turns what the person chose into stored grants.
 * A permission the round already had keeps its date and level; a new one is stamped with
 * the bot's level now, so it can be dropped if the bot is later set lower.
 */
export function stampStanding(
  permissions: readonly StandingPermission[],
  existing: readonly StandingGrant[],
  level: AccessLevel,
  now: Date,
): StandingGrant[] {
  return permissions.map((permission) => {
    const known = existing.find((grant) => sameStanding(grant, permission));
    return known
      ? { ...known }
      : ({ ...permission, level, grantedAt: now.toISOString() } as StandingGrant);
  });
}

/** Splits grants into those that still count at a level and those given at a higher one. */
export function splitByLevel(grants: readonly StandingGrant[], level: AccessLevel) {
  const rank = ACCESS_LEVELS.indexOf(level);
  const kept: StandingGrant[] = [];
  const dropped: StandingGrant[] = [];
  for (const grant of grants) {
    (ACCESS_LEVELS.indexOf(grant.level) > rank ? dropped : kept).push(grant);
  }
  return { kept, dropped };
}

const VERBS: Record<StandingPermission["type"], string> = {
  "read-folder": "read folder",
  "change-folder": "change folder",
  tool: "use tool",
  site: "open site",
};

/** A standing permission in plain words, for the Logbook and the run history. */
export function describeStanding(permission: StandingPermission): string {
  return `${VERBS[permission.type]} ${standingTarget(permission)}`;
}

/** The permission without its stored date and level, as the round form sends it. */
export function bareStanding(grant: StandingGrant): StandingPermission {
  if (grant.type === "tool") return { type: "tool", name: grant.name };
  if (grant.type === "site") return { type: "site", origin: grant.origin };
  return { type: grant.type, path: grant.path };
}
