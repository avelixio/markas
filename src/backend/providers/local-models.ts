import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord } from "../protocol";

/** A program on this computer that serves models the way OpenAI's API does. */
interface KnownServer {
  id: string;
  name: string;
  /** Where it listens unless the person changed it. */
  address: string;
  /** Reads the model names out of what the server lists. */
  list: { path: string; read: (body: unknown) => string[] };
}

const KNOWN_SERVERS: KnownServer[] = [
  {
    id: "lmstudio",
    name: "LM Studio",
    address: "http://127.0.0.1:1234",
    list: { path: "/v1/models", read: (body) => namesOf(body, "data", "id") },
  },
  {
    id: "ollama",
    name: "Ollama",
    address: "http://127.0.0.1:11434",
    list: { path: "/api/tags", read: (body) => namesOf(body, "models", "name") },
  },
];

/** A local model server as the Providers page shows it. */
export interface LocalModelServer {
  id: string;
  name: string;
  address: string;
  /** True when it answered just now. */
  running: boolean;
  models: string[];
  /** True when the person connected it, so bots can use its models. */
  connected: boolean;
}

interface Saved {
  version: 1;
  servers: Array<{ id: string; name: string; address: string; models: string[] }>;
}

const PROBE_TIMEOUT_MS = 1_500;

/**
 * Finds model servers running on this computer, and remembers the ones the person connected.
 * A connected server is handed to OpenCode as a provider, so a bot on OpenCode can use its models;
 * nothing is written into the person's own OpenCode settings.
 */
export class LocalModelServers {
  readonly #file: string;
  readonly #fetch: typeof fetch;
  #saved: Saved = { version: 1, servers: [] };

  constructor(root: string, fetchImpl: typeof fetch = fetch) {
    this.#file = join(root, "local-models.json");
    this.#fetch = fetchImpl;
  }

  async initialize(): Promise<void> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.#file, "utf8"));
      if (isRecord(raw) && raw.version === 1 && Array.isArray(raw.servers)) {
        this.#saved = {
          version: 1,
          servers: raw.servers.filter(isRecord).flatMap((server) =>
            typeof server.id === "string" &&
            typeof server.name === "string" &&
            typeof server.address === "string" &&
            Array.isArray(server.models)
              ? [
                  {
                    id: server.id,
                    name: server.name,
                    address: server.address,
                    models: server.models.filter((m): m is string => typeof m === "string"),
                  },
                ]
              : [],
          ),
        };
      }
    } catch {
      // No file yet, or one that cannot be read: nothing is connected.
    }
  }

  /** Looks at the usual addresses, and says what answered and what is connected. */
  async scan(): Promise<LocalModelServer[]> {
    return Promise.all(
      KNOWN_SERVERS.map(async (known) => {
        const saved = this.#saved.servers.find((server) => server.id === known.id);
        const models = await this.#probe(known);
        return {
          id: known.id,
          name: known.name,
          address: known.address,
          running: models !== null,
          models: models ?? saved?.models ?? [],
          connected: saved !== undefined,
        };
      }),
    );
  }

  /** Lets bots use a server's models. It must be running, so its models can be read. */
  async connect(id: string): Promise<LocalModelServer> {
    const known = KNOWN_SERVERS.find((server) => server.id === id);
    if (!known) throw new Error("Markas does not know that model server.");
    const models = await this.#probe(known);
    if (models === null) {
      throw new Error(`${known.name} is not running. Start it, then connect it again.`);
    }
    if (models.length === 0) {
      throw new Error(
        `${known.name} has no model loaded. Load one in ${known.name}, then connect it.`,
      );
    }
    const servers = this.#saved.servers.filter((server) => server.id !== id);
    servers.push({ id, name: known.name, address: known.address, models });
    await this.#save({ version: 1, servers });
    return { id, name: known.name, address: known.address, running: true, models, connected: true };
  }

  async disconnect(id: string): Promise<void> {
    await this.#save({
      version: 1,
      servers: this.#saved.servers.filter((server) => server.id !== id),
    });
  }

  /**
   * The connected servers as OpenCode providers, for the settings Markas gives the OpenCode
   * processes it starts. The provider ids are prefixed, so they never replace one of the person's.
   */
  openCodeProviders(): Record<string, unknown> {
    return Object.fromEntries(
      this.#saved.servers.map((server) => [
        `markas-${server.id}`,
        {
          npm: "@ai-sdk/openai-compatible",
          name: `${server.name} (this computer)`,
          options: { baseURL: `${server.address}/v1` },
          models: Object.fromEntries(server.models.map((model) => [model, { name: model }])),
        },
      ]),
    );
  }

  async #probe(known: KnownServer): Promise<string[] | null> {
    try {
      const response = await this.#fetch(`${known.address}${known.list.path}`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return known.list.read(await response.json());
    } catch {
      return null;
    }
  }

  async #save(next: Saved): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
    this.#saved = next;
  }
}

function namesOf(body: unknown, list: string, key: string): string[] {
  const entries = isRecord(body) && Array.isArray(body[list]) ? body[list] : [];
  return entries
    .filter(isRecord)
    .map((entry) => entry[key])
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .slice(0, 200);
}
