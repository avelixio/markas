import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import type { BotSummary } from "../../../shared/ipc";
import { AgentAvatar } from "../components/AgentAvatar";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { keyNameFor, uniqueKeyName } from "./key-name";
import {
  FILL_POLICIES,
  type FillPolicy,
  KEY_KINDS,
  type KeyDraft,
  type KeyKind,
  type KeySummary,
  keyringClient,
} from "./keyring-client";

type TwoStepOk = { ok: true; digits: number; periodSeconds: number };
type TwoStepProblem = { ok: false; message: string };

interface KeyDialogProps {
  /** The key being edited, or null to add a new one. */
  existing: KeySummary | null;
  /** What a new key starts with, when it is added from somewhere that already knows the site. */
  initial?: { name?: string; origin?: string; sharedWith?: string[] };
  /** Names other keys already have, so a name made from the website does not clash. */
  takenNames?: string[];
  bots: BotSummary[];
  onSave: (draft: KeyDraft) => Promise<void>;
  onClose: () => void;
}

/** Add or edit a key. A key's kind cannot change after it is created. */
export function KeyDialog(props: KeyDialogProps) {
  const existing = props.existing;
  const [kind, setKind] = createSignal<KeyKind>(existing?.kind ?? "login");
  const [name, setName] = createSignal(existing?.name ?? props.initial?.name ?? "");
  const [origin, setOrigin] = createSignal(existing?.origin ?? props.initial?.origin ?? "");
  // A new key's name follows its website until the person writes a name of their own.
  const [nameTouched, setNameTouched] = createSignal(Boolean(existing || props.initial?.name));
  const changeName = (next: string) => {
    setName(next);
    setNameTouched(next.trim() !== "");
  };
  const changeOrigin = (next: string) => {
    setOrigin(next);
    if (nameTouched()) return;
    setName(next.trim() ? uniqueKeyName(keyNameFor(next.trim()), props.takenNames ?? []) : "");
  };
  const [username, setUsername] = createSignal(existing?.username ?? "");
  const [variable, setVariable] = createSignal(existing?.variable ?? "");
  const [value, setValue] = createSignal("");
  const [twoStepSeed, setTwoStepSeed] = createSignal("");
  const [twoStepCheck, setTwoStepCheck] = createSignal<TwoStepOk | TwoStepProblem | null>(null);

  const twoStepOk = () => {
    const check = twoStepCheck();
    return check?.ok ? check : null;
  };
  const twoStepProblem = () => {
    const check = twoStepCheck();
    return check && !check.ok ? check : null;
  };

  /** Asks the host whether the pasted setup key can make codes, before anything is saved. */
  async function checkTwoStep(): Promise<void> {
    const seed = twoStepSeed().trim();
    if (!seed) {
      setTwoStepCheck(null);
      return;
    }
    try {
      const settings = await keyringClient.checkTwoStep(seed);
      if (twoStepSeed().trim() === seed) setTwoStepCheck({ ok: true, ...settings });
    } catch (failure) {
      if (twoStepSeed().trim() !== seed) return;
      setTwoStepCheck({
        ok: false,
        message: failure instanceof Error ? failure.message : String(failure),
      });
    }
  }
  const [fillPolicy, setFillPolicy] = createSignal<FillPolicy>(existing?.fillPolicy ?? "auto");
  const [sharedWith, setSharedWith] = createSignal<string[]>(
    existing?.sharedWith ?? props.initial?.sharedWith ?? [],
  );
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let firstField: HTMLInputElement | undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !saving()) props.onClose();
  };
  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    firstField?.focus();
  });
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  const toggleBot = (botId: string) =>
    setSharedWith((current) =>
      current.includes(botId) ? current.filter((id) => id !== botId) : [...current, botId],
    );

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const draft: KeyDraft = {
      name: name().trim().toLowerCase(),
      kind: kind(),
      fillPolicy: fillPolicy(),
      sharedWith: sharedWith(),
    };
    if (kind() === "variable") draft.variable = variable().trim();
    else draft.origin = origin().trim();
    if (kind() === "login") draft.username = username().trim();
    // On an edit, an empty value means "keep what is saved".
    if (value() || !existing) draft.value = value();
    if (kind() === "login" && twoStepSeed().trim()) draft.twoStepSeed = twoStepSeed().trim();
    try {
      await props.onSave(draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  const valueLabel = () =>
    kind() === "login"
      ? t("keyring.form.password")
      : kind() === "token"
        ? t("keyring.form.token")
        : t("keyring.form.value");

  return (
    <div data-component="KeyDialog" class="mk-scrim">
      <form
        class="mk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-dialog-title"
        onSubmit={submit}
      >
        <header data-slot="header" class="mk-dialog__header">
          <span class="mk-dialog__mark">
            <Icon name="key" />
          </span>
          <div>
            <h2 id="key-dialog-title">
              {existing
                ? t("keyring.form.editTitle", { name: existing.name })
                : t("keyring.form.addTitle")}
            </h2>
            <p>{t("keyring.form.lead")}</p>
          </div>
          <button
            type="button"
            class="mk-icon-button"
            aria-label={t("common.close")}
            onClick={props.onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <Show when={!existing}>
          <fieldset data-slot="kind" class="mk-segmented">
            <legend class="mk-visually-hidden">{t("keyring.form.kind")}</legend>
            <For each={KEY_KINDS}>
              {(option) => (
                <label classList={{ "mk-segmented__item": true, "is-active": kind() === option }}>
                  <input
                    type="radio"
                    name="key-kind"
                    value={option}
                    checked={kind() === option}
                    onChange={() => setKind(option)}
                  />
                  {t(`keyring.kind.${option}`)}
                </label>
              )}
            </For>
          </fieldset>
        </Show>

        <div data-slot="fields" class="mk-form-grid">
          <label class="mk-field">
            <span>{t("keyring.form.name")}</span>
            <input
              ref={firstField}
              id="key-name"
              class="mk-input mk-input--mono"
              value={name()}
              onInput={(event) => changeName(event.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
              required
            />
            <small>{t("keyring.form.name.hint")}</small>
          </label>

          <Show
            when={kind() !== "variable"}
            fallback={
              <label class="mk-field">
                <span>{t("keyring.form.variable")}</span>
                <input
                  id="key-variable"
                  class="mk-input mk-input--mono"
                  value={variable()}
                  onInput={(event) => setVariable(event.currentTarget.value)}
                  autocomplete="off"
                  spellcheck={false}
                  required
                />
                <small>{t("keyring.form.variable.hint")}</small>
              </label>
            }
          >
            <label class="mk-field">
              <span>{t("keyring.form.origin")}</span>
              <input
                id="key-origin"
                class="mk-input mk-input--mono"
                value={origin()}
                onInput={(event) => changeOrigin(event.currentTarget.value)}
                placeholder="https://admin.example.com"
                autocomplete="off"
                spellcheck={false}
                required
              />
              <small>{t("keyring.form.origin.hint")}</small>
            </label>
          </Show>

          <Show when={kind() === "login"}>
            <label class="mk-field">
              <span>{t("keyring.form.username")}</span>
              <input
                id="key-username"
                class="mk-input"
                value={username()}
                onInput={(event) => setUsername(event.currentTarget.value)}
                autocomplete="off"
                required
              />
            </label>
          </Show>

          <label class="mk-field">
            <span>{valueLabel()}</span>
            <input
              id="key-value"
              class="mk-input"
              type="password"
              value={value()}
              onInput={(event) => setValue(event.currentTarget.value)}
              autocomplete="new-password"
              required={!existing}
            />
            <Show when={existing}>
              <small>{t("keyring.form.value.keep")}</small>
            </Show>
          </label>

          <Show when={kind() === "login"}>
            <label class="mk-field">
              <span>{t("keyring.form.twoStep")}</span>
              <input
                id="key-two-step"
                class="mk-input mk-input--mono"
                type="password"
                value={twoStepSeed()}
                onInput={(event) => {
                  setTwoStepSeed(event.currentTarget.value);
                  setTwoStepCheck(null);
                }}
                onBlur={() => void checkTwoStep()}
                autocomplete="off"
              />
              <small>{t("keyring.form.twoStep.hint")}</small>
              <Switch>
                <Match when={twoStepOk()}>
                  {(check) => (
                    <small data-slot="two-step-ok" class="mk-form-ok" role="status">
                      <Icon name="check" size={12} />
                      {t("keyring.form.twoStep.ok", {
                        digits: check().digits,
                        seconds: check().periodSeconds,
                      })}
                    </small>
                  )}
                </Match>
                <Match when={twoStepProblem()}>
                  {(check) => (
                    <small data-slot="two-step-problem" class="mk-form-error" role="alert">
                      <Icon name="warning" size={12} />
                      {check().message}
                    </small>
                  )}
                </Match>
              </Switch>
            </label>
          </Show>

          <Show when={kind() !== "variable"}>
            <fieldset class="mk-field">
              <legend>{t("keyring.form.fill")}</legend>
              <div class="mk-segmented">
                <For each={FILL_POLICIES}>
                  {(option) => (
                    <label
                      classList={{
                        "mk-segmented__item": true,
                        "is-active": fillPolicy() === option,
                      }}
                    >
                      <input
                        type="radio"
                        name="key-fill"
                        value={option}
                        checked={fillPolicy() === option}
                        onChange={() => setFillPolicy(option)}
                      />
                      {t(`keyring.fill.${option}`)}
                    </label>
                  )}
                </For>
              </div>
              <small>{t("keyring.form.fill.hint")}</small>
            </fieldset>
          </Show>
        </div>

        <fieldset data-slot="sharing" class="mk-field">
          <legend>{t("keyring.form.shared")}</legend>
          <Show
            when={props.bots.length > 0}
            fallback={<small>{t("keyring.form.shared.empty")}</small>}
          >
            <div class="mk-share-list">
              <For each={props.bots}>
                {(bot) => (
                  <label
                    classList={{ "mk-share": true, "is-active": sharedWith().includes(bot.id) }}
                  >
                    <input
                      type="checkbox"
                      checked={sharedWith().includes(bot.id)}
                      onChange={() => toggleBot(bot.id)}
                    />
                    <AgentAvatar
                      shape={bot.avatarShape}
                      color={bot.avatarColor}
                      class="mk-share__sigil"
                    />
                    {bot.name}
                  </label>
                )}
              </For>
            </div>
            <small>{t("keyring.form.shared.hint")}</small>
          </Show>
        </fieldset>

        <Show when={error()}>
          <p data-slot="error" class="mk-form-error" role="alert">
            <Icon name="warning" size={12} />
            {error()}
          </p>
        </Show>

        <footer data-slot="actions" class="mk-dialog__actions">
          <button type="button" class="mk-button mk-button--ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" class="mk-button mk-button--primary" disabled={saving()}>
            <Icon name="lock" />
            {saving() ? t("keyring.form.saving") : t("keyring.form.save")}
          </button>
        </footer>
      </form>
    </div>
  );
}
