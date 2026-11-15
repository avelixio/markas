// The foundations sheet: colour, type, icons, sigils and core components on one frame.
import { box, col, row } from "../../tools/dsl.mjs";
import { ICONS, icon } from "../icons.mjs";
import {
  banner,
  button,
  checkbox,
  chip,
  input,
  outline,
  para,
  radio,
  segmented,
  sigil,
  t,
  toggle,
} from "../parts.mjs";
import { COLORS, c, RADIUS, SIGIL_COLORS, SPACE, TYPE } from "../tokens.mjs";

const section = (title, note, children) =>
  col({ name: `Section/${title}`, sizingH: "fill", gap: 16 }, [
    col({ gap: 4, sizingH: "fill" }, [
      t(title, "title"),
      note ? para(note, "body", c.text2) : null,
    ]),
    ...children,
  ]);

const swatch = (name) =>
  col({ name: `swatch/${name}`, width: 196, gap: 6 }, [
    box({
      width: 196,
      height: 44,
      cornerRadius: RADIUS.control,
      fill: { $var: name },
      ...outline(c.lineStrong),
    }),
    t(name, "smallStrong"),
    t(`${COLORS[name][0]} · ${COLORS[name][1]}`, "mono", c.text3, { fontSize: 10, lineHeight: 14 }),
  ]);

const swatchGroup = (prefix) =>
  row(
    { gap: 12, sizingH: "fill", wrap: true, crossGap: 14, crossAlign: "min" },
    Object.keys(COLORS)
      .filter((name) => name.startsWith(prefix))
      .map(swatch),
  );

const typeRow = (name, sample) =>
  row({ sizingH: "fill", gap: 24, padding: [8, 0, 8, 0] }, [
    row({ width: 120 }, [t(name, "smallStrong", c.text2)]),
    row({ width: 190 }, [
      t(
        `${TYPE[name].fontFamily} ${TYPE[name].fontStyle} ${TYPE[name].fontSize}/${TYPE[name].lineHeight}`,
        "mono",
        c.text3,
        { fontSize: 11 },
      ),
    ]),
    t(sample, name),
  ]);

const iconTile = (name) =>
  col(
    {
      name: `icon-tile/${name}`,
      width: 84,
      gap: 6,
      crossAlign: "center",
      padding: [10, 0, 8, 0],
      cornerRadius: RADIUS.control,
      fill: c.surface,
    },
    [icon(name, c.text, 16), t(name, "small", c.text3, { fontSize: 10, lineHeight: 12 })],
  );

const spec = col({ name: "Foundations", width: 1440, padding: 56, gap: 48, fill: c.app }, [
  col({ gap: 8, sizingH: "fill" }, [
    row({ gap: 12 }, [
      row({ width: 44, height: 44, mainAlign: "center", cornerRadius: 12, fill: c.accent }, [
        icon("logo", c.onAccent, 24),
      ]),
      t("Markas design foundations", "display"),
    ]),
    para(
      "Markas means headquarters. The interface is a quiet command post: warm ink neutrals, one mint signal colour, dense rows, and signal-flag sigils that tell bots apart. Every colour is a variable with a Dark and a Light value.",
      "body",
      c.text2,
      { maxWidth: 760 },
    ),
  ]),
  section("Colour", "Dark value · Light value. Use the role, never the raw hex.", [
    swatchGroup("bg/"),
    swatchGroup("border/"),
    swatchGroup("text/"),
    swatchGroup("accent/"),
    row(
      { gap: 12, sizingH: "fill", wrap: true, crossGap: 14 },
      ["warn/base", "warn/soft", "danger/base", "danger/soft", "info/base", "info/soft"].map(
        swatch,
      ),
    ),
  ]),
  section(
    "Type",
    "Inter for the interface, a monospace face for code, paths and schedules. Nothing below 11 px.",
    [
      col({ sizingH: "fill" }, [
        typeRow("display", "Headquarters for your bots"),
        typeRow("title", "Connect the engines your bots will run on"),
        typeRow("heading", "Atlas is waiting for you"),
        typeRow("body", "Stock is 3.410 units as of 09:00."),
        typeRow("bodyStrong", "Send now stops the current turn first"),
        typeRow("small", "Today 09:00 · 212 elements"),
        typeRow("label", "Standing approvals"),
        typeRow("mono", "0 9,16 * * *   https://metrics.example.com"),
      ]),
    ],
  ),
  section(
    "Sigils",
    "A bot is a pattern plus a colour: 8 patterns by 8 colours. Sigils are square tiles; people are round monograms.",
    [
      col(
        { gap: 10 },
        SIGIL_COLORS.slice(0, 4).map((_color, rowIndex) =>
          row(
            { gap: 10 },
            Array.from({ length: 8 }, (_, pattern) =>
              sigil(pattern, SIGIL_COLORS[(rowIndex * 2 + pattern) % 8], 40),
            ),
          ),
        ),
      ),
      row({ gap: 12 }, [
        sigil(1, "mint", 56),
        sigil(1, "mint", 44),
        sigil(1, "mint", 28),
        sigil(1, "mint", 20),
        sigil(1, "mint", 14),
      ]),
    ],
  ),
  section(
    "Icons",
    `${Object.keys(ICONS).length} icons drawn for Markas on a 16 unit grid with a 1.5 unit round stroke.`,
    [row({ gap: 8, sizingH: "fill", wrap: true, crossGap: 8 }, Object.keys(ICONS).map(iconTile))],
  ),
  section(
    "Components",
    "Controls are 32 px high, 24 px in dense places. Radius 6 for controls, 10 for cards, 14 for panels.",
    [
      row({ gap: 12 }, [
        button("Primary", { kind: "primary", iconName: "check" }),
        button("Secondary"),
        button("Ghost", { kind: "ghost" }),
        button("Delete", { kind: "danger", iconName: "trash" }),
        button("Small", { size: "sm" }),
      ]),
      row({ gap: 12 }, [
        chip("Neutral"),
        chip("Signed in", { toneName: "accent", iconName: "check" }),
        chip("Working", { toneName: "info", dot: true }),
        chip("Waiting on you", { toneName: "warn", dot: true }),
        chip("Failed", { toneName: "danger", dot: true }),
      ]),
      row({ gap: 12 }, [
        input("Search", { placeholder: true, iconName: "search", width: 220 }),
        input("Atlas", { width: 180 }),
        segmented(["Queue", "Steer"], 0),
        toggle(true),
        toggle(false),
        radio(true),
        radio(false),
        checkbox(true),
        checkbox(false),
      ]),
      col({ gap: 8, width: 640 }, [
        banner("info", "info", "Informational", "Explains a state and what happens next."),
        banner("warn", "pointer", "Waiting on you", "Says exactly what the person must do.", [
          button("Do it", { size: "sm" }),
        ]),
        banner("accent", "lock", "Reassurance", "Confirms a protection that is in place."),
      ]),
      row(
        { gap: 8 },
        Object.entries(SPACE).map(([_step, px]) =>
          col({ gap: 4, crossAlign: "center" }, [
            box({ width: px, height: px, fill: c.accent, cornerRadius: 2 }),
            t(String(px), "small", c.text3),
          ]),
        ),
      ),
    ],
  ),
]);

export default { name: "00 Foundations", spec };
