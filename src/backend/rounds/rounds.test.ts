// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoundsError, RoundsStore } from "./rounds-store";
import { nextRun, occurrencesBetween, ScheduleError, validateSchedule } from "./schedule";
import { type RoundsHost, RoundsScheduler } from "./scheduler";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-rounds-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Local wall-clock time, the way schedules are written. Month is 1 to 12. */
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

describe("schedule", () => {
  it("finds the next daily time, today or on the next allowed day", () => {
    const schedule = validateSchedule({
      kind: "daily",
      times: ["17:30", "09:00"],
      weekdays: EVERY_DAY,
    });
    expect(nextRun(schedule, at(11, 8))).toEqual(at(11, 9));
    expect(nextRun(schedule, at(11, 9))).toEqual(at(11, 17, 30));
    expect(nextRun(schedule, at(11, 18))).toEqual(at(12, 9));
  });

  it("skips days that are not chosen", () => {
    // 11 November 2026 is a Wednesday; Monday only means the 16th.
    const schedule = validateSchedule({ kind: "daily", times: ["09:00"], weekdays: [1] });
    expect(nextRun(schedule, at(11, 8))).toEqual(at(16, 9));
  });

  it("counts an interval from when the round was made", () => {
    const schedule = validateSchedule({ kind: "interval", everyMinutes: 30 });
    expect(nextRun(schedule, at(11, 10, 40), at(11, 10))).toEqual(at(11, 11));
    expect(occurrencesBetween(schedule, at(11, 10), at(11, 11, 45), at(11, 10))).toEqual([
      at(11, 10, 30),
      at(11, 11),
      at(11, 11, 30),
    ]);
  });

  it("runs a one-time schedule once and never again", () => {
    const schedule = validateSchedule({ kind: "once", at: at(11, 12).toISOString() });
    expect(nextRun(schedule, at(11, 11))).toEqual(at(11, 12));
    expect(nextRun(schedule, at(11, 12))).toBeNull();
  });

  it("refuses schedules that make no sense", () => {
    expect(() => validateSchedule({ kind: "daily", times: ["9am"], weekdays: [1] })).toThrow(
      ScheduleError,
    );
    expect(() => validateSchedule({ kind: "daily", times: ["09:00"], weekdays: [] })).toThrow(
      ScheduleError,
    );
    expect(() => validateSchedule({ kind: "interval", everyMinutes: 1 })).toThrow(ScheduleError);
    expect(() => validateSchedule({ kind: "once", at: "soon" })).toThrow(ScheduleError);
    expect(() => validateSchedule({ kind: "hourly" })).toThrow(ScheduleError);
    expect(() => validateSchedule(null)).toThrow(ScheduleError);
  });
});

function harness(start: Date) {
  let now = start;
  const delivered: Array<{ botId: string; text: string }> = [];
  const state = {
    busy: false,
    bots: new Set(["atlas"]),
    failDelivery: false,
    changes: 0,
    /** How the bot's queue reports each entry; an entry not listed is still running. */
    statuses: new Map<string, string | null>(),
  };
  const host: RoundsHost = {
    deliver: async (botId, text) => {
      if (state.failDelivery) throw new Error("engine is not signed in");
      delivered.push({ botId, text });
      return { deliveryId: `delivery-${delivered.length}` };
    },
    isBusy: () => state.busy,
    botExists: (botId) => state.bots.has(botId),
    deliveryStatus: (deliveryId) =>
      state.statuses.has(deliveryId) ? (state.statuses.get(deliveryId) ?? null) : "running",
    changed: () => {
      state.changes += 1;
    },
  };
  const store = new RoundsStore(root);
  const scheduler = new RoundsScheduler(store, host, () => now);
  return {
    store,
    scheduler,
    delivered,
    state,
    setNow: (value: Date) => {
      now = value;
    },
  };
}

const morning = {
  name: "Morning stock check",
  botId: "atlas",
  instruction: "Check stock levels and report anything low.",
  schedule: { kind: "daily", times: ["09:00"], weekdays: EVERY_DAY },
};

