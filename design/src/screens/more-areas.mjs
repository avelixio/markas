// Fuel, Archive, the calendar view of Rounds, and the form for adding a key.
import { box, col, rect, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  banner,
  button,
  checkbox,
  chip,
  edge,
  field,
  hspace,
  iconButton,
  input,
  outline,
  para,
  segmented,
  statusDot,
  t,
} from "../parts.mjs";
import { appScreen, BOTS, botSigil, pageHeader } from "../shell.mjs";
import { table } from "../table.mjs";
import { c, RADIUS } from "../tokens.mjs";
import areas from "./areas.mjs";

const page = (name, rail, header, children) =>
  appScreen(name, rail, [
    col({ name: "Page", sizingH: "fill", sizingV: "fill", fill: c.app }, [
      header,
      col({ sizingH: "fill", sizingV: "fill", padding: [0, 32, 24, 32], gap: 16 }, children),
    ]),
  ]);

const botCell = (key) => row({ gap: 8 }, [botSigil(key, 18), t(BOTS[key].name, "body")]);

// ----- 22 Fuel -----

const meter = (label, left, toneFill, note) =>
  col({ gap: 5, sizingH: "fill" }, [
    row({ sizingH: "fill", gap: 8 }, [
      t(label, "small", c.text2),
      hspace(),
      t(`${left}% left`, "smallStrong", c.text),
    ]),
    box({ sizingH: "fill", width: 1, height: 6, cornerRadius: 3, fill: c.raised, clip: true }, [
      rect({ x: 0, y: 0, width: Math.round(2.7 * left), height: 6, fill: toneFill }),
    ]),
    t(note, "small", c.text3),
  ]);

const engineFuel = (name, state, toneName, children) =>
  col(
    {
      name: `fuel/${name}`,
      sizingH: "fill",
      padding: 16,
      gap: 12,
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
          [icon("terminal", c.text2)],
        ),
        t(name, "heading"),
        hspace(),
        chip(state, { toneName, dot: true }),
      ]),
      ...children,
    ],
  );

const days = [22, 31, 18, 40, 36, 12, 8, 44, 52, 38, 61, 47, 20, 74];

const fuel = page(
  "22 Fuel",
  "Fuel",
  pageHeader(
    "Fuel",
    "How much of each engine's plan is left, and which bots used it. Markas reads this from the engines; it does not bill you.",
    [segmented(["7 days", "30 days"], 0)],
  ),
  [
    row({ sizingH: "fill", gap: 12, crossAlign: "min" }, [
      engineFuel("Claude Code", "Running low", "warn", [
        meter("This 5 hours", 95, c.accent, "Resets at 21:40"),
        meter("This week", 16, c.warn, "Resets Thursday 07:00. 4 bots run on it."),
      ]),
      engineFuel("Codex", "Signed out", "warn", [
        para("Pico and Nova are held until Codex is signed in.", "small", c.text2),
        row({ gap: 8 }, [
          button("Sign in", { kind: "primary", size: "sm" }),
          button("Move them to the backup engine", { size: "sm" }),
        ]),
      ]),
    ]),
    row({ sizingH: "fill", sizingV: "fill", gap: 16, crossAlign: "min" }, [
      col(
        {
          sizingH: "fill",
          padding: 16,
          gap: 12,
          cornerRadius: RADIUS.card,
          fill: c.surface,
          ...outline(),
        },
        [
          row({ sizingH: "fill" }, [
            t("Turns per day", "heading"),
            hspace(),
            t("Today is the highest in two weeks", "small", c.text3),
          ]),
          row(
            { sizingH: "fill", height: 150, gap: 8, crossAlign: "max" },
            days.map((value, index) =>
              col(
                {
                  sizingH: "fill",
                  gap: 6,
                  crossAlign: "center",
                  mainAlign: "max",
                  sizingV: "fill",
                },
                [
                  rect({
                    width: 22,
                    height: value * 1.6,
                    cornerRadius: 3,
                    fill: index === days.length - 1 ? c.accent : c.lineStrong,
                  }),
                ],
              ),
            ),
          ),
          row({ sizingH: "fill" }, [
            t("29 Oct", "small", c.text3),
            hspace(),
            t("Today", "small", c.text2),
          ]),
        ],
      ),
      col({ width: 520, gap: 8 }, [
        table(
          [
            { label: "Bot" },
            { label: "Engine", width: 110 },
            { label: "Turns", width: 60 },
            { label: "Share", width: 130 },
          ],
          [
            ["atlas", "Claude Code", "148", 46],
            ["sol", "Claude Code", "71", 22],
            ["router", "Claude Code", "52", 16],
            ["mika", "Codex", "33", 10],
            ["juno", "Codex", "19", 6],
          ].map(([key, engine, turns, share]) => [
            botCell(key),
            t(engine, "body", c.text2),
            turns,
            row({ gap: 8 }, [
              box({ width: 70, height: 6, cornerRadius: 3, fill: c.raised, clip: true }, [
                rect({ x: 0, y: 0, width: Math.round(0.7 * share), height: 6, fill: c.accent }),
              ]),
              t(`${share}%`, "small", c.text2),
            ]),
          ]),
        ),
        row({ gap: 6 }, [
          icon("info", c.text3, 12),
          t(
            "When an engine runs out, its bots are held, or move to their backup engine if you allow it.",
            "small",
            c.text3,
          ),
        ]),
      ]),
    ]),
  ],
);

