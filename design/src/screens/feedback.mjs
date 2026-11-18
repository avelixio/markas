// 42 Send feedback: a bug or an idea, from the account menu or Settings. The person sees every
// detail that goes with the report, and picks how it leaves: on GitHub with their own account,
// or sent directly without one. Either way it becomes a public GitHub issue, and the dialog says so.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  banner,
  button,
  checkbox,
  field,
  hspace,
  input,
  outline,
  para,
  segmented,
  t,
  textArea,
} from "../parts.mjs";
import { c, RADIUS } from "../tokens.mjs";
import states from "./states.mjs";

const settingsBehind = states.find((screen) => screen.name === "20 App settings").spec;

const header = (title, lead, iconName = "chat") =>
  row({ sizingH: "fill", gap: 10 }, [
    row(
      {
        width: 32,
        height: 32,
        mainAlign: "center",
        cornerRadius: RADIUS.control + 2,
        fill: c.accentSoft,
      },
      [icon(iconName, c.accentText)],
    ),
    col({ gap: 0, sizingH: "fill" }, [t(title, "title"), t(lead, "small", c.text2)]),
    icon("close", c.text2),
  ]);

const detail = (label, value) =>
  row({ sizingH: "fill", gap: 12 }, [
    box({ width: 120, height: 16 }, [t(label, "small", c.text3)]),
    t(value, "mono", c.text2),
  ]);

const dialog = (name, children, width = 600) =>
  box({ name, width: 1440, height: 900, clip: true }, [
    settingsBehind,
    row({ x: 0, y: 0, width: 1440, height: 900, mainAlign: "center", fill: c.scrim }, [
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
      ),
    ]),
  ]);

const form = dialog("42 Send feedback", [
  header("Send feedback", "A bug, or an idea for Markas."),
  segmented(["Something is wrong", "An idea"], 0, { grow: true }),
  field("Title", input("Rounds skip a day after the clock changes", { grow: true })),
  field(
    "What happened",
    textArea(
      "My Monday round did not run after the clock moved to winter time. It ran again on Tuesday.",
      { height: 112 },
    ),
    "What you did, what you expected, and what happened instead. Leave out passwords and private details.",
  ),
  col({ sizingH: "fill", gap: 8, padding: 12, cornerRadius: RADIUS.card, ...outline(c.line) }, [
    row({ gap: 8 }, [checkbox(true), t("Add these details about this computer", "bodyStrong")]),
    detail("Markas", "0.1.2"),
    detail("System", "Windows 11, x64"),
    detail("Engines", "Claude Code 2.1.322, OpenCode 1.14.20"),
    para("No chats, files, keys or account names are added.", "small", c.text3),
  ]),
  banner(
    "info",
    "globe",
    "Reports are public",
    "Either way, this becomes an issue anyone can read on github.com/avelixio/markas.",
  ),
  row({ sizingH: "fill", gap: 8 }, [
    button("Cancel", { kind: "ghost" }),
    hspace(),
    button("Open on GitHub", { iconName: "external" }),
    button("Send directly", { kind: "primary", iconName: "send" }),
  ]),
  para(
    "Open on GitHub uses your GitHub account and lets you edit it there. Send directly needs no account.",
    "small",
    c.text3,
  ),
]);

const sent = dialog(
  "42b Feedback sent",
  [
    header("Thank you", "Your report is on GitHub.", "check"),
    para(
      "Issue #42 was opened. Follow it there to see the answer; nobody can reply to you in Markas.",
      "body",
      c.text2,
    ),
    row({ sizingH: "fill", gap: 8 }, [
      hspace(),
      button("Close", { kind: "ghost" }),
      button("See it on GitHub", { kind: "primary", iconName: "external" }),
    ]),
  ],
  480,
);

export default [
  { name: "42 Send feedback", spec: form },
  { name: "42b Feedback sent", spec: sent },
];
