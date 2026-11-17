import type { AccessLevel, AskKind } from "./access";

export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  openExternal: "app:open-external",
  openUrl: "app:open-url",
  updateGetStatus: "update:get-status",
  updateCheck: "update:check",
  updateDownload: "update:download",
  updateInstall: "update:install",
  updateEvent: "update:event",
  maintenanceExportData: "maintenance:export-data",
  maintenanceExportDiagnostics: "maintenance:export-diagnostics",
  agentGetStatus: "agent:get-status",
  agentGetUsage: "agent:get-usage",
  agentListModels: "agent:list-models",
  agentListBots: "agent:list-bots",
  agentCreateBot: "agent:create-bot",
  agentUpdateBot: "agent:update-bot",
  agentDeleteBot: "agent:delete-bot",
  agentReadConversation: "agent:read-conversation",
  agentSendMessage: "agent:send-message",
  agentSetMessageReaction: "agent:set-message-reaction",
  agentChooseAttachments: "agent:choose-attachments",
  agentImportAttachments: "agent:import-attachments",
  agentDiscardDraftAttachment: "agent:discard-draft-attachment",
  agentOpenAttachment: "agent:open-attachment",
  agentListQueue: "agent:list-queue",
  agentCancelQueuedMessage: "agent:cancel-queued-message",
  agentSetQueuePaused: "agent:set-queue-paused",
  agentInterrupt: "agent:interrupt",
  agentRespondToPrompt: "agent:respond-to-prompt",
  agentEvent: "agent:event",
  browserOpen: "browser:open",
  browserActivate: "browser:activate",
  browserClose: "browser:close",
  browserListTabs: "browser:list-tabs",
  browserGetControlState: "browser:get-control-state",
  browserSetVisible: "browser:set-visible",
} as const;

export type DesktopPlatform = "darwin" | "win32" | "linux";

