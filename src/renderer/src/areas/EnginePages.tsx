import { createResource, createSignal, For, Match, Show, Switch } from "solid-js";
import {
  FUEL_PERIODS,
  type FuelEngine,
  type FuelPeriod,
  type FuelReport,
} from "../../../shared/fuel";
import type { AccountUsageWindow, BotSummary, SetupEngineStatus } from "../../../shared/ipc";
import { callHost } from "../host-client";
import { language, type MessageKey, t, tCount } from "../i18n";
import type { KeySummary } from "../keyring/keyring-client";
import { engineName } from "../setup/setup-client";
import { Icon } from "../ui/Icon";
import { AreaPage, Empty, Failed } from "./AreaPages";
import { ProvidersPanel } from "./ProvidersPanel";

const dateTime = (value: string | number) =>
  new Date(value).toLocaleString(language(), { dateStyle: "medium", timeStyle: "short" });

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString(language(), { day: "numeric", month: "short" });

/** "This 5 hours", "This week": the window an engine counts its plan over. */
function windowLabel(window: AccountUsageWindow): string {
  const minutes = window.windowDurationMins;
  if (!minutes) return t("fuel.window.plan");
  if (minutes === 7 * 24 * 60) return t("fuel.window.week");
  if (minutes % (24 * 60) === 0) return t("fuel.window.days", { count: minutes / (24 * 60) });
  return t("fuel.window.hours", { count: Math.max(1, Math.round(minutes / 60)) });
}

const ENGINE_STATE: Record<string, MessageKey> = {
  available: "setup.engines.ready",
  "signed-in": "setup.engines.ready",
  "sign-in-required": "fuel.state.signedOut",
  "not-signed-in": "fuel.state.signedOut",
  "not-installed": "setup.engines.notInstalled",
  outdated: "setup.engines.outdated",
  checking: "fuel.state.checking",
  "not-started": "fuel.state.checking",
  error: "fuel.state.error",
};

const ready = (state: string) => state === "available" || state === "signed-in";

function StateChip(props: { state: string }) {
  return (
    <span
      classList={{
        "mk-chip": true,
        "mk-chip--accent": ready(props.state),
        "mk-chip--danger": !ready(props.state) && props.state !== "checking",
      }}
    >
      {t(ENGINE_STATE[props.state] ?? "fuel.state.error")}
    </span>
  );
}

function UsageBar(props: { window: AccountUsageWindow }) {
  const used = () => Math.round(props.window.usedPercent);
  return (
    <div data-slot="window" class="mk-fuel__window">
      <div class="mk-fuel__window-head">
        <span>{windowLabel(props.window)}</span>
        <strong>{t("fuel.used", { percent: used() })}</strong>
      </div>
      <div
        class="mk-fuel__bar"
        role="progressbar"
        aria-label={windowLabel(props.window)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used()}
      >
        <span classList={{ "is-low": used() >= 80 }} style={{ width: `${used()}%` }} />
      </div>
      <Show when={props.window.resetsAt}>
        {(resetsAt) => <small>{t("fuel.resets", { when: dateTime(resetsAt() * 1_000) })}</small>}
      </Show>
    </div>
  );
}

function EngineCard(props: { engine: FuelEngine }) {
  const name = () => engineName(props.engine.engine);
  return (
    <article data-component="FuelEngineCard" class="mk-fuel__engine">
      <header data-slot="header">
        <strong>{name()}</strong>
        <StateChip state={props.engine.state} />
      </header>
      <Switch>
        <Match when={!ready(props.engine.state)}>
          <p class="mk-quiet">
            {props.engine.bots > 0
              ? tCount("fuel.engine.held", props.engine.bots, { engine: name() })
              : t("fuel.engine.unused", { engine: name() })}
          </p>
        </Match>
        <Match when={props.engine.limits}>
          {(limits) => (
            <For each={limits()}>
              {(limit) => (
                <>
                  <Show when={limit.primary}>{(window) => <UsageBar window={window()} />}</Show>
                  <Show when={limit.secondary}>{(window) => <UsageBar window={window()} />}</Show>
                </>
              )}
            </For>
          )}
        </Match>
        <Match when={true}>
          <p class="mk-quiet">{t("fuel.plan.unknown", { engine: name() })}</p>
        </Match>
      </Switch>
      <Show when={ready(props.engine.state)}>
        <small class="mk-quiet">
          {props.engine.email ? `${props.engine.email} · ` : ""}
          {tCount("fuel.engine.bots", props.engine.bots)}
        </small>
      </Show>
    </article>
  );
}

