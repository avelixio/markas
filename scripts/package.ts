// Builds downloadable Markas packages: one self-contained executable per platform with the
// web UI and the ready-made bots beside it, zipped under dist/release/.
//
//   bun scripts/package.ts                 every target
//   bun scripts/package.ts windows-x64     one target
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import packageJson from "../package.json" with { type: "json" };

const TARGETS: Record<string, { bun: string; exe: string }> = {
  "windows-x64": { bun: "bun-windows-x64", exe: "markas.exe" },
  "macos-arm64": { bun: "bun-darwin-arm64", exe: "markas" },
  "macos-x64": { bun: "bun-darwin-x64", exe: "markas" },
  "linux-x64": { bun: "bun-linux-x64", exe: "markas" },
};

const QUICK_START = `Markas ${packageJson.version}

1. Install and sign in to at least one engine: Claude Code (claude) or Codex (codex).
2. Start Markas. It runs the host and opens the web UI in your browser:
     macOS / Linux:  ./markas
     Windows:        double-click markas.exe
3. Keep that window open. Closing it stops Markas.
4. Optional, start at login and keep running in the background:
     ./markas install

Other commands: markas status, markas open, markas send <bot> <text>, markas serve.

Keep the "ui" and "bots" folders next to the executable.
Everything Markas stores lives in ~/.markas (set MARKAS_HOME to change it).
The host listens on 127.0.0.1:4780 only (set MARKAS_PORT to change it).

macOS and Linux: make it runnable once after unzipping:
     chmod +x ./markas
macOS: the executable is not signed. If it is blocked, run:
     xattr -d com.apple.quarantine ./markas

A new bot asks before it acts outside its own folder. You choose how much each bot may do
without asking; a bot set to never ask can change any file your account can.
`;

const root = join(import.meta.dir, "..");
const release = join(root, "dist", "release");
const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(TARGETS);

await $`bunx vite build`.cwd(root).quiet();
await mkdir(release, { recursive: true });

for (const name of names) {
  const target = TARGETS[name];
  if (!target)
    throw new Error(`Unknown target "${name}". Known: ${Object.keys(TARGETS).join(", ")}`);
  const folderName = `markas-${packageJson.version}-${name}`;
  const folder = join(release, folderName);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  await $`bun build --compile --minify --target=${target.bun} src/host/cli.ts --outfile ${join(folder, target.exe)}`
    .cwd(root)
    .quiet();
  await cp(join(root, "dist", "ui"), join(folder, "ui"), { recursive: true });
  // The ready-made bots travel as plain files, so a person can read them before adding one.
  await cp(join(root, "bots"), join(folder, "bots"), { recursive: true });
  await cp(join(root, "LICENSE"), join(folder, "LICENSE"));
  await cp(join(root, "NOTICE"), join(folder, "NOTICE"));
  await writeFile(join(folder, "QUICKSTART.txt"), QUICK_START, "utf8");
  const archive = join(release, `${folderName}.zip`);
  await rm(archive, { force: true });
  if (process.platform === "win32") {
    // Windows ships bsdtar, which writes standard zips. PowerShell's Compress-Archive writes
    // backslash paths that unpack wrongly on macOS and Linux.
    const bsdtar = join(process.env.SystemRoot ?? "C:Windows", "System32", "tar.exe");
    await $`${bsdtar} -a -c -f ${archive} -C ${release} ${folderName}`.quiet();
  } else {
    await $`zip -qr ${archive} ${folderName}`.cwd(release);
  }
  console.log(`packaged ${archive}`);
}
