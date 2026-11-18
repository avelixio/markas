// Conversation states: messages queued while a bot is busy, bot-to-bot work,
// a browser takeover, and the approval and secure-entry cards.
import { col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  banner,
  button,
  chip,
  edge,
  hspace,
  iconButton,
  input,
  outline,
  para,
  t,
} from "../parts.mjs";
import {
  appScreen,
  BOTS,
  botMessage,
  botSigil,
  conversation,
  dayMarker,
  rightPanel,
  sidebar,
  toolLine,
  userMessage,
} from "../shell.mjs";
import { c, RADIUS } from "../tokens.mjs";
import { browserPanel } from "./main.mjs";

/** One message waiting in a bot's queue, with everything the person can do to it. */
const queuedItem = (position, body, { dragging = false } = {}) =>
  row(
    {
      name: `queued/${position}`,
      sizingH: "fill",
      gap: 8,
      padding: [8, 8, 8, 6],
      cornerRadius: RADIUS.control + 2,
      fill: dragging ? c.raised : c.surface,
      ...outline(dragging ? c.accent : c.line),
    },
    [
      icon("grip", c.text3),
      row(
        { width: 20, height: 20, mainAlign: "center", cornerRadius: RADIUS.full, fill: c.raised },
        [t(String(position), "smallStrong", c.text2)],
      ),
      para(body, "body"),
      button("Send now", { size: "sm", iconName: "zap" }),
      iconButton("pencil", { size: 24 }),
      iconButton("thread", { size: 24 }),
      iconButton("trash", { size: 24 }),
    ],
  );

const queuePanel = col({ name: "QueuePanel", sizingH: "fill", padding: [0, 16, 8, 16], gap: 8 }, [
  banner(
    "info",
    "clock",
    "Atlas is busy, so new messages wait",
    "3 messages will be delivered in order when this turn ends. Send now stops the current turn first.",
    [button("Pause queue", { size: "sm", iconName: "pause" })],
  ),
  queuedItem(1, "Also compare today's stock with the same hour yesterday."),
  queuedItem(2, "If it dropped more than 20%, list the three largest orders.", { dragging: true }),
  queuedItem(3, "Then post the summary to my notes."),
  row({ sizingH: "fill", gap: 6, padding: [0, 4, 0, 4] }, [
    icon("grip", c.text3, 12),
    t("Drag to reorder", "small", c.text3),
    hspace(),
    icon("thread", c.text3, 12),
    t("Move to a new thread", "small", c.text3),
  ]),
]);

const queue = appScreen("06 Messages while busy, queue", "Chats", [
  sidebar({ active: "atlas-running" }),
  conversation("atlas", {
    header: { state: "running", panel: "none" },
    tabs: { labels: ["Main", "Reorder rules"], active: 0 },
    messages: [
      dayMarker("Today"),
      userMessage("15:58", "Run the 16:00 stock check a little early and tell me what you see."),
      botMessage("atlas", "15:58", [
        row({ gap: 6 }, [toolLine("globe", "Browser", "opening the dashboard")]),
        row({ gap: 8 }, [
          chip("Working", { toneName: "info", dot: true }),
          t("Reading the stock overview dashboard", "small", c.text2),
          button("Stop", { size: "sm", kind: "ghost", iconName: "stop" }),
        ]),
      ]),
    ],
    above: [queuePanel],
    composerProps: { mode: "queue" },
  }),
]);

const routing = row(
  {
    name: "RoutingNote",
    sizingH: "fill",
    gap: 8,
    padding: [8, 12, 8, 12],
    cornerRadius: RADIUS.card,
    ...outline(),
  },
  [
    icon("steer", c.text3),
    col({ gap: 1, sizingH: "fill" }, [
      t("Dispatch sent this to Juno", "bodyStrong"),
      t("Reason: it needs admin console access, which only Juno has.", "small", c.text2),
    ]),
    button("Reassign", { size: "sm" }),
  ],
);

