// The Markas icon set. Every icon is drawn here on a 16 unit grid with a 1.5 unit round stroke,
// so the set is the project's own and stays consistent.
// An icon is a list of parts: a string is SVG path data (M, L, H, V, C, Z only, absolute),
// and [cx, cy, r] is a circle.
import { box, ellipse, vector } from "../tools/dsl.mjs";
import { c } from "./tokens.mjs";

export const ICONS = {
  // A base with twin roof peaks and a beacon above it. The peaks happen to make an M.
  logo: ["M3 13.5V7L8 11L13 7V13.5", [8, 4.2, 1.1]],
  plus: ["M8 3V13", "M3 8H13"],
  search: [[7, 7, 4.25], "M10.2 10.2L13.5 13.5"],
  send: ["M8 13V3", "M4 7L8 3L12 7"],
  attach: [
    "M11.5 6L6.5 11C5.8 11.7 4.7 11.7 4 11C3.3 10.3 3.3 9.2 4 8.5L9.5 3C10.6 1.9 12.4 1.9 13.5 3C14.6 4.1 14.6 5.9 13.5 7L8 12.5",
  ],
  chevronDown: ["M4 6L8 10L12 6"],
  chevronRight: ["M6 4L10 8L6 12"],
  chevronLeft: ["M10 4L6 8L10 12"],
  close: ["M4 4L12 12", "M12 4L4 12"],
  check: ["M3.5 8.5L6.5 11.5L12.5 4.5"],
  clock: [[8, 8, 5.5], "M8 5V8L10 9.5"],
  pause: ["M6 4V12", "M10 4V12"],
  play: ["M5.5 3.5L12 8L5.5 12.5Z"],
  stop: ["M4.5 4.5H11.5V11.5H4.5Z"],
  globe: [[8, 8, 5.5], "M2.5 8H13.5", "M8 2.5C6 4.5 6 11.5 8 13.5", "M8 2.5C10 4.5 10 11.5 8 13.5"],
  folder: ["M2.5 4.5H6.5L8 6H13.5V12.5H2.5Z"],
  file: ["M4.5 2.5H9.5L12 5V13.5H4.5Z", "M9.5 2.5V5H12"],
  sliders: ["M3 5H8.5", "M12.5 5H13", "M3 11H3.5", "M7.5 11H13", [10.5, 5, 1.6], [5.5, 11, 1.6]],
  bell: ["M4.5 11V7.5C4.5 5.5 6 4 8 4C10 4 11.5 5.5 11.5 7.5V11L12.5 12H3.5Z", "M7 13.5H9"],
  key: [[5.5, 10.5, 2.5], "M7.3 8.7L13 3", "M11 5L12.5 6.5", "M9.5 6.5L10.8 7.8"],
  shield: ["M8 2.5L12.5 4V8C12.5 10.5 10.7 12.6 8 13.5C5.3 12.6 3.5 10.5 3.5 8V4Z"],
  activity: ["M3 4.5H13", "M3 8H13", "M3 11.5H9"],
  grip: ["M6 4H6.01", "M10 4H10.01", "M6 8H6.01", "M10 8H10.01", "M6 12H6.01", "M10 12H10.01"],
  pencil: ["M3 13L3.5 10.5L10.5 3.5L12.5 5.5L5.5 12.5Z"],
  trash: ["M3.5 4.5H12.5", "M6 4.5V3H10V4.5", "M4.5 4.5L5 13H11L11.5 4.5"],
  thread: ["M4.5 3V13", "M4.5 9C4.5 6.5 7 6 11.5 6", "M9.5 4L11.5 6L9.5 8"],
  pin: ["M8 10V14", "M5 10H11", "M6 10V5L5 3.5H11L10 5V10"],
  team: [
    [6, 6, 2.2],
    "M2.5 13C2.5 10.8 4 9.5 6 9.5C8 9.5 9.5 10.8 9.5 13",
    [11.2, 6.5, 1.7],
    "M11.2 9.8C12.7 9.9 13.5 11 13.5 13",
  ],
  chat: ["M3 4H13V10.5H8L5 13V10.5H3Z"],
  routine: [
    "M3.5 7C3.5 5 5 3.5 7 3.5H12",
    "M10.5 2L12 3.5L10.5 5",
    "M12.5 9C12.5 11 11 12.5 9 12.5H4",
    "M5.5 11L4 12.5L5.5 14",
  ],
  calendar: ["M3 4.5H13V13H3Z", "M3 7H13", "M5.5 3V5.5", "M10.5 3V5.5"],
  external: ["M9 3H13V7", "M13 3L7.5 8.5", "M11 9.5V13H3V5H6.5"],
  eye: [
    "M2 8C3.5 5.5 5.5 4.3 8 4.3C10.5 4.3 12.5 5.5 14 8C12.5 10.5 10.5 11.7 8 11.7C5.5 11.7 3.5 10.5 2 8Z",
    [8, 8, 1.8],
  ],
  lock: ["M4.5 7.5H11.5V13H4.5Z", "M6 7.5V5.5C6 4.3 6.9 3.5 8 3.5C9.1 3.5 10 4.3 10 5.5V7.5"],
  warning: ["M8 3L13.5 12.5H2.5Z", "M8 7V9.5", "M8 11.3H8.01"],
  info: [[8, 8, 5.5], "M8 7.5V11", "M8 5.2H8.01"],
  more: ["M4 8H4.01", "M8 8H8.01", "M12 8H12.01"],
  arrowRight: ["M3 8H13", "M9 4L13 8L9 12"],
  reply: ["M6 4L3 7L6 10", "M3 7H10C11.7 7 13 8.3 13 10V12.5"],
  zap: ["M8.5 2.5L4 9H8L7.5 13.5L12 7H8Z"],
  panel: ["M2.5 3.5H13.5V12.5H2.5Z", "M10 3.5V12.5"],
  sidebar: ["M2.5 3.5H13.5V12.5H2.5Z", "M6 3.5V12.5"],
  pointer: ["M4 3L12 7.5L8.5 8.5L7.5 12Z"],
  terminal: ["M3 4L6.5 8L3 12", "M8 12H13"],
  download: ["M8 3V10", "M5 7.5L8 10.5L11 7.5", "M3 13H13"],
  link: [
    "M6.5 9.5L9.5 6.5",
    "M7 5L8 4C9.1 2.9 10.9 2.9 12 4C13.1 5.1 13.1 6.9 12 8L11 9",
    "M9 11L8 12C6.9 13.1 5.1 13.1 4 12C2.9 10.9 2.9 9.1 4 8L5 7",
  ],
  sparkle: ["M8 2.5L9.3 6.7L13.5 8L9.3 9.3L8 13.5L6.7 9.3L2.5 8L6.7 6.7Z"],
  undo: ["M3.5 6.5H10C11.9 6.5 13 7.8 13 9.5C13 11.2 11.9 12.5 10 12.5H6", "M6 4L3.5 6.5L6 9"],
  filter: ["M2.5 4H13.5L9.5 8.5V12.5L6.5 11V8.5Z"],
  refresh: [
    "M13 8C13 10.8 10.8 13 8 13C5.9 13 4.1 11.7 3.4 9.9",
    "M3 8C3 5.2 5.2 3 8 3C10.1 3 11.9 4.3 12.6 6.1",
    "M12.8 3V6.2H9.6",
    "M3.2 13V9.8H6.4",
  ],
  user: [[8, 5.5, 2.5], "M3.5 13.5C3.5 11 5.5 9.5 8 9.5C10.5 9.5 12.5 11 12.5 13.5"],
  steer: ["M3 12C3 8 5 5 9 5H13", "M10.5 2.5L13 5L10.5 7.5"],
  queue: ["M3 4H13", "M3 8H13", "M3 12H13"],
  image: ["M2.5 3.5H13.5V12.5H2.5Z", "M2.5 10.5L6 7.5L9 10L10.5 8.8L13.5 11.5", [10.5, 6, 1]],
  card: ["M2.5 4H13.5V12H2.5Z", "M2.5 6.5H13.5", "M4.5 9.5H7"],
};

const scalePath = (path, factor) =>
  path.replace(/-?\d+(\.\d+)?/g, (number) =>
    String(Math.round(Number(number) * factor * 100) / 100),
  );

/** An icon in a square box of `size` px (default 16). */
export function icon(name, color = c.text2, size = 16) {
  const parts = ICONS[name];
  if (!parts) throw new Error(`Unknown icon: ${name}`);
  const factor = size / 16;
  const stroke = {
    stroke: color,
    strokeWeight: factor < 1 ? Math.max(1.15, 1.5 * factor) : 1.5 * Math.max(1, factor * 0.9),
    strokeCap: "round",
    strokeJoin: "round",
    fill: "none",
  };
  return box(
    { name: `icon/${name}`, width: size, height: size },
    parts.map((part) =>
      Array.isArray(part)
        ? ellipse({
            x: (part[0] - part[2]) * factor,
            y: (part[1] - part[2]) * factor,
            width: part[2] * 2 * factor,
            height: part[2] * 2 * factor,
            ...stroke,
          })
        : vector(scalePath(part, factor), { x: 0, y: 0, ...stroke }),
    ),
  );
}
