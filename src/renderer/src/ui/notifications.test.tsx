import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, t, tCount } from "../i18n";
import {
  type CrewNotice,
  markNoticesRead,
  openBotRequest,
  setCrewNotices,
  shownNotices,
} from "./crew-signal";
import { Shell } from "./Shell";

const notice = (overrides: Partial<CrewNotice>): CrewNotice => ({
  key: "finished:nova:1",
  botId: "nova",
  botName: "Nova",
  kind: "finished",
  detail: "",
  ...overrides,
});

const HANDOFF = notice({
  key: "handoff:tab-1:t0",
  botId: "juno",
  botName: "Juno",
  kind: "handoff",
  detail: "The site asked for a code sent to your phone.",
  tabId: "tab-1",
});
const FAILED = notice({
  key: "failed:d9",
  botId: "mika",
  botName: "Mika",
  kind: "failed",
  detail: "The engine stopped.",
});

let calls: Array<{ method: string; input: unknown }>;

beforeEach(() => {
  calls = [];
  setLanguage("en");
  setCrewNotices([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: url.replace("/api/", ""),
        input: (JSON.parse(String(init.body)) as { input: unknown }).input,
      });
      return new Response(JSON.stringify({ result: [] }), { status: 200 });
    }),
  );
});

afterEach(() => {
  setCrewNotices([]);
  vi.unstubAllGlobals();
});

function openList() {
  render(() => <Shell chats={<p>chat area</p>} />);
  const count = shownNotices().length;
  const name = count > 0 ? tCount("notices.bell", count) : t("notices.bell.none");
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("region", { name: t("notices.title") });
}

describe("notifications", () => {
  it("says so when nothing needs the person", () => {
    const list = openList();
    expect(within(list).getByText(t("notices.empty"))).toBeInTheDocument();
    expect(
      within(list).queryByRole("button", { name: t("notices.markRead") }),
    ).not.toBeInTheDocument();
  });

  it("lists what waits on the person before the news", () => {
    setCrewNotices([notice({}), FAILED, HANDOFF]);
    const list = openList();
    const names = within(list)
      .getAllByRole("listitem")
      .map((item) => item.querySelector("strong")?.firstChild?.textContent);
    expect(names[0]).toBe("Juno");
    expect(within(list).getByText(t("notices.handoff"))).toBeInTheDocument();
    expect(within(list).getByText("The engine stopped.")).toBeInTheDocument();
  });

  it("marks the news read, and keeps what still waits on the person", () => {
    setCrewNotices([notice({}), FAILED, HANDOFF]);
    const list = openList();
    fireEvent.click(within(list).getByRole("button", { name: t("notices.markRead") }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Juno")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tCount("notices.bell", 1) })).toBeInTheDocument();
  });

  it("shows a thing again when it happens again after being marked read", () => {
    setCrewNotices([notice({})]);
    markNoticesRead();
    expect(shownNotices()).toEqual([]);
    // The bot answered once more: a new notice, not the one that was read.
    setCrewNotices([notice({ key: "finished:nova:2" })]);
    expect(shownNotices()).toHaveLength(1);
    // And the read one, once gone, is forgotten rather than remembered for ever.
    setCrewNotices([]);
    setCrewNotices([notice({})]);
    expect(shownNotices()).toHaveLength(1);
  });

  it("opens the bot's chat from a notice, from any area", () => {
    setCrewNotices([HANDOFF]);
    render(() => <Shell chats={<p>chat area</p>} />);
    fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
    fireEvent.click(screen.getByRole("button", { name: tCount("notices.bell", 1) }));
    fireEvent.click(screen.getByRole("button", { name: t("notices.review") }));
    expect(openBotRequest()?.botId).toBe("juno");
    expect(screen.getByText("chat area")).toBeVisible();
    expect(screen.queryByRole("region", { name: t("notices.title") })).not.toBeInTheDocument();
  });

  it("opens the bot's browser for a hand-off, and closes with Escape", async () => {
    setCrewNotices([HANDOFF]);
    const list = openList();
    fireEvent.click(within(list).getByRole("button", { name: t("notices.openBrowser") }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({ method: "browser.bringToFront", input: "tab-1" }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: t("notices.title") })).not.toBeInTheDocument();
  });
});