const team = appScreen("07 Bot to bot work", "Chats", [
  sidebar({ active: "juno" }),
  conversation("juno", {
    header: { state: "idle", panel: "none" },
    tabs: { labels: ["Main", "Order 88213"], active: 1 },
    messages: [
      dayMarker("Today"),
      routing,
      botMessage(
        "router",
        "10:14",
        [
          "Please look up order 88213 in the admin console and report its current state and the last staff note. This was asked for in the Dispatch chat.",
        ],
        { via: "router" },
      ),
      botMessage("juno", "10:16", [
        row({ gap: 6 }, [
          toolLine("globe", "Browser", "6 steps"),
          toolLine("key", "Keyring", "Admin console (Juno)", { toneName: "accent" }),
        ]),
        "Order 88213 is in state Waiting for courier since 9 Nov 14:02. The last staff note says the courier asked for the label to be reprinted.",
        row({ gap: 6 }, [
          chip("Sent back to Dispatch", { toneName: "accent", iconName: "reply" }),
          chip("order-88213.png", { iconName: "image" }),
        ]),
      ]),
      botMessage("router", "10:16", ["Thanks. I passed this on in the Dispatch chat."], {
        replyTo: "Juno",
      }),
    ],
    composerProps: {},
  }),
  col(
    {
      name: "TeamPanel",
      width: 320,
      sizingV: "fill",
      padding: 16,
      gap: 14,
      fill: c.sidebar,
      ...edge("left"),
    },
    [
      t("This task", "label", c.text3),
      ...[
        ["router", "Asked by you in Dispatch", "10:13", "accent"],
        ["router", "Dispatch delegated to Juno", "10:14", "accent"],
        ["juno", "Juno replied to Dispatch", "10:16", "accent"],
        ["router", "Dispatch answered you", "10:16", "accent"],
      ].map(([key, label, time]) =>
        row({ sizingH: "fill", gap: 10 }, [
          botSigil(key, 20),
          col({ gap: 0, sizingH: "fill" }, [t(label, "body"), t(time, "small", c.text3)]),
          icon("check", c.accentText, 12),
        ]),
      ),
      row({ sizingH: "fill", height: 1, fill: c.line }, []),
      t("Limits", "label", c.text3),
      para(
        "A chain of bot messages stops after 6 hops. Runs started by another bot cannot change settings or share logins.",
        "small",
        c.text2,
      ),
    ],
  ),
]);

const takeoverCard = col(
  {
    name: "HandoffCard",
    sizingH: "fill",
    gap: 10,
    padding: 14,
    cornerRadius: RADIUS.card,
    fill: c.warnSoft,
  },
  [
    row({ gap: 8, sizingH: "fill" }, [
      icon("pointer", c.warn),
      t("Juno needs you to finish a step", "bodyStrong"),
      hspace(),
      t("waiting 2 min", "small", c.text2),
    ]),
    para(
      "The admin console asked for a code sent to your phone. Juno cannot receive it. Enter it in Juno's browser, then choose Done.",
      "body",
      c.text,
    ),
    row({ gap: 8, sizingH: "fill" }, [
      button("Open Juno's browser", { kind: "primary", iconName: "external" }),
      button("Done, continue", { iconName: "check" }),
      button("Skip this step", { kind: "ghost" }),
    ]),
  ],
);

const takeover = appScreen("10 Browser hand-off", "Chats", [
  sidebar({ active: "juno" }),
  conversation("juno", {
    header: { state: "waiting", panel: "Browser" },
    messages: [
      dayMarker("Today"),
      userMessage("08:44", "Check whether customer 20391 still has an open return request."),
      botMessage("juno", "08:45", [
        row({ gap: 6 }, [
          toolLine("globe", "Browser", "3 steps"),
          toolLine("key", "Keyring", "Admin console (Juno)", { toneName: "accent" }),
        ]),
        "I signed in with the saved login. The site is now asking for a one-time code.",
        takeoverCard,
      ]),
    ],
    composerProps: {},
  }),
  rightPanel("Browser", browserPanel({ takeover: true })),
]);

const approvalCard = col(
  {
    name: "ApprovalCard",
    sizingH: "fill",
    gap: 12,
    padding: 14,
    cornerRadius: RADIUS.card,
    fill: c.surface,
    ...outline(c.lineStrong),
  },
  [
    row({ gap: 8, sizingH: "fill" }, [
      icon("shield", c.warn),
      t("Pico wants to send a chat message", "bodyStrong"),
      hspace(),
      chip("Always asks", { iconName: "lock" }),
    ]),
    col({ gap: 6, sizingH: "fill", padding: 10, cornerRadius: RADIUS.control, fill: c.raised }, [
      row({ gap: 8 }, [t("To", "small", c.text3), t("Support on-call group", "small", c.text)]),
      para(
        "Morning summary: 14 new threads overnight, 2 need a reply from you (late delivery, new supplier).",
        "body",
      ),
    ]),
    row({ gap: 8, sizingH: "fill" }, [
      button("Send", { kind: "primary", iconName: "check" }),
      button("Edit first", { iconName: "pencil" }),
      button("Don't send", { kind: "ghost" }),
      hspace(),
      t("Started by the 06:00 round", "small", c.text3),
    ]),
  ],
);