export interface AppInfo {
  name: string;
  version: string;
  platform: DesktopPlatform;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "up-to-date"
  | "error"
  | "unsupported";

export interface UpdateStatus {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  checkedAt: string | null;
  message: string | null;
}

export interface ExportResult {
  saved: boolean;
  /** Where the host wrote the export, when it saved one. */
  path?: string;
}

export type AgentPhase = "idle" | "starting" | "ready" | "restarting" | "blocked" | "stopped";

export type CapabilityState = "ready" | "setup-required" | "unavailable";

export type AgentProviderId = "codex" | "claude";
export type AgentProviderState =
  | "not-started"
  | "checking"
  | "available"
  | "sign-in-required"
  | "not-installed"
  | "outdated"
  | "error";

export interface AgentProviderStatus {
  id: AgentProviderId;
  state: AgentProviderState;
  version: string | null;
  message: string | null;
  email?: string | null;
}

export const SETUP_LANGUAGES = ["en", "id"] as const;
export type SetupLanguage = (typeof SETUP_LANGUAGES)[number];

/** The steps of setup, in order. The stored step is where the person carries on. */
export const SETUP_STEPS = [
  "language",
  "how-bots-run",
  "engines",
  "default-model",
  "consent",
  "dispatch",
  "first-bot",
  "review",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Everything setup remembers. `setup.getState` returns it and `setup.save` changes it. */
export interface SetupState {
  completed: boolean;
  language: SetupLanguage | null;
  preferredProvider: AgentProviderId | null;
  defaultModel: AgentModelId | null;
  defaultReasoningEffort: AgentReasoningEffort | null;
  /** When the person agreed to how bots run, or null when they have not yet. */
  consentAt: string | null;
  /** The step the person reached, so setup opens there again. */
  step: SetupStep;
  /** Engine programs the person pointed Markas at. */
  enginePaths: Partial<Record<AgentProviderId, string>>;
}

/** A change to what setup remembers. Fields left out stay as they are. */
export interface SaveSetupStateInput {
  language?: SetupLanguage;
  preferredProvider?: AgentProviderId;
  defaultModel?: AgentModelId;
  defaultReasoningEffort?: AgentReasoningEffort;
  /** True records the consent now; false takes it back. */
  consent?: boolean;
  step?: SetupStep;
  /** True finishes setup. It needs a language, an engine and the consent. */
  completed?: boolean;
}

export type SetupEngineState =
  | "not-installed"
  | "not-signed-in"
  | "signed-in"
  | "outdated"
  | "error";

export interface SetupEngineStatus {
  engine: AgentProviderId;
  state: SetupEngineState;
  version: string | null;
  /** The account that is signed in, when the engine says. */
  email: string | null;
  /** A plain sentence about the state. Null when signed in. */
  message: string | null;
  /** The program the person pointed Markas at, when they did. */
  path: string | null;
}

/** The line a person can paste to install an engine by hand. */
export interface SetupInstallCommand {
  engine: AgentProviderId;
  command: string;
  /** Where the line is pasted: Windows PowerShell, or a terminal on macOS and Linux. */
  shell: "powershell" | "terminal";
  /** Another way that also works, when there is one. */
  alternative: string | null;
}

export type SetupInstallFailure =
  | "no-internet"
  | "no-permission"
  /** Neither the engine's installer nor npm could be started. */
  | "node-missing"
  /** The installer finished but Markas cannot find the engine. */
  | "not-found-after-install"
  | "already-running"
  | "unknown";

/** How an install ended. `command` is always the line to run by hand instead. */
export type SetupInstallResult =
  | { result: "installed"; engine: AgentProviderId; status: SetupEngineStatus; command: string }
  | {
      result: "failed";
      engine: AgentProviderId;
      reason: SetupInstallFailure;
      message: string;
      command: string;
    }
  | { result: "cancelled"; engine: AgentProviderId; command: string };

export type SetupLocateResult =
  | {
      result: "located";
      engine: AgentProviderId;
      path: string;
      version: string;
      status: SetupEngineStatus;
    }
  /** missing: nothing at that path. wrong-binary: something is there but it is not this engine. */
  | { result: "missing" | "wrong-binary"; engine: AgentProviderId; message: string };

export interface SetupSignInState {
  engine: AgentProviderId;
  state: "waiting" | "signed-in" | "timed-out" | "cancelled" | "failed";
  message: string | null;
  email: string | null;
  /** The command to run in a terminal instead. */
  command: string;
}

export interface SetupModels {
  engine: AgentProviderId;
  models: AgentModelOption[];
  /** True when the engine could not list its models and this is Markas's built-in list. */
  fallback: boolean;
}

/** What the host sends on the `setup` event channel while it acts on an engine. */
export type SetupEvent =
  | { type: "install-started"; engine: AgentProviderId; command: string }
  /** One line the installer printed. */
  | { type: "install-progress"; engine: AgentProviderId; line: string }
  | { type: "install-finished"; engine: AgentProviderId; result: SetupInstallResult }
  | ({ type: "sign-in" } & SetupSignInState);

export type AgentAuthState =
  | { kind: "unknown" }
  | { kind: "signed-out" }
  | { kind: "unsupported"; accountType: string }
  | { kind: "chatgpt"; email: string | null }
  | { kind: "claude"; email: string | null };

export interface AccountUsageWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface AccountUsageLimit {
  id: string;
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
}

export interface AccountUsage {
  limits: AccountUsageLimit[];
}

export type ExternalDestination = "agent-setup" | "feedback" | "message";

export interface AgentStatus {
  phase: AgentPhase;
  cliVersion: string | null;
  auth: AgentAuthState;
  providers?: AgentProviderStatus[];
  capabilities: {
    chat: CapabilityState;
    browser: CapabilityState;
    computerUse: CapabilityState;
  };
  message: string | null;
  fullAccess: true;
}

export interface BotSummary {
  id: string;
  name: string;
  role: string;
  description: string;
  notifications: boolean;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
  threadId: string | null;
  workspacePath: string;
  preview: string;
  updatedAt: string | null;
  avatarShape: BotAvatarShape;
  avatarColor: BotAvatarColor;
  /** How much the bot may do without asking. */
  access: AccessLevel;
  /** True for a bot made with its whole profile. Such a bot has no first-time questions to ask. */
  madeInFull?: boolean;
}

export const AGENT_MODELS = [
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "claude-fable-5",
  "claude-opus-5",
  "claude-sonnet-5",
] as const;
export type AgentModelId = (typeof AGENT_MODELS)[number];

export const AGENT_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];

export interface AgentModelOption {
  id: AgentModelId;
  name: string;
  description: string;
  defaultReasoningEffort: AgentReasoningEffort;
  supportedReasoningEfforts: AgentReasoningEffort[];
}

export const BOT_AVATAR_SHAPES = [
  "blob",
  "pebble",
  "squircle",
  "tablet",
  "wedge",
  "hex",
  "cloud",
  "teardrop",
] as const;
export type BotAvatarShape = (typeof BOT_AVATAR_SHAPES)[number];

export const BOT_AVATAR_COLORS = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "magenta",
  "gray",
] as const;
export type BotAvatarColor = (typeof BOT_AVATAR_COLORS)[number];

