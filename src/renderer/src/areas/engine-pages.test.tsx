import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FuelReport } from "../../../shared/fuel";
import { setLanguage, t, tCount } from "../i18n";
import { FuelPage, SwitchboardPage } from "./EnginePages";

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

const report = (overrides: Partial<FuelReport> = {}): FuelReport => ({
  days: 7,
  engines: [
    { engine: "claude", state: "available", email: "sol@example.com", limits: null, bots: 2 },
    {
      engine: "codex",
      state: "available",
      email: null,
      limits: [
        {
          id: "codex",
          primary: { usedPercent: 84.2, windowDurationMins: 300, resetsAt: 1_794_600_000 },
          secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
      bots: 1,
    },
  ],
  perDay: [
    { day: "2026-11-07", turns: 0 },
    { day: "2026-11-08", turns: 3 },
    { day: "2026-11-09", turns: 1 },
  ],
  perBot: [
    { botId: "atlas", name: "Atlas", engine: "claude", turns: 3 },
    { botId: "pico", name: "Pico", engine: "codex", turns: 1 },
  ],
  totalTurns: 4,
  ...overrides,
});

describe("FuelPage", () => {
  it("shows what each engine reports, and says so when an engine reports nothing", async () => {
    answers["fuel.read"] = report();
    render(() => <FuelPage />);
    expect(await screen.findByText(t("fuel.used", { percent: 84 }))).toBeInTheDocument();
    expect(screen.getByText(t("fuel.window.hours", { count: 5 }))).toBeInTheDocument();
    expect(screen.getByText(t("fuel.window.week"))).toBeInTheDocument();
    expect(screen.getByText(t("fuel.plan.unknown", { engine: "Claude Code" }))).toBeInTheDocument();
    expect(screen.getByText(/sol@example\.com/)).toBeInTheDocument();
  });

  it("lists the bots that took turns, with each one's share", async () => {
    answers["fuel.read"] = report();
    render(() => <FuelPage />);
    const row = (await screen.findByRole("rowheader", { name: "Atlas" })).closest("tr");
    expect(within(row as HTMLElement).getByText("75%")).toBeInTheDocument();
    expect(screen.getByText(tCount("fuel.turns.total", 4, { days: 7 }))).toBeInTheDocument();
  });

  it("asks the host again when the person chooses 30 days", async () => {
    answers["fuel.read"] = report();
    render(() => <FuelPage />);
    await screen.findByText(t("fuel.used", { percent: 84 }));
    fireEvent.click(screen.getByLabelText(t("fuel.period.days", { count: 30 })));
    await vi.waitFor(() => expect(calls.at(-1)?.input).toEqual({ days: 30 }));
  });

  it("says plainly when nothing was used, and when bots are held by a signed-out engine", async () => {
    answers["fuel.read"] = report({
      engines: [
        { engine: "claude", state: "available", email: null, limits: null, bots: 0 },
        { engine: "codex", state: "sign-in-required", email: null, limits: null, bots: 2 },
      ],
      perBot: [],
      totalTurns: 0,
    });
    render(() => <FuelPage />);
    expect(await screen.findByText(t("fuel.empty.title"))).toBeInTheDocument();
    expect(
      screen.getByText(tCount("fuel.engine.held", 2, { engine: "Codex" })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("fuel.state.signedOut"))).toBeInTheDocument();
  });

  it("lets the person ask again when the host cannot answer", async () => {
    answers["fuel.read"] = new Error("The host is busy.");
    render(() => <FuelPage />);
    expect(await screen.findByText("The host is busy.")).toBeInTheDocument();
    answers["fuel.read"] = report();
    fireEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    expect(await screen.findByText(t("fuel.turns.title"))).toBeInTheDocument();
  });
});

describe("SwitchboardPage", () => {
  const engines = [
    {
      engine: "claude",
      state: "signed-in",
      version: "2.1.0",
      email: "sol@example.com",
      message: null,
      path: null,
    },
    {
      engine: "codex",
      state: "not-signed-in",
      version: "0.150.0",
      email: null,
      message: "Codex is installed but not signed in.",
      path: null,
    },
  ];
  const login = {
    id: "k1",
    name: "Metrics",
    kind: "login",
    origin: "https://metrics.example.com",
    username: "sol@example.com",
    variable: null,
    hasTwoStepCode: true,
    fillPolicy: "ask",
    sharedWith: ["atlas"],
    note: "",
    createdAt: "2026-11-11T02:00:00.000Z",
    updatedAt: "2026-11-11T02:00:00.000Z",
    lastUsedAt: null,
  };

  beforeEach(() => {
    answers["setup.engineStatus"] = engines;
    answers["keyring.list"] = [login, { ...login, id: "k2", name: "Token", kind: "token" }];
    answers["agent.listBots"] = [{ id: "atlas", name: "Atlas" }];
    answers["providers.local.scan"] = [
      {
        id: "lmstudio",
        name: "LM Studio",
        address: "http://127.0.0.1:1234",
        running: true,
        models: ["qwen-8b", "llama-3b"],
        connected: false,
      },
      {
        id: "ollama",
        name: "Ollama",
        address: "http://127.0.0.1:11434",
        running: false,
        models: [],
        connected: false,
      },
    ];
  });

  /** The article of one provider row, found by its name. */
  const providerRow = async (name: string) =>
    (await screen.findByText(name, { selector: "strong" })).closest("article") as HTMLElement;

  it("shows each engine as detected, how it stands, and the saved logins with their bots", async () => {
    render(() => <SwitchboardPage />);
    const claude = await providerRow("Claude Code");
    expect(within(claude).getByText(t("providers.detected"))).toBeInTheDocument();
    expect(within(claude).getByText(t("providers.state.connected"))).toBeInTheDocument();
    expect(within(claude).getByText(/sol@example\.com/)).toBeInTheDocument();
    // A connected engine needs nothing more.
    expect(within(claude).queryByRole("button")).toBeNull();

    const site = screen.getByRole("rowheader", { name: "https://metrics.example.com" });
    const row = site.closest("tr") as HTMLElement;
    expect(within(row).getByText("Atlas")).toBeInTheDocument();
    expect(within(row).getByText(t("switchboard.never"))).toBeInTheDocument();
    // Only logins belong here; a token is not a sign-in to a site.
    expect(screen.queryByText("Token")).not.toBeInTheDocument();
  });

  it("connects a detected engine with its own sign-in, then shows it connected", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      answers["setup.signIn"] = { engine: "codex", state: "waiting", message: null, email: null };
      render(() => <SwitchboardPage />);
      const codex = await providerRow("Codex");
      expect(within(codex).getByText(t("providers.detected"))).toBeInTheDocument();
      fireEvent.click(within(codex).getByRole("button", { name: "Connect Codex" }));
      await vi.waitFor(() =>
        expect(calls).toContainEqual({ method: "setup.signIn", input: "codex" }),
      );
      expect(await within(codex).findByText(t("providers.state.waiting"))).toBeInTheDocument();

      answers["setup.engineStatus"] = engines.map((engine) =>
        engine.engine === "codex" ? { ...engine, state: "signed-in", message: null } : engine,
      );
      await vi.advanceTimersByTimeAsync(3_100);
      await vi.waitFor(async () => {
        const after = await providerRow("Codex");
        expect(within(after).getByText(t("providers.state.connected"))).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says why an engine could not start its sign-in", async () => {
    answers["setup.signIn"] = {
      engine: "codex",
      state: "failed",
      message: "Codex could not open its sign-in.",
      email: null,
    };
    render(() => <SwitchboardPage />);
    const codex = await providerRow("Codex");
    fireEvent.click(within(codex).getByRole("button", { name: "Connect Codex" }));
    expect(await within(codex).findByRole("alert")).toHaveTextContent(
      "Codex could not open its sign-in.",
    );
  });

  it("shows a model server found on this computer, and connects it", async () => {
    answers["providers.local.connect"] = { id: "lmstudio", connected: true };
    render(() => <SwitchboardPage />);
    const lmstudio = await providerRow("LM Studio");
    expect(within(lmstudio).getByText(t("providers.detected"))).toBeInTheDocument();
    expect(within(lmstudio).getByText(/2 models/)).toBeInTheDocument();
    const ollama = await providerRow("Ollama");
    expect(within(ollama).queryByText(t("providers.detected"))).toBeNull();
    expect(within(ollama).getByText(t("providers.state.not-found"))).toBeInTheDocument();
    expect(within(ollama).queryByRole("button")).toBeNull();

    fireEvent.click(within(lmstudio).getByRole("button", { name: "Connect LM Studio" }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: "providers.local.connect",
        input: { id: "lmstudio" },
      }),
    );
    // What changed is looked at again.
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.method === "providers.local.scan").length).toBe(2),
    );
  });

  it("says why a model server could not be connected", async () => {
    answers["providers.local.connect"] = new Error("LM Studio has no model loaded.");
    render(() => <SwitchboardPage />);
    const lmstudio = await providerRow("LM Studio");
    fireEvent.click(within(lmstudio).getByRole("button", { name: "Connect LM Studio" }));
    expect(await within(lmstudio).findByRole("alert")).toHaveTextContent(
      "LM Studio has no model loaded.",
    );
  });

  it("still shows the engines when the keyring cannot be opened", async () => {
    answers["keyring.list"] = new Error("The keyring could not be opened.");
    render(() => <SwitchboardPage />);
    expect(await providerRow("Codex")).toBeInTheDocument();
    expect(screen.getByText(t("switchboard.logins.empty.title"))).toBeInTheDocument();
  });

  it("checks again when asked", async () => {
    render(() => <SwitchboardPage />);
    await providerRow("Codex");
    const before = calls.filter((call) => call.method === "setup.engineStatus").length;
    fireEvent.click(screen.getByRole("button", { name: t("switchboard.check") }));
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.method === "setup.engineStatus").length).toBe(before + 1),
    );
  });
});

