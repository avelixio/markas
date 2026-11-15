/**
 * How much a bot may do without asking the person.
 * ask: works inside its own folder; everything else needs a yes.
 * read: may also read anywhere; changes, commands and the network need a yes.
 * full: never asks.
 */
export const ACCESS_LEVELS = ["ask", "read", "full"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const DEFAULT_ACCESS: AccessLevel = "ask";

export const isAccessLevel = (value: unknown): value is AccessLevel =>
  ACCESS_LEVELS.includes(value as AccessLevel);

/** The more careful of two levels. A bot acting for another bot gets the lower of the two. */
export function lowerAccess(a: AccessLevel, b: AccessLevel): AccessLevel {
  return ACCESS_LEVELS[Math.min(ACCESS_LEVELS.indexOf(a), ACCESS_LEVELS.indexOf(b))] ?? "ask";
}

/** What a bot is asking permission for. */
export type AskKind = "read" | "write" | "command" | "network" | "tool" | "protected";

/**
 * One thing a round may do without asking, every time it runs.
 * Always one named thing: a folder, a tool or an exact site. Never a command and never "anything".
 */
export type StandingPermission =
  | { type: "read-folder"; path: string }
  /** Changing a folder includes reading it. */
  | { type: "change-folder"; path: string }
  | { type: "tool"; name: string }
  /** An exact site: scheme, full host and port, such as https://reports.example.com. */
  | { type: "site"; origin: string };

export const STANDING_PERMISSION_TYPES = ["read-folder", "change-folder", "tool", "site"] as const;
export type StandingPermissionType = (typeof STANDING_PERMISSION_TYPES)[number];

/** A standing permission as stored with its round. */
export type StandingGrant = StandingPermission & {
  /** The bot's access level when this was granted. It stops counting when the bot is set lower. */
  level: AccessLevel;
  grantedAt: string;
};

/** The most standing permissions one round can hold. */
export const MAX_STANDING_PERMISSIONS = 20;

/** The folder, tool or site a standing permission names. */
export function standingTarget(permission: StandingPermission): string {
  if (permission.type === "tool") return permission.name;
  if (permission.type === "site") return permission.origin;
  return permission.path;
}

export function sameStanding(a: StandingPermission, b: StandingPermission): boolean {
  return a.type === b.type && standingTarget(a) === standingTarget(b);
}
