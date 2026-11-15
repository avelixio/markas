import { createResource, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import type { AgentReasoningEffort, AppInfo, ExportResult } from "../../../shared/ipc";
import { callHost } from "../host-client";
import { LANGUAGES, type Language, language, type MessageKey, setLanguage, t } from "../i18n";
import {
  ENGINES,
  type EngineId,
  type EngineModels,
  type EngineStatus,
  engineName,
  type SetupClient,
  type SetupProgress,
  setupClient,
} from "../setup/setup-client";
import { Icon } from "../ui/Icon";
import { AreaPage, Failed } from "./AreaPages";
import { DeletedBots, type DeletedBotsClient } from "./DeletedBots";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const EFFORT_LABEL: Record<string, MessageKey> = {
  low: "setup.model.effort.low",
  medium: "setup.model.effort.medium",
  high: "setup.model.effort.high",
  xhigh: "setup.model.effort.xhigh",
  max: "setup.model.effort.max",
};

const LANGUAGE_NAME: Record<Language, string> = { en: "English", id: "Bahasa Indonesia" };

interface SettingsData {
  progress: SetupProgress;
  engines: EngineStatus[];
  info: AppInfo | null;
}

function Section(props: { title: string; lead: string; children: JSX.Element }) {
  return (
    <section data-component="SettingsSection" class="mk-settings__section">
      <header data-slot="header">
        <h2>{props.title}</h2>
        <p>{props.lead}</p>
      </header>
      <div data-slot="body" class="mk-settings__rows">
        {props.children}
      </div>
    </section>
  );
}

function Row(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div data-slot="row" class="mk-settings__row">
      <span>
        <strong>{props.label}</strong>
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
      </span>
      <div>{props.children}</div>
    </div>
  );
}

/**
 * The settings of Markas itself: its language, what new bots start with, and this computer.
 * Each choice is saved by the host the moment it is made, and a failed save says so.
 */
