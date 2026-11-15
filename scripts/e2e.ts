// End-to-end test of the real host: a real Bun.serve socket, real stores on a temporary
// folder, the built web UI, and an in-process engine in place of the installed CLIs.
//
//   bun scripts/e2e.ts        (run `bun run build:ui` first)
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryKeyStore } from "../src/backend/keyring/key-store";
import { FakeAgentClient, fakeClientFactory } from "../src/backend/testing/fake-agent-client";
import { startHost } from "../src/host/main";
import { readToken } from "../src/host/token";

// A step that never returns must fail the run, not hang it.
setTimeout(() => {
  console.error("end-to-end: timed out after two minutes");
  process.exit(1);
}, 120_000).unref();

const home = await mkdtemp(join(tmpdir(), "markas-e2e-"));
const port = 20_000 + Math.floor(Math.random() * 20_000);
const base = `http://127.0.0.1:${port}`;
const steps: string[] = [];
const step = (name: string) => {
  steps.push(name);
  console.log(`  ok  ${name}`);
};

const host = await startHost(
  { MARKAS_HOME: home, MARKAS_PORT: String(port) },
  {
    createClient: fakeClientFactory({
      codex: new FakeAgentClient({ autoReply: "pong from e2e" }),
    }),
    masterKeyStore: new MemoryKeyStore(),
  },
);

