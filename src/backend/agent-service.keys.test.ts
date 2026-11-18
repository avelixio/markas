// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBotKeyTools } from "../host/keyring-methods";
import type { AgentEvent } from "../shared/ipc";
import { AgentService } from "./agent-service";
import { BotStore } from "./bot-store";
import { UnavailableBrowserService } from "./browser-host";
import { MemoryKeyStore } from "./keyring/key-store";
import { KeyringStore } from "./keyring/keyring-store";
import { LogbookStore } from "./logbook/logbook-store";
import { MailboxStore } from "./mailbox-store";
import { FakeAgentClient, fakeClientFactory } from "./testing/fake-agent-client";
import { type FakePage, FakeSecretFiller } from "./testing/fake-secret-filler";

const SITE = "https://app.example.com";
const USERNAME = "juno.field@example.com";
const PASSWORD = "Tr0ub4dor&3-horse-staple";
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const HOME: FakePage = { url: `${SITE}/home`, fields: [] };

function signInPage(): FakePage {
  return {
    url: `${SITE}/sign-in`,
    fields: ["username", "password", "otp"],
    submit: (values) =>
      values.username === USERNAME && values.password === PASSWORD && values.otp ? HOME : undefined,
  };
}

let root: string;
let service: AgentService | null = null;
let consoleOutput: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-keys-service-test-"));
  consoleOutput = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await service?.stop();
  service = null;
  // A turn that just ended may still be saving its preview.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

async function setup() {
  const data = join(root, "data");
  const client = new FakeAgentClient({ autoReply: "ok" });
  const store = new BotStore(data, data);
  const mailbox = new MailboxStore(data, store.sharedRoot);
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
  await created.updateBot({ botId: bot.id, name: "Atlas" });
  await created.sendMessage({ botId: bot.id, text: "hello" });
  await waitFor(() => events.some((event) => event.type === "turn-completed"));
  const threadId = created.listBots().find((item) => item.id === bot.id)?.threadId ?? "";

  const keyring = new KeyringStore(data, new MemoryKeyStore());
  await keyring.initialize();
  const key = await keyring.create({
    name: "work-login",
    kind: "login",
    origin: SITE,
    username: USERNAME,
    value: PASSWORD,
    twoStepSeed: SEED,
    sharedWith: [bot.id],
  });
  const logbook = new LogbookStore(data);
  await logbook.initialize();
  const filler = new FakeSecretFiller(signInPage());
  created.useKeys(
    createBotKeyTools({
      keyring,
      logbook,
      filler,
      botName: (id) => created.listBots().find((item) => item.id === id)?.name ?? "A bot",
    }),
  );

  let calls = 0;
  const call = (tool: string, args: unknown): string => {
    calls += 1;
    const id = `tool-${calls}`;
    client.sendRequest({
      id,
      method: "item/tool/call",
      params: {
        threadId,
        turnId: "turn-1",
        callId: `call-${calls}`,
        namespace: "markas",
        tool,
        arguments: args,
      },
    });
    return id;
  };
  const answerOf = async (id: string) => {
    await waitFor(() => client.responses.some((response) => response.id === id));
    const response = client.responses.find((candidate) => candidate.id === id);
    const result = response?.result as {
      success: boolean;
      contentItems: Array<{ text: string }>;
    };
    return { success: result.success, body: JSON.parse(result.contentItems[0]?.text ?? "{}") };
  };
  const prompts = () =>
    events.filter(
      (event): event is Extract<AgentEvent, { type: "prompt" }> => event.type === "prompt",
    );
  return {
    service: created,
    client,
    events,
    bot,
    threadId,
    keyring,
    key,
    logbook,
    filler,
    call,
    answerOf,
    prompts,
    data,
  };
}

