import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AccessLevel,
  type AskKind,
  DEFAULT_ACCESS,
  type StandingGrant,
} from "../../shared/access";
import { nextRun, type Schedule, validateSchedule } from "./schedule";
import { StandingError, splitByLevel, stampStanding, validateStanding } from "./standing";

/** wait: a run joins the bot's queue. skip: a run is dropped while the bot is busy. */
export type OverlapPolicy = "wait" | "skip";

export interface Round {
  id: string;
  name: string;
  botId: string;
  /** What the bot is told to do each time. */
  instruction: string;
  schedule: Schedule;
  overlap: OverlapPolicy;
  /** What this round may do without asking. Counts only for runs of this round. */
  standing: StandingGrant[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** The scheduler has dealt with every occurrence up to this moment. */
  checkedThrough: string;
}

export type RunStatus = "running" | "completed" | "failed" | "missed" | "skipped";

/** One time a run stopped at a card because it needed more than its standing permissions. */
export interface RunWait {
  /** The card this wait belongs to. */
  requestId: string;
  kind: AskKind;
  /** What exactly was asked for: a path, a command, an address or a tool name. */
  detail: string;
  askedAt: string;
  /** Null while the card is still open. */
  answeredAt: string | null;
  /** Null while open, and when the run ended before anyone answered. */
  answer: "allowed" | "denied" | null;
}

/** One occurrence of a round and how it ended. Every occurrence gets one, so none is silent. */
export interface RoundRun {
  id: string;
  roundId: string;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: RunStatus;
  /** Why it was missed, skipped or failed, in plain words. */
  detail: string;
  /** The bot's queue entry for this run, used to learn how it ended. */
  deliveryId: string | null;
  /** True when the person started it with Run now. */
  manual: boolean;
  /**
   * Every time this run stopped to ask. The run is waiting on the person now when it is
   * still running and the last entry has no answer.
   */
  waits: RunWait[];
}

/** What a run is waiting for right now, or null when it is not waiting. */
export function waitingOn(run: RoundRun): RunWait | null {
  const last = run.waits.at(-1);
  return run.status === "running" && last && last.answeredAt === null ? last : null;
}

export interface RoundInput {
  name: string;
  botId: string;
  instruction: string;
  schedule: unknown;
  overlap?: OverlapPolicy;
  enabled?: boolean;
  /** A list of standing permissions; it replaces the ones the round had. */
  standing?: unknown;
}

export class RoundsError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "not-found",
  ) {
    super(message);
    this.name = "RoundsError";
  }
}

interface StoredState {
  version: 1;
  rounds: Round[];
  runs: RoundRun[];
}

const RUNS_KEPT = 2_000;
/** A run that keeps asking is cut off here; the newest waits are the ones kept. */
const WAITS_KEPT = 50;

/** Rounds and their run history, kept in one file that is rewritten atomically. */
export class RoundsStore {
  readonly #path: string;
  #state: StoredState = { version: 1, rounds: [], runs: [] };
  #writeQueue: Promise<void> = Promise.resolve();

  /** Markas's own data folder, which no standing permission may name. */
  readonly #dataRoot: string;

  constructor(dataRoot: string) {
    this.#dataRoot = dataRoot;
    this.#path = join(dataRoot, "rounds.json");
  }

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as StoredState;
      if (parsed.version === 1 && Array.isArray(parsed.rounds) && Array.isArray(parsed.runs)) {
        this.#state = parsed;
        // Files written before standing permissions existed have neither field.
        for (const round of parsed.rounds) round.standing ??= [];
        for (const run of parsed.runs) run.waits ??= [];
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    // A run that was still going when the host stopped can no longer be followed.
    let changed = false;
    for (const run of this.#state.runs) {
      if (run.status !== "running") continue;
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      run.detail = "Markas stopped while this run was going, so its result is unknown.";
      closeWaits(run, run.finishedAt);
      changed = true;
    }
    if (changed) await this.#persist();
  }

  list(): Round[] {
    return this.#state.rounds.map((round) => structuredClone(round));
  }

  get(id: string): Round {
    const round = this.#state.rounds.find((candidate) => candidate.id === id);
    if (!round) throw new RoundsError("That round no longer exists.", "not-found");
    return structuredClone(round);
  }

  /** The newest runs first, for one round or for all. */
  runs(roundId?: string, limit = 50): RoundRun[] {
    const runs = roundId
      ? this.#state.runs.filter((run) => run.roundId === roundId)
      : this.#state.runs;
    return runs
      .slice(-Math.max(1, Math.min(limit, 500)))
      .reverse()
      .map((run) => structuredClone(run));
  }