describe("SwitchboardPage with OpenCode", () => {
  const provider = (id: string, name: string, connected: boolean, methods: unknown[]) => ({
    id,
    name,
    connected,
    models: connected ? 20 : 0,
    methods,
  });

  beforeEach(() => {
    answers["setup.engineStatus"] = [
      {
        engine: "opencode",
        state: "signed-in",
        version: "1.14.20",
        email: null,
        message: null,
        path: null,
      },
    ];
    answers["keyring.list"] = [];
    answers["agent.listBots"] = [];
    answers["providers.local.scan"] = [];
    answers["providers.openCode.list"] = [
      provider("anthropic", "Anthropic", true, [
        { index: 0, kind: "key", label: "API key", questions: [] },
      ]),
      provider("openai", "OpenAI", false, [
        { index: 0, kind: "browser", label: "ChatGPT (browser)", questions: [] },
        { index: 1, kind: "key", label: "Manually enter API Key", questions: [] },
      ]),
      provider("copilot", "GitHub Copilot", false, [
        {
          index: 0,
          kind: "browser",
          label: "Login with GitHub Copilot",
          questions: [
            {
              key: "deploymentType",
              message: "Select GitHub deployment type",
              kind: "select",
              options: [
                { label: "GitHub.com", value: "github.com" },
                { label: "GitHub Enterprise", value: "enterprise" },
              ],
              placeholder: null,
              when: null,
            },
            {
              key: "enterpriseUrl",
              message: "Enter your GitHub Enterprise URL",
              kind: "text",
              options: [],
              placeholder: "company.ghe.com",
              when: { key: "deploymentType", value: "enterprise" },
            },
          ],
        },
      ]),
    ];
  });

  const row = async (name: string) =>
    (await screen.findByText(name, { selector: "strong" })).closest(
      "[data-component='OpenCodeProviderRow']",
    ) as HTMLElement;

  it("lists OpenCode's providers, connected first, and finds the rest by search", async () => {
    render(() => <SwitchboardPage />);
    const anthropic = await row("Anthropic");
    expect(within(anthropic).getByText(t("providers.state.connected"))).toBeInTheDocument();
    fireEvent.input(screen.getByRole("searchbox", { name: t("providers.openCode.search") }), {
      target: { value: "copil" },
    });
    expect(await screen.findByText("GitHub Copilot")).toBeInTheDocument();
    expect(screen.queryByText("Anthropic", { selector: "strong" })).toBeNull();
  });

  it("signs in through the browser and waits for OpenCode to say it is connected", async () => {
    const opened = vi.fn();
    vi.stubGlobal("open", opened);
    answers["providers.openCode.startSignIn"] = {
      url: "https://auth.example.com/authorize",
      finish: "wait",
      instructions: "",
    };
    answers["providers.openCode.finishSignIn"] = { connected: true };
    render(() => <SwitchboardPage />);
    const openai = await row("OpenAI");
    fireEvent.click(within(openai).getByRole("button", { name: "Connect OpenAI" }));
    fireEvent.click(within(openai).getByRole("button", { name: /ChatGPT \(browser\)/ }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: "providers.openCode.finishSignIn",
        input: { providerId: "openai", method: 0 },
      }),
    );
    expect(calls).toContainEqual({
      method: "providers.openCode.startSignIn",
      input: { providerId: "openai", method: 0, answers: {} },
    });
    expect(opened).toHaveBeenCalledWith(
      "https://auth.example.com/authorize",
      "_blank",
      "noopener,noreferrer",
    );
    // Once connected, the list is asked for again.
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.method === "providers.openCode.list").length).toBe(2),
    );
  });

  it("asks the provider's questions first, showing a question only when it applies", async () => {
    vi.stubGlobal("open", vi.fn());
    answers["providers.openCode.startSignIn"] = {
      url: "https://github.example.com/login/device",
      finish: "code",
      instructions: "",
    };
    answers["providers.openCode.finishSignIn"] = { connected: true };
    render(() => <SwitchboardPage />);
    await row("Anthropic");
    fireEvent.input(screen.getByRole("searchbox", { name: t("providers.openCode.search") }), {
      target: { value: "copilot" },
    });
    const copilot = await row("GitHub Copilot");
    fireEvent.click(within(copilot).getByRole("button", { name: "Connect GitHub Copilot" }));
    fireEvent.click(within(copilot).getByRole("button", { name: /Login with GitHub Copilot/ }));
    expect(within(copilot).queryByText("Enter your GitHub Enterprise URL")).toBeNull();
    fireEvent.change(within(copilot).getByRole("combobox"), { target: { value: "enterprise" } });
    expect(
      await within(copilot).findByText("Enter your GitHub Enterprise URL"),
    ).toBeInTheDocument();
    fireEvent.input(within(copilot).getByRole("textbox"), { target: { value: "acme.ghe.com" } });
    fireEvent.click(within(copilot).getByRole("button", { name: t("providers.continue") }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: "providers.openCode.startSignIn",
        input: {
          providerId: "copilot",
          method: 0,
          answers: { deploymentType: "enterprise", enterpriseUrl: "acme.ghe.com" },
        },
      }),
    );
    // This provider shows a code on its page, to paste back here.
    fireEvent.input(await within(copilot).findByLabelText(t("providers.browser.codeLabel")), {
      target: { value: "ABCD-1234" },
    });
    fireEvent.click(within(copilot).getByRole("button", { name: t("providers.continue") }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: "providers.openCode.finishSignIn",
        input: { providerId: "copilot", method: 0, code: "ABCD-1234" },
      }),
    );
  });

  it("saves a key for a provider and never shows it back", async () => {
    answers["providers.openCode.saveKey"] = null;
    render(() => <SwitchboardPage />);
    const openai = await row("OpenAI");
    fireEvent.click(within(openai).getByRole("button", { name: "Connect OpenAI" }));
    fireEvent.click(within(openai).getByRole("button", { name: /Manually enter API Key/ }));
    const field = within(openai).getByLabelText(t("providers.key.label", { name: "OpenAI" }));
    expect(field).toHaveAttribute("type", "password");
    fireEvent.input(field, { target: { value: "sk-not-a-real-key" } });
    fireEvent.click(within(openai).getByRole("button", { name: t("providers.key.save") }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: "providers.openCode.saveKey",
        input: { providerId: "openai", key: "sk-not-a-real-key" },
      }),
    );
    await vi.waitFor(() => expect(screen.queryByDisplayValue("sk-not-a-real-key")).toBeNull());
  });

  it("disconnects a connected provider", async () => {
    answers["providers.openCode.disconnect"] = null;
    render(() => <SwitchboardPage />);
    const anthropic = await row("Anthropic");
    fireEvent.click(within(anthropic).getByRole("button", { name: "Disconnect Anthropic" }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: "providers.openCode.disconnect",
        input: { providerId: "anthropic" },
      }),
    );
  });

  it("says what went wrong when OpenCode cannot list its providers, and can ask again", async () => {
    answers["providers.openCode.list"] = new Error("OpenCode did not start in time.");
    render(() => <SwitchboardPage />);
    expect(await screen.findByText(/OpenCode did not start in time\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("common.retry") }));
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.method === "providers.openCode.list").length).toBe(2),
    );
  });
});

