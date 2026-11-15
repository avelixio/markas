// The states that finish the picture: held conversations, confirmations, empty areas,
// the new round form, and loading and error screens.
import { box, col, rect, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  banner,
  button,
  checkbox,
  chip,
  field,
  hspace,
  input,
  outline,
  para,
  radio,
  segmented,
  statusDot,
  t,
  textArea,
} from "../parts.mjs";
import {
  appScreen,
  botMessage,
  botSigil,
  conversation,
  dayMarker,
  sidebar,
  toolLine,
  userMessage,
} from "../shell.mjs";
import { c, RADIUS, SCREEN } from "../tokens.mjs";
import areas from "./areas.mjs";
import panels from "./panels.mjs";

const behind = (list, name) => list.find((item) => item.name === name).spec;

const overlay = (name, back, dialog) =>
  box({ name, width: SCREEN.width, height: SCREEN.height, clip: true }, [
    back,
    row(
      {
        x: 0,
        y: 0,
        width: SCREEN.width,
        height: SCREEN.height,
        mainAlign: "center",
        fill: c.scrim,
      },
      [dialog],
    ),
  ]);

const dialog = (width, children) =>
  col(
    {
      name: "Dialog",
      width,
      padding: 24,
      gap: 14,
      cornerRadius: RADIUS.panel,
      fill: c.surface,
      ...outline(c.lineStrong),
    },
    children,
  );

// ----- 30 Held: usage limit, and waiting on another bot -----

const heldCard = (toneName, iconName, title, body, actions) =>
  col(
    {
      name: `held/${title}`,
      sizingH: "fill",
      gap: 10,
      padding: 14,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(c.lineStrong),
    },
    [
      row({ gap: 8, sizingH: "fill" }, [
        icon(iconName, c.text2),
        t(title, "bodyStrong"),
        hspace(),
        chip("Held", { toneName, dot: true }),
      ]),
      para(body, "body", c.text2),
      row({ gap: 8, sizingH: "fill" }, actions),
    ],
  );

const held = appScreen("30 Held, usage limit and waiting on a bot", "Chats", [
  sidebar({ active: "pico" }),
  conversation("pico", {
    header: { state: "idle", panel: "none" },
    messages: [
      dayMarker("Today"),
      userMessage("12:02", "Summarise the inbox again and ask Juno whether order 88213 has moved."),
      botMessage("pico", "12:02", [
        row({ gap: 6 }, [toolLine("terminal", "chat CLI", "read 9 threads")]),
        "I read the inbox. Two things are holding the rest.",
        heldCard(
          "neutral",
          "clock",
          "Codex has no fuel left until 13:00",
          "Your Codex plan limit is reached. Pico will pick this up by itself at 13:00, or now on the backup engine.",
          [
            button("Run on the backup engine", { kind: "primary", size: "sm" }),
            button("Wait until 13:00", { size: "sm" }),
            hspace(),
            t("58 min", "small", c.text3),
          ],
        ),
        heldCard(
          "neutral",
          "team",
          "Waiting on Juno",
          "Pico asked Juno about order 88213. Juno is waiting on you for a sign-in step, so this cannot finish yet.",
          [
            button("Open Juno", { kind: "primary", size: "sm", iconName: "arrowRight" }),
            button("Stop waiting", { size: "sm" }),
            hspace(),
            t("Asked 12:02", "small", c.text3),
          ],
        ),
      ]),
    ],
    composerProps: { mode: "queue" },
  }),
]);

// ----- 31 Confirmations -----

const confirm = (iconName, toneColor, toneSoft, title, body, extra, actions) =>
  dialog(440, [
    row({ width: 40, height: 40, mainAlign: "center", cornerRadius: 12, fill: toneSoft }, [
      icon(iconName, toneColor, 20),
    ]),
    col({ gap: 6, sizingH: "fill" }, [t(title, "title"), para(body, "body", c.text2)]),
    ...extra,
    row({ sizingH: "fill", gap: 8 }, [hspace(), ...actions]),
  ]);

