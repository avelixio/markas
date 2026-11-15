// @vitest-environment node

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AccessLevel,
  type AccessScope,
  covers,
  judgeTool,
  lowerAccess,
  type StandingGrant,
  type StandingPermission,
} from "./policy";

let root: string;
let home: string;
let shared: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-access-test-"));
  home = join(root, "data", "bots", "atlas");
  shared = join(root, "data", "shared");
  outside = join(root, "projects");
  await Promise.all([home, shared, outside].map((path) => mkdir(path, { recursive: true })));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const scope = (level: AccessLevel): AccessScope => ({
  level,
  cwd: home,
  ownRoots: [home, shared],
  protectedRoots: [join(root, "data")],
});
const decide = (level: AccessLevel, tool: string, input: unknown) =>
  judgeTool(scope(level), tool, input);

describe("access policy", () => {
  it("lets a bot read and change its own folder and the shared one at every level", () => {
    for (const level of ["ask", "read"] as const) {
      expect(decide(level, "Read", { file_path: join(home, "notes.md") }).decision).toBe("allow");
      expect(decide(level, "Write", { file_path: "notes.md" }).decision).toBe("allow");
      expect(decide(level, "Edit", { file_path: join(shared, "plan.md") }).decision).toBe("allow");
      expect(decide(level, "Glob", { pattern: "**/*.md" }).decision).toBe("allow");
      expect(decide(level, "Grep", { pattern: "todo" }).decision).toBe("allow");
    }
  });

  it("asks before reading outside the bot's folder, unless it may read freely", () => {
    const file = join(outside, "secret.txt");
    expect(decide("ask", "Read", { file_path: file })).toMatchObject({
      decision: "ask",
      kind: "read",
      grant: { type: "folder", kind: "read", root: outside },
    });
    expect(decide("ask", "Grep", { pattern: "x", path: outside }).decision).toBe("ask");
    expect(decide("ask", "Glob", { pattern: `${outside}/**/*.ts` }).decision).toBe("ask");
    expect(decide("ask", "Read", { file_path: "../../../projects/secret.txt" }).decision).toBe(
      "ask",
    );
    expect(decide("read", "Read", { file_path: file }).decision).toBe("allow");
    expect(decide("read", "Grep", { pattern: "x", path: outside }).decision).toBe("allow");
  });

  it("asks before changing anything outside the bot's folder at both careful levels", () => {
    for (const level of ["ask", "read"] as const) {
      expect(decide(level, "Write", { file_path: join(outside, "a.txt") })).toMatchObject({
        decision: "ask",
        kind: "write",
      });
      expect(decide(level, "Edit", { file_path: join(outside, "a.txt") }).decision).toBe("ask");
      expect(
        decide(level, "NotebookEdit", { notebook_path: join(outside, "n.ipynb") }).decision,
      ).toBe("ask");
    }
  });

  it("always asks for commands, one at a time", () => {
    for (const level of ["ask", "read"] as const) {
      expect(decide(level, "Bash", { command: "rm -rf ~" })).toEqual({
        decision: "ask",
        kind: "command",
        detail: "rm -rf ~",
        grant: null,
      });
      expect(decide(level, "PowerShell", { command: "Get-ChildItem" }).decision).toBe("ask");
    }
  });

  it("asks for the internet and for tools it does not know", () => {
    expect(decide("read", "WebFetch", { url: "https://example.com" })).toMatchObject({
      kind: "network",
      detail: "https://example.com",
      grant: { type: "tool", name: "WebFetch" },
    });
    expect(decide("read", "WebSearch", { query: "stock" }).decision).toBe("ask");
    expect(decide("read", "mcp__someone__send_email", {})).toMatchObject({
      kind: "tool",
      grant: { type: "tool", name: "mcp__someone__send_email" },
    });
  });

  it("lets Markas's own tools and the bot's planning tools through", () => {
    expect(decide("ask", "mcp__markas__send_message", {}).decision).toBe("allow");
    expect(decide("ask", "mcp__markas_browser__open", {}).decision).toBe("allow");
    expect(decide("ask", "TodoWrite", {}).decision).toBe("allow");
    // A look-alike name is not Markas's own tool.
    expect(decide("ask", "mcp__markas_evil__run", {}).decision).toBe("ask");
  });

  it("guards Markas's own data even from a bot that may read freely", () => {
    for (const level of ["ask", "read"] as const) {
      expect(decide(level, "Read", { file_path: join(root, "data", "token") })).toEqual({
        decision: "ask",
        kind: "protected",
        detail: join(root, "data", "token"),
        grant: null,
      });
      expect(
        decide(level, "Read", { file_path: join(root, "data", "bots", "juno", "x") }),
      ).toMatchObject({ kind: "protected" });
      expect(
        decide(level, "Write", { file_path: join(root, "data", "keyring.json") }),
      ).toMatchObject({ kind: "protected" });
    }
  });

  it("treats a file tool without a path as outside everything", () => {
    expect(decide("ask", "Read", {}).decision).toBe("ask");
    expect(decide("ask", "Write", null).decision).toBe("ask");
  });

  it("never asks at full access", () => {
    expect(decide("full", "Bash", { command: "anything" }).decision).toBe("allow");
    expect(decide("full", "Read", { file_path: join(root, "data", "token") }).decision).toBe(
      "allow",
    );
  });

  it.skipIf(process.platform === "win32")(
    "is not fooled by a link inside the bot's folder that points out of it",
    async () => {
      await writeFile(join(outside, "secret.txt"), "x");
      await symlink(outside, join(home, "shortcut"));
      expect(
        decide("ask", "Read", { file_path: join(home, "shortcut", "secret.txt") }).decision,
      ).toBe("ask");
      expect(decide("ask", "Write", { file_path: "shortcut/new.txt" }).decision).toBe("ask");
    },
  );

  it("remembers a yes for the chat only for what it covered", () => {
    const read = decide("ask", "Read", { file_path: join(outside, "a", "b.txt") });
    const grants = [{ type: "folder" as const, kind: "read" as const, root: join(outside, "a") }];
    expect(covers(grants, read)).toBe(true);
    expect(covers(grants, decide("ask", "Read", { file_path: join(outside, "c.txt") }))).toBe(
      false,
    );
    // Permission to read is not permission to change.
    expect(covers(grants, decide("ask", "Write", { file_path: join(outside, "a", "b.txt") }))).toBe(
      false,
    );
    // Permission to change includes reading.
    const writeGrant = [{ type: "folder" as const, kind: "write" as const, root: outside }];
    expect(covers(writeGrant, read)).toBe(true);
    // A command is never covered.
    expect(covers(writeGrant, decide("ask", "Bash", { command: "ls" }))).toBe(false);
    const tool = [{ type: "tool" as const, name: "WebFetch" }];
    expect(covers(tool, decide("ask", "WebFetch", { url: "https://example.com" }))).toBe(true);
    expect(covers(tool, decide("ask", "WebSearch", { query: "x" }))).toBe(false);
  });

  it("picks the more careful of two levels", () => {
    expect(lowerAccess("full", "ask")).toBe("ask");
    expect(lowerAccess("read", "full")).toBe("read");
    expect(lowerAccess("full", "full")).toBe("full");
  });
});

