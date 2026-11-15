// @vitest-environment node

import { describe, expect, it } from "vitest";
import type {
  AgentProviderId,
  AgentProviderState,
  AgentProviderStatus,
  SetupEvent,
} from "../../shared/ipc";
import { installCommand, installPlan, signInCommand } from "./engine-install";
import { EngineSetup, type EngineSetupOptions, readEngineVersion } from "./engine-setup";
import {
  cleanLine,
  NodeProcessRunner,
  type ProcessOutcome,
  type ProcessRunner,
  ProcessStartError,
  type RunOptions,
} from "./process-runner";

interface Call {
  command: string;
  args: readonly string[];
}
type Answer = (call: Call, options: RunOptions) => Promise<ProcessOutcome> | ProcessOutcome;

const exited = (code: number, output = ""): ProcessOutcome => ({
  code,
  aborted: false,
  timedOut: false,
  output,
});
const stopped: ProcessOutcome = { code: null, aborted: true, timedOut: false, output: "" };

/** Starts nothing. Each call is answered by the next scripted answer. */
class FakeRunner implements ProcessRunner {
  readonly calls: Call[] = [];
  readonly #answers: Answer[];

  constructor(...answers: Answer[]) {
    this.#answers = answers;
  }

  async run(command: string, args: readonly string[], options: RunOptions = {}) {
    const call = { command, args };
    this.calls.push(call);
    const answer = this.#answers.shift();
    if (!answer) throw new Error(`Unexpected program: ${command} ${args.join(" ")}`);
    return answer(call, options);
  }
}

/** A program that keeps running until it is stopped, like an installer or a sign-in window. */
const untilStopped: Answer = (_call, options) =>
  new Promise((resolve) => {
    options.signal?.addEventListener("abort", () => resolve(stopped), { once: true });
  });

const found = (
  id: AgentProviderId,
  state: AgentProviderState,
  extra: Partial<AgentProviderStatus> = {},
): AgentProviderStatus => ({ id, state, version: null, message: null, email: null, ...extra });

function harness(
  runner: ProcessRunner,
  /** What detection finds, one entry per look; the last one repeats. */
  states: AgentProviderStatus[],
  extra: Partial<EngineSetupOptions> = {},
) {
  const events: SetupEvent[] = [];
  const remembered = new Map<AgentProviderId, string>();
  const preferred: Array<[AgentProviderId, string | null]> = [];
  let looks = 0;
  let clock = 0;
  const setup = new EngineSetup({
    runner,
    probe: {
      check: async () => {
        const state = states[Math.min(looks, states.length - 1)];
        looks += 1;
        if (!state) throw new Error("detection broke");
        return state;
      },
      executable: async (engine) => `/opt/engines/${engine}`,
      models: (engine) => ({
        models: [
          {
            id: engine === "claude" ? "claude-sonnet-5" : "gpt-5.6-terra",
            name: "A model",
            description: "",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["medium"],
          },
        ],
        listed: false,
      }),
      prefer: (engine, path) => preferred.push([engine, path]),
    },
    emit: (event) => events.push(event),
    remember: async (engine, path) => {
      remembered.set(engine, path);
    },
    remembered: (engine) => remembered.get(engine) ?? null,
    platform: "linux",
    now: () => clock,
    // Time passes only when setup waits, so five minutes take no time at all.
    wait: async (ms) => {
      clock += ms;
    },
    isFile: async (path) => !path.includes("nothing-here"),
    ...extra,
  });
  return { setup, events, remembered, preferred, looks: () => looks, clock: () => clock };
}

const signInEvents = (events: SetupEvent[]) =>
  events.filter(
    (event): event is Extract<SetupEvent, { type: "sign-in" }> => event.type === "sign-in",
  );

