import { For, Show } from "solid-js";
import { LANGUAGES, type Language, language, setLanguage, t } from "../i18n";
import { SetupActions, SetupNotice, SetupPanel, SetupStage } from "./SetupStage";

/** True when the computer's language is one Markas is translated into. */
export function isSupportedLanguage(browser: string | undefined): boolean {
  const code = browser?.toLowerCase() ?? "";
  return code.startsWith("en") || code.startsWith("id");
}

export function LanguageStep(props: {
  browserLanguage?: string;
  onNext: (chosen: Language) => void;
}) {
  const browser = () =>
    props.browserLanguage ?? (typeof navigator === "undefined" ? undefined : navigator.language);

  return (
    <SetupStage step="language" label="setup.language.label">
      <SetupPanel title={t("setup.language.title")} body={t("setup.language.body")}>
        <Show when={!isSupportedLanguage(browser())}>
          <SetupNotice
            tone="info"
            title={t("setup.language.unsupported.title")}
            body={t("setup.language.unsupported.body")}
          />
        </Show>
        <div
          data-slot="choices"
          class="mk-setup__choices"
          role="radiogroup"
          aria-label={t("setup.language.title")}
        >
          <For each={LANGUAGES}>
            {(code) => (
              <label classList={{ "mk-setup__choice": true, "is-on": language() === code }}>
                <input
                  type="radio"
                  name="markas-setup-language"
                  value={code}
                  checked={language() === code}
                  onChange={() => setLanguage(code)}
                />
                <span>
                  <strong>{t(`language.${code}`)}</strong>
                  <small>{t(`setup.language.${code}.body`)}</small>
                </span>
              </label>
            )}
          </For>
        </div>
        <p class="mk-quiet">{t("setup.language.note")}</p>
        <SetupActions onNext={() => props.onNext(language())} />
      </SetupPanel>
    </SetupStage>
  );
}
