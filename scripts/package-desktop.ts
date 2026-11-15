// Builds the Markas desktop app for the operating system this runs on.
//
//   bun scripts/package-desktop.ts
//
// Steps: build the host and web interface, bundle the shell, then let electron-builder make
// the installer into dist/desktop-release/.
import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const HOST_TARGETS: Record<string, Record<string, string>> = {
  win32: { x64: "windows-x64" },
  darwin: { arm64: "macos-arm64", x64: "macos-x64" },
  linux: { x64: "linux-x64" },
};
const hostTarget = HOST_TARGETS[process.platform]?.[process.arch];
if (!hostTarget) throw new Error(`No Markas host build for ${process.platform} ${process.arch}.`);

console.log(`host: ${hostTarget}`);
await $`bun scripts/package.ts ${hostTarget}`.cwd(root).quiet();

console.log("shell: dist/desktop/main.cjs");
await $`bun build src/desktop/main.ts --target=node --format=cjs --external electron --outfile dist/desktop/main.cjs`
  .cwd(root)
  .quiet();

console.log("installer: dist/desktop-release/");
await $`bunx electron-builder --config electron-builder.config.cjs --publish never`.cwd(root);
