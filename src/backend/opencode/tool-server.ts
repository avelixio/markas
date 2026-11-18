import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isRecord } from "../protocol";
import { MARKAS_VERSION } from "../version";

/** One tool Markas offers a bot, as the engines are told about it. */
export interface OfferedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** What a tool call gave back, in the words of the Model Context Protocol. */
export interface ToolAnswer {
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  isError: boolean;
}

export type ToolCallHandler = (
  owner: string,
  namespace: string,
  tool: string,
  args: unknown,
) => Promise<ToolAnswer>;

interface Registration {
  token: Buffer;
  namespaces: Map<string, OfferedTool[]>;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/**
 * Offers Markas's own tools to an engine that can only take tools over the Model Context
 * Protocol. It listens on this computer only, and every request must carry the secret that
 * was made for one conversation, so a bot reaches its own tools and nothing else does.
 */
export class LocalToolServer {
  readonly #handler: ToolCallHandler;
  readonly #registrations = new Map<string, Registration>();
  #server: Server | null = null;
  #port = 0;

  constructor(handler: ToolCallHandler) {
    this.#handler = handler;
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = createServer((request, response) => {
      void this.#handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.#port = (server.address() as AddressInfo).port;
    this.#server = server;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#registrations.clear();
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * Makes the tools reachable for one owner and returns where, and the secret to send.
   * The owner is whatever the caller wants back with every call, such as a conversation id.
   */
  register(
    owner: string,
    namespaces: Map<string, OfferedTool[]>,
  ): { token: string; urlFor: (namespace: string) => string } {
    if (!this.#server) throw new Error("The tool server is not running.");
    const token = randomBytes(32).toString("base64url");
    this.#registrations.set(owner, { token: Buffer.from(token), namespaces });
    const port = this.#port;
    return {
      token,
      urlFor: (namespace) =>
        `http://127.0.0.1:${port}/mcp/${encodeURIComponent(owner)}/${encodeURIComponent(namespace)}`,
    };
  }

  unregister(owner: string): void {
    this.#registrations.delete(owner);
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // A web page must never reach this, even one that guesses the port.
    if (request.headers.origin) return reply(response, 403);
    const [, root, rawOwner, rawNamespace, ...rest] = (request.url ?? "").split("?")[0].split("/");
    if (root !== "mcp" || !rawOwner || !rawNamespace || rest.length > 0) {
      return reply(response, 404);
    }
    const owner = decodeURIComponent(rawOwner);
    const registration = this.#registrations.get(owner);
    const given = Buffer.from((request.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    if (
      !registration ||
      given.length !== registration.token.length ||
      !timingSafeEqual(given, registration.token)
    ) {
      return reply(response, 401);
    }
    const namespace = decodeURIComponent(rawNamespace);
    const tools = registration.namespaces.get(namespace);
    if (!tools) return reply(response, 404);
    // There is no stream to listen on: every answer comes back on the request that asked.
    if (request.method === "DELETE") return reply(response, 200);
    if (request.method !== "POST") return reply(response, 405);

    let message: unknown;
    try {
      message = JSON.parse(await readBody(request));
    } catch {
      return json(response, rpcError(null, -32700, "The request was not valid JSON."));
    }
    if (Array.isArray(message)) {
      const answers = (
        await Promise.all(message.map((entry) => this.#answer(owner, namespace, tools, entry)))
      ).filter((answer) => answer !== null);
      return answers.length ? json(response, answers) : reply(response, 202);
    }
    const answer = await this.#answer(owner, namespace, tools, message);
    return answer ? json(response, answer) : reply(response, 202);
  }

  async #answer(
    owner: string,
    namespace: string,
    tools: OfferedTool[],
    message: unknown,
  ): Promise<unknown> {
    if (!isRecord(message) || typeof message.method !== "string") {
      return rpcError(null, -32600, "The request was not a valid message.");
    }
    const id = message.id;
    // A message without an id is a notice and gets no answer.
    if (id === undefined || id === null) return null;
    const params = isRecord(message.params) ? message.params : {};
    switch (message.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: namespace, version: MARKAS_VERSION },
        });
      }
      case "ping":
        return rpcResult(id, {});
      // Markas offers tools only; asking for its prompts or resources finds none, not an error.
      case "prompts/list":
        return rpcResult(id, { prompts: [] });
      case "resources/list":
        return rpcResult(id, { resources: [] });
      case "resources/templates/list":
        return rpcResult(id, { resourceTemplates: [] });
      case "tools/list":
        return rpcResult(id, { tools });
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!tools.some((tool) => tool.name === name)) {
          return rpcError(id, -32602, `Unknown tool: ${name}`);
        }
        try {
          return rpcResult(id, await this.#handler(owner, namespace, name, params.arguments ?? {}));
        } catch (error) {
          return rpcResult(id, {
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
            isError: true,
          } satisfies ToolAnswer);
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${message.method}`);
    }
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("The request is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function reply(response: ServerResponse, status: number): void {
  response.writeHead(status).end();
}

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
