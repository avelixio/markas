// Starts a packaged `markas` program the way a person would, on this computer's own system, and
// checks it through its API: the web UI, the engine search, and the Keyring with this system's own
// secret store (the login Keychain on macOS). Data goes to a temporary folder; the keys it makes
// are fictional, on example.com, and removed again.
//
//   bun scripts/package-smoke.ts dist/release/markas-0.1.2-macos-arm64/markas
//
// On macOS the Keyring's master key lives in the login Keychain, which is shared with a real
// Markas on the same Mac. An existing master key is read, never replaced.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const program = process.argv[2];
if (!program) {
  console.error("usage: bun scripts/package-smoke.ts <path to the markas program>");
  process.exit(2);
}

// A step that never returns must fail the run, not hang it.
setTimeout(() => {
  console.error("package smoke: timed out after three minutes");
  process.exit(1);
}, 180_000).unref();

const home = await mkdtemp(join(tmpdir(), "markas-smoke-"));
const port = 20_000 + Math.floor(Math.random() * 20_000);
const base = `http://127.0.0.1:${port}`;
const ok = (name: string, detail = "") =>
  console.log(`  ok  ${name}${detail ? `: ${detail}` : ""}`);

const host = spawn(resolve(program), ["serve"], {
  env: { ...process.env, MARKAS_HOME: home, MARKAS_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
host.stdout.on("data", (chunk) => (log += chunk));
host.stderr.on("data", (chunk) => (log += chunk));

try {
  for (let tries = 0; tries < 60; tries += 1) {
    if (
      await fetch(`${base}/`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await new Promise((done) => setTimeout(done, 500));
  }
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Markas<\/title>/);
  ok("the web UI loads");

  const token = (await readFile(join(home, "token"), "utf8")).trim();
  const call = async (method: string, input: unknown = {}) => {
    const response = await fetch(`${base}/api/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const body = (await response.json()) as { result?: unknown; error?: string };
    if (!response.ok) throw new Error(`${method}: ${body.error ?? response.status}`);
    return body.result as never;
  };

  const info: { version: string; platform: string } = await call("app.getInfo");
  assert.equal(info.platform, process.platform);
  ok("the host answers", `${info.version} on ${info.platform}`);

  const unauthorised = await fetch(`${base}/api/app.getInfo`, { method: "POST", body: "{}" });
  assert.equal(unauthorised.status, 401);
  ok("a call without the token is refused");

  // The runner has no engines; finding none must still finish, not hang.
  const engines: { engine: string; state: string }[] = await call("setup.engineStatus");
  ok("the engine search finishes", engines.map((e) => `${e.engine}=${e.state}`).join(", "));

  const login = {
    kind: "login",
    origin: "https://app.example.com",
    username: "smoke",
    value: "not-a-real-password",
    sharedWith: [],
  };
  const first: { id: string; name: string } = await call("keyring.create", {
    ...login,
    name: "app.example.com",
  });
  const second: { id: string; name: string } = await call("keyring.create", {
    ...login,
    name: "  Web   Example ",
  });
  assert.equal(second.name, "Web Example");
  await assert.rejects(call("keyring.create", { ...login, name: "web example" }));
  const revealed: { value: string } = await call("keyring.reveal", first.id);
  assert.equal(revealed.value, login.value);
  for (const key of [first, second]) await call("keyring.remove", key.id);
  assert.equal(((await call("keyring.list")) as unknown[]).length, 0);
  ok("the Keyring seals, opens and removes keys");

  const keyFile = join(home, "keyring.key");
  if (process.platform === "darwin") {
    assert.equal(existsSync(keyFile), false, "on macOS the master key belongs in the Keychain");
    ok("the master key is in the macOS Keychain, not in a file");
  } else if (process.platform === "linux" && existsSync(keyFile)) {
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
    ok("the master key file is private");
  }
  if (process.platform !== "win32") {
    assert.equal(statSync(home).mode & 0o777, 0o700);
    ok("the data folder is private");
  }
} catch (error) {
  console.error(log);
  throw error;
} finally {
  if (host.exitCode === null && host.signalCode === null) {
    const exited = new Promise((done) => host.once("exit", done));
    host.kill("SIGTERM");
    await exited;
  }
  await rm(home, { recursive: true, force: true });
}
ok("the host stopped");