// ----- 23 Archive -----

const fileName = (iconName, name) => row({ gap: 8 }, [icon(iconName, c.text3), t(name, "body")]);
const fromYou = () =>
  row({ gap: 8 }, [
    row(
      {
        width: 18,
        height: 18,
        mainAlign: "center",
        cornerRadius: RADIUS.full,
        fill: c.raised,
        ...outline(c.lineStrong),
      },
      [t("ME", "label", c.text2, { fontSize: 7, letterSpacing: 0 })],
    ),
    t("You", "body"),
  ]);

const archive = page(
  "23 Archive",
  "Archive",
  pageHeader("Archive", "Every file you gave a bot and every file a bot made, in one place.", [
    input("Search files", { placeholder: true, iconName: "search", width: 240 }),
  ]),
  [
    row({ sizingH: "fill", gap: 8 }, [
      segmented(["All", "From you", "From bots"], 0),
      input("All bots", { iconName: "filter", trailing: icon("chevronDown", c.text3), width: 150 }),
      hspace(),
      t("38 files · 12,4 MB", "small", c.text3),
      iconButton("queue", { active: true }),
      iconButton("image"),
    ]),
    table(
      [
        { label: "Name" },
        { label: "From", width: 150 },
        { label: "In chat", width: 170 },
        { label: "Size", width: 80 },
        { label: "Added", width: 130 },
        { label: "", width: 28 },
      ],
      [
        [
          fileName("image", "stock-overview-0900.png"),
          botCell("atlas"),
          "Atlas, Main",
          "184 KB",
          "Today 09:00",
          icon("more", c.text3),
        ],
        [
          fileName("file", "stock-history.csv"),
          fromYou(),
          "Atlas, Main",
          "42 KB",
          "Today 08:58",
          icon("more", c.text3),
        ],
        [
          fileName("image", "order-88213.png"),
          botCell("juno"),
          "Juno, Order 88213",
          "96 KB",
          "Today 10:16",
          icon("more", c.text3),
        ],
        [
          fileName("file", "morning-brief.md"),
          botCell("nova"),
          "Nova, Main",
          "3 KB",
          "Today 08:00",
          icon("more", c.text3),
        ],
        [
          fileName("file", "inbox-summary.md"),
          botCell("pico"),
          "Pico, Main",
          "2 KB",
          "Today 06:02",
          icon("more", c.text3),
        ],
        [
          fileName("file", "weekly-conversion.pdf"),
          botCell("sol"),
          "Sol, Main",
          "410 KB",
          "Mon 09:04",
          icon("more", c.text3),
        ],
        [
          fileName("file", "partners.md"),
          fromYou(),
          "Dispatch, Main",
          "1 KB",
          "Sun 20:11",
          icon("more", c.text3),
        ],
      ],
      { selected: 0 },
    ),
    row({ sizingH: "fill", gap: 8 }, [
      icon("lock", c.text3, 12),
      t(
        "Files stay on this computer. Removing one here removes it from the chat it was in.",
        "small",
        c.text3,
      ),
    ]),
  ],
);

// ----- 24 Rounds, calendar -----

const WEEK = [
  [
    "Mon 9",
    [
      ["sol", "Weekly conversion", "09:00", "neutral"],
      ["nova", "Morning brief", "08:00", "accent"],
    ],
  ],
  [
    "Tue 10",
    [
      ["nova", "Morning brief", "08:00", "accent"],
      ["atlas", "Stock check", "09:00", "accent"],
      ["atlas", "Stock check", "16:00", "danger"],
    ],
  ],
  [
    "Wed 11",
    [
      ["mika", "Notes sync", "05:00", "accent"],
      ["pico", "Inbox summary", "06:00", "warn"],
      ["nova", "Morning brief", "08:00", "accent"],
      ["atlas", "Stock check", "09:00", "accent"],
      ["mika", "Dashboard to notes", "11:00", "next"],
      ["atlas", "Stock check", "16:00", "next"],
    ],
  ],
  [
    "Thu 12",
    [
      ["mika", "Notes sync", "05:00", "next"],
      ["nova", "Morning brief", "08:00", "next"],
      ["atlas", "Stock check", "09:00", "next"],
    ],
  ],
  [
    "Fri 13",
    [
      ["nova", "Morning brief", "08:00", "next"],
      ["atlas", "Stock check", "09:00", "next"],
    ],
  ],
  ["Sat 14", [["atlas", "Stock check", "09:00", "next"]]],
  ["Sun 15", [["atlas", "Stock check", "09:00", "next"]]],
];

