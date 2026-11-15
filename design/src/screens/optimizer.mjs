// The Optimizer, and the deleted bots that can still be put back.
import { box, col, rect, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  button,
  chip,
  divider,
  hspace,
  iconButton,
  outline,
  para,
  settingRow,
  t,
  toggle,
  vspace,
} from "../parts.mjs";
import { appScreen, BOTS, botSigil, pageHeader } from "../shell.mjs";
import { table } from "../table.mjs";
import { c, RADIUS } from "../tokens.mjs";

const page = (name, rail, header, children) =>
  appScreen(name, rail, [
    col({ name: "Page", sizingH: "fill", sizingV: "fill", fill: c.app }, [
      header,
      col({ sizingH: "fill", sizingV: "fill", padding: [0, 32, 24, 32], gap: 14 }, children),
    ]),
  ]);

const botCell = (key) => row({ gap: 8 }, [botSigil(key, 18), t(BOTS[key].name, "body")]);

// ----- 42 Optimizer -----

/** One thing that saves tokens: what it does, whether it is on, and what it saved. */
const saver = (iconName, title, control, body, stat, extra = []) =>
  col(
    {
      name: `saver/${title}`,
      sizingH: "fill",
      padding: 14,
      gap: 8,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(),
    },
    [
      row({ sizingH: "fill", gap: 10 }, [
        row(
          {
            width: 28,
            height: 28,
            mainAlign: "center",
            cornerRadius: RADIUS.control + 2,
            fill: c.raised,
          },
          [icon(iconName, c.text2)],
        ),
        t(title, "bodyStrong"),
        hspace(),
        control,
      ]),
      para(body, "small", c.text2),
      ...extra,
      t(stat, "smallStrong", c.text),
    ],
  );

/** How full one bot's conversation is. Amber from 80 percent. */
const contextRow = (key, engine, percent, figure, folding = false) =>
  col({ name: `context/${key}`, sizingH: "fill", gap: 5 }, [
    row({ sizingH: "fill", gap: 8 }, [
      botSigil(key, 18),
      t(BOTS[key].name, "bodyStrong"),
      t(engine, "small", c.text3),
      folding ? chip("Folding", { toneName: "accent" }) : null,
      hspace(),
      t(figure, "small", c.text2),
    ]),
    box({ sizingH: "fill", width: 1, height: 6, cornerRadius: 3, fill: c.raised, clip: true }, [
      rect({
        x: 0,
        y: 0,
        width: Math.round(5.6 * percent),
        height: 6,
        fill: percent >= 80 ? c.warn : c.accent,
      }),
    ]),
  ]);

