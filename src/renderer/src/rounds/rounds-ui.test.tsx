import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArchivePage, LogbookPage } from "../areas/AreaPages";
import { setLanguage } from "../i18n";
import { Shell } from "../ui/Shell";
import { describeSchedule, RoundsPage } from "./RoundsPage";
import type { RoundRun, RoundSummary } from "./rounds-client";

const run = (overrides: Partial<RoundRun>): RoundRun => ({
  id: "run1",
  roundId: "r1",
  scheduledFor: "2026-11-11T02:00:00.000Z",
  startedAt: "2026-11-11T02:00:00.000Z",
  finishedAt: "2026-11-11T02:01:00.000Z",
  status: "completed",
  detail: "",
  manual: false,
  ...overrides,
});

const round = (overrides: Partial<RoundSummary>): RoundSummary => ({
  id: "r1",
  name: "Morning stock check",
  botId: "atlas",
  instruction: "Check stock levels and report anything low.",
  schedule: { kind: "daily", times: ["09:00"], weekdays: [0, 1, 2, 3, 4, 5, 6] },
  overlap: "wait",
  enabled: true,
  createdAt: "2026-11-10T02:00:00.000Z",
  nextRunAt: "2026-11-12T02:00:00.000Z",
  lastRun: null,
  ...overrides,
});

let rounds: RoundSummary[];
let runs: RoundRun[];
let results: Record<string, unknown>;
let calls: Array<{ method: string; input: unknown }>;
let failNext: string | null;
let bots: Array<Record<string, string>>;

beforeEach(() => {
  rounds = [];
  runs = [];
  results = {};
  calls = [];
  failNext = null;
  bots = [{ id: "atlas", name: "Atlas", avatarShape: "pebble", avatarColor: "green" }];
  setLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.replace("/api/", "");
      const input = (JSON.parse(String(init.body)) as { input: unknown }).input;
      calls.push({ method, input });
      const respond = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status });
      if (failNext) {
        const message = failNext;
        failNext = null;
        return respond(400, { error: message });
      }
      if (method === "rounds.list") return respond(200, { result: rounds });
      if (method === "rounds.runs") return respond(200, { result: runs });
      if (method === "rounds.create") {
        const created = round({ id: "new", ...(input as Partial<RoundSummary>) });
        rounds = [...rounds, created];
        return respond(200, { result: created });
      }
      if (method === "rounds.update") {
        const patch = input as Partial<RoundSummary> & { id: string };
        rounds = rounds.map((item) => (item.id === patch.id ? { ...item, ...patch } : item));
        return respond(200, { result: rounds.find((item) => item.id === patch.id) });
      }
      if (method === "rounds.remove") {
        rounds = rounds.filter((item) => item.id !== input);
        return respond(200, { result: null });
      }
      if (method === "rounds.runNow") return respond(200, { result: run({ manual: true }) });
      if (method in results) return respond(200, { result: results[method] });
      return respond(404, { error: "Unknown method" });
    }),
  );
  window.markas = {
    agent: { listBots: async () => bots, openAttachment: vi.fn(async () => undefined) },
  } as unknown as typeof window.markas;
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLanguage("en");
});