const confirmations = box(
  { name: "31 Confirmations", width: SCREEN.width, height: SCREEN.height, clip: true },
  [
    behind(panels, "09 Bot settings panel"),
    row(
      {
        x: 0,
        y: 0,
        width: SCREEN.width,
        height: SCREEN.height,
        mainAlign: "center",
        gap: 24,
        fill: c.scrim,
        crossAlign: "center",
      },
      [
        confirm(
          "shield",
          c.warn,
          c.warnSoft,
          "Let Atlas act without asking?",
          "Atlas will run commands, change files and use its keys with no checkpoint. Rounds already run this way for the actions you approved.",
          [
            row({ sizingH: "fill", gap: 10, crossAlign: "min" }, [
              box({ width: 16, height: 20 }, [
                box({ y: 2, width: 16, height: 16 }, [checkbox(true)]),
              ]),
              para("I understand Atlas will not stop to ask me.", "body"),
            ]),
          ],
          [button("Keep Auto", {}), button("Never ask", { kind: "danger" })],
        ),
        confirm(
          "trash",
          c.danger,
          c.dangerSoft,
          "Delete Atlas?",
          "Its chats and the files in its quarters are kept for 30 days, then removed. Its 1 round stops now, and it is taken off the 2 keys shared with it.",
          [],
          [button("Cancel", {}), button("Delete bot", { kind: "danger", iconName: "trash" })],
        ),
        confirm(
          "eye",
          c.info,
          c.infoSoft,
          "Show this password?",
          "The value of Metrics (Atlas) will be visible on your screen for 30 seconds. This is written to the logbook.",
          [
            row(
              {
                sizingH: "fill",
                height: 36,
                padding: [0, 12, 0, 12],
                gap: 8,
                cornerRadius: RADIUS.control,
                fill: c.raised,
              },
              [
                icon("lock", c.text3, 12),
                t("••••••••••••••••", "mono", c.text2),
                hspace(),
                t("hidden", "small", c.text3),
              ],
            ),
          ],
          [
            button("Cancel", {}),
            button("Show for 30 seconds", { kind: "primary", iconName: "eye" }),
          ],
        ),
      ],
    ),
  ],
);

// ----- 32 Empty states -----

const empty = (iconName, area, title, body, action, tip) =>
  col(
    {
      name: `empty/${area}`,
      sizingH: "fill",
      sizingV: "fill",
      padding: 20,
      gap: 10,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      crossAlign: "center",
      mainAlign: "center",
      ...outline(),
    },
    [
      t(area, "label", c.text3),
      row({ width: 44, height: 44, mainAlign: "center", cornerRadius: 13, fill: c.accentSoft }, [
        icon(iconName, c.accentText, 22),
      ]),
      t(title, "heading"),
      para(body, "small", c.text2, { textAlign: "center" }),
      button(action, { kind: "primary", size: "sm", iconName: "plus" }),
      para(tip, "small", c.text3, { textAlign: "center" }),
    ],
  );

const emptyStates = col(
  {
    name: "32 Empty states",
    width: SCREEN.width,
    height: SCREEN.height,
    padding: [28, 32, 28, 32],
    gap: 16,
    fill: c.app,
    clip: true,
  },
  [
    col({ gap: 4, sizingH: "fill" }, [
      t("Empty states", "title"),
      para(
        "Markas starts with nothing in it. Each empty area says what it is for, gives one action, and one way a bot can do it for you.",
        "body",
        c.text2,
      ),
    ]),
    row({ sizingH: "fill", sizingV: "fill", gap: 16 }, [
      empty(
        "routine",
        "Rounds",
        "No rounds yet",
        "A round is work a bot does on a schedule, like a check every morning.",
        "New round",
        "Or tell a bot: check this every day at 9.",
      ),
      empty(
        "key",
        "Keyring",
        "No keys yet",
        "A key is a login a bot can use but never read. Each has its own name and one exact website.",
        "Add key",
        "Or a bot will ask you for one when it needs it.",
      ),
      empty(
        "link",
        "Switchboard",
        "Nothing connected yet",
        "Connect a service once and choose which bots may use it.",
        "Add connection",
        "Markas keeps the sign-in alive for you.",
      ),
    ]),
    row({ sizingH: "fill", sizingV: "fill", gap: 16 }, [
      empty(
        "folder",
        "Archive",
        "No files yet",
        "Files you give a bot, and files bots make, are all kept here.",
        "Add a file",
        "Or drop a file into any chat.",
      ),
      empty(
        "activity",
        "Logbook",
        "Nothing recorded yet",
        "Every action that reaches a checkpoint is written here, with who did it and what happened.",
        "Learn what is recorded",
        "Message text and secret values are never written.",
      ),
      empty(
        "search",
        "Search",
        'Nothing matches "stok"',
        "No bot, message or file contains that. Check the spelling, or try fewer words.",
        "Clear search",
        "Search looks at names, messages and file names.",
      ),
    ]),
  ],
);

