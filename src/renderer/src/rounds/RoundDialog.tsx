import { createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import {
  MAX_STANDING_PERMISSIONS,
  STANDING_PERMISSION_TYPES,
  type StandingPermission,
  type StandingPermissionType,
  sameStanding,
  standingTarget,
} from "../../../shared/access";
import type { BotSummary } from "../../../shared/ipc";
import { language, t } from "../i18n";
import { Icon } from "../ui/Icon";
import type { OverlapPolicy, RoundDraft, RoundSummary, Schedule } from "./rounds-client";

type Kind = Schedule["kind"];
const KINDS: Kind[] = ["daily", "interval", "once"];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** The short name of a weekday (0 is Sunday) in the chosen language. */
export const weekdayName = (day: number) =>
  new Date(2026, 10, 1 + day).toLocaleDateString(language(), { weekday: "short" });

/** One named thing of a kind, as a standing permission. */
function standingOf(type: StandingPermissionType, target: string): StandingPermission {
  if (type === "tool") return { type, name: target };
  if (type === "site") return { type, origin: target };
  return { type, path: target };
}

/** A date as the value of a datetime-local input, in this computer's time zone. */
function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Props {
  existing: RoundSummary | null;
  bots: BotSummary[];
  onSave: (draft: RoundDraft) => Promise<void>;
  onClose: () => void;
}

/** The form to add or change a round: who does it, what, and when. */
export function RoundDialog(props: Props) {
  const existing = props.existing;
  const schedule = existing?.schedule;
  const [name, setName] = createSignal(existing?.name ?? "");
  const [botId, setBotId] = createSignal(existing?.botId ?? props.bots[0]?.id ?? "");
  const [instruction, setInstruction] = createSignal(existing?.instruction ?? "");
  const [kind, setKind] = createSignal<Kind>(schedule?.kind ?? "daily");
  const [times, setTimes] = createSignal(schedule?.kind === "daily" ? schedule.times : ["09:00"]);
  const [weekdays, setWeekdays] = createSignal(
    schedule?.kind === "daily" ? schedule.weekdays : [1, 2, 3, 4, 5],
  );
  const [everyMinutes, setEveryMinutes] = createSignal(
    schedule?.kind === "interval" ? schedule.everyMinutes : 60,
  );
  const [onceAt, setOnceAt] = createSignal(
    localInputValue(
      schedule?.kind === "once" ? new Date(schedule.at) : new Date(Date.now() + 60 * 60_000),
    ),
  );
  const [overlap, setOverlap] = createSignal<OverlapPolicy>(existing?.overlap ?? "wait");
  // Stored permissions carry a date and a level; the form sends only what they name.
  const startedWith: StandingPermission[] = (existing?.standing ?? []).map((grant) =>
    standingOf(grant.type, standingTarget(grant)),
  );
  const [standing, setStanding] = createSignal<StandingPermission[]>(startedWith);
  const [standingType, setStandingType] = createSignal<StandingPermissionType>("read-folder");
  const [standingText, setStandingText] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  let firstField: HTMLInputElement | undefined;
  onMount(() => firstField?.focus());

  const toggleDay = (day: number) =>
    setWeekdays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]));
  const setTime = (index: number, value: string) =>
    setTimes((list) => list.map((time, position) => (position === index ? value : time)));

  const addStanding = () => {
    const target = standingText().trim();
    if (!target || standing().length >= MAX_STANDING_PERMISSIONS) return;
    const added = standingOf(standingType(), target);
    setStanding((list) =>
      list.some((item) => sameStanding(item, added)) ? list : [...list, added],
    );
    setStandingText("");
  };
  const standingChanged = () => JSON.stringify(standing()) !== JSON.stringify(startedWith);

  const buildSchedule = (): Schedule => {
    if (kind() === "interval") return { kind: "interval", everyMinutes: everyMinutes() };
    if (kind() === "once") return { kind: "once", at: new Date(onceAt()).toISOString() };
    return { kind: "daily", times: times().filter(Boolean), weekdays: weekdays() };
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError(null);
    if (kind() === "once" && Number.isNaN(new Date(onceAt()).getTime())) {
      setError(t("rounds.form.once.invalid"));
      return;
    }
    setSaving(true);
    try {
      await props.onSave({
        name: name().trim(),
        botId: botId(),
        instruction: instruction().trim(),
        schedule: buildSchedule(),
        overlap: overlap(),
        ...(standingChanged() ? { standing: standing() } : {}),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <div data-component="RoundDialog" class="mk-scrim">
      <form
        class="mk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="round-dialog-title"
        onSubmit={submit}
      >
        <header data-slot="header" class="mk-dialog__header">
          <span class="mk-dialog__mark">
            <Icon name="routine" />
          </span>
          <div>
            <h2 id="round-dialog-title">
              {existing
                ? t("rounds.form.editTitle", { name: existing.name })
                : t("rounds.form.addTitle")}
            </h2>
            <p>{t("rounds.form.lead")}</p>
          </div>
          <button
            type="button"
            class="mk-icon-button"
            aria-label={t("common.close")}
            onClick={props.onClose}
          >
            <Icon name="close" />
          </button>
        </header>

        <div data-slot="fields" class="mk-form-grid">
          <label class="mk-field">
            <span>{t("rounds.form.name")}</span>
            <input
              ref={firstField}
              id="round-name"
              class="mk-input"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              maxlength={80}
              autocomplete="off"
              required
            />
          </label>

          <label class="mk-field">
            <span>{t("rounds.form.bot")}</span>
            <select
              id="round-bot"
              class="mk-input"
              value={botId()}
              onChange={(event) => setBotId(event.currentTarget.value)}
              required
            >
              <For each={props.bots}>{(bot) => <option value={bot.id}>{bot.name}</option>}</For>
            </select>
          </label>

          <label class="mk-field mk-field--wide">
            <span>{t("rounds.form.instruction")}</span>
            <textarea
              id="round-instruction"
              class="mk-input mk-input--area"
              rows={4}
              value={instruction()}
              onInput={(event) => setInstruction(event.currentTarget.value)}
              required
            />
            <small>{t("rounds.form.instruction.hint")}</small>
          </label>
        </div>

        <fieldset data-slot="schedule" class="mk-field">
          <legend>{t("rounds.form.when")}</legend>
          <div class="mk-segmented">
            <For each={KINDS}>
              {(option) => (
                <label classList={{ "mk-segmented__item": true, "is-active": kind() === option }}>
                  <input
                    type="radio"
                    name="round-kind"
                    value={option}
                    checked={kind() === option}
                    onChange={() => setKind(option)}
                  />
                  {t(`rounds.kind.${option}`)}
                </label>
              )}
            </For>
          </div>

          <Switch>
            <Match when={kind() === "daily"}>
              <div data-slot="days" class="mk-share-list">
                <For each={WEEKDAYS}>
                  {(day) => (
                    <label classList={{ "mk-share": true, "is-active": weekdays().includes(day) }}>
                      <input
                        type="checkbox"
                        checked={weekdays().includes(day)}
                        onChange={() => toggleDay(day)}
                      />
                      {weekdayName(day)}
                    </label>
                  )}
                </For>
              </div>
              <div data-slot="times" class="mk-time-list">
                <For each={times()}>
                  {(time, index) => (
                    <span class="mk-time">
                      <input
                        type="time"
                        class="mk-input"
                        aria-label={t("rounds.form.time", { number: index() + 1 })}
                        value={time}
                        onInput={(event) => setTime(index(), event.currentTarget.value)}
                        required
                      />
                      <Show when={times().length > 1}>
                        <button
                          type="button"
                          class="mk-icon-button"
                          aria-label={t("rounds.form.time.remove", { time })}
                          onClick={() => setTimes((list) => list.filter((_, i) => i !== index()))}
                        >
                          <Icon name="close" />
                        </button>
                      </Show>
                    </span>
                  )}
                </For>
                <button
                  type="button"
                  class="mk-button mk-button--small"
                  onClick={() => setTimes((list) => [...list, "17:00"])}
                >
                  <Icon name="plus" size={12} />
                  {t("rounds.form.time.add")}
                </button>
              </div>
            </Match>
            <Match when={kind() === "interval"}>
              <label class="mk-field">
                <span>{t("rounds.form.every")}</span>
                <input
                  id="round-every"
                  type="number"
                  class="mk-input"
                  min={5}
                  step={1}
                  value={everyMinutes()}
                  onInput={(event) => setEveryMinutes(Number(event.currentTarget.value))}
                  required
                />
                <small>{t("rounds.form.every.hint")}</small>
              </label>
            </Match>
            <Match when={kind() === "once"}>
              <label class="mk-field">
                <span>{t("rounds.form.once")}</span>
                <input
                  id="round-once"
                  type="datetime-local"
                  class="mk-input"
                  value={onceAt()}
                  onInput={(event) => setOnceAt(event.currentTarget.value)}
                  required
                />
              </label>
            </Match>
          </Switch>
          <small>{t("rounds.form.when.hint")}</small>
        </fieldset>

        <fieldset data-slot="overlap" class="mk-field">
          <legend>{t("rounds.form.overlap")}</legend>
          <div class="mk-segmented">
            <For each={["wait", "skip"] as OverlapPolicy[]}>
              {(option) => (
                <label
                  classList={{ "mk-segmented__item": true, "is-active": overlap() === option }}
                >
                  <input
                    type="radio"
                    name="round-overlap"
                    value={option}
                    checked={overlap() === option}
                    onChange={() => setOverlap(option)}
                  />
                  {t(`rounds.overlap.${option}`)}
                </label>
              )}
            </For>
          </div>
        </fieldset>

        <fieldset data-slot="standing" class="mk-field">
          <legend>{t("rounds.standing.title")}</legend>
          <small>{t("rounds.standing.lead")}</small>
          <Show when={existing?.standingApplies === false}>
            <p class="mk-form-error" role="note">
              <Icon name="info" size={12} />
              {t("rounds.standing.engine")}
            </p>
          </Show>
          <Show
            when={standing().length > 0}
            fallback={<p class="mk-quiet">{t("rounds.standing.none")}</p>}
          >
            <ul class="mk-standing-list">
              <For each={standing()}>
                {(permission) => (
                  <li>
                    <span>
                      <strong>{t(`rounds.standing.type.${permission.type}`)}</strong>
                      <code>{standingTarget(permission)}</code>
                    </span>
                    <button
                      type="button"
                      class="mk-icon-button"
                      aria-label={t("rounds.standing.remove", {
                        what: standingTarget(permission),
                      })}
                      onClick={() =>
                        setStanding((list) =>
                          list.filter((item) => !sameStanding(item, permission)),
                        )
                      }
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show
            when={standing().length < MAX_STANDING_PERMISSIONS}
            fallback={
              <small>{t("rounds.standing.full", { count: MAX_STANDING_PERMISSIONS })}</small>
            }
          >
            <div class="mk-standing-add">
              <select
                class="mk-input"
                aria-label={t("rounds.standing.kind")}
                value={standingType()}
                onChange={(event) =>
                  setStandingType(event.currentTarget.value as StandingPermissionType)
                }
              >
                <For each={STANDING_PERMISSION_TYPES}>
                  {(type) => <option value={type}>{t(`rounds.standing.type.${type}`)}</option>}
                </For>
              </select>
              <input
                class="mk-input"
                aria-label={t("rounds.standing.what")}
                placeholder={t(`rounds.standing.example.${standingType()}`)}
                value={standingText()}
                onInput={(event) => setStandingText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    // Enter adds the permission; it must not save the whole round.
                    event.preventDefault();
                    addStanding();
                  }
                }}
                autocomplete="off"
              />
              <button
                type="button"
                class="mk-button mk-button--small"
                disabled={!standingText().trim()}
                onClick={addStanding}
              >
                <Icon name="plus" size={12} />
                {t("rounds.standing.add")}
              </button>
            </div>
          </Show>
        </fieldset>

        <Show when={error()}>
          <p data-slot="error" class="mk-form-error" role="alert">
            <Icon name="warning" size={12} />
            {error()}
          </p>
        </Show>

        <footer data-slot="actions" class="mk-dialog__actions">
          <button type="button" class="mk-button mk-button--ghost" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" class="mk-button mk-button--primary" disabled={saving()}>
            <Icon name="check" />
            {saving() ? t("keyring.form.saving") : t("rounds.form.save")}
          </button>
        </footer>
      </form>
    </div>
  );
}
