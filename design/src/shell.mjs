// The app shell: navigation rail, sidebar, conversation and right panel.
import { box, col, ellipse, row } from "../tools/dsl.mjs";
import { icon } from "./icons.mjs";
import {
  button,
  chip,
  edge,
  hspace,
  iconButton,
  input,
  kbd,
  outline,
  para,
  personAvatar,
  segmented,
  sigil,
  statusDot,
  t,
  vspace,
} from "./parts.mjs";
import { c, RADIUS, SCREEN, SIZE } from "./tokens.mjs";

/** The example team used across the screens. */
export const BOTS = {
  router: {
    name: "Dispatch",
    role: "Sets up bots and routes work",
    color: "amber",
    pattern: 4,
    engine: "Claude Code",
  },
  atlas: {
    name: "Atlas",
    role: "Stock and dashboard checks",
    color: "mint",
    pattern: 1,
    engine: "Claude Code",
  },
  juno: {
    name: "Juno",
    role: "Admin console lookups",
    color: "violet",
    pattern: 3,
    engine: "Codex",
  },
  mika: {
    name: "Mika",
    role: "Notes and memory sync",
    color: "sky",
    pattern: 0,
    engine: "Codex",
  },
  pico: { name: "Pico", role: "Inbox summaries", color: "rose", pattern: 6, engine: "Codex" },
  nova: { name: "Nova", role: "Morning brief", color: "sand", pattern: 5, engine: "Codex" },
  sol: {
    name: "Sol",
    role: "Weekly conversion report",
    color: "lime",
    pattern: 7,
    engine: "Claude Code",
  },
};

export const botSigil = (key, size = 28) => sigil(BOTS[key].pattern, BOTS[key].color, size);

const NAV = [
  ["chat", "Chats"],
  ["team", "Rooms"],
  ["routine", "Rounds"],
  ["key", "Keyring"],
  ["link", "Switchboard"],
  ["zap", "Optimizer"],
  ["folder", "Archive"],
  ["activity", "Logbook"],
];

/** How much of the engines' plan is left, as a ring. Amber when it is running low. */
const fuelGauge = (active) =>
  col(
    {
      name: "nav/Fuel",
      width: 54,
      padding: [6, 0, 6, 0],
      gap: 3,
      crossAlign: "center",
      cornerRadius: RADIUS.control + 2,
      fill: active ? c.raised : "none",
    },
    [
      box({ width: 20, height: 20 }, [
        ellipse({
          x: 1,
          y: 1,
          width: 18,
          height: 18,
          fill: "none",
          stroke: c.lineStrong,
          strokeWeight: 3,
        }),
        ellipse({
          x: 1,
          y: 1,
          width: 18,
          height: 18,
          fill: "none",
          stroke: c.warn,
          strokeWeight: 3,
          arcStart: -90,
          arcSweep: 58,
        }),
      ]),
      t("16% left", "small", active ? c.text : c.text3, { fontSize: 9.5, lineHeight: 12 }),
    ],
  );

/** The left rail: one icon per area of the app. */
export function navRail(active = "Chats", { alerts = 2 } = {}) {
  const item = ([name, label]) =>
    col(
      {
        name: `nav/${label}`,
        width: 54,
        padding: [6, 0, 6, 0],
        gap: 3,
        crossAlign: "center",
        cornerRadius: RADIUS.control + 2,
        fill: label === active ? c.raised : "none",
      },
      [
        icon(name, label === active ? c.accentText : c.text2, 18),
        t(label, "small", label === active ? c.text : c.text3, { fontSize: 9.5, lineHeight: 12 }),
      ],
    );
  return col(
    {
      name: "NavRail",
      width: 62,
      padding: [12, 4, 12, 4],
      gap: 4,
      crossAlign: "center",
      fill: c.sidebar,
      sizingV: "fill",
      ...edge("right"),
    },
    [
      row(
        {
          name: "logo",
          width: 32,
          height: 32,
          mainAlign: "center",
          cornerRadius: 9,
          fill: c.accent,
        },
        [icon("logo", c.onAccent, 18)],
      ),
      box({ width: 1, height: 8 }),
      ...NAV.map(item),
      vspace(),
      fuelGauge(active === "Fuel"),
      box({ name: "nav/Alerts", width: 44, height: 36 }, [
        row({ width: 44, height: 36, mainAlign: "center", cornerRadius: RADIUS.control + 2 }, [
          icon("bell", c.text2, 18),
        ]),
        alerts
          ? row(
              {
                x: 24,
                y: 2,
                width: 16,
                height: 16,
                mainAlign: "center",
                cornerRadius: RADIUS.full,
                fill: c.warn,
              },
              [t(String(alerts), "smallStrong", c.ink, { fontSize: 10, lineHeight: 12 })],
            )
          : null,
      ]),
      row({ name: "nav/Settings", width: 44, height: 36, mainAlign: "center" }, [
        icon("sliders", c.text2, 18),
      ]),
      personAvatar("ME", 28),
    ],
  );
}

