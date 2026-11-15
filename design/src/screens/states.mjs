// Status system, the "needs an answer" and "needs sign-in" moments, the empty workspace a new
// person starts from, and the app settings.
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
  kbd,
  outline,
  para,
  segmented,
  settingRow,
  sigil,
  statusDot,
  t,
  toggle,
  vspace,
} from "../parts.mjs";
import {
  appScreen,
  botMessage,
  botSigil,
  conversation,
  dayMarker,
  pageHeader,
  sidebar,
  toolLine,
  userMessage,
} from "../shell.mjs";
import { c, RADIUS, SIZE } from "../tokens.mjs";
import { dispatchCentre } from "./setup-bots.mjs";

// ----- 17 Status system -----

const STATUSES = [
  ["neutral", "Idle", "Nothing running. Ready for a message.", "Last message preview", null],
  [
    "info",
    "Working",
    "A turn is running. New messages queue or steer.",
    "Working: what it is doing",
    "Stop",
  ],
  ["info", "Queued", "Messages are waiting behind the running turn.", "3 waiting", "Open queue"],
  [
    "warn",
    "Needs an answer",
    "The bot asked you a question and cannot go on without it.",
    "Waiting on you: a question",
    "Answer",
  ],
  [
    "warn",
    "Needs approval",
    "An action that matters is stopped at a checkpoint.",
    "Waiting on you: approve a send",
    "Review",
  ],
  [
    "warn",
    "Needs a browser step",
    "A site wants a phone code or a CAPTCHA. Only you can do it.",
    "Waiting on you: finish a sign-in step",
    "Open browser",
  ],
  [
    "warn",
    "Needs sign-in",
    "The engine or a saved login is signed out.",
    "Waiting on you: sign in to Codex",
    "Sign in",
  ],
  [
    "neutral",
    "Held: usage limit",
    "The engine's plan limit is reached. Work resumes at the reset.",
    "Held until 13:00",
    "Use backup engine",
  ],
  [
    "neutral",
    "Held: waiting on a bot",
    "It delegated work and waits for the reply.",
    "Waiting on Juno",
    "Open task",
  ],
  ["neutral", "Paused", "You paused this bot's queue.", "Queue paused", "Resume"],
  [
    "danger",
    "Failed",
    "The last turn or round ended in an error. You were told why.",
    "Failed: reason in one line",
    "Retry",
  ],
  [
    "danger",
    "Engine unavailable",
    "The engine is not installed or stopped repeatedly.",
    "Engine unavailable",
    "Fix",
  ],
];

const statusRow = ([toneName, label, meaning, preview, action], index) =>
  row(
    {
      name: `status-row/${label}`,
      sizingH: "fill",
      gap: 16,
      padding: [10, 16, 10, 16],
      ...(index < STATUSES.length - 1 ? edge("bottom") : {}),
    },
    [
      row({ width: 200 }, [chip(label, { toneName, dot: true })]),
      row({ sizingH: "fill" }, [para(meaning, "body", c.text2)]),
      row({ width: 280, gap: 8 }, [
        sigil(
          index % 8,
          ["mint", "amber", "coral", "sky", "violet", "rose", "lime", "sand"][index % 8],
          24,
        ),
        col({ gap: 0 }, [
          row({ gap: 6 }, [
            t("Bot name", "bodyStrong"),
            toneName === "neutral" ? null : statusDot(toneName, 6),
          ]),
          t(
            preview,
            "small",
            toneName === "warn" ? c.warn : toneName === "danger" ? c.danger : c.text2,
          ),
        ]),
      ]),
      row({ width: 150 }, [
        action
          ? button(action, { size: "sm", kind: toneName === "warn" ? "primary" : "secondary" })
          : t("None", "small", c.text3),
      ]),
    ],
  );

const statusSheet = appScreen("17 Status system", "Chats", [
  col({ sizingH: "fill", sizingV: "fill", fill: c.app }, [
    pageHeader(
      "Bot statuses",
      "Every state a bot can be in, what it means, how it shows in the sidebar, and the one action that moves it on. Amber always means the bot is waiting for you.",
    ),
    col({ sizingH: "fill", padding: [0, 32, 24, 32], gap: 12 }, [
      col(
        { sizingH: "fill", cornerRadius: RADIUS.card, fill: c.surface, clip: true, ...outline() },
        [
          row(
            {
              sizingH: "fill",
              height: 34,
              gap: 16,
              padding: [0, 16, 0, 16],
              fill: c.sidebar,
              ...edge("bottom"),
            },
            [
              row({ width: 200 }, [t("Status", "label", c.text3)]),
              row({ sizingH: "fill" }, [t("Meaning", "label", c.text3)]),
              row({ width: 280 }, [t("In the sidebar", "label", c.text3)]),
              row({ width: 150 }, [t("Your action", "label", c.text3)]),
            ],
          ),
          ...STATUSES.map(statusRow),
        ],
      ),
      row({ sizingH: "fill", gap: 16 }, [
        row({ gap: 6 }, [
          statusDot("info", 8),
          t("Blue: busy, nothing needed from you", "small", c.text2),
        ]),
        row({ gap: 6 }, [statusDot("warn", 8), t("Amber: waiting for you", "small", c.text2)]),
        row({ gap: 6 }, [statusDot("danger", 8), t("Coral: something broke", "small", c.text2)]),
        row({ gap: 6 }, [
          statusDot("neutral", 8),
          t("Grey: held or idle, will move on by itself", "small", c.text2),
        ]),
      ]),
    ]),
  ]),
]);