const secretCard = col(
  {
    name: "SecureEntryCard",
    sizingH: "fill",
    gap: 12,
    padding: 14,
    cornerRadius: RADIUS.card,
    fill: c.surface,
    ...outline(c.accent),
  },
  [
    row({ gap: 8, sizingH: "fill" }, [
      icon("key", c.accentText),
      t("Save a login for Pico", "bodyStrong"),
      hspace(),
      chip("Goes straight to the keyring", { toneName: "accent", iconName: "lock" }),
    ]),
    para(
      "Pico asked for the chat CLI token. What you type here is never shown to the bot, the model or this chat.",
      "small",
      c.text2,
    ),
    row({ gap: 10, sizingH: "fill" }, [
      col({ gap: 6, sizingH: "fill" }, [
        t("Name", "smallStrong", c.text2),
        input("chat-cli", { grow: true, mono: true }),
      ]),
      col({ gap: 6, sizingH: "fill" }, [
        t("Token", "smallStrong", c.text2),
        input("••••••••••••••••••••", { grow: true, trailing: icon("eye", c.text3) }),
      ]),
    ]),
    row({ gap: 8, sizingH: "fill" }, [
      button("Save to keyring", { kind: "primary", iconName: "lock" }),
      button("Not now", { kind: "ghost" }),
      hspace(),
      t("Shared with: Pico only", "small", c.text3),
    ]),
  ],
);

// A bot asks for a login with markas.keyring_request. The card is filled in from the request;
// the person types the secret here, and the bot is told only the key's name.
const loginRequestCard = col(
  {
    name: "KeyRequestCard",
    sizingH: "fill",
    gap: 12,
    padding: 14,
    cornerRadius: RADIUS.card,
    fill: c.surface,
    ...outline(c.accent),
  },
  [
    row({ gap: 8, sizingH: "fill" }, [
      icon("key", c.accentText),
      t("Atlas asks for a login", "bodyStrong"),
      hspace(),
      chip("Goes straight to the keyring", { toneName: "accent", iconName: "lock" }),
    ]),
    para(
      "To read the weekly report on https://reports.example.com. What you type here is never shown to Atlas, the model or this chat.",
      "small",
      c.text2,
    ),
    row({ gap: 10, sizingH: "fill" }, [
      col({ gap: 6, sizingH: "fill" }, [
        t("Username", "smallStrong", c.text2),
        input("sam@example.com", { grow: true }),
      ]),
      col({ gap: 6, sizingH: "fill" }, [
        t("Password", "smallStrong", c.text2),
        input("••••••••••••••••", { grow: true, trailing: icon("eye", c.text3) }),
      ]),
    ]),
    row({ gap: 8, sizingH: "fill" }, [
      button("Save and let Atlas use it", { kind: "primary", iconName: "lock" }),
      button("More options", { kind: "ghost" }),
      button("Not now", { kind: "ghost" }),
      hspace(),
      t("Saved as reports.example.com, for Atlas only", "small", c.text3),
    ]),
  ],
);

const loginRequest = appScreen("11b A bot asks for a login", "Chats", [
  sidebar({ active: "Atlas" }),
  conversation("atlas", {
    header: { state: "waiting", panel: "none" },
    messages: [
      dayMarker("Today"),
      botMessage("atlas", "09:00", [
        "The weekly report needs a sign-in, and no key for that site is shared with me yet.",
        loginRequestCard,
      ]),
    ],
    composerProps: {},
  }),
]);

const cards = appScreen("11 Approval and secure entry cards", "Chats", [
  sidebar({ active: "Pico" }),
  conversation("pico", {
    header: { state: "waiting", panel: "none" },
    messages: [
      dayMarker("Today"),
      botMessage("pico", "06:00", [
        "I need the chat CLI token to read the inbox. I can't see it once you save it; I only use it.",
        secretCard,
      ]),
      botMessage("pico", "06:02", [
        row({ gap: 6 }, [toolLine("terminal", "chat CLI", "read 14 threads")]),
        "The summary is ready. Sending it needs your OK.",
        approvalCard,
      ]),
    ],
    composerProps: {},
  }),
]);

export default [
  { name: "06 Messages while busy, queue", spec: queue },
  { name: "07 Bot to bot work", spec: team },
  { name: "10 Browser hand-off", spec: takeover },
  { name: "11 Approval and secure entry cards", spec: cards },
  { name: "11b A bot asks for a login", spec: loginRequest },
];

export { BOTS };
