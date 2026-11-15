import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotDraft as HostDraft } from "../../../shared/bot-draft";
import type { SetupState } from "../../../shared/ipc";
import { closeHostEvents } from "../host-client";
import { t } from "../i18n";
import type { BotsClient } from "./bots-client";
import {
  botsClient,
  createFromHost,
  draftFromHost,
  draftToHost,
  importFromHost,
} from "./bots-host";
import { FirstRun } from "./FirstRun";
import {
  installFromHost,
  patchToHost,
  progressFromHost,
  type SetupClient,
  type SetupProgress,
  setupClient,
  signInFromHost,
  statusFromHost,
} from "./setup-client";

const HOST_STATE: SetupState = {
  completed: false,
  language: "id",
  preferredProvider: "claude",
  defaultModel: null,
  defaultReasoningEffort: "high",
  consentAt: null,
  step: "default-model",
  enginePaths: {},
};

describe("setup shapes between the host and the screens", () => {
  it("reads the host's steps and names as the screens know them", () => {
    expect(progressFromHost(HOST_STATE)).toEqual({
      completed: false,
      step: "model",
      language: "id",
      preferredProvider: "claude",
      defaultModel: null,
      defaultEffort: "high",
      consentAt: null,
    });
    expect(progressFromHost({ ...HOST_STATE, step: "how-bots-run" }).step).toBe("engines");
    expect(progressFromHost({ ...HOST_STATE, step: "first-bot" }).step).toBe("bot");
  });

  it("sends only what a step decided, in the host's words", () => {
    expect(patchToHost({ language: "en", step: "engines" })).toEqual({
      language: "en",
      step: "engines",
    });
    expect(
      patchToHost({
        preferredProvider: null,
        defaultModel: null,
        defaultEffort: "low",
        step: "model",
      }),
    ).toEqual({ defaultReasoningEffort: "low", step: "default-model" });
    expect(patchToHost({ consentAt: "2026-11-13T00:00:00.000Z", step: "dispatch" })).toEqual({
      consent: true,
      step: "dispatch",
    });
    expect(patchToHost({ completed: true })).toEqual({ completed: true });
  });

  it("turns the host's engine states and install endings into the screen's", () => {
    const base = {
      engine: "codex" as const,
      version: "1.0",
      email: null,
      message: null,
      path: null,
    };
    expect(statusFromHost({ ...base, state: "signed-in" }).state).toBe("ready");
    expect(statusFromHost({ ...base, state: "not-signed-in" }).state).toBe("sign-in-required");
    expect(statusFromHost({ ...base, state: "outdated" })).toMatchObject({
      id: "codex",
      state: "outdated",
    });
    expect(
      installFromHost({
        result: "failed",
        engine: "codex",
        reason: "node-missing",
        message: "Node is missing.",
        command: "x",
      }),
    ).toEqual({ ok: false, reason: "missing-tool", message: "Node is missing." });
    expect(installFromHost({ result: "cancelled", engine: "codex", command: "x" })).toMatchObject({
      ok: false,
      reason: "cancelled",
    });
    expect(
      signInFromHost({
        engine: "codex",
        state: "timed-out",
        message: null,
        email: null,
        command: "x",
      }),
    ).toEqual({ ok: false, reason: "timed-out", message: "" });
  });
});

describe("signing in to an engine", () => {
  class FakeEventSource {
    static last: FakeEventSource | null = null;
    readonly listeners = new Map<string, (event: unknown) => void>();
    constructor() {
      FakeEventSource.last = this;
    }
    addEventListener(type: string, listener: (event: unknown) => void) {
      this.listeners.set(type, listener);
    }
    close() {}
  }

  beforeEach(() => {
    closeHostEvents();
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    closeHostEvents();
    vi.unstubAllGlobals();
  });

  it("waits for the host to say how the sign-in ended", async () => {
    const waiting = {
      engine: "claude",
      state: "waiting",
      message: null,
      email: null,
      command: "x",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: waiting }), { status: 200 })),
    );
    let ended = false;
    const result = setupClient.signIn("claude").then((value) => {
      ended = true;
      return value;
    });
    await vi.waitFor(() => expect(FakeEventSource.last?.listeners.has("setup")).toBe(true));
    const send = (payload: unknown) =>
      FakeEventSource.last?.listeners.get("setup")?.({ data: JSON.stringify(payload) });

    // Another engine's news, and "still waiting", do not end it.
    send({ type: "sign-in", ...waiting, engine: "codex", state: "signed-in" });
    send({ type: "sign-in", ...waiting });
    await Promise.resolve();
    expect(ended).toBe(false);

    send({ type: "sign-in", ...waiting, state: "signed-in", email: "sol@example.com" });
    expect(await result).toEqual({ ok: true });
  });
});

