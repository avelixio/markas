import { createSignal, type JSX, Match, onMount, Switch } from "solid-js";
import { setLanguage, t } from "../i18n";
import { BotSteps } from "./BotSteps";
import type { BotsClient } from "./bots-client";
import { SetupFlow } from "./SetupFlow";
import { SetupNotice } from "./SetupStage";
import type { SetupClient, SetupProgress } from "./setup-client";

interface FirstRunProps {
  setup: SetupClient;
  bots: BotsClient;
  /** Markas itself, shown once setup is finished. */
  children: JSX.Element;
}

/**
 * Decides what a person sees when Markas opens: setup until it is finished, then Markas.
 * When the host cannot say where setup stands, the person can ask again instead of guessing.
 */
export function FirstRun(props: FirstRunProps) {
  const [progress, setProgress] = createSignal<SetupProgress | null>(null);
  const [failed, setFailed] = createSignal(false);

  async function load(): Promise<void> {
    setFailed(false);
    try {
      const state = await props.setup.getState();
      // The host remembers the chosen language, so a new window or browser opens in it too.
      if (state.language) setLanguage(state.language);
      setProgress(state);
    } catch {
      setFailed(true);
    }
  }

  onMount(() => void load());

  return (
    <Switch
      fallback={
        <div
          data-component="FirstRun"
          class="initial-setup-screen"
          role="status"
          aria-label={t("common.loading")}
        />
      }
    >
      <Match when={failed()}>
        <main data-component="FirstRun" class="sign-in-notice">
          <SetupNotice tone="danger" title={t("connection.title")} body={t("connection.body")}>
            <button
              type="button"
              class="mk-button mk-button--primary mk-button--small"
              onClick={() => void load()}
            >
              {t("common.retry")}
            </button>
          </SetupNotice>
        </main>
      </Match>
      <Match when={progress()?.completed}>{props.children}</Match>
      <Match when={progress()}>
        {(current) => (
          <SetupFlow
            client={props.setup}
            initial={current()}
            onDone={setProgress}
            botSteps={(context) => (
              <BotSteps
                client={props.bots}
                firstBot
                onBack={context.onBack}
                onSkip={context.onDone}
                onDone={context.onDone}
              />
            )}
          />
        )}
      </Match>
    </Switch>
  );
}
