import type { AgentService, RoundActivity } from "../backend/agent-service";
import type { LogbookStore } from "../backend/logbook/logbook-store";
import {
  type OverlapPolicy,
  type Round,
  type RoundInput,
  type RoundRun,
  type RoundsStore,
  type RunWait,
  waitingOn,
} from "../backend/rounds/rounds-store";
import type { RoundsScheduler } from "../backend/rounds/scheduler";
import { describeStanding } from "../backend/rounds/standing";
import type { AccessLevel } from "../shared/access";
import type { AgentEvent } from "../shared/ipc";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";

/** A round as the interface lists it: the stored round plus when it runs next and how it last went. */
export interface RoundSummary extends Round {
  nextRunAt: string | null;
  lastRun: RoundRun | null;
  /** What the newest run is stopped at right now, or null when it is not waiting on the person. */
  waitingOn: RunWait | null;
  /**
   * False when the round's bot runs on an engine that cannot honour standing permissions yet.
   * Such a round keeps them, but every run still asks.
   */
  standingApplies: boolean;
}

/** What the round form needs to know about a round's bot. */
export interface RoundBot {
  access: AccessLevel;
  engine: "claude" | "codex";
}

export function createRoundsMethods(
  store: RoundsStore,
  scheduler: RoundsScheduler,
  findBot: (botId: string) => RoundBot | null,
  /** True for a bot that is deleted but can still be put back. Its rounds are not listed. */
  botAway: (botId: string) => boolean = () => false,
): Record<string, HostMethod> {
  const summary = (round: Round): RoundSummary => {
    const lastRun = store.lastRun(round.id);
    return {
      ...round,
      nextRunAt: store.nextRunAt(round, new Date()),
      lastRun,
      waitingOn: lastRun ? waitingOn(lastRun) : null,
      standingApplies: findBot(round.botId)?.engine === "claude",
    };
  };
  const requireBot = (botId: string): RoundBot => {
    const bot = findBot(botId);
    if (!bot) throw new Error("Choose a bot that exists.");
    return bot;
  };

  return {
    "rounds.list": () =>
      store
        .list()
        .filter((round) => !botAway(round.botId))
        .map(summary),
    "rounds.create": async (input) => {
      const fields = parseFields(input);
      // A missing bot is reported by the store, in the same words as the other fields.
      const level = fields.botId ? requireBot(fields.botId).access : undefined;
      return summary(await store.create(fields as RoundInput, new Date(), level));
    },
    "rounds.update": async (input) => {
      if (!isObject(input)) throw new Error("Invalid round.");
      const fields = parseFields(input);
      const id = requireString(input.id, "id");
      // New standing permissions are stamped with the level of the bot the round will have.
      const level = requireBot(fields.botId ?? store.get(id).botId).access;
      return summary(await store.update(id, fields, new Date(), level));
    },
    "rounds.remove": (id) => store.remove(requireString(id, "id")),
    "rounds.runNow": (id) => scheduler.runNow(requireString(id, "id")),
    "rounds.runs": (input) => {
      const roundId =
        isObject(input) && typeof input.roundId === "string" ? input.roundId : undefined;
      const limit = isObject(input) && typeof input.limit === "number" ? input.limit : undefined;
      return store.runs(roundId, limit);
    },
  };
}

/**
 * Keeps rounds in step with what the bots do.
 * A round's turn gets that round's standing permissions; each use goes in the Logbook; a
 * run that stops at a card says so in its history; and standing permissions given at a
 * higher access level are dropped when the bot is set lower.
 */
export function followRounds(
  service: Pick<AgentService, "on" | "setStandingSource">,
  store: RoundsStore,
  logbook: LogbookStore,
): void {
  // The permissions are read when the turn starts, so a change made after the run was
  // queued still counts.
  service.setStandingSource((roundId) => {
    try {
      return store.get(roundId).standing;
    } catch {
      return [];
    }
  });

  let work: Promise<unknown> = Promise.resolve();
  const inOrder = (task: () => Promise<unknown>) => {
    work = work.then(task).catch((error) => {
      console.error("A round's activity could not be recorded:", error);
    });
  };
  const roundName = (roundId: string) =>
    store.list().find((round) => round.id === roundId)?.name ?? roundId;

  service.on("round", (activity: RoundActivity) => {
    inOrder(async () => {
      switch (activity.type) {
        case "standing-used":
          await logbook.record(
            "round.standing-used",
            `${roundName(activity.roundId)}: ${describeStanding(activity.grant)}`,
            "done",
            "round",
          );
          return;
        case "waiting":
          await store.noteWaiting(activity.deliveryId, {
            requestId: activity.requestId,
            kind: activity.kind,
            detail: activity.detail,
          });
          return;
        case "answered":
          await store.noteAnswered(activity.deliveryId, activity.requestId, activity.allowed);
          return;
      }
    });
  });

  service.on("event", (event: AgentEvent) => {
    if (event.type !== "bots-changed") return;
    const levels = event.bots.map((bot) => ({ id: bot.id, access: bot.access }));
    inOrder(async () => {
      for (const bot of levels) {
        for (const { round, dropped } of await store.dropStandingAbove(bot.id, bot.access)) {
          await logbook.record(
            "round.standing-dropped",
            `${round.name}: ${dropped.map(describeStanding).join("; ")}`,
          );
        }
      }
    });
  });
}

function parseFields(value: unknown): Partial<RoundInput> {
  if (!isObject(value)) throw new Error("Invalid round.");
  const fields: Partial<RoundInput> = {};
  for (const key of ["name", "botId", "instruction"] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string") throw new Error(`${key} must be text.`);
    fields[key] = value[key];
  }
  if (value.schedule !== undefined) fields.schedule = value.schedule;
  if (value.overlap !== undefined) fields.overlap = value.overlap as OverlapPolicy;
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== "boolean") throw new Error("enabled must be true or false.");
    fields.enabled = value.enabled;
  }
  // The store checks the list itself; here it only has to be passed on.
  if (value.standing !== undefined) fields.standing = value.standing;
  return fields;
}