// ----- 18 Needs an answer, needs sign-in -----

const option = (letter, label, help, on) =>
  row(
    {
      sizingH: "fill",
      gap: 10,
      padding: [8, 10, 8, 10],
      cornerRadius: RADIUS.control + 2,
      crossAlign: "min",
      ...(on ? { fill: c.raised } : {}),
      ...outline(on ? c.accent : c.line),
    },
    [
      row(
        {
          width: 22,
          height: 22,
          mainAlign: "center",
          cornerRadius: 6,
          fill: on ? c.accent : c.raised,
        },
        [t(letter, "smallStrong", on ? c.onAccent : c.text2)],
      ),
      col({ gap: 1, sizingH: "fill" }, [t(label, "bodyStrong"), para(help, "small", c.text2)]),
    ],
  );

const questionCard = col(
  {
    name: "QuestionCard",
    sizingH: "fill",
    gap: 10,
    padding: 14,
    cornerRadius: RADIUS.card,
    fill: c.surface,
    ...outline(c.warn),
  },
  [
    row({ gap: 8, sizingH: "fill" }, [
      icon("chat", c.warn),
      t("Atlas needs an answer to continue", "bodyStrong"),
      hspace(),
      t("Question 1 of 1", "small", c.text3),
    ]),
    para("The dashboard shows two stock figures. Which one is the reorder line based on?", "body"),
    option("A", "Available stock", "3.410 units. Excludes reserved items.", true),
    option("B", "Total stock", "3.960 units. Includes reserved items.", false),
    input("C   Something else: type your own answer", { placeholder: true, grow: true }),
    row({ gap: 8, sizingH: "fill" }, [
      button("Answer", { kind: "primary", iconName: "check" }),
      button("Skip, let Atlas decide", { kind: "ghost" }),
      hspace(),
      t("Remembered for next time in Atlas's memory", "small", c.text3),
    ]),
  ],
);

const signInCard = col(
  {
    name: "SignInCard",
    sizingH: "fill",
    gap: 10,
    padding: 14,
    cornerRadius: RADIUS.card,
    fill: c.warnSoft,
  },
  [
    row({ gap: 8, sizingH: "fill" }, [
      icon("lock", c.warn),
      t("Codex is signed out", "bodyStrong"),
      hspace(),
      chip("2 bots held", { toneName: "warn", dot: true }),
    ]),
    para(
      "Pico and Nova run on Codex and are held until it is signed in. Sign in opens Codex's own login; Markas never sees the password.",
      "body",
    ),
    row({ gap: 8, sizingH: "fill" }, [
      button("Sign in to Codex", { kind: "primary", iconName: "external" }),
      button("Run on the backup engine", {}),
      button("Later", { kind: "ghost" }),
    ]),
  ],
);

const needsYou = appScreen("18 Needs an answer, needs sign-in", "Chats", [
  sidebar({ active: "atlas" }),
  conversation("atlas", {
    header: { state: "waiting", panel: "none" },
    tabs: { labels: ["Main", "Reorder rules"], active: 0 },
    messages: [
      dayMarker("Today"),
      signInCard,
      userMessage("15:58", "Run the stock check and use the reorder rule."),
      botMessage("atlas", "15:59", [
        row({ gap: 6 }, [toolLine("globe", "Browser", "4 steps")]),
        "I can read the dashboard, but I need one thing from you first.",
        questionCard,
      ]),
    ],
  }),
]);

// ----- 19 Empty workspace -----

const emptySidebar = col(
  {
    name: "Sidebar/empty",
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
    row({ sizingH: "fill", padding: [10, 8, 4, 8] }, [t("Crew", "label", c.text3)]),
    col({ sizingH: "fill", gap: 8, padding: [12, 8, 12, 8], crossAlign: "center" }, [
      row(
        { gap: 6 },
        [sigil(1, "mint", 22), sigil(4, "amber", 22), sigil(3, "violet", 22)].map((tile) =>
          box({ width: 22, height: 22, opacity: 0.35 }, [tile]),
        ),
      ),
      para("No bots yet. Your crew will be listed here.", "small", c.text3, {
        textAlign: "center",
      }),
    ]),
    vspace(),
    row({ sizingH: "fill", gap: 8, padding: [8, 8, 0, 8], ...edge("top") }, [
      statusDot("accent", 6),
      t("Host running", "small", c.text2),
      hspace(),
      t("1 engine ready", "small", c.text3),
    ]),
  ],
);

