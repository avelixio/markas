// A small client for FigCraft's MCP server (`figcraft-cli mcp`), spoken over stdio.
// The design in this folder is built by scripts through this client, so the .figcraft file can
// always be regenerated from source.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Finds figcraft-cli: FIGCRAFT_CLI, then ~/.markas/tools/figcraft, then PATH. */
export function resolveFigcraftCli() {
  const executable = process.platform === "win32" ? "figcraft-cli.exe" : "figcraft-cli";
  const candidates = [
    process.env.FIGCRAFT_CLI,
    join(homedir(), ".markas", "tools", "figcraft", executable),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? executable;
}

export class Figcraft {
  #child;
  #pending = new Map();
  #nextId = 1;

  static async start(cli = resolveFigcraftCli()) {
    const client = new Figcraft();
    client.#child = spawn(cli, ["mcp"], { stdio: ["pipe", "pipe", "ignore"] });
    client.#child.on("error", (error) => {
      for (const waiter of client.#pending.values()) waiter.reject(error);
    });
    createInterface({ input: client.#child.stdout }).on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const waiter = client.#pending.get(message.id);
      if (!waiter) return;
      client.#pending.delete(message.id);
      waiter.resolve(message);
    });
    await client.#rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "markas-design", version: "1" },
    });
    client.#send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return client;
  }

  #send(message) {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #rpc(method, params) {
    const id = this.#nextId++;
    this.#send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  /** Calls one MCP tool and returns its parsed JSON result, or its text when it is not JSON. */
  async tool(name, args = {}) {
    const reply = await this.#rpc("tools/call", { name, arguments: args });
    if (reply.error) throw new Error(`${name}: ${JSON.stringify(reply.error)}`);
    const text = (reply.result.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (reply.result.isError) throw new Error(`${name}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  run(command, params = {}) {
    return this.tool("run_command", { command, params });
  }

  async close() {
    this.#child.stdin.end();
    await new Promise((resolve) => this.#child.once("exit", resolve));
  }
}

// `node design/tools/figcraft.mjs commands <filter>...` prints matching command docs.
if (process.argv[1]?.endsWith("figcraft.mjs") && process.argv[2] === "commands") {
  const client = await Figcraft.start();
  for (const filter of process.argv.slice(3)) {
    const result = await client.tool("list_commands", { filter });
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 1);
    console.log(`\n### ${filter}\n${text.slice(0, Number(process.env.MAXC ?? 5000))}`);
  }
  await client.close();
}
