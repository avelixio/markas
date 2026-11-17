import { FUEL_PERIODS, type FuelPeriod, type FuelReport } from "../shared/fuel";
import {
  type AccountUsage,
  type AgentProviderId,
  type AgentStatus,
  type BotSummary,
  providerOfModel,
} from "../shared/ipc";
import type { HostMethod } from "./methods";
import { isObject } from "./parsers";

export interface FuelContext {
  status: () => AgentStatus;
  /** The plan usage the engines report. Today only Codex reports one. */
  usage: () => Promise<AccountUsage>;
  bots: () => BotSummary[];
  /** Every turn a bot started since a moment. */
  turnsSince: (since: Date) => Array<{ botId: string; at: string }>;
  now?: () => Date;
}

const ENGINES: AgentProviderId[] = ["claude", "codex", "opencode"];

/** A day on this computer's clock, as YYYY-MM-DD. */
function localDay(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * The Fuel page: how much of each engine's plan is left, and which bots used the engines.
 * Markas only reads this; it bills nobody and guesses nothing an engine did not report.
 */
export function createFuelMethods(context: FuelContext): Record<string, HostMethod> {
  return {
    "fuel.read": async (input): Promise<FuelReport> => {
      const asked = isObject(input) ? input.days : input;
      const days: FuelPeriod = FUEL_PERIODS.includes(asked as FuelPeriod)
        ? (asked as FuelPeriod)
        : FUEL_PERIODS[0];
      const now = context.now?.() ?? new Date();
      // The period is whole days: today and the days before it.
      const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
      const bots = context.bots();
      const engineOf = (bot: BotSummary): AgentProviderId => providerOfModel(bot.model);

      const perDay = new Map<string, number>();
      for (let offset = 0; offset < days; offset += 1) {
        const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset);
        perDay.set(localDay(day), 0);
      }
      const perBot = new Map<string, number>();
      let totalTurns = 0;
      for (const turn of context.turnsSince(first)) {
        const day = localDay(new Date(turn.at));
        if (!perDay.has(day)) continue;
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
        perBot.set(turn.botId, (perBot.get(turn.botId) ?? 0) + 1);
        totalTurns += 1;
      }

      // A plan that cannot be read is reported as unknown, never as empty.
      const usage = await context.usage().catch(() => null);
      const providers = context.status().providers ?? [];
      return {
        days,
        engines: ENGINES.map((engine) => {
          const provider = providers.find((candidate) => candidate.id === engine);
          return {
            engine,
            state: provider?.state ?? "not-started",
            email: provider?.email ?? null,
            limits: engine === "codex" && usage && usage.limits.length > 0 ? usage.limits : null,
            bots: bots.filter((bot) => engineOf(bot) === engine).length,
          };
        }),
        perDay: [...perDay].map(([day, turns]) => ({ day, turns })),
        perBot: [...perBot]
          .map(([botId, turns]) => {
            const bot = bots.find((candidate) => candidate.id === botId);
            // A bot that was deleted since still took its turns; it is not shown by a stale name.
            return bot ? { botId, name: bot.name, engine: engineOf(bot), turns } : null;
          })
          .filter((row): row is NonNullable<typeof row> => row !== null)
          .sort((left, right) => right.turns - left.turns || left.name.localeCompare(right.name)),
        totalTurns,
      };
    },
  };
}
