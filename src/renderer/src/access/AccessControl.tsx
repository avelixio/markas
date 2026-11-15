import { createSignal, For, Show } from "solid-js";
import { ACCESS_LEVELS, type AccessLevel } from "../../../shared/access";
import type { AgentPromptQuestion } from "../../../shared/ipc";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import "./access.css";

const LEVEL_ICONS: Record<AccessLevel, IconName> = { ask: "shield", read: "eye", full: "zap" };

/** The exact labels the host understands as answers to a permission card. */
const ALLOW_ONCE = "Allow once";
const ALLOW_CHAT = "Allow for this chat";
const DENY = "Don't allow";

/** A small label that says how much the bot may do without asking. */
export function AccessChip(props: { level: AccessLevel; onClick?: () => void }) {
  return (
    <button
      type="button"
      data-component="AccessChip"
      classList={{ "mk-access-chip": true, "is-full": props.level === "full" }}
      title={t(`access.${props.level}.body`)}
      onClick={props.onClick}
    >
      <Icon name={LEVEL_ICONS[props.level]} size={12} />
      {t(`access.${props.level}.name`)}
    </button>
  );
}

/**
 * Chooses how much a bot may do without asking.
 * Full access is never one click: it shows what it means and asks again.
 */
export function AccessControl(props: {
  level: AccessLevel;
  botName: string;
  onChange: (level: AccessLevel) => void;
}) {
  const [confirmingFull, setConfirmingFull] = createSignal(false);
  const choose = (level: AccessLevel) => {
    if (level === props.level) return;
    if (level === "full") {
      setConfirmingFull(true);
      return;
    }
    setConfirmingFull(false);
    props.onChange(level);
  };

  return (
    <section data-component="AccessControl" class="mk-access" aria-labelledby="access-heading">
      <div data-slot="heading" class="mk-access__heading">
        <strong id="access-heading">{t("access.title")}</strong>
        <span>{t("access.subtitle")}</span>
      </div>
      <div
        data-slot="levels"
        class="mk-access__levels"
        role="radiogroup"
        aria-labelledby="access-heading"
      >
        <For each={ACCESS_LEVELS}>
          {(level) => (
            // biome-ignore lint/a11y/useSemanticElements: a native radio would show full access as chosen before the person has confirmed it
            <button
              type="button"
              role="radio"
              aria-checked={props.level === level}
              classList={{
                "mk-access__level": true,
                "is-active": props.level === level,
                "is-full": level === "full",
              }}
              onClick={() => choose(level)}
            >
              <Icon name={LEVEL_ICONS[level]} size={16} />
              <span>
                <strong>{t(`access.${level}.name`)}</strong>
                <small>{t(`access.${level}.body`)}</small>
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={confirmingFull()}>
        <div
          data-slot="confirm"
          class="mk-access__confirm"
          role="alertdialog"
          aria-labelledby="access-full-title"
        >
          <Icon name="warning" size={16} />
          <div>
            <strong id="access-full-title">
              {t("access.full.confirm.title", { name: props.botName })}
            </strong>
            <p>{t("access.full.confirm.body")}</p>
            <div class="mk-access__confirm-actions">
              <button type="button" class="mk-button" onClick={() => setConfirmingFull(false)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                class="mk-button mk-button--danger"
                onClick={() => {
                  setConfirmingFull(false);
                  props.onChange("full");
                }}
              >
                {t("access.full.confirm.action")}
              </button>
            </div>
          </div>
        </div>
      </Show>
      <p data-slot="note" class="mk-access__note">
        {t("access.note")}
      </p>
    </section>
  );
}

/** A bot asking for permission: what it wants, exactly, and the choices. No is always there. */
export function PermissionCard(props: {
  botName: string;
  question: AgentPromptQuestion;
  onAnswer: (label: string) => Promise<unknown>;
}) {
  const [sending, setSending] = createSignal(false);
  const kind = () => props.question.permission?.kind ?? "tool";
  const detail = () => props.question.permission?.detail ?? "";
  const canAllowForChat = () =>
    props.question.options?.some((option) => option.label === ALLOW_CHAT) ?? false;
  const answer = async (label: string) => {
    if (sending()) return;
    setSending(true);
    await props.onAnswer(label);
    setSending(false);
  };

  return (
    <section
      data-component="PermissionCard"
      classList={{ "mk-permission": true, "is-protected": kind() === "protected" }}
      aria-label={t("permission.label")}
    >
      <header data-slot="header" class="mk-permission__header">
        <Icon name={kind() === "protected" ? "warning" : "shield"} size={16} />
        <strong>{t(`permission.ask.${kind()}`, { name: props.botName })}</strong>
      </header>
      <Show when={detail()}>
        <pre data-slot="detail" class="mk-permission__detail">
          {detail()}
        </pre>
      </Show>
      <Show when={kind() === "protected"}>
        <p class="mk-permission__warning">{t("permission.protected.warning")}</p>
      </Show>
      <div data-slot="actions" class="mk-permission__actions">
        <button
          type="button"
          class="mk-button"
          disabled={sending()}
          onClick={() => void answer(DENY)}
        >
          {t("permission.deny")}
        </button>
        <Show when={canAllowForChat()}>
          <button
            type="button"
            class="mk-button"
            disabled={sending()}
            title={t(`permission.chat.${kind()}`)}
            onClick={() => void answer(ALLOW_CHAT)}
          >
            {t("permission.chat")}
          </button>
        </Show>
        <button
          type="button"
          class="mk-button mk-button--primary"
          disabled={sending()}
          onClick={() => void answer(ALLOW_ONCE)}
        >
          {t("permission.once")}
        </button>
      </div>
      <Show when={canAllowForChat()}>
        <small class="mk-permission__scope">{t(`permission.chat.${kind()}`)}</small>
      </Show>
    </section>
  );
}