export function SettingsPage(props: {
  setup?: SetupClient;
  onReload?: () => void;
  deletedBots?: DeletedBotsClient;
}) {
  const client = props.setup ?? setupClient;
  const [data, { refetch, mutate }] = createResource<SettingsData>(async () => {
    const [progress, engines, info] = await Promise.all([
      client.getState(),
      client.engineStatus(),
      callHost<AppInfo>("app.getInfo").catch(() => null),
    ]);
    return { progress, engines, info };
  });
  const [problem, setProblem] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [exported, setExported] = createSignal<string | null>(null);

  const readyEngines = () =>
    (data()?.engines ?? []).filter((engine) => engine.state === "ready").map((engine) => engine.id);
  // Settings that could not be read name no engine; reading their value would throw instead.
  const engine = (): EngineId | null =>
    data.error ? null : (data()?.progress.preferredProvider ?? null);
  const [models] = createResource(
    engine,
    (id): Promise<EngineModels | null> => client.listModels(id).catch(() => null),
  );
  const chosenModel = () =>
    models()?.models.find((model) => model.id === data()?.progress.defaultModel) ?? null;

  async function save(patch: Parameters<SetupClient["save"]>[0]): Promise<void> {
    if (saving()) return;
    setSaving(true);
    setProblem(null);
    try {
      const progress = await client.save(patch);
      mutate((current) => (current ? { ...current, progress } : current));
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setSaving(false);
    }
  }

  async function exportTo(method: "maintenance.exportData" | "maintenance.exportDiagnostics") {
    setProblem(null);
    setExported(null);
    try {
      const result = await callHost<ExportResult>(method);
      setExported(result.saved && result.path ? result.path : t("appSettings.export.none"));
    } catch (error) {
      setProblem(describe(error));
    }
  }

  async function setupAgain(): Promise<void> {
    setProblem(null);
    try {
      await client.save({ completed: false, step: "language" });
      (props.onReload ?? (() => window.location.reload()))();
    } catch (error) {
      setProblem(describe(error));
    }
  }

  return (
    <AreaPage
      name="SettingsPage"
      title={t("appSettings.title")}
      subtitle={t("appSettings.subtitle")}
    >
      <Switch>
        <Match when={data.error}>
          <Failed error={data.error} retry={() => void refetch()} />
        </Match>
        <Match when={data()}>
          {(current) => (
            <>
              <Show when={problem()}>
                {(message) => (
                  <p data-slot="problem" class="mk-form-error" role="alert">
                    <Icon name="warning" size={12} />
                    {message()} {t("appSettings.notSaved")}
                  </p>
                )}
              </Show>

              <Section title={t("appSettings.general")} lead={t("appSettings.general.lead")}>
                <Row label={t("nav.language")} hint={t("appSettings.language.hint")}>
                  <select
                    class="mk-input"
                    aria-label={t("nav.language")}
                    value={language()}
                    onChange={(event) => {
                      const next = event.currentTarget.value === "id" ? "id" : "en";
                      setLanguage(next);
                      void save({ language: next });
                    }}
                  >
                    <For each={LANGUAGES}>
                      {(code) => <option value={code}>{LANGUAGE_NAME[code]}</option>}
                    </For>
                  </select>
                </Row>
              </Section>

              <Section title={t("appSettings.defaults")} lead={t("appSettings.defaults.lead")}>
                <Row label={t("appSettings.engine")} hint={t("appSettings.engine.hint")}>
                  <Show
                    when={readyEngines().length > 0}
                    fallback={<span class="mk-quiet">{t("appSettings.engine.none")}</span>}
                  >
                    <select
                      class="mk-input"
                      aria-label={t("appSettings.engine")}
                      value={engine() ?? ""}
                      disabled={saving()}
                      onChange={(event) =>
                        void save({
                          preferredProvider: event.currentTarget.value as EngineId,
                          // The old model belongs to the other engine, so it is let go.
                          defaultModel: null,
                          defaultEffort: null,
                        })
                      }
                    >
                      <For each={ENGINES.filter((id) => readyEngines().includes(id))}>
                        {(id) => <option value={id}>{engineName(id)}</option>}
                      </For>
                    </select>
                  </Show>
                </Row>
                <Row label={t("appSettings.model")} hint={t("appSettings.model.hint")}>
                  <Show
                    when={models()}
                    fallback={<span class="mk-quiet">{t("appSettings.model.none")}</span>}
                  >
                    {(listed) => (
                      <select
                        class="mk-input"
                        aria-label={t("appSettings.model")}
                        value={current().progress.defaultModel ?? ""}
                        disabled={saving()}
                        onChange={(event) => {
                          const picked = listed().models.find(
                            (model) => model.id === event.currentTarget.value,
                          );
                          void save({
                            defaultModel: picked?.id ?? null,
                            defaultEffort: picked?.defaultReasoningEffort ?? null,
                          });
                        }}
                      >
                        <option value="">{t("setup.model.engineDefault")}</option>
                        <For each={listed().models}>
                          {(model) => <option value={model.id}>{model.name}</option>}
                        </For>
                      </select>
                    )}
                  </Show>
                </Row>
                <Show when={chosenModel()}>
                  {(model) => (
                    <Row label={t("setup.model.effort")} hint={t("appSettings.effort.hint")}>
                      <select
                        class="mk-input"
                        aria-label={t("setup.model.effort")}
                        value={current().progress.defaultEffort ?? model().defaultReasoningEffort}
                        disabled={saving()}
                        onChange={(event) =>
                          void save({
                            defaultEffort: event.currentTarget.value as AgentReasoningEffort,
                          })
                        }
                      >
                        <For each={model().supportedReasoningEfforts}>
                          {(level) => (
                            <option value={level}>
                              {EFFORT_LABEL[level] ? t(EFFORT_LABEL[level] as MessageKey) : level}
                            </option>
                          )}
                        </For>
                      </select>
                    </Row>
                  )}
                </Show>
              </Section>

              <Section title={t("appSettings.computer")} lead={t("appSettings.computer.lead")}>
                <Row label={t("appSettings.host")} hint={t("appSettings.host.hint")}>
                  <code class="mk-mono">{window.location.host}</code>
                </Row>
                <Show when={current().info}>
                  {(info) => (
                    <Row label={t("appSettings.version")}>
                      <code class="mk-mono">
                        {info().name} {info().version}
                      </code>
                    </Row>
                  )}
                </Show>
                <Row label={t("appSettings.export")} hint={t("appSettings.export.hint")}>
                  <button
                    type="button"
                    class="mk-button mk-button--small"
                    onClick={() => void exportTo("maintenance.exportData")}
                  >
                    <Icon name="download" size={12} />
                    {t("appSettings.export.data")}
                  </button>
                  <button
                    type="button"
                    class="mk-button mk-button--ghost mk-button--small"
                    onClick={() => void exportTo("maintenance.exportDiagnostics")}
                  >
                    {t("appSettings.export.diagnostics")}
                  </button>
                </Row>
                <Show when={exported()}>
                  {(where) => (
                    <p data-slot="exported" class="mk-form-ok" role="status">
                      <Icon name="check" size={12} />
                      {t("appSettings.export.saved", { path: where() })}
                    </p>
                  )}
                </Show>
                <Row label={t("appSettings.setup")} hint={t("appSettings.setup.hint")}>
                  <button
                    type="button"
                    class="mk-button mk-button--small"
                    onClick={() => void setupAgain()}
                  >
                    {t("appSettings.setup.again")}
                  </button>
                </Row>
              </Section>
              <DeletedBots client={props.deletedBots} />
              <p class="mk-quiet">
                <Icon name="info" size={12} /> {t("appSettings.note")}
              </p>
            </>
          )}
        </Match>
        <Match when={data.loading}>
          <p class="mk-quiet" role="status">
            {t("common.loading")}
          </p>
        </Match>
      </Switch>
    </AreaPage>
  );
}
