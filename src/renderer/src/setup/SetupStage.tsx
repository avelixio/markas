import { For, type JSX, Show } from "solid-js";
import { type MessageKey, t } from "../i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { SETUP_STEPS, type SetupStep } from "./setup-client";

interface SetupStageProps {
  step: SetupStep;
  label: MessageKey;
  /** Wide steps (the model picker, ready-made bots) ask for more room. */
  width?: number;
  children: JSX.Element;
}

/** One full-screen setup step: the brand and the step counter on top, the step in the middle. */
export function SetupStage(props: SetupStageProps) {
  const index = () => SETUP_STEPS.indexOf(props.step);
  return (
    <main data-component="SetupStage" class="mk-setup" data-step={props.step}>
      <header data-slot="top" class="mk-setup__top">
        <span class="mk-setup__brand">
          <span class="mk-setup__logo" aria-hidden="true">
            <Icon name="logo" size={18} />
          </span>
          Markas
        </span>
        <div
          data-slot="step-counter"
          class="mk-setup__counter"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={SETUP_STEPS.length}
          aria-valuenow={index() + 1}
          aria-valuetext={`${t("setup.step", { current: index() + 1, total: SETUP_STEPS.length })}: ${t(props.label)}`}
        >
          <span class="mk-setup__bars" aria-hidden="true">
            <For each={SETUP_STEPS}>
              {(_, position) => <i classList={{ "is-done": position() <= index() }} />}
            </For>
          </span>
          <strong>{t("setup.step", { current: index() + 1, total: SETUP_STEPS.length })}</strong>
          <span>{t(props.label)}</span>
        </div>
      </header>
      <section
        data-slot="body"
        class="mk-setup__body"
        style={{ "max-width": `${props.width ?? 600}px` }}
      >
        {props.children}
      </section>
    </main>
  );
}

/** The card most steps sit in. */
export function SetupPanel(props: { title: string; body: string; children: JSX.Element }) {
  return (
    <div data-component="SetupPanel" class="mk-setup__panel">
      <div data-slot="header" class="mk-setup__heading">
        <h1>{props.title}</h1>
        <p>{props.body}</p>
      </div>
      {props.children}
    </div>
  );
}

type NoticeTone = "info" | "warn" | "danger";

/** What is wrong and what the person can do about it. Every setup fallback is one of these. */
export function SetupNotice(props: {
  tone: NoticeTone;
  title: string;
  body?: string;
  children?: JSX.Element;
}) {
  const icon = (): IconName => (props.tone === "danger" ? "warning" : "info");
  return (
    <div
      data-component="SetupNotice"
      class={`mk-setup__notice mk-setup__notice--${props.tone}`}
      role={props.tone === "info" ? "status" : "alert"}
    >
      <Icon name={icon()} size={16} />
      <div data-slot="body">
        <strong>{props.title}</strong>
        <Show when={props.body}>
          <p>{props.body}</p>
        </Show>
        <Show when={props.children}>
          <div data-slot="actions" class="mk-setup__notice-actions">
            {props.children}
          </div>
        </Show>
      </div>
    </div>
  );
}

/** Back on the left, the way forward on the right. */
export function SetupActions(props: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  aside?: JSX.Element;
}) {
  return (
    <div data-component="SetupActions" class="mk-setup__actions">
      <Show when={props.onBack}>
        <button type="button" class="mk-button mk-button--ghost" onClick={props.onBack}>
          <Icon name="chevronLeft" size={14} />
          {t("setup.back")}
        </button>
      </Show>
      <span class="mk-setup__space" />
      {props.aside}
      <button
        type="button"
        class="mk-button mk-button--primary"
        disabled={props.nextDisabled || props.busy}
        onClick={props.onNext}
      >
        <Icon name="arrowRight" size={14} />
        {props.busy ? t("setup.saving") : (props.nextLabel ?? t("setup.continue"))}
      </button>
    </div>
  );
}
