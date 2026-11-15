/** A room: a few bots that work on one thing together, with one of them deciding who answers. */
export interface Room {
  id: string;
  name: string;
  /** One line saying what the room is for. May be empty. */
  purpose: string;
  /** The bot that gets the person's message first and decides who answers. */
  leadBotId: string;
  /** The other bots in the room. The lead is never listed here. */
  memberBotIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomInput {
  name: string;
  purpose?: string;
  leadBotId: string;
  memberBotIds: string[];
}

export const ROOM_LIMITS = {
  name: 60,
  purpose: 200,
  /** Bots besides the lead. More than this and nobody can tell who does what. */
  members: 8,
  question: 20_000,
} as const;

/** What `rooms.ask` answers: the chat where the work can be followed. */
export interface RoomAskResult {
  leadBotId: string;
}