const sectionLabel = (label, trailing) =>
  row({ name: `section/${label}`, sizingH: "fill", padding: [10, 8, 4, 8] }, [
    t(label, "label", c.text3),
    hspace(),
    trailing ?? null,
  ]);

function botRow(key, { preview, time, state, active = false, unread = 0 }) {
  const bot = BOTS[key];
  const stateTone = { running: "info", waiting: "warn", failed: "danger", idle: null }[
    state ?? "idle"
  ];
  return row(
    {
      name: `bot-row/${bot.name}`,
      sizingH: "fill",
      padding: [7, 8, 7, 8],
      gap: 10,
      cornerRadius: RADIUS.control + 2,
      fill: active ? c.raised : "none",
    },
    [
      botSigil(key, 28),
      col({ gap: 1, sizingH: "fill" }, [
        row({ gap: 6, sizingH: "fill" }, [
          t(bot.name, "bodyStrong"),
          stateTone ? statusDot(stateTone, 6) : null,
          hspace(),
          t(time, "small", c.text3),
        ]),
        row({ gap: 6, sizingH: "fill" }, [
          t(preview, "small", state === "waiting" ? c.warn : c.text2),
          hspace(),
          unread
            ? row(
                { height: 16, padding: [0, 5, 0, 5], cornerRadius: RADIUS.full, fill: c.accent },
                [t(String(unread), "smallStrong", c.onAccent, { fontSize: 10, lineHeight: 12 })],
              )
            : null,
        ]),
      ]),
    ],
  );
}

const routineRow = (name, when, botKey) =>
  row(
    {
      name: `routine-row/${name}`,
      sizingH: "fill",
      padding: [6, 8, 6, 8],
      gap: 10,
      cornerRadius: RADIUS.control + 2,
    },
    [
      row({ width: 28, height: 28, mainAlign: "center" }, [icon("routine", c.text3)]),
      col({ gap: 1, sizingH: "fill" }, [t(name, "body"), t(when, "small", c.text3)]),
      botSigil(botKey, 16),
    ],
  );

/** The sidebar of the Chats area: pinned bots, the rest of the team, upcoming routines. */
export function sidebar({ active = "atlas" } = {}) {
  return col(
    {
      name: "Sidebar",
      width: SIZE.sidebar,
      padding: [12, 8, 12, 8],
      gap: 2,
      fill: c.sidebar,
      sizingV: "fill",
      ...edge("right"),
    },
    [
      row({ sizingH: "fill", gap: 8, padding: [0, 4, 8, 4] }, [
        input("Search", {
          placeholder: true,
          iconName: "search",
          grow: true,
          trailing: kbd("Ctrl K"),
        }),
        iconButton("plus", { color: c.text }),
      ]),
      sectionLabel(
        "Waiting on you",
        row({ height: 16, padding: [0, 5, 0, 5], cornerRadius: RADIUS.full, fill: c.warn }, [
          t("1", "smallStrong", c.ink, { fontSize: 10, lineHeight: 12 }),
        ]),
      ),
      botRow("juno", {
        preview: "Finish a sign-in step",
        time: "08:47",
        state: "waiting",
        active: active === "juno",
      }),
      sectionLabel("Pinned"),
      botRow("router", { preview: "Atlas is set up. Test run passed.", time: "09:12" }),
      botRow("atlas", {
        preview: "Stock is 3.410 units.",
        time: "09:00",
        active: active === "atlas",
        state: active === "atlas-running" ? "running" : "idle",
      }),
      sectionLabel("Crew", icon("plus", c.text3, 12)),
      botRow("mika", {
        preview: "Synced 14 notes.",
        time: "05:02",
        active: active === "mika",
      }),
      botRow("pico", {
        preview: "Working: inbox summary",
        time: "06:00",
        state: "running",
        unread: 2,
        active: active === "pico",
      }),
      botRow("nova", { preview: "Your brief for today is ready.", time: "08:00", unread: 1 }),
      botRow("sol", { preview: "Weekly report sent Monday.", time: "Mon" }),
      sectionLabel("Next rounds", t("See all", "small", c.accentText)),
      routineRow("Dashboard to notes", "Today 11:00", "mika"),
      routineRow("Inbox summary", "Today 12:00", "pico"),
      routineRow("Stock check", "Today 16:00", "atlas"),
      vspace(),
      row({ sizingH: "fill", gap: 8, padding: [8, 8, 0, 8], ...edge("top") }, [
        statusDot("accent", 6),
        t("Host running", "small", c.text2),
        hspace(),
        t("3 engines ready", "small", c.text3),
      ]),
    ],
  );
}

