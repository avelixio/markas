import { execFile } from "node:child_process";
import type { AgentService } from "../backend/agent-service";
import type { BrowserService } from "../backend/browser-tools";
import type { MailboxStore } from "../backend/mailbox-store";
import type { AppInfo, AttachmentDataInput, DesktopPlatform, UpdateStatus } from "../shared/ipc";
import { exportDiagnostics, exportMarkasData } from "./maintenance-service";
import {
  parseBrowserOpen,
  parseCancelQueuedMessage,
  parseInterrupt,
  parseMessageReaction,
  parseOpenAttachment,
  parsePromptResponse,
  parseSendMessage,
  parseSetQueuePaused,
  parseUpdateBot,
  parseVisibility,
  requireString,
} from "./parsers";

export interface HostContext {
  name: string;
  version: string;
  service: AgentService;
  mailbox: MailboxStore;
  browser: BrowserService;
  setupFile: string;
  exportsRoot: string;
  initializeAgent: () => Promise<void>;
  /** Opens a local file or folder with the operating system; injectable for tests. */
  openPath?: (path: string, action: "open" | "reveal") => Promise<void>;
}

export type HostMethod = (input: unknown) => unknown;

/**
 * One entry per former desktop IPC handler. The name is the route: POST /api/<name>.
 * Keep names stable; the web UI client and scripts call them by string.
 */
export function createHostMethods(context: HostContext): Record<string, HostMethod> {
  const { service, mailbox, browser } = context;
  const openPath = context.openPath ?? openWithOperatingSystem;
  return {
    "app.getInfo": (): AppInfo => ({
      name: context.name,
      version: context.version,
      platform: hostPlatform(),
    }),
    "update.getStatus": (): UpdateStatus => updateStatus(context.version),
    "update.check": (): UpdateStatus => updateStatus(context.version),
    "update.download": (): UpdateStatus => updateStatus(context.version),
    "update.install": () => undefined,
    "maintenance.exportData": () =>
      exportMarkasData({
        service,
        mailbox,
        exportsRoot: context.exportsRoot,
        version: context.version,
      }),
    "maintenance.exportDiagnostics": () =>
      exportDiagnostics({
        service,
        browser,
        exportsRoot: context.exportsRoot,
        version: context.version,
      }),

    "agent.getStatus": () => service.getStatus(),
    "agent.getUsage": () => service.getUsage(),
    "agent.listModels": () => service.listModels(),
    "agent.listBots": () => service.listBots(),
    "agent.createBot": () => service.createBot(),
    "agent.updateBot": (input) => service.updateBot(parseUpdateBot(input)),
    "agent.deleteBot": (botId) => service.deleteBot(requireString(botId, "botId")),
    "agent.readConversation": (botId) => service.readConversation(requireString(botId, "botId")),
    "agent.sendMessage": (input) => service.sendMessage(parseSendMessage(input)),
    "agent.setMessageReaction": (input) => service.setMessageReaction(parseMessageReaction(input)),
    "agent.discardDraftAttachment": (attachmentId) =>
      service.discardDraftAttachment(requireString(attachmentId, "attachmentId")),
    "agent.openAttachment": async (input) => {
      const parsed = parseOpenAttachment(input);
      const attachment = await mailbox.resolveAttachment(parsed.attachmentId);
      if (!attachment) throw new Error("Attachment was not found.");
      await openPath(attachment.path, parsed.action);
    },
    "agent.listQueue": (botId) => service.listQueue(requireString(botId, "botId")),
    "agent.cancelQueuedMessage": (input) => {
      const parsed = parseCancelQueuedMessage(input);
      return service.cancelQueuedMessage(parsed.botId, parsed.deliveryId);
    },
    "agent.setQueuePaused": (input) => {
      const parsed = parseSetQueuePaused(input);
      return service.setQueuePaused(parsed.botId, parsed.paused);
    },
    "agent.interrupt": (input) => {
      const parsed = parseInterrupt(input);
      return service.interrupt(parsed.botId, parsed.turnId);
    },
    "agent.interruptAll": () => service.interruptAll(),
    "agent.respondToPrompt": (input) => service.respondToPrompt(parsePromptResponse(input)),

    "browser.open": (input) => {
      const parsed = parseBrowserOpen(input);
      return browser.open(parsed.url, parsed.ownerThreadId ?? null, parsed.ownerBotId ?? null);
    },
    "browser.activate": (tabId) => browser.activate(requireString(tabId, "tabId")),
    "browser.close": (tabId) => browser.close(requireString(tabId, "tabId")),
    "browser.listTabs": () => browser.listTabs(),
    "browser.getControlState": () => browser.getControlState(),
    "browser.setVisible": (input) => browser.setVisible(parseVisibility(input)),
  };
}

/** Files dropped, pasted or picked in the web UI arrive as bytes, never as host paths. */
export function importAttachments(context: HostContext, data: AttachmentDataInput[]) {
  return context.service.prepareImportedAttachments([], data);
}

function updateStatus(currentVersion: string): UpdateStatus {
  return {
    phase: "unsupported",
    currentVersion,
    availableVersion: null,
    progress: null,
    checkedAt: null,
    message: "Markas updates through its repository, not an in-app updater.",
  };
}

function hostPlatform(): DesktopPlatform {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
    throw new Error(`Unsupported host platform: ${platform}`);
  }
  return platform;
}

export function openWithOperatingSystem(path: string, action: "open" | "reveal"): Promise<void> {
  const [command, args] = openCommand(path, action);
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error) => {
      // explorer.exe exits with code 1 even when it opened the window.
      if (error && command !== "explorer.exe") reject(error);
      else resolve();
    });
  });
}

function openCommand(path: string, action: "open" | "reveal"): [string, string[]] {
  if (process.platform === "darwin") return ["open", action === "reveal" ? ["-R", path] : [path]];
  if (process.platform === "win32") {
    return ["explorer.exe", [action === "reveal" ? `/select,${path}` : path]];
  }
  return ["xdg-open", [action === "reveal" ? `${path}/..` : path]];
}
