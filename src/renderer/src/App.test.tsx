import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEvent,
  AttachmentImportEvent,
  BotSummary,
  ConversationSnapshot,
  UpdateStatus,
} from "../../shared/ipc";
import { App } from "./App";
import { setLanguage } from "./i18n";
import { openAreaRequest } from "./ui/crew-signal";

let emitAgentEvent: ((event: AgentEvent) => void) | undefined;
let emitAttachmentImport: ((event: AttachmentImportEvent) => void) | undefined;
let emitUpdateStatus: ((status: UpdateStatus) => void) | undefined;

const BOTS: BotSummary[] = [
  {
    id: "chief",
    name: "Chief",
    role: "Chief of staff",
    description: "Coordinates work",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    avatarShape: "blob",
    avatarColor: "orange",
    threadId: "thread-chief",
    workspacePath: "/tmp/Markas/Bots/chief",
    preview: "No messages yet",
    updatedAt: null,
    access: "ask",
  },
  {
    id: "sales-outbound",
    name: "Sales Outbound",
    role: "Outbound specialist",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    avatarShape: "cloud",
    avatarColor: "violet",
    threadId: null,
    workspacePath: "/tmp/Markas/Bots/sales-outbound",
    preview: "No messages yet",
    updatedAt: null,
    access: "ask",
  },
];

/** Everything a person can read or hear inside `element`: its text and its labels. */
function readableText(element: Element): string {
  const parts = [element.textContent ?? ""];
  for (const node of [element, ...element.querySelectorAll("*")]) {
    for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
      const value = node.getAttribute(attribute);
      if (value) parts.push(value);
    }
  }
  return parts.join("\n");
}

async function confirmOnboardingModel(): Promise<void> {
  const trigger = await screen.findByRole("button", { name: "Onboarding model: Luna" });
  await fireEvent.click(trigger);
  const picker = screen.getByRole("dialog", { name: "Choose bot model" });
  await fireEvent.click(within(picker).getByRole("option", { name: "Luna, default" }));
  await screen.findByRole("listbox", { name: "What do you want me helping with most?" });
}

