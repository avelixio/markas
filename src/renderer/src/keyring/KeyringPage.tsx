import { createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import type { BotSummary } from "../../../shared/ipc";
import { AgentAvatar } from "../components/AgentAvatar";
import { language, t, tCount } from "../i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { KeyDialog } from "./KeyDialog";
import { type KeyDraft, type KeyKind, type KeySummary, keyringClient } from "./keyring-client";
import "./keyring.css";

const KIND_ICONS: Record<KeyKind, IconName> = { login: "user", token: "key", variable: "terminal" };
/** How long a shown value stays on screen. */
const REVEAL_MS = 30_000;

type Dialog =
  | { type: "add" }
  | { type: "edit"; key: KeySummary; share?: boolean }
  | { type: "reveal"; key: KeySummary }
  | { type: "remove"; key: KeySummary };

interface Revealed {
  id: string;
  value: string;
  twoStepSeed: string | null;
}

/** The Keyring area: every key, who may use it, and the forms to manage them. */
export function KeyringPage() {
  const [keys, { refetch }] = createResource(() => keyringClient.list());
  const [bots] = createResource<BotSummary[]>(() => window.markas.agent.listBots());
  const [dialog, setDialog] = createSignal<Dialog | null>(null);
  const [revealed, setRevealed] = createSignal<Revealed | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal<string | null>(null);
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(revealTimer);
    clearTimeout(savedTimer);
  });

  const botName = (id: string) => bots()?.find((bot) => bot.id === id);
  const lastUsed = (key: KeySummary) =>
    key.lastUsedAt
      ? new Date(key.lastUsedAt).toLocaleString(language(), {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : t("common.never");

  const save = async (draft: KeyDraft) => {
    const current = dialog();
    if (current?.type === "edit") await keyringClient.update(current.key.id, draft);
    else await keyringClient.create(draft);
    setDialog(null);
    // Saying who can use it now is the check that the key was shared as meant.
    const names = draft.sharedWith.map((id) => botName(id)?.name ?? id);
    setSaved(
      names.length > 0
        ? t("keyring.saved.shared", { name: draft.name, bots: names.join(", ") })
        : t("keyring.saved.unshared", { name: draft.name }),
    );
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => setSaved(null), 8000);
    await refetch();
  };

  const hide = () => {
    clearTimeout(revealTimer);
    setRevealed(null);
  };

  const reveal = async (key: KeySummary) => {
    setDialog(null);
    try {
      const secret = await keyringClient.reveal(key.id);
      setRevealed({ id: key.id, ...secret });
      clearTimeout(revealTimer);
      revealTimer = setTimeout(hide, REVEAL_MS);
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const remove = async (key: KeySummary) => {
    setDialog(null);
    try {
      await keyringClient.remove(key.id);
      await refetch();
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <section data-component="KeyringPage" class="mk-page" aria-labelledby="keyring-title">
      <header data-slot="header" class="mk-page__header">
        <div>
          <h1 id="keyring-title">{t("keyring.title")}</h1>
          <p>{t("keyring.subtitle")}</p>
        </div>
        {/* An empty Keyring has its own Add key in the middle; one is enough. */}
        <Show when={!keys.error && !keys.loading && (keys()?.length ?? 0) > 0}>
          <button
            type="button"
            class="mk-button mk-button--primary"
            onClick={() => setDialog({ type: "add" })}
          >
            <Icon name="plus" />
            {t("keyring.add")}
          </button>
        </Show>
      </header>

      <div data-slot="body" class="mk-page__body">
        <Show when={saved()}>
          {(message) => (
            <p data-slot="saved" class="mk-form-ok" role="status">
              <Icon name="check" size={12} />
              {message()}
            </p>
          )}
        </Show>
        <Show when={actionError()}>
          <p class="mk-form-error" role="alert">
            <Icon name="warning" size={12} />
            {actionError()}
          </p>
        </Show>

        <Switch>
          <Match when={keys.loading}>
            <p class="mk-quiet" role="status">
              {t("keyring.loading")}
            </p>
          </Match>
          <Match when={keys.error}>
            <div data-slot="error" class="mk-notice mk-notice--warn" role="alert">
              <Icon name="key" />
              <div>
                <strong>{t("keyring.error.title")}</strong>
                <span>{String(keys.error instanceof Error ? keys.error.message : keys.error)}</span>
              </div>
              <button type="button" class="mk-button" onClick={() => void refetch()}>
                {t("common.retry")}
              </button>
            </div>
          </Match>
          <Match when={keys()?.length === 0}>
            <div data-slot="empty" class="mk-empty">
              <span class="mk-empty__mark">
                <Icon name="key" size={22} />
              </span>
              <h2>{t("keyring.empty.title")}</h2>
              <p>{t("keyring.empty.body")}</p>
              <p>{t("keyring.notice.body")}</p>
              <button
                type="button"
                class="mk-button mk-button--primary"
                onClick={() => setDialog({ type: "add" })}
              >
                <Icon name="plus" />
                {t("keyring.add")}
              </button>
            </div>
          </Match>
          <Match when={keys()}>
            <div class="mk-table-scroll">
              <table data-slot="table" class="mk-table">
                <thead>
                  <tr>
                    <th scope="col">{t("keyring.column.name")}</th>
                    <th scope="col">{t("keyring.column.bound")}</th>
                    <th scope="col">{t("keyring.column.shared")}</th>
                    <th scope="col">{t("keyring.column.fills")}</th>
                    <th scope="col">{t("keyring.column.used")}</th>
                    <th scope="col">
                      <span class="mk-visually-hidden">{t("keyring.column.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={keys()}>
                    {(key) => (
                      <tr data-key={key.name}>
                        <th scope="row">
                          <span class="mk-key-name">
                            <Icon name={KIND_ICONS[key.kind]} size={14} />
                            <span class="mk-key-name__text">
                              <span class="mk-mono">{key.name}</span>
                              <small>{key.username ?? t(`keyring.kind.${key.kind}`)}</small>
                              <Show when={key.hasTwoStepCode}>
                                <span class="mk-key-chips">
                                  <span class="mk-chip">
                                    <Icon name="clock" size={12} />
                                    {t("keyring.twoStep")}
                                  </span>
                                </span>
                              </Show>
                            </span>
                          </span>
                          <Show when={revealed()?.id === key.id}>
                            <output class="mk-revealed" aria-live="polite">
                              <span>{t("keyring.reveal.value", { name: key.name })}</span>
                              <code>{revealed()?.value}</code>
                              <Show when={revealed()?.twoStepSeed}>
                                <span>{t("keyring.reveal.seed")}</span>
                                <code>{revealed()?.twoStepSeed}</code>
                              </Show>
                              <button
                                type="button"
                                class="mk-button mk-button--small"
                                onClick={hide}
                              >
                                {t("keyring.reveal.hide")}
                              </button>
                            </output>
                          </Show>
                        </th>
                        <td class="mk-mono">{key.origin ?? key.variable}</td>
                        <td>
                          <Show
                            when={key.sharedWith.length > 0}
                            fallback={
                              <button
                                type="button"
                                class="mk-button mk-button--small mk-button--ghost"
                                aria-label={t("keyring.shareWith", { name: key.name })}
                                onClick={() => setDialog({ type: "edit", key, share: true })}
                              >
                                <Icon name="plus" size={12} />
                                {t("keyring.share")}
                              </button>
                            }
                          >
                            <span class="mk-sigil-row">
                              <For each={key.sharedWith}>
                                {(botId) => (
                                  <span title={botName(botId)?.name ?? botId}>
                                    <AgentAvatar
                                      shape={botName(botId)?.avatarShape}
                                      color={botName(botId)?.avatarColor}
                                      class="mk-share__sigil"
                                    />
                                    <span class="mk-visually-hidden">
                                      {botName(botId)?.name ?? botId}
                                    </span>
                                  </span>
                                )}
                              </For>
                            </span>
                          </Show>
                        </td>
                        <td>
                          {key.kind === "variable" ? "" : t(`keyring.fill.${key.fillPolicy}`)}
                        </td>
                        <td>{lastUsed(key)}</td>
                        <td class="mk-table__actions">
                          <button
                            type="button"
                            class="mk-icon-button"
                            aria-label={t("keyring.action.edit", { name: key.name })}
                            onClick={() => setDialog({ type: "edit", key })}
                          >
                            <Icon name="pencil" />
                          </button>
                          <button
                            type="button"
                            class="mk-icon-button"
                            aria-label={t("keyring.action.show", { name: key.name })}
                            onClick={() => setDialog({ type: "reveal", key })}
                          >
                            <Icon name="eye" />
                          </button>
                          <button
                            type="button"
                            class="mk-icon-button"
                            aria-label={t("keyring.action.remove", { name: key.name })}
                            onClick={() => setDialog({ type: "remove", key })}
                          >
                            <Icon name="trash" />
                          </button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <p class="mk-quiet">{tCount("keyring.count", keys()?.length ?? 0)}</p>
          </Match>
        </Switch>
      </div>

      <Switch>
        <Match when={dialog()?.type === "add"}>
          <KeyDialog
            existing={null}
            takenNames={(keys() ?? []).map((key) => key.name)}
            bots={bots() ?? []}
            onSave={save}
            onClose={() => setDialog(null)}
          />
        </Match>
        <Match when={dialog()?.type === "edit" ? (dialog() as { key: KeySummary }).key : null}>
          {(key) => (
            <KeyDialog
              existing={key()}
              focusSharing={(dialog() as { share?: boolean } | null)?.share === true}
              bots={bots() ?? []}
              onSave={save}
              onClose={() => setDialog(null)}
            />
          )}
        </Match>
        <Match when={dialog()?.type === "reveal" ? (dialog() as { key: KeySummary }).key : null}>
          {(key) => (
            <Confirm
              icon="eye"
              tone="info"
              title={t("keyring.reveal.title")}
              body={t("keyring.reveal.body", { name: key().name })}
              confirm={t("keyring.reveal.confirm")}
              onConfirm={() => void reveal(key())}
              onClose={() => setDialog(null)}
            />
          )}
        </Match>
        <Match when={dialog()?.type === "remove" ? (dialog() as { key: KeySummary }).key : null}>
          {(key) => (
            <Confirm
              icon="trash"
              tone="danger"
              title={t("keyring.remove.title", { name: key().name })}
              body={t("keyring.remove.body")}
              confirm={t("keyring.remove.confirm")}
              onConfirm={() => void remove(key())}
              onClose={() => setDialog(null)}
            />
          )}
        </Match>
      </Switch>
    </section>
  );
}

interface ConfirmProps {
  icon: IconName;
  tone: "info" | "danger";
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** A small yes-or-no dialog. Cancel is the default so Enter never destroys anything. */
export function Confirm(props: ConfirmProps) {
  return (
    <div data-component="Confirm" class="mk-scrim">
      <div
        class="mk-dialog mk-dialog--small"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <span classList={{ "mk-dialog__mark": true, [`mk-dialog__mark--${props.tone}`]: true }}>
          <Icon name={props.icon} size={20} />
        </span>
        <h2 id="confirm-title">{props.title}</h2>
        <p>{props.body}</p>
        <footer class="mk-dialog__actions">
          <button type="button" class="mk-button" autofocus onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            classList={{
              "mk-button": true,
              "mk-button--primary": props.tone === "info",
              "mk-button--danger": props.tone === "danger",
            }}
            onClick={props.onConfirm}
          >
            {props.confirm}
          </button>
        </footer>
      </div>
    </div>
  );
}
