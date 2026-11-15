// @vitest-environment node

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BotFileListing } from "../shared/files";
import type { BotSummary } from "../shared/ipc";
import { createFilesMethods } from "./files-methods";

let root: string;
let opened: Array<[string, string]>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-files-"));
  opened = [];
  await mkdir(join(root, "bots", "atlas", "memory"), { recursive: true });
  await mkdir(join(root, "bots", "juno"), { recursive: true });
  await mkdir(join(root, "shared"), { recursive: true });
  await writeFile(join(root, "bots", "atlas", "instructions.md"), "Tidy the notes.");
  await writeFile(join(root, "bots", "atlas", "memory", "MEMORY.md"), "notes");
  await writeFile(join(root, "bots", "juno", "private.md"), "juno only");
  await writeFile(join(root, "keyring.json"), "secret");
  await writeFile(join(root, "shared", "report.csv"), "a,b");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function harness() {
  const methods = createFilesMethods({
    bots: () => [{ id: "atlas", workspacePath: join(root, "bots", "atlas") } as BotSummary],
    sharedRoot: join(root, "shared"),
    open: async (path, action) => {
      opened.push([path, action]);
    },
  });
  return <T>(name: string, input?: unknown) =>
    Promise.resolve().then(() => methods[name]?.(input) as T);
}

describe("files methods", () => {
  it("lists a bot's own folder, folders first, with sizes for files", async () => {
    const call = harness();
    const listing = await call<BotFileListing>("files.list", { botId: "atlas" });
    expect(listing).toMatchObject({ root: "own", path: "", more: 0 });
    expect(listing.entries.map((entry) => [entry.name, entry.kind, entry.size])).toEqual([
      ["memory", "folder", null],
      ["instructions.md", "file", 15],
    ]);

    const inside = await call<BotFileListing>("files.list", { botId: "atlas", path: "memory" });
    expect(inside.entries.map((entry) => entry.path)).toEqual(["memory/MEMORY.md"]);
  });

  it("lists the folder all bots share", async () => {
    const call = harness();
    const listing = await call<BotFileListing>("files.list", { botId: "atlas", root: "shared" });
    expect(listing.entries.map((entry) => entry.name)).toEqual(["report.csv"]);
  });

  it("never leaves the folder, by a path or by a link", async () => {
    const call = harness();
    for (const path of ["..", "../juno", "memory/../../juno", join(root, "keyring.json")]) {
      await expect(call("files.list", { botId: "atlas", path })).rejects.toThrow(
        "outside the bot's folder",
      );
      await expect(call("files.open", { botId: "atlas", path })).rejects.toThrow(
        "outside the bot's folder",
      );
    }
    // A link that points out of the folder is neither listed nor followed.
    const linked = await symlink(
      join(root, "bots", "juno"),
      join(root, "bots", "atlas", "other"),
      "junction",
    ).then(
      () => true,
      () => false,
    );
    if (linked) {
      const listing = await call<BotFileListing>("files.list", { botId: "atlas" });
      expect(listing.entries.map((entry) => entry.name)).not.toContain("other");
      await expect(call("files.list", { botId: "atlas", path: "other" })).rejects.toThrow(
        "outside the bot's folder",
      );
    }
    expect(opened).toEqual([]);
  });

  it("opens or reveals a file inside the folder", async () => {
    const call = harness();
    await call("files.open", { botId: "atlas", path: "instructions.md" });
    await call("files.open", { botId: "atlas", path: "memory", action: "reveal" });
    expect(
      opened.map(([path, action]) => [path.replaceAll("\\", "/").split("/").at(-1), action]),
    ).toEqual([
      ["instructions.md", "open"],
      ["memory", "reveal"],
    ]);
  });

  it("says so plainly for a bot or a file that is gone", async () => {
    const call = harness();
    await expect(call("files.list", { botId: "gone" })).rejects.toThrow("no longer exists");
    await expect(call("files.list", { botId: "atlas", path: "nope" })).rejects.toThrow(
      "no longer there",
    );
    await expect(call("files.list", { botId: "atlas", path: "instructions.md" })).rejects.toThrow(
      "a file, not a folder",
    );
    await expect(call("files.list", null)).rejects.toThrow("Send the bot and the folder.");
  });
});
