import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelOption } from "../../../shared/ipc";
import { setLanguage } from "../i18n";
import { enSetup } from "../i18n/en.setup";
import { idSetup } from "../i18n/id.setup";
import { isSupportedLanguage } from "./LanguageStep";
import { SetupFlow } from "./SetupFlow";
import type {
  EngineModels,
  EngineStatus,
  InstallResult,
  SetupClient,
  SetupPatch,
  SetupProgress,
  SignInResult,
} from "./setup-client";

const EMPTY: SetupProgress = {
  completed: false,
  step: "language",
  language: null,
  preferredProvider: null,
  defaultModel: null,
  defaultEffort: null,
  consentAt: null,
};

const engine = (id: "claude" | "codex", state: EngineStatus["state"]): EngineStatus => ({
  id,
  state,
  version: state === "not-installed" ? null : "1.2.3",
  email: state === "ready" ? "sam@example.com" : null,
  message: null,
});

const MODELS: AgentModelOption[] = [
  {
    id: "claude-sonnet-5",
    name: "Sonnet",
    description: "Balanced, most tasks",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "claude-opus-5",
    name: "Opus",
    description: "Most capable",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["medium", "high"],
  },
];

interface Fake extends SetupClient {
  statuses: EngineStatus[];
  saved: SetupPatch[];
  install: InstallResult;
  signInResult: SignInResult;
  models: EngineModels | Error;
  failSave: boolean;
}

function fakeClient(overrides: Partial<Fake> = {}): Fake {
  const fake: Fake = {
    statuses: [engine("claude", "ready"), engine("codex", "not-installed")],
    saved: [],
    install: { ok: true },
    signInResult: { ok: true },
    models: { models: MODELS, fallback: false },
    failSave: false,
    getState: async () => EMPTY,
    save: async (patch) => {
      if (fake.failSave) throw new Error("host is down");
      fake.saved.push(patch);
      return { ...EMPTY, ...Object.assign({}, ...fake.saved) };
    },
    engineStatus: async () => fake.statuses,
    installEngine: vi.fn(async () => fake.install),
    cancelInstall: vi.fn(async () => undefined),
    installCommand: async (id) => `install-${id} --now`,
    locateEngine: vi.fn(async (_id, path) =>
      path.includes("good")
        ? ({ ok: true, version: "9.9.9" } as const)
        : ({ ok: false, message: "That file is not Codex." } as const),
    ),
    signIn: vi.fn(async () => fake.signInResult),
    signInCommand: async (id) => `${id} login`,
    listModels: vi.fn(async () => {
      if (fake.models instanceof Error) throw fake.models;
      return fake.models;
    }),
    ...overrides,
  };
  return fake;
}

function open(client: Fake, initial: Partial<SetupProgress> = {}) {
  const onDone = vi.fn();
  render(() => <SetupFlow client={client} initial={{ ...EMPTY, ...initial }} onDone={onDone} />);
  return onDone;
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  setLanguage("en");
});

describe("setup text", () => {
  it("has the same keys in English and Bahasa Indonesia, with none left empty", () => {
    expect(Object.keys(idSetup).sort()).toEqual(Object.keys(enSetup).sort());
    for (const value of [...Object.values(enSetup), ...Object.values(idSetup)]) {
      expect(value.trim()).not.toBe("");
    }
  });

  it("never says agent, provider or the engines Markas does not have", () => {
    const all = [...Object.values(enSetup), ...Object.values(idSetup)].join("\n");
    expect(all).not.toMatch(/\bagents?\b/i);
    expect(all).not.toMatch(/\bproviders?\b/i);
    expect(all).not.toMatch(/opencode|local model/i);
    expect(all).not.toContain("\u2014");
  });
});

describe("step 1, language", () => {
  it("switches the interface and saves the choice", async () => {
    const client = fakeClient();
    open(client);

    await fireEvent.click(screen.getByRole("radio", { name: /Bahasa Indonesia/ }));
    expect(screen.getByRole("heading", { name: "Pilih bahasa Anda" })).toBeInTheDocument();

    await click("Lanjut");
    await screen.findByRole("heading", { name: idSetup["setup.engines.title"] });
    expect(client.saved[0]).toEqual({ language: "id", step: "engines" });
  });

  it("knows which computer languages Markas has", () => {
    expect(isSupportedLanguage("en-GB")).toBe(true);
    expect(isSupportedLanguage("id-ID")).toBe(true);
    expect(isSupportedLanguage("fr-FR")).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });

  it("stays on the step and says so when the host cannot save", async () => {
    const client = fakeClient({ failSave: true });
    open(client);

    await click("Continue");

    expect(await screen.findByText(enSetup["setup.saveFailed"])).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose your language" })).toBeInTheDocument();
  });
});

