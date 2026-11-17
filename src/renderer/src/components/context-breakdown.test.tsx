import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContextBreakdown } from "../../../shared/ipc";
import { setLanguage, t } from "../i18n";
import { ContextBreakdown, formatTokens } from "./ContextBreakdown";

const reading = (overrides: Partial<BotContextBreakdown> = {}): BotContextBreakdown => ({
  botId: "atlas",
  usedTokens: 474_200,
  maxTokens: 1_000_000,
  model: "claude-fable-5",
  categories: [
    { name: "Messages", tokens: 330_700 },
    { name: "System tools", tokens: 22_600 },
  ],
  notLoaded: [{ name: "MCP tools (deferred)", tokens: 465_000 }],
  autoCompactAt: 967_000,
  ...overrides,
});

let answer: unknown;
let asked = 0;

beforeEach(() => {
  asked = 0;
  setLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      asked += 1;
      if (answer instanceof Error) {
        return new Response(JSON.stringify({ error: answer.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ result: answer ?? null }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ContextBreakdown", () => {
  it("shows how full the context is and what takes the room", async () => {
    answer = reading();
    render(() => <ContextBreakdown botId="atlas" />);
    expect(await screen.findByText(t("context.used", { percent: 47 }))).toBeInTheDocument();
    expect(screen.getByText("474.2k / 1M")).toBeInTheDocument();
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByText("330.7k")).toBeInTheDocument();
    expect(screen.getByText("33.1%")).toBeInTheDocument();
    expect(screen.getByText(t("context.free"))).toBeInTheDocument();
    // What is known but not loaded is listed apart, because it takes no room yet.
    expect(screen.getByText(t("context.notLoaded"))).toBeInTheDocument();
    expect(screen.getByText("MCP tools (deferred)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "47");
  });

  it("says so when the engine reports only the total", async () => {
    answer = reading({ categories: [], notLoaded: [], autoCompactAt: null, model: null });
    render(() => <ContextBreakdown botId="atlas" />);
    expect(await screen.findByText(t("context.totalOnly"))).toBeInTheDocument();
    expect(screen.getByText(t("context.used", { percent: 47 }))).toBeInTheDocument();
  });

  it("says there is no reading yet, and reads again when asked", async () => {
    answer = null;
    render(() => <ContextBreakdown botId="atlas" />);
    expect(await screen.findByText(t("context.none"))).toBeInTheDocument();

    answer = reading();
    fireEvent.click(screen.getByRole("button", { name: t("context.refresh") }));
    expect(await screen.findByText(t("context.used", { percent: 47 }))).toBeInTheDocument();
    await waitFor(() => expect(asked).toBe(2));
  });

  it("writes token counts the short way", () => {
    expect(formatTokens(753)).toBe("753");
    expect(formatTokens(22_600)).toBe("22.6k");
    expect(formatTokens(1_000_000)).toBe("1M");
  });
});