describe("RoundsPage", () => {
  it("invites a first round", async () => {
    render(() => <RoundsPage />);
    expect(await screen.findByText("No rounds yet")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "New round" })[0]).toBeEnabled(),
    );
  });

  it("cannot add a round without a bot", async () => {
    bots = [];
    render(() => <RoundsPage />);
    expect(await screen.findByText(/Create a bot in Chats first/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "New round" })) {
      expect(button).toBeDisabled();
    }
  });

  it("adds a round with the bot, instruction and schedule that were chosen", async () => {
    render(() => <RoundsPage />);
    await screen.findByText("No rounds yet");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "New round" })[0]).toBeEnabled(),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "New round" })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.input(within(dialog).getByLabelText("Name"), { target: { value: "Evening recap" } });
    fireEvent.input(within(dialog).getByLabelText(/^What the bot should do/), {
      target: { value: "Summarise the day." },
    });
    fireEvent.input(within(dialog).getByLabelText("Time 1"), { target: { value: "18:30" } });
    fireEvent.click(within(dialog).getByLabelText("Skip this run"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save round" }));

    expect(await screen.findByRole("button", { name: "Evening recap" })).toBeInTheDocument();
    expect(calls.find((call) => call.method === "rounds.create")?.input).toEqual({
      name: "Evening recap",
      botId: "atlas",
      instruction: "Summarise the day.",
      schedule: { kind: "daily", times: ["18:30"], weekdays: [1, 2, 3, 4, 5] },
      overlap: "skip",
    });
  });

  it("keeps the form open and says why when the host refuses the round", async () => {
    render(() => <RoundsPage />);
    await screen.findByText("No rounds yet");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "New round" })[0]).toBeEnabled(),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "New round" })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.input(within(dialog).getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.input(within(dialog).getByLabelText(/^What the bot should do/), {
      target: { value: "y" },
    });
    fireEvent.click(within(dialog).getByLabelText("Repeating"));
    fireEvent.input(within(dialog).getByLabelText(/^Every how many minutes/), {
      target: { value: "30" },
    });
    failNext = "A repeating round runs at most every 5 minutes.";
    fireEvent.click(within(dialog).getByRole("button", { name: "Save round" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("at most every 5 minutes");
    expect(calls.at(-1)?.input).toMatchObject({ schedule: { kind: "interval", everyMinutes: 30 } });
  });

  it("lists rounds with their last run, and shows the history of one", async () => {
    rounds = [round({ lastRun: run({ status: "missed", detail: "Markas was not running." }) })];
    runs = [run({ status: "missed", detail: "Markas was not running." }), run({ id: "run0" })];
    render(() => <RoundsPage />);
    const row = (await screen.findByRole("button", { name: "Morning stock check" })).closest("tr");
    expect(within(row as HTMLElement).getByText("Missed")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Every day at 09:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Morning stock check" }));
    const history = await screen.findByRole("region", { name: "Run history" });
    expect(await within(history).findByText("Markas was not running.")).toBeInTheDocument();
    expect(within(history).getByText("Completed")).toBeInTheDocument();
  });

  it("runs now, pauses and removes a round", async () => {
    rounds = [round({})];
    render(() => <RoundsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Run Morning stock check now" }));
    await waitFor(() => expect(calls.some((call) => call.method === "rounds.runNow")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Pause Morning stock check" }));
    expect(
      await screen.findByRole("button", { name: "Resume Morning stock check" }),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === "rounds.update")?.input).toEqual({
      id: "r1",
      enabled: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Morning stock check" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove round" }));
    expect(await screen.findByText("No rounds yet")).toBeInTheDocument();
  });

  it("shows a failed action instead of hiding it", async () => {
    rounds = [round({})];
    render(() => <RoundsPage />);
    const button = await screen.findByRole("button", { name: "Run Morning stock check now" });
    failNext = "That round no longer exists.";
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer exists");
  });

  it("shows the coming week, without rounds that are paused", async () => {
    rounds = [round({}), round({ id: "r2", name: "Paused one", enabled: false, nextRunAt: null })];
    render(() => <RoundsPage />);
    fireEvent.click(await screen.findByLabelText("Next 7 days"));
    const calendar = document.querySelector('[data-slot="calendar"]') as HTMLElement;
    expect(within(calendar).getAllByText("Morning stock check").length).toBeGreaterThanOrEqual(6);
    expect(within(calendar).queryByText("Paused one")).not.toBeInTheDocument();
  });

  it("describes schedules in words, in both languages", () => {
    expect(describeSchedule({ kind: "interval", everyMinutes: 30 })).toBe("Every 30 minutes");
    expect(describeSchedule({ kind: "daily", times: ["09:00", "17:00"], weekdays: [3, 1] })).toBe(
      "Mon, Wed at 09:00, 17:00",
    );
    expect(describeSchedule({ kind: "once", at: "2026-11-11T02:00:00.000Z" })).toMatch(/^Once, /);
    setLanguage("id");
    expect(describeSchedule({ kind: "interval", everyMinutes: 30 })).toBe("Setiap 30 menit");
  });
});

describe("ArchivePage", () => {
  it("says so when there are no files", async () => {
    results["archive.list"] = [];
    render(() => <ArchivePage />);
    expect(await screen.findByText("No files yet")).toBeInTheDocument();
  });

  it("lists files with who sent them and to whom, and opens one", async () => {
    results["archive.list"] = [
      {
        id: "a1",
        name: "stock.csv",
        size: 2048,
        from: null,
        sentTo: ["atlas"],
        addedAt: "2026-11-11T02:00:00.000Z",
      },
    ];
    render(() => <ArchivePage />);
    const row = (await screen.findByText("stock.csv")).closest("tr") as HTMLElement;
    expect(within(row).getByText("You")).toBeInTheDocument();
    expect(await within(row).findByText("Atlas")).toBeInTheDocument();
    expect(within(row).getByText("2 KB")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Open stock.csv" }));
    expect(window.markas.agent.openAttachment).toHaveBeenCalledWith({
      attachmentId: "a1",
      action: "open",
    });
  });

  it("says why a file could not be opened", async () => {
    results["archive.list"] = [
      {
        id: "a1",
        name: "stock.csv",
        size: 2048,
        from: null,
        sentTo: [],
        addedAt: "2026-11-11T02:00:00.000Z",
      },
    ];
    vi.mocked(window.markas.agent.openAttachment).mockRejectedValueOnce(
      new Error("The file is no longer on this computer."),
    );
    render(() => <ArchivePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open stock.csv" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "stock.csv could not be opened. The file is no longer on this computer.",
    );
  });

  it("offers a retry when the list cannot be read", async () => {
    failNext = "disk is unhappy";
    render(() => <ArchivePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("disk is unhappy");
    results["archive.list"] = [];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No files yet")).toBeInTheDocument();
  });
});

describe("LogbookPage", () => {
  it("says so when nothing is recorded", async () => {
    results["logbook.list"] = [];
    render(() => <LogbookPage />);
    expect(await screen.findByText("Nothing recorded yet")).toBeInTheDocument();
  });

  it("lists who did what and how it ended, in the chosen language", async () => {
    results["logbook.list"] = [
      {
        id: "1",
        time: "2026-11-11T02:00:00.000Z",
        actor: "you",
        action: "round.created",
        target: "Morning stock check",
        outcome: "done",
      },
      {
        id: "2",
        time: "2026-11-11T01:00:00.000Z",
        actor: "you",
        action: "key.shown",
        target: "metrics",
        outcome: "failed",
      },
    ];
    render(() => <LogbookPage />);
    const row = (await screen.findByText("Morning stock check")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Added a round")).toBeInTheDocument();
    expect(within(row).getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    setLanguage("id");
    expect(await screen.findByText("Menambah ronde")).toBeInTheDocument();
  });
});

describe("areas", () => {
  it("has all eight areas on the rail and opens each", async () => {
    results["archive.list"] = [];
    results["logbook.list"] = [];
    results["setup.engineStatus"] = [];
    results["keyring.list"] = [];
    results["fuel.read"] = { days: 7, engines: [], perDay: [], perBot: [], totalTurns: 0 };
    render(() => <Shell chats={<p>chat area</p>} />);
    const areas = [
      "Chats",
      "Rounds",
      "Keyring",
      "Switchboard",
      "Fuel",
      "Archive",
      "Logbook",
      "Settings",
    ];
    for (const name of areas) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    for (const name of ["Rounds", "Switchboard", "Fuel", "Archive", "Logbook"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(await screen.findByRole("heading", { name, level: 1 })).toBeInTheDocument();
      expect(screen.getByText("chat area")).not.toBeVisible();
    }
  });
});
