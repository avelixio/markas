import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type {
  AgentEvent,
  AgentModelId,
  AgentModelOption,
  AgentReasoningEffort,
  AgentStatus,
  AttachmentSummary,
  BotAvatarColor,
  BotAvatarShape,
  BrowserControlAction,
  BrowserControlState,
  BrowserTab,
  DraftAttachment,
  MessageReaction,
  QueueSnapshot,
  UpdateBotInput,
} from "../../../shared/ipc";
import { MESSAGE_REACTIONS, MORE_MESSAGE_REACTIONS } from "../../../shared/ipc";
import { AccessChip, AccessControl } from "../access/AccessControl";
import { BrowserPreview, HandOffCard, siteOf } from "../browser/HandOff";
import type { BotMessage, BotProfile } from "../data";
import { AVATAR_COLORS, AVATAR_SHAPES, ONBOARDING_TOPICS } from "../data";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { AgentAvatar } from "./AgentAvatar";
import { ComposerEditor, expandComposerMentions } from "./ComposerEditor";
import { ContextBreakdown } from "./ContextBreakdown";
import { ChoiceCard, PromptCard } from "./ConversationPrompts";
import { ExportBot } from "./ExportBot";
import { FilesPanel } from "./FilesPanel";
import { PanelResizer, readPanelWidth, savePanelWidth } from "./PanelResizer";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { SidebarToggleIcon } from "./Sidebar";

interface ConversationProps {
  agentStatus: AgentStatus;
  bot: BotProfile | undefined;
  bots: BotProfile[];
  modelOptions: AgentModelOption[];
  messages: BotMessage[];
  loaded: boolean;
  activeTurnId: string | null | undefined;
  agentPickerOpen: boolean;
  creatingAgent: boolean;
  settingsRequest: { botId: string; nonce: number } | null;
  onboardingRequest: { botId: string; nonce: number } | null;
  queue: QueueSnapshot | undefined;
  browserTabs: BrowserTab[];
  activeBrowserTabId: string | null;
  browserControlState: BrowserControlState;
  leftSidebarCollapsed: boolean;
  prompt: Extract<AgentEvent, { type: "prompt" }> | undefined;
  onCloseAgentPicker: () => void;
  onCreateAgent: () => void;
  onSelectAgent: (botId: string) => void;
  onUpdateBot: (botId: string, updates: Omit<UpdateBotInput, "botId">) => Promise<void>;
  onSendMessage: (
    body: string,
    attachmentDraftIds: string[],
    replyToMessageId: string | null,
  ) => Promise<boolean>;
  onCompleteOnboarding: (
    answer: string,
    model: AgentModelId,
    reasoningEffort: AgentReasoningEffort,
  ) => Promise<boolean>;
  onAnswerPrompt: (answers: Record<string, string[]>) => Promise<boolean>;
  onCancelQueuedMessage: (deliveryId: string) => void;
  onResumeQueue: () => void;
  onActivateBrowserTab: (tabId: string) => void;
  onCloseBrowserTab: (tabId: string) => void;
  onToggleLeftSidebar: () => void;
  onOpenAgentSetup: () => Promise<void>;
  onStop: () => void;
}

interface ComposerDraft {
  text: string;
  attachments: DraftAttachment[];
  replyToMessageId: string | null;
}

interface MediaPreview {
  attachment: AttachmentSummary;
  text: string | null;
  loading: boolean;
  error: string | null;
}

type RightPanelMode = "none" | "browser" | "settings" | "files";

/** What the bot is doing right now, if anything. */
type AgentActivity = "queued" | "working" | null;

const EMPTY_DRAFT: ComposerDraft = { text: "", attachments: [], replyToMessageId: null };
const SETTINGS_PANEL_STORAGE_KEY = "markas:settings-panel-width";
const SETTINGS_PANEL_DEFAULT = 296;
const SETTINGS_PANEL_MIN = 180;
const SETTINGS_PANEL_MAX = 1600;
const BROWSER_PANEL_STORAGE_KEY = "markas:browser-panel-width";
const BROWSER_PANEL_DEFAULT = 380;
const BROWSER_PANEL_MIN = 220;
const BROWSER_PANEL_MAX = 1600;
const CONVERSATION_PANEL_MIN = 96;

/** What a bot is doing in the browser, in words. */
const browserActionLabel = (action: BrowserControlAction) => t(`chat.browser.action.${action}`);

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <path d="m5 5 10 10M15 5 5 15" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-current">
      <rect x="6" y="6" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="settings-back-icon fill-none stroke-current">
      <path d="m12.5 4-6 6 6 6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <path d="M10 4v12M4 10h12" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" class="message-link-fallback">
      <path
        d="M6.6 9.4 9.4 6.6M5.2 10.8l-1 .9a2.2 2.2 0 0 1-3.1-3.1l2.1-2.1a2.2 2.2 0 0 1 3.1 0M10.8 5.2l1-.9a2.2 2.2 0 1 1 3.1 3.1l-2.1 2.1a2.2 2.2 0 0 1-3.1 0"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.3"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="file-icon fill-none stroke-current">
      <path d="M5 2.5h6l4 4V17.5H5z" stroke-width="1.2" stroke-linejoin="round" />
      <path d="M11 2.5v4h4M7.5 11h5M7.5 14h5" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  );
}

function ReactionIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M7.25 8h.01M12.75 8h.01M6.9 11.5c.85 1.25 1.88 1.85 3.1 1.85s2.25-.6 3.1-1.85" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m8.25 5-4.5 4.1 4.5 4.1V10c4.1 0 6.45 1.35 8 4.35-.25-5.2-2.9-7.65-8-7.65z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <circle cx="5" cy="10" r="1" />
      <circle cx="10" cy="10" r="1" />
      <circle cx="15" cy="10" r="1" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
      <path d="M13 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v6.5A1.5 1.5 0 0 0 5 13h1.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m4.5 10.5 3.25 3.25L15.5 6" />
    </svg>
  );
}

function ComputerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <rect x="2.5" y="3" width="15" height="10" rx="1.5" stroke-width="1.3" />
      <path d="M7 17h6M10 13v4" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

function BrowserControlIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" class="browser-tab-control-icon">
      <path d="M3.25 2.5 11 8.2 7.55 9.3l-1.5 3.45z" />
      <circle cx="11.75" cy="3.75" r="1.45" />
    </svg>
  );
}

function BrowserReloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="browser-toolbar-icon fill-none stroke-current"
    >
      <path d="M15.5 7.5A6 6 0 1 0 16 11" stroke-width="1.3" stroke-linecap="round" />
      <path d="M15.5 4.5v3h-3" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function AttachmentCards(props: {
  attachments: AttachmentSummary[];
  onPreview: (attachment: AttachmentSummary) => void;
  onAction: (attachment: AttachmentSummary, action: "open" | "reveal") => void;
}) {
  return (
    <div data-component="AttachmentCards" class="message-attachments">
      <For each={props.attachments}>
        {(attachment) => (
          <div data-slot="attachment" class="message-attachment">
            <button
              type="button"
              class="attachment-preview-button"
              disabled={attachment.previewKind === "none"}
              aria-label={t("chat.attachment.preview", { name: attachment.name })}
              onClick={() => props.onPreview(attachment)}
            >
              <Show
                when={attachment.previewKind === "image"}
                fallback={<span class="file-type-badge">{fileBadge(attachment)}</span>}
              >
                <img src={attachment.previewUrl ?? ""} alt="" />
              </Show>
              <span>
                <strong>{attachment.name}</strong>
                <small>{formatFileSize(attachment.size)}</small>
              </span>
            </button>
            <div data-slot="actions" class="attachment-actions">
              <button type="button" onClick={() => props.onAction(attachment, "open")}>
                {t("chat.attachment.open")}
              </button>
              <button type="button" onClick={() => props.onAction(attachment, "reveal")}>
                {t("chat.attachment.folder")}
              </button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function ExchangeAgentAvatar(props: { bot: BotProfile | undefined }) {
  return <AgentAvatar bot={props.bot} class="exchange-agent-avatar" />;
}

function ExchangeSystemRow(props: {
  message: BotMessage;
  bots: BotProfile[];
  onSelectAgent: (botId: string) => void;
}) {
  const [agentsOpen, setAgentsOpen] = createSignal(false);
  const exchange = () => props.message.exchange;
  const recipients = () => exchange()?.recipientBotIds ?? [];
  const sender = () => {
    const senderId = exchange()?.senderBotId;
    return props.bots.find((bot) => bot.id === senderId);
  };
  const singleRecipient = () => {
    const recipientId = recipients()[0];
    return recipientId ? props.bots.find((bot) => bot.id === recipientId) : undefined;
  };
  const senderName = () => sender()?.name ?? exchange()?.senderBotId ?? t("common.bot");
  const recipientName = () => singleRecipient()?.name ?? recipients()[0] ?? t("common.bot");

  return (
    <div data-component="ExchangeSystemRow" class="exchange-system-row">
      <Show
        when={exchange()?.direction === "outgoing"}
        fallback={
          <>
            <span class="exchange-system-label">{t("chat.exchange.from")}</span>
            <button
              type="button"
              class="exchange-agent-trigger exchange-agent-trigger-incoming"
              aria-label={t("chat.exchange.open", { name: senderName() })}
              onClick={() => {
                const senderId = exchange()?.senderBotId;
                if (senderId) props.onSelectAgent(senderId);
              }}
            >
              <ExchangeAgentAvatar bot={sender()} />
              <span>{senderName()}</span>
            </button>
          </>
        }
      >
        <span class="exchange-system-label">{t("chat.exchange.to")}</span>
        <Show
          when={recipients().length === 1}
          fallback={
            <div class="exchange-agent-picker">
              <button
                type="button"
                class="exchange-agent-trigger exchange-agent-trigger-outgoing"
                aria-haspopup="menu"
                aria-expanded={agentsOpen()}
                aria-label={t("chat.exchange.showList", { count: recipients().length })}
                onClick={() => setAgentsOpen((open) => !open)}
              >
                <span class="exchange-avatar-stack" aria-hidden="true">
                  <For each={recipients().slice(0, 3)}>
                    {(recipientId) => (
                      <ExchangeAgentAvatar bot={props.bots.find((bot) => bot.id === recipientId)} />
                    )}
                  </For>
                </span>
                <span>{t("chat.exchange.bots", { count: recipients().length })}</span>
              </button>
              <Show when={agentsOpen()}>
                <div class="exchange-agent-menu" role="menu">
                  <For each={recipients()}>
                    {(recipientId) => {
                      const recipient = () => props.bots.find((bot) => bot.id === recipientId);
                      return (
                        <button
                          type="button"
                          role="menuitem"
                          class="exchange-agent-menu-item"
                          onClick={() => {
                            setAgentsOpen(false);
                            props.onSelectAgent(recipientId);
                          }}
                        >
                          <ExchangeAgentAvatar bot={recipient()} />
                          <span>{recipient()?.name ?? recipientId}</span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          }
        >
          <button
            type="button"
            class="exchange-agent-trigger exchange-agent-trigger-single"
            aria-label={t("chat.exchange.open", { name: recipientName() })}
            title={recipientName()}
            onClick={() => {
              const recipientId = recipients()[0];
              if (recipientId) props.onSelectAgent(recipientId);
            }}
          >
            <ExchangeAgentAvatar bot={singleRecipient()} />
            <span>{recipientName()}</span>
          </button>
        </Show>
      </Show>
      <time dateTime={props.message.time}>{props.message.time || t("common.now")}</time>
    </div>
  );
}

function MessageBody(props: {
  message: BotMessage;
  referencedMessage?: BotMessage;
  bots: BotProfile[];
  onSelectAgent: (botId: string) => void;
  onOpenLink: (url: string) => void;
  onPreview: (attachment: AttachmentSummary) => void;
  onAttachmentAction: (attachment: AttachmentSummary, action: "open" | "reveal") => void;
}) {
  return (
    <>
      <Show when={props.referencedMessage}>
        {(referenced) => (
          <div data-slot="reply-context" class="message-reply-context">
            <span>{referenced().author === "you" ? t("common.you") : t("common.bot")}</span>
            <p>{referenced().body || t("chat.message.attachment")}</p>
          </div>
        )}
      </Show>
      <Show when={props.message.body}>
        <p class="message-copy">
          <RichMessageText
            body={props.message.body}
            bots={props.bots}
            onSelectAgent={props.onSelectAgent}
            onOpenLink={props.onOpenLink}
          />
        </p>
      </Show>
      <Show when={props.message.status}>
        {(status) => (
          <div data-slot="status" class="message-status">
            <span />
            {t(status().key, status().values)}
          </div>
        )}
      </Show>
      <Show when={props.message.attachments?.length}>
        <AttachmentCards
          attachments={props.message.attachments ?? []}
          onPreview={props.onPreview}
          onAction={props.onAttachmentAction}
        />
      </Show>
    </>
  );
}

function MessageActions(props: {
  message: BotMessage;
  pickerOpen: boolean;
  moreOpen: boolean;
  expandedEmoji: boolean;
  copied: boolean;
  onTogglePicker: () => void;
  onToggleMore: () => void;
  onExpandEmoji: () => void;
  onReact: (emoji: MessageReaction | null) => void;
  onReply: () => void;
  onCopy: () => void;
}) {
  return (
    <div
      data-component="MessageActions"
      class="message-actions"
      classList={{ "message-actions-open": props.pickerOpen || props.moreOpen }}
      role="toolbar"
      aria-label={
        props.message.author === "you"
          ? t("chat.message.actions.you")
          : t("chat.message.actions.bot")
      }
    >
      <div class="message-action-popover-anchor">
        <button
          type="button"
          class="message-action-button"
          aria-label={t("chat.message.react")}
          aria-expanded={props.pickerOpen}
          onClick={props.onTogglePicker}
        >
          <ReactionIcon />
        </button>
        <Show when={props.pickerOpen}>
          <div
            data-slot="reaction-picker"
            class="reaction-picker"
            role="menu"
            aria-label={t("chat.message.react.choose")}
          >
            <div class="reaction-picker-row">
              <For each={MESSAGE_REACTIONS}>
                {(emoji) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={props.message.reaction === emoji}
                    aria-label={t("chat.message.react.with", { emoji })}
                    onClick={() => props.onReact(props.message.reaction === emoji ? null : emoji)}
                  >
                    {emoji}
                  </button>
                )}
              </For>
              <button
                type="button"
                class="reaction-more-button"
                aria-label={t("chat.message.react.more")}
                aria-expanded={props.expandedEmoji}
                onClick={props.onExpandEmoji}
              >
                <PlusIcon />
              </button>
            </div>
            <Show when={props.expandedEmoji}>
              <div class="reaction-picker-row reaction-picker-more">
                <For each={MORE_MESSAGE_REACTIONS}>
                  {(emoji) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={props.message.reaction === emoji}
                      aria-label={t("chat.message.react.with", { emoji })}
                      onClick={() => props.onReact(props.message.reaction === emoji ? null : emoji)}
                    >
                      {emoji}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
      <button
        type="button"
        class="message-action-button"
        aria-label={
          props.message.author === "you" ? t("chat.message.reply.you") : t("chat.message.reply.bot")
        }
        onClick={props.onReply}
      >
        <ReplyIcon />
      </button>
      <div class="message-action-popover-anchor">
        <button
          type="button"
          class="message-action-button"
          aria-label={t("chat.message.more")}
          aria-expanded={props.moreOpen}
          onClick={props.onToggleMore}
        >
          <MoreIcon />
        </button>
        <Show when={props.moreOpen}>
          <div class="message-more-menu" role="menu">
            <button type="button" role="menuitem" onClick={props.onCopy}>
              {props.copied ? <CheckIcon /> : <CopyIcon />}
              <span>{props.copied ? t("chat.message.copied") : t("chat.message.copy")}</span>
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}

function RichMessageText(props: {
  body: string;
  bots: BotProfile[];
  onSelectAgent: (botId: string) => void;
  onOpenLink: (url: string) => void;
}) {
  const parts = createMemo(() => richMessageParts(props.body, props.bots));
  return (
    <For each={parts()}>
      {(part) => {
        if (part.url) {
          return (
            <a
              class="message-link"
              href={part.url}
              title={part.url}
              onClick={(event) => {
                event.preventDefault();
                props.onOpenLink(part.url ?? "");
              }}
            >
              <span class="message-link-icon" aria-hidden="true">
                <LinkIcon />
                {/* The page's rules load pictures from https only; any other icon would be refused. */}
                <Show when={faviconUrl(part.url)}>
                  {(icon) => (
                    <img
                      src={icon()}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(event) => event.currentTarget.remove()}
                    />
                  )}
                </Show>
              </span>
              {part.text}
            </a>
          );
        }
        if (part.bot) {
          return (
            <button
              type="button"
              class="message-agent-tag"
              aria-label={t("chat.message.openBot", { name: part.bot.name })}
              onClick={() => props.onSelectAgent(part.bot?.id ?? "")}
            >
              <AgentAvatar bot={part.bot} />
              <span>{part.bot.name}</span>
            </button>
          );
        }
        return part.text;
      }}
    </For>
  );
}

interface RichMessagePart {
  text: string;
  bot?: BotProfile;
  url?: string;
}

function richMessageParts(body: string, bots: BotProfile[]): RichMessagePart[] {
  const parts: RichMessagePart[] = [];
  for (const part of linkedMessageParts(body)) {
    if (part.url) parts.push(part);
    else parts.push(...taggedMessageParts(part.text, bots));
  }
  return parts;
}

function linkedMessageParts(body: string): RichMessagePart[] {
  const expression = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/giu;
  const parts: RichMessagePart[] = [];
  let cursor = 0;
  for (const match of body.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: body.slice(cursor, index) });
    const markdownUrl = match[2];
    const rawUrl = match[3];
    const rawLink = markdownUrl ?? rawUrl ?? "";
    const cleanLink = rawLink.replace(/[.,!?;:]+$/u, "");
    const url = safeBrowserUrl(cleanLink);
    if (!url) {
      parts.push({ text: match[0] });
    } else {
      parts.push({ text: match[1] ?? cleanLink, url });
      const trailingText = rawLink.slice(cleanLink.length);
      if (trailingText) parts.push({ text: trailingText });
    }
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts.length > 0 ? parts : [{ text: body }];
}

function safeBrowserUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The icon of a linked website, or null for one the page may not load pictures from. */
function faviconUrl(value: string): string | null {
  const url = new URL(value);
  return url.protocol === "https:" ? `${url.origin}/favicon.ico` : null;
}

function taggedMessageParts(body: string, bots: BotProfile[]) {
  const orderedBots = [...bots].sort((left, right) => right.name.length - left.name.length);
  if (orderedBots.length === 0) return [{ text: body, bot: undefined }];
  const botsByName = new Map(orderedBots.map((bot) => [bot.name.toLocaleLowerCase(), bot]));
  const expression = new RegExp(
    `@(${orderedBots.map((bot) => escapeExpression(bot.name)).join("|")})(?=$|[\\s.,!?;:()\\[\\]{}])`,
    "giu",
  );
  const parts: Array<{ text: string; bot: BotProfile | undefined }> = [];
  let cursor = 0;
  for (const match of body.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: body.slice(cursor, index), bot: undefined });
    const name = match[1] ?? "";
    const bot = botsByName.get(name.toLocaleLowerCase());
    parts.push({ text: match[0], bot });
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), bot: undefined });
  return parts.length > 0 ? parts : [{ text: body, bot: undefined }];
}

function escapeExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function AgentActivityIndicator(props: { bot: BotProfile | undefined; state: AgentActivity }) {
  return (
    <div
      data-component="AgentActivityIndicator"
      class="agent-activity-entry"
      classList={{ "agent-activity-entry-visible": props.state !== null }}
      role="status"
      aria-hidden={props.state === null}
      aria-label={
        props.state
          ? t(`chat.activity.${props.state}.label`, { name: props.bot?.name ?? t("common.bot") })
          : undefined
      }
    >
      <AgentAvatar bot={props.bot} class="agent-activity-avatar" />
      <div class="agent-activity-bubble" aria-hidden="true">
        <span>{t(`chat.activity.${props.state ?? "working"}`)}</span>
        <span class="agent-activity-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

function ThinkingDisclosure(props: { message: BotMessage }) {
  const stepCount = () => props.message.items?.length ?? 0;
  return (
    <article data-component="ThinkingDisclosure" class="thinking-entry">
      <details class="thinking-disclosure">
        <summary data-slot="header" aria-label={t("chat.thinking.show")}>
          <span class="thinking-mark" aria-hidden="true">
            <ThinkingIcon />
          </span>
          <span>{t("chat.thinking")}</span>
          <Show when={props.message.streaming}>
            <span class="thinking-live-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </Show>
          <Show when={!props.message.streaming && stepCount() > 1}>
            <small>{t("chat.thinking.steps", { count: stepCount() })}</small>
          </Show>
          <span class="thinking-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </summary>
        <div data-slot="body" class="thinking-details">
          <For each={props.message.items ?? []}>{(item) => <p>{item}</p>}</For>
        </div>
      </details>
    </article>
  );
}

export function Conversation(props: ConversationProps) {
  const agentReady = () => props.agentStatus.phase === "ready";
  const [drafts, setDrafts] = createSignal<Record<string, ComposerDraft>>({});
  const [showAttachments, setShowAttachments] = createSignal(false);
  const [attachmentBusy, setAttachmentBusy] = createSignal(false);
  const [composerError, setComposerError] = createSignal<string | null>(null);
  const [settingsSaveError, setSettingsSaveError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [dropActive, setDropActive] = createSignal(false);
  const [rightPanels, setRightPanels] = createSignal<Record<string, RightPanelMode>>({});
  const [settingsName, setSettingsName] = createSignal("");
  const [settingsTitle, setSettingsTitle] = createSignal("");
  const [settingsDescription, setSettingsDescription] = createSignal("");
  const [settingsNotifications, setSettingsNotifications] = createSignal(true);
  const [settingsModel, setSettingsModel] = createSignal<AgentModelId>("gpt-5.6-luna");
  const [settingsReasoning, setSettingsReasoning] = createSignal<AgentReasoningEffort>("medium");
  const [onboardingBots, setOnboardingBots] = createSignal<Record<string, true>>({});
  const [modelConfirmedBots, setModelConfirmedBots] = createSignal<Record<string, true>>({});
  const [completedOnboardingBots, setCompletedOnboardingBots] = createSignal<Record<string, true>>(
    {},
  );
  const [avatarPickerOpen, setAvatarPickerOpen] = createSignal(false);
  const [avatarShape, setAvatarShape] = createSignal<BotAvatarShape>("blob");
  const [avatarColor, setAvatarColor] = createSignal<BotAvatarColor>("orange");
  const [browserAddress, setBrowserAddress] = createSignal("https://www.google.com");
  /** Why the last address could not be opened, in the host's words. */
  const [browserProblem, setBrowserProblem] = createSignal<string | null>(null);
  const [mediaPreview, setMediaPreview] = createSignal<MediaPreview | null>(null);
  const [pickerQuery, setPickerQuery] = createSignal("");
  const [activePickerOption, setActivePickerOption] = createSignal(0);
  const [openReactionMessageId, setOpenReactionMessageId] = createSignal<string | null>(null);
  const [openMoreMessageId, setOpenMoreMessageId] = createSignal<string | null>(null);
  const [expandedEmojiMessageId, setExpandedEmojiMessageId] = createSignal<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = createSignal<string | null>(null);
  const [settingsPanelWidth, setSettingsPanelWidth] = createSignal(
    readPanelWidth(
      SETTINGS_PANEL_STORAGE_KEY,
      SETTINGS_PANEL_DEFAULT,
      SETTINGS_PANEL_MIN,
      SETTINGS_PANEL_MAX,
    ),
  );
  const [browserPanelWidth, setBrowserPanelWidth] = createSignal(
    readPanelWidth(
      BROWSER_PANEL_STORAGE_KEY,
      BROWSER_PANEL_DEFAULT,
      BROWSER_PANEL_MIN,
      BROWSER_PANEL_MAX,
    ),
  );
  const selectedModel = createMemo(() =>
    props.modelOptions.find((option) => option.id === settingsModel()),
  );
  const reasoningOptions = createMemo(
    () => selectedModel()?.supportedReasoningEfforts ?? ["medium" as const],
  );
  const onboardingActive = createMemo(() => {
    const botId = props.bot?.id;
    return Boolean(botId && onboardingBots()[botId]);
  });
  const onboardingModelConfirmed = createMemo(() => {
    const botId = props.bot?.id;
    return Boolean(botId && onboardingActive() && modelConfirmedBots()[botId]);
  });
  const onboardingModelRequired = createMemo(
    () => agentReady() && onboardingActive() && !onboardingModelConfirmed(),
  );
  const currentDraft = createMemo(() => {
    const id = props.bot?.id;
    return id ? (drafts()[id] ?? EMPTY_DRAFT) : EMPTY_DRAFT;
  });
  const replyTarget = createMemo(() => {
    const id = currentDraft().replyToMessageId;
    return id ? props.messages.find((message) => message.id === id) : undefined;
  });
  const filteredPickerBots = createMemo(() => {
    const query = pickerQuery().trim().toLowerCase();
    return query
      ? props.bots.filter((bot) => `${bot.name} ${bot.role}`.toLowerCase().includes(query))
      : props.bots;
  });
  const activeRightPanel = createMemo<RightPanelMode>(() => {
    if (props.agentPickerOpen) return "none";
    const botId = props.bot?.id;
    return botId ? (rightPanels()[botId] ?? "none") : "none";
  });
  const messageLabel = () =>
    !props.agentPickerOpen && props.bot
      ? t("composer.message", { name: props.bot.name })
      : t("composer.message.any");
  const screenOpen = () => activeRightPanel() === "browser";
  const settingsOpen = () => activeRightPanel() === "settings";
  const filesOpen = () => activeRightPanel() === "files";
  /** Counts the times the person asked to look at the bot's page again. */
  const [previewLooks, setPreviewLooks] = createSignal(0);
  const browserTabs = createMemo(() => {
    const bot = props.bot;
    if (!bot) return [];
    return props.browserTabs.filter((tab) =>
      tab.ownerBotId
        ? tab.ownerBotId === bot.id
        : Boolean(bot.threadId && tab.ownerThreadId === bot.threadId),
    );
  });
  const activeBrowserTab = createMemo(
    () => browserTabs().find((tab) => tab.id === props.activeBrowserTabId) ?? browserTabs()[0],
  );
  const activeBrowserControl = createMemo(() => {
    const sessions = props.browserControlState.sessions;
    const activeTab = activeBrowserTab();
    const forActiveTab = activeTab?.ownerThreadId
      ? sessions.filter((session) => session.threadId === activeTab.ownerThreadId)
      : [];
    const forActiveBot = props.bot?.threadId
      ? sessions.filter((session) => session.threadId === props.bot?.threadId)
      : [];
    const candidates = forActiveTab.length > 0 ? forActiveTab : forActiveBot;
    return (
      [...candidates]
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .find((session) => session.phase === "acting") ?? candidates.at(-1)
    );
  });
  /** The tab of this bot that is in the person's hands, when there is one. */
  const botHandOff = createMemo(() => {
    const bot = props.bot;
    if (!bot) return undefined;
    return (props.browserControlState.handOffs ?? []).find((handOff) =>
      handOff.botId
        ? handOff.botId === bot.id
        : Boolean(bot.threadId && handOff.threadId === bot.threadId),
    );
  });
  const browserControlBot = createMemo(() => {
    const control = activeBrowserControl();
    return control ? props.bots.find((bot) => bot.threadId === control.threadId) : undefined;
  });
  const browserControlForTab = (tab: BrowserTab) => {
    const sessions = props.browserControlState.sessions;
    return (
      sessions.find((session) => session.tabId === tab.id) ??
      sessions.find(
        (session) =>
          session.tabId === null &&
          tab.id === activeBrowserTab()?.id &&
          session.threadId === tab.ownerThreadId,
      )
    );
  };
  const browserControllerForTab = (tab: BrowserTab) => {
    const control = browserControlForTab(tab);
    return control ? props.bots.find((bot) => bot.threadId === control.threadId) : undefined;
  };
  const agentActivity = createMemo<AgentActivity>(() => {
    if (
      props.activeTurnId ||
      props.queue?.deliveries.some(
        (delivery) => delivery.status === "starting" || delivery.status === "running",
      )
    ) {
      return "working";
    }
    if (
      !props.queue?.paused &&
      props.queue?.deliveries.some((delivery) => delivery.status === "queued")
    ) {
      return "queued";
    }
    return null;
  });
  const queueBarVisible = createMemo(
    () =>
      Boolean(props.queue?.paused) ||
      Boolean(props.queue?.deliveries.some((item) => item.status === "queued")),
  );
  const seenMessageIds = new Set<string>();
  const [fadeAtTop, setFadeAtTop] = createSignal(false);
  const [fadeAtBottom, setFadeAtBottom] = createSignal(false);
  let scrollElement: HTMLDivElement | undefined;
  let conversationPanel: HTMLElement | undefined;
  let browserSurface: HTMLDivElement | undefined;
  let browserResizeObserver: ResizeObserver | undefined;
  let browserWindowResizeHandler: (() => void) | undefined;
  let browserVisibilityFrame: number | undefined;
  let browserBoundsFrame: number | undefined;
  let browserVisibilityGeneration = 0;
  let pickerInput: HTMLInputElement | undefined;
  let stickToLatest = true;
  let lastConversationBotId: string | undefined;
  let lastPanelBotId: string | undefined;
  let lastHandledSettingsRequestNonce: number | undefined;
  let lastHandledOnboardingRequestNonce: number | undefined;
  let lastSettingsSignature: string | undefined;
  const importTargetBots = new Map<string, string>();

  async function saveBotPatch(updates: Omit<UpdateBotInput, "botId">): Promise<boolean> {
    const botId = props.bot?.id;
    if (!botId) return false;
    setSettingsSaveError(null);
    try {
      await props.onUpdateBot(botId, updates);
      return true;
    } catch (error) {
      setSettingsSaveError(error instanceof Error ? error.message : t("settings.saveFailed"));
      return false;
    }
  }

  async function selectModel(
    model: AgentModelId,
    persist = true,
    reportComposerError = false,
  ): Promise<boolean> {
    const option = props.modelOptions.find((candidate) => candidate.id === model);
    if (!option) return false;
    const reasoningEffort = option.supportedReasoningEfforts.includes(settingsReasoning())
      ? settingsReasoning()
      : option.defaultReasoningEffort;
    const previousModel = settingsModel();
    const previousReasoning = settingsReasoning();
    setSettingsModel(model);
    setSettingsReasoning(reasoningEffort);
    if (!persist) return true;
    if (reportComposerError) setComposerError(null);
    const saved = await saveBotPatch({ model, reasoningEffort });
    if (saved) return true;
    setSettingsModel(previousModel);
    setSettingsReasoning(previousReasoning);
    if (reportComposerError) setComposerError(t("chat.model.changeFailed"));
    return false;
  }

  async function selectAndConfirmModel(model: AgentModelId): Promise<void> {
    if (!(await selectModel(model, true, true))) return;
    const botId = props.bot?.id;
    if (botId) setModelConfirmedBots((current) => ({ ...current, [botId]: true }));
  }

  function finishOnboarding(botId: string): void {
    setCompletedOnboardingBots((current) => ({ ...current, [botId]: true }));
    setOnboardingBots((current) => {
      if (!current[botId]) return current;
      const next = { ...current };
      delete next[botId];
      return next;
    });
    setModelConfirmedBots((current) => {
      if (!current[botId]) return current;
      const next = { ...current };
      delete next[botId];
      return next;
    });
  }

  function updateScrollFade(element = scrollElement) {
    if (!element) return;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    setFadeAtTop(element.scrollTop > 2);
    setFadeAtBottom(remaining > 2);
  }

  const markMessageSeen = (messageId: string): boolean => {
    const key = `${props.bot?.id ?? "none"}:${messageId}`;
    if (seenMessageIds.has(key)) return false;
    seenMessageIds.add(key);
    return true;
  };

  const updateCurrentDraft = (patch: Partial<ComposerDraft>) => {
    const id = props.bot?.id;
    if (!id) return;
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? EMPTY_DRAFT), ...patch } }));
  };

  onMount(() => {
    const unsubscribeImport = window.markas.agent.onAttachmentImport((event) => {
      if (event.type === "started") {
        const botId = props.bot?.id;
        if (botId) importTargetBots.set(event.requestId, botId);
        setAttachmentBusy(true);
        setComposerError(null);
      } else if (event.type === "error") {
        importTargetBots.delete(event.requestId);
        setAttachmentBusy(false);
        setComposerError(event.message);
      } else {
        setAttachmentBusy(false);
        const botId = importTargetBots.get(event.requestId);
        importTargetBots.delete(event.requestId);
        if (botId && props.bots.some((bot) => bot.id === botId)) {
          addAttachments(event.attachments, botId);
        } else {
          for (const attachment of event.attachments) {
            void window.markas.agent.discardDraftAttachment(attachment.id);
          }
        }
      }
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenReactionMessageId(null);
      setOpenMoreMessageId(null);
      setExpandedEmojiMessageId(null);
      hideBrowserPanel();
      setMediaPreview(null);
      setAvatarPickerOpen(false);
      props.onCloseAgentPicker();
    };
    const closeMessageMenus = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest(".message-actions")) return;
      setOpenReactionMessageId(null);
      setOpenMoreMessageId(null);
      setExpandedEmojiMessageId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeMessageMenus);
    const scrollResizeObserver = new ResizeObserver(() => updateScrollFade());
    if (scrollElement) scrollResizeObserver.observe(scrollElement);
    requestAnimationFrame(() => updateScrollFade());
    onCleanup(() => {
      scrollResizeObserver.disconnect();
      unsubscribeImport();
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeMessageMenus);
    });
  });

  createEffect(() => {
    const request = props.onboardingRequest;
    if (
      !request ||
      props.bot?.id !== request.botId ||
      request.nonce === lastHandledOnboardingRequestNonce
    )
      return;
    lastHandledOnboardingRequestNonce = request.nonce;
    setOnboardingBots((current) => ({ ...current, [request.botId]: true }));
    setModelConfirmedBots((current) => ({ ...current, [request.botId]: true }));
    setActiveRightPanel("none");
  });

  createEffect(() => {
    const botId = props.bot?.id;
    const lastMessage = props.messages[props.messages.length - 1];
    props.activeTurnId;
    props.queue?.deliveries.map((delivery) => `${delivery.id}:${delivery.status}`).join("|");
    lastMessage?.body;
    lastMessage?.status;
    lastMessage?.exchange?.deliveries
      .map((delivery) => `${delivery.id}:${delivery.status}:${delivery.position}`)
      .join("|");
    props.loaded;
    props.agentPickerOpen;
    props.prompt;
    if (botId !== lastConversationBotId) {
      lastConversationBotId = botId;
      stickToLatest = true;
    }
    requestAnimationFrame(() => {
      if (!scrollElement) return;
      if (stickToLatest) scrollElement.scrollTop = scrollElement.scrollHeight;
      updateScrollFade(scrollElement);
    });
  });

  createEffect(() => {
    const bot = props.bot;
    if (!bot) return;
    const signature = [
      bot.id,
      bot.name,
      bot.role,
      bot.description,
      String(bot.notifications),
      bot.model,
      bot.reasoningEffort,
      bot.avatarShape,
      bot.avatarColor,
    ].join("\u0000");
    if (signature === lastSettingsSignature) return;
    lastSettingsSignature = signature;
    setSettingsName(bot.name);
    setSettingsTitle(bot.role);
    setSettingsDescription(bot.description);
    setSettingsNotifications(bot.notifications);
    setSettingsModel(bot.model);
    setSettingsReasoning(bot.reasoningEffort);
    setAvatarShape(bot.avatarShape);
    setAvatarColor(bot.avatarColor);
    setAvatarPickerOpen(false);
  });

  createEffect(() => {
    const botId = props.bot?.id;
    if (
      !botId ||
      !props.loaded ||
      !agentReady() ||
      props.activeTurnId ||
      props.messages.length > 0 ||
      props.bot?.madeInFull ||
      props.onboardingRequest?.botId === botId ||
      completedOnboardingBots()[botId] ||
      onboardingBots()[botId]
    )
      return;
    setOnboardingBots((current) => ({ ...current, [botId]: true }));
  });

  createEffect(() => {
    const botId = props.bot?.id;
    if (botId === lastPanelBotId) return;
    const previousBotId = lastPanelBotId;
    lastPanelBotId = botId;
    if (!previousBotId || !botId || rightPanels()[botId] !== "settings") return;
    setRightPanels((current) => ({ ...current, [botId]: "none" }));
  });

  createEffect(() => {
    const request = props.settingsRequest;
    if (
      !request ||
      props.bot?.id !== request.botId ||
      request.nonce === lastHandledSettingsRequestNonce
    )
      return;
    lastHandledSettingsRequestNonce = request.nonce;
    setActiveRightPanel("settings");
  });

  createEffect(() => {
    if (!props.agentPickerOpen) return;
    setPickerQuery("");
    setActivePickerOption(0);
    requestAnimationFrame(() => pickerInput?.focus());
  });

  createEffect(() => {
    props.bot?.id;
    const activeTab = activeBrowserTab();
    setBrowserAddress(activeTab?.url ?? "https://www.google.com");
    if (screenOpen() && activeTab && activeTab.id !== props.activeBrowserTabId) {
      props.onActivateBrowserTab(activeTab.id);
    }
  });

  createEffect(() => {
    const controlledBotIds = new Set(
      props.browserControlState.sessions
        .map((session) => props.bots.find((bot) => bot.threadId === session.threadId)?.id)
        .filter((botId): botId is string => Boolean(botId)),
    );
    if (controlledBotIds.size === 0) return;
    setRightPanels((current) => {
      const next = { ...current };
      let changed = false;
      for (const botId of controlledBotIds) {
        if (next[botId] === "browser") continue;
        next[botId] = "browser";
        changed = true;
      }
      return changed ? next : current;
    });
  });

  createEffect(() => {
    const botId = props.bot?.id;
    const visible = screenOpen();
    const generation = ++browserVisibilityGeneration;
    if (browserVisibilityFrame !== undefined) cancelAnimationFrame(browserVisibilityFrame);
    browserResizeObserver?.disconnect();
    browserResizeObserver = undefined;
    if (browserWindowResizeHandler)
      window.removeEventListener("resize", browserWindowResizeHandler);
    browserWindowResizeHandler = undefined;
    if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
    browserBoundsFrame = undefined;
    if (!visible) {
      void window.markas.browser.setVisible({ visible: false });
      return;
    }
    browserVisibilityFrame = requestAnimationFrame(() => {
      browserVisibilityFrame = undefined;
      if (
        generation !== browserVisibilityGeneration ||
        props.bot?.id !== botId ||
        !screenOpen() ||
        !browserSurface
      ) {
        return;
      }
      const syncBounds = () => {
        if (
          generation !== browserVisibilityGeneration ||
          props.bot?.id !== botId ||
          !screenOpen() ||
          !browserSurface
        ) {
          return;
        }
        const bounds = browserSurface.getBoundingClientRect();
        void window.markas.browser.setVisible({
          visible: true,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        });
      };
      syncBounds();
      const scheduleBoundsSync = () => {
        if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
        browserBoundsFrame = requestAnimationFrame(() => {
          browserBoundsFrame = undefined;
          syncBounds();
        });
      };
      browserResizeObserver = new ResizeObserver(scheduleBoundsSync);
      browserResizeObserver.observe(browserSurface);
      browserWindowResizeHandler = scheduleBoundsSync;
      window.addEventListener("resize", browserWindowResizeHandler);
    });
  });

  onCleanup(() => {
    browserVisibilityGeneration += 1;
    if (browserVisibilityFrame !== undefined) cancelAnimationFrame(browserVisibilityFrame);
    if (browserBoundsFrame !== undefined) cancelAnimationFrame(browserBoundsFrame);
    browserResizeObserver?.disconnect();
    if (browserWindowResizeHandler)
      window.removeEventListener("resize", browserWindowResizeHandler);
    void window.markas.browser.setVisible({ visible: false });
  });

  function addAttachments(selected: DraftAttachment[], botId = props.bot?.id) {
    if (!botId) return;
    const draft = drafts()[botId] ?? EMPTY_DRAFT;
    const available = Math.max(0, 10 - draft.attachments.length);
    const accepted = selected.slice(0, available);
    for (const attachment of selected.slice(available)) {
      void window.markas.agent.discardDraftAttachment(attachment.id);
    }
    setDrafts((current) => ({
      ...current,
      [botId]: {
        ...(current[botId] ?? EMPTY_DRAFT),
        attachments: [...draft.attachments, ...accepted],
      },
    }));
    if (selected.length > accepted.length) setComposerError(t("composer.attach.limit"));
    setShowAttachments(false);
  }

  async function chooseAttachments() {
    if (attachmentBusy()) return;
    setAttachmentBusy(true);
    setComposerError(null);
    try {
      addAttachments(await window.markas.agent.chooseAttachments());
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : String(error));
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function submitMessage(override?: string) {
    const botId = props.bot?.id;
    const draft = currentDraft();
    const text = override ?? expandComposerMentions(draft.text);
    const attachments = override ? [] : draft.attachments;
    if (
      !botId ||
      submitting() ||
      onboardingModelRequired() ||
      (!text.trim() && attachments.length === 0)
    )
      return;
    stickToLatest = true;
    setSubmitting(true);
    setComposerError(null);
    const sent = await props.onSendMessage(
      text,
      attachments.map((item) => item.id),
      override ? null : draft.replyToMessageId,
    );
    setSubmitting(false);
    if (sent) {
      setDrafts((current) => ({ ...current, [botId]: EMPTY_DRAFT }));
      finishOnboarding(botId);
    }
  }

  function replyToMessage(message: BotMessage) {
    updateCurrentDraft({ replyToMessageId: message.id });
    setOpenReactionMessageId(null);
    setOpenMoreMessageId(null);
  }

  async function reactToMessage(message: BotMessage, emoji: MessageReaction | null) {
    const botId = props.bot?.id;
    if (!botId) return;
    setOpenReactionMessageId(null);
    setExpandedEmojiMessageId(null);
    try {
      await window.markas.agent.setMessageReaction({ botId, messageId: message.id, emoji });
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyMessage(message: BotMessage) {
    const text = message.body;
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        if (copiedMessageId() === message.id) setCopiedMessageId(null);
      }, 1_400);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : t("chat.message.copyFailed"));
    }
  }

  function removeAttachment(id: string) {
    updateCurrentDraft({
      attachments: currentDraft().attachments.filter((attachment) => attachment.id !== id),
    });
    void window.markas.agent.discardDraftAttachment(id);
  }

  async function openBrowserAddress() {
    const value = browserAddress().trim();
    if (!value) return;
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const tab = await window.markas.browser.open({
        url,
        ownerThreadId: props.bot?.threadId ?? null,
        ownerBotId: props.bot?.id ?? null,
      });
      setBrowserAddress(tab.url);
      setBrowserProblem(null);
      setActiveRightPanel("browser");
    } catch (error) {
      setBrowserAddress(url);
      setBrowserProblem(error instanceof Error ? error.message : String(error));
    }
  }

  async function openMessageLink(url: string) {
    try {
      await window.markas.openUrl(url);
    } catch {
      setComposerError(t("chat.error.openLink"));
    }
  }

  function showBrowserPanel() {
    setActiveRightPanel("browser");
    if (browserTabs().length === 0) void openBrowserAddress();
  }

  function hideBrowserPanel() {
    setActiveRightPanel("none");
    void window.markas.browser.setVisible({ visible: false });
  }

  function setActiveRightPanel(mode: RightPanelMode) {
    const botId = props.bot?.id;
    if (!botId) return;
    setRightPanels((current) =>
      current[botId] === mode ? current : { ...current, [botId]: mode },
    );
  }

  async function previewAttachment(attachment: AttachmentSummary) {
    if (!attachment.previewUrl || attachment.previewKind === "none") return;
    setMediaPreview({
      attachment,
      text: null,
      loading: attachment.previewKind === "text",
      error: null,
    });
    if (attachment.previewKind !== "text") return;
    try {
      const response = await fetch(attachment.previewUrl);
      if (!response.ok) throw new Error(t("chat.attachment.previewUnavailable"));
      const text = await response.text();
      setMediaPreview((current) =>
        current?.attachment.id === attachment.id
          ? { ...current, text: text.slice(0, 1_000_000), loading: false }
          : current,
      );
    } catch (error) {
      setMediaPreview((current) =>
        current?.attachment.id === attachment.id
          ? {
              ...current,
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            }
          : current,
      );
    }
  }

  function attachmentAction(attachment: AttachmentSummary, action: "open" | "reveal") {
    void window.markas.agent
      .openAttachment({ attachmentId: attachment.id, action })
      .catch((error) => setComposerError(error instanceof Error ? error.message : String(error)));
  }

  function handlePickerKeyDown(event: KeyboardEvent) {
    const optionCount = filteredPickerBots().length + 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActivePickerOption((current) => (current + 1) % optionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActivePickerOption((current) => (current - 1 + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const bot = filteredPickerBots()[activePickerOption() - 1];
      if (activePickerOption() === 0) props.onCreateAgent();
      else if (bot) props.onSelectAgent(bot.id);
    } else if (event.key === "Escape") props.onCloseAgentPicker();
  }

  return (
    <main
      ref={(element) => (conversationPanel = element)}
      data-component="Conversation"
      aria-label={t("chat.label")}
      class="conversation-panel"
      classList={{
        "conversation-drop-active": dropActive(),
        "browser-panel-active": screenOpen(),
      }}
      style={`--settings-panel-width: ${settingsPanelWidth()}px; --browser-panel-width: ${browserPanelWidth()}px`}
      onDragEnter={(event) => {
        if (event.dataTransfer?.types.includes("Files")) setDropActive(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
      }}
    >
      <Show when={dropActive()}>
        <div class="attachment-drop-overlay">{t("chat.drop")}</div>
      </Show>
      <header data-slot="header" class="window-drag conversation-header">
        <Show when={props.leftSidebarCollapsed}>
          <button
            type="button"
            class="sidebar-icon-button sidebar-restore-button no-drag"
            aria-label={t("sidebar.show")}
            aria-controls="bot-sidebar"
            aria-expanded="false"
            title={t("sidebar.show")}
            onClick={props.onToggleLeftSidebar}
          >
            <SidebarToggleIcon />
          </button>
        </Show>
        <Show
          when={props.agentPickerOpen}
          fallback={
            <>
              <Show when={props.bot}>
                {(bot) => (
                  <button
                    type="button"
                    class="conversation-title no-drag"
                    aria-label={t("chat.header.settings")}
                    onClick={() => {
                      setActiveRightPanel("settings");
                    }}
                  >
                    <AgentAvatar bot={bot()} />
                    <h1>{bot().name}</h1>
                  </button>
                )}
              </Show>
              <div data-slot="actions" class="conversation-header-actions no-drag">
                <Show when={props.bot}>
                  {(bot) => (
                    <AccessChip
                      level={bot().access}
                      onClick={() => setActiveRightPanel("settings")}
                    />
                  )}
                </Show>
                <Show when={props.bot}>
                  <ProviderModelPicker
                    value={settingsModel()}
                    modelOptions={props.modelOptions}
                    agentStatus={props.agentStatus}
                    disabled={!agentReady() || agentActivity() === "working"}
                    disabledReason={
                      agentActivity() === "working"
                        ? t("chat.model.busy")
                        : t("chat.model.noEngine")
                    }
                    onChange={(model) => void selectAndConfirmModel(model)}
                  />
                </Show>
                <button
                  type="button"
                  class="header-panel-toggle"
                  aria-label={filesOpen() ? t("files.hide") : t("files.show")}
                  aria-expanded={filesOpen()}
                  onClick={() => {
                    if (filesOpen()) setActiveRightPanel("none");
                    else {
                      if (screenOpen()) hideBrowserPanel();
                      setActiveRightPanel("files");
                    }
                  }}
                >
                  <Icon name="folder" size={14} />
                </button>
                <button
                  type="button"
                  class="header-panel-toggle computer-button"
                  classList={{ "computer-button-agent-active": Boolean(activeBrowserControl()) }}
                  aria-label={
                    activeBrowserControl()
                      ? t("chat.computer.controlled", {
                          name: browserControlBot()?.name ?? t("common.bot"),
                        })
                      : screenOpen()
                        ? t("chat.computer.hide")
                        : t("chat.computer.open")
                  }
                  aria-expanded={screenOpen()}
                  onClick={() => {
                    if (screenOpen()) hideBrowserPanel();
                    else showBrowserPanel();
                  }}
                >
                  <ComputerIcon />
                  <Show when={activeBrowserControl()}>
                    <span class="computer-control-dot" aria-hidden="true" />
                  </Show>
                </button>
              </div>
            </>
          }
        >
          <div data-slot="bot-picker" class="agent-picker-root no-drag">
            <label class="agent-recipient-field">
              <span>{t("chat.picker.to")}</span>
              <input
                ref={(element) => (pickerInput = element)}
                role="combobox"
                aria-label={t("chat.picker.to")}
                aria-expanded="true"
                placeholder={t("chat.picker.placeholder")}
                value={pickerQuery()}
                onInput={(event) => {
                  setPickerQuery(event.currentTarget.value);
                  setActivePickerOption(0);
                }}
                onKeyDown={handlePickerKeyDown}
              />
            </label>
            <div class="agent-picker-menu" role="listbox">
              <button
                type="button"
                role="option"
                aria-selected={activePickerOption() === 0}
                class="agent-picker-option agent-picker-create"
                disabled={props.creatingAgent}
                onClick={props.onCreateAgent}
              >
                <span class="agent-picker-plus">
                  <PlusIcon />
                </span>
                <span>
                  {props.creatingAgent ? t("chat.picker.creating") : t("chat.picker.create")}
                </span>
              </button>
              <For each={filteredPickerBots()}>
                {(bot, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={activePickerOption() === index() + 1}
                    class="agent-picker-option"
                    onClick={() => props.onSelectAgent(bot.id)}
                  >
                    <AgentAvatar bot={bot} />
                    <span>{bot.name}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </header>

      <div
        data-slot="body"
        class="conversation-scroll"
        classList={{
          "scroll-fade-top": fadeAtTop(),
          "scroll-fade-bottom": fadeAtBottom(),
        }}
        ref={(element) => (scrollElement = element)}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToLatest = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
          updateScrollFade(element);
        }}
      >
        <Show when={!props.agentPickerOpen && props.loaded}>
          <Show when={!agentReady()}>
            <section data-slot="engine-setup" class="agent-setup-card" role="status">
              <div>
                <strong>
                  {props.agentStatus.phase === "starting" ||
                  props.agentStatus.phase === "restarting"
                    ? t("engine.connecting")
                    : t("engine.setup.title")}
                </strong>
                <p>
                  {props.agentStatus.message ??
                    (props.agentStatus.phase === "starting"
                      ? t("engine.starting")
                      : t("engine.setup.body"))}
                </p>
              </div>
              <Show
                when={
                  props.agentStatus.phase !== "starting" && props.agentStatus.phase !== "restarting"
                }
              >
                <button
                  type="button"
                  onClick={() =>
                    void props
                      .onOpenAgentSetup()
                      .catch((error) =>
                        setComposerError(error instanceof Error ? error.message : String(error)),
                      )
                  }
                >
                  {t("engine.setup.guide")}
                </button>
              </Show>
            </section>
          </Show>
          <Show when={props.messages.length > 0}>
            <div class="time-marker">
              <span>{props.messages[0]?.time || t("common.now")}</span>
            </div>
          </Show>
          <Show when={agentReady() && onboardingActive() && !props.activeTurnId}>
            <article class="message-entry message-entry-animated message-entry-bot onboarding-message">
              <div class="bot-bubble">
                <p class="message-copy">{t("chat.onboarding.model")}</p>
              </div>
              <div class="onboarding-model-picker">
                <ProviderModelPicker
                  ariaLabel={t("chat.onboarding.model.label")}
                  value={settingsModel()}
                  agentStatus={props.agentStatus}
                  modelOptions={props.modelOptions}
                  onChange={(model) => void selectAndConfirmModel(model)}
                />
              </div>
              <Show when={onboardingModelConfirmed()}>
                <div class="onboarding-specialty-step message-entry-animated">
                  <ChoiceCard
                    title={t("chat.onboarding.title")}
                    hint={t("chat.onboarding.hint")}
                    choices={[
                      ...ONBOARDING_TOPICS.map((topic) => t(`chat.onboarding.${topic}`)),
                      t("chat.onboarding.other"),
                    ]}
                    customChoice={t("chat.onboarding.other")}
                    pending={submitting()}
                    onSubmit={async (answer) => {
                      if (submitting()) return false;
                      setSubmitting(true);
                      setComposerError(null);
                      const completed = await props.onCompleteOnboarding(
                        answer,
                        settingsModel(),
                        settingsReasoning(),
                      );
                      if (completed) {
                        const botId = props.bot?.id;
                        if (botId) finishOnboarding(botId);
                      }
                      setSubmitting(false);
                      return completed;
                    }}
                  />
                </div>
              </Show>
            </article>
          </Show>
          <For each={props.messages}>
            {(message) => {
              const animateEntrance = message.animate === true && markMessageSeen(message.id);
              return (
                <Show
                  when={message.exchange}
                  fallback={
                    <Show
                      when={message.kind === "thinking"}
                      fallback={
                        <article
                          data-slot="message"
                          class="message-entry"
                          classList={{
                            "message-entry-animated": animateEntrance,
                            "message-entry-user": message.author === "you",
                            "message-entry-bot": message.author === "bot",
                          }}
                        >
                          <div class="message-shell">
                            <div
                              class={message.author === "you" ? "user-bubble" : "bot-bubble"}
                              classList={{ "bot-bubble-streaming": message.streaming === true }}
                            >
                              <MessageBody
                                message={message}
                                referencedMessage={props.messages.find(
                                  (candidate) => candidate.id === message.replyToMessageId,
                                )}
                                bots={props.bots}
                                onSelectAgent={props.onSelectAgent}
                                onOpenLink={(url) => void openMessageLink(url)}
                                onPreview={(attachment) => void previewAttachment(attachment)}
                                onAttachmentAction={attachmentAction}
                              />
                            </div>
                            <MessageActions
                              message={message}
                              pickerOpen={openReactionMessageId() === message.id}
                              moreOpen={openMoreMessageId() === message.id}
                              expandedEmoji={expandedEmojiMessageId() === message.id}
                              copied={copiedMessageId() === message.id}
                              onTogglePicker={() => {
                                setOpenReactionMessageId((current) =>
                                  current === message.id ? null : message.id,
                                );
                                setOpenMoreMessageId(null);
                                setExpandedEmojiMessageId(null);
                              }}
                              onToggleMore={() => {
                                setOpenMoreMessageId((current) =>
                                  current === message.id ? null : message.id,
                                );
                                setOpenReactionMessageId(null);
                                setExpandedEmojiMessageId(null);
                              }}
                              onExpandEmoji={() =>
                                setExpandedEmojiMessageId((current) =>
                                  current === message.id ? null : message.id,
                                )
                              }
                              onReact={(emoji) => void reactToMessage(message, emoji)}
                              onReply={() => replyToMessage(message)}
                              onCopy={() => void copyMessage(message)}
                            />
                          </div>
                          <Show when={message.reaction}>
                            {(reaction) => (
                              <button
                                type="button"
                                class="message-reaction-pill"
                                aria-label={t("chat.message.react.remove", { emoji: reaction() })}
                                onClick={() => void reactToMessage(message, null)}
                              >
                                {reaction()}
                              </button>
                            )}
                          </Show>
                        </article>
                      }
                    >
                      <div classList={{ "thinking-entry-animated": animateEntrance }}>
                        <ThinkingDisclosure message={message} />
                      </div>
                    </Show>
                  }
                >
                  {(exchange) => (
                    <article
                      data-slot="exchange"
                      class="exchange-message-entry"
                      classList={{ "exchange-message-entry-animated": animateEntrance }}
                    >
                      <ExchangeSystemRow
                        message={message}
                        bots={props.bots}
                        onSelectAgent={props.onSelectAgent}
                      />
                      <Show
                        when={
                          exchange().direction === "incoming" &&
                          (message.attachments?.length ?? 0) > 0
                        }
                      >
                        <div class="exchange-agent-attachments">
                          <AttachmentCards
                            attachments={message.attachments ?? []}
                            onPreview={(attachment) => void previewAttachment(attachment)}
                            onAction={attachmentAction}
                          />
                        </div>
                      </Show>
                    </article>
                  )}
                </Show>
              );
            }}
          </For>
          <AgentActivityIndicator bot={props.bot} state={agentActivity()} />
          {/* Keyed, so the next waiting card starts fresh instead of keeping the last one's state. */}
          <Show when={props.prompt} keyed>
            {(prompt) => (
              <PromptCard
                questions={prompt.questions}
                botName={props.bot?.name}
                onSubmit={props.onAnswerPrompt}
              />
            )}
          </Show>
        </Show>
      </div>

      <div data-slot="composer" class="composer-wrap">
        <Show when={botHandOff()}>
          {(handOff) => (
            <HandOffCard
              handOff={handOff()}
              botName={props.bot?.name ?? t("common.bot")}
              site={siteOf(props.browserTabs.find((tab) => tab.id === handOff().tabId)?.url)}
              onOpenPanel={() => setActiveRightPanel("browser")}
              onTellBot={(text) => void submitMessage(text)}
            />
          )}
        </Show>
        <Show when={showAttachments()}>
          <div class="attachment-menu">
            <button
              type="button"
              disabled={attachmentBusy()}
              onClick={() => void chooseAttachments()}
            >
              <FileIcon />
              {attachmentBusy() ? t("composer.attach.importing") : t("composer.attach.files")}
            </button>
            <span class="attachment-menu-hint">{t("composer.attach.hint")}</span>
          </div>
        </Show>
        <For each={currentDraft().attachments}>
          {(attachment) => (
            <div class="composer-attachment">
              <span class={attachment.kind === "file" ? "file-type-badge" : "attachment-thumb"}>
                <Show when={attachment.kind === "image"} fallback={fileBadge(attachment)}>
                  <img src={attachment.previewUrl ?? ""} alt="" />
                </Show>
              </span>
              <span>
                <strong>{attachment.name}</strong>
                <small>{formatFileSize(attachment.size)}</small>
              </span>
              <button
                type="button"
                aria-label={t("composer.attach.remove", { name: attachment.name })}
                onClick={() => removeAttachment(attachment.id)}
              >
                <CloseIcon />
              </button>
            </div>
          )}
        </For>
        <Show when={replyTarget()}>
          {(message) => (
            <div class="composer-reply-preview">
              <div>
                <span>
                  {message().author === "you" ? t("composer.reply.you") : t("composer.reply.bot")}
                </span>
                <p>{message().body || t("chat.message.attachment")}</p>
              </div>
              <button
                type="button"
                aria-label={t("composer.reply.cancel")}
                onClick={() => updateCurrentDraft({ replyToMessageId: null })}
              >
                <CloseIcon />
              </button>
            </div>
          )}
        </Show>
        <Show when={composerError()}>
          <div class="composer-error" role="alert">
            {composerError()}
          </div>
        </Show>
        <div
          data-slot="queue"
          class="agent-queue-bar"
          classList={{ "agent-queue-bar-visible": queueBarVisible() }}
          aria-hidden={!queueBarVisible()}
        >
          <Show when={props.queue?.paused}>
            <button type="button" onClick={props.onResumeQueue}>
              {t("composer.queue.resume")}
            </button>
          </Show>
          <For each={props.queue?.deliveries.filter((item) => item.status === "queued") ?? []}>
            {(delivery) => (
              <span>
                {t("chat.status.queued", { position: delivery.position ?? "" })}
                <button
                  type="button"
                  aria-label={t("composer.queue.cancel", { position: delivery.position ?? "" })}
                  onClick={() => props.onCancelQueuedMessage(delivery.id)}
                >
                  <CloseIcon />
                </button>
              </span>
            )}
          </For>
        </div>
        <div data-slot="input-group" class="composer">
          <button
            type="button"
            class="composer-button"
            aria-label={t("composer.attach")}
            disabled={
              props.agentPickerOpen ||
              attachmentBusy() ||
              !agentReady() ||
              onboardingModelRequired()
            }
            onClick={() => setShowAttachments((value) => !value)}
          >
            <PlusIcon />
          </button>
          <div class="composer-input-label">
            <ComposerEditor
              botId={props.bot?.id}
              bots={props.bots}
              value={currentDraft().text}
              disabled={
                props.agentPickerOpen || submitting() || !agentReady() || onboardingModelRequired()
              }
              placeholder={
                !agentReady()
                  ? t("composer.placeholder.setup")
                  : onboardingModelRequired()
                    ? t("composer.placeholder.model")
                    : replyTarget()
                      ? t("composer.reply.placeholder")
                      : messageLabel()
              }
              ariaLabel={messageLabel()}
              onValueChange={(text) => updateCurrentDraft({ text })}
              onSubmit={() => void submitMessage()}
            />
          </div>
          <Show
            when={props.activeTurnId}
            fallback={
              <button
                type="button"
                class="voice-button"
                aria-label={t("composer.send")}
                disabled={submitting() || !agentReady() || onboardingModelRequired()}
                onClick={() => void submitMessage()}
              >
                {submitting() ? "…" : "↑"}
              </button>
            }
          >
            <button
              type="button"
              class="voice-button voice-button-active"
              aria-label={t("composer.stop")}
              onClick={props.onStop}
            >
              <StopIcon />
            </button>
          </Show>
        </div>
      </div>

      <Show when={mediaPreview()}>
        {(preview) => (
          <div data-slot="media-preview" class="media-backdrop" role="presentation">
            <button
              type="button"
              class="media-dismiss"
              aria-label={t("chat.attachment.closePreview")}
              onClick={() => setMediaPreview(null)}
            />
            <section
              class="media-modal"
              role="dialog"
              aria-modal="true"
              aria-label={preview().attachment.name}
            >
              <button
                type="button"
                class="media-close"
                aria-label={t("chat.attachment.closePreview")}
                onClick={() => setMediaPreview(null)}
              >
                <CloseIcon />
              </button>
              <Show when={preview().attachment.previewKind === "image"}>
                <img
                  class="media-image"
                  src={preview().attachment.previewUrl ?? ""}
                  alt={preview().attachment.name}
                />
              </Show>
              <Show when={preview().attachment.previewKind === "pdf"}>
                <iframe
                  class="media-document"
                  title={preview().attachment.name}
                  src={preview().attachment.previewUrl ?? ""}
                />
              </Show>
              <Show when={preview().attachment.previewKind === "text"}>
                <pre class="media-text">
                  {preview().loading
                    ? t("common.loading.busy")
                    : (preview().error ?? preview().text)}
                </pre>
              </Show>
              <div class="media-caption">
                <span>{preview().attachment.name}</span>
                <button
                  type="button"
                  onClick={() => attachmentAction(preview().attachment, "open")}
                >
                  {t("chat.attachment.open")}
                </button>
                <button
                  type="button"
                  onClick={() => attachmentAction(preview().attachment, "reveal")}
                >
                  {t("chat.attachment.reveal")}
                </button>
              </div>
            </section>
          </div>
        )}
      </Show>

      <Show when={screenOpen()}>
        <aside
          id="browser-side-panel"
          data-slot="browser-panel"
          class="browser-panel"
          classList={{ "browser-panel-controlled": Boolean(activeBrowserControl()) }}
          aria-label={t("chat.browser.label")}
        >
          <PanelResizer
            class="right-panel-resizer"
            label={t("chat.panel.resize")}
            controls="browser-side-panel"
            direction="right"
            value={browserPanelWidth()}
            defaultValue={BROWSER_PANEL_DEFAULT}
            min={BROWSER_PANEL_MIN}
            max={() =>
              Math.min(
                BROWSER_PANEL_MAX,
                Math.max(
                  BROWSER_PANEL_MIN,
                  (conversationPanel?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN,
                ),
              )
            }
            onResize={setBrowserPanelWidth}
            onResizeEnd={(value) => savePanelWidth(BROWSER_PANEL_STORAGE_KEY, value)}
          />
          <header data-slot="header" class="browser-panel-header">
            <div class="browser-tabs">
              <div class="browser-tab-strip" role="tablist" aria-label={t("chat.browser.tabs")}>
                <For each={browserTabs()}>
                  {(tab) => {
                    const control = () => browserControlForTab(tab);
                    const controller = () => browserControllerForTab(tab);
                    const title = () =>
                      tab.loading ? t("common.loading.busy") : tab.title || tab.url;
                    return (
                      <div
                        class="browser-tab-wrap"
                        classList={{ "browser-tab-controlled": Boolean(control()) }}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-label={
                            control()
                              ? t("chat.browser.tab.controlled", {
                                  title: title(),
                                  name: controller()?.name ?? t("common.bot"),
                                })
                              : title()
                          }
                          aria-selected={props.activeBrowserTabId === tab.id}
                          class="browser-tab"
                          classList={{
                            "browser-tab-active": activeBrowserTab()?.id === tab.id,
                          }}
                          onClick={() => props.onActivateBrowserTab(tab.id)}
                        >
                          <Show when={control()}>
                            {(session) => (
                              <span
                                class="browser-tab-control"
                                classList={{
                                  "browser-tab-control-acting": session().phase === "acting",
                                }}
                                title={`${controller()?.name ?? t("common.bot")}: ${browserActionLabel(session().action)}`}
                              >
                                <BrowserControlIcon />
                              </span>
                            )}
                          </Show>
                          <span class="browser-tab-title">{title()}</span>
                        </button>
                        <button
                          type="button"
                          class="browser-tab-close"
                          aria-label={t("chat.browser.tab.close", {
                            title: tab.title || t("chat.browser.tab.untitled"),
                          })}
                          onClick={() => props.onCloseBrowserTab(tab.id)}
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    );
                  }}
                </For>
                <button
                  type="button"
                  class="browser-new-tab"
                  aria-label={t("chat.browser.tab.new")}
                  onClick={() => {
                    setBrowserAddress("https://www.google.com");
                    void openBrowserAddress();
                  }}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>
          </header>
          <div data-slot="actions" class="browser-toolbar">
            <button
              type="button"
              aria-label={t("chat.browser.reload")}
              class="browser-toolbar-button"
              onClick={() => setPreviewLooks((count) => count + 1)}
            >
              <BrowserReloadIcon />
            </button>
            <form
              class="browser-address-bar"
              onSubmit={(event) => {
                event.preventDefault();
                void openBrowserAddress();
              }}
            >
              <input
                value={browserAddress()}
                aria-label={t("chat.browser.address")}
                onInput={(event) => {
                  setBrowserAddress(event.currentTarget.value);
                  setBrowserProblem(null);
                }}
              />
            </form>
          </div>
          <Show when={browserProblem()}>
            {(message) => (
              <p data-slot="problem" class="browser-problem" role="alert">
                {t("chat.browser.openFailed", { reason: message() })}
              </p>
            )}
          </Show>
          <div
            data-slot="body"
            class="browser-surface"
            ref={(element) => (browserSurface = element)}
          >
            <Show
              when={activeBrowserTab()}
              fallback={
                <div class="browser-empty-state">
                  <strong>{t("chat.browser.empty.title")}</strong>
                  <span>{t("chat.browser.empty.body")}</span>
                </div>
              }
            >
              {(tab) => (
                <BrowserPreview
                  tabId={tab().id}
                  botName={props.bot?.name ?? t("common.bot")}
                  looks={previewLooks()}
                />
              )}
            </Show>
          </div>
        </aside>
      </Show>

      <Show when={filesOpen() && props.bot}>
        {(bot) => (
          <aside
            id="files-side-panel"
            data-slot="files-panel"
            class="agent-settings-panel"
            aria-label={t("files.label")}
          >
            <header data-slot="header" class="agent-settings-header">
              <span />
              <h2>{t("files.label")}</h2>
              <button
                type="button"
                class="agent-settings-nav-button"
                aria-label={t("files.close")}
                onClick={() => setActiveRightPanel("none")}
              >
                <CloseIcon />
              </button>
            </header>
            <FilesPanel botId={bot().id} botName={bot().name} />
          </aside>
        )}
      </Show>

      <Show when={settingsOpen() && props.bot}>
        <aside
          id="settings-side-panel"
          data-slot="settings-panel"
          class="agent-settings-panel"
          aria-label={t("settings.label")}
        >
          <PanelResizer
            class="right-panel-resizer"
            label={t("chat.panel.resize")}
            controls="settings-side-panel"
            direction="right"
            value={settingsPanelWidth()}
            defaultValue={SETTINGS_PANEL_DEFAULT}
            min={SETTINGS_PANEL_MIN}
            max={() =>
              Math.min(
                SETTINGS_PANEL_MAX,
                Math.max(
                  SETTINGS_PANEL_MIN,
                  (conversationPanel?.clientWidth || window.innerWidth) - CONVERSATION_PANEL_MIN,
                ),
              )
            }
            onResize={setSettingsPanelWidth}
            onResizeEnd={(value) => savePanelWidth(SETTINGS_PANEL_STORAGE_KEY, value)}
          />
          <header data-slot="header" class="agent-settings-header">
            <button
              type="button"
              class="agent-settings-nav-button"
              aria-label={t("settings.back")}
              onClick={() => setActiveRightPanel("none")}
            >
              <BackIcon />
            </button>
            <h2>{t("settings.title")}</h2>
            <button
              type="button"
              class="agent-settings-nav-button"
              aria-label={t("settings.close")}
              onClick={() => setActiveRightPanel("none")}
            >
              <CloseIcon />
            </button>
          </header>
          <div data-slot="body" class="agent-settings-content">
            <button
              type="button"
              class="agent-settings-avatar"
              aria-label={t("settings.sigil.edit")}
              aria-expanded={avatarPickerOpen()}
              onClick={() => setAvatarPickerOpen((open) => !open)}
            >
              <AgentAvatar shape={avatarShape()} color={avatarColor()} bot={props.bot} />
            </button>
            <Show when={avatarPickerOpen()}>
              <section
                data-slot="sigil-editor"
                class="avatar-editor"
                aria-label={t("settings.sigil.editor")}
              >
                <fieldset class="avatar-shape-grid" aria-label={t("settings.sigil.patterns")}>
                  <For each={AVATAR_SHAPES}>
                    {(shape) => (
                      <button
                        type="button"
                        class="avatar-shape-choice"
                        classList={{ "avatar-choice-selected": avatarShape() === shape }}
                        aria-label={t("settings.sigil.pattern", {
                          name: t(`settings.sigil.pattern.${shape}`),
                        })}
                        aria-pressed={avatarShape() === shape}
                        onClick={() => {
                          setAvatarShape(shape);
                          saveBotPatch({ avatarShape: shape });
                        }}
                      >
                        <AgentAvatar shape={shape} color={avatarColor()} bot={props.bot} />
                      </button>
                    )}
                  </For>
                </fieldset>
                <div class="avatar-editor-divider" />
                <fieldset class="avatar-color-grid" aria-label={t("settings.sigil.colors")}>
                  <For each={AVATAR_COLORS}>
                    {(color) => (
                      <button
                        type="button"
                        class="avatar-color-choice"
                        classList={{ "avatar-choice-selected": avatarColor() === color }}
                        aria-label={t("settings.sigil.color", {
                          name: t(`settings.sigil.color.${color}`),
                        })}
                        aria-pressed={avatarColor() === color}
                        onClick={() => {
                          setAvatarColor(color);
                          saveBotPatch({ avatarColor: color });
                        }}
                      >
                        <span class={`avatar-color-swatch avatar-color-swatch-${color}`} />
                      </button>
                    )}
                  </For>
                </fieldset>
              </section>
            </Show>
            <label data-slot="field" class="agent-settings-field">
              <span>{t("settings.name")}</span>
              <input
                value={settingsName()}
                aria-label={t("settings.name.label")}
                onInput={(event) => setSettingsName(event.currentTarget.value)}
                onBlur={() =>
                  saveBotPatch({ name: settingsName().trim() || t("settings.name.default") })
                }
              />
            </label>
            <label data-slot="field" class="agent-settings-field">
              <span>{t("settings.role")}</span>
              <input
                value={settingsTitle()}
                aria-label={t("settings.role.label")}
                placeholder={t("settings.role.placeholder")}
                onInput={(event) => setSettingsTitle(event.currentTarget.value)}
                onBlur={() => saveBotPatch({ role: settingsTitle().trim() })}
              />
            </label>
            <label data-slot="field" class="agent-settings-field agent-settings-description">
              <span>{t("settings.description")}</span>
              <textarea
                rows="4"
                value={settingsDescription()}
                aria-label={t("settings.description.label")}
                placeholder={t("settings.description.placeholder")}
                onInput={(event) => setSettingsDescription(event.currentTarget.value)}
                onBlur={() => saveBotPatch({ description: settingsDescription() })}
              />
            </label>
            <Show when={props.bot}>{(bot) => <ContextBreakdown botId={bot().id} />}</Show>
            <section
              data-slot="engine"
              class="agent-settings-model"
              aria-labelledby="agent-model-heading"
            >
              <div class="agent-settings-section-heading">
                <strong id="agent-model-heading">{t("settings.engine")}</strong>
                <span>{t("settings.engine.hint")}</span>
              </div>
              <div class="agent-settings-model-controls">
                <div class="agent-settings-model-option">
                  <ProviderModelPicker
                    variant="field"
                    ariaLabel={t("settings.model.label")}
                    value={settingsModel()}
                    agentStatus={props.agentStatus}
                    modelOptions={props.modelOptions}
                    disabled={!agentReady() || agentActivity() === "working"}
                    disabledReason={
                      agentActivity() === "working"
                        ? t("chat.model.busy")
                        : t("chat.model.noEngine")
                    }
                    onChange={(model) => void selectAndConfirmModel(model)}
                  />
                  <Show when={selectedModel()} keyed>
                    {(model) => <p class="agent-settings-model-description">{model.description}</p>}
                  </Show>
                </div>
                <label class="agent-settings-model-row agent-settings-thinking-row">
                  <span>{t("settings.reasoning")}</span>
                  <select
                    value={settingsReasoning()}
                    aria-label={t("settings.reasoning.label")}
                    onChange={(event) => {
                      const reasoningEffort = event.currentTarget.value as AgentReasoningEffort;
                      setSettingsReasoning(reasoningEffort);
                      saveBotPatch({ reasoningEffort });
                    }}
                  >
                    <For each={reasoningOptions()}>
                      {(effort) => (
                        <option value={effort}>{t(`settings.reasoning.${effort}`)}</option>
                      )}
                    </For>
                  </select>
                </label>
              </div>
            </section>
            <Show when={props.bot}>
              {(bot) => (
                <AccessControl
                  level={bot().access}
                  botName={bot().name}
                  onChange={(access) => void saveBotPatch({ access })}
                />
              )}
            </Show>
            <Show when={settingsSaveError()}>
              {(message) => (
                <p class="agent-settings-save-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <div data-slot="notifications" class="agent-settings-notifications">
              <div>
                <strong>{t("settings.notifications")}</strong>
                <span>{t("settings.notifications.hint")}</span>
              </div>
              <button
                type="button"
                role="switch"
                class="settings-switch"
                classList={{ "settings-switch-on": settingsNotifications() }}
                aria-label={t("settings.notifications")}
                aria-checked={settingsNotifications()}
                onClick={() => {
                  const next = !settingsNotifications();
                  setSettingsNotifications(next);
                  saveBotPatch({ notifications: next });
                }}
              >
                <span />
              </button>
            </div>
            <Show when={props.bot}>
              {(bot) => <ExportBot botId={bot().id} botName={bot().name} />}
            </Show>
          </div>
        </aside>
      </Show>
    </main>
  );
}

function ThinkingIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.75a4.65 4.65 0 0 0-2.85 8.33c.47.36.73.78.78 1.17h4.14c.05-.39.31-.81.78-1.17A4.65 4.65 0 0 0 8 1.75Z" />
      <path d="M6.3 13h3.4M6.9 14.5h2.2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5.75 6.5 2.25 2.25 2.25-2.25" />
    </svg>
  );
}

function fileBadge(attachment: AttachmentSummary): string {
  if (attachment.previewKind === "pdf") return "PDF";
  if (attachment.previewKind === "text") return "TXT";
  return attachment.name.split(".").at(-1)?.slice(0, 4).toUpperCase() || "FILE";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
