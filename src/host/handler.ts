import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { MailboxStore } from "../backend/mailbox-store";
import type { AttachmentDataInput } from "../shared/ipc";
import type { EventHub } from "./event-hub";
import type { HostMethod } from "./methods";
import { tokensMatch } from "./token";

export const SESSION_COOKIE = "markas_session";
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

export interface HostHandlerOptions {
  token: string;
  port: number;
  methods: Record<string, HostMethod>;
  events: EventHub;
  mailbox: Pick<MailboxStore, "resolveAttachment">;
  importAttachments: (data: AttachmentDataInput[]) => Promise<unknown>;
  /** Directory holding the built web UI (index.html and assets). */
  uiRoot: string;
}

/**
 * The whole HTTP surface of the host as a pure function of the request, so it can be tested
 * without opening a socket.
 *
 * Trust model: the host listens on loopback only. Every request must carry a loopback Host
 * header (blocks DNS rebinding) and, when it has an Origin, that origin must be the host itself
 * (blocks other sites). Everything except the static UI needs the bearer token or the session
 * cookie that the token buys.
 */
export function createHostHandler(
  options: HostHandlerOptions,
): (request: Request) => Promise<Response> {
  const allowedHosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((host) => `http://${host}`));

  return async (request) => {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (!host || !allowedHosts.has(host)) return text(421, "Unknown host.");
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.has(origin))
      return text(403, "Cross-origin requests are refused.");

    try {
      if (url.pathname === "/api/session") return await openSession(request, options);
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/attachments/")) {
        if (!isAuthorized(request, options.token)) return json(401, { error: "Unauthorized." });
        if (url.pathname === "/api/events") return eventStream(request, options.events);
        if (url.pathname === "/api/agent.importAttachments") {
          return await upload(request, options);
        }
        if (url.pathname.startsWith("/attachments/"))
          return await attachment(request, url, options);
        return await callMethod(request, url, options);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        return text(405, "Method not allowed.");
      return await staticFile(url, options.uiRoot);
    } catch (error) {
      return json(500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

function isAuthorized(request: Request, token: string): boolean {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return tokensMatch(token, header.slice(7).trim());
  const cookie = readCookie(request, SESSION_COOKIE);
  return cookie !== null && tokensMatch(token, cookie);
}

/** Exchanges the bearer token for an HttpOnly cookie so images and the event stream authenticate. */
async function openSession(request: Request, options: HostHandlerOptions): Promise<Response> {
  if (request.method !== "POST") return text(405, "Method not allowed.");
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || !tokensMatch(options.token, header.slice(7).trim())) {
    return json(401, { error: "Unauthorized." });
  }
  return json(
    200,
    { ok: true },
    {
      "Set-Cookie": `${SESSION_COOKIE}=${options.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
    },
  );
}

async function callMethod(
  request: Request,
  url: URL,
  options: HostHandlerOptions,
): Promise<Response> {
  if (request.method !== "POST") return text(405, "Method not allowed.");
  const name = decodeURIComponent(url.pathname.slice("/api/".length));
  const method = Object.hasOwn(options.methods, name) ? options.methods[name] : undefined;
  if (!method) return json(404, { error: `Unknown method: ${name}` });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return json(415, { error: "Send JSON." });
  }
  const body = await readBody(request, MAX_JSON_BYTES);
  if (body === null) return json(413, { error: "Request is too large." });
  let input: unknown;
  try {
    const parsed: unknown = body.byteLength === 0 ? {} : JSON.parse(new TextDecoder().decode(body));
    input =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "input") : undefined;
  } catch {
    return json(400, { error: "Body is not valid JSON." });
  }
  try {
    const result = await method(input);
    return json(200, { result: result ?? null });
  } catch (error) {
    // Method errors are user-facing validation or state messages, the same text the desktop
    // shell used to surface through IPC.
    return json(400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function upload(request: Request, options: HostHandlerOptions): Promise<Response> {
  if (request.method !== "POST") return text(405, "Method not allowed.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return json(413, { error: "Upload is too large." });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "Send multipart form data." });
  }
  const data: AttachmentDataInput[] = [];
  let total = 0;
  for (const value of form.getAll("file")) {
    if (typeof value === "string") continue;
    total += value.size;
    if (total > MAX_UPLOAD_BYTES) return json(413, { error: "Upload is too large." });
    data.push({
      name: value.name || `pasted-${Date.now()}.png`,
      mimeType: value.type,
      bytes: new Uint8Array(await value.arrayBuffer()),
    });
  }
  if (data.length === 0) return json(400, { error: "No files were sent." });
  try {
    return json(200, { result: await options.importAttachments(data) });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function attachment(
  request: Request,
  url: URL,
  options: HostHandlerOptions,
): Promise<Response> {
  if (request.method !== "GET") return text(405, "Method not allowed.");
  const id = url.pathname.split("/").filter(Boolean).at(-1);
  const found = id ? await options.mailbox.resolveAttachment(decodeURIComponent(id)) : null;
  if (!found) return text(404, "Not found");
  return new Response(await readFile(found.path), {
    headers: {
      "Content-Type": found.mimeType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      // Attachments are untrusted content: never let one run script in the host origin.
      "Content-Security-Policy":
        "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    },
  });
}

function eventStream(request: Request, events: EventHub): Response {
  if (request.method !== "GET") return text(405, "Method not allowed.");
  return new Response(events.subscribe(), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

async function staticFile(url: URL, uiRoot: string): Promise<Response> {
  const root = resolve(uiRoot);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  let filePath = resolve(root, `.${pathname}`);
  const candidate = relative(root, filePath);
  if (candidate.startsWith("..") || isAbsolute(candidate)) return text(404, "Not found");
  let bytes: Buffer<ArrayBuffer>;
  try {
    bytes = await readFile(filePath);
  } catch {
    // Unknown paths without an extension are client-side routes: serve the app shell.
    if (extname(pathname)) return text(404, "Not found");
    filePath = resolve(root, "index.html");
    try {
      bytes = await readFile(filePath);
    } catch {
      return text(503, "The web UI is not built yet. Run `bun run build:ui`.");
    }
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": UI_CONTENT_SECURITY_POLICY,
    },
  });
}

const UI_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

async function readBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.byteLength > limit ? null : bytes;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