// ----- 33 New round -----

const day = (label, on) =>
  row(
    {
      width: 40,
      height: 30,
      mainAlign: "center",
      cornerRadius: RADIUS.control,
      fill: on ? c.accentSoft : c.raised,
      ...(on ? outline(c.accent) : {}),
    },
    [t(label, "smallStrong", on ? c.accentText : c.text2)],
  );

const approval = (text, on) =>
  row({ sizingH: "fill", gap: 10, crossAlign: "min" }, [
    box({ width: 16, height: 20 }, [box({ y: 2, width: 16, height: 16 }, [checkbox(on)])]),
    para(text, "body"),
  ]);

const newRound = overlay(
  "33 New round",
  behind(areas, "14 Rounds"),
  dialog(620, [
    row({ sizingH: "fill", gap: 10 }, [
      row(
        {
          width: 32,
          height: 32,
          mainAlign: "center",
          cornerRadius: RADIUS.control + 2,
          fill: c.accentSoft,
        },
        [icon("routine", c.accentText)],
      ),
      col({ gap: 0, sizingH: "fill" }, [
        t("New round", "title"),
        t("Work a bot does on a schedule, with nobody at the keyboard.", "small", c.text2),
      ]),
      icon("close", c.text2),
    ]),
    row({ sizingH: "fill", gap: 12, crossAlign: "min" }, [
      field("Name", input("Stock check", { grow: true })),
      field("Bot", input("Atlas", { grow: true, trailing: icon("chevronDown", c.text3) })),
    ]),
    field(
      "What should it do each time?",
      textArea(
        "Open the stock overview, read the stock level, and message Sam only if it is under 2.000 units.",
        { height: 62 },
      ),
    ),
    col({ gap: 6, sizingH: "fill" }, [
      t("When", "smallStrong", c.text2),
      row({ gap: 8 }, [
        segmented(["Every day", "Weekdays", "Every few hours", "Once"], 0),
        input("09:00, 16:00", { width: 130, iconName: "clock" }),
      ]),
      row({ gap: 6 }, [
        day("Mon", true),
        day("Tue", true),
        day("Wed", true),
        day("Thu", true),
        day("Fri", true),
        day("Sat", true),
        day("Sun", true),
      ]),
      t("Next run: today at 16:00. Times are in your time zone.", "small", c.text3),
    ]),
    col({ gap: 6, sizingH: "fill" }, [
      t("If the last run is still going", "smallStrong", c.text2),
      row({ gap: 16 }, [
        row({ gap: 8 }, [radio(true), t("Wait for it", "body")]),
        row({ gap: 8 }, [radio(false), t("Skip this one", "body")]),
      ]),
    ]),
    col({ gap: 8, sizingH: "fill", padding: 12, cornerRadius: RADIUS.card, fill: c.raised }, [
      row({ gap: 8 }, [
        icon("shield", c.warn),
        t("Approve once, so it can run alone", "bodyStrong"),
      ]),
      approval("Use the key Metrics (Atlas) on metrics.example.com", true),
      approval(
        "Send a chat message to Sam, only after a successful reading under 2.000 units",
        true,
      ),
      t("Anything else still stops at a checkpoint and waits for you.", "small", c.text3),
    ]),
    row({ sizingH: "fill", gap: 8 }, [
      button("Try it now", { iconName: "play" }),
      hspace(),
      button("Cancel", { kind: "ghost" }),
      button("Save round", { kind: "primary" }),
    ]),
  ]),
);

// ----- 34 Loading and errors -----

const bar = (width, height = 10) => rect({ width, height, cornerRadius: 4, fill: c.raised });

const skeletonRow = () =>
  row({ sizingH: "fill", gap: 10, padding: [7, 8, 7, 8] }, [
    rect({ width: 28, height: 28, cornerRadius: 8, fill: c.raised }),
    col({ gap: 6 }, [bar(90), bar(140, 8)]),
  ]);

const statePanel = (title, note, children) =>
  col(
    {
      name: `state/${title}`,
      sizingH: "fill",
      sizingV: "fill",
      padding: 16,
      gap: 10,
      cornerRadius: RADIUS.card,
      fill: c.sidebar,
      ...outline(),
    },
    [
      col({ gap: 2, sizingH: "fill" }, [t(title, "heading"), para(note, "small", c.text2)]),
      ...children,
    ],
  );

