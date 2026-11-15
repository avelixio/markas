// @vitest-environment node

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPackaged, resolveLibraryRoot, resolveUiRoot, serveCommand } from "./runtime";

describe("host runtime layout", () => {
  it("tells a packaged executable from a Bun or Node run", () => {
    expect(isPackaged("/usr/local/bin/bun")).toBe(false);
    expect(isPackaged("C:\\Users\\me\\.bun\\bin\\bun.exe")).toBe(false);
    expect(isPackaged("/usr/bin/node")).toBe(false);
    expect(isPackaged("/Applications/markas")).toBe(true);
    expect(isPackaged("C:\\Tools\\markas.exe")).toBe(true);
  });

  it("uses MARKAS_UI_DIR when it is set", () => {
    expect(resolveUiRoot({ MARKAS_UI_DIR: "/custom/ui" })).toBe("/custom/ui");
  });

  it("falls back to the source checkout's built UI", () => {
    expect(resolveUiRoot({}).replaceAll("\\", "/")).toMatch(/dist\/ui$/);
  });

  it("finds the ready-made bots in the source checkout, or where MARKAS_BOTS_DIR says", () => {
    expect(resolveLibraryRoot({ MARKAS_BOTS_DIR: "/custom/bots" })).toBe("/custom/bots");
    const root = resolveLibraryRoot({});
    expect(root.replaceAll("\\", "/")).toMatch(/\/bots$/);
    expect(existsSync(join(root, "scout.bot.md"))).toBe(true);
  });

  it("starts the host from the CLI source when not packaged", () => {
    const command = serveCommand();
    expect(command.runtime).toBe(process.execPath);
    expect(command.args.at(-1)).toBe("serve");
    expect(command.args[0]?.replaceAll("\\", "/")).toMatch(/src\/host\/cli\.ts$/);
  });
});
