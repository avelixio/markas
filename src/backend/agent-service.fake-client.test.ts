// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared/ipc";
import type { AgentClientFactory } from "./agent-service";
import { AgentService } from "./agent-service";
import { BotStore } from "./bot-store";
import { UnavailableBrowserService } from "./browser-host";
import { MailboxStore } from "./mailbox-store";
import { FakeAgentClient, fakeClientFactory } from "./testing/fake-agent-client";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-fake-client-test-"));
});

afterEach(async () => {
  await service?.stop();
  service = null;
  await rm(root, { recursive: true, force: true });
});

describe("AgentService with an injected client", () => {
  it("tells the engine to drop what was allowed for the chat after the level changes", async () => {
    const client = new FakeAgentClient({ provider: "claude", autoReply: "Done." });
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "claude",
      fakeClientFactory({ claude: client }),
    );
    let ended = 0;
    service.on("event", (event: AgentEvent) => {
      if (event.type === "turn-completed") ended += 1;
    });
    await service.initialize();
    const bot = await service.createBot();
    const turnStarts = () =>
      client.requests
        .filter((request) => request.method === "turn/start")
        .map((request) => (request.params as { forgetChatGrants?: boolean }).forgetChatGrants);

    await service.sendMessage({ botId: bot.id, text: "First" });
    await waitFor(() => ended === 1);
    // Up and back down between two turns.
    await service.updateBot({ botId: bot.id, access: "full" });
    await service.updateBot({ botId: bot.id, access: "ask" });
    await service.sendMessage({ botId: bot.id, text: "Second" });
    await waitFor(() => ended === 2);
    await service.sendMessage({ botId: bot.id, text: "Third" });
    await waitFor(() => ended === 3);

    expect(turnStarts()).toEqual([undefined, true, undefined]);
  });

  it("starts each engine once when it is asked about while it is still starting", async () => {
    // Setup asks how the engines are while the host is still starting them.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: FakeAgentClient[] = [];
    const factory: AgentClientFactory = async (provider) => {
      if (provider !== "claude") throw new Error(`${provider} is not installed in this test.`);
      const client = new FakeAgentClient({ provider: "claude" });
      started.push(client);
      await gate;
      return { client, cli: { executable: "fake-claude", version: "0.0.0-fake" } };
    };
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "claude",
      factory,
    );

    const starting = service.initialize();
    await waitFor(() => started.length > 0);
    const asked = service.checkProvider("claude");
    release();
    await starting;

    expect((await asked).state).toBe("available");
    expect(started).toHaveLength(1);
    expect((await service.checkProvider("claude")).state).toBe("available");
  });

  it("reports an engine as ready while another engine is still starting", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let openCodeAsked = false;
    const factory: AgentClientFactory = async (provider) => {
      if (provider === "claude") {
        const client = new FakeAgentClient({ provider: "claude" });
        return { client, cli: { executable: "fake-claude", version: "0.0.0-fake" } };
      }
      if (provider === "opencode") {
        openCodeAsked = true;
        await gate;
      }
      throw new Error(`${provider} is not installed in this test.`);
    };
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "claude",
      factory,
    );

    const starting = service.initialize();
    await waitFor(() => openCodeAsked);
    const asked = service.checkProvider("claude");
    release();
    await starting;

    expect((await asked).state).toBe("available");
  });

  it("starts each engine once when it is asked about before the host starts the engines", async () => {
    // The host answers requests before it starts the engines, so setup can ask first.
    const started: FakeAgentClient[] = [];
    const factory: AgentClientFactory = async (provider) => {
      if (provider !== "claude") throw new Error(`${provider} is not installed in this test.`);
      const client = new FakeAgentClient({ provider: "claude" });
      started.push(client);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { client, cli: { executable: "fake-claude", version: "0.0.0-fake" } };
    };
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "claude",
      factory,
    );

    const asked = service.checkProvider("claude");
    await service.initialize();

    expect((await asked).state).toBe("available");
    expect(started).toHaveLength(1);
    expect(service.getStatus().phase).toBe("ready");
  });

  it("runs a turn end to end without any engine executable", async () => {
    const client = new FakeAgentClient({ autoReply: "Done from the fake engine." });
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    await store.initialize();
    await mailbox.initialize();
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "codex",
      fakeClientFactory({ codex: client }),
    );
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));

    await service.initialize();
    expect(service.getStatus().phase).toBe("ready");
    const bot = await service.createBot();

    await service.sendMessage({ botId: bot.id, text: "Say hello" });
    await waitFor(() =>
      events.some((event) => event.type === "turn-completed" && event.status === "completed"),
    );

    expect(client.requests.map((request) => request.method)).toEqual(
      expect.arrayContaining(["initialize", "account/read", "thread/start", "turn/start"]),
    );
    const conversation = await service.readConversation(bot.id);
    expect(JSON.stringify(conversation)).toContain("Done from the fake engine.");
  });

  it("keeps a bot's earlier messages in its chat during the first turn after a restart", async () => {
    const client = new FakeAgentClient({ autoReply: "The first answer." });
    const open = async () => {
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
      const events: AgentEvent[] = [];
      created.on("event", (event) => events.push(event));
      await created.initialize();
      return { created, events };
    };

    const first = await open();
    service = first.created;
    const bot = await first.created.createBot();
    await first.created.sendMessage({ botId: bot.id, text: "One" });
    await waitFor(() => first.events.some((event) => event.type === "turn-completed"));
    await first.created.stop();

    // The host starts again and the person writes before opening the chat.
    const second = await open();
    service = second.created;
    await second.created.sendMessage({ botId: bot.id, text: "Two" });
    await waitFor(() => second.events.some((event) => event.type === "turn-started"));
    // The first view of the chat that shows the new message must show the old ones too.
    const firstWithNew = second.events.find(
      (event): event is Extract<AgentEvent, { type: "conversation" }> =>
        event.type === "conversation" &&
        event.snapshot.botId === bot.id &&
        event.snapshot.messages.some((message) => message.text === "Two"),
    );
    const shown = JSON.stringify(firstWithNew?.snapshot.messages ?? []);
    expect(shown).toContain("The first answer.");
    // The turn ends and saves before the folder is removed, or Windows refuses the save.
    await waitFor(() => second.events.some((event) => event.type === "turn-completed"));
    await second.created.stop();
  });

  it("ends the engine's session for a chat when its bot is deleted", async () => {
    const client = new FakeAgentClient({ autoReply: "Done." });
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    await store.initialize();
    await mailbox.initialize();
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "codex",
      fakeClientFactory({ codex: client }),
    );
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();
    const bot = await service.createBot();
    await service.sendMessage({ botId: bot.id, text: "Hello" });
    await waitFor(() => events.some((event) => event.type === "turn-completed"));
    const threadId = store.list().find((entry) => entry.id === bot.id)?.threadId;
    expect(threadId).toBeTruthy();

    await service.deleteBot(bot.id);

    expect(client.closedThreads).toEqual([threadId]);
  });

  it("opens a bot's chat even when its engine is not on this computer, and says how that engine stands", async () => {
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    await store.initialize();
    await mailbox.initialize();
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "claude",
      fakeClientFactory({ claude: new FakeAgentClient({ provider: "claude" }) }),
    );
    await service.initialize();
    // A bot on Codex, which this computer does not have.
    await store.getOrCreate("chief");
    await store.setThreadId("chief", "thread-codex");

    await expect(service.readConversation("chief")).resolves.toMatchObject({ botId: "chief" });
    const codex = () => service?.getStatus().providers?.find((entry) => entry.id === "codex");
    // Settled, not left looking as if it were still being checked.
    expect(codex()?.state).toBe("error");
    expect(codex()?.message).toContain("not installed in this test");
    expect(service.getStatus().phase).toBe("ready");
  });

  it("does not look for a missing engine again each time its bot's chat is read", async () => {
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    await store.initialize();
    await mailbox.initialize();
    const looked: string[] = [];
    const factory = fakeClientFactory({ claude: new FakeAgentClient({ provider: "claude" }) });
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "claude",
      async (provider, timeout) => {
        looked.push(provider);
        return factory(provider, timeout);
      },
    );
    await service.initialize();
    await store.getOrCreate("chief");
    await store.setThreadId("chief", "thread-codex");
    const before = looked.filter((provider) => provider === "codex").length;

    for (let read = 0; read < 5; read += 1) await service.readConversation("chief");

    expect(looked.filter((provider) => provider === "codex").length).toBe(before);
    // The Switchboard and setup still look again when asked.
    await service.checkProvider("codex");
    expect(looked.filter((provider) => provider === "codex").length).toBe(before + 1);
  });

  it("gives a new bot an engine that is ready when the preferred one is not installed", async () => {
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    await store.initialize();
    await mailbox.initialize();
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "codex",
      fakeClientFactory({ claude: new FakeAgentClient({ provider: "claude" }) }),
    );
    await service.initialize();
    await service.ensureProvider("claude");

    const bot = await service.createBot();

    expect(bot.model.startsWith("claude")).toBe(true);
  });

  it("refuses browser tool calls while the browser service is unavailable", async () => {
    const client = new FakeAgentClient();
    const store = new BotStore(join(root, "data"), join(root, "data"));
    const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
    service = new AgentService(
      store,
      mailbox,
      new UnavailableBrowserService(),
      null,
      5_000,
      "codex",
      fakeClientFactory({ codex: client }),
    );
    await store.initialize();
    await mailbox.initialize();
    await service.initialize();

    client.sendRequest({
      id: "call-1",
      method: "item/tool/call",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        namespace: "markas_browser",
        tool: "open",
        arguments: { url: "https://example.com" },
      },
    });
    await waitFor(() => client.responses.length > 0);

    expect(client.responses[0]).toMatchObject({
      id: "call-1",
      result: { success: false },
    });
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
