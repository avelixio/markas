// @vitest-environment node

import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_TURN_MESSAGE,
  OpenCodeAgentClient,
  parseOpenCodeModels,
  SILENT_TURN_MESSAGE,
  turnsFromReplay,
} from "./opencode-client";
import type { AppServerNotification, AppServerRequest } from "./protocol";
import { FakeAcpAgent } from "./testing/fake-acp-agent";

let root: string;
let home: string;
/** A folder that is neither the bot's nor Markas's own. */
let elsewhere: string;
let client: OpenCodeAgentClient;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-opencode-"));
  home = join(root, "bots", "atlas");
  await mkdir(home, { recursive: true });
  // With its links followed, as the policy reports paths: on macOS /var is really /private/var.
  elsewhere = await realpath(await mkdtemp(join(tmpdir(), "markas-elsewhere-")));
});

afterEach(async () => {
  await client?.stop();
  await rm(root, { recursive: true, force: true });
  await rm(elsewhere, { recursive: true, force: true });
});

const MODELS = `anthropic/claude-sonnet-5
{
  "id": "claude-sonnet-5",
  "name": "Claude Sonnet 5",
  "variants": {
    "high": {},
    "max": {}
  }
}
deepseek/deepseek-flash
{
  "id": "deepseek-flash",
  "name": "DeepSeek Flash",
  "variants": {}
}
`;

