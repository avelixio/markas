import { createSignal, type JSX, Match, Show, Switch } from "solid-js";
import { type Language, t } from "../i18n";
import { ConsentStep } from "./ConsentStep";
import { EnginesStep } from "./EnginesStep";
import { LanguageStep } from "./LanguageStep";
import { type ModelChoice, ModelStep } from "./ModelStep";
import { SetupNotice } from "./SetupStage";
import type { EngineId, SetupClient, SetupPatch, SetupProgress, SetupStep } from "./setup-client";
import "./setup.css";

export interface BotStepsContext {
  progress: SetupProgress;
  /** Back to the consent step. */
  onBack: () => void;
  /** The first bot exists, or the person chose to skip: setup is over. */
  onDone: () => void;
}

interface SetupFlowProps {
  client: SetupClient;
  initial: SetupProgress;
  onDone: (progress: SetupProgress) => void;
  onGetHelp?: () => void;
  /** Steps 5 to 7: meeting Dispatch and making the first bot. Without it setup ends at consent. */
  botSteps?: (context: BotStepsContext) => JSX.Element;
}

/**
 * The first run, one full screen per step. Each step is saved as it is finished,
 * so closing Markas halfway brings the person back to where they were.
 */
export function SetupFlow(props: SetupFlowProps) {
  const [progress, setProgress] = createSignal(props.initial);
  const [step, setStep] = createSignal<SetupStep>(props.initial.step);
  const [ready, setReady] = createSignal<EngineId[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [saveFailed, setSaveFailed] = createSignal(false);

  /** Saves what the step decided, then moves on. A failed save keeps the person on the step. */
  async function advance(patch: SetupPatch, next: SetupStep | "done"): Promise<void> {
    if (busy()) return;
    setBusy(true);
    setSaveFailed(false);
    try {
      const saved = await props.client.save({
        ...patch,
        ...(next === "done" ? { completed: true } : { step: next }),
      });
      setProgress(saved);
      if (next === "done") props.onDone(saved);
      else setStep(next);
    } catch {
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const finish = () => void advance({}, "done");

  return (
    <div data-component="SetupFlow" class="mk-setup-flow">
      <Switch>
        <Match when={step() === "language"}>
          <LanguageStep onNext={(language: Language) => void advance({ language }, "engines")} />
        </Match>
        <Match when={step() === "engines"}>
          <EnginesStep
            client={props.client}
            onGetHelp={props.onGetHelp}
            onBack={() => setStep("language")}
            onNext={(engines) => {
              setReady(engines);
              const preferred = progress().preferredProvider;
              void advance(
                {
                  preferredProvider:
                    preferred && engines.includes(preferred) ? preferred : (engines[0] ?? null),
                },
                "model",
              );
            }}
          />
        </Match>
        <Match when={step() === "model"}>
          <Show
            when={ready().length > 0}
            // Coming back to this step after a restart: the engines are checked again first.
            fallback={
              <EnginesStep
                client={props.client}
                onGetHelp={props.onGetHelp}
                onBack={() => setStep("language")}
                onNext={(engines) => setReady(engines)}
              />
            }
          >
            <ModelStep
              client={props.client}
              ready={ready()}
              initial={{
                engine: progress().preferredProvider ?? undefined,
                model: progress().defaultModel,
                effort: progress().defaultEffort,
              }}
              onBack={() => setStep("engines")}
              onNext={(choice: ModelChoice) =>
                void advance(
                  {
                    preferredProvider: choice.engine,
                    defaultModel: choice.model,
                    defaultEffort: choice.effort,
                  },
                  "consent",
                )
              }
            />
          </Show>
        </Match>
        <Match when={step() === "consent"}>
          <ConsentStep
            busy={busy()}
            onBack={() => setStep("model")}
            onNext={() =>
              void advance(
                { consentAt: new Date().toISOString() },
                props.botSteps ? "dispatch" : "done",
              )
            }
          />
        </Match>
        <Match when={props.botSteps}>
          {(botSteps) =>
            botSteps()({
              progress: progress(),
              onBack: () => setStep("consent"),
              onDone: finish,
            })
          }
        </Match>
      </Switch>
      <Show when={saveFailed()}>
        <div class="mk-setup-flow__toast">
          <SetupNotice tone="danger" title={t("setup.saveFailed")} />
        </div>
      </Show>
    </div>
  );
}
