import { createResource, createSignal, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { BotSummary, KeyRequest } from "../../../shared/ipc";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { prefersReducedMotion } from "../ui/motion";
import { KeyDialog } from "./KeyDialog";
import { uniqueKeyName } from "./key-name";
import { type KeyDraft, keyringClient } from "./keyring-client";
import "./keyring.css";

export interface KeyRequestClient {
  listNames(): Promise<string[]>;
  listBots(): Promise<BotSummary[]>;
  save(draft: KeyDraft): Promise<void>;
}

const defaultClient: KeyRequestClient = {
  listNames: async () => (await keyringClient.list()).map((key) => key.name),
  listBots: () => window.markas.agent.listBots(),
  save: async (draft) => {
    await keyringClient.create(draft);
  },
};

/**
 * A bot asked for a key it does not have. The person types the secret here, straight into the
 * Keyring, shared with that bot only; the bot is told the key's name and never its value.
 */
export function KeyRequestCard(props: {
  request: KeyRequest;
  botName: string;
  /** Answers the bot: true once the key is saved, false for not now. */
  onAnswer: (saved: boolean) => Promise<boolean>;
  client?: KeyRequestClient;
}) {
  const client = props.client ?? defaultClient;
  const request = props.request;
  const [taken] = createResource(() => client.listNames().catch(() => [] as string[]));
  const keyName = () => uniqueKeyName(request.name, taken() ?? []);
  const [username, setUsername] = createSignal(request.username ?? "");
  const [secret, setSecret] = createSignal("");
  const [showSecret, setShowSecret] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [moreOpen, setMoreOpen] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [bots, setBots] = createSignal<BotSummary[]>([]);
  let firstField: HTMLInputElement | undefined;
  onMount(() => firstField?.focus());

  const isLogin = request.kind === "login";
  const secretLabel = () => (isLogin ? t("keyring.form.password") : t("keyring.form.token"));

  /** Saves, shows the check for a moment so the person sees it landed, then answers the bot. */
  const finish = async (draft: KeyDraft) => {
    await client.save(draft);
    setMoreOpen(false);
    setDone(true);
    if (!prefersReducedMotion()) await new Promise((resolve) => setTimeout(resolve, SAVED_MS));
    await props.onAnswer(true);
  };

  const saveHere = async (event: SubmitEvent) => {
    event.preventDefault();
    setProblem(null);
    if (isLogin && !username().trim()) {
      setProblem(t("keyring.form.error.username"));
      return;
    }
    if (!secret()) {
      setProblem(t("keyring.form.error.value", { what: secretLabel().toLowerCase() }));
      return;
    }
    setSaving(true);
    try {
      await finish({
        name: keyName(),
        kind: request.kind,
        origin: request.origin,
        ...(isLogin ? { username: username().trim() } : {}),
        value: secret(),
        fillPolicy: "auto",
        sharedWith: [request.botId],
      });
      setSecret("");
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  const openMore = async () => {
    setBots(await client.listBots().catch(() => []));
    setMoreOpen(true);
  };

  return (
    <Show
      when={!done()}
      fallback={
        <p
          data-component="KeyRequestCard"
          class="mk-key-request mk-key-request--done"
          role="status"
        >
          <Icon name="check" size={14} />
          {t("keyring.request.done", { bot: props.botName, name: keyName() })}
        </p>
      }
    >
      <form
        data-component="KeyRequestCard"
        class="mk-key-request"
        aria-labelledby={`key-request-${request.botId}`}
        onSubmit={saveHere}
        noValidate
      >
        <header data-slot="header" class="mk-key-request__header">
          <Icon name="key" size={14} />
          <strong id={`key-request-${request.botId}`}>
            {isLogin
              ? t("keyring.request.title", { bot: props.botName })
              : t("keyring.request.titleToken", { bot: props.botName })}
          </strong>
          <span class="mk-chip mk-key-request__safe">
            <Icon name="lock" size={12} />
            {t("keyring.request.safe")}
          </span>
        </header>
        <p data-slot="reason">
          {t("keyring.request.body", { reason: withStop(request.reason), bot: props.botName })}
        </p>
        <p data-slot="site" class="mk-key-request__site">
          <Icon name="globe" size={12} />
          <span class="mk-mono">{t("keyring.request.site", { site: request.origin })}</span>
        </p>
        <div
          data-slot="fields"
          class="mk-key-request__fields"
          classList={{ "is-single": !isLogin }}
        >
          <Show when={isLogin}>
            <label class="mk-field">
              <span>{t("keyring.form.username")}</span>
              <input
                ref={firstField}
                class="mk-input"
                value={username()}
                onInput={(event) => setUsername(event.currentTarget.value)}
                autocomplete="off"
                spellcheck={false}
              />
            </label>
          </Show>
          <label class="mk-field">
            <span>{secretLabel()}</span>
            <span class="mk-key-dialog__input has-trailing">
              <input
                ref={(element) => {
                  if (!isLogin) firstField = element;
                }}
                class="mk-input"
                type={showSecret() ? "text" : "password"}
                value={secret()}
                onInput={(event) => setSecret(event.currentTarget.value)}
                autocomplete="new-password"
              />
              <button
                type="button"
                class="mk-key-dialog__peek"
                aria-pressed={showSecret()}
                aria-label={
                  showSecret() ? t("keyring.form.hideValue") : t("keyring.form.showValue")
                }
                onClick={() => setShowSecret((current) => !current)}
              >
                <Icon name="eye" size={14} />
              </button>
            </span>
          </label>
        </div>
        <Show when={problem()}>
          {(message) => (
            <p data-slot="problem" class="mk-form-error" role="alert">
              <Icon name="warning" size={12} />
              {message()}
            </p>
          )}
        </Show>
        <footer data-slot="actions" class="mk-key-request__actions">
          <button type="submit" class="mk-button mk-button--primary" disabled={saving()}>
            <Icon name="lock" size={12} />
            {saving()
              ? t("keyring.request.saving")
              : t("keyring.request.save", { bot: props.botName })}
          </button>
          <button
            type="button"
            class="mk-button mk-button--ghost"
            disabled={saving()}
            onClick={() => void openMore()}
          >
            {t("keyring.request.more")}
          </button>
          <button
            type="button"
            class="mk-button mk-button--ghost"
            disabled={saving()}
            onClick={() => void props.onAnswer(false)}
          >
            {t("keyring.request.notNow")}
          </button>
          <small>{t("keyring.request.savedAs", { name: keyName(), bot: props.botName })}</small>
        </footer>

        {/* The full dialog is a form of its own, so it lives outside this card's form. */}
        <Show when={moreOpen()}>
          <Portal>
            <KeyDialog
              existing={null}
              initial={{
                name: keyName(),
                origin: request.origin,
                username: username(),
                kind: request.kind,
                sharedWith: [request.botId],
              }}
              takenNames={taken() ?? []}
              bots={bots()}
              onSave={finish}
              onClose={() => setMoreOpen(false)}
            />
          </Portal>
        </Show>
      </form>
    </Show>
  );
}

/** How long the saved check stays before the bot carries on. */
const SAVED_MS = 600;

const withStop = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);
