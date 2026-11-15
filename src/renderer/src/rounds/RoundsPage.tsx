import { createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { occurrencesBetween } from "../../../backend/rounds/schedule";
import type { BotSummary } from "../../../shared/ipc";
import { AgentAvatar } from "../components/AgentAvatar";
import { language, t } from "../i18n";
import { Confirm } from "../keyring/KeyringPage";
import { Icon } from "../ui/Icon";
import { RoundDialog, weekdayName } from "./RoundDialog";
import {
  type RoundDraft,
  type RoundRun,
  type RoundSummary,
  type RunStatus,
  roundsClient,
  type Schedule,
} from "./rounds-client";
import "./rounds.css";

type Dialog =
  | { type: "add" }
  | { type: "edit"; round: RoundSummary }
  | { type: "remove"; round: RoundSummary };

const REFRESH_MS = 15_000;
const DAY_MS = 24 * 60 * 60_000;
/** How many runs of one round a calendar day lists before it says "and more". */
const SHOWN_PER_DAY = 4;

const when = (iso: string) =>
  new Date(iso).toLocaleString(language(), { dateStyle: "medium", timeStyle: "short" });
const clock = (date: Date) =>
  date.toLocaleTimeString(language(), { hour: "2-digit", minute: "2-digit" });

/** A schedule in words, for example "Mon, Tue at 09:00". */
export function describeSchedule(schedule: Schedule): string {
  if (schedule.kind === "interval") {
    return t("rounds.schedule.interval", { minutes: schedule.everyMinutes });
  }
  if (schedule.kind === "once") return t("rounds.schedule.once", { time: when(schedule.at) });
  const days =
    schedule.weekdays.length === 7
      ? t("rounds.schedule.everyDay")
      : [...schedule.weekdays]
          .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
          .map(weekdayName)
          .join(", ");
  return t("rounds.schedule.daily", { days, times: schedule.times.join(", ") });
}

const STATUS_TONE: Record<RunStatus, string> = {
  running: "mk-chip--accent",
  completed: "mk-chip--accent",
  failed: "mk-chip--danger",
  missed: "mk-chip--warn",
  skipped: "",
};

function RunChip(props: { run: RoundRun }) {
  return (
    <span classList={{ "mk-chip": true, [STATUS_TONE[props.run.status]]: true }}>
      {t(`rounds.status.${props.run.status}`)}
    </span>
  );
}

/** The Rounds area: scheduled work, when it runs next, and how every run ended. */
export function RoundsPage() {
  const [rounds, { refetch }] = createResource(() => roundsClient.list());
  const [bots] = createResource<BotSummary[]>(() => window.markas.agent.listBots());
  const [dialog, setDialog] = createSignal<Dialog | null>(null);
  const [view, setView] = createSignal<"list" | "calendar">("list");
  const [openId, setOpenId] = createSignal<string | null>(null);
  const [history, { refetch: refetchHistory }] = createResource(openId, (id) =>
    roundsClient.runs(id),
  );
  const [actionError, setActionError] = createSignal<string | null>(null);

  const refresh = async () => {
    await refetch();
    if (openId()) await refetchHistory();
  };
  const timer = setInterval(() => void refresh(), REFRESH_MS);
  // A run ends when its turn does, so a finished turn is worth a refresh right away.
  const unsubscribe = window.markas.agent.onEvent?.((event) => {
    if (event.type === "turn-completed" || event.type === "queue-changed") void refresh();
  });
  onCleanup(() => {
    clearInterval(timer);
    unsubscribe?.();
  });

  const bot = (id: string) => bots()?.find((candidate) => candidate.id === id);
  const guarded = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : String(failure));
    }
    await refresh();
  };

  const save = async (draft: RoundDraft) => {
    const current = dialog();
    if (current?.type === "edit") await roundsClient.update(current.round.id, draft);
    else await roundsClient.create(draft);
    setDialog(null);
    await refresh();
  };

  const remove = (round: RoundSummary) => {
    setDialog(null);
    if (openId() === round.id) setOpenId(null);
    void guarded(() => roundsClient.remove(round.id));
  };

  const addButton = () => (
    <button
      type="button"
      class="mk-button mk-button--primary"
      disabled={(bots()?.length ?? 0) === 0}
      onClick={() => setDialog({ type: "add" })}
    >
      <Icon name="plus" />
      {t("rounds.add")}
    </button>
  );

  return (
    <section data-component="RoundsPage" class="mk-page" aria-labelledby="rounds-title">
      <header data-slot="header" class="mk-page__header">
        <div>
          <h1 id="rounds-title">{t("rounds.title")}</h1>
          <p>{t("rounds.subtitle")}</p>
        </div>
        {addButton()}
      </header>

      <div data-slot="body" class="mk-page__body">
        <Show when={actionError()}>
          <p class="mk-form-error" role="alert">
            <Icon name="warning" size={12} />
            {actionError()}
          </p>
        </Show>

        <Switch>
          <Match when={rounds.loading && !rounds.latest}>
            <p class="mk-quiet" role="status">
              {t("common.loading")}
            </p>
          </Match>
          <Match when={rounds.error}>
            <div data-slot="error" class="mk-notice mk-notice--warn" role="alert">
              <Icon name="warning" />
              <div>
                <strong>
                  {String(rounds.error instanceof Error ? rounds.error.message : rounds.error)}
                </strong>
              </div>
              <button type="button" class="mk-button" onClick={() => void refetch()}>
                {t("common.retry")}
              </button>
            </div>
          </Match>
          <Match when={rounds.latest?.length === 0}>
            <div data-slot="empty" class="mk-empty">
              <span class="mk-empty__mark">
                <Icon name="routine" size={22} />
              </span>
              <h2>{t("rounds.empty.title")}</h2>
              <p>
                {(bots()?.length ?? 0) === 0 ? t("rounds.empty.noBots") : t("rounds.empty.body")}
              </p>
              {addButton()}
            </div>
          </Match>
          <Match when={rounds.latest}>
            <fieldset data-slot="view" class="mk-segmented mk-segmented--inline">
              <legend class="mk-visually-hidden">{t("rounds.view")}</legend>
              <For each={["list", "calendar"] as const}>
                {(option) => (
                  <label classList={{ "mk-segmented__item": true, "is-active": view() === option }}>
                    <input
                      type="radio"
                      name="rounds-view"
                      value={option}
                      checked={view() === option}
                      onChange={() => setView(option)}
                    />
                    <Icon name={option === "list" ? "queue" : "calendar"} size={12} />
                    {t(`rounds.view.${option}`)}
                  </label>
                )}
              </For>
            </fieldset>

            <Show when={view() === "list"} fallback={<Calendar rounds={rounds.latest ?? []} />}>
              <div class="mk-table-scroll">
                <table data-slot="table" class="mk-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("rounds.column.name")}</th>
                      <th scope="col">{t("rounds.column.bot")}</th>
                      <th scope="col">{t("rounds.column.when")}</th>
                      <th scope="col">{t("rounds.column.next")}</th>
                      <th scope="col">{t("rounds.column.last")}</th>
                      <th scope="col">
                        <span class="mk-visually-hidden">{t("keyring.column.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={rounds.latest}>
                      {(round) => (
                        <tr data-round={round.name} classList={{ "is-off": !round.enabled }}>
                          <th scope="row">
                            <button
                              type="button"
                              class="mk-link"
                              aria-expanded={openId() === round.id}
                              onClick={() => setOpenId(openId() === round.id ? null : round.id)}
                            >
                              {round.name}
                            </button>
                            <small>{round.instruction}</small>
                          </th>
                          <td>
                            <span class="mk-who">
                              <AgentAvatar
                                shape={bot(round.botId)?.avatarShape}
                                color={bot(round.botId)?.avatarColor}
                                class="mk-share__sigil"
                              />
                              {bot(round.botId)?.name ?? round.botId}
                            </span>
                          </td>
                          <td>{describeSchedule(round.schedule)}</td>
                          <td>
                            <Show
                              when={round.nextRunAt}
                              fallback={
                                <span class="mk-chip">
                                  {round.enabled ? t("rounds.next.none") : t("rounds.off")}
                                </span>
                              }
                            >
                              {(next) => when(next())}
                            </Show>
                          </td>
                          <td>
                            <Show
                              when={round.lastRun}
                              fallback={<span class="mk-quiet">{t("common.never")}</span>}
                            >
                              {(run) => (
                                <span class="mk-who" title={run().detail}>
                                  <RunChip run={run()} />
                                  {when(run().scheduledFor)}
                                </span>
                              )}
                            </Show>
                          </td>
                          <td class="mk-table__actions">
                            <button
                              type="button"
                              class="mk-icon-button"
                              aria-label={t("rounds.action.run", { name: round.name })}
                              onClick={() => void guarded(() => roundsClient.runNow(round.id))}
                            >
                              <Icon name="zap" />
                            </button>
                            <button
                              type="button"
                              class="mk-icon-button"
                              aria-label={t(
                                round.enabled ? "rounds.action.pause" : "rounds.action.resume",
                                { name: round.name },
                              )}
                              onClick={() =>
                                void guarded(() =>
                                  roundsClient.update(round.id, { enabled: !round.enabled }),
                                )
                              }
                            >
                              <Icon name={round.enabled ? "pause" : "play"} />
                            </button>
                            <button
                              type="button"
                              class="mk-icon-button"
                              aria-label={t("rounds.action.edit", { name: round.name })}
                              onClick={() => setDialog({ type: "edit", round })}
                            >
                              <Icon name="pencil" />
                            </button>
                            <button
                              type="button"
                              class="mk-icon-button"
                              aria-label={t("rounds.action.remove", { name: round.name })}
                              onClick={() => setDialog({ type: "remove", round })}
                            >
                              <Icon name="trash" />
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>

              <Show when={rounds.latest?.find((round) => round.id === openId())}>
                {(round) => (
                  <section data-slot="history" class="mk-history" aria-label={t("rounds.history")}>
                    <h2>{t("rounds.history.title", { name: round().name })}</h2>
                    <Show
                      when={(history.latest?.length ?? 0) > 0}
                      fallback={<p class="mk-quiet">{t("rounds.history.empty")}</p>}
                    >
                      <ol class="mk-history__list">
                        <For each={history.latest}>
                          {(run) => (
                            <li>
                              <RunChip run={run} />
                              <span>{when(run.scheduledFor)}</span>
                              <Show when={run.manual}>
                                <span class="mk-chip">{t("rounds.history.manual")}</span>
                              </Show>
                              <Show when={run.detail}>
                                <span class="mk-quiet">{run.detail}</span>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ol>
                    </Show>
                  </section>
                )}
              </Show>
            </Show>
            <p class="mk-quiet">
              <Icon name="info" size={12} />
              {t("rounds.note")}
            </p>
          </Match>
        </Switch>
      </div>

      <Switch>
        <Match when={dialog()?.type === "add"}>
          <RoundDialog
            existing={null}
            bots={bots() ?? []}
            onSave={save}
            onClose={() => setDialog(null)}
          />
        </Match>
        <Match
          when={dialog()?.type === "edit" ? (dialog() as { round: RoundSummary }).round : null}
        >
          {(round) => (
            <RoundDialog
              existing={round()}
              bots={bots() ?? []}
              onSave={save}
              onClose={() => setDialog(null)}
            />
          )}
        </Match>
        <Match
          when={dialog()?.type === "remove" ? (dialog() as { round: RoundSummary }).round : null}
        >
          {(round) => (
            <Confirm
              icon="trash"
              tone="danger"
              title={t("rounds.remove.title", { name: round().name })}
              body={t("rounds.remove.body")}
              confirm={t("rounds.remove.confirm")}
              onConfirm={() => remove(round())}
              onClose={() => setDialog(null)}
            />
          )}
        </Match>
      </Switch>
    </section>
  );
}

/** The next seven days, with every time a round that is switched on will run. */
function Calendar(props: { rounds: RoundSummary[] }) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY_MS));

  const entries = (day: Date) => {
    const from = new Date(Math.max(day.getTime(), Date.now()) - 1);
    const until = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, -1);
    return props.rounds
      .filter((round) => round.enabled)
      .flatMap((round) => {
        const times = occurrencesBetween(round.schedule, from, until, new Date(round.createdAt));
        return times.slice(0, SHOWN_PER_DAY).map((time, index) => ({
          round,
          time,
          more: index === SHOWN_PER_DAY - 1 ? times.length - SHOWN_PER_DAY : 0,
        }));
      })
      .sort((a, b) => a.time.getTime() - b.time.getTime());
  };

  return (
    <div data-slot="calendar" class="mk-calendar">
      <For each={days}>
        {(day) => (
          <section class="mk-calendar__day">
            <h2>
              {day.toLocaleDateString(language(), {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </h2>
            <Show
              when={entries(day).length > 0}
              fallback={<p class="mk-quiet">{t("rounds.calendar.none")}</p>}
            >
              <ul>
                <For each={entries(day)}>
                  {(entry) => (
                    <li>
                      <span class="mk-mono">{clock(entry.time)}</span>
                      <span>{entry.round.name}</span>
                      <Show when={entry.more > 0}>
                        <span class="mk-quiet">
                          {t("rounds.calendar.more", { count: entry.more })}
                        </span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        )}
      </For>
    </div>
  );
}
