import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 4780;

export interface HostPaths {
  /** Everything Markas owns on disk lives under this directory. */
  root: string;
  tokenFile: string;
  setupFile: string;
  /** Written by a running host so `markas status` and `markas send` can find it. */
  hostFile: string;
  exportsRoot: string;
  logsRoot: string;
  /** One folder per bot with its browser profile: cookies, sign-ins and site data. */
  browserProfilesRoot: string;
  /** Where Markas keeps a browser of its own, downloaded only when none is installed. */
  browsersRoot: string;
}

export function resolveHostPaths(env: NodeJS.ProcessEnv = process.env): HostPaths {
  const root = env.MARKAS_HOME?.trim() || join(homedir(), ".markas");
  return {
    root,
    tokenFile: join(root, "token"),
    setupFile: join(root, "setup.json"),
    hostFile: join(root, "host.json"),
    exportsRoot: join(root, "exports"),
    logsRoot: join(root, "logs"),
    browserProfilesRoot: join(root, "browser-profiles"),
    browsersRoot: join(root, "browsers"),
  };
}

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MARKAS_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`MARKAS_PORT must be a port number, got "${raw}".`);
  }
  return port;
}
