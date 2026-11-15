import { createSignal, For, Show } from "solid-js";
import { type MessageKey, t } from "../i18n";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import { SetupActions, SetupNotice, SetupPanel, SetupStage } from "./SetupStage";

const POINTS: Array<{ icon: IconName; title: MessageKey; body: MessageKey }> = [
  { icon: "terminal", title: "setup.consent.files.title", body: "setup.consent.files.body" },
  { icon: "globe", title: "setup.consent.web.title", body: "setup.consent.web.body" },
  { icon: "shield", title: "setup.consent.approval.title", body: "setup.consent.approval.body" },
];

/** Step 4: what bots can do on this computer, agreed to once. */
export function ConsentStep(props: { busy?: boolean; onBack: () => void; onNext: () => void }) {
  const [agreed, setAgreed] = createSignal(false);
  const [asked, setAsked] = createSignal(false);

  function next(): void {
    if (agreed()) props.onNext();
    else setAsked(true);
  }

  return (
    <SetupStage step="consent" label="setup.consent.label">
      <SetupPanel title={t("setup.consent.title")} body={t("setup.consent.body")}>
        <ul data-slot="points" class="mk-setup__points">
          <For each={POINTS}>
            {(point) => (
              <li>
                <span class="mk-setup__point-mark" aria-hidden="true">
                  <Icon name={point.icon} size={16} />
                </span>
                <span>
                  <strong>{t(point.title)}</strong>
                  <small>{t(point.body)}</small>
                </span>
              </li>
            )}
          </For>
        </ul>
        <label data-slot="agree" class="mk-setup__agree">
          <input
            type="checkbox"
            checked={agreed()}
            onChange={(event) => {
              setAgreed(event.currentTarget.checked);
              if (event.currentTarget.checked) setAsked(false);
            }}
          />
          <span>{t("setup.consent.agree")}</span>
        </label>
        <Show when={asked() && !agreed()}>
          <SetupNotice
            tone="info"
            title={t("setup.consent.needed.title")}
            body={t("setup.consent.needed.body")}
          />
        </Show>
        <SetupActions
          onBack={props.onBack}
          onNext={next}
          busy={props.busy}
          aside={<span class="mk-quiet">{t("setup.consent.private")}</span>}
        />
      </SetupPanel>
    </SetupStage>
  );
}