const TOOLS = [
  {
    type: "namespace",
    name: "markas",
    tools: [
      {
        type: "function",
        name: "list_agents",
        description: "List Markas agents.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  },
];

function harness(
  options: { quietTurnMs?: number; models?: string; prepare?: (agent: FakeAcpAgent) => void } = {},
) {
  const agents: FakeAcpAgent[] = [];
  /** Ends the prompt that is open, the way OpenCode ends a turn. */
  let endPrompt: (value: unknown) => void = () => undefined;
  client = new OpenCodeAgentClient(
    { executable: "opencode", version: "1.14.20" },
    {
      connect: (start) => {
        const agent = new FakeAcpAgent(start);
        agent.handlers["session/prompt"] = () =>
          new Promise((resolve) => {
            endPrompt = resolve;
          });
        options.prepare?.(agent);
        agents.push(agent);
        return agent;
      },
      runCli: async () => options.models ?? MODELS,
      quietTurnMs: options.quietTurnMs,
    },
  );
  const requests: AppServerRequest[] = [];
  const notifications: AppServerNotification[] = [];
  client.on("request", (request) => requests.push(request));
  client.on("notification", (notification) => notifications.push(notification));
  client.start();

  const access = (level: string) => ({ markasAccess: { level, protectedRoots: [root] } });
  const start = async (level = "ask") => {
    const thread = await client.request<{ thread: { id: string } }>("thread/start", {
      cwd: home,
      runtimeWorkspaceRoots: [home],
      developerInstructions: "You are Atlas.",
      dynamicTools: TOOLS,
      ...access(level),
    });
    return thread.thread.id;
  };
  /** Starts a turn whose prompt stays open until `finish` is called. */
  const turn = async (threadId: string, level = "ask", extra: Record<string, unknown> = {}) => {
    await client.request("turn/start", {
      threadId,
      clientUserMessageId: "turn-1",
      input: [{ type: "text", text: "hello" }],
      ...access(level),
      ...extra,
    });
    await until(() => agents.at(-1)?.asked.at(-1)?.method === "session/prompt");
    return {
      agent: agents.at(-1) as FakeAcpAgent,
      finish: () => endPrompt({ stopReason: "end_turn" }),
    };
  };
  const methods = () => notifications.map((notification) => notification.method);
  const turnEnd = () =>
    notifications.find((notification) => notification.method === "turn/completed")?.params as
      | { turn: { status: string } }
      | undefined;
  return { agents, requests, notifications, start, turn, methods, turnEnd };
}

async function until(check: () => unknown, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("starting a conversation", () => {
  it("is ready only when OpenCode has a model, and lists the models under its own names", async () => {
    const h = harness();
    const account = await client.request<{ account: unknown }>("account/read", {});
    expect(account.account).toEqual({ type: "opencode", email: null, planType: null });
    const models = await client.request<{ data: unknown[] }>("model/list", {});
    expect(models.data).toEqual([
      {
        model: "opencode:anthropic/claude-sonnet-5",
        displayName: "Claude Sonnet 5 (anthropic)",
        supportedReasoningEfforts: [],
      },
      {
        model: "opencode:deepseek/deepseek-flash",
        displayName: "DeepSeek Flash (deepseek)",
        supportedReasoningEfforts: [],
      },
    ]);
    expect(h.agents).toHaveLength(0);
  });

  it("is not signed in when OpenCode has no model", async () => {
    harness({ models: "\n" });
    const account = await client.request<{ account: unknown }>("account/read", {});
    expect(account.account).toBeNull();
  });

  it("gives each conversation its own process with the bot's instructions and tools", async () => {
    const h = harness();
    expect(await h.start()).toBe("ses_new");
    const agent = h.agents[0];
    expect(agent.start.cwd).toBe(home);
    expect(agent.start.args).toEqual(["acp"]);
    const settings = agent.settings as {
      instructions: string[];
      mcp: Record<string, { url: string; headers: { Authorization: string } }>;
    };
    expect(await readFile(settings.instructions[0], "utf8")).toBe("You are Atlas.");
    // The instructions are kept where the bot's level does not let it write.
    expect(settings.instructions[0].startsWith(home)).toBe(false);
    expect(settings.mcp.markas.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\//);
    expect(settings.mcp.markas.headers.Authorization).toMatch(/^Bearer .{20,}/);
  });

  it("asks about everything below full access and ignores settings in the bot's folder", async () => {
    const h = harness();
    await h.start("ask");
    const agent = h.agents[0];
    const settings = agent.settings as {
      permission: Record<string, string>;
      agent: { build: { permission: Record<string, string> } };
    };
    expect(settings.permission["*"]).toBe("ask");
    expect(settings.permission.bash).toBe("ask");
    expect(settings.permission.read).toBe("ask");
    expect(settings.permission.task).toBe("deny");
    expect(settings.agent.build.permission).toEqual(settings.permission);
    expect(agent.start.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("1");
    expect(agent.start.env.OPENCODE_PERMISSION).toBeUndefined();
  });

  it("allows everything at full access", async () => {
    const h = harness();
    await h.start("full");
    const settings = h.agents[0].settings as { permission: Record<string, string> };
    expect(settings.permission["*"]).toBe("allow");
    expect(h.agents[0].start.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBeUndefined();
  });

  it("starts at the careful level when the request does not say", async () => {
    const h = harness();
    await client.request("thread/start", { cwd: home, developerInstructions: "" });
    const settings = h.agents[0].settings as { permission: Record<string, string> };
    expect(settings.permission["*"]).toBe("ask");
  });

  it("carries a conversation on by loading it, without showing the old messages again", async () => {
    const h = harness();
    await client.request("thread/resume", {
      threadId: "ses_old",
      cwd: home,
      developerInstructions: "",
    });
    expect(h.agents[0].asked.at(-1)).toEqual({
      method: "session/load",
      params: { sessionId: "ses_old", cwd: home, mcpServers: [] },
    });
    expect(h.notifications).toEqual([]);
  });
});

describe("a turn", () => {
  it("streams what the bot says and ends when OpenCode does", async () => {
    const h = harness();
    const threadId = await h.start();
    const { agent, finish } = await h.turn(threadId);
    const prompt = agent.asked.at(-1)?.params.prompt as Array<{ text: string }>;
    expect(prompt[0].text).toBe("markas-turn:turn-1\n");
    expect(prompt[1].text).toBe("hello");

    agent.update(threadId, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "Hel" },
    });
    agent.update(threadId, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "lo" },
    });
    agent.update(threadId, {
      sessionUpdate: "agent_message_chunk",
      messageId: "m2",
      content: { type: "text", text: "Done." },
    });
    finish();
    await until(() => h.turnEnd());
    expect(h.turnEnd()?.turn.status).toBe("completed");
    const done = h.notifications.find((entry) => entry.method === "item/completed")?.params as {
      item: { text: string };
    };
    expect(done.item.text).toBe("Hello\n\nDone.");
  });

  it("sets the bot's model as OpenCode sets it up, without picking one of its effort variants", async () => {
    // OpenCode's "high" for Claude Opus 5 asks for a kind of thinking that model refuses, so a
    // bot's effort is never turned into one of OpenCode's variants.
    const h = harness();
    const threadId = await h.start();
    const { agent } = await h.turn(threadId, "ask", {
      model: "opencode:anthropic/claude-sonnet-5",
      effort: "high",
    });
    const set = agent.asked.filter((entry) => entry.method === "session/set_model");
    expect(set.map((entry) => entry.params.modelId)).toEqual(["anthropic/claude-sonnet-5"]);
  });

  it("fails with a plain reason when OpenCode ends the turn without saying or doing anything", async () => {
    const h = harness();
    const threadId = await h.start();
    const { finish } = await h.turn(threadId);
    finish();
    await until(() => h.turnEnd());
    expect(h.turnEnd()?.turn.status).toBe("failed");
    const error = h.notifications.find((entry) => entry.method === "error")?.params as {
      message: string;
    };
    expect(error.message).toBe(EMPTY_TURN_MESSAGE);
  });

  it("fails with a plain reason when nothing at all happens for too long", async () => {
    const h = harness({ quietTurnMs: 30 });
    const threadId = await h.start();
    const { agent } = await h.turn(threadId);
    await until(() => h.turnEnd());
    expect(h.turnEnd()?.turn.status).toBe("failed");
    const error = h.notifications.find((entry) => entry.method === "error")?.params as {
      message: string;
    };
    expect(error.message).toBe(SILENT_TURN_MESSAGE);
    expect(agent.notices.at(-1)?.method).toBe("session/cancel");
  });

  it("does not call a turn silent while a tool is running", async () => {
    const h = harness({ quietTurnMs: 30 });
    const threadId = await h.start();
    const { agent, finish } = await h.turn(threadId);
    agent.update(threadId, { sessionUpdate: "tool_call", toolCallId: "c1", title: "bash" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(h.turnEnd()).toBeUndefined();
    agent.update(threadId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      title: "bash",
      status: "completed",
    });
    finish();
    await until(() => h.turnEnd());
    expect(h.turnEnd()?.turn.status).toBe("completed");
  });

  it("stops when the person stops it", async () => {
    const h = harness();
    const threadId = await h.start();
    const { agent, finish } = await h.turn(threadId);
    await client.request("turn/interrupt", { threadId });
    expect(agent.notices.at(-1)).toEqual({
      method: "session/cancel",
      params: { sessionId: threadId },
    });
    finish();
    await until(() => h.turnEnd());
    expect(h.turnEnd()?.turn.status).toBe("interrupted");
  });

  it("fails only that conversation when its process ends, and starts it again when needed", async () => {
    const h = harness();
    const threadId = await h.start();
    const { agent } = await h.turn(threadId);
    let exited = false;
    client.once("exit", () => {
      exited = true;
    });
    agent.die();
    await until(() => h.turnEnd());
    expect(h.turnEnd()?.turn.status).toBe("failed");
    expect(exited).toBe(false);

    h.notifications.length = 0;
    await h.turn(threadId);
    expect(h.agents).toHaveLength(2);
    expect(h.agents[1].asked.some((entry) => entry.method === "session/load")).toBe(true);
  });

  it("ends a conversation's process for good when its bot is deleted", async () => {
    const h = harness();
    const threadId = await h.start();
    await h.turn(threadId);

    await client.closeThread(threadId);

    expect(h.agents[0].stopped).toBe(true);
    await expect(
      client.request("turn/start", { threadId, input: [{ type: "text", text: "Again" }] }),
    ).rejects.toThrow();
    expect(h.agents).toHaveLength(1);
  });

  it("starts the process again under the new rules when the bot's level changes", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    await h.turn(threadId, "full");
    expect(h.agents).toHaveLength(2);
    expect(h.agents[0].stopped).toBe(true);
    const settings = h.agents[1].settings as { permission: Record<string, string> };
    expect(settings.permission["*"]).toBe("allow");
  });

  it("reports how full the conversation is", async () => {
    const h = harness();
    const threadId = await h.start();
    const { agent } = await h.turn(threadId);
    agent.update(threadId, { sessionUpdate: "usage_update", used: 1200, size: 200000 });
    const usage = h.notifications.find((entry) => entry.method === "thread/tokenUsage/updated");
    expect(usage?.params).toEqual({
      threadId,
      tokenUsage: { last: { totalTokens: 1200 }, modelContextWindow: 200000 },
    });
    expect(await client.contextBreakdown(threadId)).toMatchObject({
      usedTokens: 1200,
      maxTokens: 200000,
    });
  });
});

describe("permission", () => {
  const running = (agent: FakeAcpAgent, threadId: string, tool: string, input: unknown) => {
    agent.update(threadId, { sessionUpdate: "tool_call", toolCallId: "c1", title: tool });
    agent.update(threadId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      title: tool,
      status: "in_progress",
      rawInput: input,
    });
  };

  it("lets the bot read its own folder without asking", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const { agent } = await h.turn(threadId);
    running(agent, threadId, "read", { filePath: join(home, "notes.md") });
    expect(await agent.askPermission(threadId, "c1", "read")).toBe("once");
    expect(h.requests).toEqual([]);
  });

  it("asks the person about a file outside the bot's folder, and passes a yes on for one call", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const { agent } = await h.turn(threadId);
    const outside = join(elsewhere, "secret.txt");
    running(agent, threadId, "read", { filePath: outside });
    const chosen = agent.askPermission(threadId, "c1", "external_directory");
    await until(() => h.requests.length === 1);
    expect(h.requests[0].method).toBe("item/permission/request");
    expect(h.requests[0].params).toMatchObject({
      threadId,
      turnId: "turn-1",
      itemId: "c1",
      kind: "read",
      detail: outside,
    });
    client.respond(h.requests[0].id, { decision: "once" });
    // OpenCode's own "always" is never chosen, so it keeps asking.
    expect(await chosen).toBe("once");
    // The same call asked about again, now as a read, is not put to the person twice.
    expect(await agent.askPermission(threadId, "c1", "read")).toBe("once");
    expect(h.requests).toHaveLength(1);
  });

  it("refuses when the person says no", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const { agent } = await h.turn(threadId);
    running(agent, threadId, "bash", { command: "rm -rf build" });
    const chosen = agent.askPermission(threadId, "c1", "bash");
    await until(() => h.requests.length === 1);
    expect(h.requests[0].params).toMatchObject({ kind: "command", detail: "rm -rf build" });
    client.respond(h.requests[0].id, { decision: "deny" });
    expect(await chosen).toBe("reject");
  });

  it("asks about a command every time, even after a yes for the chat on something else", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const { agent } = await h.turn(threadId);
    running(agent, threadId, "bash", { command: "ls" });
    const first = agent.askPermission(threadId, "c1", "bash");
    await until(() => h.requests.length === 1);
    client.respond(h.requests[0].id, { decision: "chat" });
    await first;
    agent.update(threadId, { sessionUpdate: "tool_call", toolCallId: "c2", title: "bash" });
    agent.update(threadId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "c2",
      title: "bash",
      status: "in_progress",
      rawInput: { command: "ls" },
    });
    const second = agent.askPermission(threadId, "c2", "bash");
    await until(() => h.requests.length === 2);
    client.respond(h.requests[1].id, { decision: "once" });
    expect(await second).toBe("once");
  });

  it("remembers a yes for the chat on a folder", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const { agent } = await h.turn(threadId);
    running(agent, threadId, "read", { filePath: join(elsewhere, "a.md") });
    const first = agent.askPermission(threadId, "c1", "read");
    await until(() => h.requests.length === 1);
    client.respond(h.requests[0].id, { decision: "chat" });
    await first;
    agent.update(threadId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "c2",
      title: "read",
      status: "in_progress",
      rawInput: { filePath: join(elsewhere, "b.md") },
    });
    expect(await agent.askPermission(threadId, "c2", "read")).toBe("once");
    expect(h.requests).toHaveLength(1);
  });

  it("drops a yes for the chat on a folder when Markas says the level was changed since", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const first = await h.turn(threadId);
    running(first.agent, threadId, "read", { filePath: join(elsewhere, "a.md") });
    const asked = first.agent.askPermission(threadId, "c1", "read");
    await until(() => h.requests.length === 1);
    client.respond(h.requests[0].id, { decision: "chat" });
    await asked;
    first.finish();
    await until(() => h.turnEnd() !== undefined);

    const { agent } = await h.turn(threadId, "ask", { forgetChatGrants: true });
    running(agent, threadId, "read", { filePath: join(elsewhere, "b.md") });
    const again = agent.askPermission(threadId, "c1", "read");
    await until(() => h.requests.length === 2);
    expect(h.requests[1].params).toMatchObject({ kind: "read" });
    client.respond(h.requests[1].id, { decision: "deny" });
    await again;
  });

  it("keeps a yes for the chat on a folder across turns when nothing changed", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const first = await h.turn(threadId);
    running(first.agent, threadId, "read", { filePath: join(elsewhere, "a.md") });
    const asked = first.agent.askPermission(threadId, "c1", "read");
    await until(() => h.requests.length === 1);
    client.respond(h.requests[0].id, { decision: "chat" });
    await asked;
    first.finish();
    await until(() => h.turnEnd() !== undefined);

    const { agent } = await h.turn(threadId, "ask");
    running(agent, threadId, "read", { filePath: join(elsewhere, "b.md") });
    expect(await agent.askPermission(threadId, "c1", "read")).toBe("once");
    expect(h.requests).toHaveLength(1);
  });

  it("asks about a call it knows nothing about instead of letting it through", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const { agent } = await h.turn(threadId);
    const chosen = agent.askPermission(threadId, "unknown-call", "some_plugin_tool");
    await until(() => h.requests.length === 1);
    expect(h.requests[0].params).toMatchObject({
      kind: "tool",
      detail: "opencode:some_plugin_tool",
    });
    client.respond(h.requests[0].id, { decision: "deny" });
    expect(await chosen).toBe("reject");
  });

  it("refuses when the turn is stopped while the question is open", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const { agent } = await h.turn(threadId);
    running(agent, threadId, "bash", { command: "sleep 100" });
    const chosen = agent.askPermission(threadId, "c1", "bash");
    await until(() => h.requests.length === 1);
    await client.request("turn/interrupt", { threadId });
    expect(await chosen).toBe("reject");
  });

  it("answers OpenCode's offer of the new file text without writing anything itself", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    const { agent } = await h.turn(threadId);
    expect(await agent.ask("fs/write_text_file", { path: "x", content: "y" })).toEqual({});
    expect(await agent.ask("terminal/create", {})).toEqual({
      error: "Markas does not offer terminal/create.",
    });
  });
});

