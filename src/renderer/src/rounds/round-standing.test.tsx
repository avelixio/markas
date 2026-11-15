import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotSummary } from "../../../shared/ipc";
import { setLanguage, t } from "../i18n";
import { RoundDialog } from "./RoundDialog";
import type { RoundDraft, RoundSummary } from "./rounds-client";

const bots = [{ id: "atlas", name: "Atlas" }] as BotSummary[];

const round = (overrides: Partial<RoundSummary> = {}): RoundSummary => ({
  id: "r1",
  name: "Morning stock check",
  botId: "atlas",
  instruction: "Check stock levels.",
  schedule: { kind: "daily", times: ["09:00"], weekdays: [1, 2, 3, 4, 5] },
  overlap: "wait",
  enabled: true,
  createdAt: "2026-11-10T02:00:00.000Z",
  nextRunAt: null,
  lastRun: null,
  standing: [
    {
      type: "site",
      origin: "https://reports.example.com",
      level: "ask",
      grantedAt: "2026-11-10T02:00:00.000Z",
    },
  ],
  standingApplies: true,
  ...overrides,
});

function open(existing: RoundSummary | null) {
  const saved: RoundDraft[] = [];
  const onSave = vi.fn(async (draft: RoundDraft) => {
    saved.push(draft);
  });
  render(() => <RoundDialog existing={existing} bots={bots} onSave={onSave} onClose={() => {}} />);
  const save = () => fireEvent.click(screen.getByRole("button", { name: t("rounds.form.save") }));
  return { saved, save };
}

const add = (kind: string, target: string) => {
  fireEvent.change(screen.getByLabelText(t("rounds.standing.kind")), { target: { value: kind } });
  fireEvent.input(screen.getByLabelText(t("rounds.standing.what")), { target: { value: target } });
  fireEvent.click(screen.getByRole("button", { name: t("rounds.standing.add") }));
};

beforeEach(() => setLanguage("en"));

describe("a round's standing permissions", () => {
  it("starts with none, and says the round then asks every time", () => {
    open(null);
    expect(screen.getByText(t("rounds.standing.none"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("rounds.standing.add") })).toBeDisabled();
  });

  it("sends the named things the person added, once each", async () => {
    const { saved, save } = open(null);
    fireEvent.input(screen.getByLabelText(t("rounds.form.name")), { target: { value: "Recap" } });
    fireEvent.input(screen.getByLabelText(/^What the bot should do/), {
      target: { value: "Summarise the day." },
    });
    add("read-folder", "  /work/reports  ");
    add("tool", "WebSearch");
    add("tool", "WebSearch");
    expect(screen.getAllByText("WebSearch")).toHaveLength(1);
    save();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.standing).toEqual([
      { type: "read-folder", path: "/work/reports" },
      { type: "tool", name: "WebSearch" },
    ]);
  });

  it("shows what a round already holds, and sends nothing when it was not touched", async () => {
    const { saved, save } = open(round());
    expect(screen.getByText("https://reports.example.com")).toBeInTheDocument();
    save();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).not.toHaveProperty("standing");
  });

  it("takes a permission away when the person removes it", async () => {
    const { saved, save } = open(round());
    fireEvent.click(
      screen.getByRole("button", {
        name: t("rounds.standing.remove", { what: "https://reports.example.com" }),
      }),
    );
    expect(screen.getByText(t("rounds.standing.none"))).toBeInTheDocument();
    save();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.standing).toEqual([]);
  });

  it("adds with Enter without saving the round", () => {
    const { saved } = open(null);
    const what = screen.getByLabelText(t("rounds.standing.what"));
    fireEvent.input(what, { target: { value: "https://reports.example.com" } });
    fireEvent.keyDown(what, { key: "Enter" });
    expect(screen.getByText("https://reports.example.com")).toBeInTheDocument();
    expect(saved).toEqual([]);
  });

  it("says so when the bot's engine cannot use them yet", () => {
    open(round({ standingApplies: false }));
    expect(screen.getByText(t("rounds.standing.engine"))).toBeInTheDocument();
  });
});
