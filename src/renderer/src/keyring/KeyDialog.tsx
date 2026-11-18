import { createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js";
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
type Field = "origin" | "variable" | "username" | "value" | "name";

interface KeyDialogProps {
  /** The key being edited, or null to add a new one. */
  existing: KeySummary | null;
  /** What a new key starts with, when it is added from somewhere that already knows the site. */
  initial?: {
    name?: string;
    origin?: string;
    username?: string;
    kind?: KeyKind;
    sharedWith?: string[];
  };
  /** Names other keys already have, so a name made from the website does not clash. */
  takenNames?: string[];
  bots: BotSummary[];
  onSave: (draft: KeyDraft) => Promise<void>;
  onClose: () => void;
  /** Opens with the sharing section in view, for "Share" from the Keyring list. */
  focusSharing?: boolean;
}

/**
 * Add or edit a key. Fields come in the order a person fills them: the website first, the
 * secret, then the name made from the website, and the bots last. The two-step code and the
 * fill rule wait under More options. A key's kind cannot change after it is created.
 */
export function KeyDialog(props: KeyDialogProps) {
  const existing = props.existing;
  const [kind, setKind] = createSignal<KeyKind>(existing?.kind ?? props.initial?.kind ?? "login");
  const [name, setName] = createSignal(existing?.name ?? props.initial?.name ?? "");
  const [origin, setOrigin] = createSignal(existing?.origin ?? props.initial?.origin ?? "");
  // A new key's name follows its website until the person writes a name of their own.
  const [nameTouched, setNameTouched] = createSignal(Boolean(existing || props.initial?.name));
  const changeName = (next: string) => {
    setName(next);
    setNameTouched(next.trim() !== "");
    clearError("name");
  };
  const changeOrigin = (next: string) => {
    setOrigin(next);
    clearError("origin");
    if (nameTouched()) return;
    setName(next.trim() ? uniqueKeyName(keyNameFor(next.trim()), props.takenNames ?? []) : "");
  };
  const [username, setUsername] = createSignal(existing?.username ?? props.initial?.username ?? "");
  const [variable, setVariable] = createSignal(existing?.variable ?? "");
  const [value, setValue] = createSignal("");
  const [showValue, setShowValue] = createSignal(false);
  const [twoStepSeed, setTwoStepSeed] = createSignal("");
  const [twoStepCheck, setTwoStepCheck] = createSignal<TwoStepOk | TwoStepProblem | null>(null);
  const [fillPolicy, setFillPolicy] = createSignal<FillPolicy>(existing?.fillPolicy ?? "auto");
  const [sharedWith, setSharedWith] = createSignal<string[]>(
    existing?.sharedWith ?? props.initial?.sharedWith ?? [],
  );
  // Options someone already changed stay in view; untouched ones wait folded.
  const [moreOpen, setMoreOpen] = createSignal(
    Boolean(existing && (existing.fillPolicy !== "auto" || existing.hasTwoStepCode)),
  );
  const [errors, setErrors] = createSignal<Partial<Record<Field, string>>>({});
  const [triedSaving, setTriedSaving] = createSignal(false);
  // The warning about no bot waits until the key has a place, so an empty form does not scold.
  const warnNoBot = () =>
    sharedWith().length === 0 &&
    (triedSaving() ||
      Boolean(existing) ||
      Boolean((kind() === "variable" ? variable() : origin()).trim()));
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const fields: Partial<Record<Field, HTMLInputElement>> = {};
  let sharingSection: HTMLFieldSetElement | undefined;

  const clearError = (field: Field) =>
    setErrors((current) => {
      if (!current[field]) return current;
      const { [field]: _gone, ...rest } = current;
      return rest;
    });

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

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !saving()) props.onClose();
  };
  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    if (props.focusSharing && sharingSection) {
      sharingSection.scrollIntoView?.({ block: "nearest" });
      sharingSection.querySelector("input")?.focus();
      return;
    }
    (kind() === "variable" ? fields.variable : fields.origin)?.focus();
  });
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  const toggleBot = (botId: string) =>
    setSharedWith((current) =>
      current.includes(botId) ? current.filter((id) => id !== botId) : [...current, botId],
    );

  const valueLabel = () =>
    kind() === "login"
      ? t("keyring.form.password")
      : kind() === "token"
        ? t("keyring.form.token")
        : t("keyring.form.value");

  /** What is missing, field by field, in the order the fields appear. */
  function missing(): Partial<Record<Field, string>> {
    const found: Partial<Record<Field, string>> = {};
    if (kind() === "variable") {
      if (!variable().trim()) found.variable = t("keyring.form.error.variable");
    } else if (!origin().trim()) {
      found.origin = t("keyring.form.error.origin");
    }
    if (kind() === "login" && !username().trim()) {
      found.username = t("keyring.form.error.username");
    }
    if (!existing && !value()) {
      found.value = t("keyring.form.error.value", { what: valueLabel().toLowerCase() });
    }
    if (!name().trim()) found.name = t("keyring.form.error.name");
    return found;
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    setTriedSaving(true);
    const found = missing();
    setErrors(found);
    const first = (["origin", "variable", "username", "value", "name"] as Field[]).find(
      (field) => found[field],
    );
    if (first) {
      fields[first]?.focus();
      return;
    }
    setSaving(true);
    const draft: KeyDraft = {
      name: name().trim(),
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

  const hasTwoStep = () => Boolean(twoStepSeed().trim()) || Boolean(existing?.hasTwoStepCode);
  const moreSummary = () =>
    t("keyring.form.more.summary", {
      fill: t(`keyring.fill.${fillPolicy()}`),
      twoStep: hasTwoStep() ? t("keyring.form.more.twoStepOn") : t("keyring.form.more.twoStepOff"),
    });

  return (
    <div data-component="KeyDialog" class="mk-scrim">
      <form
        class="mk-dialog mk-key-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-dialog-title"
        onSubmit={submit}
        noValidate
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
                    onChange={() => {
                      setKind(option);
                      setErrors({});
                    }}
                  />
                  {t(`keyring.kind.${option}`)}
                </label>
              )}
            </For>
          </fieldset>
        </Show>

        <div data-slot="fields" class="mk-key-dialog__fields">
          <Show
            when={kind() !== "variable"}
            fallback={
              <TextField
                id="key-variable"
                label={t("keyring.form.variable")}
                hint={t("keyring.form.variable.hint")}
                error={errors().variable}
                ref={(element) => {
                  fields.variable = element;
                }}
                mono
                value={variable()}
                onInput={(next) => {
                  setVariable(next);
                  clearError("variable");
                }}
              />
            }
          >
            <TextField
              id="key-origin"
              label={t("keyring.form.origin")}
              hint={t("keyring.form.origin.hint")}
              error={errors().origin}
              ref={(element) => {
                fields.origin = element;
              }}
              mono
              placeholder="https://app.example.com"
              value={origin()}
              onInput={changeOrigin}
            />
          </Show>

          <div class="mk-key-dialog__pair" classList={{ "is-single": kind() !== "login" }}>
            <Show when={kind() === "login"}>
              <TextField
                id="key-username"
                label={t("keyring.form.username")}
                error={errors().username}
                ref={(element) => {
                  fields.username = element;
                }}
                value={username()}
                onInput={(next) => {
                  setUsername(next);
                  clearError("username");
                }}
              />
            </Show>
            <TextField
              id="key-value"
              label={valueLabel()}
              hint={existing ? t("keyring.form.value.keep") : undefined}
              error={errors().value}
              ref={(element) => {
                fields.value = element;
              }}
              type={showValue() ? "text" : "password"}
              autocomplete="new-password"
              value={value()}
              onInput={(next) => {
                setValue(next);
                clearError("value");
              }}
              trailing={
                <button
                  type="button"
                  class="mk-key-dialog__peek"
                  aria-pressed={showValue()}
                  aria-label={
                    showValue() ? t("keyring.form.hideValue") : t("keyring.form.showValue")
                  }
                  onClick={() => setShowValue((current) => !current)}
                >
                  <Icon name="eye" size={14} />
                </button>
              }
            />
          </div>

          <TextField
            id="key-name"
            label={t("keyring.form.name")}
            hint={t("keyring.form.name.hint")}
            error={errors().name}
            ref={(element) => {
              fields.name = element;
            }}
            mono
            maxLength={100}
            value={name()}
            onInput={changeName}
          />
        </div>

        <fieldset
          data-slot="sharing"
          class="mk-field"
          ref={(element) => {
            sharingSection = element;
          }}
        >
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
            <Show when={warnNoBot()} fallback={<small>{t("keyring.form.shared.hint")}</small>}>
              <div data-slot="no-bot" class="mk-notice mk-notice--warn" role="status">
                <Icon name="warning" size={14} />
                <div>
                  <strong>{t("keyring.form.shared.none")}</strong>
                  <span>{t("keyring.form.shared.noneBody")}</span>
                </div>
              </div>
            </Show>
          </Show>
        </fieldset>

        <Show when={kind() !== "variable"}>
          <section data-slot="more" class="mk-key-dialog__more">
            <button
              type="button"
              class="mk-key-dialog__more-toggle"
              aria-expanded={moreOpen()}
              aria-controls="key-more"
              onClick={() => setMoreOpen((current) => !current)}
            >
              <Icon name={moreOpen() ? "chevronDown" : "chevronRight"} size={14} />
              <strong>{t("keyring.form.more")}</strong>
              <Show when={!moreOpen()}>
                <span>{moreSummary()}</span>
              </Show>
            </button>
            <Show when={moreOpen()}>
              <div id="key-more" class="mk-key-dialog__more-body">
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
              </div>
            </Show>
          </section>
        </Show>

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

/** A labelled input whose hint and error are announced with it, the error replacing the hint. */
function TextField(props: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onInput: (value: string) => void;
  ref: (element: HTMLInputElement) => void;
  mono?: boolean;
  type?: "text" | "password";
  autocomplete?: string;
  placeholder?: string;
  maxLength?: number;
  trailing?: JSX.Element;
}) {
  const hintId = `${props.id}-hint`;
  return (
    <div data-slot={props.id} class="mk-field">
      <label for={props.id}>{props.label}</label>
      <div class="mk-key-dialog__input" classList={{ "has-trailing": Boolean(props.trailing) }}>
        <input
          ref={props.ref}
          id={props.id}
          classList={{
            "mk-input": true,
            "mk-input--mono": props.mono === true,
            "is-invalid": Boolean(props.error),
          }}
          type={props.type ?? "text"}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          autocomplete={props.autocomplete ?? "off"}
          spellcheck={false}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          aria-invalid={props.error ? "true" : undefined}
          aria-describedby={props.error || props.hint ? hintId : undefined}
        />
        {props.trailing}
      </div>
      <Show
        when={props.error}
        fallback={
          <Show when={props.hint}>
            <small id={hintId}>{props.hint}</small>
          </Show>
        }
      >
        <small id={hintId} class="mk-form-error" role="alert">
          <Icon name="warning" size={12} />
          {props.error}
        </small>
      </Show>
    </div>
  );
}