export function isAgentModel(value: unknown): value is AgentModelId {
  return typeof value === "string" && AGENT_MODELS.includes(value as AgentModelId);
}

export function isClaudeModel(model: AgentModelId): boolean {
  return model.startsWith("claude-");
}

export function isReasoningEffort(value: unknown): value is AgentReasoningEffort {
  return (
    typeof value === "string" && AGENT_REASONING_EFFORTS.includes(value as AgentReasoningEffort)
  );
}

export function isAvatarShape(value: unknown): value is BotAvatarShape {
  return typeof value === "string" && BOT_AVATAR_SHAPES.includes(value as BotAvatarShape);
}

export function isAvatarColor(value: unknown): value is BotAvatarColor {
  return typeof value === "string" && BOT_AVATAR_COLORS.includes(value as BotAvatarColor);
}

export interface UpdateBotInput {
  botId: string;
  name?: string;
  role?: string;
  description?: string;
  notifications?: boolean;
  model?: AgentModelId;
  reasoningEffort?: AgentReasoningEffort;
  avatarShape?: BotAvatarShape;
  avatarColor?: BotAvatarColor;
  access?: AccessLevel;
}

export type ConversationMessageAuthor = "user" | "assistant" | "agent" | "system";

export type AttachmentKind = "image" | "file";
export type AttachmentPreviewKind = "image" | "pdf" | "text" | "none";

export interface AttachmentSummary {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  mimeType: string;
  previewKind: AttachmentPreviewKind;
  previewUrl: string | null;
}

export type DraftAttachment = AttachmentSummary;

export interface AttachmentDataInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ImportAttachmentsInput {
  paths: string[];
  data: AttachmentDataInput[];
}

export type AttachmentImportEvent =
  | { type: "started"; requestId: string }
  | { type: "completed"; requestId: string; attachments: DraftAttachment[] }
  | { type: "error"; requestId: string; message: string };

export interface OpenAttachmentInput {
  attachmentId: string;
  action: "open" | "reveal";
}

export type QueueDeliveryStatus =
  | "queued"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

export interface QueueDelivery {
  id: string;
  messageId: string;
  recipientBotId: string;
  sender: { kind: "user" } | { kind: "bot"; botId: string };
  text: string;
  attachments: AttachmentSummary[];
  replyToMessageId: string | null;
  status: QueueDeliveryStatus;
  position: number | null;
  turnId: string | null;
  error: string | null;
  createdAt: string;
}

export interface QueueSnapshot {
  botId: string;
  paused: boolean;
  deliveries: QueueDelivery[];
}

export interface ConversationMessage {
  id: string;
  turnId?: string;
  author: ConversationMessageAuthor;
  text: string;
  createdAt: string;
  status: "streaming" | "completed" | "failed" | "interrupted";
  itemType?: string;
  source?: "user" | "assistant" | "agent" | "system";
  senderBotId?: string;
  replyToMessageId?: string | null;
  attachments?: AttachmentSummary[];
  delivery?: Pick<QueueDelivery, "id" | "status" | "position">;
  exchange?: AgentExchangeSummary;
  reaction?: MessageReaction | null;
}

export const MESSAGE_REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮"] as const;
export const MORE_MESSAGE_REACTIONS = ["🔥", "👏", "🙏", "🤔", "👀", "✅", "🚀", "💯"] as const;
export const ALL_MESSAGE_REACTIONS = [...MESSAGE_REACTIONS, ...MORE_MESSAGE_REACTIONS] as const;
export type MessageReaction =
  | (typeof MESSAGE_REACTIONS)[number]
  | (typeof MORE_MESSAGE_REACTIONS)[number];

export function isMessageReaction(value: unknown): value is MessageReaction {
  return typeof value === "string" && ALL_MESSAGE_REACTIONS.includes(value as MessageReaction);
}

export interface AgentExchangeSummary {
  direction: "incoming" | "outgoing";
  messageId: string;
  senderBotId: string;
  recipientBotIds: string[];
  replyToMessageId: string | null;
  deliveries: Array<Pick<QueueDelivery, "id" | "recipientBotId" | "status" | "position" | "error">>;
}

