// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentService } from "../backend/agent-service";
import { BotStore } from "../backend/bot-store";
import { UnavailableBrowserService } from "../backend/browser-host";
import { MailboxStore } from "../backend/mailbox-store";
import { EngineSetup } from "../backend/setup/engine-setup";
import type { ProcessOutcome, ProcessRunner } from "../backend/setup/process-runner";
import { FakeAgentClient, fakeClientFactory } from "../backend/testing/fake-agent-client";
import type {
  SaveSetupStateInput,
  SetupEngineStatus,
  SetupEvent,
  SetupInstallResult,
  SetupLocateResult,
  SetupModels,
  SetupState,
} from "../shared/ipc";
import { EventHub } from "./event-hub";
import { createSetupMethods } from "./setup-methods";
import { SetupStore } from "./setup-store";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-setup-methods-"));
});

afterEach(async () => {
  await service?.stop();
  service = null;
  await rm(root, { recursive: true, force: true });
});

const ended = (code: number, output = ""): ProcessOutcome => ({
  code,
  aborted: false,
  timedOut: false,
  output,
});

/**
 * Setup's host methods on top of the real agent service, with an in-process Codex engine
 * and no Claude engine. No program is started: the runner only answers.
 */
async function harness(run: ProcessRunner["run"] = async () => ended(0)) {
  const data = join(root, "data");
  const bots = new BotStore(data, data);
  const mailbox = new MailboxStore(data, bots.sharedRoot);
  await bots.initialize();
  await mailbox.initialize();
  const agents = new AgentService(
    bots,
    mailbox,
    new UnavailableBrowserService(),
    null,
    5_000,
    "codex",
    fakeClientFactory({ codex: new FakeAgentClient() }),
  );
  service = agents;
  await agents.initialize();

  const hub = new EventHub();
  const published: SetupEvent[] = [];
  const store = new SetupStore(join(root, "setup.json"));
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const applied: Array<{ state: SetupState; changed: SaveSetupStateInput }> = [];
  const recorded: Array<[string, string, boolean]> = [];
  const paths = new Map<string, string>();
  const engines = new EngineSetup({
    runner: {
      run: (command, args, options) => {
        calls.push({ command, args });
        return run(command, args, options);
      },
    },
    probe: {
      check: (engine) => agents.checkProvider(engine),
      executable: async (engine) => `/opt/engines/${engine}`,
      models: (engine) => agents.modelsFor(engine),
      prefer: () => undefined,
    },
    emit: (event) => {
      published.push(event);
      hub.publish({ channel: "setup", payload: event });
    },
    remember: async (engine, path) => {
      await store.rememberEnginePath(engine, path);
      paths.set(engine, path);
    },
    remembered: (engine) => paths.get(engine) ?? null,
    platform: "linux",
    isFile: async () => true,
  });
  const methods = createSetupMethods({
    store,
    engines,
    applied: async (state, changed) => {
      applied.push({ state, changed });
    },
    record: (action, target, done) => recorded.push([action, target, done]),
  });
  const call = <T>(name: string, input?: unknown) =>
    Promise.resolve().then(() => methods[name]?.(input) as T);
  return { call, calls, applied, recorded, published, agents, hub };
}

