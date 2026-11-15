import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BotFileEntry, BotFileListing, BotFileRoot } from "../shared/files";
import type { BotSummary } from "../shared/ipc";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";

/** The most entries one folder shows. A folder with more says so instead of listing them all. */
export const MAX_FILE_ENTRIES = 500;

export interface FilesContext {
  bots: () => BotSummary[];
  /** The folder every bot shares. */
  sharedRoot: string;
  open: (path: string, action: "open" | "reveal") => Promise<void>;
}

/**
 * The Files panel: what is in a bot's own folder and in the folder all bots share.
 * Nothing outside those two folders can be listed or opened, whatever path is asked for:
 * not the keyring, not another bot's folder, and not a link that leads out.
 */
export function createFilesMethods(context: FilesContext): Record<string, HostMethod> {
  const rootOf = (botId: string, root: BotFileRoot): string => {
    if (root === "shared") return context.sharedRoot;
    const bot = context.bots().find((candidate) => candidate.id === botId);
    if (!bot) throw new Error("That bot no longer exists.");
    return bot.workspacePath;
  };

  /** The real place a path inside a root points at, or a refusal when it leaves the root. */
  const locate = async (botId: string, root: BotFileRoot, path: string): Promise<string> => {
    if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
      throw new Error("That path is outside the bot's folder.");
    }
    const base = await realpath(rootOf(botId, root)).catch(() => {
      throw new Error("The folder does not exist yet. It is made when the bot first works.");
    });
    const target = await realpath(resolve(base, path)).catch(() => {
      throw new Error("That file or folder is no longer there.");
    });
    const inside = relative(base, target);
    if (inside.startsWith("..") || isAbsolute(inside)) {
      throw new Error("That path is outside the bot's folder.");
    }
    return target;
  };

  const parse = (input: unknown) => {
    if (!isObject(input)) throw new Error("Send the bot and the folder.");
    const root: BotFileRoot = input.root === "shared" ? "shared" : "own";
    const path = typeof input.path === "string" ? input.path : "";
    return { botId: requireString(input.botId, "botId"), root, path };
  };

  return {
    "files.list": async (input): Promise<BotFileListing> => {
      const { botId, root, path } = parse(input);
      const folder = await locate(botId, root, path);
      const names = await readdir(folder, { withFileTypes: true }).catch(() => {
        throw new Error("That is a file, not a folder.");
      });
      const entries: BotFileEntry[] = [];
      for (const item of names) {
        // Links are left out: where one leads is not what its name says.
        if (item.isSymbolicLink()) continue;
        const kind = item.isDirectory() ? "folder" : item.isFile() ? "file" : null;
        if (!kind) continue;
        const info = await stat(join(folder, item.name)).catch(() => null);
        if (!info) continue;
        entries.push({
          name: item.name,
          path: path ? `${path.split(sep).join("/")}/${item.name}` : item.name,
          kind,
          size: kind === "file" ? info.size : null,
          modifiedAt: info.mtime.toISOString(),
        });
      }
      entries.sort(
        (left, right) =>
          Number(right.kind === "folder") - Number(left.kind === "folder") ||
          left.name.localeCompare(right.name),
      );
      return {
        root,
        path,
        entries: entries.slice(0, MAX_FILE_ENTRIES),
        more: Math.max(0, entries.length - MAX_FILE_ENTRIES),
      };
    },
    "files.open": async (input) => {
      const { botId, root, path } = parse(input);
      const action = isObject(input) && input.action === "reveal" ? "reveal" : "open";
      await context.open(await locate(botId, root, path), action);
    },
  };
}
