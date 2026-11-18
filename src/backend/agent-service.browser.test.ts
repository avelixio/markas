// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../shared/ipc";
import { AgentService } from "./agent-service";
import { BotStore } from "./bot-store";
import { BotBrowserService } from "./browser/bot-browser-service";
import { MailboxStore } from "./mailbox-store";
import type { DynamicToolResult } from "./protocol";
import { FakeAgentClient, fakeClientFactory } from "./testing/fake-agent-client";
import { FakeBrowserDriver, FakeBrowserFinder } from "./testing/fake-browser-driver";

const SHOP = "https://shop.example.com";

let root: string;
let service: AgentService | null = null;
let browser: BotBrowserService | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-browser-access-test-"));
});

afterEach(async () => {
  await service?.stop();
  await browser?.destroy();
  service = null;
  browser = null;
  // A turn that just ended may still be saving its preview.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function setup() {
  const client = new FakeAgentClient({ autoReply: "ok" });
  const driver = new FakeBrowserDriver();
  const store = new BotStore(join(root, "data"), join(root, "data"));
  const mailbox = new MailboxStore(join(root, "data"), store.sharedRoot);
  await store.initialize();
  await mailbox.initialize();
  const tabs = new BotBrowserService({
    profilesRoot: join(root, "profiles"),
    finder: new FakeBrowserFinder(),
    driver,
  });
  browser = tabs;
  const created = new AgentService(
    store,
    mailbox,
    tabs,
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
  let calls = 0;
  /** The engine calls a browser tool for the bot. */
  const callTool = (tool: string, args: unknown = {}): string => {
    calls += 1;
    const id = `tool-${calls}`;
    client.sendRequest({
      id,
      method: "item/tool/call",
      params: {
        threadId,
        turnId: "turn-1",
        callId: `call-${calls}`,
        namespace: "markas_browser",
        tool,
        arguments: args,
      },
    });
    return id;
  };
  const answer = async (id: string): Promise<DynamicToolResult> => {
    await waitFor(() => client.responses.some((response) => response.id === id));
    return client.responses.find((response) => response.id === id)?.result as DynamicToolResult;
  };
  const allow = (requestId: string, choice: string) =>
    created.respondToPrompt({ requestId, answers: { permission: [choice] } });
  return { service: created, client, driver, tabs, events, bot, prompts, callTool, answer, allow };
}

const textOf = (result: DynamicToolResult): string =>
  result.contentItems.map((item) => (item.type === "inputText" ? item.text : "")).join("\n");

describe("AgentService and the bot browser", () => {
  it("asks before a careful bot opens a website, and opens it after a yes", async () => {
    const { bot, tabs, driver, prompts, callTool, answer, allow, client } = await setup();
    const id = callTool("open", { url: `${SHOP}/orders` });
    await waitFor(() => prompts().length === 1);
    const question = prompts()[0]?.questions[0];
    // A yes for the session covers this one website, and the card says so.
    expect(question?.permission).toEqual({
      kind: "network",
      detail: `${SHOP}/orders`,
      covers: "site",
    });
    expect(question?.question).toContain("wants to use the internet");
    expect(question?.options).toMatchObject([
      { label: "Allow once" },
      {
        label: "Allow for this chat",
        description: "This website, until this chat's session ends.",
      },
      { label: "Don't allow" },
    ]);
    // Nothing happens until the person answers: no browser, no tab, no reply to the engine.
    expect(driver.launches).toEqual([]);
    expect(client.responses).toEqual([]);

    await allow(id, "Allow once");
    const result = await answer(id);
    expect(result.success).toBe(true);
    expect(tabs.listTabs()).toMatchObject([{ url: `${SHOP}/orders`, ownerBotId: bot.id }]);
    // The bot's own profile, named after the bot.
    expect(driver.launches[0]?.profileDir).toBe(join(root, "profiles", bot.id));
  });

  it("tells the bot no, and starts no browser, when the person refuses", async () => {
    const { tabs, driver, prompts, callTool, answer, allow } = await setup();
    const id = callTool("open", { url: `${SHOP}/orders` });
    await waitFor(() => prompts().length === 1);
    await allow(id, "Don't allow");
    const result = await answer(id);
    expect(result.success).toBe(false);
    expect(textOf(result)).toContain("did not allow this website");
    expect(driver.launches).toEqual([]);
    expect(tabs.listTabs()).toEqual([]);
  });

  it("remembers a yes for the chat for that one site only", async () => {
    const { prompts, callTool, answer, allow, service, bot } = await setup();
    const first = callTool("open", { url: `${SHOP}/orders` });
    await waitFor(() => prompts().length === 1);
    await allow(first, "Allow for this chat");
    const opened = await answer(first);
    const tabId = /Opened tab (\w+)/.exec(textOf(opened))?.[1] ?? "";

    // Reading and acting on that site, and opening more of it, need no new yes.
    expect((await answer(callTool("snapshot", { tabId }))).success).toBe(true);
    expect((await answer(callTool("open", { url: `${SHOP}/cart` }))).success).toBe(true);
    expect(prompts()).toHaveLength(1);

    // A sibling site is a different site.
    const sibling = callTool("open", { url: "https://admin.example.com/" });
    await waitFor(() => prompts().length === 2);
    await allow(sibling, "Don't allow");

    // A change of level forgets the yes.
    await service.updateBot({ botId: bot.id, access: "read" });
    const again = callTool("open", { url: `${SHOP}/orders` });
    await waitFor(() => prompts().length === 3);
    await allow(again, "Don't allow");
  });

  it("asks again when a tab has moved to a site the person did not allow", async () => {
    const { driver, prompts, callTool, answer, allow } = await setup();
    const first = callTool("open", { url: `${SHOP}/orders` });
    await waitFor(() => prompts().length === 1);
    await allow(first, "Allow for this chat");
    const tabId = /Opened tab (\w+)/.exec(textOf(await answer(first)))?.[1] ?? "";

    // A link on the page takes the tab somewhere else.
    driver.last.pages()[0]?.land("https://elsewhere.example.org/landing");
    const read = callTool("snapshot", { tabId });
    await waitFor(() => prompts().length === 2);
    expect(prompts()[1]?.questions[0]?.permission).toEqual({
      kind: "network",
      detail: "https://elsewhere.example.org/landing",
      covers: "site",
    });
    await allow(read, "Don't allow");
    expect((await answer(read)).success).toBe(false);

    // Listing tabs, closing one and handing one to the person reach no website.
    expect((await answer(callTool("list_tabs"))).success).toBe(true);
    expect((await answer(callTool("close_tab", { tabId }))).success).toBe(true);
    expect(prompts()).toHaveLength(2);
  });

  it("never asks a bot with full access", async () => {
    const { service, bot, events, prompts, callTool, answer } = await setup();
    await service.updateBot({ botId: bot.id, access: "full" });
    const before = events.filter((event) => event.type === "turn-completed").length;
    await service.sendMessage({ botId: bot.id, text: "again" });
    await waitFor(
      () => events.filter((event) => event.type === "turn-completed").length === before + 1,
    );
    expect((await answer(callTool("open", { url: `${SHOP}/orders` }))).success).toBe(true);
    expect(prompts()).toEqual([]);
  });

  it("passes browser changes on as events, with who controls each tab", async () => {
    const { service, tabs, bot, events, callTool, answer } = await setup();
    await service.updateBot({ botId: bot.id, access: "full" });
    await service.sendMessage({ botId: bot.id, text: "again" });
    await waitFor(() => events.filter((event) => event.type === "turn-completed").length === 2);
    const opened = await answer(callTool("open", { url: `${SHOP}/orders` }));
    const tabId = /Opened tab (\w+)/.exec(textOf(opened))?.[1] ?? "";
    expect(
      events.some((event) => event.type === "browser-changed" && event.tabs.length === 1),
    ).toBe(true);

    await tabs.takeControl({ tabId, reason: "Checking the order myself" });
    const control = events.filter((event) => event.type === "browser-control-changed").at(-1);
    expect(control).toMatchObject({
      state: { handOffs: [{ tabId, botId: bot.id, requestedBy: "person" }] },
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
