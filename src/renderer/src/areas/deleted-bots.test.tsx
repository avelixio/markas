import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotSummary, DeletedBot } from "../../../shared/ipc";
import { setLanguage } from "../i18n";
import { UNDO_NOTICE_MS, UndoNotice } from "../ui/UndoNotice";
import { DeletedBots, type DeletedBotsClient } from "./DeletedBots";

const deleted = (id: string, name: string): DeletedBot => ({
  bot: { id, name } as BotSummary,
  deletedAt: "2026-11-01T02:00:00.000Z",
  purgeAt: "2026-12-01T02:00:00.000Z",
});

let trash: DeletedBot[];
let calls: string[];
let failWith: string | null;

const client: DeletedBotsClient = {
  list: async () => trash,
  restore: async (botId) => {
    if (failWith) throw new Error(failWith);
    calls.push(`restore ${botId}`);
    const entry = trash.find((item) => item.bot.id === botId) as DeletedBot;
    trash = trash.filter((item) => item !== entry);
    return entry.bot;
  },
  purge: async (botId) => {
    if (failWith) throw new Error(failWith);
    calls.push(`purge ${botId}`);
    trash = trash.filter((item) => item.bot.id !== botId);
  },
};

beforeEach(() => {
  trash = [deleted("atlas", "Atlas"), deleted("juno", "Juno")];
  calls = [];
  failWith = null;
  setLanguage("en");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DeletedBots", () => {
  it("says so when nothing was deleted", async () => {
    trash = [];
    render(() => <DeletedBots client={client} />);
    expect(await screen.findByText("No deleted bots.")).toBeInTheDocument();
  });

  it("lists each deleted bot with the day it goes for good, and restores one", async () => {
    render(() => <DeletedBots client={client} />);
    expect(await screen.findByText("Atlas")).toBeInTheDocument();
    expect(screen.getAllByText(/Removed for good on/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Restore Atlas" }));

    await waitFor(() => expect(screen.queryByText("Atlas")).not.toBeInTheDocument());
    expect(calls).toEqual(["restore atlas"]);
    expect(screen.getByText("Juno")).toBeInTheDocument();
  });

  it("asks once more before deleting a bot forever, and lets the person back out", async () => {
    render(() => <DeletedBots client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Juno forever" }));
    expect(screen.getByText(/It cannot be undone/)).toBeInTheDocument();
    expect(calls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/It cannot be undone/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Juno forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete forever" }));
    await waitFor(() => expect(screen.queryByText("Juno")).not.toBeInTheDocument());
    expect(calls).toEqual(["purge juno"]);
  });

  it("says why a bot could not be restored, and keeps it listed", async () => {
    failWith = "The disk is full.";
    render(() => <DeletedBots client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore Atlas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The disk is full.");
    expect(screen.getByText("Atlas")).toBeInTheDocument();
  });

  it("offers a retry when the list cannot be read", async () => {
    let broken = true;
    render(() => (
      <DeletedBots
        client={{
          ...client,
          list: async () => {
            if (broken) throw new Error("The host did not answer.");
            return trash;
          },
        }}
      />
    ));
    expect(await screen.findByRole("alert")).toHaveTextContent("The host did not answer.");
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Atlas")).toBeInTheDocument();
  });
});

describe("UndoNotice", () => {
  it("takes the action back and then leaves", async () => {
    const onUndo = vi.fn(async () => undefined);
    const onDismiss = vi.fn();
    render(() => <UndoNotice message="Atlas was deleted" onUndo={onUndo} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("stays and says why when the undo fails", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(() => (
      <UndoNotice
        message="Atlas was deleted"
        onUndo={async () => {
          throw new Error("The host did not answer.");
        }}
        onDismiss={onDismiss}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await vi.advanceTimersByTimeAsync(UNDO_NOTICE_MS + 1_000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That could not be undone. The host did not answer.",
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("leaves by itself after a while, or when dismissed", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(() => (
      <UndoNotice
        message="Atlas was deleted"
        onUndo={async () => undefined}
        onDismiss={onDismiss}
      />
    ));
    await vi.advanceTimersByTimeAsync(UNDO_NOTICE_MS - 100);
    expect(onDismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
