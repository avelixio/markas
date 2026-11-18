import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createMutable } from "solid-js/store";
import type {
  AccountUsage,
  AgentEvent,
  AgentModelId,
  AgentModelOption,
  AgentReasoningEffort,
  AgentStatus,
  AppInfo,
  BotSummary,
  BrowserControlState,
  BrowserTab,
  ConversationMessage,
  ConversationSnapshot,
  QueueSnapshot,
  UpdateBotInput,
  UpdateStatus,
} from "../../shared/ipc";
import { BOT_TRASH_DAYS } from "../../shared/ipc";
import { Conversation } from "./components/Conversation";
import { PanelResizer, readPanelWidth, savePanelWidth } from "./components/PanelResizer";
import { Sidebar, type SidebarAgentState } from "./components/Sidebar";
import {
  accentForAvatarColor,
  accentForBot,
  type BotMessage,
  type BotProfile,
  cleanPreview,
  isDefaultBotName,
  ONBOARDING_TOPICS,
} from "./data";
import { FeedbackDialog } from "./feedback/FeedbackDialog";
import { type MessageKey, t } from "./i18n";
import {
  type CrewNotice,
  openBotRequest,
  requestOpenArea,
  setCrewNotices,
  setCrewSignal,
} from "./ui/crew-signal";
import { UndoNotice } from "./ui/UndoNotice";

const FALLBACK_STATUS: AgentStatus = {
  phase: "starting",
  cliVersion: null,
  auth: { kind: "unknown" },
  providers: [
    { id: "codex", state: "not-started", version: null, message: null },
    { id: "claude", state: "not-started", version: null, message: null },
    { id: "opencode", state: "not-started", version: null, message: null },
  ],
  capabilities: { chat: "unavailable", browser: "unavailable", computerUse: "unavailable" },
  message: null,
  fullAccess: true,
};

const FALLBACK_UPDATE_STATUS: UpdateStatus = {
  phase: "unsupported",
  currentVersion: "",
  availableVersion: null,
  progress: null,
  checkedAt: null,
  message: null,
};

type PromptEvent = Extract<AgentEvent, { type: "prompt" }>;

const LEFT_PANEL_STORAGE_KEY = "markas:left-panel-width";
const LEFT_PANEL_COLLAPSED_STORAGE_KEY = "markas:left-panel-collapsed";
const LEFT_PANEL_DEFAULT = 275;
const LEFT_PANEL_MIN = 220;
const LEFT_PANEL_MAX = 360;

/**
 * What a new bot is told about its focus, written in the language the person is using.
 * `answer` is either the label of one of the offered topics or the person's own words.
 */
function onboardingProfile(answer: string): {
  role: string;
  description: string;
  firstMessage: string;
} {
  const topic = ONBOARDING_TOPICS.find((id) => t(`chat.onboarding.${id}`) === answer);
  if (topic) {
    return {
      role: t(`chat.onboarding.${topic}`),
      description: t(`chat.onboarding.${topic}.description`),
      firstMessage: t(`chat.onboarding.${topic}.message`),
    };
  }
  return {
    role: answer.length <= 60 ? answer : t("chat.onboarding.custom.role"),
    description: t("chat.onboarding.custom.description", { topic: answer.slice(0, 1_900) }),
    firstMessage: t("chat.onboarding.custom.message", { topic: answer }),
  };
}

