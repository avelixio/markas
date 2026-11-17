import { createResource, For, Match, Show, Switch } from "solid-js";
import type { BotContextBreakdown } from "../../../shared/ipc";
import { callHost } from "../host-client";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";

/** 330700 becomes "330.7k", 1000000 becomes "1M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${trim(tokens / 1_000)}k`;
  return String(Math.round(tokens));
}

const trim = (value: number) => value.toFixed(1).replace(/\.0$/, "");

const share = (tokens: number, max: number) =>
  max > 0 ? `${((tokens / max) * 100).toFixed(1)}%` : "";

/**
 * What fills one bot's context: how full it is and, when the engine says, what takes the room.
 * It is read when the bot's settings open and again when the person asks.
 */
export function ContextBreakdown(props: { botId: string }) {
  const [reading, { refetch }] = createResource(
    () => props.botId,
    (botId) => callHost<BotContextBreakdown | null>("agent.contextBreakdown", botId),
  );
  const percent = (value: BotContextBreakdown) =>
    value.maxTokens > 0 ? Math.min(100, Math.round((value.usedTokens / value.maxTokens) * 100)) : 0;

  return (
    <section
      data-component="ContextBreakdown"
      class="mk-context"
      aria-labelledby="agent-context-heading"
    >
      <div data-slot="header" class="agent-settings-section-heading mk-context__head">
        <div>
          <strong id="agent-context-heading">{t("context.title")}</strong>
          <span>{t("context.hint")}</span>
        </div>
        <button
          type="button"
          class="mk-icon-button"
          aria-label={t("context.refresh")}
          title={t("context.refresh")}
          disabled={reading.loading}
          onClick={() => void refetch()}
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>
      <Switch>
        <Match when={reading.error}>
          <p data-slot="problem" class="mk-context__note" role="alert">
            {t("context.failed")}
          </p>
        </Match>
        <Match when={reading.loading && !reading.latest}>
          <p class="mk-context__note">{t("common.loading.busy")}</p>
        </Match>
        <Match when={reading.latest}>
          {(value) => (
            <>
              <div data-slot="total" class="mk-context__total">
                <strong>{t("context.used", { percent: percent(value()) })}</strong>
                <span>
                  {formatTokens(value().usedTokens)} / {formatTokens(value().maxTokens)}
                </span>
              </div>
              <div
                class="mk-context__bar"
                role="progressbar"
                aria-label={t("context.title")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent(value())}
              >
                <span style={{ width: `${percent(value())}%` }} />
              </div>
              <Show
                when={value().categories.length > 0}
                fallback={<p class="mk-context__note">{t("context.totalOnly")}</p>}
              >
                <ul data-slot="kinds" class="mk-context__list">
                  <For each={value().categories}>
                    {(kind) => (
                      <li>
                        <span>{kind.name}</span>
                        <span>{formatTokens(kind.tokens)}</span>
                        <span>{share(kind.tokens, value().maxTokens)}</span>
                      </li>
                    )}
                  </For>
                  <li class="mk-context__free">
                    <span>{t("context.free")}</span>
                    <span>{formatTokens(Math.max(0, value().maxTokens - value().usedTokens))}</span>
                    <span>
                      {share(
                        Math.max(0, value().maxTokens - value().usedTokens),
                        value().maxTokens,
                      )}
                    </span>
                  </li>
                </ul>
              </Show>
              <Show when={value().notLoaded.length > 0}>
                <p class="mk-context__note">{t("context.notLoaded")}</p>
                <ul data-slot="not-loaded" class="mk-context__list mk-context__list--quiet">
                  <For each={value().notLoaded}>
                    {(kind) => (
                      <li>
                        <span>{kind.name}</span>
                        <span>{formatTokens(kind.tokens)}</span>
                        <span />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={value().autoCompactAt}>
                {(at) => (
                  <p class="mk-context__note">
                    {t("context.autoCompact", { tokens: formatTokens(at()) })}
                  </p>
                )}
              </Show>
            </>
          )}
        </Match>
        <Match when={true}>
          <p class="mk-context__note">{t("context.none")}</p>
        </Match>
      </Switch>
    </section>
  );
}
