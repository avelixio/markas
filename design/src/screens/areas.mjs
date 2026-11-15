// Full-page areas reached from the rail: Routines, Vault, Connections and Activity.
import { col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  banner,
  button,
  chip,
  edge,
  hspace,
  input,
  outline,
  para,
  segmented,
  statusDot,
  t,
  toggle,
} from "../parts.mjs";
import { appScreen, BOTS, botSigil, pageHeader } from "../shell.mjs";
import { table } from "../table.mjs";
import { c, RADIUS } from "../tokens.mjs";

const page = (name, rail, header, children) =>
  appScreen(name, rail, [
    col({ name: "Page", sizingH: "fill", sizingV: "fill", fill: c.app }, [
      header,
      col({ sizingH: "fill", sizingV: "fill", padding: [0, 32, 24, 32], gap: 16 }, children),
    ]),
  ]);

const botCell = (key) => row({ gap: 8 }, [botSigil(key, 18), t(BOTS[key].name, "body")]);
const bots = (keys) =>
  row(
    { gap: 4 },
    keys.map((key) => botSigil(key, 18)),
  );
const mono = (value, color = c.text2) => t(value, "mono", color);

// ----- Routines -----

const lastRun = (toneName, label) =>
  row({ gap: 6 }, [
    statusDot(toneName, 6),
    t(label, "body", toneName === "danger" ? c.danger : c.text),
  ]);

const runRow = (toneName, label, when, detail) =>
  row({ sizingH: "fill", gap: 10, padding: [8, 0, 8, 0], crossAlign: "min", ...edge("bottom") }, [
    row({ width: 16, height: 20, mainAlign: "center" }, [statusDot(toneName, 8)]),
    col({ gap: 1, sizingH: "fill" }, [
      row({ gap: 8, sizingH: "fill" }, [
        t(label, "bodyStrong"),
        hspace(),
        t(when, "small", c.text3),
      ]),
      para(detail, "small", c.text2),
    ]),
  ]);

const routines = page(
  "14 Rounds",
  "Rounds",
  pageHeader(
    "Rounds",
    "Work your bots do on a schedule. Every run ends as completed, failed with a message to you, or missed with a reason.",
    [
      input("All bots", { iconName: "filter", trailing: icon("chevronDown", c.text3), width: 150 }),
      button("New round", { kind: "primary", iconName: "plus" }),
    ],
  ),
  [
    row({ sizingH: "fill", sizingV: "fill", gap: 16, crossAlign: "min" }, [
      col({ sizingH: "fill", gap: 12 }, [
        table(
          [
            { label: "Round" },
            { label: "Bot", width: 130 },
            { label: "Schedule", width: 170 },
            { label: "Next run", width: 110 },
            { label: "Last run", width: 150 },
            { label: "On", width: 40 },
          ],
          [
            [
              "Stock check",
              botCell("atlas"),
              mono("0 9,16 * * *"),
              "Today 16:00",
              lastRun("accent", "Completed 09:00"),
              toggle(true),
            ],
            [
              "Memory sync",
              botCell("mika"),
              mono("0 5 * * *"),
              "Tomorrow 05:00",
              lastRun("accent", "Completed 05:00"),
              toggle(true),
            ],
            [
              "Dashboard to notes",
              botCell("mika"),
              mono("0 11 * * *"),
              "Today 11:00",
              lastRun("danger", "Failed yesterday"),
              toggle(true),
            ],
            [
              "Inbox summary",
              botCell("pico"),
              mono("0 */6 * * *"),
              "Today 12:00",
              lastRun("warn", "Waiting for you"),
              toggle(true),
            ],
            [
              "Morning brief",
              botCell("nova"),
              mono("0 8 * * 1-5"),
              "Tomorrow 08:00",
              lastRun("accent", "Completed 08:00"),
              toggle(true),
            ],
            [
              "Weekly conversion",
              botCell("sol"),
              mono("0 9 * * 1"),
              "Mon 09:00",
              lastRun("neutral", "Missed Monday"),
              toggle(false),
            ],
          ],
          { selected: 0 },
        ),
        row({ sizingH: "fill", gap: 8 }, [
          icon("clock", c.text3, 12),
          t(
            "Times are in your time zone. A run missed by 12 hours or less runs once when the computer wakes.",
            "small",
            c.text3,
          ),
        ]),
      ]),
      col(
        {
          name: "RunHistory",
          width: 360,
          padding: 16,
          gap: 10,
          cornerRadius: RADIUS.card,
          fill: c.surface,
          ...outline(),
        },
        [
          row({ sizingH: "fill", gap: 8 }, [
            botSigil("atlas", 24),
            col({ gap: 0, sizingH: "fill" }, [
              t("Stock check", "heading"),
              t("Every day at 09:00 and 16:00", "small", c.text2),
            ]),
            button("Run now", { size: "sm", iconName: "play" }),
          ]),
          col(
            { gap: 6, sizingH: "fill", padding: 10, cornerRadius: RADIUS.control, fill: c.raised },
            [
              t("Standing approvals", "label", c.text3),
              row({ gap: 6, sizingH: "fill" }, [
                icon("check", c.accentText, 12),
                para(
                  "Send a chat message to Sam, only after a successful reading under 2.000 units.",
                  "small",
                  c.text,
                ),
              ]),
            ],
          ),
          t("Run history", "label", c.text3),
          runRow("accent", "Completed", "Today 09:00", "Read 3.410 units. No alert sent."),
          runRow("accent", "Completed", "Yesterday 16:00", "Read 2.870 units. No alert sent."),
          runRow(
            "danger",
            "Failed",
            "Yesterday 09:00",
            "The dashboard returned an empty tile. You were messaged instead of Sam.",
          ),
          runRow(
            "neutral",
            "Missed",
            "Sat 16:00",
            "The computer was asleep for more than 12 hours.",
          ),
        ],
      ),
    ]),
  ],
);

