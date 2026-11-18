import {
  createEffect,
  createResource,
  createSignal,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import {
  type BotSummary,
  BROWSER_PERSON_KEYS,
  type BrowserHandOff,
  type BrowserTabView,
} from "../../../shared/ipc";
import { callHost } from "../host-client";
import { t } from "../i18n";
import { KeyDialog } from "../keyring/KeyDialog";
import { keyNameFor } from "../keyring/key-name";
import { type KeyDraft, keyringClient } from "../keyring/keyring-client";
import { Icon } from "../ui/Icon";
import "./browser.css";

/** How often the panel looks at the bot's page again while it is open. */
export const PREVIEW_REFRESH_MS = 2_500;
/** How often it looks while the person is using the page themselves. */
export const LIVE_REFRESH_MS = 700;

/** What the bot is told when the person skips its step. It is written to the bot, not shown. */
const SKIP_NOTE =
  "The person chose to skip this step. Do not ask for it again; carry on without it or say what could not be done.";

/** What the bot is told once a login for the site is in the Keyring. It is written to the bot, not shown. */
const savedNote = (name: string, site: string) =>
  `The person saved a login for ${site} in the Keyring as "${name}" and shared it with you. Sign in now with markas.keyring_sign_in and that key name. Do not ask the person to type it.`;

/** The website of an address, when it is one a login can belong to. */
export function siteOf(url: string | null | undefined): string | null {
  try {
    const parsed = new URL(url ?? "");
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** What the person does on the page, before the tab it belongs to is added. */
type PageInput =
  | { kind: "click"; x: number; y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; deltaY: number };

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Minutes since a moment, never below zero. */
function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

/**
 * Shown in the conversation while a tab is in the person's hands: the bot passed a step on,
 * or the person took over. It always offers a way forward, even when the browser cannot open.
 */
export function HandOffCard(props: {
  handOff: BrowserHandOff;
  botName: string;
  /** The website the handed-over tab is on, when it is known. */
  site?: string | null;
  /** Shows the Browser panel, where the person uses the page. */
  onOpenPanel?: () => void;
  /**
   * Tells the bot in the chat. Used after a login is saved for a tab the person took over:
   * the bot is not waiting on that tab, so a note given with the tab would never reach it.
   */
  onTellBot?: (text: string) => void;
}) {
  const [savingKey, setSavingKey] = createSignal(false);
  // The crew, for choosing who else may use the saved login; asked for only when the dialog opens.
  const [bots] = createResource(savingKey, (open) =>
    open ? callHost<BotSummary[]>("agent.listBots") : [],
  );
  const [busy, setBusy] = createSignal<"open" | "done" | "skip" | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [minutes, setMinutes] = createSignal(minutesSince(props.handOff.startedAt));
  const timer = setInterval(() => setMinutes(minutesSince(props.handOff.startedAt)), 30_000);
  onCleanup(() => clearInterval(timer));

  const byBot = () => props.handOff.requestedBy === "bot";

  async function act(kind: "open" | "done" | "skip"): Promise<void> {
    if (busy()) return;
    setBusy(kind);
    setProblem(null);
    try {
      if (kind === "open") {
        props.onOpenPanel?.();
        // Brings the window forward too, for a browser that was given one of its own.
        await callHost("browser.bringToFront", props.handOff.tabId);
      } else {
        await callHost("browser.resumeControl", {
          tabId: props.handOff.tabId,
          ...(kind === "skip" ? { note: SKIP_NOTE } : {}),
        });
      }
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(null);
    }
  }

  /** Saves the login the person typed into Markas, then hands the tab back so the bot signs in with it. */
  async function saveKey(draft: KeyDraft): Promise<void> {
    await keyringClient.create(draft);
    setSavingKey(false);
    setProblem(null);
    const site = draft.origin ?? props.site ?? "";
    // Read before the tab is handed back, which ends this card.
    const waiting = byBot();
    try {
      await callHost("browser.resumeControl", {
        tabId: props.handOff.tabId,
        note: savedNote(draft.name, site),
      });
    } catch (error) {
      setProblem(describe(error));
      return;
    }
    if (!waiting) props.onTellBot?.(t("handoff.saveKey.message", { site, name: draft.name }));
  }

  return (
    <section data-component="HandOffCard" class="mk-handoff" role="status">
      <div data-slot="header" class="mk-handoff__head">
        <Icon name="pointer" size={16} />
        <strong>
          {byBot() ? t("handoff.title.bot", { name: props.botName }) : t("handoff.title.person")}
        </strong>
        <span class="mk-handoff__since">
          {minutes() < 1 ? t("handoff.since.now") : t("handoff.since", { minutes: minutes() })}
        </span>
      </div>
      <p data-slot="body">
        {byBot()
          ? `${props.handOff.reason} ${t("handoff.body.bot", { name: props.botName })}`
          : t("handoff.body.person", { name: props.botName })}
      </p>
      <Show when={problem()}>
        {(message) => (
          <p data-slot="problem" class="mk-handoff__problem" role="alert">
            {message()} {t("handoff.problem")}
          </p>
        )}
      </Show>
      <div data-slot="actions" class="mk-handoff__actions">
        <button
          type="button"
          class="mk-button mk-button--primary mk-button--small"
          disabled={busy() !== null}
          onClick={() => void act("open")}
        >
          <Icon name="external" size={12} />
          {t("handoff.open", { name: props.botName })}
        </button>
        <button
          type="button"
          class="mk-button mk-button--small"
          disabled={busy() !== null}
          onClick={() => void act("done")}
        >
          <Icon name="check" size={12} />
          {byBot() ? t("handoff.done") : t("handoff.giveBack", { name: props.botName })}
        </button>
        <Show when={props.site}>
          <button
            type="button"
            data-slot="save-key"
            class="mk-button mk-button--small"
            disabled={busy() !== null}
            onClick={() => setSavingKey(true)}
          >
            <Icon name="key" size={12} />
            {t("handoff.saveKey")}
          </button>
        </Show>
        <Show when={byBot()}>
          <button
            type="button"
            class="mk-button mk-button--ghost mk-button--small"
            disabled={busy() !== null}
            onClick={() => void act("skip")}
          >
            {t("handoff.skip")}
          </button>
        </Show>
      </div>
      <Show when={props.site}>
        {(site) => (
          <p data-slot="key-hint" class="mk-handoff__hint">
            {t("handoff.saveKey.hint", { site: new URL(site()).host, name: props.botName })}
          </p>
        )}
      </Show>
      <Show when={savingKey() && props.site}>
        {(site) => (
          <KeyDialog
            existing={null}
            initial={{
              name: keyNameFor(site()),
              origin: site(),
              sharedWith: props.handOff.botId ? [props.handOff.botId] : [],
            }}
            bots={bots() ?? []}
            onSave={saveKey}
            onClose={() => setSavingKey(false)}
          />
        )}
      </Show>
    </section>
  );
}

/**
 * The bot's page as the Browser panel draws it: a picture that is looked at again every few
 * seconds, who is driving the tab, and a way for the person to take the tab over.
 */
export function BrowserPreview(props: {
  tabId: string;
  botName: string;
  /** Goes up each time the person asks to look at the page again. */
  looks?: number;
}) {
  const [view, setView] = createSignal<BrowserTabView | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [taking, setTaking] = createSignal(false);
  let wanted = "";

  async function look(tabId: string): Promise<void> {
    try {
      const next = await callHost<BrowserTabView>("browser.viewTab", tabId);
      // An answer for a tab the person has since left is dropped.
      if (wanted !== tabId) return;
      setView(next);
      setFailure(null);
    } catch (error) {
      if (wanted === tabId) setFailure(describe(error));
    }
  }

  createEffect(
    on(
      () => props.tabId,
      (tabId) => {
        wanted = tabId;
        setView(null);
        setFailure(null);
        void look(tabId);
      },
    ),
  );

  // Looks again on a timer: often while the person uses the page, calmly while the bot does.
  createEffect(() => {
    const tabId = props.tabId;
    const timer = setInterval(
      () => void look(tabId),
      view()?.controller === "person" ? LIVE_REFRESH_MS : PREVIEW_REFRESH_MS,
    );
    onCleanup(() => clearInterval(timer));
  });

  // The toolbar's button asks for a fresh look at once, without waiting for the next round.
  createEffect(
    on(
      () => props.looks,
      () => void look(props.tabId),
      { defer: true },
    ),
  );

  async function takeOver(): Promise<void> {
    if (taking()) return;
    setTaking(true);
    try {
      // The host raises the bot's browser window as part of taking over.
      await callHost("browser.takeControl", { tabId: props.tabId });
      await look(props.tabId);
    } catch (error) {
      setFailure(describe(error));
    } finally {
      setTaking(false);
    }
  }

  const waiting = () => view()?.controller === "person";

  // What the person does on the page is passed on in the order they did it.
  let sending: Promise<void> = Promise.resolve();
  function send(input: PageInput) {
    const tabId = props.tabId;
    sending = sending
      .then(() => callHost("browser.personInput", { ...input, tabId }))
      .then(() => look(tabId))
      .catch((error) => {
        if (wanted === tabId) setFailure(describe(error));
      });
  }

  function onPageClick(event: MouseEvent & { currentTarget: HTMLElement }): void {
    if (!waiting()) return;
    const picture = event.currentTarget.querySelector("img");
    if (!picture) return;
    const box = picture.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    event.currentTarget.focus();
    send({ kind: "click", x, y });
  }

  function onPageKey(event: KeyboardEvent): void {
    if (!waiting()) return;
    const command = event.ctrlKey || event.metaKey;
    let key: string | null = null;
    if (command && event.key.toLowerCase() === "a") key = "ControlOrMeta+a";
    else if (command || event.altKey) return;
    else if (event.key === "Tab" && event.shiftKey) key = "Shift+Tab";
    else if ((BROWSER_PERSON_KEYS as readonly string[]).includes(event.key)) key = event.key;
    if (key) {
      event.preventDefault();
      send({ kind: "key", key });
    } else if (event.key.length === 1) {
      event.preventDefault();
      send({ kind: "type", text: event.key });
    }
  }

  function onPagePaste(event: ClipboardEvent): void {
    if (!waiting()) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (!text) return;
    event.preventDefault();
    send({ kind: "type", text });
  }

  let scrolled = 0;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  function onPageWheel(event: WheelEvent): void {
    if (!waiting()) return;
    event.preventDefault();
    scrolled += event.deltaY;
    // Many small wheel steps become one scroll, so the page is not flooded.
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const deltaY = scrolled;
      scrolled = 0;
      if (deltaY !== 0) send({ kind: "scroll", deltaY });
    }, 120);
  }
  onCleanup(() => clearTimeout(scrollTimer));

  async function giveBack(): Promise<void> {
    try {
      await callHost("browser.resumeControl", { tabId: props.tabId });
      await look(props.tabId);
    } catch (error) {
      setFailure(describe(error));
    }
  }

  return (
    <div data-component="BrowserPreview" class="mk-preview">
      <div
        data-slot="page"
        class="mk-preview__page"
        classList={{ "is-live": waiting() }}
        tabIndex={waiting() ? 0 : undefined}
        role="application"
        aria-label={waiting() ? t("preview.live.label") : t("preview.watch.label")}
        onClick={onPageClick}
        onKeyDown={onPageKey}
        onPaste={onPagePaste}
        on:wheel={{ handleEvent: onPageWheel, passive: false }}
      >
        <Switch fallback={<p class="mk-preview__note">{t("common.loading.busy")}</p>}>
          <Match when={failure()}>
            {(message) => (
              <div class="mk-preview__note" role="alert">
                <strong>{t("preview.failed.title")}</strong>
                <span>{message()}</span>
                <button
                  type="button"
                  class="mk-button mk-button--small"
                  onClick={() => void look(props.tabId)}
                >
                  <Icon name="refresh" size={12} />
                  {t("common.retry")}
                </button>
              </div>
            )}
          </Match>
          <Match when={view()?.problem}>
            {(problem) => (
              <p class="mk-preview__note" role="alert">
                {problem()}
              </p>
            )}
          </Match>
          <Match when={view()?.image}>
            {(image) => (
              <img
                src={image()}
                alt={t("preview.alt", { title: view()?.tab.title || view()?.tab.url || "" })}
              />
            )}
          </Match>
          <Match when={view()}>
            <p class="mk-preview__note">{t("preview.noImage")}</p>
          </Match>
        </Switch>
      </div>
      <Show when={view()}>
        {(current) => (
          <div data-slot="status" class="mk-preview__status">
            <span>
              <strong>
                {waiting()
                  ? t("preview.waiting", { name: props.botName })
                  : t("preview.driving", { name: props.botName })}
              </strong>
              <small>
                {waiting()
                  ? t("preview.live.hint")
                  : (current().handOff?.reason ?? current().tab.url)}
              </small>
            </span>
            <Show
              when={waiting()}
              fallback={
                <button
                  type="button"
                  class="mk-button mk-button--small"
                  disabled={taking()}
                  onClick={() => void takeOver()}
                >
                  <Icon name="pointer" size={12} />
                  {t("preview.takeOver")}
                </button>
              }
            >
              <button
                type="button"
                class="mk-button mk-button--small"
                onClick={() => void giveBack()}
              >
                <Icon name="check" size={12} />
                {t("handoff.giveBack", { name: props.botName })}
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