export function App() {
  const [botList, setBotList] = createSignal<BotProfile[]>([]);
  const [modelOptions, setModelOptions] = createSignal<AgentModelOption[]>([]);
  const [activeBotId, setActiveBotId] = createSignal("");
  const [liveMessages, setLiveMessages] = createSignal<Record<string, BotMessage[]>>({});
  const [uiErrors, setUiErrors] = createSignal<Record<string, BotMessage[]>>({});
  const [conversationLoaded, setConversationLoaded] = createSignal<Record<string, boolean>>({});
  const [conversationRevisions, setConversationRevisions] = createSignal<Record<string, number>>(
    {},
  );
  const [activeTurns, setActiveTurns] = createSignal<Record<string, string | null>>({});
  const [unreadReplies, setUnreadReplies] = createSignal<Record<string, number>>({});
  const [recentReplies, setRecentReplies] = createSignal<Record<string, boolean>>({});
  const [queues, setQueues] = createSignal<Record<string, QueueSnapshot>>({});
  const [browserTabs, setBrowserTabs] = createSignal<BrowserTab[]>([]);
  const [activeBrowserTabId, setActiveBrowserTabId] = createSignal<string | null>(null);
  const [browserControlState, setBrowserControlState] = createSignal<BrowserControlState>({
    sessions: [],
  });
  const [agentPickerOpen, setAgentPickerOpen] = createSignal(false);
  const [feedbackOpen, setFeedbackOpen] = createSignal(false);
  const [creatingAgent, setCreatingAgent] = createSignal(false);
  const [settingsRequest, setSettingsRequest] = createSignal<{
    botId: string;
    nonce: number;
  } | null>(null);
  const [onboardingRequest, setOnboardingRequest] = createSignal<{
    botId: string;
    nonce: number;
  } | null>(null);
  /** Each bot's open cards, oldest first. The first is the one shown. */
  const [pendingPrompts, setPendingPrompts] = createSignal<Record<string, PromptEvent[]>>({});
  const [appInfo, setAppInfo] = createSignal<AppInfo | null>(null);
  const [agentStatus, setAgentStatus] = createSignal<AgentStatus>(FALLBACK_STATUS);
  const [accountUsage, setAccountUsage] = createSignal<AccountUsage | null>(null);
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>(FALLBACK_UPDATE_STATUS);
  const [leftPanelWidth, setLeftPanelWidth] = createSignal(
    readPanelWidth(LEFT_PANEL_STORAGE_KEY, LEFT_PANEL_DEFAULT, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
  );
  const [leftPanelCollapsed, setLeftPanelCollapsed] = createSignal(
    window.localStorage.getItem(LEFT_PANEL_COLLAPSED_STORAGE_KEY) === "true",
  );
  const pendingConversationSnapshots = new Map<string, ConversationSnapshot>();
  const recentReplyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let conversationFrame: number | undefined;

  const activeBot = createMemo(
    () => botList().find((bot) => bot.id === activeBotId()) ?? botList()[0],
  );
  const activeMessages = createMemo(() => {
    const bot = activeBot();
    return bot ? [...(liveMessages()[bot.id] ?? []), ...(uiErrors()[bot.id] ?? [])] : [];
  });

  onMount(() => {
    const unsubscribe = window.markas.agent.onEvent(handleAgentEvent);
    const unsubscribeUpdate = window.markas.update.onEvent(setUpdateStatus);
    onCleanup(() => {
      unsubscribe();
      unsubscribeUpdate();
      if (conversationFrame !== undefined) cancelAnimationFrame(conversationFrame);
      for (const timer of recentReplyTimers.values()) clearTimeout(timer);
      recentReplyTimers.clear();
    });
    void window.markas.update
      .getStatus()
      .then(setUpdateStatus)
      .catch(() => undefined);

    void Promise.all([
      window.markas
        .getAppInfo()
        .then(setAppInfo)
        .catch(() => setAppInfo({ name: "Markas", version: "unavailable", platform: "darwin" })),
      window.markas.agent
        .getStatus()
        .then(setAgentStatus)
        .catch(() => undefined),
      window.markas.agent
        .listModels()
        .then(setModelOptions)
        .catch(() => undefined),
      window.markas.agent
        .listBots()
        .then(applyStoredBots)
        .catch((error) => {
          setAgentStatus((current) => ({ ...current, message: String(error) }));
        }),
    ]);
    void window.markas.browser
      .listTabs()
      .then((tabs) => {
        setBrowserTabs(tabs);
        setActiveBrowserTabId((current) => current ?? tabs[0]?.id ?? null);
      })
      .catch(() => undefined);
    void window.markas.browser
      .getControlState()
      .then(setBrowserControlState)
      .catch(() => undefined);
  });

  // Only a change of phase (Markas becoming ready) reloads the open chat. Every status event
  // reloading it made a loop: reading a chat can look for the bot's engine, which reports status.
  const phase = createMemo(() => agentStatus().phase);
  createEffect(() => {
    const botId = activeBotId();
    phase();
    if (!botId) return;
    void Promise.all([
      window.markas.agent.readConversation(botId),
      window.markas.agent.listQueue(botId),
    ])
      .then(([snapshot, queue]) => {
        setQueues((current) => ({ ...current, [botId]: queue }));
        scheduleConversation(snapshot);
      })
      .catch((error) => appendUiError(botId, error, "chat.error.load"));
  });

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case "status":
        setAgentStatus(event.status);
        if (event.status.phase === "ready") {
          void window.markas.agent
            .listModels()
            .then(setModelOptions)
            .catch(() => undefined);
        }
        return;
      case "usage-changed":
        setAccountUsage(event.usage);
        return;
      case "bots-changed":
        applyStoredBots(event.bots);
        return;
      case "conversation":
        scheduleConversation(event.snapshot);
        return;
      case "conversation-delta":
        applyConversationDelta(event);
        return;
      case "queue-changed":
        setQueues((current) => ({ ...current, [event.snapshot.botId]: event.snapshot }));
        return;
      case "browser-changed":
        setBrowserTabs(event.tabs);
        setActiveBrowserTabId(event.activeTabId);
        return;
      case "browser-control-changed":
        setBrowserControlState(event.state);
        return;
      case "turn-started":
        clearRecentReply(event.botId);
        setActiveTurns((current) => ({ ...current, [event.botId]: event.turnId }));
        return;
      case "turn-completed":
        setActiveTurns((current) => ({ ...current, [event.botId]: null }));
        if (event.status === "completed") markReplyCompleted(event.botId);
        return;
      case "prompt":
        // A bot can ask about several things at once. Each card waits its turn; none replaces another.
        setPendingPrompts((current) => {
          const waiting = current[event.botId] ?? [];
          if (waiting.some((prompt) => prompt.requestId === event.requestId)) return current;
          return { ...current, [event.botId]: [...waiting, event] };
        });
        return;
      case "prompt-closed":
        setPendingPrompts((current) => withoutPrompt(current, event.botId, event.requestId));
        return;
      case "error":
        if (event.botId) appendUiError(event.botId, event.message, "chat.error.generic");
    }
  }

  function applyStoredBots(storedBots: BotSummary[]) {
    let profiles: BotProfile[] = [];
    setBotList((current) => {
      const currentById = new Map(current.map((bot) => [bot.id, bot]));
      profiles = storedBots.map((stored) => {
        const next = toBotProfile(stored);
        const existing = currentById.get(next.id);
        if (!existing) return createMutable(next);
        Object.assign(existing, next);
        return existing;
      });
      return profiles;
    });
    setActiveBotId((current) =>
      profiles.some((bot) => bot.id === current) ? current : (profiles[0]?.id ?? ""),
    );
    if (profiles.length === 0) setAgentPickerOpen(true);
  }

  function scheduleConversation(snapshot: ConversationSnapshot) {
    const botId = snapshot.botId;
    const appliedRevision = conversationRevisions()[botId] ?? -1;
    const pendingRevision = pendingConversationSnapshots.get(botId)?.revision ?? -1;
    if (snapshot.revision < Math.max(appliedRevision, pendingRevision)) return;
    pendingConversationSnapshots.set(botId, snapshot);
    if (conversationFrame !== undefined) return;
    conversationFrame = requestAnimationFrame(() => {
      conversationFrame = undefined;
      const snapshots = [...pendingConversationSnapshots.values()];
      pendingConversationSnapshots.clear();
      batch(() => {
        for (const pending of snapshots) applyConversation(pending);
      });
    });
  }

  function applyConversationDelta(event: Extract<AgentEvent, { type: "conversation-delta" }>) {
    if (event.revision <= (conversationRevisions()[event.botId] ?? -1)) return;
    pendingConversationSnapshots.delete(event.botId);
    setConversationRevisions((current) => ({ ...current, [event.botId]: event.revision }));

    const existing = liveMessages()[event.botId]?.find((message) => message.id === event.messageId);
    if (existing) {
      existing.body += event.delta;
      existing.streaming = true;
    } else {
      const message = createMutable<BotMessage>({
        id: event.messageId,
        turnId: event.turnId,
        author: "bot",
        body: event.delta,
        time: formatTime(event.createdAt),
        streaming: true,
        animate: conversationLoaded()[event.botId] === true,
        kind: "text",
      });
      setLiveMessages((current) => ({
        ...current,
        [event.botId]: [...(current[event.botId] ?? []), message],
      }));
    }
    setConversationLoaded((current) => ({ ...current, [event.botId]: true }));
  }

  function applyConversation(snapshot: ConversationSnapshot) {
    const botId = snapshot.botId;
    if (snapshot.revision < (conversationRevisions()[botId] ?? -1)) return;
    const initialLoad = conversationLoaded()[botId] !== true;
    setConversationRevisions((current) => ({ ...current, [botId]: snapshot.revision }));
    setLiveMessages((current) => {
      const previous = current[botId] ?? [];
      const previousById = new Map(previous.map((message) => [message.id, message]));
      const mappedMessages = retainThinkingMessages(previous, toBotMessages(snapshot.messages));
      const next = mappedMessages.map((mapped) => {
        const existing = previousById.get(mapped.id);
        if (!existing) return createMutable({ ...mapped, animate: !initialLoad });
        if (!botMessagesEqual(existing, mapped)) Object.assign(existing, mapped);
        return existing;
      });
      if (
        previous.length === next.length &&
        previous.every((message, index) => message === next[index])
      ) {
        return current;
      }
      return { ...current, [botId]: next };
    });
    setConversationLoaded((current) => ({ ...current, [botId]: true }));
    setActiveTurns((current) => ({ ...current, [botId]: snapshot.activeTurnId }));
  }

  async function createAgent() {
    if (creatingAgent()) return;
    setCreatingAgent(true);
    try {
      const stored = await window.markas.agent.createBot();
      const newAgent = createMutable(toBotProfile(stored));
      setBotList((current) => [newAgent, ...current.filter((item) => item.id !== newAgent.id)]);
      setLiveMessages((current) => ({ ...current, [newAgent.id]: [] }));
      setConversationLoaded((current) => ({ ...current, [newAgent.id]: true }));
      setAgentPickerOpen(false);
      setActiveBotId(newAgent.id);
      setOnboardingRequest({ botId: newAgent.id, nonce: Date.now() });
    } catch (error) {
      setAgentPickerOpen(false);
      if (activeBotId()) appendUiError(activeBotId(), error, "chat.error.create");
    } finally {
      setCreatingAgent(false);
    }
  }

  function selectBot(botId: string) {
    setAgentPickerOpen(false);
    clearReplyIndicators(botId);
    setActiveBotId(botId);
  }

  function markReplyCompleted(botId: string) {
    if (activeBotId() !== botId) {
      setUnreadReplies((current) => ({
        ...current,
        [botId]: Math.min(99, (current[botId] ?? 0) + 1),
      }));
      return;
    }
    clearRecentReply(botId);
    setRecentReplies((current) => ({ ...current, [botId]: true }));
    recentReplyTimers.set(
      botId,
      setTimeout(() => {
        recentReplyTimers.delete(botId);
        setRecentReplies((current) => ({ ...current, [botId]: false }));
      }, 4000),
    );
  }

  function clearRecentReply(botId: string) {
    const timer = recentReplyTimers.get(botId);
    if (timer) clearTimeout(timer);
    recentReplyTimers.delete(botId);
    setRecentReplies((current) => (current[botId] ? { ...current, [botId]: false } : current));
  }

  function clearReplyIndicators(botId: string) {
    clearRecentReply(botId);
    setUnreadReplies((current) => (current[botId] ? { ...current, [botId]: 0 } : current));
  }

  function activateBrowserTab(tabId: string) {
    void window.markas.browser.activate(tabId);
  }

  function closeBrowserTab(tabId: string) {
    void window.markas.browser.close(tabId);
  }

  async function updateBot(botId: string, updates: Omit<UpdateBotInput, "botId">) {
    try {
      const stored = await window.markas.agent.updateBot({ botId, ...updates });
      const existing = botList().find((bot) => bot.id === botId);
      if (existing) Object.assign(existing, toBotProfile(stored));
      else setBotList((current) => [...current, createMutable(toBotProfile(stored))]);
    } catch (error) {
      appendUiError(botId, error, "chat.error.settings");
      throw error;
    }
  }

  function editBot(botId: string) {
    selectBot(botId);
    setSettingsRequest({ botId, nonce: Date.now() });
  }

  /** The bot that was just deleted, while the offer to take it back is on screen. */
  const [deletedBot, setDeletedBot] = createSignal<{ botId: string; name: string } | null>(null);

  async function undoDelete(botId: string): Promise<void> {
    await window.markas.agent.restoreBot(botId);
    // The host also announces the change, but the list is read here so the bot can be opened now.
    applyStoredBots(await window.markas.agent.listBots());
    selectBot(botId);
  }

  async function deleteBot(botId: string) {
    try {
      const name = botList().find((bot) => bot.id === botId)?.name ?? "";
      await window.markas.agent.deleteBot(botId);
      setDeletedBot({ botId, name });
      const remaining = botList().filter((bot) => bot.id !== botId);
      setBotList(remaining);
      setActiveBotId((current) => (current === botId ? (remaining[0]?.id ?? "") : current));
      setSettingsRequest((current) => (current?.botId === botId ? null : current));
      setLiveMessages((current) => withoutBot(current, botId));
      setUiErrors((current) => withoutBot(current, botId));
      setConversationLoaded((current) => withoutBot(current, botId));
      setConversationRevisions((current) => withoutBot(current, botId));
      setActiveTurns((current) => withoutBot(current, botId));
      setUnreadReplies((current) => withoutBot(current, botId));
      setRecentReplies((current) => withoutBot(current, botId));
      setQueues((current) => withoutBot(current, botId));
      setPendingPrompts((current) => withoutBot(current, botId));
      const replyTimer = recentReplyTimers.get(botId);
      if (replyTimer) clearTimeout(replyTimer);
      recentReplyTimers.delete(botId);
    } catch (error) {
      appendUiError(botId, error, "chat.error.delete");
      throw error;
    }
  }

  async function sendMessage(
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null,
  ): Promise<boolean> {
    const bot = activeBot();
    if (!bot || (!body.trim() && attachmentDraftIds.length === 0)) return false;
    return sendMessageToBot(bot.id, body, attachmentDraftIds, replyToMessageId);
  }

  async function sendMessageToBot(
    botId: string,
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null = null,
  ): Promise<boolean> {
    try {
      await window.markas.agent.sendMessage({
        botId,
        text: body.trim(),
        attachmentDraftIds,
        ...(replyToMessageId ? { replyToMessageId } : {}),
      });
      setUiErrors((current) => ({ ...current, [botId]: [] }));
      return true;
    } catch (error) {
      appendUiError(botId, error, "chat.error.send");
      return false;
    }
  }

  async function completeOnboarding(
    answer: string,
    model: AgentModelId,
    reasoningEffort: AgentReasoningEffort,
  ): Promise<boolean> {
    const bot = activeBot();
    const topic = answer.trim();
    if (!bot || !topic) return false;
    const profile = onboardingProfile(topic);
    try {
      await updateBot(bot.id, {
        role: profile.role,
        description: profile.description,
        model,
        reasoningEffort,
      });
    } catch {
      return false;
    }
    return sendMessageToBot(bot.id, profile.firstMessage, []);
  }

  async function answerPrompt(answers: Record<string, string[]>): Promise<boolean> {
    const bot = activeBot();
    const prompt = bot ? pendingPrompts()[bot.id]?.[0] : undefined;
    if (!bot || !prompt) return false;
    try {
      await window.markas.agent.respondToPrompt({ requestId: prompt.requestId, answers });
      setPendingPrompts((current) => withoutPrompt(current, bot.id, prompt.requestId));
      return true;
    } catch (error) {
      appendUiError(bot.id, error, "chat.error.answer");
      return false;
    }
  }

  function cancelQueuedMessage(deliveryId: string) {
    const bot = activeBot();
    if (!bot) return;
    void window.markas.agent
      .cancelQueuedMessage({ botId: bot.id, deliveryId })
      .catch((error) => appendUiError(bot.id, error, "chat.error.cancel"));
  }

  function resumeQueue() {
    const bot = activeBot();
    if (!bot) return;
    void window.markas.agent
      .setQueuePaused({ botId: bot.id, paused: false })
      .catch((error) => appendUiError(bot.id, error, "chat.error.resume"));
  }

  function stopActiveTurn() {
    const bot = activeBot();
    const turnId = bot ? activeTurns()[bot.id] : null;
    if (!bot || !turnId) return;
    void window.markas.agent
      .interrupt({ botId: bot.id, turnId })
      .catch((error) => appendUiError(bot.id, error, "chat.error.stop"));
  }

  async function refreshAccountUsage(): Promise<AccountUsage> {
    const usage = await window.markas.agent.getUsage();
    setAccountUsage(usage);
    return usage;
  }

  function appendUiError(botId: string, error: unknown, status: MessageKey) {
    const body = error instanceof Error ? error.message : String(error);
    setUiErrors((current) => {
      const existing = current[botId] ?? [];
      const last = existing[existing.length - 1];
      // The same failure can be reported again each time the engine status changes: show it once.
      if (last && last.body === body && last.status?.key === status) return current;
      const message: BotMessage = {
        id: `ui-${Date.now()}-${Math.random()}`,
        author: "bot",
        body,
        time: formatTime(new Date().toISOString()),
        status: { key: status },
      };
      return { ...current, [botId]: [...existing, message] };
    });
  }

  const activeQueue = createMemo(() => {
    const bot = activeBot();
    return bot ? queues()[bot.id] : undefined;
  });
  const sidebarAgentStates = createMemo<Record<string, SidebarAgentState>>(() => {
    const turns = activeTurns();
    const queueSnapshots = queues();
    const unread = unreadReplies();
    const recent = recentReplies();
    const states: Record<string, SidebarAgentState> = {};
    for (const bot of botList()) {
      const isWorking =
        Boolean(turns[bot.id]) ||
        Boolean(
          queueSnapshots[bot.id]?.deliveries.some(
            (delivery) => delivery.status === "starting" || delivery.status === "running",
          ),
        );
      if (isWorking) states[bot.id] = { kind: "working" };
      else if ((unread[bot.id] ?? 0) > 0) {
        states[bot.id] = { kind: "unread", count: unread[bot.id] ?? 1 };
      } else if (recent[bot.id]) states[bot.id] = { kind: "responded" };
    }
    return states;
  });

  // The beacon on the rail shows the whole crew's state, whichever area is open.
  createEffect(() => {
    const states = sidebarAgentStates();
    const prompts = pendingPrompts();
    const handOffs = browserControlState().handOffs ?? [];
    let working = 0;
    let waiting = 0;
    for (const bot of botList()) {
      const needsPerson =
        Boolean(prompts[bot.id]?.length) ||
        handOffs.some((handOff) =>
          handOff.botId
            ? handOff.botId === bot.id
            : Boolean(bot.threadId && handOff.threadId === bot.threadId),
        );
      if (needsPerson) waiting += 1;
      else if (states[bot.id]?.kind === "working") working += 1;
    }
    setCrewSignal({ working, waiting });
  });
  onCleanup(() => setCrewSignal({ working: 0, waiting: 0 }));

  // The notifications list: what waits on the person, and what happened while they were away.
  createEffect(() => {
    const prompts = pendingPrompts();
    const handOffs = browserControlState().handOffs ?? [];
    const unread = unreadReplies();
    const queueSnapshots = queues();
    const notices: CrewNotice[] = [];
    for (const bot of botList()) {
      const handOff = handOffs.find((candidate) =>
        candidate.botId
          ? candidate.botId === bot.id
          : Boolean(bot.threadId && candidate.threadId === bot.threadId),
      );
      if (handOff) {
        notices.push({
          key: `handoff:${handOff.tabId}:${handOff.startedAt}`,
          botId: bot.id,
          botName: bot.name,
          kind: "handoff",
          detail: handOff.reason,
          tabId: handOff.tabId,
        });
      }
      const prompt = prompts[bot.id]?.[0];
      if (prompt) {
        const question = prompt.questions[0];
        notices.push({
          key: `approval:${prompt.requestId}`,
          botId: bot.id,
          botName: bot.name,
          kind: "approval",
          detail: question?.permission?.detail || question?.question || "",
        });
      }
      const count = unread[bot.id] ?? 0;
      if (count > 0) {
        notices.push({
          key: `finished:${bot.id}:${count}`,
          botId: bot.id,
          botName: bot.name,
          kind: "finished",
          detail: "",
        });
      }
      const last = queueSnapshots[bot.id]?.deliveries.at(-1);
      if (last?.status === "failed") {
        notices.push({
          key: `failed:${last.id}`,
          botId: bot.id,
          botName: bot.name,
          kind: "failed",
          detail: last.error ?? "",
        });
      }
    }
    setCrewNotices(notices);
  });
  onCleanup(() => setCrewNotices([]));
  // A notice chosen on the rail opens that bot's chat here.
  createEffect(
    on(openBotRequest, (request) => {
      if (request && botList().some((bot) => bot.id === request.botId)) selectBot(request.botId);
    }),
  );

  function setSidebarCollapsed(collapsed: boolean) {
    setLeftPanelCollapsed(collapsed);
    window.localStorage.setItem(LEFT_PANEL_COLLAPSED_STORAGE_KEY, String(collapsed));
  }

  async function runUpdateAction(): Promise<void> {
    const phase = updateStatus().phase;
    if (phase === "ready") {
      await window.markas.update.install();
      return;
    }
    const status =
      phase === "available"
        ? await window.markas.update.download()
        : await window.markas.update.check();
    setUpdateStatus(status);
  }

  return (
    <Show
      when={appInfo() !== null}
      fallback={<div class="initial-setup-screen" role="status" aria-label="Loading Markas" />}
    >
      <div
        class="app-frame"
        classList={{ "app-frame-sidebar-collapsed": leftPanelCollapsed() }}
        style={`--left-panel-width: ${leftPanelCollapsed() ? 0 : leftPanelWidth()}px`}
      >
        <Show when={!leftPanelCollapsed()}>
          <Sidebar
            bots={botList()}
            activeBotId={activeBot()?.id ?? ""}
            appInfo={appInfo()}
            agentStatus={agentStatus()}
            accountUsage={accountUsage()}
            updateStatus={updateStatus()}
            agentStates={sidebarAgentStates()}
            onSelectBot={selectBot}
            onCreateBot={() => setAgentPickerOpen(true)}
            onEditBot={editBot}
            onDeleteBot={deleteBot}
            onRefreshUsage={refreshAccountUsage}
            onUpdateAction={runUpdateAction}
            onOpenExternal={(destination) => window.markas.openExternal(destination)}
            onOpenEngines={() => requestOpenArea("switchboard")}
            onSendFeedback={() => setFeedbackOpen(true)}
            onCollapse={() => setSidebarCollapsed(true)}
          />
          <PanelResizer
            class="left-panel-resizer"
            label={t("sidebar.resize")}
            controls="bot-sidebar"
            direction="left"
            value={leftPanelWidth()}
            defaultValue={LEFT_PANEL_DEFAULT}
            min={LEFT_PANEL_MIN}
            max={LEFT_PANEL_MAX}
            onResize={setLeftPanelWidth}
            onResizeEnd={(value) => savePanelWidth(LEFT_PANEL_STORAGE_KEY, value)}
          />
        </Show>
        <Conversation
          agentStatus={agentStatus()}
          bot={activeBot()}
          bots={botList()}
          modelOptions={modelOptions()}
          messages={activeMessages()}
          loaded={activeBot() ? conversationLoaded()[activeBot()?.id ?? ""] === true : false}
          queue={activeQueue()}
          browserTabs={browserTabs()}
          activeBrowserTabId={activeBrowserTabId()}
          browserControlState={browserControlState()}
          leftSidebarCollapsed={leftPanelCollapsed()}
          prompt={activeBot() ? pendingPrompts()[activeBot()?.id ?? ""]?.[0] : undefined}
          activeTurnId={activeBot() ? activeTurns()[activeBot()?.id ?? ""] : null}
          agentPickerOpen={agentPickerOpen()}
          creatingAgent={creatingAgent()}
          settingsRequest={settingsRequest()}
          onboardingRequest={onboardingRequest()}
          onCloseAgentPicker={() => setAgentPickerOpen(false)}
          onCreateAgent={() => void createAgent()}
          onSelectAgent={selectBot}
          onUpdateBot={updateBot}
          onSendMessage={sendMessage}
          onCompleteOnboarding={completeOnboarding}
          onAnswerPrompt={answerPrompt}
          onCancelQueuedMessage={cancelQueuedMessage}
          onResumeQueue={resumeQueue}
          onActivateBrowserTab={activateBrowserTab}
          onCloseBrowserTab={closeBrowserTab}
          onToggleLeftSidebar={() => setSidebarCollapsed(false)}
          onOpenAgentSetup={async () => requestOpenArea("switchboard")}
          onStop={stopActiveTurn}
        />
        <Show when={feedbackOpen()}>
          <FeedbackDialog onClose={() => setFeedbackOpen(false)} />
        </Show>
        <Show when={deletedBot()} keyed>
          {(gone) => (
            <UndoNotice
              message={t("bot.deleted.notice", { name: gone.name })}
              hint={t("bot.deleted.hint", { days: BOT_TRASH_DAYS })}
              onUndo={() => undoDelete(gone.botId)}
              onDismiss={() => setDeletedBot(null)}
            />
          )}
        </Show>
      </div>
    </Show>
  );
}

