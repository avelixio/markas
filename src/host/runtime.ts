import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Markas runs two ways: from a source checkout with Bun (`bun src/host/cli.ts`), or as a
 * packaged single executable with its web UI in a `ui` folder beside it.
 */
export function isPackaged(execPath: string = process.execPath): boolean {
  // Split on both separators so a Windows path is read correctly on any platform.
  const name = (execPath.split(/[\\/]/).pop() ?? "").toLowerCase();
  return name !== "bun" && name !== "bun.exe" && name !== "node" && name !== "node.exe";
}

/** Where the built web UI lives. `MARKAS_UI_DIR` overrides both layouts. */
export function resolveUiRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MARKAS_UI_DIR?.trim();
  if (override) return override;
  if (isPackaged()) {
    const beside = join(dirname(process.execPath), "ui");
    if (existsSync(beside)) return beside;
  }
  return fileURLToPath(new URL("../../dist/ui", import.meta.url));
}

/**
 * Where the ready-made bot files live: a `bots` folder beside the packaged executable, or the
 * repository's own `bots` folder in a source checkout. `MARKAS_BOTS_DIR` overrides both.
 */
export function resolveLibraryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MARKAS_BOTS_DIR?.trim();
  if (override) return override;
  if (isPackaged()) {
    const beside = join(dirname(process.execPath), "bots");
    if (existsSync(beside)) return beside;
  }
  return fileURLToPath(new URL("../../bots", import.meta.url));
}

/** The command that starts the host, for the login item. */
export function serveCommand(): { runtime: string; args: string[] } {
  if (isPackaged()) return { runtime: process.execPath, args: ["serve"] };
  return {
    runtime: process.execPath,
    args: [fileURLToPath(new URL("./cli.ts", import.meta.url)), "serve"],
  };
}
