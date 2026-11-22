// The Markas desktop app: a thin shell around the host.
// It starts the host if none is running, shows the interface in its own window, and keeps a
// tray icon so bots go on working when the window is closed.
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeImage, session, shell, Tray } from "electron";
import {
  dataRoot,
  findRunningHost,
  type HostLink,
  isExternalWebUrl,
  isHostUrl,
  waitForHost,
  windowUrl,
} from "./host-link";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ownedHost: ChildProcess | null = null;
let quitting = false;

const assets = (...parts: string[]) =>
  app.isPackaged ? join(process.resourcesPath, ...parts) : join(app.getAppPath(), ...parts);

/** The host program: bundled beside the app when packaged, run from source otherwise. */
function hostCommand(): { command: string; args: string[] } {
  if (app.isPackaged) {
    const name = process.platform === "win32" ? "markas.exe" : "markas";
    return { command: join(process.resourcesPath, "host", name), args: ["serve"] };
  }
  return { command: "bun", args: [join(app.getAppPath(), "src", "host", "cli.ts"), "serve"] };
}

/** Uses a host that is already running, or starts one and owns it until the app quits. */
async function connect(): Promise<HostLink> {
  const root = dataRoot();
  const running = await findRunningHost(root);
  if (running) return running;

  const { command, args } = hostCommand();
  if (app.isPackaged && !existsSync(command)) {
    throw new Error(`The Markas host is missing from this installation (${command}).`);
  }
  // What the host prints while starting is kept, so a host that will not start can say why.
  const logPath = join(root, "logs", "desktop-host.log");
  let log: number | "ignore" = "ignore";
  try {
    mkdirSync(join(root, "logs"), { recursive: true });
    log = openSync(logPath, "w");
  } catch {
    // Without a log the host still starts; only the reason for a failure is lost.
  }
  let stopped: string | null = null;
  ownedHost = spawn(command, args, { stdio: ["ignore", log, log], windowsHide: true });
  if (typeof log === "number") closeSync(log);
  ownedHost.on("error", (error) => {
    stopped = error.message;
    ownedHost = null;
  });
  ownedHost.on("exit", (code, signal) => {
    stopped = signal ? `it was stopped by the system (${signal})` : `it ended with code ${code}`;
    ownedHost = null;
  });
  const link = await waitForHost(root, 20_000, async (dir) => {
    if (stopped) throw new Error(hostFailure(stopped, logPath));
    return findRunningHost(dir);
  });
  if (!link) throw new Error(hostFailure("it did not answer in 20 seconds", logPath));
  return link;
}

/** Why the host could not be reached, with the last lines it printed and where the rest is. */
function hostFailure(reason: string, logPath: string): string {
  let printed = "";
  try {
    printed = readFileSync(logPath, "utf8").trim().split("\n").slice(-6).join("\n");
  } catch {
    // No log could be read; the reason alone is shown.
  }
  const lines = [`The Markas host did not start: ${reason}.`];
  if (printed) lines.push("", "It printed:", printed);
  lines.push("", `The full record is in ${logPath}`);
  return lines.join("\n");
}

function createWindow(link: HostLink): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Markas",
    backgroundColor: "#111110",
    icon: assets("build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.once("ready-to-show", () => window.show());
  // A page that is slow or blocked must not leave Markas running with nothing to see.
  setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible() && !quitting) window.show();
  }, 4_000);
  let warned = false;
  window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || warned || quitting) return;
    warned = true;
    if (!window.isDestroyed()) window.show();
    dialog.showErrorBox(
      "Markas could not show its window",
      `The page at ${new URL(url).origin} did not load (${description}, ${code}).\n\nThe host is running. Security or proxy software on this computer may be blocking pages on this computer itself (127.0.0.1).\nYou can still open Markas in your browser: run "markas open" from the host folder.`,
    );
  });
  // Closing the window keeps Markas running in the tray, so bots and rounds carry on.
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  // Only the host's own pages load here. Web links open in the person's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url) && !isHostUrl(url, link)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isHostUrl(url, link)) event.preventDefault();
  });
  void window.loadURL(windowUrl(link));
  return window;
}

function showWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): Tray {
  const icon = nativeImage
    .createFromPath(assets("build", "icon.png"))
    .resize({ width: 16, height: 16 });
  const created = new Tray(icon);
  created.setToolTip("Markas");
  created.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Markas", click: showWindow },
      { type: "separator" },
      { label: "Quit Markas", click: () => app.quit() },
    ]),
  );
  created.on("click", showWindow);
  return created;
}

/**
 * No menu bar on Windows and Linux. macOS keeps a small one, because there copy, paste, undo,
 * select all and quit only work as keyboard shortcuts through the menu's roles.
 */
function applicationMenu(): Menu | null {
  if (process.platform !== "darwin") return null;
  return Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]);
}

function stopOwnedHost(): void {
  if (!ownedHost) return;
  ownedHost.kill();
  ownedHost = null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === "win32") app.setAppUserModelId("id.markas.app");
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
    stopOwnedHost();
  });
  // The app lives in the tray; closing the last window must not end it.
  app.on("window-all-closed", () => undefined);
  app.on("activate", showWindow);

  void app
    .whenReady()
    .then(async () => {
      Menu.setApplicationMenu(applicationMenu());
      const link = await connect();
      // The window only ever loads the host on this computer, so it never goes through a proxy:
      // a company proxy setting must not stand between Markas and itself.
      await session.defaultSession.setProxy({ mode: "direct" });
      mainWindow = createWindow(link);
      tray = createTray();
    })
    .catch((error: unknown) => {
      dialog.showErrorBox(
        "Markas could not start",
        `${error instanceof Error ? error.message : String(error)}\n\nYour bots and data were not changed.`,
      );
      quitting = true;
      stopOwnedHost();
      app.quit();
    });
}

export { tray };
