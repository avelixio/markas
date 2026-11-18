// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalModelServers } from "./local-models";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-local-models-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Answers like LM Studio on its usual address; Ollama is not running. */
function fakeFetch(models: string[] | null) {
  const asked: string[] = [];
  const impl = (async (url: string | URL) => {
    const address = String(url);
    asked.push(address);
    if (address === "http://127.0.0.1:1234/v1/models" && models) {
      return new Response(JSON.stringify({ data: models.map((id) => ({ id })) }));
    }
    throw new TypeError("connect ECONNREFUSED");
  }) as typeof fetch;
  return { impl, asked };
}

describe("model servers on this computer", () => {
  it("finds a running server and its models, and says when one does not answer", async () => {
    const servers = new LocalModelServers(root, fakeFetch(["qwen-8b", "llama-3b"]).impl);
    await servers.initialize();
    expect(await servers.scan()).toEqual([
      {
        id: "lmstudio",
        name: "LM Studio",
        address: "http://127.0.0.1:1234",
        running: true,
        models: ["qwen-8b", "llama-3b"],
        connected: false,
      },
      {
        id: "ollama",
        name: "Ollama",
        address: "http://127.0.0.1:11434",
        running: false,
        models: [],
        connected: false,
      },
    ]);
  });

  it("connects a running server and hands it to OpenCode, without touching OpenCode's own settings", async () => {
    const servers = new LocalModelServers(root, fakeFetch(["qwen-8b"]).impl);
    await servers.initialize();
    await servers.connect("lmstudio");
    expect(servers.openCodeProviders()).toEqual({
      "markas-lmstudio": {
        npm: "@ai-sdk/openai-compatible",
        name: "LM Studio (this computer)",
        options: { baseURL: "http://127.0.0.1:1234/v1" },
        models: { "qwen-8b": { name: "qwen-8b" } },
      },
    });
    // Remembered across a restart of Markas.
    const again = new LocalModelServers(root, fakeFetch(null).impl);
    await again.initialize();
    expect(Object.keys(again.openCodeProviders())).toEqual(["markas-lmstudio"]);
    const scanned = await again.scan();
    // Not running now, but still connected, with the models it had.
    expect(scanned[0]).toMatchObject({ running: false, connected: true, models: ["qwen-8b"] });
    expect(JSON.parse(await readFile(join(root, "local-models.json"), "utf8")).version).toBe(1);
  });

  it("refuses to connect a server that is not running, or has no model loaded", async () => {
    const off = new LocalModelServers(root, fakeFetch(null).impl);
    await off.initialize();
    await expect(off.connect("lmstudio")).rejects.toThrow("LM Studio is not running");
    const empty = new LocalModelServers(root, fakeFetch([]).impl);
    await empty.initialize();
    await expect(empty.connect("lmstudio")).rejects.toThrow("no model loaded");
    await expect(empty.connect("somewhere-else")).rejects.toThrow("does not know");
    expect(empty.openCodeProviders()).toEqual({});
  });

  it("forgets a server when it is disconnected", async () => {
    const servers = new LocalModelServers(root, fakeFetch(["qwen-8b"]).impl);
    await servers.initialize();
    await servers.connect("lmstudio");
    await servers.disconnect("lmstudio");
    expect(servers.openCodeProviders()).toEqual({});
    expect((await servers.scan())[0]?.connected).toBe(false);
  });

  it("starts empty when its file cannot be read", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, "local-models.json"), "not json");
    const servers = new LocalModelServers(root, fakeFetch(null).impl);
    await servers.initialize();
    expect(servers.openCodeProviders()).toEqual({});
  });
});
