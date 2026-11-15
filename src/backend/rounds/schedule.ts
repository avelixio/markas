/**
 * When a round runs. Times are wall-clock times on this computer, in its own time zone.
 * daily: at each listed time, on each listed weekday (0 is Sunday).
 * interval: every so many minutes, counted from when the round was created.
 * once: a single moment.
 */
export type Schedule =
  | { kind: "daily"; times: string[]; weekdays: number[] }
  | { kind: "interval"; everyMinutes: number }
  | { kind: "once"; at: string };

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE = 60_000;
/** Shortest interval allowed, so a mistake cannot flood a bot. */
export const MIN_INTERVAL_MINUTES = 5;
/** A run later than this is recorded as missed, not run. */
export const CATCH_UP_MS = 12 * 60 * MINUTE;

export function validateSchedule(value: unknown): Schedule {
  if (typeof value !== "object" || value === null)
    throw new ScheduleError("A schedule is required.");
  const schedule = value as Record<string, unknown>;
  if (schedule.kind === "daily") {
    const times = schedule.times;
    const weekdays = schedule.weekdays;
    if (
      !Array.isArray(times) ||
      times.length === 0 ||
      !times.every((t) => typeof t === "string" && TIME.test(t))
    ) {
      throw new ScheduleError("Give at least one time as HH:MM, for example 09:00.");
    }
    if (
      !Array.isArray(weekdays) ||
      weekdays.length === 0 ||
      !weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ) {
      throw new ScheduleError("Choose at least one day of the week.");
    }
    return {
      kind: "daily",
      times: [...new Set(times as string[])].sort(),
      weekdays: [...new Set(weekdays as number[])].sort(),
    };
  }
  if (schedule.kind === "interval") {
    const every = schedule.everyMinutes;
    if (typeof every !== "number" || !Number.isInteger(every) || every < MIN_INTERVAL_MINUTES) {
      throw new ScheduleError(
        `A repeating round runs at most every ${MIN_INTERVAL_MINUTES} minutes.`,
      );
    }
    return { kind: "interval", everyMinutes: every };
  }
  if (schedule.kind === "once") {
    const at = typeof schedule.at === "string" ? new Date(schedule.at) : null;
    if (!at || Number.isNaN(at.getTime()))
      throw new ScheduleError("Give the date and time to run.");
    return { kind: "once", at: at.toISOString() };
  }
  throw new ScheduleError("Unknown kind of schedule.");
}

/** The first time the schedule falls strictly after `after`, or null when it never will. */
export function nextRun(schedule: Schedule, after: Date, anchor: Date = after): Date | null {
  if (schedule.kind === "once") {
    const at = new Date(schedule.at);
    return at.getTime() > after.getTime() ? at : null;
  }
  if (schedule.kind === "interval") {
    const step = schedule.everyMinutes * MINUTE;
    const elapsed = Math.max(0, after.getTime() - anchor.getTime());
    return new Date(anchor.getTime() + (Math.floor(elapsed / step) + 1) * step);
  }
  // Look through today and the next seven days: one of them holds an allowed weekday.
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset);
    if (!schedule.weekdays.includes(day.getDay())) continue;
    for (const time of schedule.times) {
      const [hours, minutes] = time.split(":").map(Number);
      const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
  }
  return null;
}

/** Every time the schedule fell in (after, until], oldest first, capped so a long sleep is cheap. */
export function occurrencesBetween(
  schedule: Schedule,
  after: Date,
  until: Date,
  anchor: Date = after,
  cap = 500,
): Date[] {
  const found: Date[] = [];
  let cursor = after;
  while (found.length < cap) {
    const next = nextRun(schedule, cursor, anchor);
    if (!next || next.getTime() > until.getTime()) break;
    found.push(next);
    cursor = next;
  }
  return found;
}
