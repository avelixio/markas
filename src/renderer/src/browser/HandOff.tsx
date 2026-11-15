import { createEffect, createSignal, Match, on, onCleanup, Show, Switch } from "solid-js";
import type { BrowserHandOff, BrowserTabView } from "../../../shared/ipc";
import { callHost } from "../host-client";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import "./browser.css";

/** How often the panel looks at the bot's page again while it is open. */
export const PREVIEW_REFRESH_MS = 2_500;

/** What the bot is told when the person skips its step. It is written to the bot, not shown. */
const SKIP_NOTE =
  "The person chose to skip this step. Do not ask for it again; carry on without it or say what could not be done.";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Minutes since a moment, never below zero. */
function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

/**
 * Shown in the conversation while a tab is in the person's hands: the bot passed a step on,
 * or the person took over. It always offers a way forward, even when the browser cannot open.
 */
export function HandOffCard(props: { handOff: BrowserHandOff; botName: string }) {
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
        const timer = setInterval(() => void look(tabId), PREVIEW_REFRESH_MS);
        onCleanup(() => clearInterval(timer));
      },
    ),
  );

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

  return (
    <div data-component="BrowserPreview" class="mk-preview">
      <div data-slot="page" class="mk-preview__page" classList={{ "is-dim": waiting() }}>
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
              <small>{current().handOff?.reason ?? current().tab.url}</small>
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
                onClick={() =>
                  void callHost("browser.bringToFront", props.tabId).catch((error) =>
                    setFailure(describe(error)),
                  )
                }
              >
                <Icon name="external" size={12} />
                {t("handoff.open", { name: props.botName })}
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