const optimizer = page(
  "42 Optimizer",
  "Optimizer",
  pageHeader(
    "Optimizer",
    "What keeps your bots' conversations small, how full each one is, and how many tokens that saved.",
    [button("Read again", { iconName: "refresh" })],
  ),
  [
    row(
      {
        name: "total",
        sizingH: "fill",
        padding: 16,
        gap: 14,
        crossAlign: "max",
        cornerRadius: RADIUS.card,
        fill: c.surface,
        ...outline(),
      },
      [
        t("1,284,600", "title", c.accentText),
        col({ gap: 2, sizingH: "fill" }, [
          t("tokens saved since Nov 3, 2026", "body"),
          t(
            "1,120,000 counted by the engines · about 164,600 worked out from text that was left out",
            "small",
            c.text3,
          ),
        ]),
      ],
    ),
    t("What saves tokens", "label", c.text3),
    row({ sizingH: "fill", gap: 12, crossAlign: "min" }, [
      saver(
        "zap",
        "Automatic compact",
        toggle(true),
        "A conversation near the end of what the model can hold is folded into a summary. Claude Code folds its own; for Codex, Markas asks at the point you choose.",
        "9 folds · 1,120,000 tokens",
        [
          row({ gap: 8 }, [
            t("Fold a Codex conversation when it is", "small", c.text2),
            chip("80% full", { iconName: "chevronDown" }),
          ]),
        ],
      ),
      saver(
        "file",
        "Shorter tool output",
        chip("Always on", { toneName: "accent" }),
        "A web page longer than 80,000 characters is cut before the bot reads it, and the bot is told to scroll for more. A rough figure.",
        "14 pages cut · about 164,600 tokens",
      ),
    ]),
    row({ sizingH: "fill", gap: 12, crossAlign: "min" }, [
      saver(
        "pencil",
        "Lean way of working",
        toggle(false),
        "Tells every bot to do the smallest thing that fully answers you, to read only what it needs, and to answer briefly.",
        "Not counted: nobody can measure what a bot did not write.",
      ),
      saver(
        "terminal",
        "Command output filter (rtk)",
        chip("Not used by Markas yet"),
        "An outside tool that shortens the output of shell commands before a model reads it. Markas only checks whether it is on this computer.",
        "Not on this computer.",
      ),
    ]),
    row({ sizingH: "fill", sizingV: "fill", gap: 16, crossAlign: "min" }, [
      col(
        {
          name: "context",
          sizingH: "fill",
          padding: 16,
          gap: 12,
          cornerRadius: RADIUS.card,
          fill: c.surface,
          ...outline(),
        },
        [
          t("How full each conversation is", "heading"),
          contextRow("atlas", "Claude Code", 57, "57% used · 571.9k / 1M"),
          contextRow("sol", "Claude Code", 6, "6% used · 55.3k / 1M"),
          contextRow("juno", "Codex", 84, "84% used · 228.5k / 272k", true),
          contextRow("mika", "Codex", 0, "Not reported yet. It shows after the bot's next answer."),
        ],
      ),
      col({ width: 500, gap: 8 }, [
        table(
          [
            { label: "Time", width: 120 },
            { label: "Bot" },
            { label: "How", width: 130 },
            { label: "Tokens saved", width: 90 },
          ],
          [
            ["Nov 14, 09:12", botCell("juno"), "Conversation folded", "186,400"],
            ["Nov 14, 08:40", botCell("atlas"), "Long page cut", "~12,100"],
            ["Nov 13, 17:05", botCell("atlas"), "Conversation folded", "341,000"],
            ["Nov 13, 11:31", botCell("mika"), "Long page cut", "~9,800"],
          ],
        ),
        row({ gap: 6 }, [
          icon("info", c.text3, 12),
          t(
            "Markas keeps only these numbers. It never stores the text that was folded or cut.",
            "small",
            c.text3,
          ),
        ]),
      ]),
    ]),
  ],
);

// ----- 43 Deleted bots -----

const deletedRow = (key, when, actions) =>
  settingRow(BOTS[key].name, when, row({ gap: 8 }, actions));

const deletedBots = page(
  "43 Deleted bots and undo",
  "Chats",
  pageHeader("Settings", "Markas itself: its language, what new bots start with, this computer."),
  [
    col({ sizingH: "fill", maxWidth: 820, gap: 4 }, [
      t("Deleted bots", "label", c.text3),
      para(
        "A deleted bot waits here for 30 days with everything it had: its messages, keys, rounds and sign-ins. After that it is removed for good.",
        "small",
        c.text2,
      ),
      deletedRow("pico", "Deleted Nov 14, 2026. Removed for good on Dec 14, 2026.", [
        button("Restore", { iconName: "undo", size: "sm" }),
        button("Delete forever", { iconName: "trash", size: "sm", kind: "ghost" }),
      ]),
      divider(),
      deletedRow(
        "nova",
        "This removes its messages, keys, rounds and sign-ins now. It cannot be undone.",
        [
          button("Yes, delete forever", { size: "sm", kind: "danger" }),
          button("Cancel", { size: "sm", kind: "ghost" }),
        ],
      ),
    ]),
    vspace(),
    row({ sizingH: "fill", mainAlign: "center" }, [
      row(
        {
          name: "UndoNotice",
          padding: [10, 12, 10, 14],
          gap: 12,
          cornerRadius: RADIUS.card,
          fill: c.raised,
          ...outline(c.lineStrong),
        },
        [
          col({ gap: 2 }, [
            t("Pico was deleted", "bodyStrong"),
            t("It can be put back from Settings for 30 days.", "small", c.text2),
          ]),
          button("Undo", { size: "sm" }),
          iconButton("close"),
        ],
      ),
    ]),
  ],
);

export default [
  { name: "42 Optimizer", spec: optimizer },
  { name: "43 Deleted bots and undo", spec: deletedBots },
];