describe("SwitchboardPage install and order", () => {
  beforeEach(() => {
    answers["keyring.list"] = [];
    answers["agent.listBots"] = [];
    answers["providers.local.scan"] = [];
  });

  it("offers to install an engine that is not on this computer", async () => {
    answers["setup.engineStatus"] = [
      {
        engine: "codex",
        state: "not-installed",
        version: null,
        email: null,
        message: null,
        path: null,
      },
    ];
    answers["setup.installEngine"] = { result: "installed", engine: "codex", command: "x" };
    render(() => <SwitchboardPage />);
    const codex = (await screen.findByText("Codex", { selector: "strong" })).closest(
      "article",
    ) as HTMLElement;
    expect(within(codex).queryByText(t("providers.detected"))).toBeNull();
    fireEvent.click(within(codex).getByRole("button", { name: "Install Codex" }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({ method: "setup.installEngine", input: "codex" }),
    );
  });

  it("puts the providers most people mean right after the connected ones", async () => {
    answers["setup.engineStatus"] = [
      {
        engine: "opencode",
        state: "signed-in",
        version: "1.14.20",
        email: null,
        message: null,
        path: null,
      },
    ];
    const provider = (id: string, connected = false) => ({
      id,
      name: id,
      connected,
      models: 0,
      methods: [],
    });
    answers["providers.openCode.list"] = [
      provider("deepseek", true),
      provider("302ai"),
      provider("50x"),
      provider("openai"),
      provider("google"),
    ];
    render(() => <SwitchboardPage />);
    await screen.findByText("deepseek", { selector: "strong" });
    const names = [
      ...document.querySelectorAll("[data-component='OpenCodeProviderRow'] strong"),
    ].map((element) => element.textContent);
    expect(names).toEqual(["deepseek", "openai", "google", "302ai", "50x"]);
  });
});
