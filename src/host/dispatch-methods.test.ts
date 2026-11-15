// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAFT_BLOCK } from "../backend/dispatch/dispatch";
import { DispatchService } from "../backend/dispatch/dispatch-service";
import { FakeAgentClient } from "../backend/testing/fake-agent-client";
import type { DispatchTurn, ImportBotFileResult } from "../shared/bot-draft";
import { createDispatchMethods } from "./dispatch-methods";

let dispatch: DispatchService | null = null;

afterEach(async () => {
  await dispatch?.stop();
  dispatch = null;
});

function harness() {
  const clients: FakeAgentClient[] = [];
  dispatch = new DispatchService({
    createClient: async (provider) => {
      const client = new FakeAgentClient({ provider });
      clients.push(client);
      return client;
    },
    engines: () => ["codex"],
    model: () => null,
    context: () => ({ existingBotNames: [], interfaceLanguage: "en" }),
    workspace: "/markas/dispatch",
    protectedRoot: "/markas",
    turnTimeoutMs: 2_000,
  });
  const methods = createDispatchMethods(dispatch);
  const call = <T>(name: string, input?: unknown) =>
    Promise.resolve().then(() => methods[name]?.(input) as T);
  /** Lets the newest engine session answer its first turn. */
  const answer = async (text: string) => {
    await vi.waitFor(() =>
      expect(clients.at(-1)?.requests.some((request) => request.method === "turn/start")).toBe(
        true,
      ),
    );
    const client = clients.at(-1) as FakeAgentClient;
    const params = client.requests.find((request) => request.method === "turn/start")?.params;
    client.completeTurn((params as { threadId: string }).threadId, "turn-1", text);
  };
  return { call, answer, clients };
}

describe("dispatch methods", () => {
  it("carries a talk with Dispatch, and forgets it on reset", async () => {
    const { call, answer } = harness();
    expect(await call<DispatchTurn>("dispatch.open")).toEqual({ ok: true, messages: [] });

    const said = call<DispatchTurn>("dispatch.say", { text: "Tidy my notes." });
    await answer("How often?\nOptions: Daily | Weekly");
    expect((await said).messages).toMatchObject([
      { from: "you", text: "Tidy my notes." },
      { from: "dispatch", text: "How often?", quickReplies: ["Daily", "Weekly"] },
    ]);

    await call("dispatch.reset");
    expect(await call<DispatchTurn>("dispatch.open")).toEqual({ ok: true, messages: [] });
  });

  it("refuses input of the wrong shape", async () => {
    const { call } = harness();
    await expect(call("dispatch.say", { text: "  " })).rejects.toThrow("text is required.");
    await expect(call("dispatch.say", null)).rejects.toThrow("text is required.");
    await expect(call("dispatch.move", { engine: "other" })).rejects.toThrow("Unknown engine.");
    await expect(call("dispatch.repairFile", "text")).rejects.toThrow("Send the bot file's text.");
  });

  it("mends a bot file through Dispatch, and says when it cannot", async () => {
    const { call, answer, clients } = harness();
    const mending = call<ImportBotFileResult>("dispatch.repairFile", {
      text: "name: Sol\nthis is not a bot file",
      fileName: "sol.bot.md",
    });
    await answer(
      `Recovered.\n\`\`\`${DRAFT_BLOCK}\n${JSON.stringify({
        name: "Sol",
        role: "Helper",
        instructions: "Help with short questions.",
      })}\n\`\`\``,
    );
    expect(await mending).toMatchObject({
      ok: true,
      fileName: "sol.bot.md",
      draft: { name: "Sol", access: "ask" },
    });

    const hopeless = call<ImportBotFileResult>("dispatch.repairFile", { text: "???" });
    await vi.waitFor(() => expect(clients).toHaveLength(2));
    await answer("This file does not describe a bot.");
    expect(await hopeless).toEqual({
      ok: false,
      fileName: null,
      message: "This file does not describe a bot.",
      problems: [],
    });
  });
});
