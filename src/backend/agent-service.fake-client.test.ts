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
  root = await mkdtemp(join(tmpdir(), "markas-fake-client-test-"));
});

afterEach(async () => {
  await service?.stop();
  service = null;
  await rm(root, { recursive: true, force: true });
});

describe("AgentService with an injected client", () => {
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