// ----- Vault -----

const kind = (label, iconName) => chip(label, { iconName });

const vault = page(
  "12 Keyring",
  "Keyring",
  pageHeader(
    "Keyring",
    "Logins and secrets your bots can use but never read. Values stay out of chats, model input and the logbook.",
    [
      input("Search keys", { placeholder: true, iconName: "search", width: 220 }),
      button("Add key", { kind: "primary", iconName: "plus" }),
    ],
  ),
  [
    banner(
      "accent",
      "lock",
      "The keyring is locked to this computer",
      "The master key lives in the system keychain. Each key is bound to one exact site, so two logins on sibling hosts never mix.",
    ),
    table(
      [
        { label: "Name" },
        { label: "Kind", width: 130 },
        { label: "Bound to", width: 290 },
        { label: "Shared with", width: 120 },
        { label: "Fills", width: 110 },
        { label: "Last used", width: 110 },
        { label: "", width: 28 },
      ],
      [
        [
          "Metrics (Atlas)",
          kind("Login", "user"),
          mono("https://metrics.example.com"),
          bots(["atlas", "sol"]),
          "Automatic",
          "Today 09:00",
          icon("more", c.text3),
        ],
        [
          "Metrics (ops)",
          kind("Login", "user"),
          mono("https://metrics.ops.example.com"),
          bots(["juno"]),
          "Ask me",
          "Never",
          icon("more", c.text3),
        ],
        [
          "Admin console (Juno)",
          kind("Login", "user"),
          mono("https://admin.example.com"),
          bots(["juno"]),
          "Automatic",
          "Today 08:45",
          icon("more", c.text3),
        ],
        [
          "Admin console code",
          kind("One-time code", "clock"),
          mono("https://admin.example.com"),
          bots(["juno"]),
          "Hand-off only",
          "Never",
          icon("more", c.text3),
        ],
        [
          "chat-cli",
          kind("Command variable", "terminal"),
          mono("CHAT_TOKEN"),
          bots(["pico", "atlas"]),
          "At start",
          "Today 06:00",
          icon("more", c.text3),
        ],
        [
          "Gateway key",
          kind("Bearer", "key"),
          mono("https://gateway.example.com"),
          bots(["mika", "juno"]),
          "Automatic",
          "Today 05:00",
          icon("more", c.text3),
        ],
      ],
      { selected: 0 },
    ),
    row({ sizingH: "fill", gap: 8 }, [
      icon("eye", c.text3, 12),
      t("Showing a value asks you to confirm and is written to the logbook.", "small", c.text3),
      hspace(),
      t("6 keys · 2 logins share the name of a parent site and stay separate", "small", c.text3),
    ]),
  ],
);

// ----- Connections -----

const connection = (name, detail, toneName, state, keys) =>
  col(
    {
      name: `connection/${name}`,
      sizingH: "fill",
      padding: 14,
      gap: 10,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(),
    },
    [
      row({ sizingH: "fill", gap: 10 }, [
        row(
          {
            width: 32,
            height: 32,
            mainAlign: "center",
            cornerRadius: RADIUS.control + 2,
            fill: c.raised,
          },
          [icon("link", c.text2)],
        ),
        col({ gap: 0, sizingH: "fill" }, [t(name, "bodyStrong"), t(detail, "small", c.text2)]),
        chip(state, { toneName, dot: true }),
      ]),
      row({ sizingH: "fill", gap: 8 }, [
        t("Granted to", "small", c.text3),
        bots(keys),
        hspace(),
        button(toneName === "danger" ? "Sign in again" : "Manage", {
          size: "sm",
          kind: toneName === "danger" ? "primary" : "secondary",
        }),
      ]),
    ],
  );

const health = (name, profile, toneName, state, checked, keys) => [
  row({ gap: 8 }, [icon("globe", c.text3), t(name, "body")]),
  chip(profile, { iconName: "user" }),
  row({ gap: 6 }, [
    statusDot(toneName, 6),
    t(state, "body", toneName === "danger" ? c.danger : toneName === "warn" ? c.warn : c.text),
  ]),
  checked,
  bots(keys),
];

