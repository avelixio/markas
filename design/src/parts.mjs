// Atoms: the small reusable pieces every Markas screen is made of.
import { box, col, ellipse, rect, row, text, v, vector } from "../tools/dsl.mjs";
import { icon } from "./icons.mjs";
import { c, RADIUS, SIZE, TYPE } from "./tokens.mjs";

/** Text in a type style and colour. */
export const t = (characters, style = "body", color = c.text, extra = {}) =>
  text(characters, { ...TYPE[style], fill: color, ...extra });

/** Text that wraps to the width of its auto-layout parent. */
export const para = (characters, style = "body", color = c.text, extra = {}) =>
  t(characters, style, color, { sizingH: "fill", ...extra });

export const hspace = () => box({ name: "space", width: 1, height: 1, sizingH: "fill" });
export const vspace = () => box({ name: "space", width: 1, height: 1, sizingV: "fill" });

/** A stroke on one side only, drawn inside the box. */
export const edge = (side, color = c.line) => ({
  stroke: color,
  strokeAlign: "inside",
  strokeTopWeight: side === "top" ? 1 : 0,
  strokeRightWeight: side === "right" ? 1 : 0,
  strokeBottomWeight: side === "bottom" ? 1 : 0,
  strokeLeftWeight: side === "left" ? 1 : 0,
});

export const outline = (color = c.line) => ({
  stroke: color,
  strokeWeight: 1,
  strokeAlign: "inside",
});

export const divider = () =>
  box({ name: "divider", height: 1, width: 1, sizingH: "fill", fill: c.line });

const TONES = {
  neutral: { bg: c.raised, fg: c.text2 },
  accent: { bg: c.accentSoft, fg: c.accentText },
  warn: { bg: c.warnSoft, fg: c.warn },
  danger: { bg: c.dangerSoft, fg: c.danger },
  info: { bg: c.infoSoft, fg: c.info },
};
export const tone = (name) => TONES[name] ?? TONES.neutral;

/**
 * A bot's sigil: a signal-flag tile. The pattern (0 to 7) and the colour together identify a bot.
 * This replaces mascot faces; it is Markas's own way to tell bots apart at a glance.
 */
export function sigil(pattern, colorName, size = 28) {
  const s = size;
  const ink = { fill: c.ink, opacity: 0.86 };
  const third = s / 3;
  const marks = [
    () => [rect({ x: 0, y: third, width: s, height: third, ...ink })],
    () => [ellipse({ x: s * 0.29, y: s * 0.29, width: s * 0.42, height: s * 0.42, ...ink })],
    () => [
      rect({ x: 0, y: 0, width: s / 2, height: s / 2, ...ink }),
      rect({ x: s / 2, y: s / 2, width: s / 2, height: s / 2, ...ink }),
    ],
    () => [vector(`M0 ${s}L${s} 0L${s} ${s}Z`, { x: 0, y: 0, ...ink })],
    () => [
      rect({ x: 0, y: s * 0.39, width: s, height: s * 0.22, ...ink }),
      rect({ x: s * 0.39, y: 0, width: s * 0.22, height: s, ...ink }),
    ],
    () => [
      rect({
        x: s * 0.24,
        y: s * 0.24,
        width: s * 0.52,
        height: s * 0.52,
        fill: "none",
        stroke: c.ink,
        strokeWeight: s * 0.13,
        strokeAlign: "inside",
        opacity: 0.86,
      }),
    ],
    () => [
      rect({ x: s * 0.2, y: 0, width: s * 0.2, height: s, ...ink }),
      rect({ x: s * 0.6, y: 0, width: s * 0.2, height: s, ...ink }),
    ],
    () => [
      vector(
        `M0 0L${s / 2} ${s * 0.5}L${s} 0L${s} ${s * 0.36}L${s / 2} ${s * 0.86}L0 ${s * 0.36}Z`,
        { x: 0, y: 0, ...ink },
      ),
    ],
  ];
  return box(
    {
      name: `sigil/${colorName}-${pattern}`,
      width: s,
      height: s,
      clip: true,
      cornerRadius: Math.round(s * 0.28),
      fill: v(`sigil/${colorName}`),
    },
    marks[pattern % marks.length](),
  );
}

