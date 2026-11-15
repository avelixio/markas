import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { callHost } from "../host-client";
import { language, type MessageKey, t } from "../i18n";
import {
  type CrewNotice,
  markNoticesRead,
  type NoticeKind,
  needsPerson,
  noticeSeenAt,
  shownNotices,
} from "./crew-signal";
import { Icon } from "./Icon";

const TITLE: Record<NoticeKind, MessageKey> = {
  handoff: "notices.handoff",
  approval: "notices.approval",
  finished: "notices.finished",
  failed: "notices.failed",
};

const clock = (time: number) =>
  new Date(time).toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });

/**
 * The list behind the bell: what waits on the person first, then the news.
 * Choosing a notice opens that bot's chat, where the thing itself can be dealt with.
 */
export function Notifications(props: { onOpenBot: (botId: string) => void; onClose: () => void }) {
  const [problem, setProblem] = createSignal<string | null>(null);
  const ordered = () =>
    [...shownNotices()].sort(
      (left, right) =>
        Number(needsPerson(right.kind)) - Number(needsPerson(left.kind)) ||
        noticeSeenAt(right.key) - noticeSeenAt(left.key),
    );
  const hasNews = () => shownNotices().some((notice) => !needsPerson(notice.kind));

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") props.onClose();
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  const openBrowser = (notice: CrewNotice) => {
    setProblem(null);
    void callHost("browser.bringToFront", notice.tabId).catch((error) =>
      setProblem(error instanceof Error ? error.message : String(error)),
    );
  };

  return (
    <>
      <button
        type="button"
        class="mk-notices__scrim"
        aria-label={t("notices.close")}
        tabIndex={-1}
        onClick={props.onClose}
      />
      <section data-component="Notifications" class="mk-notices" aria-label={t("notices.title")}>
        <header data-slot="header">
          <h2>{t("notices.title")}</h2>
          <Show when={hasNews()}>
            <button
              type="button"
              class="mk-button mk-button--ghost mk-button--small"
              onClick={markNoticesRead}
            >
              {t("notices.markRead")}
            </button>
          </Show>
        </header>
        <Show when={problem()}>
          {(message) => (
            <p data-slot="problem" class="mk-form-error" role="alert">
              <Icon name="warning" size={12} />
              {message()}
            </p>
          )}
        </Show>
        <Show
          when={ordered().length > 0}
          fallback={
            <p data-slot="empty" class="mk-notices__empty">
              {t("notices.empty")}
            </p>
          }
        >
          <ul data-slot="list">
            <For each={ordered()}>
              {(notice) => (
                <li data-kind={notice.kind}>
                  <span class="mk-notices__dot" aria-hidden="true" />
                  <div>
                    <strong>
                      {notice.botName}
                      <em>{t(TITLE[notice.kind])}</em>
                    </strong>
                    <Show when={notice.detail}>
                      <p>{notice.detail}</p>
                    </Show>
                    <div data-slot="actions" class="mk-notices__actions">
                      <button
                        type="button"
                        class="mk-button mk-button--small"
                        onClick={() => props.onOpenBot(notice.botId)}
                      >
                        {t(needsPerson(notice.kind) ? "notices.review" : "notices.open")}
                      </button>
                      <Show when={notice.kind === "handoff" && notice.tabId}>
                        <button
                          type="button"
                          class="mk-button mk-button--ghost mk-button--small"
                          onClick={() => openBrowser(notice)}
                        >
                          <Icon name="external" size={12} />
                          {t("notices.openBrowser")}
                        </button>
                      </Show>
                    </div>
                  </div>
                  <time>{clock(noticeSeenAt(notice.key))}</time>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <p data-slot="note" class="mk-notices__foot">
          <Icon name="info" size={12} /> {t("notices.note")}
        </p>
      </section>
    </>
  );
}
