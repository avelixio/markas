import type { Round, RoundRun, RoundsStore } from "./rounds-store";
import { CATCH_UP_MS, occurrencesBetween } from "./schedule";

export interface RoundsHost {
  /**
   * Queues the instruction for the bot and returns the queue entry that will carry it out.
   * The round is named so that its standing permissions count for this run and no other.
   */
  deliver(botId: string, text: string, roundId: string): Promise<{ deliveryId: string }>;
  /** True while the bot has a turn running or messages waiting. */
  isBusy(botId: string): boolean;
  botExists(botId: string): boolean;
  /** True while the bot is deleted but can still be put back. Its rounds rest meanwhile. */
  botAway?(botId: string): boolean;
  /** How a queue entry stands now, or null when the queue no longer knows it. */
  deliveryStatus(deliveryId: string): string | null;
  /** Called whenever a run is added or ends, so the interface can refresh. */
  changed(): void;
}

/** Queue states in which a turn has not ended yet. */
const ACTIVE = ["queued", "starting", "running"];

/** How often the clock is checked. Also what catches up after the computer slept. */
const TICK_MS = 30_000;

export const roundMessage = (round: Round): string =>
  `[Round: ${round.name}]\n${round.instruction}`;

/**
 * Runs rounds on time and accounts for every occurrence.
 * Each scheduled time ends as exactly one run: completed, failed, skipped or missed.
 * An occurrence more than 12 hours late is recorded as missed, never run late and never
 * run twice; when several were due at once, only the newest runs.
 */
export class RoundsScheduler {
  readonly #store: RoundsStore;
  readonly #host: RoundsHost;
  readonly #now: () => Date;
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticking: Promise<void> = Promise.resolve();

  constructor(store: RoundsStore, host: RoundsHost, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#host = host;
    this.#now = now;
  }

  start(): void {
    if (this.#timer) return;
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Checks every round once. Calls never overlap: a second call waits for the first. */
  tick(): Promise<void> {
    this.#ticking = this.#ticking.then(() => this.#check()).catch(() => undefined);
    return this.#ticking;
  }

  /** Starts a round now, outside its schedule. */
  async runNow(roundId: string): Promise<RoundRun> {
    const round = this.#store.get(roundId);
    return this.#run(round, this.#now(), true);
  }

  /**
   * Ends every run whose queue entry has ended.
   * Runs are matched to queue entries here, not only when an event arrives, because a
   * quick turn can end before its run has been written down.
   */
  async reconcile(): Promise<void> {
    for (const deliveryId of this.#store.runningDeliveryIds()) {
      const status = this.#host.deliveryStatus(deliveryId) ?? "failed";
      if (!ACTIVE.includes(status)) await this.deliveryEnded(deliveryId, status);
    }
  }

  /** Records how a queue entry ended, if it belonged to a run. */
  async deliveryEnded(deliveryId: string, status: string): Promise<void> {
    const ended =
      status === "completed"
        ? await this.#store.finishRunByDelivery(deliveryId, "completed", "", this.#now())
        : await this.#store.finishRunByDelivery(
            deliveryId,
            "failed",
            status === "cancelled"
              ? "The run was cancelled from the bot's queue."
              : status === "interrupted"
                ? "The run was stopped before it finished."
                : "The bot's turn ended with an error.",
            this.#now(),
          );
    if (ended) this.#host.changed();
  }

  async #check(): Promise<void> {
    await this.reconcile();
    const now = this.#now();
    for (const round of this.#store.list()) {
      if (!round.enabled) continue;
      if (this.#host.botAway?.(round.botId)) {
        // Times that pass while the bot is deleted are let go, not run late when it returns.
        await this.#store.markChecked(round.id, now);
        continue;
      }
      const due = occurrencesBetween(
        round.schedule,
        new Date(round.checkedThrough),
        now,
        new Date(round.createdAt),
      );
      if (due.length === 0) continue;
      const newest = due.at(-1) as Date;
      for (const occurrence of due) {
        const late = now.getTime() - occurrence.getTime();
        if (occurrence !== newest) {
          await this.#record(
            round,
            occurrence,
            "missed",
            "A later run of this round was also due, so only the newest ran.",
          );
        } else if (late > CATCH_UP_MS) {
          await this.#record(
            round,
            occurrence,
            "missed",
            "Markas was not running for more than 12 hours past this time.",
          );
        } else {
          await this.#run(round, occurrence, false);
        }
      }
      await this.#store.markChecked(round.id, now);
      // A round that runs once switches itself off afterwards.
      if (round.schedule.kind === "once")
        await this.#store.update(round.id, { enabled: false }, now);
    }
  }

  async #run(round: Round, scheduledFor: Date, manual: boolean): Promise<RoundRun> {
    if (!this.#host.botExists(round.botId)) {
      return this.#record(
        round,
        scheduledFor,
        "failed",
        "The bot for this round no longer exists.",
        manual,
      );
    }
    if (!manual && round.overlap === "skip" && this.#host.isBusy(round.botId)) {
      return this.#record(
        round,
        scheduledFor,
        "skipped",
        "The bot was still busy, and this round is set to skip.",
      );
    }
    try {
      const { deliveryId } = await this.#host.deliver(round.botId, roundMessage(round), round.id);
      const run = await this.#store.addRun({
        roundId: round.id,
        scheduledFor: scheduledFor.toISOString(),
        startedAt: this.#now().toISOString(),
        finishedAt: null,
        status: "running",
        detail: "",
        deliveryId,
        manual,
      });
      this.#host.changed();
      // The turn may already be over.
      await this.reconcile();
      return this.#store.runs(round.id, 500).find((candidate) => candidate.id === run.id) ?? run;
    } catch (error) {
      return this.#record(
        round,
        scheduledFor,
        "failed",
        `The round could not be handed to the bot: ${error instanceof Error ? error.message : String(error)}`,
        manual,
      );
    }
  }

  async #record(
    round: Round,
    scheduledFor: Date,
    status: "missed" | "skipped" | "failed",
    detail: string,
    manual = false,
  ): Promise<RoundRun> {
    const stamp = this.#now().toISOString();
    const run = await this.#store.addRun({
      roundId: round.id,
      scheduledFor: scheduledFor.toISOString(),
      startedAt: null,
      finishedAt: stamp,
      status,
      detail,
      deliveryId: null,
      manual,
    });
    this.#host.changed();
    return run;
  }
}