/** The person using Markas: a plain round monogram, deliberately unlike a bot sigil. */
export const personAvatar = (initials = "ME", size = 28) =>
  row(
    {
      name: "avatar/person",
      width: size,
      height: size,
      mainAlign: "center",
      cornerRadius: RADIUS.full,
      fill: c.raised,
      ...outline(c.lineStrong),
    },
    [
      t(initials, "label", c.text2, {
        fontSize: Math.max(9, Math.round(size * 0.36)),
        letterSpacing: 0,
      }),
    ],
  );

export function button(label, { kind = "secondary", iconName, size = "md", grow = false } = {}) {
  const kinds = {
    primary: { fill: c.accent, fg: c.onAccent },
    secondary: { fill: c.raised, fg: c.text, ...outline(c.lineStrong) },
    ghost: { fill: "none", fg: c.text2 },
    danger: { fill: c.dangerSoft, fg: c.danger },
  };
  const { fg, ...frame } = kinds[kind];
  const small = size === "sm";
  return row(
    {
      name: `button/${kind}`,
      height: small ? SIZE.controlSmall : SIZE.control,
      padding: [0, small ? 8 : 12, 0, small ? 8 : 12],
      gap: 6,
      mainAlign: "center",
      cornerRadius: RADIUS.control,
      ...(grow ? { sizingH: "fill" } : {}),
      ...frame,
    },
    [iconName ? icon(iconName, fg) : null, t(label, small ? "smallStrong" : "bodyStrong", fg)],
  );
}

export const iconButton = (name, { active = false, size = SIZE.control, color } = {}) =>
  row(
    {
      name: `icon-button/${name}`,
      width: size,
      height: size,
      mainAlign: "center",
      cornerRadius: RADIUS.control,
      fill: active ? c.raised : "none",
    },
    [icon(name, color ?? (active ? c.text : c.text2))],
  );

export const chip = (label, { toneName = "neutral", iconName, dot = false } = {}) => {
  const { bg, fg } = tone(toneName);
  return row(
    {
      name: `chip/${toneName}`,
      height: 22,
      padding: [0, 8, 0, 8],
      gap: 5,
      cornerRadius: RADIUS.full,
      fill: bg,
    },
    [
      dot ? ellipse({ width: 6, height: 6, fill: fg }) : null,
      iconName ? icon(iconName, fg, 12) : null,
      t(label, "smallStrong", fg),
    ],
  );
};

export const statusDot = (toneName = "accent", size = 8) =>
  ellipse({ name: `status/${toneName}`, width: size, height: size, fill: tone(toneName).fg });

export const input = (
  value,
  { placeholder = false, iconName, width, trailing, mono = false, grow = false } = {},
) =>
  row(
    {
      name: "input",
      height: SIZE.control,
      padding: [0, 10, 0, 10],
      gap: 8,
      cornerRadius: RADIUS.control,
      fill: c.raised,
      ...outline(c.lineStrong),
      ...(width ? { width } : {}),
      ...(grow ? { sizingH: "fill" } : {}),
    },
    [
      iconName ? icon(iconName, c.text3) : null,
      t(value, mono ? "mono" : "body", placeholder ? c.text3 : c.text),
      trailing ? hspace() : null,
      trailing ?? null,
    ],
  );

export const textArea = (value, { placeholder = false, height = 96 } = {}) =>
  col(
    {
      name: "textarea",
      height,
      padding: 10,
      cornerRadius: RADIUS.control,
      fill: c.raised,
      sizingH: "fill",
      ...outline(c.lineStrong),
    },
    [para(value, "body", placeholder ? c.text3 : c.text)],
  );