const runChip = ([key, name, time, state]) =>
  row(
    {
      name: `run/${name}`,
      sizingH: "fill",
      gap: 6,
      padding: [5, 6, 5, 6],
      cornerRadius: RADIUS.control,
      fill: state === "next" ? "none" : c.raised,
      ...(state === "next" ? { ...outline(c.lineStrong), dashes: [3, 3] } : {}),
    },
    [
      botSigil(key, 14),
      col({ gap: 0, sizingH: "fill" }, [
        t(name, "small", state === "next" ? c.text2 : c.text, { fontSize: 11, lineHeight: 14 }),
        t(time, "small", c.text3, { fontSize: 10, lineHeight: 12 }),
      ]),
      state === "next" ? null : statusDot(state, 6),
    ],
  );

const calendar = page(
  "24 Rounds, calendar",
  "Rounds",
  pageHeader(
    "Rounds",
    "Work your bots do on a schedule. Every run ends as completed, failed with a message to you, or missed with a reason.",
    [
      segmented(["List", "Calendar"], 1),
      button("New round", { kind: "primary", iconName: "plus" }),
    ],
  ),
  [
    row({ sizingH: "fill", gap: 8 }, [
      iconButton("chevronLeft"),
      t("9 to 15 November", "heading"),
      iconButton("chevronRight"),
      button("This week", { size: "sm" }),
      hspace(),
      row({ gap: 6 }, [statusDot("accent", 6), t("Completed", "small", c.text2)]),
      row({ gap: 6 }, [statusDot("warn", 6), t("Waiting on you", "small", c.text2)]),
      row({ gap: 6 }, [statusDot("danger", 6), t("Failed", "small", c.text2)]),
      row({ gap: 6 }, [statusDot("neutral", 6), t("Missed", "small", c.text2)]),
    ]),
    row(
      {
        sizingH: "fill",
        sizingV: "fill",
        cornerRadius: RADIUS.card,
        fill: c.surface,
        clip: true,
        crossAlign: "min",
        ...outline(),
      },
      WEEK.map(([day, runs], index) =>
        col(
          {
            name: `day/${day}`,
            sizingH: "fill",
            sizingV: "fill",
            ...(index < WEEK.length - 1 ? edge("right") : {}),
            fill: index === 2 ? c.sidebar : "none",
          },
          [
            row(
              { sizingH: "fill", height: 34, padding: [0, 10, 0, 10], gap: 6, ...edge("bottom") },
              [
                t(day, "smallStrong", index === 2 ? c.accentText : c.text2),
                index === 2 ? chip("Today", { toneName: "accent" }) : null,
              ],
            ),
            col({ sizingH: "fill", padding: 8, gap: 6 }, runs.map(runChip)),
          ],
        ),
      ),
    ),
    row({ sizingH: "fill", gap: 8 }, [
      icon("clock", c.text3, 12),
      t("Dashed runs have not happened yet. Times are in your time zone.", "small", c.text3),
    ]),
  ],
);

// ----- 25 Add a key -----

const shareBot = (key, on) =>
  row(
    {
      gap: 8,
      padding: [6, 10, 6, 8],
      cornerRadius: RADIUS.control + 2,
      ...(on ? { fill: c.raised } : {}),
      ...outline(on ? c.accent : c.line),
    },
    [checkbox(on), botSigil(key, 18), t(BOTS[key].name, "body")],
  );

const keyringBehind = areas.find((area) => area.name === "12 Keyring").spec;