function toBotProfile(stored: BotSummary): BotProfile {
  return {
    id: stored.id,
    name: stored.name,
    role: stored.role,
    description: stored.description,
    notifications: stored.notifications,
    model: stored.model,
    reasoningEffort: stored.reasoningEffort,
    threadId: stored.threadId,
    accent: isDefaultBotName(stored.name)
      ? "neutral"
      : stored.avatarColor
        ? accentForAvatarColor(stored.avatarColor)
        : accentForBot(stored.id),
    avatarShape: stored.avatarShape ?? "blob",
    madeInFull: stored.madeInFull === true,
    avatarColor: stored.avatarColor ?? "orange",
    access: stored.access ?? "ask",
    time: stored.updatedAt ? formatTime(stored.updatedAt) : "",
    preview: cleanPreview(stored.preview),
  };
}

function toBotMessage(message: ConversationMessage): BotMessage {
  const exchangeSenderId = message.senderBotId ?? message.exchange?.senderBotId;
  return {
    id: message.id,
    turnId: message.turnId,
    author: message.author === "user" ? "you" : "bot",
    body: message.text,
    time: formatTime(message.createdAt),
    streaming: message.status === "streaming",
    itemType: message.itemType,
    kind: message.exchange ? "exchange" : "text",
    senderBotId: exchangeSenderId,
    replyToMessageId: message.replyToMessageId,
    attachments: message.attachments,
    exchange: message.exchange,
    reaction: message.reaction,
    status: message.exchange
      ? undefined
      : message.delivery?.status === "queued"
        ? { key: "chat.status.queued", values: { position: message.delivery.position ?? "" } }
        : message.delivery?.status === "cancelled"
          ? { key: "chat.status.cancelled" }
          : message.status === "failed"
            ? { key: "chat.status.failed" }
            : message.status === "interrupted"
              ? { key: "chat.status.stopped" }
              : undefined,
  };
}