const loading = col(
  {
    name: "34 Loading and errors",
    width: SCREEN.width,
    height: SCREEN.height,
    padding: [28, 32, 28, 32],
    gap: 16,
    fill: c.app,
    clip: true,
  },
  [
    col({ gap: 4, sizingH: "fill" }, [
      t("Loading and errors", "title"),
      para(
        "Nothing spins without saying what it is waiting for, and every error says what happened and what to do next.",
        "body",
        c.text2,
      ),
    ]),
    row({ sizingH: "fill", sizingV: "fill", gap: 16 }, [
      statePanel("Starting up", "Shown for the first second or two while the host answers.", [
        skeletonRow(),
        skeletonRow(),
        skeletonRow(),
        row({ gap: 8, padding: [8, 8, 0, 8] }, [
          statusDot("info", 8),
          t("Starting your engines: Claude Code ready, Codex checking", "small", c.text2),
        ]),
      ]),
      statePanel("A bot is thinking", "The first reply has not arrived yet.", [
        row({ gap: 12, crossAlign: "min", padding: [8, 0, 0, 0] }, [
          botSigil("atlas", 24),
          col({ gap: 8 }, [
            row({ gap: 8 }, [
              t("Atlas", "bodyStrong"),
              chip("Working", { toneName: "info", dot: true }),
            ]),
            bar(260),
            bar(200),
            row({ gap: 8 }, [
              t("Opening the stock overview", "small", c.text2),
              t("12 s", "mono", c.text3, { fontSize: 11 }),
            ]),
            button("Stop", { size: "sm", kind: "ghost", iconName: "stop" }),
          ]),
        ]),
      ]),
      statePanel("A message did not send", "Kept in place, never lost, never sent twice.", [
        col(
          {
            sizingH: "fill",
            gap: 8,
            padding: 12,
            cornerRadius: RADIUS.card,
            fill: c.surface,
            ...outline(c.danger),
          },
          [
            para("Compare today's stock with the same hour yesterday.", "body"),
            row({ gap: 8, sizingH: "fill" }, [
              icon("warning", c.danger, 12),
              t("Not delivered: Atlas's engine stopped.", "small", c.danger),
              hspace(),
            ]),
            row({ gap: 8 }, [
              button("Send again", { size: "sm", kind: "primary", iconName: "refresh" }),
              button("Edit", { size: "sm" }),
              button("Discard", { size: "sm", kind: "ghost" }),
            ]),
          ],
        ),
      ]),
    ]),
    row({ sizingH: "fill", sizingV: "fill", gap: 16 }, [
      statePanel(
        "An engine will not start",
        "The bot is held, the rest of the crew keeps working.",
        [
          banner(
            "danger",
            "terminal",
            "Codex stopped three times in a row",
            "Pico and Nova are held. Their queued messages are safe.",
            [],
          ),
          row({ gap: 8 }, [
            button("Try again", { size: "sm", kind: "primary" }),
            button("Move them to the backup engine", { size: "sm" }),
            button("Show details", { size: "sm", kind: "ghost" }),
          ]),
        ],
      ),
      statePanel(
        "A round failed",
        "You are told why. The person the round reports to is not messaged with a wrong result.",
        [
          banner(
            "danger",
            "routine",
            "Stock check failed at 09:00",
            "The dashboard returned an empty tile, so there was no figure to report. Sam was not messaged.",
            [],
          ),
          row({ gap: 8 }, [
            button("Run it now", { size: "sm", kind: "primary", iconName: "play" }),
            button("Open the run", { size: "sm" }),
          ]),
        ],
      ),
      statePanel("The keyring will not open", "Bots keep working without saved keys.", [
        banner(
          "warn",
          "key",
          "The keyring could not be opened",
          "Markas could not read its master key from this computer's keychain. Your keys are still stored and still encrypted.",
          [],
        ),
        row({ gap: 8 }, [
          button("Try again", { size: "sm", kind: "primary" }),
          button("What to check", { size: "sm" }),
        ]),
      ]),
    ]),
  ],
);

export default [
  { name: "30 Held, usage limit and waiting on a bot", spec: held },
  { name: "31 Confirmations", spec: confirmations },
  { name: "32 Empty states", spec: emptyStates },
  { name: "33 New round", spec: newRound },
  { name: "34 Loading and errors", spec: loading },
];
