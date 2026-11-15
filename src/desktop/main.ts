// The Markas desktop app: a thin shell around the host.
// It starts the host if none is running, shows the interface in its own window, and keeps a
// tray icon so bots go on working when the window is closed.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from "electron";
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
  ownedHost = spawn(command, args, { stdio: "ignore", windowsHide: true });
  ownedHost.on("exit", () => {
    ownedHost = null;
  });
  const link = await waitForHost(root);
  if (!link) throw new Error("The Markas host did not start. Try opening Markas again.");
  return link;
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
      Menu.setApplicationMenu(null);
      const link = await connect();
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
