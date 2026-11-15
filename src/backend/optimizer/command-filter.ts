import { execFile } from "node:child_process";

export interface CommandFilter {
  installed: boolean;
  version: string | null;
}

type Run = (command: string, args: string[]) => Promise<string>;

const runProgram: Run = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 3_000, maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  });

let remembered: { at: number; found: CommandFilter } | null = null;
const REMEMBER_MS = 60_000;

/**
 * Looks for `rtk`, an outside tool that shortens the output of shell commands before a model
 * reads it. Markas only reports whether it is on this computer: it does not install it and
 * does not pass any bot's command through it.
 * Another program is also called `rtk`, so only one that answers `rtk gain` counts.
 */
export async function findCommandFilter(
  run: Run = runProgram,
  now: () => number = Date.now,
): Promise<CommandFilter> {
  if (run === runProgram && remembered && now() - remembered.at < REMEMBER_MS) {
    return remembered.found;
  }
  let found: CommandFilter = { installed: false, version: null };
  try {
    const version = /\d+\.\d+(?:\.\d+)?/.exec(await run("rtk", ["--version"]))?.[0] ?? null;
    // The token filter has a `gain` report; the other `rtk` does not.
    await run("rtk", ["gain"]);
    found = { installed: true, version };
  } catch {
    // Not on this computer, or not the tool this looks for.
  }
  if (run === runProgram) remembered = { at: now(), found };
  return found;
}