try {
  const token = await readToken(host.paths.tokenFile);
  assert.ok(token, "the host wrote a token");
  const api = async (method: string, input?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({ input }),
    });
    const text = await response.text();
    let body: { result?: unknown; error?: string } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // Refusals before authentication are plain text.
      body = { error: text };
    }
    return { status: response.status, body };
  };

  const ui = await fetch(`${base}/`);
  assert.equal(ui.status, 200);
  assert.match(await ui.text(), /<title>Markas<\/title>/);
  step("serves the web UI without a token");

  const anonymous = await fetch(`${base}/api/agent.listBots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(anonymous.status, 401);
  assert.equal((await api("agent.listBots", null, { authorization: "Bearer wrong" })).status, 401);
  step("refuses API calls without the token");

  assert.equal((await api("agent.listBots", null, { origin: "https://evil.example" })).status, 403);
  step("refuses calls from another origin");

  const session = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.match(cookie, /^markas_session=/);
  const withCookie = await fetch(`${base}/api/app.getInfo`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: "{}",
  });
  assert.equal(withCookie.status, 200);
  step("turns the token into a working session cookie");

  const events = await fetch(`${base}/api/events`, { headers: { cookie } });
  assert.equal(events.status, 200);
  const reader = events.body?.getReader();
  assert.ok(reader);
  const seen: string[] = [];
  const decoder = new TextDecoder();
  const pump = (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      seen.push(decoder.decode(chunk.value));
    }
  })();

  // The agent service starts in the background; wait until it reports ready.
  await until(
    async () => (await api("agent.getStatus")).body.result,
    (status) => (status as { phase: string }).phase === "ready",
  );
  step("starts the agent service on the injected engine");

  const created = await api("agent.createBot");
  const bot = created.body.result as { id: string };
  assert.ok(bot.id);
  assert.equal((await api("agent.sendMessage", { botId: bot.id, text: "   " })).status, 400);
  const receipt = await api("agent.sendMessage", { botId: bot.id, text: "ping" });
  assert.equal(receipt.status, 200);
  step("creates a bot and queues a message");

  const conversation = await until(
    async () => (await api("agent.readConversation", bot.id)).body.result,
    (snapshot) => JSON.stringify(snapshot).includes("pong from e2e"),
  );
  assert.match(JSON.stringify(conversation), /"author":"assistant"/);
  step("delivers the message and stores the bot's reply");

  await until(
    async () => seen.join(""),
    // The stream can lag the reply by a moment, so wait for the event itself.
    (text) => (text as string).includes('"type":"turn-completed"'),
  );
  assert.match(seen.join(""), /event: agent/);
  step("streams agent events to the web UI");

  const upload = new FormData();
  upload.append("file", new File(["hello"], "note.txt", { type: "text/plain" }));
  const imported = await fetch(`${base}/api/agent.importAttachments`, {
    method: "POST",
    headers: { cookie },
    body: upload,
  });
  const drafts = ((await imported.json()) as { result: Array<{ id: string; name: string }> })
    .result;
  assert.equal(drafts[0]?.name, "note.txt");
  step("accepts an uploaded attachment");

  const key = await api("keyring.create", {
    name: "metrics",
    kind: "login",
    origin: "metrics.example.com",
    username: "sam@example.com",
    value: "e2e-secret-password",
    sharedWith: [bot.id],
  });
  assert.equal(key.status, 200);
  const sibling = await api("keyring.create", {
    name: "admin",
    kind: "login",
    origin: "admin.example.com",
    username: "sam@example.com",
    value: "e2e-other-password",
  });
  assert.equal(sibling.status, 200);
  const listed = (await api("keyring.list")).body.result as Array<{
    name: string;
    origin: string;
    sharedWith: string[];
  }>;
  assert.deepEqual(
    listed.map((item) => item.name),
    ["admin", "metrics"],
  );
  assert.ok(!JSON.stringify(listed).includes("e2e-secret-password"));
  assert.equal(
    (
      await api("keyring.create", {
        name: "metrics",
        kind: "login",
        origin: "x.example.com",
        username: "u",
        value: "v-value",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("keyring.create", {
        name: "plain",
        kind: "login",
        origin: "http://x.example.com",
        username: "u",
        value: "v-value",
      })
    ).status,
    400,
  );
  const keyId = (key.body.result as { id: string }).id;
  assert.equal(
    ((await api("keyring.reveal", keyId)).body.result as { value: string }).value,
    "e2e-secret-password",
  );
  step("keeps two logins on sibling hosts apart in the keyring, without listing secrets");

  const round = await api("rounds.create", {
    name: "Morning stock check",
    botId: bot.id,
    instruction: "Check stock levels and report anything low.",
    schedule: { kind: "daily", times: ["09:00"], weekdays: [1, 2, 3, 4, 5] },
  });
  assert.equal(round.status, 200);
  const roundId = (round.body.result as { id: string; nextRunAt: string | null }).id;
  assert.ok(
    (round.body.result as { nextRunAt: string | null }).nextRunAt,
    "the round has a next run",
  );
  assert.equal(
    (await api("rounds.create", { name: "Bad", botId: "nobody", instruction: "x", schedule: {} }))
      .status,
    400,
  );
  assert.equal((await api("rounds.runNow", roundId)).status, 200);
  const runs = await until(
    async () =>
      (await api("rounds.runs", { roundId })).body.result as Array<{
        status: string;
        manual: boolean;
      }>,
    (list) => list[0]?.status === "completed",
  );
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.manual, true);
  const paused = await api("rounds.update", { id: roundId, enabled: false });
  assert.equal((paused.body.result as { nextRunAt: string | null }).nextRunAt, null);
  step("runs a round through the bot's queue and records how it ended");

  assert.ok(Array.isArray((await api("archive.list")).body.result));
  const logged = (await api("logbook.list")).body.result as Array<{
    action: string;
    target: string;
    outcome: string;
  }>;
  for (const action of [
    "bot.created",
    "key.created",
    "key.shown",
    "round.created",
    "round.started",
  ]) {
    assert.ok(
      logged.some((entry) => entry.action === action && entry.outcome === "done"),
      `the logbook has ${action}`,
    );
  }
  assert.ok(logged.some((entry) => entry.action === "key.created" && entry.outcome === "failed"));
  assert.ok(!JSON.stringify(logged).includes("e2e-secret-password"));
  step("lists the archive and keeps a logbook of names, never secrets");

  assert.equal((await api("agent.deleteBot", bot.id)).status, 200);
  assert.deepEqual((await api("rounds.list")).body.result, []);
  assert.deepEqual((await api("agent.listBots")).body.result, []);
  const afterDelete = (await api("keyring.list")).body.result as Array<{
    name: string;
    sharedWith: string[];
  }>;
  // A deleted bot waits in the trash for 30 days, so its keys stay shared until it is removed for good (ADR 0013).
  assert.deepEqual(afterDelete.find((item) => item.name === "metrics")?.sharedWith, [bot.id]);
  step("deletes the bot into the trash, and hides its rounds with it");

  assert.equal((await api("agent.purgeBot", bot.id)).status, 200);
  const afterPurge = (await api("keyring.list")).body.result as Array<{
    name: string;
    sharedWith: string[];
  }>;
  assert.deepEqual(afterPurge.find((item) => item.name === "metrics")?.sharedWith, []);
  assert.deepEqual((await api("rounds.list")).body.result, []);
  step("removes the bot for good, and its key shares with it");

  await reader.cancel();
  await pump;
} finally {
  await host.stop();
  await rm(home, { recursive: true, force: true });
}

const down = await fetch(`${base}/`).then(
  () => false,
  () => true,
);
assert.ok(down, "the host stopped listening");
step("stops cleanly");
console.log(`\nend-to-end: ${steps.length} steps passed`);
process.exit(0);

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting for the host.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
