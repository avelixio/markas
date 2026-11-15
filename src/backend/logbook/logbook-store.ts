import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const LOGBOOK_ACTIONS = [
  "bot.created",
  "bot.renamed",
  "bot.deleted",
  "bot.restored",
  "bot.purged",
  "bot.access",
  "key.created",
  "key.changed",
  "key.shared",
  "key.shown",
  "key.removed",
  "key.used",
  "round.created",
  "round.changed",
  "round.started",
  "round.removed",
  "round.standing-set",
  "round.standing-used",
  "round.standing-dropped",
  "setup.saved",
  "engine.installed",
  "engine.located",
] as const;
export type LogbookAction = (typeof LOGBOOK_ACTIONS)[number];

export type LogbookOutcome = "done" | "failed";

export type LogbookActor = "you" | "bot" | "round";

/**
 * One line of the logbook: who did what to which thing, and how it ended.
 * It never holds message text, key values or anything else secret; `target` is a name,
 * or for a bot's action a short sentence made of names, such as
 * "Atlas signed in to https://app.example.com with key work-login".
 */
export interface LogbookEntry {
  id: string;
  time: string;
  /** Who acted: the person, a bot (which the target then names), or a round running on its own. */
  actor: LogbookActor;
  action: LogbookAction;
  target: string;
  outcome: LogbookOutcome;
}

/** How many of the newest entries are kept in memory for the Logbook screen. */
const KEPT_IN_MEMORY = 5_000;

/**
 * The logbook is append-only by construction: this class can add a line and read lines,
 * and has no way to change or remove one.
 */
export class LogbookStore {
  readonly #path: string;
  #entries: LogbookEntry[] = [];
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(dataRoot: string) {
    this.#path = join(dataRoot, "logbook.jsonl");
  }

  async initialize(): Promise<void> {
    let text = "";
    try {
      text = await readFile(this.#path, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const entries: LogbookEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as LogbookEntry);
      } catch {
        // A line cut short by a crash is skipped; the lines around it are still good.
      }
    }
    this.#entries = entries.slice(-KEPT_IN_MEMORY);
  }

  /** Adds one line. Resolves once it is on disk. */
  record(
    action: LogbookAction,
    target: string,
    outcome: LogbookOutcome = "done",
    actor: LogbookActor = "you",
  ): Promise<void> {
    const entry: LogbookEntry = {
      id: randomUUID(),
      time: new Date().toISOString(),
      actor,
      action,
      target,
      outcome,
    };
    this.#entries.push(entry);
    if (this.#entries.length > KEPT_IN_MEMORY) this.#entries.shift();
    const write = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      await appendFile(this.#path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
    });
    this.#writeQueue = write.catch(() => undefined);
    return write;
  }

  /** The newest entries first. */
  list(limit = 200): LogbookEntry[] {
    const count = Math.max(1, Math.min(limit, 1_000));
    return this.#entries.slice(-count).reverse();
  }

  get size(): number {
    return this.#entries.length;
  }
}
