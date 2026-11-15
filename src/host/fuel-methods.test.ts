// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FuelReport } from "../shared/fuel";
import type { AccountUsage, AgentStatus, BotSummary } from "../shared/ipc";
import { createFuelMethods, type FuelContext } from "./fuel-methods";

const bot = (id: string, name: string, model: string) => ({ id, name, model }) as BotSummary;

const status = (providers: AgentStatus["providers"]) => ({ providers }) as AgentStatus;

/** Noon on a local day, so the day never shifts with the time zone. */
const at = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).toISOString();

function read(overrides: Partial<FuelContext> = {}, input?: unknown): Promise<FuelReport> {
  const methods = createFuelMethods({
    status: () =>
      status([
        {
          id: "claude",
          state: "available",
          version: "2.1.0",
          message: null,
          email: "sol@example.com",
        },
        { id: "codex", state: "sign-in-required", version: null, message: null },
      ]),
    usage: async (): Promise<AccountUsage> => ({ limits: [] }),
    bots: () => [bot("atlas", "Atlas", "claude-fable-5"), bot("pico", "Pico", "gpt-5.6-luna")],
    turnsSince: () => [],
    now: () => new Date(2026, 10, 13, 15),
    ...overrides,
  });
  return Promise.resolve(methods["fuel.read"]?.(input) as Promise<FuelReport>);
}

describe("fuel.read", () => {
  it("covers whole days up to today, with a zero for every quiet day", async () => {
    const report = await read();
    expect(report.days).toBe(7);
    expect(report.perDay.map((day) => day.day)).toEqual([
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
    ]);
    expect(report.totalTurns).toBe(0);
    expect(report.perBot).toEqual([]);
    expect((await read({}, { days: 30 })).perDay).toHaveLength(30);
    // Anything but a known period falls back to the shortest.
    expect((await read({}, { days: 365 })).days).toBe(7);
  });

  it("counts turns per day and per bot, busiest bot first", async () => {
    const asked: Date[] = [];
    const report = await read({
      turnsSince: (since) => {
        asked.push(since);
        return [
          { botId: "pico", at: at(2026, 11, 12) },
          { botId: "atlas", at: at(2026, 11, 12) },
          { botId: "atlas", at: at(2026, 11, 13, 9) },
          // A bot that was deleted since still counts toward the day, but has no row.
          { botId: "gone", at: at(2026, 11, 13, 10) },
        ];
      },
    });
    expect(asked[0]).toEqual(new Date(2026, 10, 7));
    expect(report.totalTurns).toBe(4);
    expect(report.perDay.slice(-2)).toEqual([
      { day: "2026-11-12", turns: 2 },
      { day: "2026-11-13", turns: 2 },
    ]);
    expect(report.perBot).toEqual([
      { botId: "atlas", name: "Atlas", engine: "claude", turns: 2 },
      { botId: "pico", name: "Pico", engine: "codex", turns: 1 },
    ]);
  });

  it("reports each engine's state, and its plan only when the engine gave one", async () => {
    const limits = [
      {
        id: "codex",
        primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: null },
        secondary: null,
      },
    ];
    const report = await read({ usage: async () => ({ limits }) });
    expect(report.engines).toEqual([
      { engine: "claude", state: "available", email: "sol@example.com", limits: null, bots: 1 },
      { engine: "codex", state: "sign-in-required", email: null, limits, bots: 1 },
    ]);
  });

  it("calls a plan that cannot be read unknown, not empty", async () => {
    const report = await read({
      usage: async () => {
        throw new Error("The engine did not answer.");
      },
      status: () => status(undefined),
    });
    expect(report.engines.map((engine) => [engine.state, engine.limits])).toEqual([
      ["not-started", null],
      ["not-started", null],
    ]);
  });
});
