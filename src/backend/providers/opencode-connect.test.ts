// @vitest-environment node

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenCodeConnect } from "./opencode-connect";

let root: string;
let connect: OpenCodeConnect | null = null;

/**
 * A stand-in for `opencode serve`: it prints the line OpenCode prints, checks the password it
 * was started with, and answers the routes the connector uses. Every request is written down.
 */
const FAKE_SERVER = `
const http = require("http");
const fs = require("fs");
const log = process.env.FAKE_LOG;
const expected = "Basic " + Buffer.from("markas:" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
fs.writeFileSync(process.env.FAKE_ENV, JSON.stringify({
  config: process.env.OPENCODE_CONFIG_CONTENT || null,
  args: process.argv.slice(2),
}));
const connected = new Set(["anthropic"]);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    fs.appendFileSync(log, JSON.stringify({ method: req.method, url: req.url, body: body || null, auth: req.headers.authorization === expected }) + "\\n");
    if (req.headers.authorization !== expected) { res.writeHead(401); return res.end(); }
    const send = (value) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.url === "/provider") return send({
      all: [
        { id: "openai", name: "OpenAI", models: {} },
        { id: "anthropic", name: "Anthropic", models: { a: {}, b: {} } },
        { id: "zeta", name: "Zeta", models: {} },
      ],
      connected: [...connected],
      default: {},
    });
    if (req.url === "/provider/auth") return send({
      openai: [
        { type: "oauth", label: "ChatGPT (browser)" },
        { type: "api", label: "Manually enter API Key" },
      ],
    });
    if (req.url === "/provider/openai/oauth/authorize") return send({ url: "https://auth.example.com/authorize?x=1", method: "auto", instructions: "Finish in the browser." });
    if (req.url === "/provider/openai/oauth/callback") { connected.add("openai"); return send(true); }
    if (req.url === "/auth/zeta" && req.method === "PUT") { connected.add("zeta"); return send(true); }
    if (req.url === "/auth/anthropic" && req.method === "DELETE") { connected.delete("anthropic"); return send(true); }
    if (req.url === "/auth/broken" && req.method === "PUT") { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ data: { message: "That key was refused." } })); }
    res.writeHead(404); res.end();
  });
}).listen(0, "127.0.0.1", function () {
  console.log("opencode server listening on http://127.0.0.1:" + this.address().port);
});
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-opencode-connect-"));
  await writeFile(join(root, "server.cjs"), FAKE_SERVER);
  const program = join(root, "opencode");
  await writeFile(
    program,
    `#!/bin/sh\nFAKE_LOG="${join(root, "log.jsonl")}" FAKE_ENV="${join(root, "env.json")}" exec node "${join(root, "server.cjs")}" "$@"\n`,
  );
  await chmod(program, 0o755);
});

afterEach(async () => {
  await connect?.stop();
  connect = null;
  await rm(root, { recursive: true, force: true });
});

const start = (settings: Record<string, unknown> = {}) => {
  connect = new OpenCodeConnect({
    executable: async () => join(root, "opencode"),
    settings: () => settings,
  });
  return connect;
};

async function requests(): Promise<
  Array<{ method: string; url: string; body: string | null; auth: boolean }>
> {
  const text = await readFile(join(root, "log.jsonl"), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe.skipIf(process.platform === "win32")("connecting providers through OpenCode", () => {
  it("lists the providers OpenCode knows, connected first, with their ways in", async () => {
    const providers = await start().providers();
    expect(providers.map((provider) => [provider.id, provider.connected, provider.models])).toEqual(
      [
        ["anthropic", true, 2],
        ["openai", false, 0],
        ["zeta", false, 0],
      ],
    );
    expect(providers[1]?.methods).toEqual([
      { index: 0, kind: "browser", label: "ChatGPT (browser)", questions: [] },
      { index: 1, kind: "key", label: "Manually enter API Key", questions: [] },
    ]);
    // A provider OpenCode lists no way in for still takes a key.
    expect(providers[2]?.methods).toEqual([
      { index: 0, kind: "key", label: "API key", questions: [] },
    ]);
  });

  it("runs OpenCode's server on this computer only, behind a password made for the run", async () => {
    await start({ provider: { "markas-lmstudio": {} } }).providers();
    const env = JSON.parse(await readFile(join(root, "env.json"), "utf8"));
    expect(env.args).toEqual(["serve", "--port", "0", "--hostname", "127.0.0.1"]);
    // The settings Markas adds, such as a connected local model server, go along.
    expect(JSON.parse(env.config)).toEqual({ provider: { "markas-lmstudio": {} } });
    expect((await requests()).every((request) => request.auth)).toBe(true);
  });

  it("signs in through the browser: gives the page, then waits for OpenCode", async () => {
    const opencode = start();
    expect(await opencode.startSignIn("openai", 0, { region: "eu" })).toEqual({
      url: "https://auth.example.com/authorize?x=1",
      finish: "wait",
      instructions: "Finish in the browser.",
    });
    expect(await opencode.finishSignIn("openai", 0)).toBe(true);
    const sent = await requests();
    expect(sent.find((request) => request.url.endsWith("/authorize"))?.body).toBe(
      JSON.stringify({ method: 0, inputs: { region: "eu" } }),
    );
    expect(
      (await opencode.providers()).find((provider) => provider.id === "openai")?.connected,
    ).toBe(true);
  });

  it("gives a key to OpenCode, and says what OpenCode said when it refused one", async () => {
    const opencode = start();
    await opencode.saveKey("zeta", "  sk-not-a-real-key  ");
    const put = (await requests()).find((request) => request.url === "/auth/zeta");
    expect(put?.body).toBe(JSON.stringify({ type: "api", key: "sk-not-a-real-key" }));
    await expect(opencode.saveKey("broken", "x")).rejects.toThrow("That key was refused.");
    await expect(opencode.saveKey("zeta", "   ")).rejects.toThrow("Paste the key first.");
  });

  it("treats a cancelled wait for the browser as not connected, not as a failure", async () => {
    const opencode = start();
    // The stand-in answers at once; cancelling stops the server before a second wait.
    await opencode.startSignIn("openai", 0);
    const waiting = opencode.finishSignIn("missing", 0);
    await opencode.cancelSignIn("missing");
    await expect(waiting).resolves.toBe(false);
  });

  it("disconnects a provider", async () => {
    const opencode = start();
    await opencode.disconnect("anthropic");
    expect((await opencode.providers()).every((provider) => !provider.connected)).toBe(true);
  });

  it("refuses a provider id that could reach another route", async () => {
    const opencode = start();
    await expect(opencode.saveKey("../provider", "x")).rejects.toThrow("not a provider");
    await expect(opencode.startSignIn("openai/oauth", 0)).rejects.toThrow("not a provider");
  });

  it("starts one server for many requests, and stops it", async () => {
    const opencode = start();
    await Promise.all([opencode.providers(), opencode.providers()]);
    await opencode.stop();
    // A request after a stop starts a new server.
    await opencode.providers();
    const env = JSON.parse(await readFile(join(root, "env.json"), "utf8"));
    expect(env.args[0]).toBe("serve");
  });
});

describe("when OpenCode cannot start", () => {
  it("says so in plain words", async () => {
    const opencode = new OpenCodeConnect({
      executable: async () => join(root, "missing-opencode"),
    });
    connect = opencode;
    await expect(opencode.providers()).rejects.toThrow();
  });
});