const connections = page(
  "15 Switchboard and login health",
  "Switchboard",
  pageHeader("Switchboard", "The outside services and sign-ins Markas keeps alive for your bots.", [
    button("Add connection", { kind: "primary", iconName: "plus" }),
  ]),
  [
    t("Services", "label", c.text3),
    row({ sizingH: "fill", gap: 12, crossAlign: "min" }, [
      connection("Notes", "Pages and databases · token refreshes itself", "danger", "Signed out", [
        "mika",
        "nova",
      ]),
      connection("Calendar", "Read events", "accent", "Connected", ["nova"]),
      connection("Insights", "Reports and funnels", "accent", "Connected", ["atlas", "sol"]),
    ]),
    row({ sizingH: "fill", gap: 8, padding: [8, 0, 0, 0] }, [
      t("Browser logins", "label", c.text3),
      hspace(),
      t("Checked every few hours during work hours", "small", c.text3),
    ]),
    table(
      [
        { label: "Site" },
        { label: "Browser profile", width: 200 },
        { label: "State", width: 200 },
        { label: "Last checked", width: 140 },
        { label: "Used by", width: 100 },
      ],
      [
        health("metrics.example.com", "analytics", "accent", "Signed in", "Today 08:30", [
          "atlas",
          "sol",
        ]),
        health("insights.example.com", "analytics", "accent", "Signed in", "Today 08:30", [
          "atlas",
          "sol",
        ]),
        health("admin.example.com", "Juno (private)", "warn", "Needs a phone code", "Today 08:45", [
          "juno",
        ]),
      ],
    ),
    banner(
      "warn",
      "pointer",
      "One login needs you",
      "Juno's admin console session asks for a code sent to your phone. Markas does not bypass this; finish it once in Juno's browser.",
      [button("Open browser", { size: "sm" })],
    ),
  ],
);

// ----- Activity -----

const outcome = (toneName, label) => chip(label, { toneName, dot: true });
const actor = (iconName, label) =>
  row({ gap: 6 }, [icon(iconName, c.text3, 12), t(label, "body", c.text2)]);

const activity = page(
  "13 Logbook",
  "Logbook",
  pageHeader(
    "Logbook",
    "The permanent record of every action that reached a checkpoint. It holds who, what and the outcome, never message text or secret values.",
    [button("Export NDJSON", { iconName: "download" })],
  ),
  [
    row({ sizingH: "fill", gap: 8 }, [
      input("All bots", { iconName: "filter", trailing: icon("chevronDown", c.text3), width: 150 }),
      input("All actions", { trailing: icon("chevronDown", c.text3), width: 150 }),
      segmented(["All", "Approved", "Denied", "Failed"], 0),
      hspace(),
      input("Last 7 days", {
        iconName: "calendar",
        trailing: icon("chevronDown", c.text3),
        width: 160,
      }),
    ]),
    table(
      [
        { label: "Time", width: 120 },
        { label: "Bot", width: 130 },
        { label: "Started by", width: 130 },
        { label: "Action" },
        { label: "Target", width: 280 },
        { label: "Outcome", width: 120 },
      ],
      [
        [
          mono("Today 09:00:14"),
          botCell("atlas"),
          actor("routine", "Round"),
          "Browser: read page",
          mono("metrics.example.com"),
          outcome("accent", "Allowed"),
        ],
        [
          mono("Today 09:00:05"),
          botCell("atlas"),
          actor("routine", "Round"),
          "Keyring: fill login",
          mono("Metrics (Atlas)"),
          outcome("accent", "Allowed"),
        ],
        [
          mono("Today 08:45:31"),
          botCell("juno"),
          actor("user", "You"),
          "Browser: takeover requested",
          mono("admin.example.com"),
          outcome("warn", "Waiting"),
        ],
        [
          mono("Today 06:02:10"),
          botCell("pico"),
          actor("routine", "Round"),
          "Chat: send message",
          mono("Support on-call group"),
          outcome("warn", "Asked you"),
        ],
        [
          mono("Today 06:00:41"),
          botCell("pico"),
          actor("user", "You"),
          "Keyring: key created",
          mono("chat-cli"),
          outcome("accent", "Approved by you"),
        ],
        [
          mono("Yest. 22:17:03"),
          botCell("mika"),
          actor("zap", "Webhook"),
          "Browser: open new site",
          mono("pastebin.example"),
          outcome("danger", "Denied"),
        ],
        [
          mono("Yest. 16:00:09"),
          botCell("atlas"),
          actor("routine", "Round"),
          "Chat: send message",
          mono("Sam"),
          outcome("neutral", "Not needed"),
        ],
        [
          mono("Yest. 11:00:02"),
          botCell("mika"),
          actor("routine", "Round"),
          "Notes: write page",
          mono("Dashboard daily"),
          outcome("danger", "Failed"),
        ],
      ],
    ),
    row({ sizingH: "fill", gap: 8 }, [
      icon("lock", c.text3, 12),
      t(
        "Rows cannot be edited. They are removed only after the 365 day retention window.",
        "small",
        c.text3,
      ),
      hspace(),
      t("1 to 8 of 1.204", "small", c.text3),
    ]),
  ],
);

export default [
  { name: "12 Keyring", spec: vault },
  { name: "13 Logbook", spec: activity },
  { name: "14 Rounds", spec: routines },
  { name: "15 Switchboard and login health", spec: connections },
];

export { para };
