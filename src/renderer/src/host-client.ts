import type {
  AgentEvent,
  AttachmentImportEvent,
  DraftAttachment,
  MarkasDesktopApi,
  UpdateStatus,
} from "../../shared/ipc";

const TOKEN_HASH = /^#token=([0-9a-f]{64})$/;

export class HostUnauthorizedError extends Error {
  constructor() {
    super("This browser is not signed in to the Markas host. Run `markas open`.");
    this.name = "HostUnauthorizedError";
  }
}

/**
 * Signs this browser in when the page was opened by `markas open` (token in the URL fragment).
 * The token is swapped for an HttpOnly cookie and removed from the address bar at once.
 */
export async function establishSession(location: Location, history: History): Promise<void> {
  const match = TOKEN_HASH.exec(location.hash);
  if (!match) return;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${match[1]}` },
  });
  if (!response.ok) throw new HostUnauthorizedError();
}

/** Calls one host method by name. Throws the host's own message when it refuses. */
export async function callHost<T>(method: string, input?: unknown): Promise<T> {
  const response = await fetch(`/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (response.status === 401) throw new HostUnauthorizedError();
  const body = (await response.json()) as { result?: T; error?: string };
  if (!response.ok) throw new Error(body.error ?? `The host answered ${response.status}.`);
  return body.result as T;
}

const call = callHost;

export const CONNECTION_EVENT = "markas:connection";

/** Tells the page whether the live event stream from the host is up. */
function announceConnection(connected: boolean): void {
  window.dispatchEvent(new CustomEvent(CONNECTION_EVENT, { detail: { connected } }));
}

let source: EventSource | null = null;
const channelListeners = new Map<string, Set<(payload: unknown) => void>>();

/**
 * Listens to one channel of the host's live event stream, such as "agent" or "setup".
 * The whole page shares one stream. Returns a function that stops listening.
 */
export function onHostEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  if (!source) {
    source = new EventSource("/api/events");
    // The browser retries a dropped stream by itself; these two events say which state we are in.
    source.addEventListener("open", () => announceConnection(true));
    source.addEventListener("error", () => announceConnection(false));
  }
  let listeners = channelListeners.get(channel);
  if (!listeners) {
    const added = new Set<(payload: unknown) => void>();
    listeners = added;
    channelListeners.set(channel, added);
    source.addEventListener(channel, (message) => {
      const payload: unknown = JSON.parse((message as MessageEvent<string>).data);
      for (const each of added) each(payload);
    });
  }
  const entry = listener as (payload: unknown) => void;
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}

/** Drops the live event stream and everyone listening to it. Tests start clean with this. */
export function closeHostEvents(): void {
  source?.close?.();
  source = null;
  channelListeners.clear();
}

/** The same API the desktop shell exposed over IPC, served by the Markas host over HTTP. */
export function createHostClient(): MarkasDesktopApi {
  const importListeners = new Set<(event: AttachmentImportEvent) => void>();

  const emitImport = (event: AttachmentImportEvent) => {
    for (const listener of importListeners) listener(event);
  };

  const upload = async (files: File[]): Promise<DraftAttachment[]> => {
    const form = new FormData();
    for (const file of files) form.append("file", file, file.name || `pasted-${Date.now()}.png`);
    const response = await fetch("/api/agent.importAttachments", { method: "POST", body: form });
    if (response.status === 401) throw new HostUnauthorizedError();
    const body = (await response.json()) as { result?: DraftAttachment[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? `The host answered ${response.status}.`);
    return body.result ?? [];
  };

  const importFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    const requestId = crypto.randomUUID();
    emitImport({ type: "started", requestId });
    try {
      emitImport({ type: "completed", requestId, attachments: await upload(files) });
    } catch (error) {
      emitImport({
        type: "error",
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  window.addEventListener("dragover", (event) => {
    if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) {
      event.preventDefault();
    }
  });
  window.addEventListener("drop", (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    void importFiles(files);
  });
  window.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    void importFiles(files);
  });

  const openInNewTab = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return {
    getAppInfo: () => call("app.getInfo"),
    // Markas has no hosted help or feedback pages yet; these stay inert until it does.
    openExternal: async () => undefined,
    openUrl: async (url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only HTTP(S) links can open in the browser.");
      }
      openInNewTab(parsed.toString());
    },
    agent: {
      getStatus: () => call("agent.getStatus"),
      getUsage: () => call("agent.getUsage"),
      listModels: () => call("agent.listModels"),
      listBots: () => call("agent.listBots"),
      createBot: () => call("agent.createBot"),
      updateBot: (input) => call("agent.updateBot", input),
      deleteBot: (botId) => call("agent.deleteBot", botId),
      listDeletedBots: () => call("agent.listDeletedBots"),
      restoreBot: (botId) => call("agent.restoreBot", botId),
      purgeBot: (botId) => call("agent.purgeBot", botId),
      readConversation: (botId) => call("agent.readConversation", botId),
      chooseAttachments: () => chooseFiles().then(upload),
      onAttachmentImport: (listener) => {
        importListeners.add(listener);
        return () => importListeners.delete(listener);
      },
      discardDraftAttachment: (attachmentId) => call("agent.discardDraftAttachment", attachmentId),
      openAttachment: (input) => call("agent.openAttachment", input),
      sendMessage: (input) => call("agent.sendMessage", input),
      setMessageReaction: (input) => call("agent.setMessageReaction", input),
      listQueue: (botId) => call("agent.listQueue", botId),
      cancelQueuedMessage: (input) => call("agent.cancelQueuedMessage", input),
      setQueuePaused: (input) => call("agent.setQueuePaused", input),
      interrupt: (input) => call("agent.interrupt", input),
      respondToPrompt: (input) => call("agent.respondToPrompt", input),
      onEvent: (listener) => onHostEvent<AgentEvent>("agent", listener),
    },
    browser: {
      open: (input) => call("browser.open", input),
      activate: (tabId) => call("browser.activate", tabId),
      close: (tabId) => call("browser.close", tabId),
      listTabs: () => call("browser.listTabs"),
      getControlState: () => call("browser.getControlState"),
      setVisible: (input) => call("browser.setVisible", input),
    },
    update: {
      getStatus: () => call("update.getStatus"),
      check: () => call("update.check"),
      download: () => call("update.download"),
      install: () => call("update.install"),
      // The host has no in-app updater, so no update events are ever published.
      onEvent: (_listener: (status: UpdateStatus) => void) => () => undefined,
    },
    maintenance: {
      exportData: () => call("maintenance.exportData"),
      exportDiagnostics: () => call("maintenance.exportDiagnostics"),
    },
  };
}

/** Opens the browser's file picker; resolves with no files when the user cancels. */
function chooseFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