describe("bot shapes between the host and the screens", () => {
  const hostDraft: HostDraft = {
    name: "Atlas",
    role: "Keeps the notes in order",
    instructions: "Tidy the notes folder.",
    sigil: { pattern: 3, color: "sky" },
    model: "gpt-5.6-luna" as HostDraft["model"],
    access: "ask",
    tags: ["Files"],
    round: {
      name: "Morning tidy",
      instruction: "Tidy up.",
      schedule: { kind: "interval", everyMinutes: 60 } as NonNullable<
        HostDraft["round"]
      >["schedule"],
    },
  };

  it("keeps a suggested round through the review screen and back", () => {
    const shown = draftFromHost(hostDraft);
    expect(shown.round).toMatchObject({ label: "Morning tidy", enabled: true });
    expect(shown.engine).toBe("codex");
    expect(shown.folder).toBe("");

    const kept = draftToHost(structuredClone(shown));
    expect(kept.round).toEqual(hostDraft.round);
    expect(kept.folder).toBeUndefined();
    expect(kept.model).toBe(hostDraft.model);
  });

  it("leaves out a round the person switched off, and sends the folder they typed", () => {
    const shown = draftFromHost(hostDraft);
    const sent = draftToHost(
      {
        ...shown,
        folder: "  /work/atlas ",
        round: shown.round && { ...shown.round, enabled: false },
      },
      true,
    );
    expect(sent.round).toBeUndefined();
    expect(sent.folder).toBe("/work/atlas");
    expect(sent.adoptExistingFolder).toBe(true);
  });

  it("reports a broken file and a folder already in use", () => {
    expect(
      importFromHost({
        ok: false,
        fileName: "juno.bot.md",
        message: "line 4 has no name",
        problems: [{ line: 4, message: "line 4 has no name" }],
      }),
    ).toEqual({ ok: false, message: "line 4 has no name", line: null });
    expect(
      createFromHost({
        ok: false,
        reason: "folder-in-use",
        message: "In use.",
        folder: "/bots/juno",
        inUse: true,
        usedByBot: null,
        canAdopt: true,
        suggestedName: "juno-2",
        suggestedFolder: "/bots/juno-2",
      }),
    ).toEqual({
      ok: false,
      reason: "folder-in-use",
      folder: "/bots/juno",
      suggestedFolder: "/bots/juno-2",
    });
  });

  it("asks a new bot to say hello, and keeps the bot when that fails", async () => {
    const created = { ok: true, bot: { id: "bot-1" }, round: null };
    const answer = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(answer(200, { result: created }))
      .mockResolvedValueOnce(answer(200, { result: {} }))
      .mockResolvedValueOnce(answer(200, { result: created }))
      .mockResolvedValueOnce(answer(500, { error: "The engine is not ready." }))
      .mockResolvedValueOnce(answer(200, { result: created }));
    vi.stubGlobal("fetch", fetchMock);
    const draft = draftFromHost(hostDraft);
    try {
      expect(await botsClient.create(draft)).toEqual({
        ok: true,
        botId: "bot-1",
        testRun: { state: "passed" },
      });
      expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/agent.sendMessage");
      expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body).input).toMatchObject({
        botId: "bot-1",
        text: t("review.hello.message"),
      });

      expect(await botsClient.create(draft)).toEqual({
        ok: true,
        botId: "bot-1",
        testRun: { state: "failed", message: "The engine is not ready." },
      });

      // Skipping the first run sends nothing more.
      expect(await botsClient.create(draft, { skipTestRun: true })).toMatchObject({
        testRun: { state: "skipped" },
      });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows what Dispatch said, with each draft ready for the review screen", async () => {
    const turn = {
      ok: false,
      reason: "limit",
      message: "Usage limit reached.",
      otherEngine: "codex",
      messages: [
        { id: "1", from: "you", text: "Keep my notes tidy." },
        { id: "2", from: "dispatch", text: "Here is a draft.", draft: hostDraft },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: turn }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const shown = await botsClient.sayToDispatch("Keep my notes tidy.");
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/dispatch.say");
      expect(shown).toMatchObject({ ok: false, reason: "limit", otherEngine: "codex" });
      expect(shown.messages[0]).toEqual(turn.messages[0]);
      expect(shown.messages[1]?.draft).toEqual(draftFromHost(hostDraft));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("FirstRun", () => {
  const progress: SetupProgress = {
    completed: false,
    step: "language",
    language: null,
    preferredProvider: null,
    defaultModel: null,
    defaultEffort: null,
    consentAt: null,
  };
  const bots = {} as BotsClient;
  const client = (getState: SetupClient["getState"]) => ({ getState }) as SetupClient;

  it("shows Markas when setup is finished", async () => {
    render(() => (
      <FirstRun setup={client(async () => ({ ...progress, completed: true }))} bots={bots}>
        <p>Markas itself</p>
      </FirstRun>
    ));
    expect(await screen.findByText("Markas itself")).toBeInTheDocument();
  });

  it("shows setup, not Markas, until setup is finished", async () => {
    render(() => (
      <FirstRun setup={client(async () => progress)} bots={bots}>
        <p>Markas itself</p>
      </FirstRun>
    ));
    expect(
      await screen.findByRole("heading", { name: t("setup.language.title") }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Markas itself")).not.toBeInTheDocument();
  });

  it("lets the person ask again when the host cannot say where setup stands", async () => {
    const getState = vi
      .fn<SetupClient["getState"]>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({ ...progress, completed: true });
    render(() => (
      <FirstRun setup={client(getState)} bots={bots}>
        <p>Markas itself</p>
      </FirstRun>
    ));
    fireEvent.click(await screen.findByRole("button", { name: t("common.retry") }));
    expect(await screen.findByText("Markas itself")).toBeInTheDocument();
  });
});
