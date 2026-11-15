import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelOption } from "../../../shared/ipc";
import { language, setLanguage, t } from "../i18n";
import type { SetupClient, SetupPatch, SetupProgress } from "../setup/setup-client";
import { SettingsPage } from "./SettingsPage";

const model = (id: string, name: string): AgentModelOption =>
  ({
    id,
    name,
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  }) as AgentModelOption;

const MODELS = {
  claude: [model("claude-fable-5", "Claude Fable 5"), model("claude-opus-5", "Claude Opus 5")],
  codex: [model("gpt-5.6-luna", "GPT-5.6 Luna")],
};

let progress: SetupProgress;
let patches: SetupPatch[];
let failSave: string | null;
let hostCalls: string[];

function client(): SetupClient {
  return {
    getState: async () => progress,
    save: async (patch: SetupPatch) => {
      if (failSave) throw new Error(failSave);
      patches.push(patch);
      progress = { ...progress, ...patch } as SetupProgress;
      return progress;
    },
    engineStatus: async () => [
      { id: "claude", state: "ready", version: "2.1.0", email: null, message: null },
      { id: "codex", state: "ready", version: "0.150.0", email: null, message: null },
    ],
    listModels: async (engine: "claude" | "codex") => ({ models: MODELS[engine], fallback: false }),
  } as unknown as SetupClient;
}

beforeEach(() => {
  progress = {
    completed: true,
    step: "review",
    language: "en",
    preferredProvider: "claude",
    defaultModel: "claude-fable-5",
    defaultEffort: "low",
    consentAt: "2026-11-13T00:00:00.000Z",
  };
  patches = [];
  failSave = null;
  hostCalls = [];
  setLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const method = url.replace("/api/", "");
      hostCalls.push(method);
      const result =
        method === "app.getInfo"
          ? { name: "Markas", version: "0.1.0", platform: "linux" }
          : { saved: true, path: "/home/sol/.markas/exports/markas-data" };
      return new Response(JSON.stringify({ result }), { status: 200 });
    }),
  );
});

afterEach(() => {
  setLanguage("en");
  vi.unstubAllGlobals();
});

describe("SettingsPage", () => {
  it("shows what new bots start with, and this computer", async () => {
    render(() => <SettingsPage setup={client()} />);
    expect(await screen.findByLabelText(t("appSettings.engine"))).toHaveValue("claude");
    expect(await screen.findByLabelText(t("appSettings.model"))).toHaveValue("claude-fable-5");
    expect(screen.getByLabelText(t("setup.model.effort"))).toHaveValue("low");
    expect(await screen.findByText("Markas 0.1.0")).toBeInTheDocument();
  });

  it("saves a new default model with that model's own effort", async () => {
    render(() => <SettingsPage setup={client()} />);
    fireEvent.change(await screen.findByLabelText(t("appSettings.model")), {
      target: { value: "claude-opus-5" },
    });
    await vi.waitFor(() =>
      expect(patches).toEqual([{ defaultModel: "claude-opus-5", defaultEffort: "medium" }]),
    );
  });

  it("lets go of the model when the engine changes, because it belongs to the old engine", async () => {
    render(() => <SettingsPage setup={client()} />);
    fireEvent.change(await screen.findByLabelText(t("appSettings.engine")), {
      target: { value: "codex" },
    });
    await vi.waitFor(() =>
      expect(patches).toEqual([
        { preferredProvider: "codex", defaultModel: null, defaultEffort: null },
      ]),
    );
    expect(await screen.findByRole("option", { name: "GPT-5.6 Luna" })).toBeInTheDocument();
  });

  it("changes the language here and tells the host", async () => {
    render(() => <SettingsPage setup={client()} />);
    fireEvent.change(await screen.findByLabelText(t("nav.language")), { target: { value: "id" } });
    expect(language()).toBe("id");
    await vi.waitFor(() => expect(patches).toEqual([{ language: "id" }]));
  });

  it("says so when a choice could not be saved", async () => {
    failSave = "The setup file cannot be written.";
    render(() => <SettingsPage setup={client()} />);
    fireEvent.change(await screen.findByLabelText(t("appSettings.model")), {
      target: { value: "claude-opus-5" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("The setup file cannot be written.");
  });

  it("saves a copy of the data and says where it went", async () => {
    render(() => <SettingsPage setup={client()} />);
    fireEvent.click(await screen.findByRole("button", { name: t("appSettings.export.data") }));
    expect(
      await screen.findByText(
        t("appSettings.export.saved", { path: "/home/sol/.markas/exports/markas-data" }),
      ),
    ).toBeInTheDocument();
    expect(hostCalls).toContain("maintenance.exportData");
  });

  it("opens setup again without touching anything else", async () => {
    const onReload = vi.fn();
    render(() => <SettingsPage setup={client()} onReload={onReload} />);
    fireEvent.click(await screen.findByRole("button", { name: t("appSettings.setup.again") }));
    await vi.waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect(patches).toEqual([{ completed: false, step: "language" }]);
  });

  it("lets the person ask again when the settings cannot be read", async () => {
    const broken = client();
    let fail = true;
    const working = broken.getState;
    broken.getState = async () => {
      if (fail) throw new Error("The setup file cannot be read.");
      return working();
    };
    render(() => <SettingsPage setup={broken} />);
    expect(await screen.findByText("The setup file cannot be read.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(await screen.findByLabelText(t("appSettings.engine"))).toHaveValue("claude");
  });
});
