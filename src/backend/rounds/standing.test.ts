// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoundsError, RoundsStore, waitingOn } from "./rounds-store";
import { describeStanding, StandingError, validateStanding } from "./standing";

let root: string;
let data: string;
let reports: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-standing-test-"));
  data = join(root, "data");
  reports = join(root, "reports");
  await Promise.all([data, reports].map((path) => mkdir(path, { recursive: true })));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const check = (value: unknown) => validateStanding(value, [data]);

describe("what a round can be given in advance", () => {
  it("accepts a folder, a tool and a site, and stores the site as scheme, host and port", () => {
    expect(
      check([
        { type: "read-folder", path: reports },
        { type: "change-folder", path: join(reports, "out") },
        { type: "tool", name: "mcp__sheets__read_range" },
        { type: "site", origin: "reports.example.com" },
        { type: "site", origin: "HTTPS://Files.Example.com:8443/" },
      ]),
    ).toEqual([
      { type: "read-folder", path: reports },
      { type: "change-folder", path: join(reports, "out") },
      { type: "tool", name: "mcp__sheets__read_range" },
      { type: "site", origin: "https://reports.example.com" },
      { type: "site", origin: "https://files.example.com:8443" },
    ]);
  });

  it("keeps one of each when the same thing is named twice", () => {
    expect(
      check([
        { type: "site", origin: "https://example.com" },
        { type: "site", origin: "example.com/" },
      ]),
    ).toHaveLength(1);
  });

  it("treats nothing as nothing", () => {
    expect(check(undefined)).toEqual([]);
    expect(check([])).toEqual([]);
  });

  const refused: Array<[string, unknown, RegExp]> = [
    ["any command", [{ type: "tool", name: "Bash" }], /one at a time/],
    ["any PowerShell command", [{ type: "tool", name: "PowerShell" }], /one at a time/],
    ["the tool that opens every site", [{ type: "tool", name: "WebFetch" }], /exact site/],
    ["a tool pattern", [{ type: "tool", name: "mcp__sheets__*" }], /not the name of one tool/],
    ["a tool without a name", [{ type: "tool", name: " " }], /Name the tool/],
    ["Markas's own data folder", () => [{ type: "change-folder", path: data }], /own data folder/],
    [
      "a folder inside the data folder",
      () => [{ type: "read-folder", path: join(data, "bots", "juno") }],
      /own data folder/,
    ],
    [
      "a folder that holds the data folder",
      () => [{ type: "read-folder", path: root }],
      /contains Markas's own data folder/,
    ],
    [
      "a link to the data folder",
      () => [{ type: "read-folder", path: join(root, "alias-of-data") }],
      /own data folder/,
    ],
    ["a whole drive", () => [{ type: "read-folder", path: parse(root).root }], /whole drive/],
    ["a folder that is not a full path", [{ type: "read-folder", path: "reports" }], /full path/],
    ["a site with a wildcard", [{ type: "site", origin: "https://*.example.com" }], /exact site/],
    ["a site with a page", [{ type: "site", origin: "https://example.com/admin" }], /whole site/],
    ["a site with a username", [{ type: "site", origin: "https://me@example.com" }], /exact site/],
    ["something that is not a website", [{ type: "site", origin: "ftp://example.com" }], /exact/],
    ["everything", [{ type: "anything" }], /folder, a tool or a site/],
    ["a permission that is not a list", { type: "tool", name: "Read" }, /must be a list/],
    [
      "more than a round can hold",
      Array.from({ length: 21 }, (_, index) => ({ type: "tool", name: `tool_${index}` })),
      /at most 20/,
    ],
  ];

  it.each(refused)("refuses %s", async (_name, value, message) => {
    await symlink(data, join(root, "alias-of-data"), "junction");
    const input = typeof value === "function" ? (value as () => unknown)() : value;
    expect(() => check(input)).toThrow(StandingError);
    expect(() => check(input)).toThrow(message);
  });

  it("says a permission in plain words", () => {
    expect(describeStanding({ type: "site", origin: "https://example.com" })).toBe(
      "open site https://example.com",
    );
    expect(describeStanding({ type: "change-folder", path: reports })).toBe(
      `change folder ${reports}`,
    );
  });
});

const morning = {
  name: "Morning stock check",
  botId: "atlas",
  instruction: "Check stock levels and report anything low.",
  schedule: { kind: "daily", times: ["09:00"], weekdays: [1, 2, 3, 4, 5] },
};
const NOW = new Date(2026, 10, 12, 8);

