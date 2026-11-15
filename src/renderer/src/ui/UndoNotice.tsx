import { createSignal, onCleanup, Show } from "solid-js";
import { t } from "../i18n";
import { Icon } from "./Icon";
import "./undo-notice.css";

/** How long the notice stays before it leaves by itself. */
export const UNDO_NOTICE_MS = 12_000;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Says what was just done and offers to take it back.
 * It leaves by itself after a while, but not while the undo is running or has failed,
 * so a failure is never missed.
 */
export function UndoNotice(props: {
  message: string;
  /** Takes the action back. A rejection is shown in the notice. */
  onUndo: () => Promise<void>;
  onDismiss: () => void;
  /** Where the thing can still be taken back after the notice is gone. */
  hint?: string;
}) {
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const timer = setTimeout(() => {
    if (!busy() && !problem()) props.onDismiss();
  }, UNDO_NOTICE_MS);
  onCleanup(() => clearTimeout(timer));

  async function undo(): Promise<void> {
    if (busy()) return;
    setBusy(true);
    setProblem(null);
    try {
      await props.onUndo();
      props.onDismiss();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-component="UndoNotice" class="mk-undo" role="status">
      <span data-slot="message" class="mk-undo__message">
        <strong>{props.message}</strong>
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
        <Show when={problem()}>
          {(message) => (
            <small data-slot="problem" class="mk-undo__problem" role="alert">
              {t("undo.failed", { reason: message() })}
            </small>
          )}
        </Show>
      </span>
      <div data-slot="actions" class="mk-undo__actions">
        <button
          type="button"
          class="mk-button mk-button--small"
          disabled={busy()}
          onClick={() => void undo()}
        >
          {busy() ? t("undo.busy") : t("undo.action")}
        </button>
        <button
          type="button"
          class="mk-icon-button"
          aria-label={t("undo.dismiss")}
          onClick={() => props.onDismiss()}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}
