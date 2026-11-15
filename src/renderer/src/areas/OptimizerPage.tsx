import { createResource, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import {
  type BotContext,
  COMPACT_AT_RANGE,
  type OptimizerReport,
  type OptimizerSettings,
} from "../../../shared/optimizer";
import { callHost } from "../host-client";
import { language, t, tCount } from "../i18n";
import { engineName } from "../setup/setup-client";
import { Icon } from "../ui/Icon";
import { AreaPage, Empty, Failed } from "./AreaPages";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 571900 as "571.9k", 1000000 as "1M": short enough to read at a glance. */
export function shortTokens(tokens: number): string {
  const trim = (value: number) => String(Math.round(value * 10) / 10);
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${trim(tokens / 1_000)}k`;
  return String(Math.round(tokens));
}

const wholeNumber = (value: number) => Math.round(value).toLocaleString(language());

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(language(), { dateStyle: "medium", timeStyle: "short" });

const day = (iso: string) => new Date(iso).toLocaleDateString(language(), { dateStyle: "medium" });

/** The points at which a conversation may be folded, as whole percents. */
const COMPACT_STEPS = Array.from(
  { length: Math.round((COMPACT_AT_RANGE.max - COMPACT_AT_RANGE.min) / 0.05) + 1 },
  (_unused, index) => Math.round((COMPACT_AT_RANGE.min + index * 0.05) * 100),
);

function Toggle(props: { label: string; on: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      class="mk-switch"
      classList={{ "is-on": props.on }}
      aria-label={props.label}
      aria-checked={props.on}
      disabled={props.disabled}
      onClick={props.onChange}
    >
      <span />
    </button>
  );
}

function Saver(props: {
  icon: "zap" | "pencil" | "file" | "terminal";
  title: string;
  body: string;
  stat?: string;
  control?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <article data-component="OptimizerSaver" class="mk-optimizer__saver">
      <header data-slot="header">
        <span class="mk-optimizer__mark">
          <Icon name={props.icon} size={16} />
        </span>
        <h3>{props.title}</h3>
        {props.control}
      </header>
      <p>{props.body}</p>
      {props.children}
      <Show when={props.stat}>
        <strong data-slot="stat">{props.stat}</strong>
      </Show>
    </article>
  );
}

function ContextRow(props: { bot: BotContext }) {
  const known = () => props.bot.usedTokens !== null && props.bot.contextWindow !== null;
  const percent = () =>
    known()
      ? Math.min(
          100,
          Math.round(((props.bot.usedTokens ?? 0) / (props.bot.contextWindow ?? 1)) * 100),
        )
      : 0;
  return (
    <li data-slot="bot">
      <div class="mk-optimizer__context-head">
        <strong>{props.bot.name}</strong>
        <small>{engineName(props.bot.engine)}</small>
        <Show when={props.bot.compacting}>
          <span class="mk-chip mk-chip--accent">{t("optimizer.context.folding")}</span>
        </Show>
        <span class="mk-optimizer__context-figure">
          {known()
            ? t("optimizer.context.used", {
                percent: percent(),
                used: shortTokens(props.bot.usedTokens ?? 0),
                window: shortTokens(props.bot.contextWindow ?? 0),
              })
            : t("optimizer.context.unknown")}
        </span>
      </div>
      <div
        class="mk-fuel__bar"
        role="progressbar"
        aria-label={t("optimizer.context.label", { name: props.bot.name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent()}
      >
        <span classList={{ "is-low": percent() >= 80 }} style={{ width: `${percent()}%` }} />
      </div>
    </li>
  );
}

/**
 * The Optimizer: what keeps the bots' conversations small, how full each one is, and how
 * many tokens that saved. A number counted from an engine and a number worked out from text
 * are kept apart, so the page never claims more than it knows.
 */
export function OptimizerPage() {
  const [report, { refetch, mutate }] = createResource(() =>
    callHost<OptimizerReport>("optimizer.read"),
  );
  const [saving, setSaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  async function save(patch: Partial<OptimizerSettings>): Promise<void> {
    if (saving()) return;
    setSaving(true);
    setProblem(null);
    try {
      const settings = await callHost<OptimizerSettings>("optimizer.save", patch);
      mutate((current) => (current ? { ...current, settings } : current));
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AreaPage
      name="OptimizerPage"
      title={t("optimizer.title")}
      subtitle={t("optimizer.subtitle")}
      actions={
        <button type="button" class="mk-button" onClick={() => void refetch()}>
          <Icon name="refresh" size={14} />
          {t("optimizer.refresh")}
        </button>
      }
    >
      <Switch>
        <Match when={report.error}>
          <Failed error={report.error} retry={() => void refetch()} />
        </Match>
        <Match when={report()}>
          {(current) => {
            const total = () => current().measuredTokens + current().estimatedTokens;
            return (
              <>
                <section
                  data-slot="total"
                  class="mk-optimizer__total"
                  aria-label={t("optimizer.total.label")}
                >
                  <strong>{wholeNumber(total())}</strong>
                  <span>{t("optimizer.total", { since: day(current().since) })}</span>
                  <small>
                    {t("optimizer.total.split", {
                      measured: wholeNumber(current().measuredTokens),
                      estimated: wholeNumber(current().estimatedTokens),
                    })}
                  </small>
                </section>

                <Show when={problem()}>
                  {(message) => (
                    <p data-slot="problem" class="mk-form-error" role="alert">
                      <Icon name="warning" size={12} />
                      {message()} {t("appSettings.notSaved")}
                    </p>
                  )}
                </Show>

                <h2 class="mk-section-title">{t("optimizer.savers")}</h2>
                <div data-slot="savers" class="mk-optimizer__savers">
                  <Saver
                    icon="zap"
                    title={t("optimizer.compact.title")}
                    body={t("optimizer.compact.body")}
                    stat={`${tCount("optimizer.compact.events", current().totals.compact.events)} · ${t(
                      "optimizer.tokens",
                      { tokens: wholeNumber(current().totals.compact.tokens) },
                    )}`}
                    control={
                      <Toggle
                        label={t("optimizer.compact.title")}
                        on={current().settings.autoCompact}
                        disabled={saving()}
                        onChange={() => void save({ autoCompact: !current().settings.autoCompact })}
                      />
                    }
                  >
                    <label class="mk-optimizer__field">
                      <span>{t("optimizer.compact.at")}</span>
                      <select
                        class="mk-input"
                        aria-label={t("optimizer.compact.at")}
                        value={Math.round(current().settings.compactAt * 100)}
                        disabled={saving() || !current().settings.autoCompact}
                        onChange={(event) =>
                          void save({ compactAt: Number(event.currentTarget.value) / 100 })
                        }
                      >
                        <For each={COMPACT_STEPS}>
                          {(step) => (
                            <option value={step}>
                              {t("optimizer.compact.full", { percent: step })}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                  </Saver>

                  <Saver
                    icon="file"
                    title={t("optimizer.trim.title")}
                    body={t("optimizer.trim.body")}
                    stat={`${tCount("optimizer.trim.events", current().totals.trim.events)} · ${t(
                      "optimizer.tokens.about",
                      { tokens: wholeNumber(current().totals.trim.tokens) },
                    )}`}
                    control={<span class="mk-chip mk-chip--accent">{t("optimizer.alwaysOn")}</span>}
                  />

                  <Saver
                    icon="pencil"
                    title={t("optimizer.lean.title")}
                    body={t("optimizer.lean.body")}
                    stat={t("optimizer.lean.notCounted")}
                    control={
                      <Toggle
                        label={t("optimizer.lean.title")}
                        on={current().settings.lean}
                        disabled={saving()}
                        onChange={() => void save({ lean: !current().settings.lean })}
                      />
                    }
                  />

                  <Saver
                    icon="terminal"
                    title={t("optimizer.filter.title")}
                    body={t("optimizer.filter.body")}
                    stat={
                      current().commandFilter.installed
                        ? t("optimizer.filter.found", {
                            version: current().commandFilter.version ?? "",
                          })
                        : t("optimizer.filter.missing")
                    }
                    control={<span class="mk-chip">{t("optimizer.filter.notUsed")}</span>}
                  />
                </div>

                <h2 class="mk-section-title">{t("optimizer.context.title")}</h2>
                <Show
                  when={current().context.length > 0}
                  fallback={
                    <Empty
                      icon="chat"
                      title={t("optimizer.context.empty.title")}
                      body={t("optimizer.context.empty.body")}
                    />
                  }
                >
                  <ul data-slot="context" class="mk-optimizer__context">
                    <For each={current().context}>{(bot) => <ContextRow bot={bot} />}</For>
                  </ul>
                </Show>

                <h2 class="mk-section-title">{t("optimizer.recent.title")}</h2>
                <Show
                  when={current().recent.length > 0}
                  fallback={<p class="mk-quiet">{t("optimizer.recent.empty")}</p>}
                >
                  <div class="mk-table-scroll">
                    <table data-slot="recent" class="mk-table">
                      <thead>
                        <tr>
                          <th scope="col">{t("logbook.column.time")}</th>
                          <th scope="col">{t("fuel.column.bot")}</th>
                          <th scope="col">{t("optimizer.recent.how")}</th>
                          <th scope="col">{t("optimizer.recent.saved")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={current().recent.slice(0, 50)}>
                          {(event) => (
                            <tr>
                              <td class="mk-mono">{dateTime(event.at)}</td>
                              <td>{event.botName || t("optimizer.recent.goneBot")}</td>
                              <td>{t(`optimizer.kind.${event.kind}`)}</td>
                              <td class="mk-mono">
                                {event.kind === "trim" ? "~" : ""}
                                {wholeNumber(event.tokens)}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
                <p class="mk-quiet">
                  <Icon name="info" size={12} /> {t("optimizer.note")}
                </p>
              </>
            );
          }}
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