/** Conversation header: who this is, what they run on, and the panel switches. */
export function chatHeader(key, { state = "idle", panel = "Browser" } = {}) {
  const bot = BOTS[key];
  const states = {
    idle: chip("Idle", { dot: true }),
    running: chip("Working", { toneName: "info", dot: true }),
    waiting: chip("Waiting on you", { toneName: "warn", dot: true }),
  };
  return row(
    {
      name: "ChatHeader",
      height: SIZE.header,
      sizingH: "fill",
      padding: [0, 16, 0, 16],
      gap: 10,
      ...edge("bottom"),
    },
    [
      botSigil(key, 28),
      col({ gap: 0 }, [t(bot.name, "heading"), t(bot.role, "small", c.text2)]),
      states[state],
      hspace(),
      row(
        { height: 26, padding: [0, 8, 0, 8], gap: 6, cornerRadius: RADIUS.control, ...outline() },
        [
          icon("terminal", c.text3, 12),
          t(bot.engine, "small", c.text2),
          icon("chevronDown", c.text3, 12),
        ],
      ),
      row({ gap: 2 }, [
        iconButton("globe", { active: panel === "Browser" }),
        iconButton("folder", { active: panel === "Files" }),
        iconButton("sliders", { active: panel === "Settings" }),
      ]),
    ],
  );
}

/** Thread tabs: the main thread plus side threads of the same bot. */
export function threadTabs(tabs, active = 0) {
  return row(
    {
      name: "ThreadTabs",
      height: 36,
      sizingH: "fill",
      padding: [0, 12, 0, 12],
      gap: 2,
      ...edge("bottom"),
    },
    [
      ...tabs.map((label, index) =>
        row(
          {
            name: `thread/${label}`,
            sizingV: "fill",
            padding: [0, 10, 0, 10],
            gap: 6,
            ...(index === active ? edge("bottom", c.accent) : {}),
            strokeBottomWeight: index === active ? 2 : 0,
          },
          [
            icon(index === 0 ? "chat" : "thread", index === active ? c.text : c.text3, 12),
            t(label, "smallStrong", index === active ? c.text : c.text2),
          ],
        ),
      ),
      row({ sizingV: "fill", padding: [0, 8, 0, 8] }, [icon("plus", c.text3, 12)]),
    ],
  );
}

const messageShell = (avatar, name, time, extras, children, { tinted = false } = {}) =>
  row(
    {
      name: `message/${name}`,
      sizingH: "fill",
      gap: 12,
      crossAlign: "min",
      padding: tinted ? [12, 14, 12, 14] : [4, 14, 4, 14],
      cornerRadius: RADIUS.card,
      fill: tinted ? c.surface : "none",
    },
    [
      avatar,
      col({ gap: 6, sizingH: "fill" }, [
        row({ gap: 8, sizingH: "fill" }, [
          t(name, "bodyStrong"),
          t(time, "small", c.text3),
          ...extras,
        ]),
        ...children,
      ]),
    ],
  );

/** A message from the person. */
export const userMessage = (time, body) =>
  messageShell(personAvatar("ME", 24), "You", time, [], [para(body)], { tinted: true });

/** A message from a bot. `via` marks one sent by another bot on the person's behalf. */
export const botMessage = (key, time, children, { via, replyTo } = {}) =>
  messageShell(
    botSigil(key, 24),
    BOTS[key].name,
    time,
    [
      via ? chip(`from ${BOTS[via].name}`, { iconName: "arrowRight" }) : null,
      replyTo ? chip(`reply to ${replyTo}`, { iconName: "reply" }) : null,
    ],
    children.map((child) => (typeof child === "string" ? para(child) : child)),
  );

/** One line of what a bot did, collapsed by default. */
export const toolLine = (iconName, label, detail, { toneName = "neutral" } = {}) =>
  row(
    {
      name: "tool-line",
      height: 28,
      padding: [0, 10, 0, 8],
      gap: 8,
      cornerRadius: RADIUS.control,
      ...outline(),
    },
    [
      icon(
        iconName,
        toneName === "neutral" ? c.text3 : toneName === "warn" ? c.warn : c.accentText,
        12,
      ),
      t(label, "smallStrong", c.text2),
      detail ? t(detail, "small", c.text3) : null,
      icon("chevronRight", c.text3, 12),
    ],
  );

