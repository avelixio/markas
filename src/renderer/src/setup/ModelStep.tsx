import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import type { AgentModelOption, AgentReasoningEffort } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";
import { Icon } from "../ui/Icon";
import { SetupActions, SetupNotice, SetupStage } from "./SetupStage";
import { ENGINES, type EngineId, engineName, type SetupClient } from "./setup-client";

export interface ModelChoice {
  engine: EngineId;
  /** Null means "whatever the engine itself uses by default". */
  model: string | null;
  effort: AgentReasoningEffort | null;
}

interface ModelStepProps {
  client: SetupClient;
  /** Engines that are signed in. The first one is shown first. */
  ready: EngineId[];
  initial?: Partial<ModelChoice>;
  onBack: () => void;
  onNext: (choice: ModelChoice) => void;
}

type Load =
  | { state: "loading" }
  | { state: "loaded"; models: AgentModelOption[]; fallback: boolean }
  | { state: "failed" };

const EFFORT_LABEL: Record<string, MessageKey> = {
  low: "setup.model.effort.low",
  medium: "setup.model.effort.medium",
  high: "setup.model.effort.high",
  xhigh: "setup.model.effort.xhigh",
  max: "setup.model.effort.max",
};

/** Step 3: engines on the left, that engine's models on the right. */
export function ModelStep(props: ModelStepProps) {
  const first = () =>
    props.initial?.engine && props.ready.includes(props.initial.engine)
      ? props.initial.engine
      : (props.ready[0] ?? "claude");
  const [engine, setEngine] = createSignal<EngineId>(first());
  const [load, setLoad] = createSignal<Load>({ state: "loading" });
  const [model, setModel] = createSignal<string | null>(props.initial?.model ?? null);
  const [effort, setEffort] = createSignal<AgentReasoningEffort | null>(
    props.initial?.effort ?? null,
  );
  const [query, setQuery] = createSignal("");
  const [typing, setTyping] = createSignal(false);
  const [custom, setCustom] = createSignal("");
  let request = 0;

  async function loadModels(target: EngineId): Promise<void> {
    const mine = ++request;
    setLoad({ state: "loading" });
    try {
      const result = await props.client.listModels(target);
      if (mine !== request) return;
      if (result.models.length === 0) {
        setLoad({ state: "failed" });
        return;
      }
      setLoad({ state: "loaded", models: result.models, fallback: result.fallback });
      const current = result.models.find((option) => option.id === model());
      const chosen = current ?? result.models[0];
      setModel(chosen.id);
      if (
        !current ||
        !chosen.supportedReasoningEfforts.includes(effort() as AgentReasoningEffort)
      ) {
        setEffort(chosen.defaultReasoningEffort);
      }
    } catch {
      if (mine === request) setLoad({ state: "failed" });
    }
  }

  createEffect(
    on(engine, (target) => {
      setQuery("");
      setTyping(false);
      void loadModels(target);
    }),
  );

  const models = createMemo(() => {
    const current = load();
    if (current.state !== "loaded") return [];
    const needle = query().trim().toLowerCase();
    return needle
      ? current.models.filter(
          (option) =>
            option.name.toLowerCase().includes(needle) || option.id.toLowerCase().includes(needle),
        )
      : current.models;
  });
  const selected = createMemo(() => {
    const current = load();
    return current.state === "loaded"
      ? current.models.find((option) => option.id === model())
      : undefined;
  });

  function choose(option: AgentModelOption): void {
    setModel(option.id);
    if (!option.supportedReasoningEfforts.includes(effort() as AgentReasoningEffort)) {
      setEffort(option.defaultReasoningEffort);
    }
  }

  function useEngineDefault(): void {
    props.onNext({ engine: engine(), model: null, effort: null });
  }

  function useCustom(event: Event): void {
    event.preventDefault();
    const name = custom().trim();
    if (name) props.onNext({ engine: engine(), model: name, effort: null });
  }

  return (
    <SetupStage step="model" label="setup.model.label" width={720}>
      <div data-slot="header" class="mk-setup__heading">
        <h1>{t("setup.model.title")}</h1>
        <p>{t("setup.model.body")}</p>
      </div>

      <div data-component="ModelPicker" class="mk-setup__picker">
        <div
          data-slot="engines"
          class="mk-setup__tabs"
          role="tablist"
          aria-label={t("setup.model.engines")}
        >
          <For each={ENGINES}>
            {(id) => {
              const isReady = () => props.ready.includes(id);
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={engine() === id}
                  aria-label={engineName(id)}
                  title={
                    isReady()
                      ? engineName(id)
                      : t("setup.model.otherWaiting", { engine: engineName(id) })
                  }
                  classList={{ "is-on": engine() === id }}
                  disabled={!isReady()}
                  onClick={() => setEngine(id)}
                >
                  <Icon name={id === "claude" ? "sparkle" : "terminal"} size={18} />
                </button>
              );
            }}
          </For>
        </div>

        <div data-slot="models" class="mk-setup__models" role="tabpanel">
          <div class="mk-setup__models-head">
            <strong>{engineName(engine())}</strong>
            <span class="mk-setup__chip mk-setup__chip--accent">{t("setup.model.ready")}</span>
          </div>

          <Switch>
            <Match when={load().state === "loading"}>
              <p class="mk-quiet" role="status">
                {t("setup.model.loading")}
              </p>
            </Match>

            <Match when={load().state === "failed"}>
              <SetupNotice
                tone="warn"
                title={t("setup.model.failed.title", { engine: engineName(engine()) })}
                body={t("setup.model.failed.body")}
              >
                <button
                  type="button"
                  class="mk-button mk-button--primary mk-button--small"
                  onClick={useEngineDefault}
                >
                  {t("setup.model.useDefault")}
                </button>
                <button
                  type="button"
                  class="mk-button mk-button--small"
                  onClick={() => void loadModels(engine())}
                >
                  <Icon name="refresh" size={12} />
                  {t("setup.engines.retry")}
                </button>
                <button
                  type="button"
                  class="mk-button mk-button--ghost mk-button--small"
                  onClick={() => setTyping(true)}
                >
                  <Icon name="pencil" size={12} />
                  {t("setup.model.typeName")}
                </button>
              </SetupNotice>
              <Show when={typing()}>
                <form data-slot="custom-model" class="mk-setup__locate" onSubmit={useCustom}>
                  <label class="mk-field">
                    <span>{t("setup.model.custom")}</span>
                    <input
                      class="mk-input mk-input--mono"
                      value={custom()}
                      onInput={(event) => setCustom(event.currentTarget.value)}
                      autofocus
                    />
                  </label>
                  <div class="mk-setup__notice-actions">
                    <button
                      type="submit"
                      class="mk-button mk-button--primary mk-button--small"
                      disabled={!custom().trim()}
                    >
                      {t("setup.model.custom.use")}
                    </button>
                  </div>
                </form>
              </Show>
            </Match>

            <Match when={load().state === "loaded"}>
              <Show when={(load() as { fallback?: boolean }).fallback}>
                <SetupNotice
                  tone="warn"
                  title={t("setup.model.fallback.title", { engine: engineName(engine()) })}
                  body={t("setup.model.fallback.body")}
                >
                  <button
                    type="button"
                    class="mk-button mk-button--small"
                    onClick={() => void loadModels(engine())}
                  >
                    <Icon name="refresh" size={12} />
                    {t("setup.engines.retry")}
                  </button>
                </SetupNotice>
              </Show>
              <label class="mk-setup__search">
                <Icon name="search" size={14} />
                <span class="mk-visually-hidden">{t("setup.model.search")}</span>
                <input
                  type="search"
                  placeholder={t("setup.model.search")}
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
              <div
                class="mk-setup__model-list"
                role="radiogroup"
                aria-label={t("setup.model.title")}
              >
                <For each={models()} fallback={<p class="mk-quiet">{t("setup.model.none")}</p>}>
                  {(option) => (
                    <label classList={{ "mk-setup__model": true, "is-on": model() === option.id }}>
                      <input
                        type="radio"
                        name="markas-setup-model"
                        checked={model() === option.id}
                        onChange={() => choose(option)}
                      />
                      <strong>{option.name}</strong>
                      <small>{option.description}</small>
                    </label>
                  )}
                </For>
              </div>
              <Show when={selected()}>
                {(option) => (
                  <div data-slot="effort" class="mk-setup__effort">
                    <span>{t("setup.model.effort")}</span>
                    <fieldset
                      class="mk-segmented mk-setup__fieldset"
                      aria-label={t("setup.model.effort")}
                    >
                      <For each={option().supportedReasoningEfforts}>
                        {(level) => (
                          <button
                            type="button"
                            aria-pressed={effort() === level}
                            classList={{
                              "mk-segmented__item": true,
                              "is-active": effort() === level,
                            }}
                            onClick={() => setEffort(level)}
                          >
                            {EFFORT_LABEL[level] ? t(EFFORT_LABEL[level]) : level}
                          </button>
                        )}
                      </For>
                    </fieldset>
                  </div>
                )}
              </Show>
            </Match>
          </Switch>
        </div>
      </div>

      <SetupActions
        onBack={props.onBack}
        onNext={() => props.onNext({ engine: engine(), model: model(), effort: effort() })}
        nextDisabled={load().state !== "loaded" || !model()}
      />
    </SetupStage>
  );
}
