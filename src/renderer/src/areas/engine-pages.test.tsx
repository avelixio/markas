import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FuelReport } from "../../../shared/fuel";
import { setLanguage, t, tCount } from "../i18n";
import { FuelPage, SwitchboardPage } from "./EnginePages";

let calls: Array<{ method: string; input: unknown }>;
/** What the host answers per method. An Error is thrown back as the host's refusal. */
let answers: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  answers = {};
  setLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.replace("/api/", "");
      calls.push({ method, input: (JSON.parse(String(init.body)) as { input: unknown }).input });
      const answer = answers[method];
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

const report = (overrides: Partial<FuelReport> = {}): FuelReport => ({
  days: 7,
  engines: [
    { engine: "claude", state: "available", email: "sol@example.com", limits: null, bots: 2 },
    {
      engine: "codex",
      state: "available",
      email: null,
      limits: [
        {
          id: "codex",
          primary: { usedPercent: 84.2, windowDurationMins: 300, resetsAt: 1_794_600_000 },
          secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
      bots: 1,
    },
  ],
  perDay: [
    { day: "2026-11-07", turns: 0 },
    { day: "2026-11-08", turns: 3 },
    { day: "2026-11-09", turns: 1 },
  ],
  perBot: [
    { botId: "atlas", name: "Atlas", engine: "claude", turns: 3 },
    { botId: "pico", name: "Pico", engine: "codex", turns: 1 },
  ],
  totalTurns: 4,
  ...overrides,
});

describe("FuelPage", () => {
  it("shows what each engine reports, and says so when an engine reports nothing", async () => {
    answers["fuel.read"] = report();
    render(() => <FuelPage />);
    expect(await screen.findByText(t("fuel.used", { percent: 84 }))).toBeInTheDocument();
    expect(screen.getByText(t("fuel.window.hours", { count: 5 }))).toBeInTheDocument();
    expect(screen.getByText(t("fuel.window.week"))).toBeInTheDocument();
    expect(screen.getByText(t("fuel.plan.unknown", { engine: "Claude Code" }))).toBeInTheDocument();
    expect(screen.getByText(/sol@example\.com/)).toBeInTheDocument();
  });

  it("lists the bots that took turns, with each one's share", async () => {
    answers["fuel.read"] = report();
    render(() => <FuelPage />);
    const row = (await screen.findByRole("rowheader", { name: "Atlas" })).closest("tr");
    expect(within(row as HTMLElement).getByText("75%")).toBeInTheDocument();
    expect(screen.getByText(tCount("fuel.turns.total", 4, { days: 7 }))).toBeInTheDocument();
  });

  it("asks the host again when the person chooses 30 days", async () => {
    answers["fuel.read"] = report();
    render(() => <FuelPage />);
    await screen.findByText(t("fuel.used", { percent: 84 }));
    fireEvent.click(screen.getByLabelText(t("fuel.period.days", { count: 30 })));
    await vi.waitFor(() => expect(calls.at(-1)?.input).toEqual({ days: 30 }));
  });

  it("says plainly when nothing was used, and when bots are held by a signed-out engine", async () => {
    answers["fuel.read"] = report({
      engines: [
        { engine: "claude", state: "available", email: null, limits: null, bots: 0 },
        { engine: "codex", state: "sign-in-required", email: null, limits: null, bots: 2 },
      ],
      perBot: [],
      totalTurns: 0,
    });
    render(() => <FuelPage />);
    expect(await screen.findByText(t("fuel.empty.title"))).toBeInTheDocument();
    expect(
      screen.getByText(tCount("fuel.engine.held", 2, { engine: "Codex" })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("fuel.state.signedOut"))).toBeInTheDocument();
  });

  it("lets the person ask again when the host cannot answer", async () => {
    answers["fuel.read"] = new Error("The host is busy.");
    render(() => <FuelPage />);
    expect(await screen.findByText("The host is busy.")).toBeInTheDocument();
    answers["fuel.read"] = report();
    fireEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(await screen.findByText(t("fuel.turns.title"))).toBeInTheDocument();
  });
});

describe("SwitchboardPage", () => {
  const engines = [
    {
      engine: "claude",
      state: "signed-in",
      version: "2.1.0",
      email: "sol@example.com",
      message: null,
      path: null,
    },
    {
      engine: "codex",
      state: "not-signed-in",
      version: "0.150.0",
      email: null,
      message: "Codex is installed but not signed in.",
      path: null,
    },
  ];
  const login = {
    id: "k1",
    name: "Metrics",
    kind: "login",
    origin: "https://metrics.example.com",
    username: "sol@example.com",
    variable: null,
    hasTwoStepCode: true,
    fillPolicy: "ask",
    sharedWith: ["atlas"],
    note: "",
    createdAt: "2026-11-11T02:00:00.000Z",
    updatedAt: "2026-11-11T02:00:00.000Z",
    lastUsedAt: null,
  };

  beforeEach(() => {
    answers["setup.engineStatus"] = engines;
    answers["keyring.list"] = [login, { ...login, id: "k2", name: "Token", kind: "token" }];
    answers["agent.listBots"] = [{ id: "atlas", name: "Atlas" }];
  });

  it("shows each engine's state and the saved logins with the bots that use them", async () => {
    render(() => <SwitchboardPage />);
    const claude = (await screen.findByRole("rowheader", { name: "Claude Code" })).closest("tr");
    expect(within(claude as HTMLElement).getByText("sol@example.com")).toBeInTheDocument();
    expect(
      within(claude as HTMLElement).getByText(t("switchboard.next.nothing")),
    ).toBeInTheDocument();

    const site = screen.getByRole("rowheader", { name: "https://metrics.example.com" });
    const row = site.closest("tr") as HTMLElement;
    expect(within(row).getByText("Atlas")).toBeInTheDocument();
    expect(within(row).getByText(t("switchboard.never"))).toBeInTheDocument();
    // Only logins belong here; a token is not a sign-in to a site.
    expect(screen.queryByText("Token")).not.toBeInTheDocument();
  });

  it("gives the command to sign an engine in again", async () => {
    answers["setup.signInCommand"] = { engine: "codex", command: "codex login" };
    render(() => <SwitchboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: t("switchboard.signIn") }));
    expect(await screen.findByText("codex login")).toBeInTheDocument();
    expect(calls.at(-1)).toEqual({ method: "setup.signInCommand", input: "codex" });
  });

  it("still shows the engines when the keyring cannot be opened", async () => {
    answers["keyring.list"] = new Error("The keyring could not be opened.");
    render(() => <SwitchboardPage />);
    expect(await screen.findByRole("rowheader", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByText(t("switchboard.logins.empty.title"))).toBeInTheDocument();
  });

  it("checks again when asked", async () => {
    render(() => <SwitchboardPage />);
    await screen.findByRole("rowheader", { name: "Codex" });
    const before = calls.filter((call) => call.method === "setup.engineStatus").length;
    fireEvent.click(screen.getByRole("button", { name: t("switchboard.check") }));
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.method === "setup.engineStatus").length).toBe(before + 1),
    );
  });
});