describe("step 2, engines", () => {
  it("shows each engine's state with the one thing to do next", async () => {
    const client = fakeClient({
      statuses: [engine("claude", "sign-in-required"), engine("codex", "not-installed")],
    });
    open(client, { step: "engines" });

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(screen.getByText(enSetup["setup.engines.none.title"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("unlocks Continue once one engine is signed in and saves it as the default", async () => {
    const client = fakeClient();
    open(client, { step: "engines" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await click("Continue");

    await screen.findByRole("heading", { name: enSetup["setup.model.title"] });
    expect(client.saved[0]).toEqual({ preferredProvider: "claude", step: "model" });
  });

  it("offers retry, the install command and locate when an install fails", async () => {
    const client = fakeClient({
      install: { ok: false, reason: "offline", message: "ENOTFOUND registry" },
    });
    open(client, { step: "engines" });

    await fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    expect(await screen.findByText("Codex could not be installed")).toBeInTheDocument();
    expect(screen.getByText(/There is no internet connection/)).toBeInTheDocument();
    expect(await screen.findByText("install-codex --now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy install command" })).toBeInTheDocument();

    client.install = { ok: true };
    await click("Retry");
    await waitFor(() => expect(client.installEngine).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText("Codex could not be installed")).not.toBeInTheDocument(),
    );
  });

  it("lets the person point at a copy they already have, and says why a wrong one is refused", async () => {
    const client = fakeClient({
      install: { ok: false, reason: "permission", message: "EACCES" },
    });
    open(client, { step: "engines" });
    await fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Locate it" }));

    const path = screen.getByLabelText("Path to the program");
    await fireEvent.input(path, { target: { value: "C:/tools/wrong.exe" } });
    await click("Use this copy");
    expect(await screen.findByText("That file is not Codex.")).toBeInTheDocument();

    await fireEvent.input(path, { target: { value: "C:/tools/good/codex.exe" } });
    await click("Use this copy");
    await waitFor(() =>
      expect(screen.queryByLabelText("Path to the program")).not.toBeInTheDocument(),
    );
    expect(client.locateEngine).toHaveBeenLastCalledWith("codex", "C:/tools/good/codex.exe");
  });

  it("offers the login again, a terminal command and skip when sign-in does not finish", async () => {
    const client = fakeClient({
      statuses: [engine("claude", "ready"), engine("codex", "sign-in-required")],
      signInResult: { ok: false, reason: "timed-out", message: "No sign-in after 5 minutes." },
    });
    open(client, { step: "engines" });

    await fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Codex sign-in is taking a while")).toBeInTheDocument();
    expect(await screen.findByText("codex login")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy terminal command" })).toBeInTheDocument();

    await click("Skip Codex");
    expect(screen.queryByText("Codex sign-in is taking a while")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("says so when the host does not answer", async () => {
    const client = fakeClient({
      engineStatus: async () => {
        throw new Error("offline");
      },
    });
    open(client, { step: "engines" });

    expect(
      await screen.findByText(enSetup["setup.engines.statusFailed.title"]),
    ).toBeInTheDocument();
  });
});

describe("step 3, default model", () => {
  async function reachModels(client: Fake) {
    open(client, { step: "engines" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await click("Continue");
    await screen.findByRole("heading", { name: enSetup["setup.model.title"] });
  }

  it("picks a model and an effort and saves them", async () => {
    const client = fakeClient();
    await reachModels(client);

    await fireEvent.click(await screen.findByRole("radio", { name: /Opus/ }));
    await click("Medium");
    await click("Continue");

    await screen.findByRole("heading", { name: enSetup["setup.consent.title"] });
    expect(client.saved.at(-1)).toEqual({
      preferredProvider: "claude",
      defaultModel: "claude-opus-5",
      defaultEffort: "medium",
      step: "consent",
    });
  });

  it("only lets a signed-in engine be opened", async () => {
    const client = fakeClient();
    await reachModels(client);

    expect(screen.getByRole("tab", { name: "Claude Code" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Codex" })).toBeDisabled();
  });

  it("carries on with a built-in list when the engine cannot list its models", async () => {
    const client = fakeClient({ models: { models: MODELS, fallback: true } });
    await reachModels(client);

    expect(await screen.findByText("Claude Code did not list its models")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("offers the engine's default, retry and a typed name when no list loads at all", async () => {
    const client = fakeClient({ models: new Error("timeout") });
    await reachModels(client);

    expect(await screen.findByText("Claude Code did not list its models")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await click("Type a model name");
    await fireEvent.input(screen.getByLabelText("Model name"), {
      target: { value: "claude-custom-1" },
    });
    await click("Use this model");

    await screen.findByRole("heading", { name: enSetup["setup.consent.title"] });
    expect(client.saved.at(-1)).toMatchObject({ defaultModel: "claude-custom-1", step: "consent" });
  });

  it("can continue on the engine's own default", async () => {
    const client = fakeClient({ models: new Error("timeout") });
    await reachModels(client);

    await fireEvent.click(await screen.findByRole("button", { name: "Use the engine's default" }));

    await screen.findByRole("heading", { name: enSetup["setup.consent.title"] });
    expect(client.saved.at(-1)).toMatchObject({ defaultModel: null, defaultEffort: null });
  });
});

describe("step 4, consent", () => {
  it("does not continue until the box is ticked, and says why", async () => {
    const client = fakeClient();
    const onDone = open(client, { step: "consent" });

    await click("Continue");
    expect(screen.getByText(enSetup["setup.consent.needed.title"])).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(client.saved).toEqual([]);

    await fireEvent.click(screen.getByRole("checkbox"));
    await click("Continue");

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(client.saved[0]).toMatchObject({ completed: true });
    expect(typeof client.saved[0].consentAt).toBe("string");
  });

  it("hands over to the bot steps when they are provided", async () => {
    const client = fakeClient();
    const onDone = vi.fn();
    render(() => (
      <SetupFlow
        client={client}
        initial={{ ...EMPTY, step: "consent" }}
        onDone={onDone}
        botSteps={(context) => (
          <button type="button" onClick={context.onDone}>
            Finish with a bot
          </button>
        )}
      />
    ));

    await fireEvent.click(screen.getByRole("checkbox"));
    await click("Continue");
    await fireEvent.click(await screen.findByRole("button", { name: "Finish with a bot" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(client.saved[0]).toMatchObject({ step: "dispatch" });
    expect(client.saved[1]).toEqual({ completed: true });
  });
});
