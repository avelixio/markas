import type { RoomsStore } from "../backend/rooms/rooms-store";
import type { BotSummary } from "../shared/ipc";
import { ROOM_LIMITS, type Room, type RoomAskResult, type RoomInput } from "../shared/rooms";
import type { HostMethod } from "./methods";
import { isObject, requireString } from "./parsers";

export interface RoomsContext {
  rooms: RoomsStore;
  bots: () => BotSummary[];
  /** Puts a message in a bot's queue, as if the person had written it in that bot's chat. */
  send: (botId: string, text: string) => Promise<unknown>;
}

/**
 * What the lead is told along with the person's words: who is in the room and what each is
 * for. It is written after the person's own message and in plain sight, so the chat shows
 * exactly what the bot was asked.
 */
export function roomBrief(room: Room, bots: BotSummary[]): string {
  const members = room.memberBotIds
    .map((id) => bots.find((bot) => bot.id === id))
    .filter((bot): bot is BotSummary => bot !== undefined)
    .map((bot) => `- ${bot.name}${bot.role.trim() ? `: ${bot.role.trim()}` : ""}`);
  return [
    `(Asked in the room "${room.name}"${room.purpose ? `, which is for: ${room.purpose}` : ""}.`,
    "You lead this room. The other bots in it are:",
    ...members,
    "Decide which of them should help. Ask each one only for what it is there for, with markas.send_message, and wait for the answers.",
    "Then give me one short answer that says who found what. If nobody else is needed, answer yourself.)",
  ].join("\n");
}

/** Rooms over HTTP, for the person making and asking them in the web UI. */
export function createRoomsMethods(context: RoomsContext): Record<string, HostMethod> {
  const botIds = () => context.bots().map((bot) => bot.id);
  const parseInput = (value: unknown): Partial<RoomInput> => {
    if (!isObject(value)) throw new Error("Send the room's name and its bots.");
    const input: Partial<RoomInput> = {};
    if (value.name !== undefined) input.name = value.name as string;
    if (value.purpose !== undefined) input.purpose = value.purpose as string;
    if (value.leadBotId !== undefined) input.leadBotId = value.leadBotId as string;
    if (value.memberBotIds !== undefined) input.memberBotIds = value.memberBotIds as string[];
    return input;
  };

  return {
    "rooms.list": () => context.rooms.list(),
    "rooms.create": (input) => {
      const parsed = parseInput(input);
      return context.rooms.create(
        {
          name: parsed.name ?? "",
          purpose: parsed.purpose,
          leadBotId: parsed.leadBotId ?? "",
          memberBotIds: parsed.memberBotIds ?? [],
        },
        botIds(),
      );
    },
    "rooms.update": (input) => {
      if (!isObject(input)) throw new Error("Send the room and what to change.");
      return context.rooms.update(requireString(input.id, "id"), parseInput(input), botIds());
    },
    "rooms.remove": (id) => context.rooms.remove(requireString(id, "id")),
    "rooms.ask": async (input): Promise<RoomAskResult> => {
      if (!isObject(input)) throw new Error("Send the room and your message.");
      const room = context.rooms.get(requireString(input.roomId, "roomId"));
      const text = requireString(input.text, "text").trim();
      if (text.length > ROOM_LIMITS.question) throw new Error("That message is too long.");
      const bots = context.bots();
      if (!bots.some((bot) => bot.id === room.leadBotId)) {
        throw new Error("The bot that leads this room no longer exists. Choose another lead.");
      }
      await context.send(room.leadBotId, `${text}\n\n${roomBrief(room, bots)}`);
      return { leadBotId: room.leadBotId };
    },
  };
}