describe("standing permissions in the rounds store", () => {
  it("stores them with the round, stamped with the bot's level, and reads them back", async () => {
    const store = new RoundsStore(data);
    await store.initialize();
    const round = await store.create(
      { ...morning, standing: [{ type: "read-folder", path: reports }] },
      NOW,
      "read",
    );
    expect(round.standing).toEqual([
      { type: "read-folder", path: reports, level: "read", grantedAt: NOW.toISOString() },
    ]);

    const reopened = new RoundsStore(data);
    await reopened.initialize();
    expect(reopened.get(round.id).standing).toEqual(round.standing);
  });

  it("refuses a round that asks for too much, and saves nothing", async () => {
    const store = new RoundsStore(data);
    await store.initialize();
    await expect(
      store.create({ ...morning, standing: [{ type: "tool", name: "Bash" }] }),
    ).rejects.toThrow(RoundsError);
    await expect(
      store.create({ ...morning, standing: [{ type: "change-folder", path: data }] }),
    ).rejects.toThrow(/own data folder/);
    expect(store.list()).toEqual([]);
  });

  it("replaces the list on an edit, keeps the date of what stays, and leaves it alone otherwise", async () => {
    const store = new RoundsStore(data);
    await store.initialize();
    const round = await store.create(
      { ...morning, standing: [{ type: "read-folder", path: reports }] },
      NOW,
      "ask",
    );
    const later = new Date(NOW.getTime() + 60_000);

    const renamed = await store.update(round.id, { name: "Stock check" }, later, "read");
    expect(renamed.standing).toEqual(round.standing);

    const edited = await store.update(
      round.id,
      {
        standing: [
          { type: "read-folder", path: reports },
          { type: "site", origin: "https://example.com" },
        ],
      },
      later,
      "read",
    );
    expect(edited.standing).toEqual([
      { type: "read-folder", path: reports, level: "ask", grantedAt: NOW.toISOString() },
      {
        type: "site",
        origin: "https://example.com",
        level: "read",
        grantedAt: later.toISOString(),
      },
    ]);

    expect((await store.update(round.id, { standing: [] }, later)).standing).toEqual([]);
  });

  it("does not carry them over when the round is given to another bot", async () => {
    const store = new RoundsStore(data);
    await store.initialize();
    const round = await store.create(
      { ...morning, standing: [{ type: "read-folder", path: reports }] },
      NOW,
    );
    expect((await store.update(round.id, { botId: "juno" }, NOW)).standing).toEqual([]);
  });

  it("drops what was given at a higher level when the bot is set lower, and only that", async () => {
    const store = new RoundsStore(data);
    await store.initialize();
    const careful = await store.create(
      { ...morning, standing: [{ type: "read-folder", path: reports }] },
      NOW,
      "ask",
    );
    const trusted = await store.create(
      { ...morning, name: "Evening", standing: [{ type: "tool", name: "WebSearch" }] },
      NOW,
      "read",
    );
    const other = await store.create(
      { ...morning, botId: "juno", standing: [{ type: "tool", name: "WebSearch" }] },
      NOW,
      "read",
    );

    expect(await store.dropStandingAbove("atlas", "read")).toEqual([]);
    const dropped = await store.dropStandingAbove("atlas", "ask");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      round: { id: trusted.id, standing: [] },
      dropped: [{ type: "tool", name: "WebSearch" }],
    });
    expect(store.get(careful.id).standing).toHaveLength(1);
    expect(store.get(other.id).standing).toHaveLength(1);
  });

  it("reads a file written before standing permissions existed", async () => {
    const old = {
      version: 1,
      rounds: [
        {
          id: "r1",
          ...morning,
          overlap: "wait",
          enabled: true,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
          checkedThrough: NOW.toISOString(),
        },
      ],
      runs: [
        {
          id: "run1",
          roundId: "r1",
          scheduledFor: NOW.toISOString(),
          startedAt: NOW.toISOString(),
          finishedAt: NOW.toISOString(),
          status: "completed",
          detail: "",
          deliveryId: "d1",
          manual: false,
        },
      ],
    };
    await writeFile(join(data, "rounds.json"), JSON.stringify(old));
    const store = new RoundsStore(data);
    await store.initialize();
    expect(store.get("r1").standing).toEqual([]);
    expect(store.lastRun("r1")?.waits).toEqual([]);
  });

  it("records in the run that it is waiting and for what, then the answer", async () => {
    const store = new RoundsStore(data);
    await store.initialize();
    const round = await store.create(morning, NOW);
    await store.addRun({
      roundId: round.id,
      scheduledFor: NOW.toISOString(),
      startedAt: NOW.toISOString(),
      finishedAt: null,
      status: "running",
      detail: "",
      deliveryId: "delivery-1",
      manual: false,
    });

    await store.noteWaiting(
      "delivery-1",
      { requestId: "ask-1", kind: "command", detail: "git pull" },
      NOW,
    );
    const waiting = store.lastRun(round.id);
    expect(waiting && waitingOn(waiting)).toMatchObject({
      kind: "command",
      detail: "git pull",
      askedAt: NOW.toISOString(),
      answer: null,
    });
    // It is on disk, so the person sees it after a restart of the window too.
    expect(await readFile(join(data, "rounds.json"), "utf8")).toContain("git pull");

    const later = new Date(NOW.getTime() + 3_600_000);
    await store.noteAnswered("delivery-1", "ask-1", false, later);
    const answered = store.lastRun(round.id);
    expect(answered && waitingOn(answered)).toBeNull();
    expect(answered?.waits).toEqual([
      {
        requestId: "ask-1",
        kind: "command",
        detail: "git pull",
        askedAt: NOW.toISOString(),
        answeredAt: later.toISOString(),
        answer: "denied",
      },
    ]);
    expect(await store.noteWaiting("unknown", { requestId: "x", kind: "tool", detail: "" })).toBe(
      null,
    );
  });

  it("closes an open card when the run ends before anyone answered", async () => {
    const store = new RoundsStore(data);
    await store.initialize();
    const round = await store.create(morning, NOW);
    await store.addRun({
      roundId: round.id,
      scheduledFor: NOW.toISOString(),
      startedAt: NOW.toISOString(),
      finishedAt: null,
      status: "running",
      detail: "",
      deliveryId: "delivery-1",
      manual: false,
    });
    await store.noteWaiting("delivery-1", { requestId: "ask-1", kind: "write", detail: "/x" }, NOW);
    await store.finishRunByDelivery("delivery-1", "failed", "The run was stopped.", NOW);
    const run = store.lastRun(round.id);
    expect(run && waitingOn(run)).toBeNull();
    expect(run?.waits[0]).toMatchObject({ answer: null, answeredAt: NOW.toISOString() });
  });
});
