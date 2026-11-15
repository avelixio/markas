import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** What the desktop shell needs to reach a host: where it listens and the token to sign in. */
export interface HostLink {
  port: number;
  token: string;
}

export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.MARKAS_HOME?.trim() || join(homedir(), ".markas");
}

/** The address the app window loads. The token rides in the fragment, never sent to a server. */
export function windowUrl(link: HostLink): string {
  return `http://127.0.0.1:${link.port}/#token=${link.token}`;
}

export function hostOrigin(link: HostLink): string {
  return `http://127.0.0.1:${link.port}`;
}

/** Only pages of the host itself may load inside the app window. */
export function isHostUrl(url: string, link: HostLink): boolean {
  try {
    return new URL(url).origin === hostOrigin(link);
  } catch {
    return false;
  }
}

/** Links that may open in the person's own browser. */
export function isExternalWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Reads the running host's record and token, and checks that it answers. */
export async function findRunningHost(
  root: string,
  ping: (link: HostLink) => Promise<boolean> = pingHost,
): Promise<HostLink | null> {
  let port: number;
  let token: string;
  try {
    const record = JSON.parse(await readFile(join(root, "host.json"), "utf8")) as {
      port?: unknown;
    };
    if (typeof record.port !== "number") return null;
    port = record.port;
    token = (await readFile(join(root, "token"), "utf8")).trim();
  } catch {
    return null;
  }
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const link = { port, token };
  return (await ping(link)) ? link : null;
}

export async function pingHost(link: HostLink): Promise<boolean> {
  try {
    const response = await fetch(`${hostOrigin(link)}/api/app.getInfo`, {
      method: "POST",
      headers: { authorization: `Bearer ${link.token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Waits for a host that is starting up. Returns null when it never answers. */
export async function waitForHost(
  root: string,
  timeoutMs = 20_000,
  find: (root: string) => Promise<HostLink | null> = findRunningHost,
): Promise<HostLink | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const link = await find(root);
    if (link) return link;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
