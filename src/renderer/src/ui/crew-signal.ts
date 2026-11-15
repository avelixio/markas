import { createSignal } from "solid-js";

/** The state of the whole crew at a glance. */
export interface CrewSignal {
  /** Bots in the middle of a turn. */
  working: number;
  /** Bots that stopped for the person: a question, an approval, or a tab handed over. */
  waiting: number;
}

/** waiting wins over working: one bot that needs the person matters more than many that do not. */
export type CrewState = "waiting" | "working" | "idle";

const [crewSignal, setCrewSignalValue] = createSignal<CrewSignal>({ working: 0, waiting: 0 });

export { crewSignal };

/** Reported by the chat area, which is the one place that follows every bot. */
export function setCrewSignal(next: CrewSignal): void {
  const current = crewSignal();
  if (current.working === next.working && current.waiting === next.waiting) return;
  setCrewSignalValue(next);
}

export function crewState(signal: CrewSignal): CrewState {
  if (signal.waiting > 0) return "waiting";
  return signal.working > 0 ? "working" : "idle";
}

/**
 * handoff: a tab is in the person's hands. approval: a bot asked a question or for a yes.
 * finished: a bot answered while the person was elsewhere. failed: a bot's last turn broke.
 */
export type NoticeKind = "handoff" | "approval" | "finished" | "failed";

/** One thing worth the person's attention, as the notifications list shows it. */
export interface CrewNotice {
  /** The same for as long as the notice is about the same thing. */
  key: string;
  botId: string;
  botName: string;
  kind: NoticeKind;
  /** The bot's or the host's own words about it. May be empty. */
  detail: string;
  /** The tab to open, for a hand-off. */
  tabId?: string;
}

/** Notices that wait on the person. The other kinds are news and can be marked read. */
export const needsPerson = (kind: NoticeKind) => kind === "handoff" || kind === "approval";

const [crewNotices, setCrewNoticesValue] = createSignal<CrewNotice[]>([]);
const [dismissed, setDismissed] = createSignal<ReadonlySet<string>>(new Set());
const firstSeen = new Map<string, number>();

/** The notices to show: everything reported, without the news the person marked read. */
export function shownNotices(): CrewNotice[] {
  const read = dismissed();
  return crewNotices().filter((notice) => !read.has(notice.key));
}

/** When a notice was first reported, so the list can say how old it is. */
export const noticeSeenAt = (key: string): number => firstSeen.get(key) ?? Date.now();

/** Reported by the chat area whenever what needs attention changes. */
export function setCrewNotices(next: CrewNotice[]): void {
  const keys = new Set(next.map((notice) => notice.key));
  for (const notice of next) {
    if (!firstSeen.has(notice.key)) firstSeen.set(notice.key, Date.now());
  }
  for (const key of [...firstSeen.keys()]) {
    if (!keys.has(key)) firstSeen.delete(key);
  }
  // A notice that is gone is forgotten, so the same thing happening again shows again.
  const read = dismissed();
  if ([...read].some((key) => !keys.has(key))) {
    setDismissed(new Set([...read].filter((key) => keys.has(key))));
  }
  const current = crewNotices();
  const same =
    current.length === next.length &&
    current.every(
      (notice, index) =>
        notice.key === next[index]?.key &&
        notice.detail === next[index]?.detail &&
        notice.botName === next[index]?.botName,
    );
  if (!same) setCrewNoticesValue(next);
}

/** Marks the news read. What waits on the person stays until it is dealt with. */
export function markNoticesRead(): void {
  const news = crewNotices().filter((notice) => !needsPerson(notice.kind));
  setDismissed(new Set([...dismissed(), ...news.map((notice) => notice.key)]));
}

const [openBotRequest, setOpenBotRequest] = createSignal<{ botId: string; nonce: number } | null>(
  null,
);

export { openBotRequest };

/** Asks the chat area to show a bot's chat. The rail calls this; the chat area listens. */
export function requestOpenBot(botId: string): void {
  setOpenBotRequest({ botId, nonce: (openBotRequest()?.nonce ?? 0) + 1 });
}

const [openAreaRequest, setOpenAreaRequest] = createSignal<{ area: string; nonce: number } | null>(
  null,
);

export { openAreaRequest };

/** Asks the rail to open an area, such as Switchboard. The chat area calls this. */
export function requestOpenArea(area: string): void {
  setOpenAreaRequest({ area, nonce: (openAreaRequest()?.nonce ?? 0) + 1 });
}
