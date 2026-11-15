// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomsStore } from "../backend/rooms/rooms-store";
import type { BotSummary } from "../shared/ipc";
import type { Room } from "../shared/rooms";
import { createRoomsMethods, roomBrief } from "./rooms-methods";

let root: string;
let bots: BotSummary[];
let sent: Array<[string, string]>;

const bot = (id: string, name: string, role: string) => ({ id, name, role }) as BotSummary;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-rooms-"));
  bots = [
    bot("atlas", "Atlas", "Stock and dashboard checks"),
    bot("juno", "Juno", "Admin console lookups"),
    bot("mika", "Mika", ""),
  ];
  sent = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function harness() {
  const rooms = new RoomsStore(root);
  await rooms.initialize();
  const methods = createRoomsMethods({
    rooms,
    bots: () => bots,
    send: async (botId, text) => {
      sent.push([botId, text]);
    },
  });
  const call = <T>(name: string, input?: unknown) =>
    Promise.resolve().then(() => methods[name]?.(input) as T);
  return { call, rooms };
}

const STOCK = {
  name: "  Stock   room ",
  purpose: "Keep stock levels and open orders in step",
  leadBotId: "atlas",
  memberBotIds: ["juno", "atlas", "juno"],
};

describe("rooms methods", () => {
  it("makes a room, keeps it on disk, and never lists the lead as a member", async () => {
    const { call } = await harness();
    const room = await call<Room>("rooms.create", STOCK);
    expect(room).toMatchObject({ name: "Stock room", leadBotId: "atlas", memberBotIds: ["juno"] });
    expect(await call<Room[]>("rooms.list")).toEqual([room]);

    const again = await harness();
    expect(await again.call<Room[]>("rooms.list")).toEqual([room]);
    expect(JSON.parse(await readFile(join(root, "rooms.json"), "utf8")).version).toBe(1);
  });

  it("refuses a room that cannot work", async () => {
    const { call } = await harness();
    await expect(call("rooms.create", { ...STOCK, name: " " })).rejects.toThrow(
      "Give the room a name.",
    );
    await expect(call("rooms.create", { ...STOCK, leadBotId: "nobody" })).rejects.toThrow(
      "Choose a bot to lead the room.",
    );
    await expect(call("rooms.create", { ...STOCK, memberBotIds: ["atlas"] })).rejects.toThrow(
      "Add at least one more bot",
    );
    await expect(call("rooms.create", { ...STOCK, memberBotIds: ["ghost"] })).rejects.toThrow(
      "no longer exists",
    );
    await call("rooms.create", STOCK);
    await expect(call("rooms.create", { ...STOCK, name: "stock room" })).rejects.toThrow(
      "already a room called",
    );
    await expect(call("rooms.create", null)).rejects.toThrow("Send the room's name and its bots.");
  });

  it("changes and removes a room", async () => {
    const { call } = await harness();
    const room = await call<Room>("rooms.create", STOCK);
    const changed = await call<Room>("rooms.update", {
      id: room.id,
      leadBotId: "juno",
      memberBotIds: ["atlas", "mika"],
    });
    expect(changed).toMatchObject({
      name: "Stock room",
      leadBotId: "juno",
      memberBotIds: ["atlas", "mika"],
    });
    await call("rooms.remove", room.id);
    expect(await call<Room[]>("rooms.list")).toEqual([]);
    await expect(call("rooms.update", { id: room.id, name: "x" })).rejects.toThrow(
      "no longer exists",
    );
  });

  it("sends a question to the lead with who is in the room, after the person's own words", async () => {
    const { call } = await harness();
    const room = await call<Room>("rooms.create", { ...STOCK, memberBotIds: ["juno", "mika"] });
    expect(await call("rooms.ask", { roomId: room.id, text: "  Is order 88213 stuck?  " })).toEqual(
      {
        leadBotId: "atlas",
      },
    );
    const [[to, text]] = sent as [[string, string]];
    expect(to).toBe("atlas");
    expect(text.startsWith('Is order 88213 stuck?\n\n(Asked in the room "Stock room"')).toBe(true);
    expect(text).toContain("- Juno: Admin console lookups");
    // A bot without a role is named without a dangling colon.
    expect(text).toContain("- Mika\n");
    expect(text).toContain("markas.send_message");

    await expect(call("rooms.ask", { roomId: room.id, text: " " })).rejects.toThrow(
      "text is required.",
    );
    await expect(call("rooms.ask", { roomId: "gone", text: "Hi" })).rejects.toThrow(
      "no longer exists",
    );
  });

  it("names only bots that still exist in the brief", () => {
    const room = { name: "R", purpose: "", leadBotId: "atlas", memberBotIds: ["juno", "gone"] };
    const brief = roomBrief(room as Room, bots);
    expect(brief).toContain('(Asked in the room "R".');
    expect(brief).not.toContain("gone");
  });

  it("takes a deleted bot out of its rooms", async () => {
    const { call, rooms } = await harness();
    const trio = await call<Room>("rooms.create", { ...STOCK, memberBotIds: ["juno", "mika"] });
    const pair = await call<Room>("rooms.create", {
      name: "Pair",
      leadBotId: "juno",
      memberBotIds: ["mika"],
    });

    // The lead of the first room goes: its first member leads now.
    await rooms.forgetBot("atlas");
    expect(rooms.get(trio.id)).toMatchObject({ leadBotId: "juno", memberBotIds: ["mika"] });

    // A room left with one bot is no room.
    await rooms.forgetBot("mika");
    expect(rooms.list().map((room) => room.id)).not.toContain(pair.id);
    expect(rooms.list()).toEqual([]);
  });
});
