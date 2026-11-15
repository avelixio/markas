// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookJSONOutput, Options, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeAgentClient, isEngineNote } from "./claude-client";
import type { AppServerRequest } from "./protocol";

let root: string;
let home: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-claude-access-"));
  home = join(root, "bots", "atlas");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A Claude session that never says anything: these tests only exercise the permission path. */
function silentQuery(): Query {
  let end: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    end = resolve;
  });
  const query = {
    [Symbol.asyncIterator]: () => query,
    next: async (): Promise<IteratorResult<SDKMessage>> => {
      await closed;
      return { done: true, value: undefined };
    },
    interrupt: async () => undefined,
    setModel: async () => undefined,
    setMaxThinkingTokens: async () => undefined,
    close: () => end?.(),
  };
  return query as unknown as Query;
}

function harness() {
  const sessions: Options[] = [];
  const client = new ClaudeAgentClient({ executable: "claude", version: "2.1.231" }, (params) => {
    sessions.push(params.options ?? {});
    return silentQuery();
  });
  const requests: AppServerRequest[] = [];
  client.on("request", (request) => requests.push(request));
  client.start();

  const start = async (level?: string) => {
    const thread = await client.request<{ thread: { id: string } }>("thread/start", {
      cwd: home,
      runtimeWorkspaceRoots: [home],
      developerInstructions: "",
      ...(level ? { markasAccess: { level, protectedRoots: [root] } } : {}),
    });
    return thread.thread.id;
  };
  /** Runs the hook Markas installs, the way Claude does before every tool call. */
  const use = (tool: string, input: unknown, signal = new AbortController().signal) => {
    const hook = sessions.at(-1)?.hooks?.PreToolUse?.[0]?.hooks[0];
    if (!hook) throw new Error("No permission hook was installed.");
    return hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: input,
        tool_use_id: "use-1",
        session_id: "s",
        transcript_path: "",
        cwd: home,
      },
      "use-1",
      { signal },
    );
  };
  return { client, sessions, requests, start, use };
}

const decisionOf = (output: HookJSONOutput) =>
  "hookSpecificOutput" in output && output.hookSpecificOutput?.hookEventName === "PreToolUse"
    ? output.hookSpecificOutput.permissionDecision
    : undefined;

describe("engine notes", () => {
  it("tells the engine's own notes from what the person wrote", () => {
    expect(isEngineNote("<task-notification>\n<task-id>a1</task-id>")).toBe(true);
    expect(isEngineNote("  <system-reminder>be careful</system-reminder>")).toBe(true);
    expect(isEngineNote("Focus on my work and projects.")).toBe(false);
    // The person quoting such a tag mid-sentence is still the person.
    expect(isEngineNote("what is <task-notification> in my chat?")).toBe(false);
  });
});

