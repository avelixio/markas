// The island and the beacon: Markas's presence outside its own window.
// The island is a small always-on-top pill that grows when something needs the person.
// The beacon is the resting form of the same thing: one tile whose colour says how the team is.
import { box, col, ellipse, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  button,
  chip,
  edge,
  hspace,
  iconButton,
  outline,
  para,
  sigil,
  statusDot,
  t,
} from "../parts.mjs";
import { botSigil } from "../shell.mjs";
import { c, RADIUS, SCREEN } from "../tokens.mjs";

const shadow = {
  effects: [{ type: "dropShadow", color: "#00000099", offset: [0, 10], radius: 28 }],
};

const pill = (name, children, extra = {}) =>
  row(
    {
      name: `signal/${name}`,
      height: 40,
      padding: [0, 14, 0, 8],
      gap: 10,
      cornerRadius: RADIUS.full,
      fill: c.overlay,
      ...outline(c.lineStrong),
      ...shadow,
      ...extra,
    },
    children,
  );

const mark = (toneFill = c.accent, size = 24) =>
  row(
    {
      name: "beacon-mark",
      width: size,
      height: size,
      mainAlign: "center",
      cornerRadius: Math.round(size * 0.3),
      fill: toneFill,
    },
    [icon("logo", c.onAccent, Math.round(size * 0.62))],
  );

const stack = (keys) =>
  box(
    { width: 16 + (keys.length - 1) * 11, height: 16 },
    keys.map((key, index) =>
      box({ x: index * 11, y: 0, width: 16, height: 16 }, [botSigil(key, 16)]),
    ),
  );

const islandCard = (name, toneStroke, children) =>
  col(
    {
      name: `signal/${name}`,
      width: 400,
      padding: 14,
      gap: 10,
      cornerRadius: 20,
      fill: c.overlay,
      ...outline(toneStroke),
      ...shadow,
    },
    children,
  );

const example = (label, note, node) =>
  col({ name: `example/${label}`, gap: 10, sizingH: "fill" }, [
    col({ gap: 2, sizingH: "fill" }, [t(label, "bodyStrong"), para(note, "small", c.text2)]),
    node,
  ]);

const digestRow = (key, toneName, textValue) =>
  row({ sizingH: "fill", gap: 8 }, [
    botSigil(key, 18),
    para(textValue, "small", c.text),
    statusDot(toneName, 6),
  ]);

const islandStates = [
  example(
    "Resting",
    "Nothing needs you. One line of what the crew is doing.",
    pill("resting", [
      mark(),
      stack(["atlas", "pico"]),
      t("2 bots working", "smallStrong"),
      t("next round 16:00", "small", c.text3),
    ]),
  ),
  example(
    "Finished",
    "Shows for a few seconds, then folds back.",
    pill("finished", [
      mark(),
      botSigil("nova", 18),
      t("Nova finished your brief", "smallStrong"),
      button("Open", { size: "sm" }),
    ]),
  ),
  example(
    "Waiting on you",
    "Grows into a card with the one action. Stays until answered or snoozed.",
    islandCard("needs-you", c.warn, [
      row({ gap: 8, sizingH: "fill" }, [
        mark(c.warn),
        botSigil("juno", 20),
        t("Juno needs you", "bodyStrong"),
        hspace(),
        t("2 min", "small", c.text3),
      ]),
      para("The admin console asked for a code sent to your phone.", "small", c.text2),
      row({ gap: 8, sizingH: "fill" }, [
        button("Open browser", { kind: "primary", size: "sm", iconName: "external" }),
        button("Snooze 10 min", { size: "sm" }),
        hspace(),
        chip("1 more", { toneName: "warn" }),
      ]),
    ]),
  ),
  example(
    "Disconnected",
    "The window lost the host. Says so at once and keeps trying.",
    islandCard("disconnected", c.danger, [
      row({ gap: 8, sizingH: "fill" }, [
        mark(c.danger),
        t("Markas is disconnected", "bodyStrong"),
        hspace(),
        chip("Retrying in 8 s", { toneName: "danger", dot: true }),
      ]),
      para(
        "Your bots may still be running on the host. Rounds continue; this window just cannot see them.",
        "small",
        c.text2,
      ),
      row({ gap: 8, sizingH: "fill" }, [
        button("Reconnect now", { kind: "primary", size: "sm", iconName: "refresh" }),
        button("Host status", { size: "sm" }),
      ]),
    ]),
  ),
  example(
    "While you were away",
    "Shown once when you come back after being idle.",
    islandCard("away", c.lineStrong, [
      row({ gap: 8, sizingH: "fill" }, [
        mark(),
        t("While you were away", "bodyStrong"),
        hspace(),
        t("1 h 40 min", "small", c.text3),
      ]),
      digestRow("juno", "warn", "Juno is waiting for a phone code"),
      digestRow("atlas", "accent", "Atlas finished the 09:00 stock check"),
      digestRow("mika", "danger", "Mika's sync failed: Notes is signed out"),
      row({ gap: 8, sizingH: "fill" }, [
        button("Review all", { kind: "primary", size: "sm" }),
        button("Dismiss", { kind: "ghost", size: "sm" }),
      ]),
    ]),
  ),
  example(
    "Held",
    "A plan limit is reached. No action needed unless you want the backup engine.",
    pill("held", [
      mark(c.lineStrong),
      t("Codex resets at 13:00", "smallStrong"),
      t("2 bots held", "small", c.text3),
      button("Use backup", { size: "sm" }),
    ]),
  ),
];

