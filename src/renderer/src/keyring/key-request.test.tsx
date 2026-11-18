import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyRequest } from "../../../shared/ipc";
import { setLanguage, t } from "../i18n";
import { KeyRequestCard, type KeyRequestClient } from "./KeyRequestCard";

const request: KeyRequest = {
  botId: "atlas",
  kind: "login",
  origin: "https://reports.example.com",
  name: "reports.example.com",
  username: "sam@example.com",
  reason: "To read the weekly report",
};

function client(names: string[] = []): KeyRequestClient & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    listNames: async () => names,
    listBots: async () => [],
    save: async (draft) => {
      saved.push(draft);
    },
  };
}

beforeEach(() => setLanguage("en"));

describe("a bot asking for a key", () => {
  it("says who asks, for which site and why, and that the secret stays out of the chat", () => {
    render(() => (
      <KeyRequestCard
        request={request}
        botName="Atlas"
        onAnswer={async () => true}
        client={client()}
      />
    ));
    expect(screen.getByText("Atlas asks for a login")).toBeInTheDocument();
    expect(screen.getByText("For https://reports.example.com")).toBeInTheDocument();
    expect(
      screen.getByText(/To read the weekly report\. What you type here is never shown to Atlas/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(t("keyring.form.username"))).toHaveValue("sam@example.com");
  });

  it("saves the key for that bot only, then answers yes", async () => {
    const api = client();
    const onAnswer = vi.fn(async () => true);
    render(() => (
      <KeyRequestCard request={request} botName="Atlas" onAnswer={onAnswer} client={api} />
    ));
    fireEvent.input(screen.getByLabelText(t("keyring.form.password")), {
      target: { value: "not-a-real-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and let Atlas use it" }));
    // The check shows first, so the person sees the key landed, then the bot is answered.
    expect(
      await screen.findByText("Saved. Atlas can use reports.example.com now."),
    ).toBeInTheDocument();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
    expect(api.saved).toEqual([
      {
        name: "reports.example.com",
        kind: "login",
        origin: "https://reports.example.com",
        username: "sam@example.com",
        value: "not-a-real-password",
        fillPolicy: "auto",
        sharedWith: ["atlas"],
      },
    ]);
  });

  it("names the key apart from one that already has the name", async () => {
    render(() => (
      <KeyRequestCard
        request={request}
        botName="Atlas"
        onAnswer={async () => true}
        client={client(["reports.example.com"])}
      />
    ));
    expect(
      await screen.findByText("Saved as reports.example.com-2, for Atlas only"),
    ).toBeInTheDocument();
  });

  it("asks for the secret before saving, and answers no on Not now", async () => {
    const api = client();
    const onAnswer = vi.fn(async () => true);
    render(() => (
      <KeyRequestCard request={request} botName="Atlas" onAnswer={onAnswer} client={api} />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Save and let Atlas use it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Write the password to save.");
    expect(api.saved).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("keeps the card and says why when the Keyring refuses the key", async () => {
    const api = client();
    api.save = async () => {
      throw new Error('A key named "reports.example.com" already exists.');
    };
    const onAnswer = vi.fn(async () => true);
    render(() => (
      <KeyRequestCard request={request} botName="Atlas" onAnswer={onAnswer} client={api} />
    ));
    fireEvent.input(screen.getByLabelText(t("keyring.form.password")), {
      target: { value: "not-a-real-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and let Atlas use it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
