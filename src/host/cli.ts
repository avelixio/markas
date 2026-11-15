#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { openAppWindow } from "./app-window";
import { APP_VERSION, type HostRecord, startHost } from "./main";
import { resolveHostPaths } from "./paths";
import { serveCommand } from "./runtime";
import { installService, uninstallService } from "./service-install";
import { readToken } from "./token";

const USAGE = `markas ${APP_VERSION}

Usage:
  markas                     Start the host and open the web UI
  markas serve               Run the host in the foreground, without opening anything
  markas open                Open the web UI, signed in, in your browser
  markas status              Show whether the host is running and which engines are ready
  markas send <bot> <text>   Queue a message for a bot (bot id or name)
  markas install             Start the host at login and keep it running
  markas uninstall           Remove the login item
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "start":
      return start();
    case "serve":
      return serve();
    case "open":
      return open();
    case "status":
      return status();
    case "send":
      return send(rest);
    case "install":
      return install();
    case "uninstall":
      await uninstallService();
      console.log("Markas no longer starts at login.");
      return 0;
    case "--version":
    case "-v":
      console.log(APP_VERSION);
      return 0;
    default:
      console.log(USAGE);
      return command === "help" || command === "--help" ? 0 : 2;
  }
}

/** What double-clicking the executable does: run the host and show the web UI. */
async function start(): Promise<number> {
  const already = await findRunningHost();
  if (already) {
    await openBrowser(already.record.port, already.token);
    console.log(`Markas is already running. Opened http://127.0.0.1:${already.record.port}`);
    return 0;
  }
  const host = await startHost();
  console.log(`Markas is running on ${host.url}`);
  const token = await readToken(host.paths.tokenFile);
  if (token) await openBrowser(host.port, token).catch(() => undefined);
  console.log("Markas opened in its own window. Keep this console open; closing it stops Markas.");
  return keepRunning(host);
}

async function serve(): Promise<number> {
  const host = await startHost();
  console.log(`Markas host listening on ${host.url}`);
  console.log("Run `markas open` to open the web UI.");
  return keepRunning(host);
}

async function keepRunning(host: { stop(): Promise<void> }): Promise<number> {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void host.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await new Promise<never>(() => undefined);
  return 0;
}

async function open(): Promise<number> {
  const running = await requireRunningHost();
  if (!running) return 1;
  await openBrowser(running.record.port, running.token);
  console.log(`Opened http://127.0.0.1:${running.record.port}`);
  return 0;
}

/** Opens the web UI signed in: the token rides in the URL fragment, which is never sent to a server. */
function openBrowser(port: number, token: string): Promise<void> {
  const url = `http://127.0.0.1:${port}/#token=${token}`;
  // A window of its own when a Chromium browser is installed; MARKAS_OPEN_IN=tab keeps a tab.
  if (process.env.MARKAS_OPEN_IN !== "tab" && openAppWindow(url)) return Promise.resolve();
  const [program, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise<void>((resolve, reject) => {
    execFile(program, args, { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
  });
}

async function status(): Promise<number> {
  const running = await requireRunningHost();
  if (!running) return 1;
  const result = await call<{
    phase: string;
    message: string | null;
    providers?: Array<{ id: string; state: string; version: string | null }>;
  }>(running, "agent.getStatus");
  console.log(
    `Markas ${running.record.version} on port ${running.record.port}, pid ${running.record.pid}`,
  );
  console.log(`Agents: ${result.phase}${result.message ? ` (${result.message})` : ""}`);
  for (const provider of result.providers ?? []) {
    console.log(
      `  ${provider.id}: ${provider.state}${provider.version ? ` ${provider.version}` : ""}`,
    );
  }
  return 0;
}

async function send(args: string[]): Promise<number> {
  const [botRef, ...words] = args;
  const text = words.join(" ").trim();
  if (!botRef || !text) {
    console.error("Usage: markas send <bot> <text>");
    return 2;
  }
  const running = await requireRunningHost();
  if (!running) return 1;
  const bots = await call<Array<{ id: string; name: string }>>(running, "agent.listBots");
  const wanted = botRef.toLowerCase();
  const bot =
    bots.find((candidate) => candidate.id === botRef) ??
    bots.find((candidate) => candidate.name.toLowerCase() === wanted);
  if (!bot) {
    console.error(`No bot named "${botRef}". Known bots: ${bots.map((b) => b.id).join(", ")}`);
    return 1;
  }
  const receipt = await call<{ messageId: string }>(running, "agent.sendMessage", {
    botId: bot.id,
    text,
  });
  console.log(`Queued message ${receipt.messageId} for ${bot.name}.`);
  return 0;
}

async function install(): Promise<number> {
  const paths = resolveHostPaths();
  const result = await installService({
    ...serveCommand(),
    logsRoot: paths.logsRoot,
  });
  console.log(`Markas starts at login (${result.kind}: ${result.location}).`);
  return 0;
}

interface Running {
  record: HostRecord;
  token: string;
}

async function requireRunningHost(): Promise<Running | null> {
  const running = await findRunningHost();
  if (!running) console.error("The Markas host is not running. Start it with `markas`.");
  return running;
}

/** The running host, if its record exists and it answers. */
async function findRunningHost(): Promise<Running | null> {
  const paths = resolveHostPaths();
  let record: HostRecord;
  try {
    record = JSON.parse(await readFile(paths.hostFile, "utf8")) as HostRecord;
  } catch {
    return null;
  }
  const token = await readToken(paths.tokenFile);
  if (!token) return null;
  try {
    await call({ record, token }, "app.getInfo");
  } catch {
    return null;
  }
  return { record, token };
}

async function call<T>(running: Running, method: string, input?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${running.record.port}/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${running.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });
  const body = (await response.json()) as { result?: T; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Host answered ${response.status}.`);
  return body.result as T;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