  lastRun(roundId: string): RoundRun | null {
    for (let index = this.#state.runs.length - 1; index >= 0; index -= 1) {
      const run = this.#state.runs[index];
      if (run?.roundId === roundId) return structuredClone(run);
    }
    return null;
  }

  nextRunAt(round: Round, now: Date): string | null {
    if (!round.enabled) return null;
    return nextRun(round.schedule, now, new Date(round.createdAt))?.toISOString() ?? null;
  }

  /**
   * `botLevel` is the access level of the round's bot now. New standing permissions are
   * stamped with it.
   */
  async create(
    input: RoundInput,
    now: Date = new Date(),
    botLevel: AccessLevel = DEFAULT_ACCESS,
  ): Promise<Round> {
    const fields = validate(input);
    const stamp = now.toISOString();
    const round: Round = {
      id: randomUUID(),
      ...fields,
      standing: stampStanding(this.#standing(input.standing), [], botLevel, now),
      enabled: input.enabled ?? true,
      createdAt: stamp,
      updatedAt: stamp,
      checkedThrough: stamp,
    };
    this.#state.rounds.push(round);
    await this.#persist();
    return structuredClone(round);
  }

  async update(
    id: string,
    patch: Partial<RoundInput>,
    now: Date = new Date(),
    botLevel: AccessLevel = DEFAULT_ACCESS,
  ): Promise<Round> {
    const round = this.#require(id);
    const movedToAnotherBot = patch.botId !== undefined && patch.botId.trim() !== round.botId;
    // Standing permissions were given for one bot. They do not follow the round to another
    // bot unless the person names them again in the same change.
    const standing =
      patch.standing !== undefined
        ? stampStanding(
            this.#standing(patch.standing),
            movedToAnotherBot ? [] : round.standing,
            botLevel,
            now,
          )
        : movedToAnotherBot
          ? []
          : round.standing;
    const fields = validate({
      name: patch.name ?? round.name,
      botId: patch.botId ?? round.botId,
      instruction: patch.instruction ?? round.instruction,
      schedule: patch.schedule ?? round.schedule,
      overlap: patch.overlap ?? round.overlap,
    });
    const wasEnabled = round.enabled;
    Object.assign(round, fields, {
      standing,
      enabled: patch.enabled ?? round.enabled,
      updatedAt: now.toISOString(),
    });
    // Turning a round back on, or changing when it runs, starts counting from now:
    // the time it was off is not made up.
    if ((!wasEnabled && round.enabled) || patch.schedule !== undefined) {
      round.checkedThrough = now.toISOString();
    }
    await this.#persist();
    return structuredClone(round);
  }

  async remove(id: string): Promise<void> {
    this.#require(id);
    this.#state.rounds = this.#state.rounds.filter((round) => round.id !== id);
    this.#state.runs = this.#state.runs.filter((run) => run.roundId !== id);
    await this.#persist();
  }

  /** Removes every round of a deleted bot. */
  async forgetBot(botId: string): Promise<void> {
    const gone = new Set(
      this.#state.rounds.filter((round) => round.botId === botId).map((r) => r.id),
    );
    if (gone.size === 0) return;
    this.#state.rounds = this.#state.rounds.filter((round) => !gone.has(round.id));
    this.#state.runs = this.#state.runs.filter((run) => !gone.has(run.roundId));
    await this.#persist();
  }

  /**
   * Drops every standing permission of a bot's rounds that was given at a higher access
   * level than the bot has now. Returns what was dropped, per round.
   */
  async dropStandingAbove(
    botId: string,
    level: AccessLevel,
    now: Date = new Date(),
  ): Promise<Array<{ round: Round; dropped: StandingGrant[] }>> {
    const result: Array<{ round: Round; dropped: StandingGrant[] }> = [];
    for (const round of this.#state.rounds) {
      if (round.botId !== botId) continue;
      const { kept, dropped } = splitByLevel(round.standing, level);
      if (dropped.length === 0) continue;
      round.standing = kept;
      round.updatedAt = now.toISOString();
      result.push({ round: structuredClone(round), dropped });
    }
    if (result.length > 0) await this.#persist();
    return result;
  }

  /** Records that a run stopped at a card. Returns the run, or null when none is going. */
  async noteWaiting(
    deliveryId: string,
    wait: Pick<RunWait, "requestId" | "kind" | "detail">,
    now: Date = new Date(),
  ): Promise<RoundRun | null> {
    const run = this.#runningRun(deliveryId);
    if (!run) return null;
    run.waits.push({ ...wait, askedAt: now.toISOString(), answeredAt: null, answer: null });
    if (run.waits.length > WAITS_KEPT) run.waits.splice(0, run.waits.length - WAITS_KEPT);
    await this.#persist();
    return structuredClone(run);
  }

  /** Records the person's answer to a card a run was waiting at. */
  async noteAnswered(
    deliveryId: string,
    requestId: string,
    allowed: boolean,
    now: Date = new Date(),
  ): Promise<RoundRun | null> {
    const run = this.#runningRun(deliveryId);
    const wait = run?.waits.find(
      (candidate) => candidate.requestId === requestId && candidate.answeredAt === null,
    );
    if (!run || !wait) return null;
    wait.answeredAt = now.toISOString();
    wait.answer = allowed ? "allowed" : "denied";
    await this.#persist();
    return structuredClone(run);
  }

  async markChecked(id: string, through: Date): Promise<void> {
    const round = this.#state.rounds.find((candidate) => candidate.id === id);
    if (!round) return;
    round.checkedThrough = through.toISOString();
    await this.#persist();
  }

  async addRun(run: Omit<RoundRun, "id" | "waits"> & { waits?: RunWait[] }): Promise<RoundRun> {
    const stored: RoundRun = { id: randomUUID(), ...run, waits: run.waits ?? [] };
    this.#state.runs.push(stored);
    if (this.#state.runs.length > RUNS_KEPT)
      this.#state.runs.splice(0, this.#state.runs.length - RUNS_KEPT);
    await this.#persist();
    return structuredClone(stored);
  }

  /** Ends the run that belongs to a queue entry. Returns it, or null when none was waiting. */
  async finishRunByDelivery(
    deliveryId: string,
    status: "completed" | "failed",
    detail: string,
    now: Date = new Date(),
  ): Promise<RoundRun | null> {
    const run = this.#state.runs.find(
      (candidate) => candidate.deliveryId === deliveryId && candidate.status === "running",
    );
    if (!run) return null;
    run.status = status;
    run.detail = detail;
    run.finishedAt = now.toISOString();
    closeWaits(run, run.finishedAt);
    await this.#persist();
    return structuredClone(run);
  }

  runningDeliveryIds(): string[] {
    return this.#state.runs
      .filter((run) => run.status === "running" && run.deliveryId)
      .map((run) => run.deliveryId as string);
  }

  #runningRun(deliveryId: string): RoundRun | undefined {
    return this.#state.runs.find(
      (candidate) => candidate.deliveryId === deliveryId && candidate.status === "running",
    );
  }

  #standing(value: unknown) {
    try {
      return validateStanding(value, [this.#dataRoot]);
    } catch (error) {
      if (error instanceof StandingError) throw new RoundsError(error.message, "invalid");
      throw error;
    }
  }

  #require(id: string): Round {
    const round = this.#state.rounds.find((candidate) => candidate.id === id);
    if (!round) throw new RoundsError("That round no longer exists.", "not-found");
    return round;
  }

  #persist(): Promise<void> {
    const snapshot = `${JSON.stringify(this.#state)}\n`;
    const write = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.#path);
    });
    this.#writeQueue = write.catch(() => undefined);
    return write;
  }
}

/** A card nobody answered before the run ended stays unanswered, but is no longer open. */
function closeWaits(run: RoundRun, at: string | null): void {
  for (const wait of run.waits) wait.answeredAt ??= at ?? new Date().toISOString();
}

function validate(input: RoundInput) {
  const name = input.name?.trim();
  if (!name) throw new RoundsError("A round needs a name.", "invalid");
  if (name.length > 80) throw new RoundsError("Keep the name under 80 characters.", "invalid");
  if (!input.botId?.trim())
    throw new RoundsError("Choose the bot that does this round.", "invalid");
  const instruction = input.instruction?.trim();
  if (!instruction) throw new RoundsError("Say what the bot should do each time.", "invalid");
  const overlap = input.overlap ?? "wait";
  if (overlap !== "wait" && overlap !== "skip")
    throw new RoundsError("Unknown overlap choice.", "invalid");
  let schedule: Schedule;
  try {
    schedule = validateSchedule(input.schedule);
  } catch (error) {
    throw new RoundsError(error instanceof Error ? error.message : String(error), "invalid");
  }
  return { name, botId: input.botId.trim(), instruction, schedule, overlap };
}