// Audited on 2026-11-19: one column in the order a person fills it, the website first and
// the name made from it, the bots before Save with a warning when none is picked, and the
// two-step code and the fill rule folded under More options.
const addKey = box({ name: "25 Add a key", width: 1440, height: 900, clip: true }, [
  keyringBehind,
  row({ x: 0, y: 0, width: 1440, height: 900, mainAlign: "center", fill: c.scrim }, [
    col(
      {
        name: "Dialog",
        width: 560,
        padding: 24,
        gap: 14,
        cornerRadius: RADIUS.panel,
        fill: c.surface,
        ...outline(c.lineStrong),
      },
      [
        row({ sizingH: "fill", gap: 10 }, [
          row(
            {
              width: 32,
              height: 32,
              mainAlign: "center",
              cornerRadius: RADIUS.control + 2,
              fill: c.accentSoft,
            },
            [icon("key", c.accentText)],
          ),
          col({ gap: 0, sizingH: "fill" }, [
            t("Add a key", "title"),
            t("Bots can use it. They can never read it.", "small", c.text2),
          ]),
          icon("close", c.text2),
        ]),
        segmented(["Website login", "API token", "Environment variable"], 0, { grow: true }),
        field(
          "Website",
          input("https://admin.example.com/login", { grow: true, mono: true }),
          "Only this exact site. admin.example.com and metrics.example.com are different sites.",
        ),
        row({ sizingH: "fill", gap: 12, crossAlign: "min" }, [
          field("Username", input("sam@example.com", { grow: true })),
          field(
            "Password",
            input("••••••••••••••••", { grow: true, trailing: icon("eye", c.text3) }),
          ),
        ]),
        field(
          "Name",
          input("admin.example.com", { grow: true, mono: true }),
          "Bots ask for the key by this name. It comes from the website; any name works.",
        ),
        col({ gap: 6, sizingH: "fill" }, [
          t("Which bots may use it", "smallStrong", c.text2),
          row({ gap: 8, sizingH: "fill", wrap: true, crossGap: 8 }, [
            shareBot("juno", true),
            shareBot("atlas", false),
            shareBot("mika", false),
            shareBot("pico", false),
          ]),
        ]),
        row({ sizingH: "fill", gap: 8 }, [
          icon("chevronRight", c.text2, 14),
          t("More options", "bodyStrong", c.text2),
          t("Automatic, no two-step code", "small", c.text3),
        ]),
        row({ sizingH: "fill", gap: 8 }, [
          hspace(),
          button("Cancel", { kind: "ghost" }),
          button("Save key", { kind: "primary", iconName: "lock" }),
        ]),
      ],
    ),
  ]),
]);

const keyringNoBot = box(
  { name: "25b Add a key, no bot picked", width: 1440, height: 900, clip: true },
  [
    keyringBehind,
    row({ x: 0, y: 0, width: 1440, height: 900, mainAlign: "center", fill: c.scrim }, [
      col(
        {
          name: "Dialog",
          width: 560,
          padding: 24,
          gap: 14,
          cornerRadius: RADIUS.panel,
          fill: c.surface,
          ...outline(c.lineStrong),
        },
        [
          t("Add a key", "title"),
          field("Website", input("", { grow: true, mono: true }), null),
          row({ gap: 6 }, [
            icon("warning", c.danger, 12),
            t(
              "Write the website this key is for, such as https://app.example.com.",
              "small",
              c.danger,
            ),
          ]),
          col({ gap: 6, sizingH: "fill" }, [
            t("Which bots may use it", "smallStrong", c.text2),
            row({ gap: 8, sizingH: "fill", wrap: true, crossGap: 8 }, [
              shareBot("juno", false),
              shareBot("atlas", false),
            ]),
            banner(
              "warn",
              "warning",
              "No bot can use this key yet",
              "You can save it now and share it later from the Keyring.",
            ),
          ]),
          col(
            {
              gap: 10,
              sizingH: "fill",
              padding: 12,
              cornerRadius: RADIUS.card,
              ...outline(c.line),
            },
            [
              row({ gap: 8 }, [
                icon("chevronDown", c.text2, 14),
                t("More options", "bodyStrong", c.text2),
              ]),
              field(
                "Two-step setup key",
                input("Paste the setup key from the site", {
                  placeholder: true,
                  grow: true,
                  iconName: "clock",
                }),
                "Optional. Markas then makes the 6 digit code itself.",
              ),
              field(
                "When a bot needs it",
                segmented(["Automatically", "Ask me first", "I sign in myself"], 0, { grow: true }),
                "Automatically lets rounds run with nobody at the keyboard.",
              ),
            ],
          ),
          row({ sizingH: "fill", gap: 8 }, [
            hspace(),
            button("Cancel", { kind: "ghost" }),
            button("Save key", { kind: "primary", iconName: "lock" }),
          ]),
        ],
      ),
    ]),
  ],
);

export default [
  { name: "22 Fuel", spec: fuel },
  { name: "23 Archive", spec: archive },
  { name: "24 Rounds, calendar", spec: calendar },
  { name: "25 Add a key", spec: addKey },
  { name: "25b Add a key, no bot picked", spec: keyringNoBot },
];