function toBotMessages(messages: ConversationMessage[]): BotMessage[] {
  const result: BotMessage[] = [];
  const thinkingByTurn = new Map<string, BotMessage>();
  for (const message of messages) {
    if (message.author !== "assistant" || message.itemType !== "commentary") {
      result.push(toBotMessage(message));
      continue;
    }

    const key = message.turnId ?? message.id;
    const existing = thinkingByTurn.get(key);
    if (existing) {
      if (message.text.trim()) existing.items = [...(existing.items ?? []), message.text];
      existing.streaming = existing.streaming || message.status === "streaming";
      continue;
    }

    const thinking: BotMessage = {
      id: `thinking:${key}`,
      turnId: message.turnId,
      author: "bot",
      body: "",
      time: formatTime(message.createdAt),
      streaming: message.status === "streaming",
      itemType: "commentary",
      kind: "thinking",
      items: message.text.trim() ? [message.text] : [],
    };
    thinkingByTurn.set(key, thinking);
    result.push(thinking);
  }
  return result;
}

function botMessagesEqual(left: BotMessage, right: BotMessage): boolean {
  return (
    left.id === right.id &&
    left.turnId === right.turnId &&
    left.author === right.author &&
    left.body === right.body &&
    left.time === right.time &&
    left.kind === right.kind &&
    left.streaming === right.streaming &&
    left.itemType === right.itemType &&
    JSON.stringify(left.status) === JSON.stringify(right.status) &&
    left.senderBotId === right.senderBotId &&
    left.replyToMessageId === right.replyToMessageId &&
    left.reaction === right.reaction &&
    JSON.stringify(left.attachments) === JSON.stringify(right.attachments) &&
    JSON.stringify(left.exchange) === JSON.stringify(right.exchange) &&
    JSON.stringify(left.items) === JSON.stringify(right.items)
  );
}