describe("AgentService keyring tools", () => {
  it("offers the keyring tools to bots beside the other Markas tools", async () => {
    const { client } = await setup();
    const start = client.requests.find((request) => request.method === "thread/start");
    const text = JSON.stringify(start?.params);
    expect(text).toContain("keyring_list");
    expect(text).toContain("keyring_sign_in");
  });

  it("lists a bot's keys by name and site", async () => {
    const { call, answerOf, key } = await setup();
    const answer = await answerOf(call("keyring_list", {}));
    expect(answer).toEqual({
      success: true,
      body: {
        keys: [{ id: key.id, name: "work-login", kind: "login", site: SITE, hasTwoStepCode: true }],
      },
    });
  });

  it("shows a card before the first use, signs in after a yes, and does not ask again in the chat", async () => {
    const { service, client, bot, call, answerOf, prompts, filler, logbook } = await setup();
    const first = call("keyring_sign_in", { keyName: "work-login" });
    await waitFor(() => prompts().length === 1);
    const card = prompts()[0];
    expect(card?.botId).toBe(bot.id);
    expect(card?.questions[0]).toMatchObject({
      permission: {
        kind: "tool",
        detail: `Sign in to ${SITE} with the key "work-login"`,
      },
    });
    expect(card?.questions[0]?.options?.map((option) => option.label)).toEqual([
      "Allow once",
      "Allow for this chat",
      "Don't allow",
    ]);
    // Nothing is typed and the bot has no answer until the person decides.
    expect(filler.typed).toEqual([]);
    expect(client.responses.some((response) => response.id === first)).toBe(false);

    await service.respondToPrompt({
      requestId: card?.requestId ?? "",
      answers: { permission: ["Allow for this chat"] },
    });
    expect(await answerOf(first)).toEqual({
      success: true,
      body: { result: "signed-in", message: `Signed in to ${SITE} with the key "work-login".` },
    });
    expect(filler.typed.map((entry) => entry.field)).toEqual(["username", "password", "otp"]);
    expect(logbook.list()[0]).toMatchObject({
      actor: "bot",
      action: "key.used",
      target: `Atlas signed in to ${SITE} with key work-login`,
      outcome: "done",
    });

    filler.goTo(signInPage());
    expect((await answerOf(call("keyring_sign_in", { keyName: "work-login" }))).success).toBe(true);
    expect(prompts()).toHaveLength(1);
  });

  it("types nothing after a no, and tells the bot not to work around it", async () => {
    const { service, call, answerOf, prompts, filler } = await setup();
    const id = call("keyring_sign_in", { keyName: "work-login" });
    await waitFor(() => prompts().length === 1);
    await service.respondToPrompt({
      requestId: prompts()[0]?.requestId ?? "",
      answers: { permission: ["maybe"] },
    });
    const answer = await answerOf(id);
    expect(answer.success).toBe(false);
    expect(answer.body.result).toBe("not-allowed");
    expect(filler.typed).toEqual([]);
  });

  it("asks again after the bot's access level changes", async () => {
    const { service, bot, call, answerOf, prompts, filler } = await setup();
    const first = call("keyring_sign_in", { keyName: "work-login" });
    await waitFor(() => prompts().length === 1);
    await service.respondToPrompt({
      requestId: prompts()[0]?.requestId ?? "",
      answers: { permission: ["Allow for this chat"] },
    });
    await answerOf(first);

    await service.updateBot({ botId: bot.id, access: "read" });
    filler.goTo(signInPage());
    call("keyring_sign_in", { keyName: "work-login" });
    await waitFor(() => prompts().length === 2);
  });

  it("does not ask a bot with full access", async () => {
    const { service, bot, call, answerOf, prompts, events } = await setup();
    await service.updateBot({ botId: bot.id, access: "full" });
    // The new level applies from the bot's next turn.
    const before = events.filter((event) => event.type === "turn-completed").length;
    await service.sendMessage({ botId: bot.id, text: "again" });
    await waitFor(
      () => events.filter((event) => event.type === "turn-completed").length === before + 1,
    );
    expect((await answerOf(call("keyring_sign_in", { keyName: "work-login" }))).success).toBe(true);
    expect(prompts()).toEqual([]);
  });

  it("refuses a sibling site without asking the person anything", async () => {
    const { call, answerOf, prompts, filler } = await setup();
    filler.goTo({ url: "https://login.example.com/sign-in", fields: ["username", "password"] });
    const answer = await answerOf(call("keyring_sign_in", { keyName: "work-login" }));
    expect(answer.body.result).toBe("wrong-site");
    expect(answer.body.message).toContain("https://login.example.com");
    expect(prompts()).toEqual([]);
    expect(filler.typed).toEqual([]);
  });

  it("answers no to an open card when the engine goes away", async () => {
    const { service, call, prompts, filler } = await setup();
    call("keyring_sign_in", { keyName: "work-login" });
    await waitFor(() => prompts().length === 1);
    await service.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(filler.typed).toEqual([]);
  });

  it("keeps every secret out of events, engine traffic, logs and files", async () => {
    const { service, client, events, call, answerOf, prompts, filler, data, keyring } =
      await setup();
    const first = call("keyring_sign_in", { keyName: "work-login" });
    await waitFor(() => prompts().length === 1);
    await service.respondToPrompt({
      requestId: prompts()[0]?.requestId ?? "",
      answers: { permission: ["Allow for this chat"] },
    });
    await answerOf(first);
    filler.goTo({ url: `${SITE}/sign-in`, fields: ["username", "password"] });
    await answerOf(call("keyring_sign_in", { keyName: "work-login" })); // password refused
    filler.goTo({ url: "https://login.example.com/", fields: ["username", "password"] });
    await answerOf(call("keyring_sign_in", { keyName: "work-login" })); // wrong site
    filler.goTo(signInPage());
    filler.failTyping = new Error(`cannot type ${PASSWORD}`);
    await answerOf(call("keyring_sign_in", { keyName: "work-login" })); // browser fault
    await answerOf(call("keyring_list", {}));

    expect(filler.values).toContain(PASSWORD);
    const codes = filler.typed.filter((entry) => entry.field === "otp").map((e) => e.value);
    expect(codes.length).toBeGreaterThan(0);

    const seen = [
      JSON.stringify(events),
      JSON.stringify(client.responses),
      JSON.stringify(client.requests),
      consoleOutput.join("\n"),
      await readFile(join(data, "logbook.jsonl"), "utf8"),
      JSON.stringify(service.listBots()),
    ].join("\n");
    expect(seen).toContain("work-login");
    for (const secret of [USERNAME, PASSWORD, SEED]) {
      expect(seen.includes(secret), "a secret leaked").toBe(false);
      expect(seen).not.toContain(encodeURIComponent(secret));
      expect(seen).not.toContain(Buffer.from(secret).toString("base64"));
    }
    expect(keyring.redactor.redact(seen)).toBe(seen);
    const withoutIds = seen
      .replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, "")
      .replace(/\d{10,}/g, "");
    for (const code of new Set(codes)) {
      expect(withoutIds.includes(code), "a one-time code leaked").toBe(false);
    }
  });
});