/** How much of each engine's plan is left, and which bots used the engines. */
export function FuelPage() {
  const [days, setDays] = createSignal<FuelPeriod>(FUEL_PERIODS[0]);
  const [report, { refetch }] = createResource(days, (period) =>
    callHost<FuelReport>("fuel.read", { days: period }),
  );
  const peak = () => Math.max(1, ...(report()?.perDay.map((day) => day.turns) ?? []));

  return (
    <AreaPage
      name="FuelPage"
      title={t("fuel.title")}
      subtitle={t("fuel.subtitle")}
      actions={
        <fieldset class="mk-segmented" aria-label={t("fuel.period")}>
          <For each={FUEL_PERIODS}>
            {(period) => (
              <label classList={{ "mk-segmented__item": true, "is-active": days() === period }}>
                <input
                  type="radio"
                  name="fuel-period"
                  checked={days() === period}
                  onChange={() => setDays(period)}
                />
                {t("fuel.period.days", { count: period })}
              </label>
            )}
          </For>
        </fieldset>
      }
    >
      <Switch>
        <Match when={report.error}>
          <Failed error={report.error} retry={() => void refetch()} />
        </Match>
        <Match when={report()}>
          {(current) => (
            <>
              <div data-slot="engines" class="mk-fuel__engines">
                <For each={current().engines}>{(engine) => <EngineCard engine={engine} />}</For>
              </div>

              <section data-slot="turns" class="mk-fuel__turns" aria-label={t("fuel.turns.title")}>
                <header>
                  <h2>{t("fuel.turns.title")}</h2>
                  <span class="mk-quiet">
                    {tCount("fuel.turns.total", current().totalTurns, { days: current().days })}
                  </span>
                </header>
                <Show
                  when={current().totalTurns > 0}
                  fallback={
                    <Empty
                      icon="activity"
                      title={t("fuel.empty.title")}
                      body={t("fuel.empty.body")}
                    />
                  }
                >
                  <div class="mk-fuel__chart" role="img" aria-label={t("fuel.turns.title")}>
                    <For each={current().perDay}>
                      {(day) => (
                        <span
                          title={`${shortDay(day.day)}: ${day.turns}`}
                          style={{ height: `${Math.max(2, (day.turns / peak()) * 100)}%` }}
                          classList={{ "is-empty": day.turns === 0 }}
                        />
                      )}
                    </For>
                  </div>
                  <div class="mk-fuel__axis">
                    <small>{shortDay(current().perDay[0]?.day ?? "")}</small>
                    <small>{t("fuel.today")}</small>
                  </div>
                  <div class="mk-table-scroll">
                    <table data-slot="table" class="mk-table">
                      <thead>
                        <tr>
                          <th scope="col">{t("fuel.column.bot")}</th>
                          <th scope="col">{t("fuel.column.engine")}</th>
                          <th scope="col">{t("fuel.column.turns")}</th>
                          <th scope="col">{t("fuel.column.share")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={current().perBot}>
                          {(row) => (
                            <tr>
                              <th scope="row">{row.name}</th>
                              <td>{engineName(row.engine)}</td>
                              <td class="mk-mono">{row.turns}</td>
                              <td class="mk-mono">
                                {Math.round((row.turns / current().totalTurns) * 100)}%
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </section>
              <p class="mk-quiet">
                <Icon name="info" size={12} /> {t("fuel.note")}
              </p>
            </>
          )}
        </Match>
        <Match when={report.loading}>
          <p class="mk-quiet" role="status">
            {t("common.loading")}
          </p>
        </Match>
      </Switch>
    </AreaPage>
  );
}

interface SwitchboardData {
  engines: SetupEngineStatus[];
  logins: KeySummary[];
  bots: BotSummary[];
}

async function readSwitchboard(): Promise<SwitchboardData> {
  const [engines, keys, bots] = await Promise.all([
    callHost<SetupEngineStatus[]>("setup.engineStatus"),
    // A keyring that cannot open must not hide the engines; the logins are then simply absent.
    callHost<KeySummary[]>("keyring.list").catch(() => []),
    callHost<BotSummary[]>("agent.listBots").catch(() => []),
  ]);
  return { engines, logins: keys.filter((key) => key.kind === "login"), bots };
}

/** The engines and saved logins Markas keeps for the bots, and what state each is in. */
export function SwitchboardPage() {
  const [data, { refetch }] = createResource(readSwitchboard);
  const botName = (id: string) => data()?.bots.find((bot) => bot.id === id)?.name ?? id;

  return (
    <AreaPage
      name="SwitchboardPage"
      title={t("switchboard.title")}
      subtitle={t("switchboard.subtitle")}
      actions={
        <button type="button" class="mk-button" onClick={() => void refetch()}>
          <Icon name="refresh" size={14} />
          {t("switchboard.check")}
        </button>
      }
    >
      <Switch>
        <Match when={data.error}>
          <Failed error={data.error} retry={() => void refetch()} />
        </Match>
        <Match when={data()}>
          {(current) => (
            <>
              <ProvidersPanel engines={current().engines} onEnginesChanged={() => void refetch()} />

              <h2 class="mk-section-title">
                {t("switchboard.logins")} <span class="mk-chip">{t("common.preview")}</span>
              </h2>
              <Show
                when={current().logins.length > 0}
                fallback={
                  <Empty
                    icon="key"
                    title={t("switchboard.logins.empty.title")}
                    body={t("switchboard.logins.empty.body")}
                  />
                }
              >
                <div class="mk-table-scroll">
                  <table data-slot="logins" class="mk-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("switchboard.column.site")}</th>
                        <th scope="col">{t("keyring.column.name")}</th>
                        <th scope="col">{t("keyring.column.fills")}</th>
                        <th scope="col">{t("keyring.column.used")}</th>
                        <th scope="col">{t("switchboard.column.usedBy")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={current().logins}>
                        {(login) => (
                          <tr>
                            <th scope="row" class="mk-mono">
                              {login.origin ?? t("switchboard.none")}
                            </th>
                            <td>{login.name}</td>
                            <td>
                              {t(`keyring.fill.${login.fillPolicy}`)}
                              <Show when={login.hasTwoStepCode}> · {t("keyring.twoStep")}</Show>
                            </td>
                            <td>
                              {login.lastUsedAt
                                ? dateTime(login.lastUsedAt)
                                : t("switchboard.never")}
                            </td>
                            <td>
                              {login.sharedWith.map(botName).join(", ") || t("switchboard.none")}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
              <p class="mk-quiet">
                <Icon name="info" size={12} /> {t("switchboard.note")}
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