const emptyWorkspace = appScreen(
  "19 Empty workspace",
  "Chats",
  [
    emptySidebar,
    col(
      { sizingH: "fill", sizingV: "fill", fill: c.app, crossAlign: "center", mainAlign: "center" },
      [col({ width: 760, gap: 16, crossAlign: "center" }, dispatchCentre())],
    ),
  ],
  { alerts: 0 },
);

// ----- 20 App settings -----

const settingsNav = (active) =>
  col(
    {
      name: "SettingsNav",
      width: 220,
      sizingV: "fill",
      padding: [24, 12, 12, 12],
      gap: 2,
      fill: c.sidebar,
      ...edge("right"),
    },
    [
      row({ padding: [0, 8, 10, 8] }, [t("Settings", "title")]),
      ...[
        ["terminal", "Engines"],
        ["sliders", "General"],
        ["bell", "Notifications"],
        ["shield", "Permissions"],
        ["download", "Data"],
        ["info", "About"],
      ].map(([name, label]) =>
        row(
          {
            sizingH: "fill",
            height: 32,
            padding: [0, 8, 0, 8],
            gap: 8,
            cornerRadius: RADIUS.control,
            fill: label === active ? c.raised : "none",
          },
          [
            icon(name, label === active ? c.accentText : c.text2),
            t(label, label === active ? "bodyStrong" : "body", label === active ? c.text : c.text2),
          ],
        ),
      ),
    ],
  );

const engineCard = (name, detail, toneName, state, action) =>
  row(
    {
      sizingH: "fill",
      gap: 12,
      padding: 14,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(),
    },
    [
      row(
        {
          width: 36,
          height: 36,
          mainAlign: "center",
          cornerRadius: RADIUS.control + 2,
          fill: c.raised,
        },
        [icon("terminal", c.text2)],
      ),
      col({ gap: 2, sizingH: "fill" }, [t(name, "bodyStrong"), para(detail, "small", c.text2)]),
      chip(state, { toneName, dot: true }),
      button(action, { size: "sm", kind: toneName === "warn" ? "primary" : "secondary" }),
    ],
  );

const group = (label, children) =>
  col({ sizingH: "fill", gap: 4 }, [t(label, "label", c.text3), ...children]);

const appSettings = appScreen("20 App settings", "Chats", [
  settingsNav("Engines"),
  col({ sizingH: "fill", sizingV: "fill", fill: c.app, crossAlign: "center" }, [
    col({ sizingH: "fill", sizingV: "fill", maxWidth: 820, padding: [28, 32, 24, 32], gap: 22 }, [
      col({ gap: 4, sizingH: "fill" }, [
        t("Engines", "title"),
        para(
          "The command-line tools your bots run on. Each one uses its own sign-in.",
          "body",
          c.text2,
        ),
      ]),
      col({ sizingH: "fill", gap: 8 }, [
        engineCard(
          "Claude Code",
          "2.1.322 · you@example.com · 4 bots",
          "accent",
          "Signed in",
          "Sign out",
        ),
        engineCard("Codex", "0.144.1 · 2 bots held", "warn", "Signed out", "Sign in"),
      ]),
      group("Defaults for new bots", [
        settingRow(
          "Engine",
          "Used when you do not pick one.",
          chip("Claude Code", { iconName: "terminal" }),
        ),
        divider(),
        settingRow(
          "Backup engine",
          "Takes over when the first hits its usage limit.",
          chip("Codex", { iconName: "terminal" }),
        ),
        divider(),
        settingRow(
          "Permission level",
          "New bots start here. You can change it per bot.",
          segmented(["Ask first", "Auto", "Never ask"], 0),
        ),
        divider(),
        settingRow("While busy, new messages", null, segmented(["Queue", "Steer"], 0)),
      ]),
      group("This computer", [
        settingRow(
          "Keep this computer awake",
          "Rounds run on time while it is plugged in. The screen can still turn off.",
          toggle(true),
        ),
        divider(),
        settingRow(
          "Tell me about",
          "Everything, only what is waiting on you, or nothing.",
          segmented(["Everything", "Waiting on you", "Nothing"], 1),
        ),
        divider(),
        settingRow("Start Markas at login", "Keeps rounds running after a restart.", toggle(true)),
        divider(),
        settingRow("Appearance", null, segmented(["Dark", "Light", "System"], 0)),
        divider(),
        settingRow(
          "Host address",
          "Only reachable from this computer.",
          t("127.0.0.1:4780", "mono", c.text2),
        ),
      ]),
    ]),
  ]),
]);

export default [
  { name: "17 Status system", spec: statusSheet },
  { name: "18 Needs an answer, needs sign-in", spec: needsYou },
  { name: "19 Empty workspace", spec: emptyWorkspace },
  { name: "20 App settings", spec: appSettings },
];

export { botSigil };
