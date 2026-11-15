import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { createMasterKey, MASTER_KEY_BYTES } from "./crypto";

const execFileAsync = promisify(execFile);
const SERVICE = "id.markas.keyring";
const ACCOUNT = "master-key";

/** Where the keyring's master key is kept. The key never sits beside the encrypted items. */
export interface MasterKeyStore {
  readonly kind: string;
  load(): Promise<Buffer | null>;
  save(key: Buffer): Promise<void>;
}

/** Returns the master key, creating and saving one the first time. */
export async function loadOrCreateMasterKey(store: MasterKeyStore): Promise<Buffer> {
  const existing = await store.load();
  if (existing) {
    if (existing.byteLength !== MASTER_KEY_BYTES) {
      throw new Error(`The keyring master key in the ${store.kind} is damaged.`);
    }
    return existing;
  }
  const key = createMasterKey();
  await store.save(key);
  return key;
}

/** Picks the operating system's own secret store, falling back to a private file. */
export function resolveMasterKeyStore(dataRoot: string): MasterKeyStore {
  if (process.platform === "darwin") return new MacKeychainStore();
  if (process.platform === "win32") return new WindowsDpapiStore(join(dataRoot, "keyring.key"));
  return new LinuxSecretServiceStore(new FileKeyStore(join(dataRoot, "keyring.key")));
}

export class MemoryKeyStore implements MasterKeyStore {
  readonly kind = "memory";
  #key: Buffer | null = null;
  async load(): Promise<Buffer | null> {
    return this.#key;
  }
  async save(key: Buffer): Promise<void> {
    this.#key = Buffer.from(key);
  }
}

/** A file only the current user can read. Used where no system secret store is available. */
export class FileKeyStore implements MasterKeyStore {
  readonly kind = "private file";
  constructor(private readonly path: string) {}

  async load(): Promise<Buffer | null> {
    try {
      return Buffer.from((await readFile(this.path, "utf8")).trim(), "hex");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async save(key: Buffer): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, `${key.toString("hex")}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(this.path, 0o600);
  }
}

/** macOS: the login Keychain, through the system `security` tool. */
export class MacKeychainStore implements MasterKeyStore {
  readonly kind = "macOS Keychain";

  async load(): Promise<Buffer | null> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        ACCOUNT,
        "-w",
      ]);
      return Buffer.from(stdout.trim(), "hex");
    } catch {
      return null;
    }
  }

  async save(key: Buffer): Promise<void> {
    await execFileAsync("security", [
      "add-generic-password",
      "-U",
      "-s",
      SERVICE,
      "-a",
      ACCOUNT,
      "-l",
      "Markas keyring",
      "-w",
      key.toString("hex"),
    ]);
  }
}

/**
 * Windows: a file sealed with the Data Protection API, which ties it to the signed-in user.
 * The key travels to and from PowerShell on standard input and output, never on a command line.
 */
export class WindowsDpapiStore implements MasterKeyStore {
  readonly kind = "Windows data protection";
  constructor(private readonly path: string) {}

  async load(): Promise<Buffer | null> {
    let sealed: string;
    try {
      sealed = (await readFile(this.path, "utf8")).trim();
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    const hex = await powershell(
      "$sealed = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); " +
        "$plain = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, 'CurrentUser'); " +
        "[Console]::Out.Write([BitConverter]::ToString($plain).Replace('-', ''))",
      sealed,
    );
    return Buffer.from(hex.trim(), "hex");
  }

  async save(key: Buffer): Promise<void> {
    const sealed = await powershell(
      "$hex = [Console]::In.ReadToEnd().Trim(); " +
        "$plain = [byte[]] -split ($hex -replace '..', '0x$& '); " +
        "$sealed = [Security.Cryptography.ProtectedData]::Protect($plain, $null, 'CurrentUser'); " +
        "[Console]::Out.Write([Convert]::ToBase64String($sealed))",
      key.toString("hex"),
    );
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${sealed.trim()}\n`, "utf8");
  }
}

/** Linux: the desktop's secret service through `secret-tool`, else the private file. */
export class LinuxSecretServiceStore implements MasterKeyStore {
  readonly kind = "system keyring";
  constructor(private readonly fallback: MasterKeyStore) {}

  async load(): Promise<Buffer | null> {
    try {
      const { stdout } = await execFileAsync("secret-tool", [
        "lookup",
        "service",
        SERVICE,
        "account",
        ACCOUNT,
      ]);
      if (stdout.trim()) return Buffer.from(stdout.trim(), "hex");
    } catch {
      // No secret service on this machine.
    }
    return this.fallback.load();
  }

  async save(key: Buffer): Promise<void> {
    try {
      await pipeTo(
        "secret-tool",
        ["store", "--label=Markas keyring", "service", SERVICE, "account", ACCOUNT],
        key.toString("hex"),
      );
    } catch {
      await this.fallback.save(key);
    }
  }
}

function powershell(script: string, input: string): Promise<string> {
  return pipeTo(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Security; ${script}`,
    ],
    input,
  );
}

function pipeTo(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim().slice(0, 200)}`));
    });
    child.stdin.end(input);
  });
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
