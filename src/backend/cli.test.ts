// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexCliError,
  lastAbsolutePath,
  loginShellFor,
  parseClaudeVersion,
  parseCodexVersion,
  parseOpenCodeVersion,
  posixPathCandidates,
  resolveClaudeCli,
  resolveCodexCli,
  windowsFallbackPaths,
} from "./cli";

const originalShell = process.env.SHELL;
const originalAppData = process.env.APPDATA;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalPath = process.env.PATH;
const temporaryPaths: string[] = [];

afterEach(async () => {
  restoreEnvironment("APPDATA", originalAppData);
  restoreEnvironment("LOCALAPPDATA", originalLocalAppData);
  restoreEnvironment("PATH", originalPath);
  restoreEnvironment("SHELL", originalShell);
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("Codex CLI version parsing", () => {
  it("reads the installed CLI version format", () => {
    expect(parseCodexVersion("codex-cli 0.144.1\n")).toBe("0.144.1");
  });

  it("fails closed on an unknown format", () => {
    expect(() => parseCodexVersion("Codex development build")).toThrow(CodexCliError);
  });
});

describe("Claude CLI version parsing", () => {
  it("reads the installed CLI version format", () => {
    expect(parseClaudeVersion("2.1.231 (Claude Code)\n")).toBe("2.1.231");
  });

  it("fails closed on an unknown format", () => {
    expect(() => parseClaudeVersion("Claude development build")).toThrow(CodexCliError);
  });

  it("reads the bare version OpenCode prints, and nothing that only contains one", () => {
    expect(parseOpenCodeVersion("1.14.20\r\n")).toBe("1.14.20");
    expect(parseOpenCodeVersion("v1.15.0-beta.2\n")).toBe("1.15.0");
    expect(() => parseOpenCodeVersion("codex-cli 0.150.0")).toThrow(CodexCliError);
    expect(() => parseOpenCodeVersion("")).toThrow(CodexCliError);
  });
});

describe("Windows CLI fallback paths", () => {
  it("includes current installer paths", () => {
    const environment = {
      APPDATA: "C:\\Users\\Jane Doe\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\Jane Doe\\AppData\\Local",
    };

    expect(windowsFallbackPaths("codex", "C:\\Users\\Jane Doe", environment)).toContain(
      "C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe",
    );
    expect(windowsFallbackPaths("claude", "C:\\Users\\Jane Doe", environment)).toEqual(
      expect.arrayContaining([
        "C:\\Users\\Jane Doe\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe",
        "C:\\Users\\Jane Doe\\.local\\bin\\claude.exe",
        "C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\claude.cmd",
      ]),
    );
  });

  it.runIf(process.platform === "win32")(
    "runs npm command shims when the user profile contains a space",
    async () => {
      await createWindowsNpmShims();
      await expect(resolveCodexCli()).resolves.toMatchObject({ version: "0.144.1" });
      await expect(resolveClaudeCli()).resolves.toMatchObject({ version: "2.1.231" });
    },
  );

  it.runIf(process.platform === "win32")("reports a CLI that exists but cannot start", async () => {
    const root = await mkdtemp(join(tmpdir(), "markas-cli-test-"));
    temporaryPaths.push(root);
    const appData = join(root, "User Name", "AppData", "Roaming");
    await mkdir(join(appData, "npm"), { recursive: true });
    await writeFile(join(appData, "npm", "codex.cmd"), "@echo off\r\nexit /b 1\r\n");
    useIsolatedWindowsEnvironment(appData, join(root, "missing-local-app-data"));

    await expect(resolveCodexCli()).rejects.toMatchObject({
      code: "invalid",
      message:
        "Codex CLI was found but could not be started. Run `codex --version` in a new terminal.",
    });
  });
});

describe("macOS and Linux CLI lookup", () => {
  it("looks in every folder of PATH, in order", () => {
    expect(posixPathCandidates("opencode", "/home/jane/.nvm/bin:/usr/bin::relative/bin")).toEqual([
      "/home/jane/.nvm/bin/opencode",
      "/usr/bin/opencode",
    ]);
    expect(posixPathCandidates("codex", undefined)).toEqual([]);
  });

  it("asks the person's own shell, and assumes zsh only on macOS", () => {
    expect(loginShellFor("linux", "/usr/bin/fish")).toBe("/usr/bin/fish");
    expect(loginShellFor("linux", undefined)).toBe("/bin/sh");
    expect(loginShellFor("linux", "bash")).toBe("/bin/sh");
    expect(loginShellFor("darwin", undefined)).toBe("/bin/zsh");
  });

  it("takes the last full path a shell prints, past lines its startup files print", () => {
    expect(lastAbsolutePath("Welcome back!\n/opt/tools/bin/claude\n")).toBe(
      "/opt/tools/bin/claude",
    );
    expect(lastAbsolutePath("claude: not found\n")).toBeNull();
    expect(lastAbsolutePath("")).toBeNull();
  });

  it.runIf(process.platform !== "win32")(
    "finds an engine that is only on PATH, on a computer without zsh",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "markas-cli-test-"));
      temporaryPaths.push(root);
      const folder = join(root, "tools", "bin");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "claude"), "#!/bin/sh\necho '2.1.231 (Claude Code)'\n", {
        mode: 0o755,
      });
      process.env.PATH = `${folder}:/usr/bin:/bin`;
      process.env.SHELL = "/bin/sh";

      await expect(resolveClaudeCli()).resolves.toEqual({
        executable: join(folder, "claude"),
        version: "2.1.231",
      });
    },
  );

  it.runIf(process.platform !== "win32")(
    "finds an engine only the person's login shell knows, past what its startup files print",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "markas-cli-test-"));
      temporaryPaths.push(root);
      const folder = join(root, "hidden", "bin");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "claude"), "#!/bin/sh\necho '2.1.231 (Claude Code)'\n", {
        mode: 0o755,
      });
      const shell = join(root, "own-shell");
      await writeFile(shell, `#!/bin/sh\necho 'Welcome back'\necho '${folder}/claude'\n`, {
        mode: 0o755,
      });
      process.env.PATH = "/usr/bin:/bin";
      process.env.SHELL = shell;

      await expect(resolveClaudeCli()).resolves.toMatchObject({
        executable: join(folder, "claude"),
      });
    },
  );

  it.runIf(process.platform !== "win32")(
    "does not wait on a login shell that stops itself",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "markas-cli-test-"));
      temporaryPaths.push(root);
      const folder = join(root, "tools", "bin");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "claude"), "#!/bin/sh\necho '2.1.231 (Claude Code)'\n", {
        mode: 0o755,
      });
      const shell = join(root, "stuck-shell");
      await writeFile(shell, "#!/bin/sh\nkill -STOP $$\n", { mode: 0o755 });
      process.env.PATH = `${folder}:/usr/bin:/bin`;
      process.env.SHELL = shell;

      const started = Date.now();
      await expect(resolveClaudeCli()).resolves.toMatchObject({
        executable: join(folder, "claude"),
      });
      expect(Date.now() - started).toBeLessThan(8_000);
    },
    15_000,
  );
});

async function createWindowsNpmShims(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "markas-cli-test-"));
  temporaryPaths.push(root);
  const appData = join(root, "User Name", "AppData", "Roaming");
  const npmDirectory = join(appData, "npm");
  await mkdir(npmDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(npmDirectory, "codex.cmd"), "@echo off\r\necho codex-cli 0.144.1\r\n"),
    writeFile(join(npmDirectory, "claude.cmd"), "@echo off\r\necho 2.1.231 (Claude Code)\r\n"),
  ]);
  useIsolatedWindowsEnvironment(appData, join(root, "missing-local-app-data"));
}

function useIsolatedWindowsEnvironment(appData: string, localAppData: string): void {
  process.env.APPDATA = appData;
  process.env.LOCALAPPDATA = localAppData;
  process.env.PATH = "";
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