describe("standing permissions of a round", () => {
  let reports: string;
  let data: string;

  beforeEach(async () => {
    reports = join(root, "reports");
    data = join(root, "data");
    await Promise.all(
      [reports, join(root, "reports-old"), join(reports, "2026")].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    );
    await writeFile(join(data, "token"), "secret");
    await writeFile(join(outside, "secret.txt"), "x");
    // Links that try to lead out of a granted folder. Junctions need no special rights on Windows.
    await symlink(outside, join(reports, "to-projects"), "junction");
    await symlink(data, join(reports, "to-data"), "junction");
    await symlink(data, join(root, "alias-of-data"), "junction");
  });

  const grant = (permission: StandingPermission, level: AccessLevel = "ask"): StandingGrant => ({
    ...permission,
    level,
    grantedAt: "2026-11-12T00:00:00.000Z",
  });
  const readReports = () => grant({ type: "read-folder", path: reports });
  const changeReports = () => grant({ type: "change-folder", path: reports });
  const site = (origin: string) => grant({ type: "site", origin });
  const tool = (name: string) => grant({ type: "tool", name });

  type Case = [
    name: string,
    grants: () => StandingGrant[],
    tool: string,
    input: () => unknown,
    expected: "standing" | "ask",
    level?: AccessLevel,
  ];
  const cases: Case[] = [
    // Folders
    [
      "reads a file in a folder it may read",
      () => [readReports()],
      "Read",
      () => ({ file_path: join(reports, "2026", "q3.csv") }),
      "standing",
    ],
    [
      "searches a folder it may read",
      () => [readReports()],
      "Grep",
      () => ({ pattern: "x", path: reports }),
      "standing",
    ],
    [
      "does not change a folder it may only read",
      () => [readReports()],
      "Write",
      () => ({ file_path: join(reports, "q3.csv") }),
      "ask",
    ],
    [
      "changes a file in a folder it may change",
      () => [changeReports()],
      "Edit",
      () => ({ file_path: join(reports, "q3.csv") }),
      "standing",
    ],
    [
      "reads a folder it may change",
      () => [changeReports()],
      "Read",
      () => ({ file_path: join(reports, "q3.csv") }),
      "standing",
    ],
    [
      "stays out of a folder whose name only starts the same",
      () => [changeReports()],
      "Read",
      () => ({ file_path: join(root, "reports-old", "q1.csv") }),
      "ask",
    ],
    [
      "stays out of the folder above",
      () => [changeReports()],
      "Read",
      () => ({ file_path: join(root, "notes.txt") }),
      "ask",
    ],
    [
      "is not led out by dots in the path",
      () => [changeReports()],
      "Write",
      () => ({ file_path: join(reports, "..", "projects", "secret.txt") }),
      "ask",
    ],
    [
      "is not led out by a link inside the folder",
      () => [changeReports()],
      "Read",
      () => ({ file_path: join(reports, "to-projects", "secret.txt") }),
      "ask",
    ],
    [
      "is not led out by a link when writing a new file",
      () => [changeReports()],
      "Write",
      () => ({ file_path: join(reports, "to-projects", "new.txt") }),
      "ask",
    ],
    [
      "searching from above the folder is not covered",
      () => [readReports()],
      "Glob",
      () => ({ pattern: `${root}/**/*.csv` }),
      "ask",
    ],
    // Markas's own data folder
    [
      "never reaches the data folder through a link in the folder",
      () => [changeReports()],
      "Read",
      () => ({ file_path: join(reports, "to-data", "token") }),
      "ask",
    ],
    [
      "never reaches the data folder when the grant is a link to it",
      () => [grant({ type: "change-folder", path: join(root, "alias-of-data") })],
      "Read",
      () => ({ file_path: join(root, "alias-of-data", "token") }),
      "ask",
    ],
    [
      "never reaches the data folder when the grant names it",
      () => [grant({ type: "change-folder", path: data })],
      "Write",
      () => ({ file_path: join(data, "token") }),
      "ask",
    ],
    [
      "never reaches the data folder when the grant holds it",
      () => [grant({ type: "change-folder", path: root })],
      "Read",
      () => ({ file_path: join(data, "token") }),
      "ask",
    ],
    [
      "never reaches the data folder when the bot may read freely",
      () => [grant({ type: "read-folder", path: root }, "read")],
      "Read",
      () => ({ file_path: join(data, "token") }),
      "ask",
      "read",
    ],
    // Commands
    [
      "never runs a command, whatever the round holds",
      () => [changeReports(), tool("Bash"), site("https://example.com")],
      "Bash",
      () => ({ command: `cat ${join(reports, "q3.csv")}` }),
      "ask",
    ],
    [
      "never runs a PowerShell command either",
      () => [tool("PowerShell")],
      "PowerShell",
      () => ({ command: "Get-ChildItem" }),
      "ask",
    ],
    // Tools
    [
      "uses the one tool it was given",
      () => [tool("mcp__sheets__read_range")],
      "mcp__sheets__read_range",
      () => ({}),
      "standing",
    ],
    [
      "does not use another tool of the same family",
      () => [tool("mcp__sheets__read_range")],
      "mcp__sheets__write_range",
      () => ({}),
      "ask",
    ],
    [
      "does not use a tool whose name only starts the same",
      () => [tool("mcp__sheets__read")],
      "mcp__sheets__read_range",
      () => ({}),
      "ask",
    ],
    [
      "searches the web when given that tool",
      () => [tool("WebSearch")],
      "WebSearch",
      () => ({ query: "weather" }),
      "standing",
    ],
    [
      "cannot open every site by naming the tool that opens sites",
      () => [tool("WebFetch")],
      "WebFetch",
      () => ({ url: "https://example.com/" }),
      "ask",
    ],
    // Sites
    [
      "opens a page on the exact site",
      () => [site("https://reports.example.com")],
      "WebFetch",
      () => ({ url: "https://reports.example.com/daily?day=1" }),
      "standing",
    ],
    [
      "opens the site whatever the letter case of its name",
      () => [site("https://reports.example.com")],
      "WebFetch",
      () => ({ url: "https://REPORTS.Example.com/" }),
      "standing",
    ],
    [
      "treats the default port as the same site",
      () => [site("https://reports.example.com")],
      "WebFetch",
      () => ({ url: "https://reports.example.com:443/x" }),
      "standing",
    ],
    [
      "does not open the parent site",
      () => [site("https://reports.example.com")],
      "WebFetch",
      () => ({ url: "https://example.com/" }),
      "ask",
    ],
    [
      "does not open a sibling host",
      () => [site("https://reports.example.com")],
      "WebFetch",
      () => ({ url: "https://admin.example.com/" }),
      "ask",
    ],
    [
      "does not open a host below it",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "https://files.example.com/" }),
      "ask",
    ],
    [
      "does not open a host that only ends the same",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "https://notexample.com/" }),
      "ask",
    ],
    [
      "does not open a host that only starts the same",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "https://example.com.attacker.example/" }),
      "ask",
    ],
    [
      "is not fooled by the site written as a username",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "https://example.com@attacker.example/" }),
      "ask",
    ],
    [
      "refuses an address with a username even on the right site",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "https://someone:pw@example.com/" }),
      "ask",
    ],
    [
      "does not open the same host on another port",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "https://example.com:8443/" }),
      "ask",
    ],
    [
      "does not open the same host without encryption",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "http://example.com/" }),
      "ask",
    ],
    [
      "does not open something that is not a web address",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "file:///example.com/etc" }),
      "ask",
    ],
    [
      "does not open an address it cannot read",
      () => [site("https://example.com")],
      "WebFetch",
      () => ({ url: "example.com" }),
      "ask",
    ],
    [
      "a site does not cover a web search",
      () => [site("https://example.com")],
      "WebSearch",
      () => ({ query: "https://example.com" }),
      "ask",
    ],
    // The bot's level
    [
      "stops counting when the bot is set lower than when it was given",
      () => [grant({ type: "change-folder", path: reports }, "read")],
      "Write",
      () => ({ file_path: join(reports, "q3.csv") }),
      "ask",
      "ask",
    ],
    [
      "still counts when the bot is set higher",
      () => [changeReports()],
      "Write",
      () => ({ file_path: join(reports, "q3.csv") }),
      "standing",
      "read",
    ],
  ];

  it.each(cases)("%s", (_name, grants, toolName, input, expected, level = "ask") => {
    const verdict = judgeTool(scope(level), toolName, input(), grants());
    if (expected === "ask") expect(verdict.decision).toBe("ask");
    else
      expect(verdict).toMatchObject({ decision: "allow", standing: { type: grants()[0]?.type } });
    // Without the round's permissions the same call always asks: they are the only reason.
    expect(judgeTool(scope(level), toolName, input()).decision).toBe("ask");
  });

  it("leaves what the level already allows alone, and names no standing permission for it", () => {
    const verdict = judgeTool(scope("ask"), "Read", { file_path: join(home, "notes.md") }, [
      changeReports(),
    ]);
    expect(verdict).toEqual({ decision: "allow" });
  });

  it("allows nothing more than a chat could: every standing allow is one a chat grant covers", () => {
    for (const [, grants, toolName, input, expected, level = "ask"] of cases) {
      if (expected !== "standing") continue;
      const plain = judgeTool(scope(level), toolName, input());
      expect(plain.decision === "ask" && plain.grant !== null, toolName).toBe(true);
      expect(grants().length).toBeGreaterThan(0);
    }
  });
});
