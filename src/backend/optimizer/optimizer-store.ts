import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  COMPACT_AT_RANGE,
  DEFAULT_OPTIMIZER_SETTINGS,
  type OptimizerSettings,
  SAVING_KINDS,
  type SavingEvent,
  type SavingKind,
  type SavingTotal,
} from "../../shared/optimizer";

/** How many single savings are kept to show. The totals count every one, kept or not. */
export const MAX_RECENT_SAVINGS = 200;

interface StoredState {
  version: 1;
  since: string;
  settings: OptimizerSettings;
  totals: Record<SavingKind, SavingTotal>;
  perBot: Record<string, number>;
  recent: SavingEvent[];
}

export class OptimizerError extends Error {}

const emptyTotals = (): Record<SavingKind, SavingTotal> => ({
  compact: { events: 0, tokens: 0 },
  trim: { events: 0, tokens: 0 },
});

/**
 * The Optimizer's settings and its count of tokens saved, kept in `optimizer.json`.
 * Only numbers are kept: never a message, a page or a command.
 */
export class OptimizerStore {
  readonly #path: string;
  #state: StoredState;
  #writes: Promise<void> = Promise.resolve();
  #timer: NodeJS.Timeout | null = null;

  constructor(dataRoot: string, now: Date = new Date()) {
    this.#path = join(dataRoot, "optimizer.json");
    this.#state = {
      version: 1,
      since: now.toISOString(),
      settings: { ...DEFAULT_OPTIMIZER_SETTINGS },
      totals: emptyTotals(),
      perBot: {},
      recent: [],
    };
  }

  async initialize(): Promise<void> {
    let parsed: Partial<StoredState>;
    try {
      parsed = JSON.parse(await readFile(this.#path, "utf8")) as Partial<StoredState>;
    } catch (error) {
      // A missing or unreadable file starts the count over instead of stopping the host.
      if (error instanceof SyntaxError) return;
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    if (parsed.version !== 1) return;
    if (typeof parsed.since === "string") this.#state.since = parsed.since;
    this.#state.settings = checkedSettings({ ...DEFAULT_OPTIMIZER_SETTINGS, ...parsed.settings });
    for (const kind of SAVING_KINDS) {
      const total = parsed.totals?.[kind];
      if (total && Number.isFinite(total.events) && Number.isFinite(total.tokens)) {
        this.#state.totals[kind] = { events: total.events, tokens: total.tokens };
      }
    }
    if (parsed.perBot && typeof parsed.perBot === "object") this.#state.perBot = parsed.perBot;
    if (Array.isArray(parsed.recent)) {
      this.#state.recent = parsed.recent.slice(0, MAX_RECENT_SAVINGS);
    }
  }

  settings(): OptimizerSettings {
    return { ...this.#state.settings };
  }

  since(): string {
    return this.#state.since;
  }

  totals(): Record<SavingKind, SavingTotal> {
    return structuredClone(this.#state.totals);
  }

  perBot(): Record<string, number> {
    return { ...this.#state.perBot };
  }

  recent(): SavingEvent[] {
    return structuredClone(this.#state.recent);
  }

  async save(patch: Partial<OptimizerSettings>): Promise<OptimizerSettings> {
    this.#state.settings = checkedSettings({ ...this.#state.settings, ...patch });
    await this.#persist();
    return this.settings();
  }

  /**
   * Counts one saving. A saving of nothing, or of a number that makes no sense, is ignored.
   * Savings can come many times a minute, so the file is written a moment later, once.
   */
  record(kind: SavingKind, botId: string | null, tokens: number, now: Date = new Date()): void {
    if (!Number.isFinite(tokens) || tokens < 1) return;
    const whole = Math.round(tokens);
    this.#state.totals[kind].events += 1;
    this.#state.totals[kind].tokens += whole;
    if (botId) this.#state.perBot[botId] = (this.#state.perBot[botId] ?? 0) + whole;
    this.#state.recent.unshift({ at: now.toISOString(), botId, kind, tokens: whole });
    this.#state.recent.length = Math.min(this.#state.recent.length, MAX_RECENT_SAVINGS);
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#persist().catch(() => undefined);
    }, 1_000);
    this.#timer.unref?.();
  }

  /** A deleted bot's savings stay in the totals; only its own line goes. */
  forgetBot(botId: string): void {
    if (!(botId in this.#state.perBot)) return;
    delete this.#state.perBot[botId];
    void this.#persist().catch(() => undefined);
  }

  /** Writes what is still waiting, for when the host stops. */
  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#persist();
  }

  #persist(): Promise<void> {
    const write = this.#writes.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.#state)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.#path);
    });
    this.#writes = write.catch(() => undefined);
    return write;
  }
}

function checkedSettings(value: OptimizerSettings): OptimizerSettings {
  if (typeof value.autoCompact !== "boolean") {
    throw new OptimizerError("autoCompact must be true or false.");
  }
  if (typeof value.lean !== "boolean") throw new OptimizerError("lean must be true or false.");
  if (
    typeof value.compactAt !== "number" ||
    !Number.isFinite(value.compactAt) ||
    value.compactAt < COMPACT_AT_RANGE.min ||
    value.compactAt > COMPACT_AT_RANGE.max
  ) {
    throw new OptimizerError(
      `Choose a point between ${COMPACT_AT_RANGE.min * 100}% and ${COMPACT_AT_RANGE.max * 100}% full.`,
    );
  }
  return { autoCompact: value.autoCompact, compactAt: value.compactAt, lean: value.lean };
}
