import type { AccountUsageLimit, AgentProviderId, AgentProviderState } from "./ipc";

/** The periods the Fuel page can look back over, in days. */
export const FUEL_PERIODS = [7, 30] as const;
export type FuelPeriod = (typeof FUEL_PERIODS)[number];

/** One engine on the Fuel page. */
export interface FuelEngine {
  engine: AgentProviderId;
  state: AgentProviderState;
  /** The account the engine is signed in with, when it says. */
  email: string | null;
  /**
   * How much of the engine's plan is used, as the engine reports it.
   * Null when the engine does not tell Markas, which is different from "nothing used".
   */
  limits: AccountUsageLimit[] | null;
  /** How many bots run on this engine. */
  bots: number;
}

/** What the Fuel page shows: each engine's plan, and how many turns the bots took. */
export interface FuelReport {
  days: FuelPeriod;
  engines: FuelEngine[];
  /** One entry per day of the period, oldest first, as YYYY-MM-DD on this computer's clock. */
  perDay: Array<{ day: string; turns: number }>;
  /** Bots that took at least one turn in the period, busiest first. */
  perBot: Array<{ botId: string; name: string; engine: AgentProviderId; turns: number }>;
  totalTurns: number;
}