export interface ConversationSnapshot {
  botId: string;
  threadId: string | null;
  activeTurnId: string | null;
  revision: number;
  messages: ConversationMessage[];
}

export interface SendMessageInput {
  botId: string;
  text: string;
  attachmentDraftIds?: string[];
  replyToMessageId?: string | null;
}

export interface SetMessageReactionInput {
  botId: string;
  messageId: string;
  emoji: MessageReaction | null;
}

export interface QueuedMessageReceipt {
  messageId: string;
  deliveries: Array<{
    id: string;
    recipientBotId: string;
    status: QueueDeliveryStatus;
    position: number | null;
  }>;
}

export interface CancelQueuedMessageInput {
  botId: string;
  deliveryId: string;
}

export interface SetQueuePausedInput {
  botId: string;
  paused: boolean;
}

export interface InterruptTurnInput {
  botId: string;
  turnId: string;
}

export interface AgentPromptQuestion {
  id: string;
  header: string;
  question: string;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
  /** Set when the question is a bot asking permission, so the card can say so clearly. */
  permission?: { kind: AskKind; detail: string };
}

export interface RespondToPromptInput {
  requestId: string | number;
  answers: Record<string, string[]>;
}

export type AgentEvent =
  | { type: "status"; status: AgentStatus }
  | { type: "usage-changed"; usage: AccountUsage }
  | { type: "bots-changed"; bots: BotSummary[] }
  | { type: "conversation"; snapshot: ConversationSnapshot }
  | {
      type: "conversation-delta";
      botId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      delta: string;
      createdAt: string;
      revision: number;
    }
  | { type: "queue-changed"; snapshot: QueueSnapshot }
  | { type: "turn-started"; botId: string; threadId: string; turnId: string }
  | {
      type: "turn-completed";
      botId: string;
      threadId: string;
      turnId: string;
      status: string;
    }
  | {
      type: "prompt";
      requestId: string | number;
      botId: string;
      threadId: string;
      turnId: string;
      questions: AgentPromptQuestion[];
    }
  | { type: "browser-changed"; tabs: BrowserTab[]; activeTabId: string | null }
  | { type: "browser-control-changed"; state: BrowserControlState }
  | { type: "error"; botId?: string; code: string; message: string };

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  ownerThreadId: string | null;
  ownerBotId: string | null;
}

export type BrowserControlPhase = "acting" | "waiting";

export type BrowserControlAction =
  | "open"
  | "list-tabs"
  | "snapshot"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "back"
  | "forward"
  | "reload"
  | "screenshot"
  | "close-tab";

export interface BrowserControlSession {
  id: string;
  threadId: string;
  turnId: string;
  callId: string;
  tabId: string | null;
  action: BrowserControlAction;
  phase: BrowserControlPhase;
  startedAt: string;
}

/** Who is driving a tab right now. */
export type BrowserController = "bot" | "person";

/** A hand-off: a tab the person controls, because the bot passed a step on or the person took over. */
export interface BrowserHandOff {
  tabId: string;
  botId: string | null;
  threadId: string | null;
  /** Why the person is needed, in the bot's or the person's own words. */
  reason: string;
  requestedBy: BrowserController;
  startedAt: string;
}

export interface BrowserControlState {
  sessions: BrowserControlSession[];
  /** Tabs the person controls. A tab that is not listed is controlled by its bot. */
  handOffs?: BrowserHandOff[];
}

/** One look at a bot's tab, for the Browser panel to draw. */
export interface BrowserTabView {
  tab: BrowserTab;
  controller: BrowserController;
  handOff: BrowserHandOff | null;
  /** A JPEG data URL of the visible page, or null when the page cannot be drawn right now. */
  image: string | null;
  capturedAt: string;
  /** A plain sentence when something is wrong with the tab, such as a crashed page. */
  problem: string | null;
}

export interface BrowserTakeControlInput {
  tabId: string;
  reason?: string;
}

/**
 * Something the person does on a page they have taken over, through the Browser panel.
 * A click is given as a share of the picture's width and height, from 0 to 1.
 */
export type BrowserPersonInput = { tabId: string } & (
  | { kind: "click"; x: number; y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; deltaY: number }
);

/** The keys the Browser panel passes on to a page, besides plain typing. */
export const BROWSER_PERSON_KEYS = [
  "Enter",
  "Backspace",
  "Delete",
  "Tab",
  "Shift+Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ControlOrMeta+a",
] as const;