describe("setup methods", () => {
  it("reads and saves what setup remembers, and tells the host what changed", async () => {
    const { call, applied } = await harness();
    expect(await call<SetupState>("setup.getState")).toMatchObject({
      completed: false,
      step: "language",
    });

    const saved = await call<SetupState>("setup.save", { language: "id", step: "engines" });
    expect(saved).toMatchObject({ language: "id", step: "engines", completed: false });
    expect(applied).toEqual([{ state: saved, changed: { language: "id", step: "engines" } }]);
    expect(await call<SetupState>("setup.getState")).toEqual(saved);
  });

  it("refuses input of the wrong shape or with unknown values", async () => {
    const { call, applied } = await harness();
    await expect(call("setup.save", null)).rejects.toThrow("Setup input is required.");
    await expect(call("setup.save", { consent: "yes" })).rejects.toThrow(
      "consent must be true or false.",
    );
    await expect(call("setup.save", { language: 7 })).rejects.toThrow("language must be text.");
    await expect(call("setup.save", { language: "fr" })).rejects.toThrow("Unknown language.");
    await expect(call("setup.save", { completed: true })).rejects.toThrow("Connect an engine");
    await expect(call("setup.installEngine", "other")).rejects.toThrow("Unknown engine.");
    await expect(call("setup.locateEngine", { engine: "claude" })).rejects.toThrow(
      "path is required.",
    );
    expect(applied).toEqual([]);
  });

  it("reports each engine through the detection the bots use", async () => {
    const { call } = await harness();
    const statuses = await call<SetupEngineStatus[]>("setup.engineStatus");
    expect(statuses).toMatchObject([
      // No Claude engine exists in this test, and the reason is passed on in plain words.
      { engine: "claude", state: "error", message: "claude is not installed in this test." },
      { engine: "codex", state: "signed-in", version: "0.0.0-fake", email: "fake@example.com" },
    ]);
  });

  it("gives the commands to copy, for the engine named either way", async () => {
    const { call } = await harness();
    expect(await call("setup.installCommand", "codex")).toEqual({
      engine: "codex",
      command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      shell: "terminal",
      alternative: "npm install -g @openai/codex",
    });
    expect(await call("setup.signInCommand", { engine: "claude" })).toEqual({
      engine: "claude",
      command: "claude auth login",
    });
  });

  it("installs an engine, streams the installer on the setup channel and logs the outcome", async () => {
    const { call, published, recorded, hub } = await harness(async (_command, _args, options) => {
      options?.onLine?.("Downloading...");
      return ended(0);
    });
    const frames: string[] = [];
    const reader = hub.subscribe().getReader();
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        frames.push(new TextDecoder().decode(value));
      }
    })();

    const result = await call<SetupInstallResult>("setup.installEngine", { engine: "codex" });

    expect(result).toMatchObject({ result: "installed", status: { state: "signed-in" } });
    expect(published.map((event) => event.type)).toEqual([
      "install-started",
      "install-progress",
      "install-progress",
      "install-finished",
    ]);
    expect(recorded).toEqual([["engine.installed", "codex", true]]);
    hub.close();
    await reading;
    const stream = frames.join("");
    expect(stream).toContain("event: setup\n");
    expect(stream).toContain('"type":"install-progress","engine":"codex","line":"Downloading..."');
  });

  it("logs a failed install as failed, with the reason in the answer", async () => {
    const { call, recorded } = await harness(async () =>
      ended(6, "curl: (6) Could not resolve host: claude.ai"),
    );
    expect(await call<SetupInstallResult>("setup.installEngine", "claude")).toMatchObject({
      result: "failed",
      reason: "no-internet",
      command: "curl -fsSL https://claude.ai/install.sh | bash",
    });
    expect(recorded).toEqual([["engine.installed", "claude", false]]);
    expect(await call("setup.cancelInstall", "claude")).toEqual({ cancelled: false });
  });

  it("accepts a located program and remembers it in the setup file", async () => {
    const { call, calls, recorded } = await harness(async () => ended(0, "codex-cli 0.150.0"));
    const located = await call<SetupLocateResult>("setup.locateEngine", {
      engine: "codex",
      path: join(root, "codex"),
    });
    expect(located).toMatchObject({ result: "located", version: "0.150.0" });
    expect(calls).toEqual([{ command: join(root, "codex"), args: ["--version"] }]);
    expect((await call<SetupState>("setup.getState")).enginePaths).toEqual({
      codex: join(root, "codex"),
    });
    expect(recorded).toEqual([["engine.located", "codex", true]]);
  });

  it("answers a sign-in for an engine that is already signed in, and starts nothing", async () => {
    const { call, calls } = await harness();
    expect(await call("setup.signIn", "codex")).toMatchObject({
      state: "signed-in",
      email: "fake@example.com",
      command: "codex login",
    });
    expect(await call("setup.cancelSignIn", "codex")).toEqual({ cancelled: false });
    expect(calls).toEqual([]);
  });

  it("lists an engine's models, and refuses for an engine that is not ready", async () => {
    const { call } = await harness();
    const models = await call<SetupModels>("setup.listModels", "codex");
    expect(models.fallback).toBe(false);
    expect(models.models.map((model) => model.id)).toContain("gpt-5.6-luna");
    expect(models.models.every((model) => model.id.startsWith("gpt-"))).toBe(true);
    await expect(call("setup.listModels", "claude")).rejects.toThrow("Sign in to Claude Code");
  });
});

describe("what the agent service tells setup", () => {
  it("falls back to the built-in list when an engine lists no model Markas knows", async () => {
    const data = join(root, "data");
    const bots = new BotStore(data, data);
    const mailbox = new MailboxStore(data, bots.sharedRoot);
    await bots.initialize();
    await mailbox.initialize();
    // This stand-in Claude engine answers the model list with a model of another engine.
    const agents = new AgentService(
      bots,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "claude",
      fakeClientFactory({ claude: new FakeAgentClient({ provider: "claude" }) }),
    );
    service = agents;
    await agents.initialize();

    const listed = agents.modelsFor("claude");
    expect(listed.listed).toBe(false);
    expect(listed.models.map((model) => model.id)).toEqual([
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
    ]);
    expect(await agents.checkProvider("claude")).toMatchObject({
      id: "claude",
      state: "available",
    });
  });

  it("starts new bots with the model setup chose", async () => {
    const { agents } = await harness();
    agents.setBotDefaults({ model: "gpt-5.6-sol", reasoningEffort: "high" });
    expect(await agents.createBot()).toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    agents.setBotDefaults(null);
    expect((await agents.createBot()).model).not.toBe("gpt-5.6-sol");
  });

  it("starts a bot made from a draft with the model setup chose, unless the draft says otherwise", async () => {
    const { agents } = await harness();
    agents.setBotDefaults({ model: "gpt-5.6-sol", reasoningEffort: "high" });
    const profile = {
      name: "Atlas",
      role: "Keeps notes",
      description: "Tidy the notes.",
      access: "ask" as const,
      avatarShape: "blob" as const,
      avatarColor: "green" as const,
    };

    expect(await agents.createBotFromProfile(profile)).toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    // A draft that names its own model keeps it.
    expect((await agents.createBotFromProfile({ ...profile, model: "gpt-5.6-luna" })).model).toBe(
      "gpt-5.6-luna",
    );
    // A draft that asks for the other engine does not get this engine's model.
    expect((await agents.createBotFromProfile({ ...profile, engine: "claude" })).model).toBe(
      "claude-opus-5",
    );
  });
});
