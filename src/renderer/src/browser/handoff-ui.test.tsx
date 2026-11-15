import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserHandOff, BrowserTabView } from "../../../shared/ipc";
import { setLanguage, t } from "../i18n";
import { BrowserPreview, HandOffCard } from "./HandOff";

const handOff = (overrides: Partial<BrowserHandOff> = {}): BrowserHandOff => ({
  tabId: "tab-1",
  botId: "juno",
  threadId: null,
  reason: "The site asked for a code sent to your phone.",
  requestedBy: "bot",
  startedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  ...overrides,
});

const tabView = (overrides: Partial<BrowserTabView> = {}): BrowserTabView => ({
  tab: {
    id: "tab-1",
    title: "Admin console",
    url: "https://admin.example.com/",
    loading: false,
    ownerThreadId: null,
    ownerBotId: "juno",
  },
  controller: "bot",
  handOff: null,
  image: "data:image/jpeg;base64,AAAA",
  capturedAt: new Date().toISOString(),
  problem: null,
  ...overrides,
});

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

describe("HandOffCard", () => {
  it("says why the bot needs the person, and for how long it has waited", () => {
    render(() => <HandOffCard handOff={handOff()} botName="Juno" />);
    expect(screen.getByText(t("handoff.title.bot", { name: "Juno" }))).toBeInTheDocument();
    expect(screen.getByText(/The site asked for a code sent to your phone\./)).toBeInTheDocument();
    expect(screen.getByText(t("handoff.since", { minutes: 2 }))).toBeInTheDocument();
  });

  it("opens the bot's browser, and gives the tab back when the step is done", async () => {
    render(() => <HandOffCard handOff={handOff()} botName="Juno" />);
    fireEvent.click(screen.getByRole("button", { name: t("handoff.open", { name: "Juno" }) }));
    await waitFor(() =>
      expect(calls).toEqual([{ method: "browser.bringToFront", input: "tab-1" }]),
    );
    // The buttons rest while one of them is at work.
    const done = screen.getByRole("button", { name: t("handoff.done") });
    await waitFor(() => expect(done).toBeEnabled());

    fireEvent.click(done);
    await waitFor(() =>
      expect(calls[1]).toEqual({ method: "browser.resumeControl", input: { tabId: "tab-1" } }),
    );
  });

  it("tells the bot when the person skips the step", async () => {
    render(() => <HandOffCard handOff={handOff()} botName="Juno" />);
    fireEvent.click(screen.getByRole("button", { name: t("handoff.skip") }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: "browser.resumeControl",
      input: { tabId: "tab-1", note: expect.stringContaining("skip this step") },
    });
  });

  it("offers only to give the tab back when the person took it over", () => {
    render(() => <HandOffCard handOff={handOff({ requestedBy: "person" })} botName="Juno" />);
    expect(screen.getByText(t("handoff.title.person"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("handoff.giveBack", { name: "Juno" }) }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("handoff.skip") })).not.toBeInTheDocument();
  });

  it("says what went wrong when the browser cannot be opened, and stays usable", async () => {
    answers["browser.bringToFront"] = new Error("The browser window is closed.");
    render(() => <HandOffCard handOff={handOff()} botName="Juno" />);
    fireEvent.click(screen.getByRole("button", { name: t("handoff.open", { name: "Juno" }) }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The browser window is closed.");
    expect(screen.getByRole("button", { name: t("handoff.done") })).toBeEnabled();
  });
});

describe("BrowserPreview", () => {
  it("draws the bot's page and lets the person take the tab over", async () => {
    answers["browser.viewTab"] = tabView();
    render(() => <BrowserPreview tabId="tab-1" botName="Juno" />);
    expect(
      await screen.findByAltText(t("preview.alt", { title: "Admin console" })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("preview.driving", { name: "Juno" }))).toBeInTheDocument();

    answers["browser.viewTab"] = tabView({ controller: "person", handOff: handOff() });
    fireEvent.click(screen.getByRole("button", { name: t("preview.takeOver") }));
    expect(await screen.findByText(t("preview.waiting", { name: "Juno" }))).toBeInTheDocument();
    expect(calls.map((call) => call.method)).toContain("browser.takeControl");
    expect(screen.queryByRole("button", { name: t("preview.takeOver") })).not.toBeInTheDocument();
  });

  it("says so in plain words when the page has a problem", async () => {
    answers["browser.viewTab"] = tabView({ image: null, problem: "This page crashed." });
    render(() => <BrowserPreview tabId="tab-1" botName="Juno" />);
    expect(await screen.findByText("This page crashed.")).toBeInTheDocument();
  });

  it("lets the person ask again when the page cannot be looked at", async () => {
    answers["browser.viewTab"] = new Error("That tab is gone.");
    render(() => <BrowserPreview tabId="tab-1" botName="Juno" />);
    expect(await screen.findByText("That tab is gone.")).toBeInTheDocument();

    answers["browser.viewTab"] = tabView();
    fireEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(
      await screen.findByAltText(t("preview.alt", { title: "Admin console" })),
    ).toBeInTheDocument();
  });
});
