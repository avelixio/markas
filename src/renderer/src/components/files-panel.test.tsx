import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotFileEntry, BotFileListing } from "../../../shared/files";
import { setLanguage, t } from "../i18n";
import { FilesPanel } from "./FilesPanel";

const file = (path: string, size = 2_048): BotFileEntry => ({
  name: path.split("/").at(-1) ?? path,
  path,
  kind: "file",
  size,
  modifiedAt: "2026-11-12T02:00:00.000Z",
});
const folder = (path: string): BotFileEntry => ({ ...file(path), kind: "folder", size: null });
const listing = (
  root: "own" | "shared",
  path: string,
  entries: BotFileEntry[],
): BotFileListing => ({
  root,
  path,
  entries,
  more: 0,
});

let calls: Array<{ method: string; input: Record<string, unknown> }>;
let folders: Record<string, BotFileListing | Error>;
let opened: unknown[];

beforeEach(() => {
  calls = [];
  opened = [];
  folders = {
    "own:": listing("own", "", [folder("memory"), file("instructions.md")]),
    "own:memory": listing("own", "memory", [file("memory/MEMORY.md", 640)]),
    "shared:": listing("shared", "", []),
  };
  setLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.replace("/api/", "");
      const input = (JSON.parse(String(init.body)) as { input: Record<string, unknown> }).input;
      calls.push({ method, input });
      const respond = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status });
      if (method === "archive.list") {
        return respond(200, {
          result: [
            {
              id: "a1",
              name: "stock.csv",
              kind: "file",
              from: null,
              sentTo: ["atlas"],
              addedAt: "2026-11-12T02:00:00.000Z",
            },
            {
              id: "a2",
              name: "other.csv",
              kind: "file",
              from: null,
              sentTo: ["juno"],
              addedAt: "2026-11-12T02:00:00.000Z",
            },
          ],
        });
      }
      if (method === "files.open") return respond(200, { result: null });
      const found = folders[`${input.root}:${input.path}`];
      if (!found) return respond(404, { error: "That file or folder is no longer there." });
      if (found instanceof Error) return respond(500, { error: found.message });
      return respond(200, { result: found });
    }),
  );
  window.markas = {
    agent: {
      openAttachment: async (input: unknown) => {
        opened.push(input);
      },
    },
  } as unknown as typeof window.markas;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FilesPanel", () => {
  it("shows the bot's own folder, the files of this chat and the shared folder", async () => {
    render(() => <FilesPanel botId="atlas" botName="Atlas" />);
    expect(await screen.findByText("instructions.md")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(await screen.findByText("stock.csv")).toBeInTheDocument();
    // A file that went to another bot is not this chat's.
    expect(screen.queryByText("other.csv")).not.toBeInTheDocument();
    expect(await screen.findByText(t("files.empty"))).toBeInTheDocument();
    expect(screen.getByText(t("files.note"))).toBeInTheDocument();
  });

  it("reads a folder only when it is opened, and opens a file with the host", async () => {
    render(() => <FilesPanel botId="atlas" botName="Atlas" />);
    const memory = await screen.findByRole("button", {
      name: t("files.folder", { name: "memory" }),
    });
    expect(screen.queryByText("MEMORY.md")).not.toBeInTheDocument();
    fireEvent.click(memory);
    expect(memory).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(
      await screen.findByRole("button", { name: t("files.open", { name: "MEMORY.md" }) }),
    );
    await vi.waitFor(() =>
      expect(calls.find((call) => call.method === "files.open")?.input).toEqual({
        botId: "atlas",
        root: "own",
        path: "memory/MEMORY.md",
        action: "open",
      }),
    );
  });

  it("opens a file of this chat as an attachment", async () => {
    render(() => <FilesPanel botId="atlas" botName="Atlas" />);
    fireEvent.click(
      await screen.findByRole("button", { name: t("files.open", { name: "stock.csv" }) }),
    );
    await vi.waitFor(() => expect(opened).toEqual([{ attachmentId: "a1", action: "open" }]));
  });

  it("narrows the lists to what the person is looking for, keeping folders", async () => {
    render(() => <FilesPanel botId="atlas" botName="Atlas" />);
    await screen.findByText("instructions.md");
    fireEvent.input(screen.getByPlaceholderText(t("files.find")), { target: { value: "STOCK" } });
    expect(screen.queryByText("instructions.md")).not.toBeInTheDocument();
    expect(screen.getByText("memory")).toBeInTheDocument();
    expect(screen.getByText("stock.csv")).toBeInTheDocument();
  });

  it("says why a folder cannot be read, and lets the person ask again", async () => {
    folders["own:"] = new Error("The folder does not exist yet.");
    render(() => <FilesPanel botId="atlas" botName="Atlas" />);
    expect(await screen.findByText("The folder does not exist yet.")).toBeInTheDocument();
    folders["own:"] = listing("own", "", [file("instructions.md")]);
    fireEvent.click(screen.getAllByRole("button", { name: t("common.retry") })[0] as HTMLElement);
    expect(await screen.findByText("instructions.md")).toBeInTheDocument();
  });
});