function retainThinkingMessages(previous: BotMessage[], next: BotMessage[]): BotMessage[] {
  const result = [...next];
  const nextIds = new Set(result.map((message) => message.id));
  for (const thinking of previous) {
    if (thinking.kind !== "thinking" || nextIds.has(thinking.id) || !thinking.turnId) continue;
    const sameTurnIndexes = result.flatMap((message, index) =>
      message.turnId === thinking.turnId ? [index] : [],
    );
    if (sameTurnIndexes.length === 0) continue;
    const finalAnswerIndex = result.findIndex(
      (message) =>
        message.turnId === thinking.turnId &&
        message.author === "bot" &&
        message.kind !== "thinking",
    );
    const insertionIndex =
      finalAnswerIndex >= 0 ? finalAnswerIndex : (sameTurnIndexes.at(-1) ?? result.length - 1) + 1;
    result.splice(insertionIndex, 0, { ...thinking, streaming: false });
    nextIds.add(thinking.id);
  }
  return result;
}

function formatTime(value: string): string {
  const date = new Date(value);
  // An empty time is shown as "now" where it is rendered, in the current language.
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

/** A bot's open cards without one of them. */
function withoutPrompt(
  prompts: Record<string, PromptEvent[]>,
  botId: string,
  requestId: string | number,
): Record<string, PromptEvent[]> {
  const left = (prompts[botId] ?? []).filter((prompt) => prompt.requestId !== requestId);
  return { ...prompts, [botId]: left };
}

function withoutBot<T>(values: Record<string, T>, botId: string): Record<string, T> {
  const next = { ...values };
  delete next[botId];
  return next;
}
