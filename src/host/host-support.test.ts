// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PORT, resolveHostPaths, resolvePort } from "./paths";
import { launchdPlist, SERVICE_LABEL, scheduledTaskXml, systemdUnit } from "./service-install";
import { ensureToken, readToken, tokensMatch } from "./token";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-host-support-test-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("host token", () => {
  it("creates a 256-bit token once and returns the same one afterwards", async () => {
    const path = join(root, "nested", "token");
    const token = await ensureToken(path);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await ensureToken(path)).toBe(token);
    expect(await readToken(path)).toBe(token);
    expect((await readFile(path, "utf8")).trim()).toBe(token);
  });

  it("replaces a corrupt token file instead of trusting it", async () => {
    const path = join(root, "token");
    await writeFile(path, "not-a-token");
    expect(await readToken(path)).toBeNull();
    expect(await ensureToken(path)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a missing token as absent", async () => {
    expect(await readToken(join(root, "missing"))).toBeNull();
  });

  it("matches only the exact token, whatever the lengths", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
    expect(tokensMatch("abc", "")).toBe(false);
  });
});

describe("host paths", () => {
  it("keeps everything under MARKAS_HOME when it is set", () => {
    const paths = resolveHostPaths({ MARKAS_HOME: root });
    expect(paths.root).toBe(root);
    expect(paths.tokenFile).toBe(join(root, "token"));
    expect(paths.hostFile).toBe(join(root, "host.json"));
  });

  it("defaults to ~/.markas", () => {
    expect(resolveHostPaths({}).root.endsWith(".markas")).toBe(true);
  });

  it("validates the port", () => {
    expect(resolvePort({})).toBe(DEFAULT_PORT);
    expect(resolvePort({ MARKAS_PORT: "5123" })).toBe(5123);
    expect(() => resolvePort({ MARKAS_PORT: "0" })).toThrow();
    expect(() => resolvePort({ MARKAS_PORT: "http" })).toThrow();
  });
});

describe("autostart definitions", () => {
  const command = {
    runtime: "/opt/bun & co/bun",
    args: ["/Users/me/markas/src/host/cli.ts", "serve"],
    logsRoot: "/Users/me/.markas/logs",
  };

  it("writes a launchd agent that starts at login and stays alive", () => {
    const plist = launchdPlist(command);
    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<string>/opt/bun &amp; co/bun</string>");
    expect(plist).toContain("<string>serve</string>");
  });

  it("writes a scheduled task that runs at sign-in and restarts on failure", () => {
    const xml = scheduledTaskXml({
      runtime: "C:\\Program Files\\bun\\bun.exe",
      args: ["C:\\My Apps\\Markas\\src\\host\\cli.ts", "serve"],
      logsRoot: "C:\\Users\\me\\.markas\\logs",
    });
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toContain("<Command>C:\\Program Files\\bun\\bun.exe</Command>");
    expect(xml).toContain(
      "<Arguments>&quot;C:\\My Apps\\Markas\\src\\host\\cli.ts&quot; serve</Arguments>",
    );
  });

  it("writes a systemd user unit that restarts", () => {
    const unit = systemdUnit(command);
    expect(unit).toContain('ExecStart="/opt/bun & co/bun" /Users/me/markas/src/host/cli.ts serve');
    expect(unit).toContain("Restart=always");
  });
});
