import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ROOM_LIMITS, type Room, type RoomInput } from "../../shared/rooms";

interface StoredState {
  version: 1;
  rooms: Room[];
}

export class RoomsError extends Error {}

const oneLine = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/**
 * The rooms the person made, kept in `rooms.json`.
 * A room only names bots. It holds no messages: the work itself lives in the bots' own chats.
 */
export class RoomsStore {
  readonly #path: string;
  #state: StoredState = { version: 1, rooms: [] };
  #writes: Promise<void> = Promise.resolve();

  constructor(dataRoot: string) {
    this.#path = join(dataRoot, "rooms.json");
  }

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as StoredState;
      if (parsed.version === 1 && Array.isArray(parsed.rooms)) this.#state = parsed;
    } catch (error) {
      if (error instanceof SyntaxError) return;
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }

  list(): Room[] {
    return structuredClone(this.#state.rooms);
  }

  get(id: string): Room {
    const room = this.#state.rooms.find((candidate) => candidate.id === id);
    if (!room) throw new RoomsError("That room no longer exists.");
    return structuredClone(room);
  }

  /** `botIds` are the bots that exist now; a room can only name those. */
  async create(input: RoomInput, botIds: readonly string[], now = new Date()): Promise<Room> {
    const fields = this.#checked(input, botIds, null);
    const room: Room = {
      id: randomUUID(),
      ...fields,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.#state.rooms.push(room);
    await this.#persist();
    return structuredClone(room);
  }

  async update(
    id: string,
    patch: Partial<RoomInput>,
    botIds: readonly string[],
    now = new Date(),
  ): Promise<Room> {
    const room = this.#state.rooms.find((candidate) => candidate.id === id);
    if (!room) throw new RoomsError("That room no longer exists.");
    const fields = this.#checked(
      {
        name: patch.name ?? room.name,
        purpose: patch.purpose ?? room.purpose,
        leadBotId: patch.leadBotId ?? room.leadBotId,
        memberBotIds: patch.memberBotIds ?? room.memberBotIds,
      },
      botIds,
      id,
    );
    Object.assign(room, fields, { updatedAt: now.toISOString() });
    await this.#persist();
    return structuredClone(room);
  }

  async remove(id: string): Promise<void> {
    const before = this.#state.rooms.length;
    this.#state.rooms = this.#state.rooms.filter((room) => room.id !== id);
    if (this.#state.rooms.length !== before) await this.#persist();
  }

  /**
   * A deleted bot leaves every room. A room that lost its lead is led by its first member,
   * and a room with nobody left to ask is removed.
   */
  async forgetBot(botId: string): Promise<void> {
    let changed = false;
    const kept: Room[] = [];
    for (const room of this.#state.rooms) {
      if (room.leadBotId !== botId && !room.memberBotIds.includes(botId)) {
        kept.push(room);
        continue;
      }
      changed = true;
      const members = room.memberBotIds.filter((id) => id !== botId);
      if (room.leadBotId === botId) {
        const next = members.shift();
        if (!next) continue;
        room.leadBotId = next;
      }
      if (members.length === 0) continue;
      room.memberBotIds = members;
      kept.push(room);
    }
    if (!changed) return;
    this.#state.rooms = kept;
    await this.#persist();
  }

  #checked(
    input: RoomInput,
    botIds: readonly string[],
    selfId: string | null,
  ): Pick<Room, "name" | "purpose" | "leadBotId" | "memberBotIds"> {
    const name = oneLine(input.name);
    if (!name) throw new RoomsError("Give the room a name.");
    if (name.length > ROOM_LIMITS.name) {
      throw new RoomsError(`A room's name can be at most ${ROOM_LIMITS.name} characters.`);
    }
    const taken = this.#state.rooms.some(
      (room) => room.id !== selfId && room.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) throw new RoomsError(`There is already a room called ${name}.`);
    const purpose = oneLine(input.purpose);
    if (purpose.length > ROOM_LIMITS.purpose) {
      throw new RoomsError(
        `What the room is for can be at most ${ROOM_LIMITS.purpose} characters.`,
      );
    }
    if (typeof input.leadBotId !== "string" || !botIds.includes(input.leadBotId)) {
      throw new RoomsError("Choose a bot to lead the room.");
    }
    if (
      !Array.isArray(input.memberBotIds) ||
      !input.memberBotIds.every((id) => typeof id === "string")
    ) {
      throw new RoomsError("The room's members are not a list of bots.");
    }
    const members = [...new Set(input.memberBotIds)].filter((id) => id !== input.leadBotId);
    if (members.length === 0) throw new RoomsError("Add at least one more bot to the room.");
    if (members.length > ROOM_LIMITS.members) {
      throw new RoomsError(`A room can hold at most ${ROOM_LIMITS.members} bots besides its lead.`);
    }
    if (!members.every((id) => botIds.includes(id))) {
      throw new RoomsError("One of the chosen bots no longer exists.");
    }
    return { name, purpose, leadBotId: input.leadBotId, memberBotIds: members };
  }

  /** Writes are applied one at a time and land whole, so a crash never leaves half a file. */
  #persist(): Promise<void> {
    const write = this.#writes.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      const temporary = `${this.#path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.#path);
    });
    this.#writes = write.catch(() => undefined);
    return write;
  }
}
