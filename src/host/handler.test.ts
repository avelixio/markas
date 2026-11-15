// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "./event-hub";
import { createHostHandler, SESSION_COOKIE } from "./handler";

const TOKEN = "a".repeat(64);
const PORT = 4780;
const BASE = `http://127.0.0.1:${PORT}`;

let root: string;
let events: EventHub;
let handler: (request: Request) => Promise<Response>;
const importAttachments = vi.fn(async (data: unknown[]) => data.length);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-handler-test-"));
  await mkdir(join(root, "ui", "assets"), { recursive: true });
  await writeFile(join(root, "ui", "index.html"), "<!doctype html><title>Markas</title>");
  await writeFile(join(root, "ui", "assets", "app.js"), "console.log('ui');");
  await writeFile(join(root, "secret.txt"), "outside the ui root");
  await writeFile(join(root, "picture.png"), "png-bytes");
  events = new EventHub();
  importAttachments.mockClear();
  handler = createHostHandler({
    token: TOKEN,
    port: PORT,
    events,
    uiRoot: join(root, "ui"),
    importAttachments,
    mailbox: {
      resolveAttachment: async (id: string) =>
        id === "known" ? { path: join(root, "picture.png"), mimeType: "image/png" } : null,
    } as never,
    methods: {
      "echo.input": (input) => ({ got: input }),
      "always.fails": () => {
        throw new Error("That is not allowed.");
      },
    },
  });
});

afterEach(async () => {
  events.close();
  await rm(root, { recursive: true, force: true });
});

function request(path: string, init: RequestInit & { host?: string } = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("host", init.host ?? `127.0.0.1:${PORT}`);
  return new Request(`${BASE}${path}`, { ...init, headers });
}

function api(path: string, input: unknown, headers: Record<string, string> = {}): Request {
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    body: JSON.stringify({ input }),
  });
}

describe("host handler", () => {
  it("calls a method with the bearer token and returns its result", async () => {
    const response = await handler(api("/api/echo.input", { hello: "world" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { got: { hello: "world" } } });
  });

  it("refuses API calls without a token or with a wrong one", async () => {
    const missing = await handler(
      request("/api/echo.input", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(missing.status).toBe(401);
    const wrong = await handler(
      api("/api/echo.input", null, { authorization: `Bearer ${"b".repeat(64)}` }),
    );
    expect(wrong.status).toBe(401);
  });

  it("turns the token into a session cookie that authenticates later requests", async () => {
    const session = await handler(
      request("/api/session", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    expect(session.status).toBe(200);
    const cookie = session.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const response = await handler(
      request("/api/echo.input", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie.split(";")[0] ?? "" },
        body: JSON.stringify({ input: 1 }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it("refuses a session without the token", async () => {
    const response = await handler(request("/api/session", { method: "POST" }));
    expect(response.status).toBe(401);
  });

  it("refuses requests for another host name, which blocks DNS rebinding", async () => {
    const response = await handler(
      request("/api/echo.input", {
        method: "POST",
        host: "evil.example:4780",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: "{}",
      }),
    );
    expect(response.status).toBe(421);
  });

  it("refuses requests from another origin even with a valid token", async () => {
    const response = await handler(
      api("/api/echo.input", null, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("reports unknown methods and method failures without crashing", async () => {
    expect((await handler(api("/api/nope", null))).status).toBe(404);
    expect((await handler(api("/api/constructor", null))).status).toBe(404);
    const failed = await handler(api("/api/always.fails", null));
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({ error: "That is not allowed." });
  });

  it("requires JSON for method calls", async () => {
    const response = await handler(
      request("/api/echo.input", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" },
        body: "hi",
      }),
    );
    expect(response.status).toBe(415);
  });

  it("serves the web UI without a token and falls back to the app shell for routes", async () => {
    const index = await handler(request("/"));
    expect(index.status).toBe(200);
    expect(index.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await index.text()).toContain("Markas");
    expect((await handler(request("/assets/app.js"))).headers.get("content-type")).toContain(
      "javascript",
    );
    expect((await handler(request("/bots/chief"))).status).toBe(200);
    expect((await handler(request("/assets/missing.js"))).status).toBe(404);
  });

  it("never serves files outside the UI root", async () => {
    const response = await handler(request("/..%2Fsecret.txt"));
    expect(response.status).toBe(404);
  });

  it("serves attachments only to authorized callers", async () => {
    expect((await handler(request("/attachments/known"))).status).toBe(401);
    const response = await handler(
      request("/attachments/known", { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    const missing = await handler(
      request("/attachments/unknown", { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    expect(missing.status).toBe(404);
  });

  it("imports uploaded files as bytes", async () => {
    const form = new FormData();
    form.append("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    const response = await handler(
      request("/api/agent.importAttachments", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: form,
      }),
    );
    expect(response.status).toBe(200);
    expect(importAttachments).toHaveBeenCalledOnce();
    const [data] = importAttachments.mock.calls[0] ?? [];
    expect(data).toEqual([
      {
        name: "note.txt",
        mimeType: expect.stringContaining("text/plain"),
        bytes: expect.any(Uint8Array),
      },
    ]);
  });

  it("streams published events to subscribers", async () => {
    const response = await handler(
      request("/api/events", { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader?.read())?.value)).toContain(": connected");
    events.publish({ channel: "agent", payload: { type: "status" } });
    expect(decoder.decode((await reader?.read())?.value)).toBe(
      'event: agent\ndata: {"type":"status"}\n\n',
    );
    await reader?.cancel();
    expect(events.subscriberCount).toBe(0);
  });
});