describe("engine status", () => {
  const cases: Array<[string, AgentProviderStatus, object]> = [
    [
      "not installed",
      found("claude", "not-installed", { message: "Claude CLI was not found." }),
      {
        state: "not-installed",
        version: null,
        email: null,
        message: "Claude Code is not installed on this computer.",
      },
    ],
    [
      "installed but not signed in",
      found("claude", "sign-in-required", {
        version: "2.1.231",
        message: "Run `claude auth login`",
      }),
      {
        state: "not-signed-in",
        version: "2.1.231",
        message: "Claude Code is installed but not signed in.",
      },
    ],
    [
      "signed in, with version and account",
      found("claude", "available", { version: "2.1.231", email: "person@example.com" }),
      { state: "signed-in", version: "2.1.231", email: "person@example.com", message: null },
    ],
    [
      "signed in when the engine does not say who",
      found("codex", "available", { version: "0.150.0" }),
      { engine: "codex", state: "signed-in", version: "0.150.0", email: null },
    ],
    [
      "outdated",
      found("codex", "outdated", {
        version: "0.100.0",
        message: "Codex CLI 0.100.0 is too old. Markas requires 0.144.1 or newer.",
      }),
      {
        engine: "codex",
        state: "outdated",
        version: "0.100.0",
        message: "Codex CLI 0.100.0 is too old. Markas requires 0.144.1 or newer.",
      },
    ],
    [
      "error with a plain message",
      found("codex", "error", { message: "Codex requires a ChatGPT subscription login." }),
      { state: "error", message: "Codex requires a ChatGPT subscription login." },
    ],
    [
      "error when the check did not finish",
      found("claude", "checking"),
      { state: "error", message: "Markas could not finish checking Claude Code. Try again." },
    ],
  ];

  it.each(cases)("reports %s", async (_name, detection, expected) => {
    const { setup } = harness(new FakeRunner(), [detection]);
    expect(await setup.status(detection.id)).toMatchObject(expected);
  });

  it("reports an error instead of failing when detection itself breaks", async () => {
    const { setup } = harness(new FakeRunner(), []);
    expect(await setup.status("claude")).toMatchObject({
      state: "error",
      message: "detection broke",
    });
  });

  it("reports both engines", async () => {
    const { setup } = harness(new FakeRunner(), [found("claude", "not-installed")]);
    expect((await setup.statuses()).map((status) => status.engine)).toEqual(["claude", "codex"]);
  });
});

describe("the install command", () => {
  it("is the maker's own installer, which needs no admin rights and no Node.js", () => {
    expect(installCommand("claude", "darwin")).toEqual({
      engine: "claude",
      command: "curl -fsSL https://claude.ai/install.sh | bash",
      shell: "terminal",
      alternative: "npm install -g @anthropic-ai/claude-code",
    });
    expect(installCommand("claude", "win32")).toMatchObject({
      command: "irm https://claude.ai/install.ps1 | iex",
      shell: "powershell",
    });
    expect(installCommand("codex", "linux")).toMatchObject({
      command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      alternative: "npm install -g @openai/codex",
    });
    expect(installCommand("codex", "win32").command).toBe(
      "irm https://chatgpt.com/codex/install.ps1 | iex",
    );
  });

  it("never asks for admin rights on any system", () => {
    for (const engine of ["claude", "codex"] as const) {
      for (const platform of ["darwin", "linux", "win32"] as const) {
        for (const step of installPlan(engine, platform)) {
          const line = `${step.command} ${step.args.join(" ")} ${step.manual}`;
          expect(line).not.toMatch(/sudo|runas|-Verb\s+RunAs/i);
        }
      }
    }
  });
});

