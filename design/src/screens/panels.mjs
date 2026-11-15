// The Files and Bot settings panels, and notifications with the undo toast.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  button,
  chip,
  divider,
  edge,
  hspace,
  iconButton,
  input,
  outline,
  para,
  segmented,
  statusDot,
  t,
  textArea,
  toggle,
} from "../parts.mjs";
import { appScreen, BOTS, botSigil, conversation, rightPanel, sidebar } from "../shell.mjs";
import { c, RADIUS } from "../tokens.mjs";
import { atlasMessages } from "./main.mjs";

const fileRow = (iconName, name, meta, { depth = 0, open } = {}) =>
  row(
    {
      name: `file/${name}`,
      sizingH: "fill",
      height: 30,
      padding: [0, 8, 0, 8 + depth * 16],
      gap: 8,
      cornerRadius: RADIUS.control,
    },
    [
      open === undefined
        ? box({ width: 12, height: 12 })
        : icon(open ? "chevronDown" : "chevronRight", c.text3, 12),
      icon(iconName, iconName === "folder" ? c.text2 : c.text3),
      t(name, "body"),
      hspace(),
      t(meta, "small", c.text3),
    ],
  );

const _group = (label, children) =>
  col({ sizingH: "fill", gap: 2 }, [
    row({ sizingH: "fill", padding: [10, 8, 4, 8] }, [t(label, "label", c.text3)]),
    ...children,
  ]);

const fileGroup = (label, children) =>
  col({ sizingH: "fill", gap: 2 }, [
    row({ sizingH: "fill", padding: [10, 8, 4, 8] }, [t(label, "label", c.text3)]),
    ...children,
  ]);

const filesPanel = [
  row({ sizingH: "fill", padding: [10, 12, 10, 12], gap: 8, ...edge("bottom") }, [
    input("Find a file", { placeholder: true, iconName: "search", grow: true }),
    iconButton("external", { size: 28 }),
  ]),
  col({ sizingH: "fill", sizingV: "fill", padding: [4, 8, 12, 8], gap: 4 }, [
    fileGroup("Atlas's quarters", [
      fileRow("file", "instructions.md", "2 KB", { depth: 0 }),
      fileRow("folder", "memory", "3 files", { open: true }),
      fileRow("file", "MEMORY.md", "1 KB", { depth: 1 }),
      fileRow("file", "reorder-rule.md", "640 B", { depth: 1 }),
      fileRow("folder", "workspace", "12 files", { open: false }),
    ]),
    fileGroup("Files in this chat", [
      fileRow("image", "stock-overview-0900.png", "Today 09:00"),
      fileRow("file", "stock-history.csv", "Yesterday"),
    ]),
    fileGroup("Downloads", [fileRow("file", "metrics-export.ndjson", "Mon")]),
    fileGroup("Shared by all bots", [fileRow("folder", "shared", "4 files", { open: false })]),
  ]),
  row({ sizingH: "fill", padding: [10, 12, 10, 12], gap: 8, ...edge("top") }, [
    icon("lock", c.text3, 12),
    para("The keyring and other bots' quarters are never listed here.", "small", c.text3),
  ]),
];

const files = appScreen("08 Files panel", "Chats", [
  sidebar({ active: "atlas" }),
  conversation("atlas", {
    header: { state: "idle", panel: "Files" },
    tabs: { labels: ["Main", "Reorder rules", "Metrics login"], active: 0 },
    messages: atlasMessages,
    composerProps: {
      attachments: ["stock-history.csv"],
      value: "Compare this export with today's reading.",
    },
  }),
  rightPanel("Files", filesPanel),
]);

/** One compact settings line: what it is on the left, its value or control on the right. */
const line = (label, control) =>
  row({ name: `line/${label}`, sizingH: "fill", gap: 12, height: 34 }, [
    t(label, "body"),
    hspace(),
    control,
  ]);

const count = (label) =>
  row({ gap: 6 }, [t(label, "small", c.text2), icon("chevronRight", c.text3, 12)]);

const settingsGroup = (label, hint, lines) =>
  col({ name: `group/${label}`, sizingH: "fill", gap: 2 }, [
    row({ sizingH: "fill", gap: 8, padding: [0, 0, 2, 0] }, [
      t(label, "label", c.text3),
      hspace(),
      t(hint, "small", c.text3, { fontSize: 11, lineHeight: 14 }),
    ]),
    col(
      {
        sizingH: "fill",
        padding: [2, 12, 2, 12],
        cornerRadius: RADIUS.card,
        fill: c.surface,
        ...outline(),
      },
      lines.flatMap((item, index) => (index === 0 ? [item] : [divider(), item])),
    ),
  ]);