describe("Markas connected desktop shell", () => {
  beforeEach(() => {
    emitAgentEvent = undefined;
    emitAttachmentImport = undefined;
    emitUpdateStatus = undefined;
    setLanguage("en");
    window.localStorage.clear();
    Object.defineProperty(window, "markas", {
      configurable: true,
      value: {
        getAppInfo: vi
          .fn()
          .mockResolvedValue({ name: "Markas", version: "0.1.0", platform: "darwin" }),
        openExternal: vi.fn().mockResolvedValue(undefined),
        openUrl: vi.fn().mockResolvedValue(undefined),
        agent: {
          getStatus: vi.fn().mockResolvedValue({
            phase: "ready",
            cliVersion: "0.144.1",
            auth: { kind: "chatgpt", email: "user@example.com" },
            providers: [
              {
                id: "codex",
                state: "available",
                version: "0.144.1",
                message: null,
                email: "user@example.com",
              },
              {
                id: "claude",
                state: "available",
                version: "2.1.231",
                message: null,
                email: "claude@example.com",
              },
            ],
            capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
            message: null,
            fullAccess: true,
          }),
          getUsage: vi.fn().mockResolvedValue({
            limits: [
              {
                id: "codex",
                primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1_786_563_600 },
                secondary: {
                  usedPercent: 41,
                  windowDurationMins: 10_080,
                  resetsAt: 1_787_040_000,
                },
              },
            ],
          }),
          listModels: vi.fn().mockResolvedValue([
            {
              id: "gpt-5.6-luna",
              name: "Luna",
              description: "Fast and efficient for everyday agent work.",
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
            {
              id: "gpt-5.6-terra",
              name: "Terra",
              description: "Balanced speed and capability for involved tasks.",
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: ["medium", "high"],
            },
            {
              id: "gpt-5.6-sol",
              name: "Sol",
              description: "Most capable for complex, long-running work.",
              defaultReasoningEffort: "high",
              supportedReasoningEfforts: ["medium", "high", "xhigh"],
            },
            {
              id: "claude-opus-5",
              name: "Claude Opus 5",
              description: "Most capable Claude model for complex work.",
              defaultReasoningEffort: "high",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
            {
              id: "claude-sonnet-5",
              name: "Claude Sonnet 5",
              description: "Balanced Claude model for general agent work.",
              defaultReasoningEffort: "high",
              supportedReasoningEfforts: ["low", "medium", "high"],
            },
          ]),
          listBots: vi.fn().mockResolvedValue(BOTS),
          createBot: vi.fn().mockResolvedValue({ ...BOTS[0], id: "bot-new", name: "New bot" }),
          updateBot: vi.fn().mockImplementation(async (input) => ({
            ...BOTS.find((bot) => bot.id === input.botId),
            ...input,
          })),
          deleteBot: vi.fn().mockResolvedValue(undefined),
          restoreBot: vi
            .fn()
            .mockImplementation(async (botId) => BOTS.find((bot) => bot.id === botId)),
          readConversation: vi.fn().mockImplementation(async (botId) => ({
            botId,
            threadId: null,
            activeTurnId: null,
            revision: 0,
            messages: [],
          })),
          chooseAttachments: vi.fn().mockResolvedValue([]),
          onAttachmentImport: vi.fn((listener) => {
            emitAttachmentImport = listener;
            return () => undefined;
          }),
          discardDraftAttachment: vi.fn().mockResolvedValue(undefined),
          openAttachment: vi.fn().mockResolvedValue(undefined),
          sendMessage: vi.fn().mockResolvedValue({
            messageId: "message-1",
            deliveries: [
              { id: "delivery-1", recipientBotId: "chief", status: "queued", position: 1 },
            ],
          }),
          setMessageReaction: vi.fn().mockResolvedValue(undefined),
          listQueue: vi
            .fn()
            .mockImplementation(async (botId) => ({ botId, paused: false, deliveries: [] })),
          cancelQueuedMessage: vi.fn().mockResolvedValue(undefined),
          setQueuePaused: vi.fn().mockResolvedValue(undefined),
          interrupt: vi.fn().mockResolvedValue(undefined),
          respondToPrompt: vi.fn().mockResolvedValue(undefined),
          onEvent: vi.fn((listener) => {
            emitAgentEvent = listener;
            return () => undefined;
          }),
        },
        browser: {
          open: vi.fn().mockResolvedValue(undefined),
          activate: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          listTabs: vi.fn().mockResolvedValue([]),
          getControlState: vi.fn().mockResolvedValue({ sessions: [] }),
          setVisible: vi.fn().mockResolvedValue(undefined),
        },
        update: {
          getStatus: vi.fn().mockResolvedValue({
            phase: "idle",
            currentVersion: "0.1.0",
            availableVersion: null,
            progress: null,
            checkedAt: null,
            message: null,
          }),
          check: vi.fn().mockResolvedValue({
            phase: "up-to-date",
            currentVersion: "0.1.0",
            availableVersion: null,
            progress: null,
            checkedAt: "2026-08-12T22:00:00.000Z",
            message: null,
          }),
          download: vi.fn().mockResolvedValue({
            phase: "downloading",
            currentVersion: "0.1.0",
            availableVersion: "0.2.0",
            progress: 0,
            checkedAt: "2026-08-12T22:00:00.000Z",
            message: null,
          }),
          install: vi.fn().mockResolvedValue(undefined),
          onEvent: vi.fn((listener) => {
            emitUpdateStatus = listener;
            return () => undefined;
          }),
        },
        maintenance: {
          exportData: vi.fn().mockResolvedValue({ saved: true }),
          exportDiagnostics: vi.fn().mockResolvedValue({ saved: true }),
        },
      },
    });
  });

  it("opens Switchboard from the account menu, where engines are set up", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Engines" }));

    await waitFor(() => expect(openAreaRequest()?.area).toBe("switchboard"));
    expect(screen.queryByRole("menuitem", { name: "Engines" })).not.toBeInTheDocument();
  });

  it("opens the create-bot picker for a new user with no bots", async () => {
    vi.mocked(window.markas.agent.listBots).mockResolvedValueOnce([]);
    render(() => <App />);

    expect(await screen.findByRole("option", { name: "Create new bot" })).toBeInTheDocument();
    expect(screen.getByText("No bots yet")).toBeInTheDocument();
  });

  it("uses the backend bot list and shows local onboarding for a real empty snapshot", async () => {
    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Chief" })).toBeInTheDocument();
    expect(await screen.findByText("Choose a model to get started.")).toBeInTheDocument();
    expect(
      screen.queryByRole("listbox", { name: "What do you want me helping with most?" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message Chief")).toHaveAttribute("contenteditable", "false");
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    await confirmOnboardingModel();
    expect(
      screen.getByRole("listbox", { name: "What do you want me helping with most?" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message Chief")).toHaveAttribute("contenteditable", "true");
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(screen.queryByText(/Salesforce account queue/i)).not.toBeInTheDocument();
  });

  it("asks no first-time questions of a bot that was made in full", async () => {
    const [chief, ...others] = BOTS;
    if (!chief) throw new Error("The test needs a bot.");
    vi.mocked(window.markas.agent.listBots).mockResolvedValueOnce([
      { ...chief, madeInFull: true },
      ...others,
    ]);
    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Chief" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Message Chief")).toHaveAttribute("contenteditable", "true"),
    );
    expect(screen.queryByText("Choose a model to get started.")).not.toBeInTheDocument();
  });

  it("guides signed-out users before enabling chat", async () => {
    vi.mocked(window.markas.agent.getStatus).mockResolvedValueOnce({
      phase: "blocked",
      cliVersion: "0.144.1",
      auth: { kind: "signed-out" },
      capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
      message: "Run `codex login`, then restart Markas.",
      fullAccess: true,
    });
    render(() => <App />);

    expect(await screen.findByText("Engine setup required")).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: /helping with most/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message Chief")).toHaveAttribute("contenteditable", "false");
    // The way forward is Switchboard, which says how to sign the engine in.
    fireEvent.click(screen.getByRole("button", { name: "Open Switchboard" }));
    await waitFor(() => expect(openAreaRequest()?.area).toBe("switchboard"));
    expect(window.markas.openExternal).not.toHaveBeenCalled();
  });

  it("shows a compact account menu with weekly usage and contact actions", async () => {
    render(() => <App />);
    const accountButton = await screen.findByRole("button", { name: "Open account menu" });
    expect(accountButton).toHaveTextContent("user@example.com");

    fireEvent.click(accountButton);
    await waitFor(() => expect(window.markas.agent.getUsage).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Weekly usage")).toBeInTheDocument();
    expect(screen.getByText("59%")).toBeInTheDocument();
    expect(screen.queryByText(/ChatGPT Pro/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Developer preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lifetime/i)).not.toBeInTheDocument();

    expect(screen.queryByRole("menuitem", { name: "Export data" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Export diagnostics" })).not.toBeInTheDocument();

    // Markas has no hosted feedback or message page, so the menu offers neither.
    expect(screen.queryByRole("menuitem", { name: "Send feedback" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Message" })).not.toBeInTheDocument();
  });

  it("shows an available update, downloads it, and exposes restart to install", async () => {
    vi.mocked(window.markas.update.getStatus).mockResolvedValueOnce({
      phase: "available",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      progress: null,
      checkedAt: "2026-08-12T22:00:00.000Z",
      message: null,
    });
    render(() => <App />);

    expect(await screen.findByText("Update")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Download update/ }));
    await waitFor(() => expect(window.markas.update.download).toHaveBeenCalledOnce());

    emitUpdateStatus?.({
      phase: "ready",
      currentVersion: "0.1.0",
      availableVersion: "0.2.0",
      progress: 100,
      checkedAt: "2026-08-12T22:00:00.000Z",
      message: null,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Restart to update/ }));
    await waitFor(() => expect(window.markas.update.install).toHaveBeenCalledOnce());
  });

  it("renders loaded history without replaying entrance animations", async () => {
    vi.mocked(window.markas.agent.readConversation).mockResolvedValueOnce({
      botId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages: [
        {
          id: "stored-message",
          author: "assistant",
          text: "Already in history",
          createdAt: "2026-08-12T09:00:00.000Z",
          status: "completed",
        },
      ],
    });
    render(() => <App />);
    const stored = await screen.findByText("Already in history");
    expect(stored.closest(".message-entry")).not.toHaveClass("message-entry-animated");
  });

  it("renders message links and opens them in the embedded browser", async () => {
    vi.mocked(window.markas.agent.readConversation).mockResolvedValueOnce({
      botId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages: [
        {
          id: "linked-message",
          author: "assistant",
          text: "Read [Meta](https://about.fb.com/news/) or https://example.com/report.",
          createdAt: "2026-08-12T09:00:00.000Z",
          status: "completed",
        },
      ],
    });
    render(() => <App />);
    const metaLink = await screen.findByRole("link", { name: "Meta" });
    expect(metaLink).toHaveAttribute("href", "https://about.fb.com/news/");
    expect(metaLink.querySelector("img")).toHaveAttribute(
      "src",
      "https://about.fb.com/favicon.ico",
    );
    expect(screen.getByRole("link", { name: "https://example.com/report" })).toHaveAttribute(
      "href",
      "https://example.com/report",
    );
    expect(screen.queryByText("https://about.fb.com/news/")).not.toBeInTheDocument();

    await fireEvent.click(metaLink);
    expect(window.markas.openUrl).toHaveBeenCalledWith("https://about.fb.com/news/");
    expect(window.markas.browser.open).not.toHaveBeenCalled();
  });

  it("refreshes stored history when Codex becomes ready after the window opens", async () => {
    vi.mocked(window.markas.agent.getStatus).mockResolvedValue({
      phase: "starting",
      cliVersion: "0.144.1",
      auth: { kind: "unknown" },
      capabilities: { chat: "unavailable", browser: "ready", computerUse: "unavailable" },
      message: "Starting local Codex…",
      fullAccess: true,
    });
    vi.mocked(window.markas.agent.readConversation)
      .mockResolvedValueOnce({
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 0,
        messages: [],
      })
      .mockResolvedValueOnce({
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "restored-answer",
            author: "assistant",
            text: "Restored after Codex became ready",
            createdAt: "2026-08-12T10:00:00.000Z",
            status: "completed",
          },
        ],
      });

    render(() => <App />);
    await screen.findByText("Connecting to engines…");
    emitAgentEvent?.({
      type: "status",
      status: {
        phase: "ready",
        cliVersion: "0.144.1",
        auth: { kind: "chatgpt", email: "user@example.com" },
        capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
        message: null,
        fullAccess: true,
      },
    });

    expect(await screen.findByText("Restored after Codex became ready")).toBeInTheDocument();
    expect(window.markas.agent.readConversation).toHaveBeenCalledTimes(2);

    // A status change that leaves the phase as it is does not read the chat again: reading a
    // chat can look for the bot's engine, which reports status, and that made a loop.
    for (const state of ["checking", "not-installed", "checking"] as const) {
      emitAgentEvent?.({
        type: "status",
        status: {
          phase: "ready",
          cliVersion: "0.144.1",
          auth: { kind: "chatgpt", email: "user@example.com" },
          providers: [{ id: "claude", state, version: null, message: null }],
          capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
          message: null,
          fullAccess: true,
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.markas.agent.readConversation).toHaveBeenCalledTimes(2);
  });

  it("filters and switches backend bots", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await screen.findByRole("button", { name: "Onboarding model: Luna" });
    const search = screen.getByRole("searchbox", { name: "Search chats" });
    await fireEvent.input(search, { target: { value: "Sales" } });
    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    expect(screen.getByRole("heading", { name: "Sales Outbound" })).toBeInTheDocument();
  });

  it("shows the specialty question immediately after creating a new bot", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(screen.getByRole("button", { name: "New bot" }));
    await fireEvent.click(screen.getByRole("option", { name: "Create new bot" }));

    expect(await screen.findByRole("heading", { name: "New bot" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Bot settings" })).not.toBeInTheDocument();
    expect(
      await screen.findByRole("listbox", { name: "What do you want me helping with most?" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Message New bot")).toHaveAttribute("contenteditable", "true");
  });

  it("resizes and persists the left and right side panels", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    const leftResizer = screen.getByRole("separator", { name: "Resize left sidebar" });
    await fireEvent.keyDown(leftResizer, { key: "ArrowRight" });
    expect(leftResizer).toHaveAttribute("aria-valuenow", "287");
    expect(leftResizer.closest(".app-frame")).toHaveStyle("--left-panel-width: 287px");
    expect(window.localStorage.getItem("markas:left-panel-width")).toBe("287");

    await fireEvent.click(screen.getByRole("button", { name: "View bot settings" }));
    const rightResizer = screen.getByRole("separator", { name: "Resize right panel" });
    await fireEvent.keyDown(rightResizer, { key: "ArrowLeft" });
    expect(rightResizer).toHaveAttribute("aria-valuenow", "308");
    expect(screen.getByRole("main", { name: "Conversation" })).toHaveStyle(
      "--settings-panel-width: 308px",
    );
    expect(window.localStorage.getItem("markas:settings-panel-width")).toBe("308");

    await fireEvent.dblClick(rightResizer);
    expect(rightResizer).toHaveAttribute("aria-valuenow", "296");

    await fireEvent.keyDown(rightResizer, { key: "Home" });
    expect(rightResizer).toHaveAttribute("aria-valuenow", "180");
    await fireEvent.keyDown(rightResizer, { key: "End" });
    expect(rightResizer).toHaveAttribute(
      "aria-valuenow",
      String(Math.min(1600, window.innerWidth - 96)),
    );
  });

  it("selects a provider and model from the conversation header", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    const trigger = screen.getByRole("button", { name: "Bot model: Luna" });
    expect(trigger.querySelector(".provider-model-mark-codex")).toBeInTheDocument();
    await fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Choose bot model" });
    expect(within(picker).getByText("0.144.1 (Codex CLI)")).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Luna, default" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    expect(window.markas.agent.updateBot).not.toHaveBeenCalled();
    expect(within(picker).getByText("2.1.231 (Claude Code)")).toBeInTheDocument();
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5, default" }));

    await waitFor(() =>
      expect(window.markas.agent.updateBot).toHaveBeenCalledWith({
        botId: "chief",
        model: "claude-opus-5",
        reasoningEffort: "medium",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Choose bot model" })).not.toBeInTheDocument();
    const claudeTrigger = await screen.findByRole("button", {
      name: "Bot model: Claude Opus 5",
    });
    expect(claudeTrigger).toBeEnabled();
    expect(claudeTrigger.querySelector(".provider-model-mark-claude")).toBeInTheDocument();
    expect(claudeTrigger.querySelector(".provider-model-mark-codex")).not.toBeInTheDocument();
  });

  it("shows unavailable providers without allowing their models", async () => {
    vi.mocked(window.markas.agent.getStatus).mockResolvedValueOnce({
      phase: "ready",
      cliVersion: "0.144.1",
      auth: { kind: "chatgpt", email: "user@example.com" },
      providers: [
        { id: "codex", state: "available", version: "0.144.1", message: null },
        {
          id: "claude",
          state: "not-installed",
          version: null,
          message: "Claude CLI was not found.",
        },
      ],
      capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
      message: null,
      fullAccess: true,
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(screen.getByRole("button", { name: "Bot model: Luna" }));
    const picker = screen.getByRole("dialog", { name: "Choose bot model" });
    await fireEvent.click(
      within(picker).getByRole("tab", { name: /Claude: Claude CLI was not found/ }),
    );
    expect(within(picker).getByText("Claude CLI was not found.")).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Claude Opus 5, default" })).toBeDisabled();
    expect(window.markas.agent.updateBot).not.toHaveBeenCalled();
  });

  it("rolls back a failed header model change and reports the error", async () => {
    vi.mocked(window.markas.agent.updateBot).mockRejectedValueOnce(new Error("Provider failed"));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await screen.findByRole("button", { name: "Onboarding model: Luna" });

    await fireEvent.click(screen.getByRole("button", { name: "Bot model: Luna" }));
    await fireEvent.click(screen.getByRole("option", { name: "Sol" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not change model. Try again.",
    );
    expect(screen.getByRole("button", { name: "Bot model: Luna" })).toBeEnabled();
    expect(
      screen.queryByRole("listbox", { name: "What do you want me helping with most?" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message Chief")).toHaveAttribute("contenteditable", "false");
  });

  it("locks the header model picker during active work", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const trigger = screen.getByRole("button", { name: "Bot model: Luna" });

    emitAgentEvent?.({
      type: "turn-started",
      botId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
    });
    await waitFor(() => expect(trigger).toBeDisabled());
    expect(trigger).toHaveAttribute(
      "title",
      "Wait for the current work to finish before changing models.",
    );

    emitAgentEvent?.({
      type: "turn-completed",
      botId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
      status: "completed",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
  });

  it("supports picker keyboard navigation and outside dismissal", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const trigger = screen.getByRole("button", { name: "Bot model: Luna" });

    await fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Choose bot model" });
    const codex = within(picker).getByRole("tab", { name: /^Codex:/ });
    await fireEvent.keyDown(codex, { key: "ArrowUp" });
    const claude = within(picker).getByRole("tab", { name: /^Claude:/ });
    expect(claude).toHaveFocus();
    expect(claude).toHaveAttribute("aria-selected", "true");

    await fireEvent.keyDown(picker, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose bot model" })).not.toBeInTheDocument();
    await fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Choose bot model" })).toBeInTheDocument();
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Choose bot model" })).not.toBeInTheDocument();
  });

  it("edits the persisted model and thinking level in bot settings", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "View bot settings" }));

    const settings = screen.getByRole("complementary", { name: "Bot settings" });
    const thinking = within(settings).getByRole("combobox", { name: "Bot reasoning level" });
    expect(within(settings).getByRole("button", { name: "Bot model: Luna" })).toBeEnabled();
    expect(thinking).toHaveValue("medium");

    await fireEvent.click(within(settings).getByRole("button", { name: "Bot model: Luna" }));
    let picker = within(settings).getByRole("dialog", { name: "Choose bot model" });
    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5, default" }));
    await waitFor(() =>
      expect(window.markas.agent.updateBot).toHaveBeenCalledWith({
        botId: "chief",
        model: "claude-opus-5",
        reasoningEffort: "medium",
      }),
    );
    expect(
      within(settings).getByRole("button", { name: "Bot model: Claude Opus 5" }),
    ).toBeEnabled();

    await fireEvent.click(
      within(settings).getByRole("button", { name: "Bot model: Claude Opus 5" }),
    );
    picker = within(settings).getByRole("dialog", { name: "Choose bot model" });
    await fireEvent.click(within(picker).getByRole("tab", { name: /^Codex:/ }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Sol" }));
    await fireEvent.change(thinking, { target: { value: "xhigh" } });
    await waitFor(() =>
      expect(window.markas.agent.updateBot).toHaveBeenLastCalledWith({
        botId: "chief",
        reasoningEffort: "xhigh",
      }),
    );
  });

  it("keeps provider choices separate for each bot profile", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "View bot settings" }));
    let settings = screen.getByRole("complementary", { name: "Bot settings" });
    await fireEvent.click(within(settings).getByRole("button", { name: "Bot model: Luna" }));
    let picker = within(settings).getByRole("dialog", { name: "Choose bot model" });
    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5, default" }));

    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    await fireEvent.click(screen.getByRole("button", { name: "View bot settings" }));
    settings = screen.getByRole("complementary", { name: "Bot settings" });
    expect(within(settings).getByRole("button", { name: "Bot model: Luna" })).toBeEnabled();

    await fireEvent.click(within(settings).getByRole("button", { name: "Bot model: Luna" }));
    picker = within(settings).getByRole("dialog", { name: "Choose bot model" });
    await fireEvent.click(within(picker).getByRole("tab", { name: /^Claude:/ }));
    await fireEvent.click(within(picker).getByRole("option", { name: "Claude Opus 5, default" }));
    await waitFor(() =>
      expect(window.markas.agent.updateBot).toHaveBeenCalledWith({
        botId: "sales-outbound",
        model: "claude-opus-5",
        reasoningEffort: "medium",
      }),
    );
  });

  it("shows provider availability during onboarding", async () => {
    vi.mocked(window.markas.agent.getStatus).mockResolvedValueOnce({
      phase: "ready",
      cliVersion: "0.144.1",
      auth: { kind: "chatgpt", email: "user@example.com" },
      providers: [
        { id: "codex", state: "available", version: "0.144.1", message: null },
        {
          id: "claude",
          state: "not-installed",
          version: null,
          message: "Claude CLI was not found.",
        },
      ],
      capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
      message: null,
      fullAccess: true,
    });
    render(() => <App />);

    const trigger = await screen.findByRole("button", { name: "Onboarding model: Luna" });
    await fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Choose bot model" });
    expect(within(picker).getByRole("tab", { name: /^Codex: 0.144.1/ })).toBeEnabled();
    const claude = within(picker).getByRole("tab", {
      name: "Claude: Claude CLI was not found.",
    });
    expect(claude).toBeEnabled();

    await fireEvent.click(claude);
    expect(within(picker).getByText("Claude CLI was not found.")).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Claude Opus 5, default" })).toBeDisabled();
  });

  it("does not remount settings or discard an in-progress edit on bot list refresh", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "View bot settings" }));
    const name = screen.getByRole("textbox", { name: "Bot name" });
    await fireEvent.input(name, { target: { value: "Draft coordinator name" } });

    emitAgentEvent?.({
      type: "bots-changed",
      bots: BOTS.map((bot) =>
        bot.id === "chief" ? { ...bot, preview: "A new backend preview" } : bot,
      ),
    });

    expect(screen.getByRole("textbox", { name: "Bot name" })).toHaveValue("Draft coordinator name");
  });

  it("fully hides and restores the left sidebar without losing its width", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    const frame = screen.getByRole("main", { name: "Conversation" }).closest(".app-frame");
    const sidebarToggle = screen.getByRole("button", { name: "Hide sidebar" });
    expect(sidebarToggle).toHaveClass("sidebar-icon-button");
    expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");
    await fireEvent.click(sidebarToggle);

    expect(screen.queryByRole("complementary", { name: "Bot navigation" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize left sidebar" }),
    ).not.toBeInTheDocument();
    expect(frame).toHaveClass("app-frame-sidebar-collapsed");
    expect(frame).toHaveStyle("--left-panel-width: 0px");
    expect(window.localStorage.getItem("markas:left-panel-collapsed")).toBe("true");
    const restoreSidebar = screen.getByRole("button", { name: "Show sidebar" });
    expect(restoreSidebar).toHaveClass("sidebar-icon-button");
    expect(restoreSidebar).toHaveAttribute("aria-expanded", "false");

    await fireEvent.click(restoreSidebar);

    expect(screen.getByRole("complementary", { name: "Bot navigation" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize left sidebar" })).toHaveAttribute(
      "aria-valuenow",
      "275",
    );
    expect(frame).not.toHaveClass("app-frame-sidebar-collapsed");
    expect(window.localStorage.getItem("markas:left-panel-collapsed")).toBe("false");
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("shows a stable indicator while a bot controls the embedded browser", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [
        {
          id: "tab-1",
          title: "Local smoke page",
          url: "http://127.0.0.1:4321",
          loading: false,
          ownerThreadId: "thread-chief",
          ownerBotId: "chief",
        },
        {
          id: "tab-2",
          title: "Second page",
          url: "https://example.com/second",
          loading: false,
          ownerThreadId: "thread-chief",
          ownerBotId: "chief",
        },
        {
          id: "tab-3",
          title: "Third page",
          url: "https://example.com/third",
          loading: false,
          ownerThreadId: "thread-chief",
          ownerBotId: "chief",
        },
      ],
      activeTabId: "tab-1",
    });
    emitAgentEvent?.({
      type: "browser-control-changed",
      state: {
        sessions: [
          {
            id: "thread-chief:turn-1",
            threadId: "thread-chief",
            turnId: "turn-1",
            callId: "call-1",
            tabId: null,
            action: "type",
            phase: "acting",
            startedAt: "2026-08-12T10:00:00.000Z",
          },
        ],
      },
    });

    const controlledTab = await screen.findByRole("tab", {
      name: "Local smoke page, controlled by Chief",
    });
    expect(controlledTab.closest(".browser-tab-wrap")).toHaveClass("browser-tab-controlled");
    expect(screen.getByRole("complementary", { name: "Browser" })).toHaveClass(
      "browser-panel-controlled",
    );
    const browserTabStrip = document.querySelector(".browser-tab-strip");
    expect(browserTabStrip?.querySelectorAll(".browser-tab-wrap")).toHaveLength(3);
    expect(browserTabStrip?.lastElementChild).toBe(
      screen.getByRole("button", { name: "New browser tab" }),
    );
    expect(screen.queryByRole("button", { name: "Hide browser panel" })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "New browser tab" }));
    expect(window.markas.browser.open).toHaveBeenCalledWith({
      url: "https://www.google.com",
      ownerThreadId: "thread-chief",
      ownerBotId: "chief",
    });
    expect(screen.queryByText("Typing…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Chief is controlling the browser" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Chief is controlling the browser" })).toHaveClass(
      "header-panel-toggle",
    );

    emitAgentEvent?.({
      type: "browser-control-changed",
      state: {
        sessions: [
          {
            id: "thread-chief:turn-1",
            threadId: "thread-chief",
            turnId: "turn-1",
            callId: "call-1",
            tabId: "tab-1",
            action: "type",
            phase: "waiting",
            startedAt: "2026-08-12T10:00:00.000Z",
          },
        ],
      },
    });
    expect(screen.getByRole("tab", { name: "Local smoke page, controlled by Chief" })).toBe(
      controlledTab,
    );

    emitAgentEvent?.({ type: "browser-control-changed", state: { sessions: [] } });
    await waitFor(() =>
      expect(
        screen.queryByRole("tab", { name: "Local smoke page, controlled by Chief" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: "Local smoke page" })).toBe(controlledTab);
    expect(controlledTab.closest(".browser-tab-wrap")).not.toHaveClass("browser-tab-controlled");
    expect(screen.getByRole("complementary", { name: "Browser" })).not.toHaveClass(
      "browser-panel-controlled",
    );
  });

  it("updates embedded browser bounds when the window moves browser surface", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "browser-changed",
      tabs: [
        {
          id: "tab-resize",
          title: "Resize test",
          url: "https://example.com",
          loading: false,
          ownerThreadId: "thread-chief",
          ownerBotId: "chief",
        },
      ],
      activeTabId: "tab-resize",
    });
    await fireEvent.click(screen.getByRole("button", { name: "Open computer" }));
    const surface = document.querySelector(".browser-surface");
    if (!(surface instanceof HTMLElement)) throw new Error("Browser surface was not rendered.");
    await waitFor(() =>
      expect(window.markas.browser.setVisible).toHaveBeenCalledWith(
        expect.objectContaining({ visible: true }),
      ),
    );
    vi.mocked(window.markas.browser.setVisible).mockClear();
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      x: 640,
      y: 73,
      width: 380,
      height: 600,
      top: 73,
      right: 1020,
      bottom: 673,
      left: 640,
      toJSON: () => ({}),
    });

    window.dispatchEvent(new Event("resize"));

    await waitFor(() =>
      expect(window.markas.browser.setVisible).toHaveBeenLastCalledWith({
        visible: true,
        bounds: { x: 640, y: 73, width: 380, height: 600 },
      }),
    );
  });

  it("closes settings on bot switch but restores browser panels", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });

    await fireEvent.click(screen.getByRole("button", { name: "View bot settings" }));
    expect(screen.getByRole("complementary", { name: "Bot settings" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    expect(screen.queryByRole("complementary", { name: "Bot settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open computer" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Open computer" }));
    expect(screen.getByRole("complementary", { name: "Browser" })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    expect(screen.queryByRole("complementary", { name: "Bot settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Browser" })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    expect(screen.getByRole("complementary", { name: "Browser" })).toBeInTheDocument();
  });

  it("says why an address could not be opened in the browser panel", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.click(screen.getByRole("button", { name: "Open computer" }));
    const panel = screen.getByRole("complementary", { name: "Browser" });
    vi.mocked(window.markas.browser.open).mockRejectedValueOnce(
      new Error("The bot's browser is not running."),
    );
    const address = within(panel).getByRole("textbox", { name: "Browser address" });
    await fireEvent.input(address, { target: { value: "example.test" } });
    await fireEvent.submit(address.closest("form") as HTMLFormElement);
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "That address could not be opened. The bot's browser is not running.",
    );
    // Typing a new address clears the old complaint.
    await fireEvent.input(address, { target: { value: "example.test/again" } });
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("queues from the composer and clears only after success", async () => {
    render(() => <App />);
    await confirmOnboardingModel();
    const composer = await screen.findByRole("textbox", { name: "Message Chief" });
    composer.textContent = "Run this Monday";
    await fireEvent.input(composer);
    await fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(window.markas.agent.sendMessage).toHaveBeenCalledWith({
        botId: "chief",
        text: "Run this Monday",
        attachmentDraftIds: [],
      }),
    );
    await waitFor(() => expect(composer).toHaveTextContent(""));
  });

  it("shows the first queued message and closes onboarding when the send event arrives", async () => {
    vi.mocked(window.markas.agent.sendMessage).mockImplementationOnce(async (input) => {
      emitAgentEvent?.({
        type: "conversation",
        snapshot: {
          botId: input.botId,
          threadId: "thread-chief",
          activeTurnId: null,
          revision: 1,
          messages: [
            {
              id: "delivery-visible",
              author: "user",
              text: input.text,
              createdAt: "2026-08-14T12:00:00.000Z",
              status: "completed",
              delivery: { id: "delivery-visible", status: "queued", position: 1 },
            },
          ],
        },
      });
      return {
        messageId: "message-visible",
        deliveries: [
          { id: "delivery-visible", recipientBotId: input.botId, status: "queued", position: 1 },
        ],
      };
    });

    render(() => <App />);
    await confirmOnboardingModel();
    const composer = await screen.findByRole("textbox", { name: "Message Chief" });
    composer.textContent = "Show this message";
    await fireEvent.input(composer);
    await fireEvent.keyDown(composer, { key: "Enter" });

    expect(
      await screen.findByText("Show this message", { selector: ".message-copy" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Choose a model to get started.")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("listbox", { name: "What do you want me helping with most?" }),
      ).not.toBeInTheDocument();
    });
  });

  it("replies to a message through the composer and keeps the reference in the queued input", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "assistant-1",
            author: "assistant",
            text: "Should I prepare the report?",
            createdAt: "2026-08-12T10:00:00.000Z",
            status: "completed",
          },
        ],
      },
    });

    await screen.findByText("Should I prepare the report?");
    await fireEvent.click(screen.getByRole("button", { name: "Reply to bot message" }));
    expect(screen.getByText("Replying to the bot")).toBeInTheDocument();

    const composer = screen.getByRole("textbox", { name: "Message Chief" });
    composer.textContent = "Yes, today please";
    await fireEvent.input(composer);
    await fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(window.markas.agent.sendMessage).toHaveBeenCalledWith({
        botId: "chief",
        text: "Yes, today please",
        attachmentDraftIds: [],
        replyToMessageId: "assistant-1",
      }),
    );
    await waitFor(() => expect(screen.queryByText("Replying to the bot")).not.toBeInTheDocument());
  });

  it("reacts and copies from bot hover actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "assistant-actions",
            author: "assistant",
            text: "Ready to ship.",
            createdAt: "2026-08-12T10:00:00.000Z",
            status: "completed",
          },
        ],
      },
    });

    await screen.findByText("Ready to ship.");
    await fireEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await fireEvent.click(screen.getByRole("menuitemradio", { name: "React with ❤️" }));
    expect(window.markas.agent.setMessageReaction).toHaveBeenCalledWith({
      botId: "chief",
      messageId: "assistant-actions",
      emoji: "❤️",
    });

    await fireEvent.click(screen.getByRole("button", { name: "More message actions" }));
    await fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Ready to ship."));
  });

  it("shows bot activity without replaying existing message entrances", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const createdAt = "2026-08-12T10:00:00.000Z";
    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "delivery-live",
            author: "user",
            text: "Do the work",
            createdAt,
            status: "completed",
            delivery: { id: "delivery-live", status: "queued", position: 1 },
          },
        ],
      },
    });
    const firstMessage = await screen.findByText("Do the work");
    const firstMessageEntry = firstMessage.closest(".message-entry");
    expect(firstMessageEntry).not.toHaveClass("message-entry-animated");

    emitAgentEvent?.({
      type: "turn-started",
      botId: "chief",
      threadId: "thread-chief",
      turnId: "turn-live",
    });
    const workingIndicator = await screen.findByRole("status", { name: "Chief is working" });

    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: "turn-live",
        revision: 2,
        messages: [
          {
            id: "delivery-live",
            author: "user",
            text: "Do the work",
            createdAt,
            status: "completed",
            delivery: { id: "delivery-live", status: "running", position: null },
          },
        ],
      },
    });
    expect(screen.getByText("Do the work").closest(".message-entry")).toBe(firstMessageEntry);
    expect(screen.getByText("Do the work").closest(".user-bubble")).not.toHaveTextContent(
      "Working",
    );

    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: "turn-live",
        revision: 3,
        messages: [
          {
            id: "delivery-live",
            author: "user",
            text: "Do the work",
            createdAt,
            status: "completed",
            delivery: { id: "delivery-live", status: "running", position: null },
          },
          {
            id: "assistant-live",
            author: "assistant",
            text: "I am on it",
            createdAt: "2026-08-12T10:00:01.000Z",
            status: "streaming",
          },
        ],
      },
    });
    const streamingAnswer = await screen.findByText("I am on it");
    const streamingBubble = streamingAnswer.closest(".bot-bubble");
    expect(streamingAnswer.closest(".message-entry")).toHaveClass("message-entry-animated");
    expect(streamingBubble).toHaveClass("bot-bubble-streaming");
    expect(screen.queryByText("Typing…")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Chief is working" })).toBe(workingIndicator);

    emitAgentEvent?.({
      type: "conversation-delta",
      botId: "chief",
      threadId: "thread-chief",
      turnId: "turn-live",
      messageId: "assistant-live",
      delta: " now",
      createdAt: "2026-08-12T10:00:01.000Z",
      revision: 4,
    });
    const updatedStreamingAnswer = await screen.findByText("I am on it now");
    expect(updatedStreamingAnswer.closest(".bot-bubble")).toBe(streamingBubble);
    expect(screen.getByText("Do the work").closest(".message-entry")).toBe(firstMessageEntry);
    expect(screen.getByRole("status", { name: "Chief is working" })).toBe(workingIndicator);

    for (const [revision, text] of [
      [5, "I am on it now, first buffered delta"],
      [6, "I am on it now, final buffered delta"],
    ] as const) {
      emitAgentEvent?.({
        type: "conversation",
        snapshot: {
          botId: "chief",
          threadId: "thread-chief",
          activeTurnId: "turn-live",
          revision,
          messages: [
            {
              id: "delivery-live",
              author: "user",
              text: "Do the work",
              createdAt,
              status: "completed",
              delivery: { id: "delivery-live", status: "running", position: null },
            },
            {
              id: "assistant-live",
              author: "assistant",
              text,
              createdAt: "2026-08-12T10:00:01.000Z",
              status: "streaming",
            },
          ],
        },
      });
    }
    const bufferedAnswer = await screen.findByText("I am on it now, final buffered delta");
    expect(bufferedAnswer.closest(".bot-bubble")).toBe(streamingBubble);
    expect(screen.queryByText("I am on it now, first buffered delta")).not.toBeInTheDocument();

    emitAgentEvent?.({
      type: "turn-completed",
      botId: "chief",
      threadId: "thread-chief",
      turnId: "turn-live",
      status: "completed",
    });
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Chief is working" })).not.toBeInTheDocument(),
    );
    expect(document.querySelector(".agent-activity-entry")).toBe(workingIndicator);
    expect(workingIndicator).toHaveAttribute("aria-hidden", "true");
  });

  it("groups commentary into a collapsed thinking disclosure", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "user-open",
            turnId: "turn-open",
            author: "user",
            text: "Open x.com",
            createdAt: "2026-08-12T10:00:00.000Z",
            status: "completed",
          },
          {
            id: "commentary-open",
            turnId: "turn-open",
            author: "assistant",
            text: "I’ll open x.com in the Markas browser.",
            createdAt: "2026-08-12T10:00:01.000Z",
            status: "completed",
            itemType: "commentary",
          },
          {
            id: "commentary-check",
            turnId: "turn-open",
            author: "assistant",
            text: "Checking that the page loaded.",
            createdAt: "2026-08-12T10:00:02.000Z",
            status: "completed",
            itemType: "commentary",
          },
          {
            id: "answer-open",
            turnId: "turn-open",
            author: "assistant",
            text: "Opened x.com.",
            createdAt: "2026-08-12T10:00:03.000Z",
            status: "completed",
            itemType: "final_answer",
          },
        ],
      },
    });

    const thinkingLabel = await screen.findByText("Thinking");
    const details = thinkingLabel.closest("details");
    expect(screen.getByText("I’ll open x.com in the Markas browser.")).not.toBeVisible();
    expect(screen.getByText("Checking that the page loaded.")).not.toBeVisible();
    expect(screen.getByText("Opened x.com.")).toBeVisible();
    expect(screen.getAllByText("Thinking")).toHaveLength(1);

    await fireEvent.click(thinkingLabel);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("I’ll open x.com in the Markas browser.")).toBeVisible();

    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 2,
        messages: [
          {
            id: "user-open",
            turnId: "turn-open",
            author: "user",
            text: "Open x.com",
            createdAt: "2026-08-12T10:00:00.000Z",
            status: "completed",
          },
          {
            id: "answer-open",
            turnId: "turn-open",
            author: "assistant",
            text: "Opened x.com.",
            createdAt: "2026-08-12T10:00:03.000Z",
            status: "completed",
            itemType: "final_answer",
          },
        ],
      },
    });
    await waitFor(() => expect(screen.getByText("Thinking").closest("details")).toBe(details));
    expect(screen.getByText("I’ll open x.com in the Markas browser.")).toBeVisible();
  });

  it("keeps text and attachments when enqueue fails", async () => {
    vi.mocked(window.markas.agent.sendMessage).mockRejectedValueOnce(
      new Error("Mailbox unavailable"),
    );
    render(() => <App />);
    await confirmOnboardingModel();
    const composer = await screen.findByRole("textbox", { name: "Message Chief" });
    composer.textContent = "Retry me";
    await fireEvent.input(composer);
    await fireEvent.keyDown(composer, { key: "Enter" });
    expect(await screen.findByText("Mailbox unavailable")).toBeInTheDocument();
    expect(composer).toHaveTextContent("Retry me");
  });

  it("supports picker and attachment-only messages", async () => {
    vi.mocked(window.markas.agent.chooseAttachments).mockResolvedValueOnce([
      attachment("draft-1", "brief.pdf", "pdf"),
    ]);
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    await fireEvent.click(screen.getByRole("button", { name: "Attach a file" }));
    await fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    expect(await screen.findByText("brief.pdf")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(window.markas.agent.sendMessage).toHaveBeenCalledWith({
        botId: "chief",
        text: "",
        attachmentDraftIds: ["draft-1"],
      }),
    );
  });

  it("adds pathless pasted images reported by preload", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAttachmentImport?.({ type: "started", requestId: "paste-1" });
    emitAttachmentImport?.({
      type: "completed",
      requestId: "paste-1",
      attachments: [attachment("pasted-1", "pasted.png", "image")],
    });
    expect(await screen.findByText("pasted.png")).toBeInTheDocument();
  });

  it("keeps an asynchronous pasted attachment with the bot that received the paste", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAttachmentImport?.({ type: "started", requestId: "paste-switch" });
    await fireEvent.click(screen.getByRole("button", { name: /Sales Outbound/ }));
    emitAttachmentImport?.({
      type: "completed",
      requestId: "paste-switch",
      attachments: [attachment("pasted-switch", "for-chief.png", "image")],
    });

    expect(screen.queryByText("for-chief.png")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /Chief/ }));
    expect(await screen.findByText("for-chief.png")).toBeInTheDocument();
  });

  it("shows and controls queued work", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "queue-changed",
      snapshot: {
        botId: "chief",
        paused: true,
        deliveries: [
          {
            id: "delivery-1",
            messageId: "message-1",
            recipientBotId: "chief",
            sender: { kind: "user" },
            text: "Later",
            attachments: [],
            replyToMessageId: null,
            status: "queued",
            position: 1,
            turnId: null,
            error: null,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Resume queue" }));
    emitAgentEvent?.({
      type: "queue-changed",
      snapshot: {
        botId: "chief",
        paused: true,
        deliveries: [
          {
            id: "delivery-1",
            messageId: "message-1",
            recipientBotId: "chief",
            sender: { kind: "user" },
            text: "Later",
            attachments: [],
            replyToMessageId: null,
            status: "queued",
            position: 1,
            turnId: null,
            error: null,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "Cancel queued message 1" }));
    expect(window.markas.agent.cancelQueuedMessage).toHaveBeenCalled();
    expect(window.markas.agent.setQueuePaused).toHaveBeenCalledWith({
      botId: "chief",
      paused: false,
    });
  });

  it("persists the onboarding focus before queuing the first user message", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    await fireEvent.click(screen.getByRole("option", { name: /Work & projects/ }));
    await waitFor(() =>
      expect(window.markas.agent.updateBot).toHaveBeenCalledWith({
        botId: "chief",
        role: "Work & projects",
        description:
          "Helps plan, organize, and execute ongoing work and projects while keeping priorities, next steps, and deliverables clear.",
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
      }),
    );
    await waitFor(() =>
      expect(window.markas.agent.sendMessage).toHaveBeenCalledWith({
        botId: "chief",
        text: "Your specialty is my work and projects: planning, organizing and carrying them out. Do not start any work yet: say hello in a line or two and ask me what to begin with.",
        attachmentDraftIds: [],
      }),
    );
    expect(vi.mocked(window.markas.agent.updateBot).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(window.markas.agent.sendMessage).mock.invocationCallOrder[0] ?? Number.MAX_VALUE,
    );
  });

  it("uses a custom onboarding answer as the persistent bot remit", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    await fireEvent.click(await screen.findByRole("option", { name: /Something else/ }));
    expect(window.markas.agent.sendMessage).not.toHaveBeenCalled();

    const customAnswer = screen.getByRole("textbox", { name: "Custom answer" });
    expect(customAnswer).toHaveFocus();
    await fireEvent.input(customAnswer, { target: { value: "Plan product launches" } });
    await fireEvent.keyDown(customAnswer, { key: "Enter" });

    await waitFor(() =>
      expect(window.markas.agent.updateBot).toHaveBeenCalledWith({
        botId: "chief",
        role: "Plan product launches",
        description: "Primary focus: Plan product launches.",
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
      }),
    );
    expect(window.markas.agent.sendMessage).toHaveBeenCalledWith({
      botId: "chief",
      text: "Your specialty is: Plan product launches. Do not start any work yet: say hello in a line or two and ask me what to begin with.",
      attachmentDraftIds: [],
    });
  });

  it("answers model prompts from a separate card while composer remains a queue", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    emitAgentEvent?.({
      type: "prompt",
      requestId: "prompt-1",
      botId: "chief",
      threadId: "thread-1",
      turnId: "turn-1",
      questions: [
        {
          id: "account",
          header: "Account",
          question: "Which account?",
          isSecret: false,
          options: null,
        },
      ],
    });
    const answer = await screen.findByRole("textbox", { name: "Account" });
    await fireEvent.input(answer, { target: { value: "Acme" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(window.markas.agent.respondToPrompt).toHaveBeenCalledWith({
        requestId: "prompt-1",
        answers: { account: ["Acme"] },
      }),
    );
  });

  it("keeps every card a bot asked at once, and shows the next after an answer", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await confirmOnboardingModel();
    const permission = (requestId: string, command: string) =>
      emitAgentEvent?.({
        type: "prompt",
        requestId,
        botId: "chief",
        threadId: "thread-1",
        turnId: "turn-1",
        questions: [
          {
            id: "permission",
            header: "Permission",
            question: `Chief wants to run a command\n${command}`,
            isSecret: false,
            options: [
              { label: "Allow once", description: "" },
              { label: "Don't allow", description: "" },
            ],
            permission: { kind: "command", detail: command },
          },
        ],
      });
    permission("cmd-1", "echo one");
    permission("cmd-2", "echo two");

    // The first card is shown; the second waits behind it instead of replacing it.
    expect(await screen.findByText("echo one")).toBeInTheDocument();
    expect(screen.queryByText("echo two")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(window.markas.agent.respondToPrompt).toHaveBeenCalledWith({
        requestId: "cmd-1",
        answers: { permission: ["Allow once"] },
      }),
    );
    expect(await screen.findByText("echo two")).toBeInTheDocument();

    // A card the host settled by itself is taken down.
    emitAgentEvent?.({ type: "prompt-closed", botId: "chief", requestId: "cmd-2" });
    await waitFor(() => expect(screen.queryByText("echo two")).not.toBeInTheDocument());
  });

  it("renders persistent outgoing and incoming bot exchanges", async () => {
    vi.mocked(window.markas.agent.readConversation).mockImplementation(async (botId) => ({
      botId,
      threadId: "thread-1",
      activeTurnId: null,
      revision: 1,
      messages:
        botId === "chief"
          ? [
              {
                id: "outbox-message-1",
                author: "system",
                source: "system",
                text: "Prepare report",
                createdAt: new Date().toISOString(),
                status: "completed",
                exchange: {
                  direction: "outgoing",
                  messageId: "message-1",
                  senderBotId: "chief",
                  recipientBotIds: ["sales-outbound"],
                  replyToMessageId: null,
                  deliveries: [
                    {
                      id: "delivery-1",
                      recipientBotId: "sales-outbound",
                      status: "queued",
                      position: 1,
                      error: null,
                    },
                  ],
                },
              },
            ]
          : [],
    }));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    expect(await screen.findByText("Messaged")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open exchange with Sales Outbound" }),
    ).toBeInTheDocument();
  });

  it("shows an incoming bot marker without duplicating raw collaborator input", async () => {
    vi.mocked(window.markas.agent.readConversation).mockImplementation(async (botId) => ({
      botId,
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages:
        botId === "chief"
          ? [
              {
                id: "delivery-reply-1",
                author: "agent",
                source: "agent",
                senderBotId: "sales-outbound",
                text: "RAW_COLLABORATOR_RESULT",
                createdAt: "2026-08-12T10:00:00.000Z",
                status: "completed",
                exchange: {
                  direction: "incoming",
                  messageId: "reply-1",
                  senderBotId: "sales-outbound",
                  recipientBotIds: ["chief"],
                  replyToMessageId: "request-1",
                  deliveries: [
                    {
                      id: "delivery-reply-1",
                      recipientBotId: "chief",
                      status: "completed",
                      position: null,
                      error: null,
                    },
                  ],
                },
              },
              {
                id: "assistant-summary-1",
                author: "assistant",
                text: "Sales Outbound reports that the pipeline is ready.",
                createdAt: "2026-08-12T10:00:01.000Z",
                status: "completed",
              },
            ]
          : [],
    }));

    render(() => <App />);
    expect(
      await screen.findByRole("button", { name: "Open exchange with Sales Outbound" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("RAW_COLLABORATOR_RESULT")).not.toBeInTheDocument();
    expect(
      screen.getByText("Sales Outbound reports that the pipeline is ready."),
    ).toBeInTheDocument();
  });

  it("does not let a late history refresh overwrite a newer streamed snapshot", async () => {
    let resolveHistory: ((snapshot: ConversationSnapshot) => void) | undefined;
    vi.mocked(window.markas.agent.readConversation).mockImplementation(
      (botId) =>
        new Promise<ConversationSnapshot>((resolve) => {
          resolveHistory = resolve;
          expect(botId).toBe("chief");
        }),
    );

    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: "thread-chief",
        activeTurnId: "turn-live",
        revision: 2,
        messages: [
          {
            id: "live-message",
            author: "assistant",
            text: "Newest streamed answer",
            createdAt: "2026-08-12T10:00:01.000Z",
            status: "streaming",
          },
        ],
      },
    });
    expect(await screen.findByText("Newest streamed answer")).toBeInTheDocument();

    resolveHistory?.({
      botId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages: [
        {
          id: "old-message",
          author: "assistant",
          text: "Stale history answer",
          createdAt: "2026-08-12T09:59:59.000Z",
          status: "completed",
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText("Newest streamed answer")).toBeInTheDocument();
      expect(screen.queryByText("Stale history answer")).not.toBeInTheDocument();
    });
  });

  it("persists settings and opens managed attachment actions", async () => {
    render(() => <App />);
    await fireEvent.click(await screen.findByRole("button", { name: "View bot settings" }));
    await screen.findByRole("button", { name: "Onboarding model: Luna" });
    const name = screen.getByRole("textbox", { name: "Bot name" });
    await fireEvent.input(name, { target: { value: "Coordinator" } });
    await fireEvent.blur(name);
    await waitFor(() =>
      expect(window.markas.agent.updateBot).toHaveBeenCalledWith({
        botId: "chief",
        name: "Coordinator",
      }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Close details" }));

    emitAgentEvent?.({
      type: "conversation",
      snapshot: {
        botId: "chief",
        threadId: null,
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "file-message",
            author: "user",
            text: "",
            createdAt: new Date().toISOString(),
            status: "completed",
            attachments: [attachment("file-1", "brief.pdf", "pdf")],
          },
        ],
      },
    });
    await fireEvent.click(await screen.findByRole("button", { name: "Preview brief.pdf" }));
    expect(screen.getByRole("dialog", { name: "brief.pdf" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(window.markas.agent.openAttachment).toHaveBeenCalledWith({
      attachmentId: "file-1",
      action: "reveal",
    });
  });

  it("shows the chat screen in Indonesian, follows a language switch, and never says agent", async () => {
    // Model descriptions are the host's own words, so this test gives them neutral ones.
    vi.mocked(window.markas.agent.listModels).mockResolvedValue([
      {
        id: "gpt-5.6-luna",
        name: "Luna",
        description: "Fast and efficient.",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high"],
      },
    ]);
    vi.mocked(window.markas.agent.readConversation).mockImplementation(async (botId) => ({
      botId,
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages:
        botId === "chief"
          ? [
              {
                id: "message-queued",
                author: "user",
                text: "Check the stock",
                createdAt: "2026-08-12T10:00:00.000Z",
                status: "completed",
                delivery: { id: "delivery-queued", status: "queued", position: 1 },
              },
              {
                id: "message-failed",
                author: "assistant",
                text: "The count did not finish",
                createdAt: "2026-08-12T10:01:00.000Z",
                status: "failed",
              },
            ]
          : [],
    }));
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await screen.findByText("Check the stock");

    const sidebar = document.querySelector('[data-component="Sidebar"]') as HTMLElement;
    const conversation = document.querySelector('[data-component="Conversation"]') as HTMLElement;
    await fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    await fireEvent.click(screen.getByRole("button", { name: "View bot settings" }));
    expect(within(conversation).getByText("Queued #1")).toBeInTheDocument();
    expect(within(conversation).getByText("Failed")).toBeInTheDocument();
    expect(within(sidebar).getAllByText("No messages yet")).toHaveLength(2);
    expect(readableText(sidebar)).not.toMatch(/\bagents?\b/i);
    expect(readableText(conversation)).not.toMatch(/\bagents?\b/i);

    // The same screen, with nothing reloaded.
    setLanguage("id");
    expect(within(sidebar).getByRole("searchbox", { name: "Cari obrolan" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Bot baru" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("menuitem", { name: "Mesin" })).toBeInTheDocument();
    expect(within(sidebar).getAllByText("Belum ada pesan")).toHaveLength(2);
    expect(within(conversation).getByLabelText("Kirim pesan ke Chief")).toBeInTheDocument();
    expect(within(conversation).getByText("Antrean #1")).toBeInTheDocument();
    expect(within(conversation).getByText("Gagal")).toBeInTheDocument();
    expect(within(conversation).getByRole("button", { name: "Kirim pesan" })).toBeInTheDocument();
    const settings = within(conversation).getByRole("complementary", { name: "Pengaturan bot" });
    expect(within(settings).getByRole("textbox", { name: "Nama bot" })).toHaveValue("Chief");
    expect(within(settings).getByText("Pilih cara bot ini berjalan")).toBeInTheDocument();
    expect(within(settings).getByRole("option", { name: "Sedang" })).toBeInTheDocument();
    expect(readableText(sidebar)).not.toMatch(/\bagents?\b/i);
    expect(readableText(conversation)).not.toMatch(/\bagents?\b/i);
    expect(readableText(sidebar)).not.toContain("No messages yet");
    expect(readableText(conversation)).not.toContain("Queued");
  });

  it("starts a new bot in Indonesian and gives it its focus in Indonesian", async () => {
    setLanguage("id");
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    expect(await screen.findByText("Pilih model untuk memulai.")).toBeInTheDocument();
    await fireEvent.click(await screen.findByRole("button", { name: "Model awal: Luna" }));
    const picker = screen.getByRole("dialog", { name: "Pilih model bot" });
    await fireEvent.click(within(picker).getByRole("option", { name: "Luna, bawaan" }));
    await screen.findByRole("listbox", { name: "Apa yang paling ingin Anda minta saya bantu?" });
    const conversation = document.querySelector('[data-component="Conversation"]') as HTMLElement;
    expect(readableText(conversation)).not.toMatch(/\bagents?\b/i);

    await fireEvent.click(screen.getByRole("option", { name: /Riset & penulisan/ }));
    await waitFor(() =>
      expect(window.markas.agent.updateBot).toHaveBeenCalledWith({
        botId: "chief",
        role: "Riset & penulisan",
        description:
          "Meriset topik, merangkum sumber yang tepercaya, dan membantu menyusun, menyunting, serta memperhalus tulisan yang jelas.",
        model: "gpt-5.6-luna",
        reasoningEffort: "medium",
      }),
    );
    await waitFor(() =>
      expect(window.markas.agent.sendMessage).toHaveBeenCalledWith({
        botId: "chief",
        text: "Keahlian Anda adalah riset dan penulisan: menyelidiki topik dan mengubah temuannya menjadi tulisan yang jelas dan berguna. Jangan mulai mengerjakan apa pun dulu: sapa saya dalam satu atau dua baris, lalu tanyakan mau mulai dari mana.",
        attachmentDraftIds: [],
      }),
    );
  });

  it("opens bot actions on right click and edits the selected bot", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    await fireEvent.contextMenu(screen.getByRole("button", { name: /Sales Outbound/ }), {
      clientX: 120,
      clientY: 90,
    });
    await fireEvent.click(screen.getByRole("menuitem", { name: "Edit bot" }));
    expect(await screen.findByRole("heading", { name: "Sales Outbound" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Bot settings" })).toBeInTheDocument();
  });

  it("confirms and persistently deletes a bot from its context menu", async () => {
    render(() => <App />);
    await screen.findByRole("heading", { name: "Chief" });
    const sales = screen.getByRole("button", { name: /Sales Outbound/ });
    await fireEvent.contextMenu(sales, { clientX: 120, clientY: 90 });
    await fireEvent.click(screen.getByRole("menuitem", { name: "Delete bot" }));
    expect(screen.getByRole("alertdialog", { name: "Delete Sales Outbound?" })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(window.markas.agent.deleteBot).toHaveBeenCalledWith("sales-outbound"),
    );
    await waitFor(() => expect(sales).not.toBeInTheDocument());

    // The delete can be taken back at once, and the bot is opened again.
    const notice = await screen.findByText("Sales Outbound was deleted");
    expect(screen.getByText("It can be put back from Settings for 30 days.")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(window.markas.agent.restoreBot).toHaveBeenCalledWith("sales-outbound"),
    );
    expect(await screen.findByRole("heading", { name: "Sales Outbound" })).toBeInTheDocument();
    await waitFor(() => expect(notice).not.toBeInTheDocument());
  });
});

function attachment(id: string, name: string, kind: "image" | "pdf") {
  return {
    id,
    name,
    size: 2048,
    kind: kind === "image" ? ("image" as const) : ("file" as const),
    mimeType: kind === "image" ? "image/png" : "application/pdf",
    previewKind: kind,
    previewUrl: `/attachments/${id}`,
  };
}
