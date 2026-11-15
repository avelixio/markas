// Create a bot: describe it in one sentence, then review what the router drafted.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  banner,
  button,
  chip,
  field,
  hspace,
  input,
  outline,
  para,
  sigil,
  t,
  textArea,
} from "../parts.mjs";
import { appScreen, sidebar } from "../shell.mjs";
import { c, RADIUS, SIGIL_COLORS } from "../tokens.mjs";
import { stepCounter } from "./onboarding.mjs";

const scrimmed = (name, dialog) =>
  box({ name, width: 1440, height: 900, clip: true }, [
    appScreen("behind", "Chats", [
      sidebar({ active: "none" }),
      col({ sizingH: "fill", sizingV: "fill", fill: c.app }, []),
    ]),
    row({ x: 0, y: 0, width: 1440, height: 900, mainAlign: "center", fill: c.scrim }, [dialog]),
  ]);

const dialog = (children) =>
  col(
    {
      name: "Dialog",
      width: 640,
      padding: 28,
      gap: 18,
      cornerRadius: RADIUS.panel,
      fill: c.surface,
      ...outline(c.lineStrong),
    },
    children,
  );

const sigilPicker = (activePattern, activeColor) =>
  col({ gap: 10, sizingH: "fill" }, [
    row(
      { gap: 8 },
      Array.from({ length: 8 }, (_, pattern) =>
        row(
          {
            width: 40,
            height: 40,
            mainAlign: "center",
            cornerRadius: 12,
            ...(pattern === activePattern ? outline(c.accent) : {}),
            strokeWeight: 2,
          },
          [sigil(pattern, activeColor, 30)],
        ),
      ),
    ),
    row(
      { gap: 8 },
      SIGIL_COLORS.map((color) =>
        row(
          {
            width: 26,
            height: 26,
            mainAlign: "center",
            cornerRadius: 999,
            ...(color === activeColor ? outline(c.text) : {}),
            strokeWeight: 2,
          },
          [box({ width: 18, height: 18, cornerRadius: 999, fill: { $var: `sigil/${color}` } })],
        ),
      ),
    ),
  ]);

const describe = scrimmed(
  "03 Create bot, describe",
  dialog([
    row({ sizingH: "fill" }, [stepCounter(1, 2, "Describe"), hspace(), icon("close", c.text2)]),
    row({ gap: 14, sizingH: "fill" }, [
      sigil(1, "coral", 56),
      col({ gap: 4, sizingH: "fill" }, [
        t("New bot", "title"),
        para(
          "Say what it should help with. Markas drafts the rest for you to review.",
          "body",
          c.text2,
        ),
      ]),
    ]),
    field("Name", input("Scout", { grow: true })),
    field("Sigil and colour", sigilPicker(1, "coral")),
    field(
      "What should this bot help with?",
      textArea(
        "Watch our public status pages every morning and tell me if any partner reports an incident.",
        { height: 76 },
      ),
      "One sentence is enough.",
    ),
    row({ gap: 6, sizingH: "fill", wrap: true }, [
      chip("Check a dashboard on a schedule", { iconName: "sparkle" }),
      chip("Summarise an inbox", { iconName: "sparkle" }),
      chip("Investigate a ticket", { iconName: "sparkle" }),
    ]),
    field(
      "Engine",
      input("Claude Code · Sonnet", {
        grow: true,
        iconName: "terminal",
        trailing: icon("chevronDown", c.text3),
      }),
      "Backup engine: Codex. Used when the first one hits its limit.",
    ),
    row({ sizingH: "fill", gap: 8 }, [
      button("Cancel", { kind: "ghost" }),
      hspace(),
      button("Draft this bot", { kind: "primary", iconName: "sparkle" }),
    ]),
  ]),
);

const draftBlock = (label, body, { tall = false } = {}) =>
  col({ gap: 6, sizingH: "fill" }, [
    row({ sizingH: "fill", gap: 6 }, [
      t(label, "smallStrong", c.text2),
      hspace(),
      chip("Drafted", { toneName: "accent", iconName: "sparkle" }),
      icon("pencil", c.text3, 12),
    ]),
    textArea(body, { height: tall ? 148 : 56 }),
  ]);

const review = scrimmed(
  "04 Create bot, review",
  dialog([
    row({ sizingH: "fill" }, [
      stepCounter(2, 2, "Review the draft"),
      hspace(),
      icon("close", c.text2),
    ]),
    row({ gap: 14, sizingH: "fill" }, [
      sigil(1, "coral", 56),
      col({ gap: 4, sizingH: "fill" }, [
        t("Scout", "title"),
        para(
          "Drafted by Dispatch from your sentence. Edit anything before you save.",
          "body",
          c.text2,
        ),
      ]),
    ]),
    draftBlock("Role", "Partner status sol"),
    draftBlock(
      "Instructions",
      "Each morning, open the status page of every partner in partners.md. Read the current state and any incident posted in the last 24 hours. Reply with one line per partner that is not fully operational, with the incident title and start time. If every partner is operational, say so in one line. Never sign in anywhere; these pages are public.",
      { tall: true },
    ),
    banner(
      "info",
      "routine",
      "Suggested round: every day at 08:30",
      "You can add it now or later. Rounds run with the approvals you grant once.",
      [button("Add", { size: "sm" })],
    ),
    row({ sizingH: "fill", gap: 8 }, [
      button("Back", { kind: "ghost", iconName: "chevronLeft" }),
      hspace(),
      button("Draft again", { iconName: "refresh" }),
      button("Create bot", { kind: "primary" }),
    ]),
  ]),
);

export default [
  { name: "03 Create bot, describe", spec: describe },
  { name: "04 Create bot, review", spec: review },
];