export const toggle = (on) =>
  box(
    {
      name: `toggle/${on ? "on" : "off"}`,
      width: 32,
      height: 18,
      cornerRadius: RADIUS.full,
      fill: on ? c.accent : c.lineStrong,
    },
    [ellipse({ x: on ? 16 : 2, y: 2, width: 14, height: 14, fill: on ? c.onAccent : c.text })],
  );

export const radio = (on) =>
  box(
    {
      name: `radio/${on ? "on" : "off"}`,
      width: 16,
      height: 16,
      cornerRadius: RADIUS.full,
      fill: "none",
      ...outline(on ? c.accent : c.lineStrong),
      strokeWeight: 1.5,
    },
    on ? [ellipse({ x: 4, y: 4, width: 8, height: 8, fill: c.accent })] : [],
  );

export const checkbox = (on) =>
  row(
    {
      name: `checkbox/${on ? "on" : "off"}`,
      width: 16,
      height: 16,
      mainAlign: "center",
      cornerRadius: 4,
      fill: on ? c.accent : "none",
      ...(on ? {} : outline(c.lineStrong)),
    },
    on ? [icon("check", c.onAccent, 12)] : [],
  );

/** A segmented switch, used for panel tabs and small mode choices. */
export const segmented = (labels, active, { grow = false } = {}) =>
  row(
    {
      name: "segmented",
      height: SIZE.control,
      padding: 3,
      gap: 2,
      cornerRadius: RADIUS.control + 2,
      fill: c.raised,
      ...(grow ? { sizingH: "fill" } : {}),
    },
    labels.map((label, index) =>
      row(
        {
          name: `segment/${label}`,
          padding: [0, 10, 0, 10],
          mainAlign: "center",
          cornerRadius: RADIUS.control,
          fill: index === active ? c.overlay : "none",
          sizingV: "fill",
          ...(grow ? { sizingH: "fill" } : {}),
        },
        [t(label, "smallStrong", index === active ? c.text : c.text2)],
      ),
    ),
  );

export const card = (props, children) =>
  col(
    {
      name: "card",
      padding: 16,
      gap: 12,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(),
      ...props,
    },
    children,
  );

/** A labelled form field. */
export const field = (label, control, hint) =>
  col({ name: `field/${label}`, gap: 6, sizingH: "fill" }, [
    t(label, "smallStrong", c.text2),
    control,
    hint ? para(hint, "small", c.text3) : null,
  ]);

/** A settings row: label and help on the left, a control on the right. */
export const settingRow = (label, help, control) =>
  row({ name: `setting/${label}`, gap: 16, sizingH: "fill", padding: [10, 0, 10, 0] }, [
    col({ gap: 2, sizingH: "fill" }, [
      t(label, "bodyStrong"),
      help ? para(help, "small", c.text2) : null,
    ]),
    control,
  ]);

/** A full-width notice: what is happening and what the person can do about it. */
export const banner = (toneName, iconName, title, body, actions = []) => {
  const { bg, fg } = tone(toneName);
  return row(
    {
      name: `banner/${toneName}`,
      gap: 10,
      padding: [10, 12, 10, 12],
      cornerRadius: RADIUS.card,
      fill: bg,
      sizingH: "fill",
      crossAlign: "min",
    },
    [
      box({ width: 16, height: 20 }, [box({ y: 2, width: 16, height: 16 }, [icon(iconName, fg)])]),
      col({ gap: 2, sizingH: "fill" }, [
        t(title, "bodyStrong", c.text),
        body ? para(body, "small", c.text2) : null,
      ]),
      ...actions,
    ],
  );
};

/** The keyboard hint shown next to actions. */
export const kbd = (label) =>
  row(
    {
      name: "kbd",
      height: 18,
      padding: [0, 5, 0, 5],
      cornerRadius: 4,
      fill: c.raised,
      ...outline(c.lineStrong),
    },
    [t(label, "small", c.text2, { fontSize: 11 })],
  );
