// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared/ipc";
import { AgentService } from "./agent-service";
import { BotStore } from "./bot-store";
import { UnavailableBrowserService } from "./browser-host";
import { MailboxStore } from "./mailbox-store";
import { FakeAgentClient, fakeClientFactory } from "./testing/fake-agent-client";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-access-service-test-"));
});

afterEach(async () => {
  await service?.stop();
  service = null;
  // A turn that just ended may still be saving its preview.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function setup() {
  const client = new FakeAgentClient({ autoReply: "ok" });
  const store = new BotStore(join(root, "data"), join(root, "data"));
  const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
  await store.initialize();
  await mailbox.initialize();
  const created = new AgentService(
    store,
    mailbox,
    new UnavailableBrowserService(),
    null,
    5_000,
    "codex",
    fakeClientFactory({ codex: client }),
  );
  service = created;
  const events: AgentEvent[] = [];
  created.on("event", (event) => events.push(event));
  await created.initialize();
  const bot = await created.createBot();
  // One finished turn gives the bot a thread the engine can ask about.
  await created.sendMessage({ botId: bot.id, text: "hello" });
  await waitFor(() => events.some((event) => event.type === "turn-completed"));
  const threadId = created.listBots().find((item) => item.id === bot.id)?.threadId ?? "";
  const prompts = () =>
    events.filter(
      (event): event is Extract<AgentEvent, { type: "prompt" }> => event.type === "prompt",
    );
  return { service: created, client, store, events, bot, threadId, prompts };
}

describe("AgentService access levels", () => {
  it("creates bots at the careful level and starts their engine that way", async () => {
    const { client, bot } = await setup();
    expect(bot.access).toBe("ask");
    const start = client.requests.find((request) => request.method === "thread/start");
    expect(start?.params).toMatchObject({
      approvalPolicy: "untrusted",
      sandbox: "workspace-write",
    });
    const turn = client.requests.find((request) => request.method === "turn/start");
    expect(turn?.params).toMatchObject({
      approvalPolicy: "untrusted",
      sandboxPolicy: { type: "workspaceWrite", networkAccess: false },
    });
  });

  it("shows a permission card and passes the person's yes to the engine", async () => {
    const { service, client, bot, threadId, prompts } = await setup();
    client.sendRequest({
      id: "ask-1",
      method: "item/permission/request",
      params: {
        threadId,
        turnId: "turn-1",
        kind: "read",
        detail: "/projects/notes.md",
        grant: { type: "folder", kind: "read", root: "/projects" },
      },
    });
    await waitFor(() => prompts().length === 1);
    const card = prompts()[0];
    expect(card).toMatchObject({ botId: bot.id, requestId: "ask-1" });
    expect(card?.questions[0]).toMatchObject({
      permission: { kind: "read", detail: "/projects/notes.md" },
    });
    expect(card?.questions[0]?.options?.map((option) => option.label)).toEqual([
      "Allow once",
      "Allow for this chat",
      "Don't allow",
    ]);
    expect(client.responses).toEqual([]);

    await service.respondToPrompt({
      requestId: "ask-1",
      answers: { permission: ["Allow for this chat"] },
    });
    expect(client.responses).toEqual([{ id: "ask-1", result: { decision: "chat" } }]);
    await expect(
      service.respondToPrompt({ requestId: "ask-1", answers: { permission: ["Allow once"] } }),
    ).rejects.toThrow("no longer active");
  });

  it("treats anything unclear as no", async () => {
    const { service, client, threadId, prompts } = await setup();
    client.sendRequest({
      id: "ask-2",
      method: "item/permission/request",
      params: { threadId, turnId: "turn-1", kind: "command", detail: "rm -rf build", grant: null },
    });
    await waitFor(() => prompts().length === 1);
    expect(prompts()[0]?.questions[0]?.options?.map((option) => option.label)).toEqual([
      "Allow once",
      "Allow for this chat",
      "Don't allow",
    ]);
    await service.respondToPrompt({ requestId: "ask-2", answers: { permission: ["yes please"] } });
    expect(client.responses).toEqual([{ id: "ask-2", result: { decision: "deny" } }]);
  });

  it("allows commands for the session after one yes, and writes every decision down", async () => {
    const { service, client, bot, threadId, prompts } = await setup();
    const notes: Array<{ kind: string; subject: string; decision: string }> = [];
    service.on("permission", (note) =>
      notes.push({ kind: note.kind, subject: note.subject, decision: note.decision }),
    );
    const ask = (id: string, command: string[]) =>
      client.sendRequest({
        id,
        method: "item/commandExecution/requestApproval",
        params: { threadId, turnId: "turn-1", command },
      });

    ask("cmd-a", ["git", "status"]);
    await waitFor(() => prompts().length === 1);
    await service.respondToPrompt({
      requestId: "cmd-a",
      answers: { permission: ["Allow for this chat"] },
    });
    expect(client.responses.at(-1)).toEqual({
      id: "cmd-a",
      result: { decision: "acceptForSession" },
    });

    // The next command is answered without a card, whatever it is.
    ask("cmd-b", [
      "/usr/bin/curl",
      "-H",
      "Authorization: Bearer not-a-real-token",
      "https://example.com",
    ]);
    await waitFor(() => client.responses.length === 2);
    expect(client.responses.at(-1)).toEqual({ id: "cmd-b", result: { decision: "accept" } });
    expect(prompts()).toHaveLength(1);

    // The logbook gets the program only, never the arguments.
    expect(notes).toEqual([
      { kind: "command", subject: "git", decision: "chat" },
      { kind: "command", subject: "curl", decision: "covered" },
    ]);

    // Changing the bot's access ends what was allowed for the session.
    await service.updateBot({ botId: bot.id, access: "read" });
    await service.updateBot({ botId: bot.id, access: "ask" });
    ask("cmd-c", ["ls"]);
    await waitFor(() => prompts().length === 2);
  });

  it("turns the engine's own approval requests into cards instead of approving them", async () => {
    const { service, client, threadId, prompts } = await setup();
    client.sendRequest({
      id: "cmd-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId, turnId: "turn-1", command: ["curl", "https://example.com"] },
    });
    await waitFor(() => prompts().length === 1);
    expect(prompts()[0]?.questions[0]?.permission).toEqual({
      kind: "command",
      detail: "curl https://example.com",
    });
    await service.respondToPrompt({ requestId: "cmd-1", answers: { permission: ["Don't allow"] } });
    expect(client.responses).toEqual([{ id: "cmd-1", result: { decision: "decline" } }]);

    client.sendRequest({
      id: "patch-1",
      method: "applyPatchApproval",
      params: { threadId, turnId: "turn-1", reason: "edit /projects/app.ts" },
    });
    await waitFor(() => prompts().length === 2);
    await service.respondToPrompt({
      requestId: "patch-1",
      answers: { permission: ["Allow once"] },
    });
    expect(client.responses.at(-1)).toEqual({ id: "patch-1", result: { decision: "approved" } });
  });

  it("adds a teammate a bot proposed only after the person says yes", async () => {
    const { service, client, threadId, prompts } = await setup();
    const added: string[] = [];
    service.on("teammate", (bot) => added.push(bot.botName));
    const propose = (id: string, args: unknown) =>
      client.sendRequest({
        id,
        method: "item/tool/call",
        params: {
          threadId,
          turnId: "turn-1",
          callId: `call-${id}`,
          namespace: "markas",
          tool: "propose_teammate",
          arguments: args,
        },
      });
    const answerOf = async (id: string) => {
      await waitFor(() => client.responses.some((response) => response.id === id));
      const result = client.responses.find((response) => response.id === id)?.result as {
        success: boolean;
        contentItems: Array<{ text: string }>;
      };
      return { success: result.success, text: result.contentItems[0]?.text ?? "" };
    };
    const juno = { name: "Juno", role: "Writes and edits", description: "Drafts the newsletter." };

    // A no adds nobody.
    propose("t-1", juno);
    await waitFor(() => prompts().length === 1);
    expect(prompts()[0]?.questions[0]?.permission).toEqual({
      kind: "teammate",
      detail: "Name: Juno\nRole: Writes and edits\nWhat it is for: Drafts the newsletter.",
    });
    expect(prompts()[0]?.questions[0]?.options?.map((option) => option.label)).toEqual([
      "Allow once",
      "Don't allow",
    ]);
    expect(service.listBots().some((bot) => bot.name === "Juno")).toBe(false);
    await service.respondToPrompt({
      requestId: prompts()[0]?.requestId ?? "",
      answers: { permission: ["Don't allow"] },
    });
    expect(await answerOf("t-1")).toMatchObject({ success: false });
    expect(service.listBots().some((bot) => bot.name === "Juno")).toBe(false);

    // A yes creates it, at the careful level.
    propose("t-2", juno);
    await waitFor(() => prompts().length === 2);
    await service.respondToPrompt({
      requestId: prompts()[1]?.requestId ?? "",
      answers: { permission: ["Allow once"] },
    });
    const made = await answerOf("t-2");
    expect(made.success).toBe(true);
    expect(made.text).toContain("Juno was added to the crew");
    const bot = service.listBots().find((candidate) => candidate.name === "Juno");
    expect(bot).toMatchObject({ role: "Writes and edits", access: "ask" });
    expect(added).toEqual(["Juno"]);

    // The same name again, or a proposal with nothing in it, never reaches the person.
    propose("t-3", juno);
    expect((await answerOf("t-3")).text).toContain("already a teammate named Juno");
    propose("t-4", { name: " ", role: "x", description: "y" });
    expect((await answerOf("t-4")).success).toBe(false);
    expect(prompts()).toHaveLength(2);
  });

  it("refuses a request it cannot tie to a bot", async () => {
    const { client, prompts } = await setup();
    client.sendRequest({
      id: "lost-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "unknown-thread", command: "ls" },
    });
    await waitFor(() => client.responses.length === 1);
    expect(client.responses[0]).toEqual({ id: "lost-1", result: { decision: "decline" } });
    expect(prompts()).toEqual([]);
  });

  it("answers at once, without a card, for a bot that was given full access", async () => {
    const { service, client, bot, threadId, events, prompts } = await setup();
    await service.updateBot({ botId: bot.id, access: "full" });
    const before = events.filter((event) => event.type === "turn-completed").length;
    await service.sendMessage({ botId: bot.id, text: "again" });
    await waitFor(
      () => events.filter((event) => event.type === "turn-completed").length === before + 1,
    );
    expect(
      client.requests.filter((request) => request.method === "turn/start").at(-1)?.params,
    ).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    client.sendRequest({
      id: "cmd-2",
      method: "item/commandExecution/requestApproval",
      params: { threadId, turnId: "turn-2", command: "ls" },
    });
    await waitFor(() => client.responses.length === 1);
    expect(client.responses[0]).toEqual({ id: "cmd-2", result: { decision: "acceptForSession" } });
    expect(prompts()).toEqual([]);
  });

  it("runs work sent by a careful bot at the careful level, even on a bot with full access", async () => {
    const { service, client, store, bot, events } = await setup();
    await service.updateBot({ botId: bot.id, access: "full" });
    const careful = await service.createBot();
    const before = events.filter((event) => event.type === "turn-completed").length;
    // The careful bot hands work to the bot with full access.
    client.sendRequest({
      id: "tool-1",
      method: "item/tool/call",
      params: {
        threadId: (await ensureThread(service, careful.id, events)) ?? "",
        turnId: "turn-9",
        callId: "call-9",
        namespace: "markas",
        tool: "send_message",
        arguments: { recipientBotIds: [bot.id], text: "Please delete everything." },
      },
    });
    await waitFor(
      () => events.filter((event) => event.type === "turn-completed").length >= before + 2,
    );
    const turns = client.requests.filter((request) => request.method === "turn/start");
    const delegated = turns.find(
      (request) =>
        (request.params as { cwd?: string }).cwd ===
          store.list().find((item) => item.id === bot.id)?.workspacePath &&
        JSON.stringify(request.params).includes("Please delete everything."),
    );
    expect(delegated?.params).toMatchObject({ approvalPolicy: "untrusted" });
  });
});

/** Gives a bot a thread by letting it finish one turn, and returns the thread's id. */
async function ensureThread(
  target: AgentService,
  botId: string,
  events: AgentEvent[],
): Promise<string | null> {
  const before = events.filter((event) => event.type === "turn-completed").length;
  await target.sendMessage({ botId, text: "hello" });
  await waitFor(() => events.filter((event) => event.type === "turn-completed").length > before);
  return target.listBots().find((item) => item.id === botId)?.threadId ?? null;
}

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
