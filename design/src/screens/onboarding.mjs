// First run: connect engines, then one consent. A step counter runs through both.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import { banner, button, checkbox, chip, divider, hspace, outline, para, t } from "../parts.mjs";
import { c, RADIUS, SCREEN } from "../tokens.mjs";

/** A centred stage for flows that happen before the app shell exists. */
export const stage = (name, children) =>
  col(
    {
      name,
      width: SCREEN.width,
      height: SCREEN.height,
      crossAlign: "center",
      mainAlign: "center",
      gap: 20,
      fill: c.app,
      clip: true,
    },
    children,
  );

export const stepCounter = (current, total, label) =>
  row({ name: "StepCounter", gap: 10 }, [
    row(
      { gap: 4 },
      Array.from({ length: total }, (_, index) =>
        box({
          width: 28,
          height: 4,
          cornerRadius: 2,
          fill: index < current ? c.accent : c.lineStrong,
        }),
      ),
    ),
    t(`Step ${current} of ${total}`, "smallStrong", c.text2),
    t(label, "small", c.text3),
  ]);

export const brand = () =>
  row({ gap: 10 }, [
    row({ width: 32, height: 32, mainAlign: "center", cornerRadius: 9, fill: c.accent }, [
      icon("logo", c.onAccent, 18),
    ]),
    t("Markas", "title"),
  ]);

function engineRow(name, detail, state) {
  const states = {
    ready: [
      chip("Signed in", { toneName: "accent", iconName: "check" }),
      button("Sign out", { kind: "ghost", size: "sm" }),
    ],
    signin: [
      chip("Not signed in", { toneName: "warn", dot: true }),
      button("Sign in", { kind: "primary", size: "sm" }),
    ],
    installing: [
      chip("Installing", { toneName: "info", dot: true }),
      button("Cancel", { kind: "ghost", size: "sm" }),
    ],
    missing: [chip("Not installed"), button("Install", { size: "sm", iconName: "download" })],
    waiting: [
      chip("Waiting for you to sign in", { toneName: "info", dot: true }),
      button("Open login again", { kind: "ghost", size: "sm", iconName: "external" }),
    ],
  };
  return row({ name: `engine/${name}`, sizingH: "fill", gap: 12, padding: [12, 0, 12, 0] }, [
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
    ...states[state],
  ]);
}

const STEPS = 7;

/** A full-screen setup step with the brand and step counter pinned to the top. */
export const setupStage = (name, step, label, children, { width = 760 } = {}) =>
  col(
    {
      name,
      width: SCREEN.width,
      height: SCREEN.height,
      crossAlign: "center",
      fill: c.app,
      clip: true,
    },
    [
      row({ name: "SetupTop", sizingH: "fill", padding: [24, 32, 0, 32], gap: 16 }, [
        brand(),
        hspace(),
        stepCounter(step, STEPS, label),
      ]),
      col(
        {
          name: "SetupBody",
          width,
          sizingV: "fill",
          padding: [24, 0, 24, 0],
          gap: 16,
          crossAlign: "center",
          mainAlign: "center",
        },
        children,
      ),
    ],
  );

export const panel = (children) =>
  col(
    {
      name: "Panel",
      width: 600,
      padding: 28,
      gap: 16,
      cornerRadius: RADIUS.panel,
      fill: c.surface,
      ...outline(),
    },
    children,
  );

const engines = setupStage("01 First run, engines", 2, "Connect your engines", [
  panel([
    col({ gap: 6, sizingH: "fill" }, [
      t("Connect the engines your bots will run on", "title"),
      para(
        "Markas drives the command-line tools you already have, on your own sign-in. It never asks for or stores their passwords.",
        "body",
        c.text2,
      ),
    ]),
    col({ sizingH: "fill" }, [
      engineRow("Claude Code", "Version 2.1.322 · you@example.com", "ready"),
      divider(),
      engineRow("Codex", "Version 0.144.1. Finish the login in your browser.", "waiting"),
    ]),
    banner(
      "info",
      "info",
      "One signed-in engine is enough to start",
      "Continue unlocks once one engine is ready. You can add the other one later from Settings.",
    ),
    row({ sizingH: "fill", gap: 8 }, [
      button("Check again", { kind: "ghost", iconName: "refresh" }),
      hspace(),
      button("Continue", { kind: "primary", iconName: "arrowRight" }),
    ]),
  ]),
]);

const point = (iconName, title, body) =>
  row({ sizingH: "fill", gap: 12, crossAlign: "min" }, [
    row(
      {
        width: 28,
        height: 28,
        mainAlign: "center",
        cornerRadius: RADIUS.control,
        fill: c.warnSoft,
      },
      [icon(iconName, c.warn)],
    ),
    col({ gap: 2, sizingH: "fill" }, [t(title, "bodyStrong"), para(body, "small", c.text2)]),
  ]);

const consent = setupStage("02 First run, consent", 4, "Understand the risk", [
  panel([
    col({ gap: 6, sizingH: "fill" }, [
      t("Bots act on this computer for you", "title"),
      para("Read this once. You can tighten what each bot may do at any time.", "body", c.text2),
    ]),
    col({ gap: 14, sizingH: "fill" }, [
      point(
        "terminal",
        "They can read and change files and run commands",
        "A bot works inside its own folder by default, and can reach more when you allow it.",
      ),
      point(
        "globe",
        "They can use the web in their own browser",
        "Each bot browses in a separate Chrome profile. Passwords are typed in by Markas, never shown to the bot.",
      ),
      point(
        "shield",
        "Actions that matter stop for your approval",
        "Sending messages, sharing a login and changing a bot's permissions ask you first.",
      ),
    ]),
    divider(),
    row({ sizingH: "fill", gap: 10, crossAlign: "min" }, [
      box({ width: 16, height: 20 }, [box({ y: 2, width: 16, height: 16 }, [checkbox(true)])]),
      para(
        "I understand that bots can act on my computer and accounts, and I will only run tasks I trust.",
        "body",
      ),
    ]),
    row({ sizingH: "fill", gap: 8 }, [
      button("Back", { kind: "ghost", iconName: "chevronLeft" }),
      hspace(),
      t("Nothing is sent to Markas. There is no telemetry.", "small", c.text3),
      button("Continue", { kind: "primary", iconName: "arrowRight" }),
    ]),
  ]),
]);

export default [
  { name: "01 First run, engines", spec: engines },
  { name: "02 First run, consent", spec: consent },
];