const beacon = (label, note, fill, badge, { dashed = false, dim = false } = {}) =>
  col({ name: `beacon/${label}`, width: 128, gap: 8, crossAlign: "center" }, [
    box({ width: 64, height: 64 }, [
      row(
        {
          x: 4,
          y: 4,
          width: 56,
          height: 56,
          mainAlign: "center",
          cornerRadius: 17,
          fill,
          opacity: dim ? 0.5 : 1,
          ...(dashed ? { ...outline(c.text3), dashes: [4, 4], strokeWeight: 1.5 } : {}),
          ...shadow,
        },
        [icon("logo", dashed ? c.text3 : c.onAccent, 30)],
      ),
      badge ? box({ x: 42, y: 0, width: 22, height: 22 }, [badge]) : null,
    ]),
    t(label, "bodyStrong"),
    para(note, "small", c.text2, { textAlign: "center" }),
  ]);

const countBadge = (value, fill) =>
  row(
    {
      width: 22,
      height: 22,
      mainAlign: "center",
      cornerRadius: RADIUS.full,
      fill,
      ...outline(c.app),
      strokeWeight: 2,
    },
    [t(String(value), "smallStrong", c.ink, { fontSize: 11, lineHeight: 12 })],
  );

const iconBadge = (name, fill) =>
  row(
    {
      width: 22,
      height: 22,
      mainAlign: "center",
      cornerRadius: RADIUS.full,
      fill,
      ...outline(c.app),
      strokeWeight: 2,
    },
    [icon(name, c.ink, 12)],
  );

const beacons = row({ gap: 12, sizingH: "fill", crossAlign: "min" }, [
  beacon("All quiet", "Mint. Nothing running, nothing waiting.", c.accent, null),
  beacon("Working", "Blue badge counts running bots.", c.accent, countBadge(2, c.info)),
  beacon("Waiting on you", "Amber, with how many are waiting.", c.warn, countBadge(1, c.warn)),
  beacon(
    "Something failed",
    "Coral until you have seen it.",
    c.danger,
    iconBadge("warning", c.danger),
  ),
  beacon(
    "Disconnected",
    "Hollow outline: this window cannot reach the host.",
    "none",
    iconBadge("refresh", c.lineStrong),
    { dashed: true },
  ),
  beacon(
    "You are away",
    "Dims after 5 idle minutes and collects a digest.",
    c.accent,
    iconBadge("clock", c.lineStrong),
    { dim: true },
  ),
]);

const desktopHint = col(
  {
    name: "Placement",
    sizingH: "fill",
    height: 250,
    cornerRadius: RADIUS.card,
    fill: c.sidebar,
    clip: true,
    ...outline(),
  },
  [
    row(
      {
        sizingH: "fill",
        height: 26,
        padding: [0, 10, 0, 10],
        gap: 6,
        fill: c.raised,
        ...edge("bottom"),
      },
      [
        ellipse({ width: 8, height: 8, fill: c.lineStrong }),
        ellipse({ width: 8, height: 8, fill: c.lineStrong }),
        ellipse({ width: 8, height: 8, fill: c.lineStrong }),
        hspace(),
        t("Any other app", "small", c.text3),
        hspace(),
      ],
    ),
    box({ sizingH: "fill", sizingV: "fill", width: 1, height: 1 }, [
      box({ x: 168, y: 12, width: 1, height: 1 }, [
        pill("placed", [mark(), stack(["atlas", "pico"]), t("2 bots working", "smallStrong")]),
      ]),
      // The beacon tucked into the screen edge: a strip that carries the crew's colour.
      box({ x: 424, y: 40, width: 5, height: 120, cornerRadius: 3, fill: c.warn }),
      box({ x: 330, y: 130, width: 1, height: 1 }, [
        row(
          { width: 56, height: 56, mainAlign: "center", cornerRadius: 17, fill: c.warn, ...shadow },
          [icon("logo", c.onAccent, 30)],
        ),
      ]),
      box({ x: 368, y: 124, width: 22, height: 22 }, [countBadge(1, c.warn)]),
    ]),
  ],
);

const spec = row(
  {
    name: "21 Signal and beacon",
    width: SCREEN.width,
    height: SCREEN.height,
    fill: c.app,
    clip: true,
    padding: [28, 32, 24, 32],
    gap: 32,
    crossAlign: "min",
  },
  [
    col({ width: 440, gap: 16, sizingV: "fill" }, [
      col({ gap: 4, sizingH: "fill" }, [
        t("The signal", "title"),
        para(
          "A small always-on-top strip that stays out of the way and grows only when something needs you.",
          "body",
          c.text2,
        ),
      ]),
      ...islandStates.slice(0, 3),
      islandStates[5],
    ]),
    col({ width: 440, gap: 16, sizingV: "fill" }, [
      box({ width: 1, height: 52 }),
      islandStates[3],
      islandStates[4],
    ]),
    col({ sizingH: "fill", gap: 16, sizingV: "fill" }, [
      col({ gap: 4, sizingH: "fill" }, [
        t("The beacon", "title"),
        para(
          "The signal folded down to one tile. Its colour is the state of the whole crew, so a glance is enough.",
          "body",
          c.text2,
        ),
      ]),
      col({ gap: 12, sizingH: "fill" }, [
        row({ gap: 12, sizingH: "fill", crossAlign: "min" }, beacons.children.slice(0, 3)),
        row({ gap: 12, sizingH: "fill", crossAlign: "min" }, beacons.children.slice(3)),
      ]),
      t("Where they sit", "label", c.text3),
      desktopHint,
      row({ gap: 6, sizingH: "fill", crossAlign: "min" }, [
        icon("info", c.text3, 12),
        para(
          "Drag either anywhere. Parked at a screen edge, the beacon tucks into a thin strip that turns amber when a bot is waiting on you. Both can be turned off in Settings.",
          "small",
          c.text3,
        ),
      ]),
    ]),
  ],
);

export default { name: "21 Signal and beacon", spec };

export { iconButton, sigil };
