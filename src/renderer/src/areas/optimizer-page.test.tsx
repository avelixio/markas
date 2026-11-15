import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptimizerReport } from "../../../shared/optimizer";
import { setLanguage, t, tCount } from "../i18n";
import { OptimizerPage, shortTokens } from "./OptimizerPage";

const report = (overrides: Partial<OptimizerReport> = {}): OptimizerReport => ({
  settings: { autoCompact: true, compactAt: 0.8, lean: false },
  since: "2026-11-13T00:00:00.000Z",
  totals: { compact: { events: 2, tokens: 240_000 }, trim: { events: 1, tokens: 2_500 } },
  measuredTokens: 240_000,
  estimatedTokens: 2_500,
  perBot: [{ botId: "atlas", name: "Atlas", tokens: 240_000 }],
  recent: [
    { at: "2026-11-13T02:00:00.000Z", botId: "pico", kind: "trim", tokens: 2_500, botName: "Pico" },
    {
      at: "2026-11-13T01:00:00.000Z",
      botId: "gone",
      kind: "compact",
      tokens: 120_000,
      botName: "",
    },
  ],
  context: [
    {
      botId: "atlas",
      name: "Atlas",
      engine: "claude",
      usedTokens: 571_900,
      contextWindow: 1_000_000,
      compacting: false,
    },
    {
      botId: "pico",
      name: "Pico",
      engine: "codex",
      usedTokens: null,
      contextWindow: null,
      compacting: false,
    },
  ],
  commandFilter: { installed: false, version: null },
  ...overrides,
});

let calls: Array<{ method: string; input: unknown }>;
let current: OptimizerReport | Error;
let failSave: string | null;

beforeEach(() => {
  calls = [];
  current = report();
  failSave = null;
  setLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.replace("/api/", "");
      const input = (JSON.parse(String(init.body)) as { input: unknown }).input;
      calls.push({ method, input });
      const respond = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status });
      if (method === "optimizer.save") {
        if (failSave) return respond(400, { error: failSave });
        const settings = { ...(current as OptimizerReport).settings, ...(input as object) };
        return respond(200, { result: settings });
      }
      if (current instanceof Error) return respond(500, { error: current.message });
      return respond(200, { result: current });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OptimizerPage", () => {
  it("writes token counts short enough to read at a glance", () => {
    expect(shortTokens(571_900)).toBe("571.9k");
    expect(shortTokens(1_000_000)).toBe("1M");
    expect(shortTokens(840)).toBe("840");
  });

  it("shows the total saved, and keeps counted and worked-out savings apart", async () => {
    render(() => <OptimizerPage />);
    const total = await screen.findByRole("region", { name: t("optimizer.total.label") });
    expect(within(total).getByText("242,500")).toBeInTheDocument();
    expect(
      within(total).getByText(
        t("optimizer.total.split", { measured: "240,000", estimated: "2,500" }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${tCount("optimizer.compact.events", 2)} · ${t("optimizer.tokens", { tokens: "240,000" })}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("optimizer.lean.notCounted"))).toBeInTheDocument();
    expect(screen.getByText(t("optimizer.filter.missing"))).toBeInTheDocument();
  });

  it("shows how full each conversation is, and says when an engine has not reported yet", async () => {
    render(() => <OptimizerPage />);
    expect(
      await screen.findByText(
        t("optimizer.context.used", { percent: 57, used: "571.9k", window: "1M" }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: t("optimizer.context.label", { name: "Atlas" }) }),
    ).toHaveAttribute("aria-valuenow", "57");
    expect(screen.getByText(t("optimizer.context.unknown"))).toBeInTheDocument();
  });

  it("lists the latest savings, marking worked-out ones and deleted bots", async () => {
    render(() => <OptimizerPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("~2,500")).toBeInTheDocument();
    expect(within(table).getByText("120,000")).toBeInTheDocument();
    expect(within(table).getByText(t("optimizer.recent.goneBot"))).toBeInTheDocument();
  });

  it("saves a switch and the fold point as they are changed", async () => {
    render(() => <OptimizerPage />);
    const lean = await screen.findByRole("switch", { name: t("optimizer.lean.title") });
    expect(lean).toHaveAttribute("aria-checked", "false");
    fireEvent.click(lean);
    await vi.waitFor(() => expect(lean).toHaveAttribute("aria-checked", "true"));
    expect(calls.at(-1)).toEqual({ method: "optimizer.save", input: { lean: true } });

    fireEvent.change(screen.getByLabelText(t("optimizer.compact.at")), { target: { value: "70" } });
    await vi.waitFor(() =>
      expect(calls.at(-1)).toEqual({ method: "optimizer.save", input: { compactAt: 0.7 } }),
    );
  });

  it("says so when a setting could not be saved, and leaves it as it was", async () => {
    failSave = "The settings file cannot be written.";
    render(() => <OptimizerPage />);
    const compact = await screen.findByRole("switch", { name: t("optimizer.compact.title") });
    fireEvent.click(compact);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The settings file cannot be written.",
    );
    expect(compact).toHaveAttribute("aria-checked", "true");
  });

  it("says nothing was saved yet on a fresh computer, and lets the person ask again after a failure", async () => {
    current = new Error("The host is busy.");
    render(() => <OptimizerPage />);
    expect(await screen.findByText("The host is busy.")).toBeInTheDocument();
    current = report({
      totals: { compact: { events: 0, tokens: 0 }, trim: { events: 0, tokens: 0 } },
      measuredTokens: 0,
      estimatedTokens: 0,
      recent: [],
      context: [],
    });
    fireEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(await screen.findByText(t("optimizer.recent.empty"))).toBeInTheDocument();
    expect(screen.getByText(t("optimizer.context.empty.title"))).toBeInTheDocument();
  });
});
