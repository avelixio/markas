import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectLanguage, setLanguage, t } from "../i18n";
import { en } from "../i18n/en";
import { id } from "../i18n/id";
import { Shell } from "../ui/Shell";
import { KeyringPage } from "./KeyringPage";
import type { KeySummary } from "./keyring-client";

const key = (overrides: Partial<KeySummary>): KeySummary => ({
  id: "k1",
  name: "metrics",
  kind: "login",
  origin: "https://metrics.example.com",
  username: "sam@example.com",
  variable: null,
  hasTwoStepCode: false,
  fillPolicy: "auto",
  sharedWith: ["atlas"],
  note: "",
  createdAt: "2026-11-11T02:00:00.000Z",
  updatedAt: "2026-11-11T02:00:00.000Z",
  lastUsedAt: null,
  ...overrides,
});

let keys: KeySummary[];
let calls: Array<{ method: string; input: unknown }>;
let failNext: string | null;

beforeEach(() => {
  keys = [];
  calls = [];
  failNext = null;
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
      if (method === "keyring.list") return respond(200, { result: keys });
      if (method === "keyring.create") {
        const created = key({ id: "new", ...(input as Partial<KeySummary>) });
        keys = [...keys, created];
        return respond(200, { result: created });
      }
      if (method === "keyring.reveal")
        return respond(200, { result: { value: "s3cret-value", twoStepSeed: null } });
      if (method === "keyring.remove") {
        keys = keys.filter((item) => item.id !== input);
        return respond(200, { result: null });
      }
      return respond(404, { error: `Unknown method: ${method}` });
    }),
  );
  window.markas = {
    agent: {
      listBots: async () => [
        { id: "atlas", name: "Atlas", avatarShape: "pebble", avatarColor: "green" },
        { id: "juno", name: "Juno", avatarShape: "tablet", avatarColor: "violet" },
      ],
    },
  } as unknown as typeof window.markas;
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLanguage("en");
});

describe("translations", () => {
  it("has Indonesian text for every English key, with the same placeholders", () => {
    for (const [name, english] of Object.entries(en)) {
      const indonesian = id[name as keyof typeof en];
      expect(indonesian, name).toBeTruthy();
      const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(indonesian), name).toEqual(placeholders(english));
    }
  });

  it("fills placeholders and follows the chosen language", () => {
    expect(t("keyring.count", { count: 3 })).toBe("3 keys");
    setLanguage("id");
    expect(t("keyring.count", { count: 3 })).toBe("3 kunci");
    expect(document.documentElement.lang).toBe("id");
  });

  it("uses the saved language, then the browser's, then English", () => {
    expect(detectLanguage("id", "en-US")).toBe("id");
    expect(detectLanguage(null, "id-ID")).toBe("id");
    expect(detectLanguage(null, "fr-FR")).toBe("en");
    expect(detectLanguage("xx", undefined)).toBe("en");
  });
});

describe("KeyringPage", () => {
  it("starts empty and adds a key bound to an exact site and shared with one bot", async () => {
    render(() => <KeyringPage />);
    expect(await screen.findByText("No keys yet")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Add key" })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.input(within(dialog).getByLabelText(/^Name/), { target: { value: "admin-read" } });
    fireEvent.input(within(dialog).getByLabelText(/^Website/), {
      target: { value: "admin.example.com" },
    });
    fireEvent.input(within(dialog).getByLabelText(/^Username/), { target: { value: "sam" } });
    fireEvent.input(within(dialog).getByLabelText(/^Password/), { target: { value: "pw-12345" } });
    fireEvent.click(await within(dialog).findByLabelText("Juno"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((call) => call.method === "keyring.create")?.input).toEqual({
      name: "admin-read",
      kind: "login",
      fillPolicy: "auto",
      sharedWith: ["juno"],
      origin: "admin.example.com",
      username: "sam",
      value: "pw-12345",
    });
    expect(await screen.findByText("admin-read")).toBeInTheDocument();
  });

  it("keeps the form open and shows the host's reason when a key is refused", async () => {
    render(() => <KeyringPage />);
    await screen.findByText("No keys yet");
    fireEvent.click(screen.getAllByRole("button", { name: "Add key" })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.input(within(dialog).getByLabelText(/^Name/), { target: { value: "metrics" } });
    fireEvent.input(within(dialog).getByLabelText(/^Website/), {
      target: { value: "x.example.com" },
    });
    fireEvent.input(within(dialog).getByLabelText(/^Username/), { target: { value: "u" } });
    fireEvent.input(within(dialog).getByLabelText(/^Password/), { target: { value: "pw-12345" } });
    failNext = 'A key named "metrics" already exists.';
    fireEvent.click(within(dialog).getByRole("button", { name: "Save key" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks for a variable name instead of a website for a variable key", async () => {
    render(() => <KeyringPage />);
    await screen.findByText("No keys yet");
    fireEvent.click(screen.getAllByRole("button", { name: "Add key" })[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Variable"));
    expect(within(dialog).getByLabelText(/^Variable name/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^Website/)).toBeNull();
    expect(within(dialog).queryByLabelText(/^Username/)).toBeNull();
  });

  it("lists two keys on sibling hosts as separate rows", async () => {
    keys = [
      key({}),
      key({ id: "k2", name: "admin", origin: "https://admin.example.com", sharedWith: [] }),
    ];
    render(() => <KeyringPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("https://metrics.example.com")).toBeInTheDocument();
    expect(within(table).getByText("https://admin.example.com")).toBeInTheDocument();
    expect(within(table).getByText("No bots")).toBeInTheDocument();
    expect(screen.getByText("2 keys")).toBeInTheDocument();
  });

  it("shows a value only after a confirmation, and hides it again", async () => {
    keys = [key({})];
    render(() => <KeyringPage />);
    await screen.findByRole("table");
    expect(screen.queryByText("s3cret-value")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the value of metrics" }));
    expect(calls.some((call) => call.method === "keyring.reveal")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show for 30 seconds" }));
    expect(await screen.findByText("s3cret-value")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide now" }));
    expect(screen.queryByText("s3cret-value")).toBeNull();
  });

  it("removes a key only after a confirmation", async () => {
    keys = [key({})];
    render(() => <KeyringPage />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Remove metrics" }));
    expect(calls.some((call) => call.method === "keyring.remove")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove metrics" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(await screen.findByText("No keys yet")).toBeInTheDocument();
  });

  it("says why when the keyring will not open, and offers a retry", async () => {
    failNext = "The keyring could not be opened: no keychain";
    render(() => <KeyringPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("no keychain");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No keys yet")).toBeInTheDocument();
  });
});

describe("Shell", () => {
  it("switches areas without unmounting chats, and switches language", async () => {
    render(() => <Shell chats={<p>chat area</p>} />);
    expect(screen.getByText("chat area")).toBeVisible();
    expect(screen.getByRole("button", { name: "Chats" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "Keyring" }));
    expect(await screen.findByRole("heading", { name: "Keyring" })).toBeInTheDocument();
    expect(screen.getByText("chat area")).not.toBeVisible();

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "id" } });
    expect(await screen.findByRole("heading", { name: "Kunci" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Obrolan" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Obrolan" }));
    expect(screen.getByText("chat area")).toBeVisible();
  });
});
