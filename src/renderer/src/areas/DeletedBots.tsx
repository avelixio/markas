import { createResource, createSignal, For, Match, Show, Switch } from "solid-js";
import { BOT_TRASH_DAYS, type BotSummary, type DeletedBot } from "../../../shared/ipc";
import { callHost } from "../host-client";
import { language, t } from "../i18n";
import { Icon } from "../ui/Icon";

/** What the list needs from the host. Tests hand in their own. */
export interface DeletedBotsClient {
  list(): Promise<DeletedBot[]>;
  restore(botId: string): Promise<BotSummary>;
  purge(botId: string): Promise<void>;
}

const hostClient: DeletedBotsClient = {
  list: () => callHost<DeletedBot[]>("agent.listDeletedBots"),
  restore: (botId) => callHost<BotSummary>("agent.restoreBot", botId),
  purge: (botId) => callHost<void>("agent.purgeBot", botId),
};

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const day = (iso: string) =>
  new Intl.DateTimeFormat(language(), { dateStyle: "medium" }).format(new Date(iso));

/**
 * The bots the person deleted and can still put back.
 * Restoring is one click. Deleting for good asks once more, because nothing brings it back.
 */
export function DeletedBots(props: { client?: DeletedBotsClient }) {
  const client = props.client ?? hostClient;
  const [bots, { refetch }] = createResource(() => client.list());
  const [busy, setBusy] = createSignal<string | null>(null);
  const [asking, setAsking] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);

  async function act(botId: string, action: () => Promise<unknown>): Promise<void> {
    if (busy()) return;
    setBusy(botId);
    setProblem(null);
    try {
      await action();
      setAsking(null);
      await refetch();
    } catch (error) {
      setProblem(describe(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section data-component="DeletedBots" class="mk-settings__section">
      <header data-slot="header">
        <h2>{t("appSettings.deleted")}</h2>
        <p>{t("appSettings.deleted.lead", { days: BOT_TRASH_DAYS })}</p>
      </header>
      <div data-slot="body" class="mk-settings__rows">
        <Show when={problem()}>
          {(message) => (
            <p data-slot="problem" class="mk-form-error" role="alert">
              <Icon name="warning" size={12} />
              {message()}
            </p>
          )}
        </Show>
        <Switch>
          <Match when={bots.error}>
            <p data-slot="failed" class="mk-form-error" role="alert">
              {t("appSettings.deleted.failed")} {describe(bots.error)}
              <button
                type="button"
                class="mk-button mk-button--ghost mk-button--small"
                onClick={() => void refetch()}
              >
                {t("common.retry")}
              </button>
            </p>
          </Match>
          <Match when={bots.loading && !bots.latest}>
            <p class="mk-quiet" role="status">
              {t("common.loading")}
            </p>
          </Match>
          <Match when={(bots.latest ?? []).length === 0}>
            <p data-slot="empty" class="mk-quiet">
              {t("appSettings.deleted.none")}
            </p>
          </Match>
          <Match when={bots.latest}>
            <For each={bots.latest}>
              {(entry) => (
                <div data-slot="row" class="mk-settings__row">
                  <span>
                    <strong>{entry.bot.name}</strong>
                    <small>
                      {asking() === entry.bot.id
                        ? t("appSettings.deleted.purge.ask")
                        : t("appSettings.deleted.when", {
                            deleted: day(entry.deletedAt),
                            gone: day(entry.purgeAt),
                          })}
                    </small>
                  </span>
                  <div>
                    <Show
                      when={asking() === entry.bot.id}
                      fallback={
                        <>
                          <button
                            type="button"
                            class="mk-button mk-button--small"
                            aria-label={t("appSettings.deleted.restore.label", {
                              name: entry.bot.name,
                            })}
                            disabled={busy() !== null}
                            onClick={() =>
                              void act(entry.bot.id, () => client.restore(entry.bot.id))
                            }
                          >
                            <Icon name="undo" size={12} />
                            {t("appSettings.deleted.restore")}
                          </button>
                          <button
                            type="button"
                            class="mk-button mk-button--ghost mk-button--small"
                            aria-label={t("appSettings.deleted.purge.label", {
                              name: entry.bot.name,
                            })}
                            disabled={busy() !== null}
                            onClick={() => setAsking(entry.bot.id)}
                          >
                            <Icon name="trash" size={12} />
                            {t("appSettings.deleted.purge")}
                          </button>
                        </>
                      }
                    >
                      <button
                        type="button"
                        class="mk-button mk-button--danger mk-button--small"
                        disabled={busy() !== null}
                        onClick={() => void act(entry.bot.id, () => client.purge(entry.bot.id))}
                      >
                        {t("appSettings.deleted.purge.confirm")}
                      </button>
                      <button
                        type="button"
                        class="mk-button mk-button--ghost mk-button--small"
                        disabled={busy() !== null}
                        onClick={() => setAsking(null)}
                      >
                        {t("common.cancel")}
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