describe("ClaudeAgentClient access levels", () => {
  it("starts careful when nothing says otherwise, and takes no settings from the bot's folder", async () => {
    const { sessions, start } = harness();
    await start();
    expect(sessions[0]).toMatchObject({
      permissionMode: "default",
      allowDangerouslySkipPermissions: false,
      settingSources: ["user"],
    });
  });

  it("lets work inside the bot's folder through without asking", async () => {
    const { requests, start, use } = harness();
    await start("ask");
    expect(decisionOf(await use("Write", { file_path: join(home, "notes.md") }))).toBe("allow");
    expect(decisionOf(await use("Read", { file_path: "notes.md" }))).toBe("allow");
    expect(requests).toEqual([]);
  });

  it("asks the person before a command, and follows the answer", async () => {
    const { client, requests, start, use } = harness();
    const threadId = await start("ask");

    const allowed = use("Bash", { command: "git status" });
    await waitFor(() => requests.length === 1);
    expect(requests[0]).toMatchObject({
      method: "item/permission/request",
      params: { threadId, kind: "command", detail: "git status", grant: null },
    });
    client.respond(requests[0]?.id ?? "", { decision: "once" });
    expect(decisionOf(await allowed)).toBe("allow");

    // Once means once: the same command asks again.
    const refused = use("Bash", { command: "git status" });
    await waitFor(() => requests.length === 2);
    client.respond(requests[1]?.id ?? "", { decision: "deny" });
    const output = await refused;
    expect(decisionOf(output)).toBe("deny");
    expect(JSON.stringify(output)).toContain("did not allow");
  });

  it("treats an unclear answer as no", async () => {
    const { client, requests, start, use } = harness();
    await start("ask");
    const pending = use("Bash", { command: "ls" });
    await waitFor(() => requests.length === 1);
    client.respond(requests[0]?.id ?? "", { decision: "sure, whatever" });
    expect(decisionOf(await pending)).toBe("deny");
  });

  it("remembers a yes for the chat for that folder only", async () => {
    const { client, requests, start, use } = harness();
    await start("ask");
    const projects = join(root, "..", "projects-elsewhere");

    const first = use("Read", { file_path: join(projects, "a.txt") });
    await waitFor(() => requests.length === 1);
    client.respond(requests[0]?.id ?? "", { decision: "chat" });
    expect(decisionOf(await first)).toBe("allow");

    expect(decisionOf(await use("Read", { file_path: join(projects, "b.txt") }))).toBe("allow");
    expect(requests).toHaveLength(1);

    // A different folder, and changing instead of reading, both ask again.
    void use("Write", { file_path: join(projects, "a.txt") });
    await waitFor(() => requests.length === 2);
  });

  it("refuses when the turn is stopped while the question is open", async () => {
    const { requests, start, use } = harness();
    await start("ask");
    const stop = new AbortController();
    const pending = use("Bash", { command: "ls" }, stop.signal);
    await waitFor(() => requests.length === 1);
    stop.abort();
    expect(decisionOf(await pending)).toBe("deny");
  });

  it("asks for Markas's own data even when the bot may read freely", async () => {
    const { requests, start, use } = harness();
    await start("read");
    expect(decisionOf(await use("Read", { file_path: join(root, "..", "anything.txt") }))).toBe(
      "allow",
    );
    void use("Read", { file_path: join(root, "token") });
    await waitFor(() => requests.length === 1);
    expect(requests[0]).toMatchObject({ params: { kind: "protected", grant: null } });
  });

  it("never asks at full access", async () => {
    const { sessions, requests, start, use } = harness();
    await start("full");
    expect(sessions[0]).toMatchObject({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["user", "project", "local"],
    });
    expect(decisionOf(await use("Bash", { command: "anything" }))).toBe("allow");
    expect(requests).toEqual([]);
  });

  it("lets a round's turn use its standing permissions, reports each use once, and still asks for the rest", async () => {
    const { client, requests, start, use } = harness();
    const notes: Array<{ method: string; params?: unknown }> = [];
    client.on("notification", (notification) => notes.push(notification));
    const threadId = await start("ask");
    const reports = join(root, "..", "reports-elsewhere");
    const standing = [
      { type: "read-folder", path: reports, level: "ask", grantedAt: "2026-11-12T00:00:00.000Z" },
    ];

    // Before the round's turn there is nothing standing, so the same read asks.
    void use("Read", { file_path: join(reports, "q3.csv") });
    await waitFor(() => requests.length === 1);

    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "[Round: Morning check]" }],
      markasAccess: { level: "ask", protectedRoots: [root], standing },
    });
    expect(decisionOf(await use("Read", { file_path: join(reports, "q3.csv") }))).toBe("allow");
    // Claude can judge one call twice; the Logbook must hear of it once.
    expect(decisionOf(await use("Read", { file_path: join(reports, "q3.csv") }))).toBe("allow");
    expect(requests).toHaveLength(1);
    const used = notes.filter((note) => note.method === "standing/used");
    expect(used).toHaveLength(1);
    expect(used[0]?.params).toMatchObject({ threadId, grant: { type: "read-folder" } });

    // Outside the standing permission the round still stops at a card.
    void use("Write", { file_path: join(reports, "q3.csv") });
    await waitFor(() => requests.length === 2);
    expect(requests[1]).toMatchObject({ params: { kind: "write" } });
    void use("Bash", { command: "ls" });
    await waitFor(() => requests.length === 3);
  });

  it("restarts the session when the level changes, so nothing from the old level lingers", async () => {
    const { client, sessions, requests, start, use } = harness();
    const threadId = await start("full");
    await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: "hello" }],
      markasAccess: { level: "ask", protectedRoots: [root] },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[1]).toMatchObject({
      permissionMode: "default",
      settingSources: ["user"],
      resume: threadId,
    });
    void use("Bash", { command: "ls" });
    await waitFor(() => requests.length === 1);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