export const dayMarker = (label) =>
  row({ name: "day", sizingH: "fill", gap: 12, padding: [4, 14, 4, 14] }, [
    box({ height: 1, width: 1, sizingH: "fill", fill: c.line }),
    t(label, "small", c.text3),
    box({ height: 1, width: 1, sizingH: "fill", fill: c.line }),
  ]);

/** The message composer. `mode` shows what a new message does while the bot is busy. */
export function composer(key, { value, mode, attachments = [] } = {}) {
  const bot = BOTS[key];
  return col({ name: "Composer", sizingH: "fill", padding: [0, 16, 14, 16], gap: 6 }, [
    col(
      {
        sizingH: "fill",
        padding: [10, 10, 8, 12],
        gap: 10,
        cornerRadius: RADIUS.panel,
        fill: c.surface,
        ...outline(c.lineStrong),
      },
      [
        attachments.length
          ? row(
              { gap: 6 },
              attachments.map((name) => chip(name, { iconName: "file" })),
            )
          : null,
        para(value ?? `Message ${bot.name}`, "body", value ? c.text : c.text3),
        row({ sizingH: "fill", gap: 4 }, [
          iconButton("attach", { size: 28 }),
          mode
            ? row(
                {
                  height: 24,
                  padding: [0, 8, 0, 8],
                  gap: 6,
                  cornerRadius: RADIUS.full,
                  fill: c.raised,
                },
                [
                  icon(mode === "queue" ? "queue" : "steer", c.text2, 12),
                  t(
                    mode === "queue" ? "New messages queue" : "New messages steer",
                    "small",
                    c.text2,
                  ),
                  icon("chevronDown", c.text3, 12),
                ],
              )
            : null,
          hspace(),
          row({ gap: 5 }, [
            box({ width: 28, height: 4, cornerRadius: 2, fill: c.lineStrong }, [
              box({ width: 4, height: 4, cornerRadius: 2, fill: c.accent }),
            ]),
            t("Context 3% full", "small", c.text3),
          ]),
          box({ width: 6, height: 1 }),
          t("Enter to send", "small", c.text3),
          row(
            {
              width: 28,
              height: 28,
              mainAlign: "center",
              cornerRadius: RADIUS.full,
              fill: value ? c.accent : c.raised,
            },
            [icon("send", value ? c.onAccent : c.text3)],
          ),
        ]),
      ],
    ),
  ]);
}

/** The conversation column: header, optional thread tabs, messages, composer. */
export function conversation(key, { header = {}, tabs, messages, composerProps = {}, above = [] }) {
  return col({ name: "Conversation", sizingH: "fill", sizingV: "fill", fill: c.app }, [
    chatHeader(key, header),
    tabs ? threadTabs(tabs.labels, tabs.active) : null,
    // The reading column is capped so lines stay a comfortable length on wide windows.
    col({ name: "ReadingColumn", sizingH: "fill", sizingV: "fill", crossAlign: "center" }, [
      col({ sizingH: "fill", sizingV: "fill", maxWidth: 820 }, [
        col(
          {
            name: "Messages",
            sizingH: "fill",
            sizingV: "fill",
            padding: [14, 10, 10, 10],
            gap: 10,
            mainAlign: "max",
          },
          messages,
        ),
        ...above,
        composer(key, composerProps),
      ]),
    ]),
  ]);
}

/** The right panel with its Browser, Files and Settings switch. */
export function rightPanel(active, children, { width = SIZE.panel } = {}) {
  const tabs = ["Browser", "Files", "Settings"];
  return col(
    { name: `RightPanel/${active}`, width, sizingV: "fill", fill: c.sidebar, ...edge("left") },
    [
      row(
        {
          height: SIZE.header,
          sizingH: "fill",
          padding: [0, 12, 0, 12],
          gap: 8,
          ...edge("bottom"),
        },
        [segmented(tabs, tabs.indexOf(active), { grow: true }), iconButton("close")],
      ),
      col({ sizingH: "fill", sizingV: "fill" }, children),
    ],
  );
}

/** A full app screen: rail, then whatever columns the area needs. */
export const appScreen = (name, railActive, columns, railOptions) =>
  row(
    {
      name,
      width: SCREEN.width,
      height: SCREEN.height,
      crossAlign: "min",
      fill: c.app,
      clip: true,
    },
    [navRail(railActive, railOptions), ...columns],
  );

/** The heading block of a full-page area such as Vault or Activity. */
export const pageHeader = (title, subtitle, actions = []) =>
  row(
    { name: "PageHeader", sizingH: "fill", gap: 12, padding: [24, 32, 16, 32], crossAlign: "min" },
    [
      col({ gap: 4, sizingH: "fill" }, [t(title, "title"), para(subtitle, "body", c.text2)]),
      ...actions,
    ],
  );

export { button };