export interface BrowserResumeInput {
  tabId: string;
  /** Something the person wants the bot to know, such as "the code was accepted". */
  note?: string;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserOpenInput {
  url: string;
  ownerThreadId?: string | null;
  ownerBotId?: string | null;
}

export interface BrowserVisibilityInput {
  visible: boolean;
  bounds?: BrowserBounds;
}

export interface AgentDesktopApi {
  getStatus: () => Promise<AgentStatus>;
  getUsage: () => Promise<AccountUsage>;
  listModels: () => Promise<AgentModelOption[]>;
  listBots: () => Promise<BotSummary[]>;
  createBot: () => Promise<BotSummary>;
  updateBot: (input: UpdateBotInput) => Promise<BotSummary>;
  /** Moves the bot to the trash, where it waits BOT_TRASH_DAYS before it is gone for good. */
  deleteBot: (botId: string) => Promise<void>;
  listDeletedBots: () => Promise<DeletedBot[]>;
  /** Puts a deleted bot back as it was. */
  restoreBot: (botId: string) => Promise<BotSummary>;
  /** Removes a deleted bot and everything it had, at once. This cannot be undone. */
  purgeBot: (botId: string) => Promise<void>;
  readConversation: (botId: string) => Promise<ConversationSnapshot>;
  chooseAttachments: () => Promise<DraftAttachment[]>;
  onAttachmentImport: (listener: (event: AttachmentImportEvent) => void) => () => void;
  discardDraftAttachment: (attachmentId: string) => Promise<void>;
  openAttachment: (input: OpenAttachmentInput) => Promise<void>;
  sendMessage: (input: SendMessageInput) => Promise<QueuedMessageReceipt>;
  setMessageReaction: (input: SetMessageReactionInput) => Promise<void>;
  listQueue: (botId: string) => Promise<QueueSnapshot>;
  cancelQueuedMessage: (input: CancelQueuedMessageInput) => Promise<void>;
  setQueuePaused: (input: SetQueuePausedInput) => Promise<void>;
  interrupt: (input: InterruptTurnInput) => Promise<void>;
  respondToPrompt: (input: RespondToPromptInput) => Promise<void>;
  onEvent: (listener: (event: AgentEvent) => void) => () => void;
}

export interface BrowserDesktopApi {
  open: (input: BrowserOpenInput) => Promise<BrowserTab>;
  activate: (tabId: string) => Promise<void>;
  close: (tabId: string) => Promise<void>;
  listTabs: () => Promise<BrowserTab[]>;
  getControlState: () => Promise<BrowserControlState>;
  setVisible: (input: BrowserVisibilityInput) => Promise<void>;
}

export interface UpdateDesktopApi {
  getStatus: () => Promise<UpdateStatus>;
  check: () => Promise<UpdateStatus>;
  download: () => Promise<UpdateStatus>;
  install: () => Promise<void>;
  onEvent: (listener: (status: UpdateStatus) => void) => () => void;
}

export interface MaintenanceDesktopApi {
  exportData: () => Promise<ExportResult>;
  exportDiagnostics: () => Promise<ExportResult>;
}

export interface MarkasDesktopApi {
  getAppInfo: () => Promise<AppInfo>;
  openExternal: (destination: ExternalDestination) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
  agent: AgentDesktopApi;
  browser: BrowserDesktopApi;
  update: UpdateDesktopApi;
  maintenance: MaintenanceDesktopApi;
}

// Bot drafts, bot files and ready-made bots. The host methods are called by name:
//   library.list() -> LibraryBotSummary[]
//   library.read(id) -> BotDraft
//   library.importFile(ImportBotFileInput) -> ImportBotFileResult
//   library.exportBot(botId) -> ExportBotResult
//   agent.createBotFromDraft(BotDraft) -> CreateBotFromDraftResult
//   agent.previewBotFolder(PreviewBotFolderInput) -> BotFolderPreview
export type {
  BotDraft,
  BotFileProblem,
  BotFolderPreview,
  BotSigil,
  CreateBotFromDraftResult,
  DraftRound,
  ExportBotResult,
  ImportBotFileInput,
  ImportBotFileResult,
  LibraryBotSummary,
  PreviewBotFolderInput,
} from "./bot-draft";

/** How long a deleted bot can still be put back. */
export const BOT_TRASH_DAYS = 30;

/** A bot the person deleted, kept for a while so the delete can be undone. */
export interface DeletedBot {
  bot: BotSummary;
  deletedAt: string;
  /** When the bot and everything it had is removed for good. */
  purgeAt: string;
}
