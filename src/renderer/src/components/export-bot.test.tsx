import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLanguage, t } from "../i18n";
import { ExportBot } from "./ExportBot";

let saved: Array<{ name: string; href: string }>;

beforeEach(() => {
  saved = [];
  setLanguage("en");
  // jsdom has no object URLs and follows no downloads, so both are stood in for.
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:bot", revokeObjectURL: () => undefined }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, href: this.href });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("ExportBot", () => {
  it("asks the host for the bot file and hands it to the browser to save", async () => {
    const fetchMock = answer(200, { result: { fileName: "atlas.bot.md", text: "# Atlas" } });
    vi.stubGlobal("fetch", fetchMock);
    render(() => <ExportBot botId="bot-1" botName="Atlas" />);
    fireEvent.click(
      screen.getByRole("button", { name: t("settings.export.action", { name: "Atlas" }) }),
    );
    expect(
      await screen.findByText(t("settings.export.saved", { file: "atlas.bot.md" })),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/library.exportBot");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body).input).toBe("bot-1");
    expect(saved).toEqual([{ name: "atlas.bot.md", href: "blob:bot" }]);
  });

  it("says why a bot cannot be saved yet, and saves nothing", async () => {
    vi.stubGlobal("fetch", answer(500, { error: "Give Atlas a role and instructions first." }));
    render(() => <ExportBot botId="bot-1" botName="Atlas" />);
    fireEvent.click(
      screen.getByRole("button", { name: t("settings.export.action", { name: "Atlas" }) }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Give Atlas a role and instructions first.",
    );
    expect(saved).toEqual([]);
  });
});