describe("rounds store", () => {
  it("saves rounds and reads them back after a restart", async () => {
    const { store } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(morning, at(11, 8));
    expect(round.enabled).toBe(true);
    expect(store.nextRunAt(round, at(11, 8))).toBe(at(11, 9).toISOString());

    const reopened = new RoundsStore(root);
    await reopened.initialize();
    expect(reopened.list().map((item) => item.name)).toEqual(["Morning stock check"]);
  });

  it("refuses a round without a name, bot, instruction or valid schedule", async () => {
    const { store } = harness(at(11, 8));
    await store.initialize();
    await expect(store.create({ ...morning, name: " " })).rejects.toThrow(RoundsError);
    await expect(store.create({ ...morning, botId: "" })).rejects.toThrow(RoundsError);
    await expect(store.create({ ...morning, instruction: "" })).rejects.toThrow(RoundsError);
    await expect(store.create({ ...morning, schedule: { kind: "daily" } })).rejects.toThrow(
      RoundsError,
    );
    await expect(store.update("missing", { name: "x" })).rejects.toThrow("no longer exists");
  });

  it("removes a round with its history, and every round of a deleted bot", async () => {
    const { store } = harness(at(11, 8));
    await store.initialize();
    const first = await store.create(morning);
    const second = await store.create({ ...morning, name: "Evening", botId: "juno" });
    await store.addRun({
      roundId: first.id,
      scheduledFor: at(11, 9).toISOString(),
      startedAt: null,
      finishedAt: null,
      status: "missed",
      detail: "",
      deliveryId: null,
      manual: false,
    });
    await store.forgetBot("atlas");
    expect(store.list().map((round) => round.id)).toEqual([second.id]);
    expect(store.runs()).toEqual([]);
    await store.remove(second.id);
    expect(store.list()).toEqual([]);
  });

  it("marks a run as failed when the host stopped while it was going", async () => {
    const { store } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(morning);
    await store.addRun({
      roundId: round.id,
      scheduledFor: at(11, 9).toISOString(),
      startedAt: at(11, 9).toISOString(),
      finishedAt: null,
      status: "running",
      detail: "",
      deliveryId: "delivery-1",
      manual: false,
    });
    const reopened = new RoundsStore(root);
    await reopened.initialize();
    expect(reopened.lastRun(round.id)?.status).toBe("failed");
    expect(reopened.runningDeliveryIds()).toEqual([]);
  });
});