describe("installing an engine", () => {
  it("runs the installer, passes on what it prints, and reports the engine as installed", async () => {
    const runner = new FakeRunner((_call, options) => {
      options.onLine?.("Downloading Claude Code...");
      options.onLine?.("Installed to ~/.local/bin/claude");
      return exited(0);
    });
    const { setup, events } = harness(runner, [
      found("claude", "sign-in-required", { version: "2.1.231" }),
    ]);

    const result = await setup.install("claude");

    expect(result).toMatchObject({
      result: "installed",
      engine: "claude",
      status: { state: "not-signed-in", version: "2.1.231" },
      command: "curl -fsSL https://claude.ai/install.sh | bash",
    });
    expect(runner.calls).toEqual([
      { command: "/bin/sh", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"] },
    ]);
    expect(events).toEqual([
      {
        type: "install-started",
        engine: "claude",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
      },
      {
        type: "install-progress",
        engine: "claude",
        line: "Running: curl -fsSL https://claude.ai/install.sh | bash",
      },
      { type: "install-progress", engine: "claude", line: "Downloading Claude Code..." },
      { type: "install-progress", engine: "claude", line: "Installed to ~/.local/bin/claude" },
      { type: "install-finished", engine: "claude", result },
    ]);
  });

  const failures: Array<[string, ProcessOutcome, string, RegExp]> = [
    [
      "no internet",
      exited(6, "curl: (6) Could not resolve host: claude.ai"),
      "no-internet",
      /internet connection/,
    ],
    [
      "no internet, on Windows",
      exited(1, "irm : The remote name could not be resolved: 'claude.ai'"),
      "no-internet",
      /internet connection/,
    ],
    [
      "no internet, when the pipe hides the failed download",
      exited(0, "curl: (7) Failed to connect to claude.ai port 443"),
      "no-internet",
      /internet connection/,
    ],
    [
      "no permission",
      exited(1, "mkdir: cannot create directory '/home/person/.local': Permission denied"),
      "no-permission",
      /did not allow/,
    ],
    [
      "no permission, on Windows",
      exited(1, "Access to the path 'C:\\Users\\person\\.local\\bin' is denied."),
      "no-permission",
      /did not allow/,
    ],
    [
      "an installer that ran too long",
      { code: null, aborted: false, timedOut: true, output: "" },
      "no-internet",
      /try again/,
    ],
    ["something it cannot name", exited(3, "unexpected end of archive"), "unknown", /yourself/],
  ];

  it.each(failures)("fails plainly on %s", async (_name, outcome, reason, message) => {
    const { setup, events } = harness(new FakeRunner(() => outcome), [
      found("claude", "not-installed"),
    ]);
    const result = await setup.install("claude");
    expect(result).toMatchObject({
      result: "failed",
      reason,
      command: "curl -fsSL https://claude.ai/install.sh | bash",
    });
    expect(result.result === "failed" && result.message).toMatch(message);
    expect(events.at(-1)).toEqual({ type: "install-finished", engine: "claude", result });
  });

  it("says so when the installer finished but the engine still cannot be found", async () => {
    const { setup } = harness(new FakeRunner(() => exited(0, "Done.")), [
      found("codex", "not-installed"),
    ]);
    expect(await setup.install("codex")).toMatchObject({
      result: "failed",
      reason: "not-found-after-install",
      message: expect.stringMatching(/cannot find Codex yet/),
    });
  });

  it("falls back to npm when the installer's own tool is missing", async () => {
    const runner = new FakeRunner(
      () => exited(127, "sh: 1: curl: not found"),
      () => exited(0, "added 1 package"),
    );
    const { setup } = harness(runner, [found("codex", "sign-in-required", { version: "0.150.0" })]);
    expect(await setup.install("codex")).toMatchObject({ result: "installed" });
    expect(runner.calls[1]).toEqual({
      command: "/bin/sh",
      args: ["-lc", "npm install -g @openai/codex"],
    });
  });

  it("fails with a plain reason when npm and Node.js are missing too", async () => {
    const runner = new FakeRunner(
      () => {
        throw new ProcessStartError("spawn powershell.exe ENOENT", "not-found");
      },
      () => exited(1, "'npm.cmd' is not recognized as an internal or external command"),
    );
    const { setup } = harness(runner, [found("claude", "not-installed")], { platform: "win32" });
    const result = await setup.install("claude");
    expect(result).toMatchObject({
      result: "failed",
      reason: "node-missing",
      command: "irm https://claude.ai/install.ps1 | iex",
    });
    expect(result.result === "failed" && result.message).toMatch(/Node\.js and npm are not on/);
  });

  it("fails as no permission when the computer refuses to start the installer", async () => {
    const runner = new FakeRunner(() => {
      throw new ProcessStartError("spawn EPERM", "not-permitted");
    });
    const { setup } = harness(runner, [found("claude", "not-installed")]);
    expect(await setup.install("claude")).toMatchObject({ reason: "no-permission" });
  });

  it("can be cancelled while it runs, and can run again afterwards", async () => {
    const runner = new FakeRunner(untilStopped, () => exited(0));
    const { setup, events } = harness(runner, [found("claude", "sign-in-required")]);

    const running = setup.install("claude");
    await Promise.resolve();
    // A second install of the same engine does not start a second installer.
    expect(await setup.install("claude")).toMatchObject({
      result: "failed",
      reason: "already-running",
    });
    expect(setup.cancelInstall("claude")).toBe(true);
    expect(await running).toEqual({
      result: "cancelled",
      engine: "claude",
      command: "curl -fsSL https://claude.ai/install.sh | bash",
    });
    expect(events.at(-1)).toMatchObject({
      type: "install-finished",
      result: { result: "cancelled" },
    });
    expect(setup.cancelInstall("claude")).toBe(false);

    expect(await setup.install("claude")).toMatchObject({ result: "installed" });
  });
});

describe("pointing Markas at an existing program", () => {
  it("accepts the engine, remembers it and makes detection use it", async () => {
    const runner = new FakeRunner(() => exited(0, "2.1.231 (Claude Code)"));
    const { setup, remembered, preferred } = harness(runner, [
      found("claude", "sign-in-required", { version: "2.1.231" }),
    ]);

    const result = await setup.locate("claude", ' "/apps/claude/bin/claude" ');

    expect(result).toMatchObject({
      result: "located",
      path: "/apps/claude/bin/claude",
      version: "2.1.231",
      status: { state: "not-signed-in", path: "/apps/claude/bin/claude" },
    });
    expect(runner.calls).toEqual([{ command: "/apps/claude/bin/claude", args: ["--version"] }]);
    expect(remembered.get("claude")).toBe("/apps/claude/bin/claude");
    expect(preferred).toEqual([["claude", "/apps/claude/bin/claude"]]);
  });

  it("accepts Codex by the way Codex prints its version", async () => {
    const { setup } = harness(new FakeRunner(() => exited(0, "codex-cli 0.150.0")), [
      found("codex", "available", { version: "0.150.0" }),
    ]);
    expect(await setup.locate("codex", "/apps/codex")).toMatchObject({
      result: "located",
      version: "0.150.0",
    });
  });

  const wrong: Array<[string, Answer]> = [
    ["another program that prints a version", () => exited(0, "git version 2.47.1")],
    ["the other engine", () => exited(0, "codex-cli 0.150.0")],
    ["a program that prints only a number", () => exited(0, "22.11.0")],
    ["a program that fails", () => exited(2, "usage: thing [options]")],
    [
      "a file that cannot be started",
      () => {
        throw new ProcessStartError("spawn EACCES", "not-permitted");
      },
    ],
  ];

  it.each(wrong)("refuses %s, and remembers nothing", async (_name, answer) => {
    const { setup, remembered, preferred } = harness(new FakeRunner(answer), [
      found("claude", "not-installed"),
    ]);
    expect(await setup.locate("claude", "/usr/bin/something")).toMatchObject({
      result: "wrong-binary",
      engine: "claude",
    });
    expect(remembered.size).toBe(0);
    expect(preferred).toEqual([]);
  });

  it("says when nothing is there, without starting anything", async () => {
    const runner = new FakeRunner();
    const { setup } = harness(runner, [found("claude", "not-installed")]);
    expect(await setup.locate("claude", "/apps/nothing-here/claude")).toEqual({
      result: "missing",
      engine: "claude",
      message: "There is no program at /apps/nothing-here/claude.",
    });
    expect(await setup.locate("claude", "claude")).toMatchObject({ result: "missing" });
    expect(await setup.locate("claude", "  ")).toMatchObject({ result: "missing" });
    expect(runner.calls).toEqual([]);
  });

  it("tells the two engines apart by what they print", () => {
    expect(readEngineVersion("claude", "2.1.231 (Claude Code)")).toBe("2.1.231");
    expect(readEngineVersion("claude", "codex-cli 0.150.0")).toBeNull();
    expect(readEngineVersion("codex", "codex-cli 0.150.0")).toBe("0.150.0");
    expect(readEngineVersion("codex", "2.1.231 (Claude Code)")).toBeNull();
  });
});

describe("signing in", () => {
  it("starts the engine's own sign-in, waits, and reports signed in with the account", async () => {
    const runner = new FakeRunner(untilStopped);
    const { setup, events } = harness(runner, [
      found("claude", "sign-in-required"),
      found("claude", "sign-in-required"),
      found("claude", "sign-in-required"),
      found("claude", "available", { version: "2.1.231", email: "person@example.com" }),
    ]);

    expect(await setup.signIn("claude")).toEqual({
      engine: "claude",
      state: "waiting",
      message: null,
      email: null,
      command: "claude auth login",
    });
    await until(() => signInEvents(events).length === 1);

    expect(signInEvents(events)).toEqual([
      {
        type: "sign-in",
        engine: "claude",
        state: "signed-in",
        message: null,
        email: "person@example.com",
        command: "claude auth login",
      },
    ]);
    // Only the engine's own sign-in was started, and nothing was typed into it.
    expect(runner.calls).toEqual([{ command: "/opt/engines/claude", args: ["auth", "login"] }]);
  });

  it("uses Codex's own sign-in for Codex", async () => {
    const runner = new FakeRunner(untilStopped);
    const { setup, events } = harness(runner, [
      found("codex", "sign-in-required"),
      found("codex", "available"),
    ]);
    expect(await setup.signIn("codex")).toMatchObject({ state: "waiting", command: "codex login" });
    await until(() => signInEvents(events).length === 1);
    expect(runner.calls).toEqual([{ command: "/opt/engines/codex", args: ["login"] }]);
  });

  it("gives up after five minutes, stops the sign-in program and says what to do instead", async () => {
    let stoppedByTimeout = false;
    const runner = new FakeRunner(
      (_call, options) =>
        new Promise((resolve) => {
          options.signal?.addEventListener("abort", () => {
            stoppedByTimeout = true;
            resolve(stopped);
          });
        }),
    );
    const { setup, events, clock } = harness(runner, [found("claude", "sign-in-required")]);

    await setup.signIn("claude");
    await until(() => signInEvents(events).length === 1);

    expect(signInEvents(events)[0]).toMatchObject({
      state: "timed-out",
      email: null,
      command: "claude auth login",
      message: expect.stringMatching(/waited 5 minutes.*claude auth login/),
    });
    expect(clock()).toBeGreaterThanOrEqual(5 * 60_000);
    expect(clock()).toBeLessThan(5 * 60_000 + 10_000);
    expect(stoppedByTimeout).toBe(true);
    // Waiting again afterwards starts a fresh sign-in.
    expect(setup.cancelSignIn("claude")).toBe(false);
  });

  it("keeps waiting when the sign-in program ends well before the engine is signed in", async () => {
    const { setup, events } = harness(new FakeRunner(() => exited(0)), [
      found("claude", "sign-in-required"),
      found("claude", "sign-in-required"),
      found("claude", "sign-in-required"),
      found("claude", "available", { email: "person@example.com" }),
    ]);
    await setup.signIn("claude");
    await until(() => signInEvents(events).length === 1);
    expect(signInEvents(events)[0]).toMatchObject({ state: "signed-in" });
  });

  it("fails with the terminal command when the sign-in cannot be opened", async () => {
    const { setup, events } = harness(new FakeRunner(() => exited(1, "unknown command")), [
      found("codex", "sign-in-required"),
    ]);
    await setup.signIn("codex");
    await until(() => signInEvents(events).length === 1);
    expect(signInEvents(events)[0]).toMatchObject({
      state: "failed",
      message: "Codex could not open its sign-in. Run `codex login` in a terminal instead.",
    });
  });

  it("does not start a second sign-in while one is waiting, and can be cancelled", async () => {
    const runner = new FakeRunner(untilStopped);
    const { setup, events } = harness(runner, [found("claude", "sign-in-required")], {
      wait: (_ms, signal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
    });
    await setup.signIn("claude");
    expect(await setup.signIn("claude")).toMatchObject({ state: "waiting" });
    expect(runner.calls).toHaveLength(1);

    expect(setup.cancelSignIn("claude")).toBe(true);
    await until(() => signInEvents(events).length === 1);
    expect(signInEvents(events)[0]).toMatchObject({ state: "cancelled" });
  });

  it("answers at once when the engine is already signed in, and starts nothing", async () => {
    const runner = new FakeRunner();
    const { setup } = harness(runner, [found("claude", "available", { email: "a@example.com" })]);
    expect(await setup.signIn("claude")).toMatchObject({
      state: "signed-in",
      email: "a@example.com",
    });
    expect(runner.calls).toEqual([]);
  });

  it("does not try to sign in to an engine that is not installed", async () => {
    const runner = new FakeRunner();
    const { setup } = harness(runner, [found("codex", "not-installed")]);
    expect(await setup.signIn("codex")).toMatchObject({
      state: "failed",
      message: "Codex is not installed on this computer.",
    });
    expect(runner.calls).toEqual([]);
  });

  it("offers the command to run in a terminal instead", () => {
    const { setup } = harness(new FakeRunner(), []);
    expect(setup.signInCommand("claude")).toEqual({
      engine: "claude",
      command: "claude auth login",
    });
    expect(signInCommand("codex")).toBe("codex login");
  });
});

describe("listing models", () => {
  it("marks the built-in list as a fallback when the engine cannot list its models", async () => {
    const { setup } = harness(new FakeRunner(), [found("claude", "available")]);
    expect(await setup.models("claude")).toMatchObject({
      engine: "claude",
      fallback: true,
      models: [{ id: "claude-sonnet-5" }],
    });
  });

  it("refuses for an engine that is not ready", async () => {
    const { setup } = harness(new FakeRunner(), [found("codex", "sign-in-required")]);
    await expect(setup.models("codex")).rejects.toThrow(
      "Sign in to Codex before choosing a model.",
    );
  });
});

describe("the real process runner", () => {
  const runner = new NodeProcessRunner();

  it("runs a program, passes on its lines and reports how it ended", async () => {
    const lines: string[] = [];
    const outcome = await runner.run(
      process.execPath,
      ["-e", "console.log('one'); console.error('two'); process.exit(3)"],
      { onLine: (line) => lines.push(line) },
    );
    expect(outcome).toMatchObject({ code: 3, aborted: false, timedOut: false });
    expect(lines.sort()).toEqual(["one", "two"]);
    expect(outcome.output).toContain("one");
  });

  it("says when a program does not exist", async () => {
    await expect(runner.run("markas-no-such-program-here", [])).rejects.toMatchObject({
      name: "ProcessStartError",
      code: "not-found",
    });
  });

  it("stops a program when asked to", async () => {
    const stop = new AbortController();
    const running = runner.run(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
      signal: stop.signal,
    });
    setTimeout(() => stop.abort(), 200);
    expect(await running).toMatchObject({ code: null, aborted: true });
  });

  it("strips colour codes and control characters from what is shown", () => {
    const esc = String.fromCharCode(27);
    expect(cleanLine(`${esc}[32mDone${esc}[0m${String.fromCharCode(7)}  `)).toBe("Done");
  });
});

async function until(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition.");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
