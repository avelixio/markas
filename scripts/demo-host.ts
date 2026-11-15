// Starts a throwaway host with an in-process engine in place of the installed CLIs, prints
// where it listens as one JSON line, and runs until its input closes.
// The browser test (scripts/e2e-ui.mjs) drives the real web UI against it.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryKeyStore } from "../src/backend/keyring/key-store";
import { FakeAgentClient, fakeClientFactory } from "../src/backend/testing/fake-agent-client";
import { startHost } from "../src/host/main";
import { readToken } from "../src/host/token";

const home = await mkdtemp(join(tmpdir(), "markas-demo-"));
const port = 20_000 + Math.floor(Math.random() * 20_000);
const host = await startHost(
  { MARKAS_HOME: home, MARKAS_PORT: String(port) },
  {
    createClient: fakeClientFactory({
      codex: new FakeAgentClient({ autoReply: "Stock looks fine. Nothing is low." }),
    }),
    masterKeyStore: new MemoryKeyStore(),
  },
);
console.log(JSON.stringify({ url: host.url, token: await readToken(host.paths.tokenFile) }));

const stop = async () => {
  await host.stop();
  await rm(home, { recursive: true, force: true });
  process.exit(0);
};
process.stdin.on("end", () => void stop());
process.stdin.on("close", () => void stop());
process.on("SIGTERM", () => void stop());
process.stdin.resume();
