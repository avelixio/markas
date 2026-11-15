// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostMethods, type HostContext, importAttachments } from "./methods";

let root: string;
let service: Record<string, ReturnType<typeof vi.fn>>;
let browser: Record<string, ReturnType<typeof vi.fn>>;
let mailbox: { resolveAttachment: ReturnType<typeof vi.fn> };
let openPath: ReturnType<typeof vi.fn>;
let initializeAgent: ReturnType<typeof vi.fn>;
let methods: ReturnType<typeof createHostMethods>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-methods-test-"));
  service = Object.fromEntries(
    [
      "getStatus",
      "getUsage",
      "listModels",
      "listBots",
      "createBot",
      "updateBot",
      "deleteBot",
      "readConversation",
      "sendMessage",
      "setMessageReaction",
      "discardDraftAttachment",
      "listQueue",
      "cancelQueuedMessage",
      "setQueuePaused",
      "interrupt",
      "interruptAll",
      "respondToPrompt",
      "setPreferredProvider",
      "prepareImportedAttachments",
    ].map((name) => [name, vi.fn(async () => `${name}-result`)]),
  );
  browser = Object.fromEntries(
    ["open", "activate", "close", "listTabs", "getControlState", "setVisible"].map((name) => [
      name,
      vi.fn(async () => `${name}-result`),
    ]),
  );
  mailbox = { resolveAttachment: vi.fn(async () => null) };
  openPath = vi.fn(async () => undefined);
  initializeAgent = vi.fn(async () => undefined);
  const context = {
    name: "Markas",
    version: "9.9.9",
    service,
    mailbox,
    browser,
    setupFile: join(root, "setup.json"),
    exportsRoot: join(root, "exports"),
    initializeAgent,
    openPath,
  } as unknown as HostContext;
  methods = createHostMethods(context);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const call = (name: string, input?: unknown) => {
  const method = methods[name];
  if (!method) throw new Error(`No such method: ${name}`);
  return method(input);
};

describe("host methods", () => {
  it("reports the app name, version and platform", () => {
    expect(call("app.getInfo")).toEqual({
      name: "Markas",
      version: "9.9.9",
      platform: process.platform,
    });
  });

  it("says updates are not available on the host, and has no old one-step setup", () => {
    expect(call("update.check")).toMatchObject({ phase: "unsupported", currentVersion: "9.9.9" });
    expect(methods["app.saveSetup"]).toBeUndefined();
    expect(methods["app.getMacPermissions"]).toBeUndefined();
  });

  it("validates a message before queueing it", async () => {
    expect(() => call("agent.sendMessage", { botId: "atlas", text: "   " })).toThrow(
      "A message or attachment is required.",
    );
    expect(() => call("agent.sendMessage", { text: "hi" })).toThrow("botId is required.");
    expect(service.sendMessage).not.toHaveBeenCalled();

    await call("agent.sendMessage", { botId: "atlas", text: "hi" });
    expect(service.sendMessage).toHaveBeenCalledWith({
      botId: "atlas",
      text: "hi",
      attachmentDraftIds: [],
      replyToMessageId: null,
    });
  });

  it("passes parsed input to the queue, interrupt and prompt methods", async () => {
    await call("agent.cancelQueuedMessage", { botId: "atlas", deliveryId: "d1" });
    expect(service.cancelQueuedMessage).toHaveBeenCalledWith("atlas", "d1");
    await call("agent.setQueuePaused", { botId: "atlas", paused: true });
    expect(service.setQueuePaused).toHaveBeenCalledWith("atlas", true);
    await call("agent.interrupt", { botId: "atlas", turnId: "t1" });
    expect(service.interrupt).toHaveBeenCalledWith("atlas", "t1");
    await call("agent.respondToPrompt", { requestId: 7, answers: { q1: ["yes"] } });
    expect(service.respondToPrompt).toHaveBeenCalledWith({
      requestId: 7,
      answers: { q1: ["yes"] },
    });
    expect(() => call("agent.setQueuePaused", { botId: "atlas", paused: "yes" })).toThrow();
    expect(() => call("agent.respondToPrompt", { requestId: 7, answers: { q1: "yes" } })).toThrow(
      "Invalid prompt answer.",
    );
  });

  it("rejects a bot update with a wrong field type", () => {
    expect(() => call("agent.updateBot", { botId: "atlas", name: 5 })).toThrow("Invalid name.");
    expect(() => call("agent.updateBot", { botId: "atlas", model: "not-a-model" })).toThrow(
      "Invalid agent model.",
    );
    expect(service.updateBot).not.toHaveBeenCalled();
  });

  it("opens an attachment through the operating system only when it exists", async () => {
    await expect(
      call("agent.openAttachment", { attachmentId: "missing", action: "open" }),
    ).rejects.toThrow("Attachment was not found.");
    expect(openPath).not.toHaveBeenCalled();

    mailbox.resolveAttachment.mockResolvedValueOnce({
      path: "/files/a.png",
      mimeType: "image/png",
    });
    await call("agent.openAttachment", { attachmentId: "a", action: "reveal" });
    expect(openPath).toHaveBeenCalledWith("/files/a.png", "reveal");
  });

  it("forwards browser calls with validated input", async () => {
    await call("browser.open", { url: "https://example.com", ownerBotId: "atlas" });
    expect(browser.open).toHaveBeenCalledWith("https://example.com", null, "atlas");
    expect(() => call("browser.open", { url: "" })).toThrow("url is required.");
    expect(() => call("browser.setVisible", { visible: true, bounds: { x: 0 } })).toThrow(
      "Invalid browser bound",
    );
  });

  it("imports uploaded bytes without any host path", async () => {
    const data = [{ name: "a.txt", mimeType: "text/plain", bytes: new Uint8Array([1]) }];
    await importAttachments({ service } as unknown as HostContext, data);
    expect(service.prepareImportedAttachments).toHaveBeenCalledWith([], data);
  });
});