describe("a bot asking for a key", () => {
  const textOf = async (client: FakeAgentClient, id: string) => {
    await waitFor(() => client.responses.some((response) => response.id === id));
    const result = client.responses.find((response) => response.id === id)?.result as {
      success: boolean;
      contentItems: Array<{ text: string }>;
    };
    return { success: result.success, text: result.contentItems[0]?.text ?? "" };
  };

  it("is offered to bots and told to them instead of asking in the chat", async () => {
    const { client } = await setup();
    const start = client.requests.find((request) => request.method === "thread/start");
    expect(JSON.stringify(start?.params)).toContain("keyring_request");
  });

  it("answers with the key it already has, without asking the person", async () => {
    const { client, call, prompts } = await setup();
    const answer = await textOf(
      client,
      call("keyring_request", { site: `${SITE}/sign-in`, reason: "To read the report." }),
    );
    expect(answer.success).toBe(true);
    expect(answer.text).toContain('"work-login"');
    expect(prompts()).toHaveLength(0);
  });

  it("refuses a request without an exact site or a reason", async () => {
    const { client, call } = await setup();
    expect(
      (await textOf(client, call("keyring_request", { site: "reports", reason: "x" }))).text,
    ).toMatch(/exact site/);
    expect(
      (await textOf(client, call("keyring_request", { site: "https://reports.example.com" }))).text,
    ).toMatch(/what you need/);
  });

  it("puts a card in front of the person and tells the bot only the name of what was saved", async () => {
    const { client, call, prompts, service, keyring, bot } = await setup();
    const ask = () =>
      call("keyring_request", {
        site: "https://www.reports.example.com/login",
        reason: "To read the weekly report",
        username: "sam@example.com",
      });

    const first = ask();
    await waitFor(() => prompts().length === 1);
    expect(prompts()[0]?.questions[0]?.keyRequest).toEqual({
      botId: bot.id,
      kind: "login",
      origin: "https://www.reports.example.com",
      name: "reports.example.com",
      username: "sam@example.com",
      reason: "To read the weekly report",
    });
    await service.respondToPrompt({
      requestId: prompts()[0]?.requestId ?? "",
      answers: { permission: ["Don't allow"] },
    });
    expect(await textOf(client, first)).toMatchObject({ success: false });

    const second = ask();
    await waitFor(() => prompts().length === 2);
    // The card saves the key with the secret the person typed, shared with the asking bot.
    await keyring.create({
      name: "reports.example.com",
      kind: "login",
      origin: "https://www.reports.example.com",
      username: "sam@example.com",
      value: PASSWORD,
      sharedWith: [bot.id],
    });
    await service.respondToPrompt({
      requestId: prompts()[1]?.requestId ?? "",
      answers: { permission: ["Allow once"] },
    });
    const saved = await textOf(client, second);
    expect(saved.success).toBe(true);
    expect(saved.text).toContain('keyName "reports.example.com"');
    expect(JSON.stringify(client.responses)).not.toContain(PASSWORD);
  });

  it("says so when the saved key was not shared with the asking bot", async () => {
    const { client, call, prompts, service, keyring } = await setup();
    const asked = call("keyring_request", {
      site: "https://reports.example.com",
      reason: "To read the weekly report",
    });
    await waitFor(() => prompts().length === 1);
    await keyring.create({
      name: "reports",
      kind: "login",
      origin: "https://reports.example.com",
      username: "sam",
      value: PASSWORD,
      sharedWith: [],
    });
    await service.respondToPrompt({
      requestId: prompts()[0]?.requestId ?? "",
      answers: { permission: ["Allow once"] },
    });
    expect((await textOf(client, asked)).text).toMatch(
      /none for https:\/\/reports\.example\.com is shared/,
    );
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the condition.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
