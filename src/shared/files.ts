/** own: the bot's own folder. shared: the folder every bot can use. */
export type BotFileRoot = "own" | "shared";

export interface BotFileEntry {
  name: string;
  /** The path from the root, with forward slashes. Pass it back to list or open the entry. */
  path: string;
  kind: "file" | "folder";
  /** Bytes for a file, null for a folder. */
  size: number | null;
  modifiedAt: string;
}

/** One folder as the Files panel shows it: folders first, then files, each by name. */
export interface BotFileListing {
  root: BotFileRoot;
  path: string;
  entries: BotFileEntry[];
  /** How many entries were left out because the folder holds too many to show. */
  more: number;
}