describe("rounds scheduler", () => {
  it("runs a due round once, and records how it ended", async () => {
    const { store, scheduler, delivered, setNow } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(morning, at(11, 8));

    await scheduler.tick();
    expect(delivered).toEqual([]);

    setNow(at(11, 9, 0));
    await scheduler.tick();
    await scheduler.tick();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.text).toContain("Check stock levels");
    expect(delivered[0]?.text).toContain("Morning stock check");
    expect(store.lastRun(round.id)?.status).toBe("running");

    await scheduler.deliveryEnded("delivery-1", "completed");
    expect(store.lastRun(round.id)).toMatchObject({ status: "completed", manual: false });
  });

  it("records a failed, stopped or cancelled turn as a failed run", async () => {
    const { store, scheduler } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(morning, at(11, 8));
    for (const [index, status] of ["failed", "interrupted", "cancelled"].entries()) {
      await scheduler.runNow(round.id);
      await scheduler.deliveryEnded(`delivery-${index + 1}`, status);
      expect(store.lastRun(round.id)).toMatchObject({ status: "failed", manual: true });
      expect(store.lastRun(round.id)?.detail).not.toBe("");
    }
    // A queue entry that is not a round's is ignored.
    await scheduler.deliveryEnded("someone-else", "completed");
    expect(store.runs(round.id)).toHaveLength(3);
  });

  it("ends a run whose turn finished before the run was written down", async () => {
    const { store, scheduler, state } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(morning, at(11, 8));
    // The turn is already over by the time the scheduler hears back from the queue.
    state.statuses.set("delivery-1", "completed");
    expect(await scheduler.runNow(round.id)).toMatchObject({ status: "completed" });
    expect(store.lastRun(round.id)?.status).toBe("completed");
  });

  it("ends a run on the next check when no event announced it, or its queue entry is gone", async () => {
    const { store, scheduler, state } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(morning, at(11, 8));
    await scheduler.runNow(round.id);
    expect(store.lastRun(round.id)?.status).toBe("running");
    state.statuses.set("delivery-1", "failed");
    await scheduler.tick();
    expect(store.lastRun(round.id)?.status).toBe("failed");

    await scheduler.runNow(round.id);
    state.statuses.set("delivery-2", null);
    await scheduler.tick();
    expect(store.lastRun(round.id)?.status).toBe("failed");
  });

  it("after a long sleep runs only the newest occurrence and marks the rest missed", async () => {
    const { store, scheduler, delivered, setNow } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(
      { ...morning, schedule: { kind: "interval", everyMinutes: 60 } },
      at(11, 8),
    );
    setNow(at(11, 11, 10));
    await scheduler.tick();
    expect(delivered).toHaveLength(1);
    expect(store.runs(round.id).map((run) => run.status)).toEqual(["running", "missed", "missed"]);
  });

  it("does not run an occurrence that is more than 12 hours late", async () => {
    const { store, scheduler, delivered, setNow } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(
      { ...morning, schedule: { kind: "daily", times: ["09:00"], weekdays: [3] } },
      at(11, 8),
    );
    setNow(at(12, 10));
    await scheduler.tick();
    expect(delivered).toEqual([]);
    expect(store.lastRun(round.id)).toMatchObject({ status: "missed" });
    expect(store.lastRun(round.id)?.detail).toContain("12 hours");
  });

  it("skips when the bot is busy and the round says skip, and waits otherwise", async () => {
    const { store, scheduler, delivered, state, setNow } = harness(at(11, 8));
    await store.initialize();
    const skipping = await store.create({ ...morning, overlap: "skip" }, at(11, 8));
    const waiting = await store.create({ ...morning, name: "Waits" }, at(11, 8));
    state.busy = true;
    setNow(at(11, 9));
    await scheduler.tick();
    expect(store.lastRun(skipping.id)?.status).toBe("skipped");
    expect(store.lastRun(waiting.id)?.status).toBe("running");
    expect(delivered).toHaveLength(1);
  });

  it("does not run a round that is switched off, and does not make up the time it was off", async () => {
    const { store, scheduler, delivered, setNow } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create({ ...morning, enabled: false }, at(11, 8));
    setNow(at(11, 9, 30));
    await scheduler.tick();
    expect(delivered).toEqual([]);
    await store.update(round.id, { enabled: true }, at(11, 9, 30));
    await scheduler.tick();
    expect(delivered).toEqual([]);
    expect(store.runs(round.id)).toEqual([]);
  });

  it("switches a one-time round off after it ran", async () => {
    const { store, scheduler, delivered, setNow } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(
      { ...morning, schedule: { kind: "once", at: at(11, 12).toISOString() } },
      at(11, 8),
    );
    setNow(at(11, 12, 1));
    await scheduler.tick();
    expect(delivered).toHaveLength(1);
    expect(store.get(round.id).enabled).toBe(false);
  });

  it("records a failed run when the bot is gone or cannot take the message", async () => {
    const { store, scheduler, state } = harness(at(11, 8));
    await store.initialize();
    const round = await store.create(morning, at(11, 8));
    state.failDelivery = true;
    expect(await scheduler.runNow(round.id)).toMatchObject({ status: "failed" });
    expect(store.lastRun(round.id)?.detail).toContain("engine is not signed in");
    state.bots.clear();
    expect(await scheduler.runNow(round.id)).toMatchObject({ status: "failed" });
    expect(store.lastRun(round.id)?.detail).toContain("no longer exists");
    expect(state.changes).toBe(2);
  });
});