describe("Markas's own tools", () => {
  it("reach the host through the local tool server, with the conversation's secret", async () => {
    const h = harness();
    const threadId = await h.start("ask");
    await h.turn(threadId);
    const settings = h.agents[0].settings as {
      mcp: Record<string, { url: string; headers: { Authorization: string } }>;
    };
    const { url, headers } = settings.mcp.markas;
    const call = (body: unknown, auth = headers.Authorization) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify(body),
      });

    expect(
      (await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "Bearer wrong")).status,
    ).toBe(401);
    const listed = (await (await call({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(["list_agents"]);

    const answer = call({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_agents", arguments: {} },
    });
    await until(() => h.requests.length === 1);
    expect(h.requests[0].method).toBe("item/tool/call");
    expect(h.requests[0].params).toMatchObject({
      threadId,
      turnId: "turn-1",
      namespace: "markas",
      tool: "list_agents",
    });
    client.respond(h.requests[0].id, {
      success: true,
      contentItems: [{ type: "inputText", text: "Atlas, Juno" }],
    });
    const result = (await (await answer).json()) as { result: unknown };
    expect(result.result).toEqual({
      content: [{ type: "text", text: "Atlas, Juno" }],
      isError: false,
    });
  });
});

describe("reading a conversation back", () => {
  it("finds each turn again by the line Markas put in front of the message", () => {
    const turns = turnsFromReplay([
      { kind: "user", messageId: "u1", text: "markas-turn:turn-1\n", audience: ["user"] },
      { kind: "user", messageId: "u1", text: "hello", audience: [] },
      { kind: "user", messageId: "u1", text: "(added for the model)", audience: ["assistant"] },
      { kind: "agent", messageId: "a1", text: "Hi ", audience: [] },
      { kind: "agent", messageId: "a1", text: "there.", audience: [] },
      { kind: "agent", messageId: "a2", text: "Done.", audience: [] },
      { kind: "user", messageId: "u2", text: "typed in OpenCode itself", audience: [] },
    ]);
    expect(turns).toEqual([
      {
        id: "turn-1",
        status: "completed",
        items: [
          {
            id: "turn-1",
            type: "userMessage",
            clientId: "turn-1",
            content: [{ type: "text", text: "hello" }],
          },
          { id: "a1", type: "agentMessage", text: "Hi there." },
          { id: "a2", type: "agentMessage", text: "Done." },
        ],
      },
      {
        id: "u2",
        status: "completed",
        items: [
          {
            id: "u2",
            type: "userMessage",
            clientId: "u2",
            content: [{ type: "text", text: "typed in OpenCode itself" }],
          },
        ],
      },
    ]);
  });

  it("reads from a short-lived process when the conversation has none", async () => {
    const h = harness({
      prepare: (agent) => {
        agent.handlers["session/load"] = () => {
          agent.update("ses_old", {
            sessionUpdate: "user_message_chunk",
            messageId: "u1",
            content: { type: "text", text: "hello" },
          });
          agent.update("ses_old", {
            sessionUpdate: "agent_message_chunk",
            messageId: "a1",
            content: { type: "text", text: "Hi." },
          });
          return {};
        };
      },
    });
    const read = await client.request<{ thread: { turns: unknown[] } }>("thread/read", {
      threadId: "ses_old",
      cwd: home,
    });
    expect(read.thread.turns).toHaveLength(1);
    const agent = h.agents[0];
    expect(agent.stopped).toBe(true);
    // It is given no tools and none of the bot's settings: it is only read from.
    expect(agent.start.env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});

describe("the model list OpenCode prints", () => {
  it("is read with each model's name and variants", () => {
    expect(parseOpenCodeModels(MODELS)).toEqual([
      {
        name: "anthropic/claude-sonnet-5",
        label: "Claude Sonnet 5 (anthropic)",
        variants: ["high", "max"],
      },
      { name: "deepseek/deepseek-flash", label: "DeepSeek Flash (deepseek)", variants: [] },
    ]);
  });

  it("is still read when the details are missing", () => {
    expect(parseOpenCodeModels("opencode/big-pickle\r\nsome noise\r\n")).toEqual([
      { name: "opencode/big-pickle", label: "opencode/big-pickle", variants: [] },
    ]);
  });
});
