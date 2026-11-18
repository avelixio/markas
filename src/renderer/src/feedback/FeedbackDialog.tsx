import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  detailLines,
  FEEDBACK_LIMITS,
  type FeedbackDetails,
  type FeedbackDraft,
  type FeedbackKind,
  type FeedbackSent,
  githubIssueUrl,
} from "../../../shared/feedback";
import { callHost } from "../host-client";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import "./feedback.css";

export interface FeedbackClient {
  details(): Promise<FeedbackDetails>;
  send(draft: FeedbackDraft): Promise<FeedbackSent>;
  openUrl(url: string): Promise<void>;
}

export const feedbackClient: FeedbackClient = {
  details: () => callHost<FeedbackDetails>("feedback.details"),
  send: (draft) => callHost<FeedbackSent>("feedback.send", draft),
  openUrl: (url) => window.markas.openUrl(url),
};

const KINDS: FeedbackKind[] = ["bug", "idea"];

/**
 * Send feedback: a bug or an idea, with the details about this computer shown in full.
 * The person picks the way out: GitHub with their own account, or directly without one.
 */
export function FeedbackDialog(props: { onClose: () => void; client?: FeedbackClient }) {
  const client = props.client ?? feedbackClient;
  const [details] = createResource(() => client.details().catch(() => null));
  const [kind, setKind] = createSignal<FeedbackKind>("bug");
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [includeDetails, setIncludeDetails] = createSignal(true);
  const [sending, setSending] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [sent, setSent] = createSignal<FeedbackSent | null>(null);
  let titleField: HTMLInputElement | undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !sending()) props.onClose();
  };
  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    titleField?.focus();
  });
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  const draft = (): FeedbackDraft | null => {
    if (!title().trim()) {
      setProblem(t("feedback.needsTitle"));
      titleField?.focus();
      return null;
    }
    return {
      kind: kind(),
      title: title(),
      description: description(),
      details: includeDetails() ? (details() ?? null) : null,
    };
  };

  const openOnGitHub = async () => {
    setProblem(null);
    setNotice(null);
    const report = draft();
    if (!report) return;
    try {
      await client.openUrl(githubIssueUrl(report));
      setNotice(t("feedback.opened"));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const sendDirectly = async (event: SubmitEvent) => {
    event.preventDefault();
    setProblem(null);
    setNotice(null);
    const report = draft();
    if (!report) return;
    setSending(true);
    try {
      setSent(await client.send(report));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-component="FeedbackDialog" class="mk-scrim">
      <Show
        when={sent()}
        fallback={
          <form
            class="mk-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            onSubmit={sendDirectly}
          >
            <header data-slot="header" class="mk-dialog__header">
              <span class="mk-dialog__mark">
                <Icon name="chat" />
              </span>
              <div>
                <h2 id="feedback-title">{t("feedback.title")}</h2>
                <p>{t("feedback.lead")}</p>
              </div>
              <button
                type="button"
                class="mk-icon-button"
                aria-label={t("common.close")}
                onClick={props.onClose}
                disabled={sending()}
              >
                <Icon name="close" />
              </button>
            </header>

            <fieldset data-slot="kind" class="mk-segmented">
              <legend class="mk-visually-hidden">{t("feedback.kind")}</legend>
              <For each={KINDS}>
                {(option) => (
                  <label classList={{ "mk-segmented__item": true, "is-active": kind() === option }}>
                    <input
                      type="radio"
                      name="feedback-kind"
                      value={option}
                      checked={kind() === option}
                      onChange={() => setKind(option)}
                    />
                    {t(option === "bug" ? "feedback.kind.bug" : "feedback.kind.idea")}
                  </label>
                )}
              </For>
            </fieldset>

            <div data-slot="fields" class="mk-form-grid mk-feedback__fields">
              <label class="mk-field">
                <span>{t("feedback.field.title")}</span>
                <input
                  ref={titleField}
                  class="mk-input"
                  value={title()}
                  onInput={(event) => setTitle(event.currentTarget.value)}
                  maxLength={FEEDBACK_LIMITS.title}
                  placeholder={t(
                    kind() === "bug" ? "feedback.field.title.bug" : "feedback.field.title.idea",
                  )}
                  autocomplete="off"
                  aria-required="true"
                />
              </label>
              <div class="mk-field">
                <label for="feedback-description">
                  {t(
                    kind() === "bug"
                      ? "feedback.field.description.bug"
                      : "feedback.field.description.idea",
                  )}
                </label>
                <textarea
                  id="feedback-description"
                  class="mk-input mk-feedback__description"
                  rows={5}
                  value={description()}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                  maxLength={FEEDBACK_LIMITS.description}
                  aria-describedby="feedback-description-hint"
                />
                <small id="feedback-description-hint">
                  {t(
                    kind() === "bug"
                      ? "feedback.field.description.hint.bug"
                      : "feedback.field.description.hint.idea",
                  )}
                </small>
              </div>
            </div>

            <div data-slot="details" class="mk-feedback__details">
              <label class="mk-feedback__include">
                <input
                  type="checkbox"
                  checked={includeDetails()}
                  onChange={(event) => setIncludeDetails(event.currentTarget.checked)}
                />
                <strong>{t("feedback.details.include")}</strong>
              </label>
              <Show
                when={details()}
                fallback={<p class="mk-quiet">{t("feedback.details.loading")}</p>}
              >
                {(known) => (
                  <dl classList={{ "is-off": !includeDetails() }}>
                    <For each={detailLines(known())}>
                      {([label, value]) => (
                        <div>
                          <dt>{label}</dt>
                          <dd class="mk-mono">{value}</dd>
                        </div>
                      )}
                    </For>
                  </dl>
                )}
              </Show>
              <p class="mk-quiet">{t("feedback.details.none")}</p>
            </div>

            <div data-slot="public" class="mk-notice mk-notice--accent">
              <Icon name="globe" size={14} />
              <div>
                <strong>{t("feedback.public.title")}</strong>
                <span>{t("feedback.public.body")}</span>
              </div>
            </div>

            <Show when={problem()}>
              {(message) => (
                <p data-slot="problem" class="mk-form-error" role="alert">
                  <Icon name="warning" size={12} />
                  {message()}
                </p>
              )}
            </Show>
            <Show when={notice()}>
              {(message) => (
                <p data-slot="notice" class="mk-form-ok" role="status">
                  <Icon name="check" size={12} />
                  {message()}
                </p>
              )}
            </Show>

            <footer data-slot="actions" class="mk-dialog__actions">
              <button
                type="button"
                class="mk-button mk-button--ghost"
                onClick={props.onClose}
                disabled={sending()}
              >
                {t("common.cancel")}
              </button>
              <span class="mk-feedback__spacer" />
              <button
                type="button"
                class="mk-button"
                onClick={() => void openOnGitHub()}
                disabled={sending()}
              >
                <Icon name="external" size={12} />
                {t("feedback.github")}
              </button>
              <button type="submit" class="mk-button mk-button--primary" disabled={sending()}>
                <Icon name="send" size={12} />
                {sending() ? t("feedback.sending") : t("feedback.send")}
              </button>
            </footer>
            <p class="mk-quiet">{t("feedback.ways")}</p>
          </form>
        }
      >
        {(done) => (
          <div
            class="mk-dialog mk-dialog--small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-sent-title"
          >
            <header data-slot="header" class="mk-dialog__header">
              <span class="mk-dialog__mark">
                <Icon name="check" />
              </span>
              <div>
                <h2 id="feedback-sent-title">{t("feedback.sent.title")}</h2>
                <p>{t("feedback.sent.lead")}</p>
              </div>
            </header>
            <p>{t("feedback.sent.body", { number: done().number })}</p>
            <footer data-slot="actions" class="mk-dialog__actions">
              <button type="button" class="mk-button mk-button--ghost" onClick={props.onClose}>
                {t("common.close")}
              </button>
              <button
                type="button"
                class="mk-button mk-button--primary"
                onClick={() => void client.openUrl(done().url)}
              >
                <Icon name="external" size={12} />
                {t("feedback.sent.see")}
              </button>
            </footer>
          </div>
        )}
      </Show>
    </div>
  );
}