// Four groups, so a setting is found by asking what it is about:
// what the bot runs on, what it knows, what it does, and what it may not do.
const settingsPanel = [
  col({ sizingH: "fill", sizingV: "fill", padding: [14, 16, 8, 16], gap: 12 }, [
    row({ sizingH: "fill", gap: 12 }, [
      botSigil("atlas", 44),
      col({ gap: 6, sizingH: "fill" }, [
        input("Atlas", { grow: true }),
        input("Stock and dashboard checks", { grow: true }),
      ]),
    ]),
    settingsGroup("Engine", "What it runs on", [
      line("Runs on", chip("Claude Code · Sonnet", { iconName: "terminal" })),
      line("Backup engine", chip("Codex", { iconName: "terminal" })),
    ]),
    settingsGroup("Knows", "What it reads every turn", [
      line("Instructions", count("12 lines")),
      line("Notes", count("8 saved")),
      line("Files in its quarters", count("14 files")),
    ]),
    settingsGroup("Does", "Its scheduled work", [
      line("Rounds", count("1 round")),
      line("Fuel used this week", count("46%")),
      line("While busy, new messages", segmented(["Queue", "Steer"], 0)),
    ]),
    settingsGroup("Limits", "What it may not do alone", [
      line("May act", segmented(["Ask first", "Auto", "Never ask"], 1)),
      line("Folders", count("Quarters + 2")),
      line("Keys", count("2 shared")),
      line("Browser profile", chip("analytics", { iconName: "globe" })),
      line("Show the plan before long tasks", toggle(true)),
    ]),
    line("Tell me about", segmented(["All", "Waiting on you", "Nothing"], 1)),
    hspace(),
  ]),
  row({ sizingH: "fill", padding: [10, 16, 10, 16], gap: 8, ...edge("top") }, [
    button("Delete bot", { kind: "danger", size: "sm", iconName: "trash" }),
    hspace(),
    t("Changes save as you make them", "small", c.text3),
  ]),
];

const settings = appScreen("09 Bot settings panel", "Chats", [
  sidebar({ active: "atlas" }),
  conversation("atlas", {
    header: { state: "idle", panel: "Settings" },
    tabs: { labels: ["Main", "Reorder rules", "Metrics login"], active: 0 },
    messages: atlasMessages,
  }),
  rightPanel("Settings", settingsPanel),
]);

const notice = (key, toneName, kind, body, time, action) =>
  row(
    {
      name: `notice/${kind}`,
      sizingH: "fill",
      gap: 10,
      padding: [10, 12, 10, 12],
      crossAlign: "min",
      ...edge("bottom"),
    },
    [
      botSigil(key, 24),
      col({ gap: 3, sizingH: "fill" }, [
        row({ gap: 6, sizingH: "fill" }, [
          t(BOTS[key].name, "bodyStrong"),
          chip(kind, { toneName, dot: true }),
          hspace(),
          t(time, "small", c.text3),
        ]),
        para(body, "small", c.text2),
        action ? row({ gap: 6, padding: [4, 0, 0, 0] }, action) : null,
      ]),
    ],
  );

const notificationsPanel = col(
  {
    name: "Notifications",
    x: 70,
    y: 430,
    width: 400,
    cornerRadius: RADIUS.panel,
    fill: c.overlay,
    clip: true,
    ...outline(c.lineStrong),
    effects: [{ type: "dropShadow", color: "#00000080", offset: [0, 12], radius: 32 }],
  },
  [
    row({ sizingH: "fill", padding: [12, 12, 12, 14], gap: 8, ...edge("bottom") }, [
      t("Notifications", "heading"),
      row({ height: 18, padding: [0, 6, 0, 6], cornerRadius: RADIUS.full, fill: c.warn }, [
        t("2", "smallStrong", c.ink),
      ]),
      hspace(),
      button("Mark all read", { kind: "ghost", size: "sm" }),
    ]),
    notice(
      "juno",
      "warn",
      "Needs a browser step",
      "The admin console asked for a code sent to your phone.",
      "08:47",
      [
        button("Open browser", { size: "sm", kind: "primary" }),
        button("Skip", { size: "sm", kind: "ghost" }),
      ],
    ),
    notice(
      "pico",
      "warn",
      "Needs approval",
      "Wants to send a chat message to Support on-call group.",
      "06:02",
      [button("Review", { size: "sm" })],
    ),
    notice("nova", "accent", "Finished", "Your brief for today is ready.", "08:00"),
    notice(
      "mika",
      "danger",
      "Failed",
      "Dashboard to notes stopped: the Notes connection needs to be signed in again.",
      "Yesterday",
      [button("Fix connection", { size: "sm" })],
    ),
    row({ sizingH: "fill", padding: [10, 14, 10, 14], gap: 8 }, [
      statusDot("info", 6),
      t("Usage limit: Codex resets at 13:00", "small", c.text2),
      hspace(),
      t("Levels are set per bot", "small", c.text3),
    ]),
  ],
);

const toast = row(
  {
    name: "UndoToast",
    x: 600,
    y: 724,
    height: 44,
    padding: [0, 8, 0, 14],
    gap: 12,
    cornerRadius: RADIUS.card,
    fill: c.overlay,
    ...outline(c.lineStrong),
    effects: [{ type: "dropShadow", color: "#00000080", offset: [0, 8], radius: 24 }],
  },
  [
    icon("trash", c.text2),
    t("Scout was deleted", "bodyStrong"),
    t("Its chats and files are kept for 30 days.", "small", c.text2),
    button("Undo", { size: "sm", iconName: "undo" }),
    iconButton("close", { size: 24 }),
  ],
);

const notifications = box(
  { name: "16 Notifications and undo", width: 1440, height: 900, clip: true },
  [
    appScreen("behind", "Chats", [
      sidebar({ active: "atlas" }),
      conversation("atlas", {
        header: { state: "idle", panel: "none" },
        tabs: { labels: ["Main", "Reorder rules", "Metrics login"], active: 0 },
        messages: atlasMessages,
      }),
    ]),
    notificationsPanel,
    toast,
  ],
);

export default [
  { name: "08 Files panel", spec: files },
  { name: "09 Bot settings panel", spec: settings },
  { name: "16 Notifications and undo", spec: notifications },
];

export { textArea };
