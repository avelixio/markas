// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { LocalToolServer, type OfferedTool, type ToolAnswer } from "./tool-server";

const TOOLS: OfferedTool[] = [
  { name: "list_agents", description: "List agents.", inputSchema: { type: "object" } },
];

let server: LocalToolServer;

afterEach(async () => {
  await server?.stop();
});

async function open(
  handler: () => Promise<ToolAnswer> = async () => ({ content: [], isError: false }),
) {
  const calls: unknown[] = [];
  server = new LocalToolServer(async (owner, namespace, tool, args) => {
    calls.push({ owner, namespace, tool, args });
    return handler();
  });
  await server.start();
  const { token, urlFor } = server.register("atlas-chat", new Map([["markas", TOOLS]]));
  const post = (body: unknown, headers: Record<string, string> = {}, url = urlFor("markas")) =>
    fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { calls, post, urlFor, token };
}

describe("the local tool server", () => {
  it("listens on this computer only", async () => {
    const { urlFor } = await open();
    expect(urlFor("markas")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/atlas-chat\/markas$/);
  });

  it("answers the opening handshake and lists the tools", async () => {
    const { post } = await open();
    const hello = await (
      await post({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      })
    ).json();
    expect(hello).toMatchObject({
      id: 0,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } },
    });
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const listed = await (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    expect(listed).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: TOOLS } });
  });

  it("answers a request for prompts or resources with none, not with an error", async () => {
    const { post } = await open();
    for (const [method, key] of [
      ["prompts/list", "prompts"],
      ["resources/list", "resources"],
      ["resources/templates/list", "resourceTemplates"],
    ]) {
      const answer = (await (await post({ jsonrpc: "2.0", id: 9, method })).json()) as {
        result: Record<string, unknown>;
      };
      expect(answer.result).toEqual({ [key as string]: [] });
    }
  });

  it("passes a tool call on with whose it is, and returns the answer", async () => {
    const { post, calls } = await open(async () => ({
      content: [{ type: "text" as const, text: "Atlas" }],
      isError: false,
    }));
    const answer = await (
      await post({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_agents", arguments: { a: 1 } },
      })
    ).json();
    expect(calls).toEqual([
      { owner: "atlas-chat", namespace: "markas", tool: "list_agents", args: { a: 1 } },
    ]);
    expect(answer).toMatchObject({
      result: { content: [{ type: "text", text: "Atlas" }], isError: false },
    });
  });

  it("reports a tool that fails as a failed call, not as a broken connection", async () => {
    const { post } = await open(async () => {
      throw new Error("The browser is closed.");
    });
    const answer = await (
      await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_agents" } })
    ).json();
    expect(answer).toMatchObject({
      result: { content: [{ type: "text", text: "The browser is closed." }], isError: true },
    });
  });

  it("refuses a wrong or missing secret", async () => {
    const { post } = await open();
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await post(body, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post(body, { authorization: "" })).status).toBe(401);
  });

  it("refuses a request that comes from a web page", async () => {
    const { post } = await open();
    const response = await post(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { origin: "https://example.com" },
    );
    expect(response.status).toBe(403);
  });

  it("refuses tools that were not offered and addresses that do not exist", async () => {
    const { post, urlFor, calls } = await open();
    const unknown = await (
      await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_all" } })
    ).json();
    expect(unknown).toMatchObject({ error: { code: -32602 } });
    expect(calls).toEqual([]);
    const elsewhere = await post(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      {},
      urlFor("other"),
    );
    expect(elsewhere.status).toBe(404);
  });

  it("stops answering for an owner that was taken off", async () => {
    const { post } = await open();
    server.unregister("atlas-chat");
    expect((await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(401);
  });

  it("says so when the request is not valid JSON", async () => {
    const { post } = await open();
    expect(await (await post("{not json")).json()).toMatchObject({ error: { code: -32700 } });
  });
});
