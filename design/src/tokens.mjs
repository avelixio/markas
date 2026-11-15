// Markas design tokens. Colours become FigCraft variables with a Dark and a Light mode;
// screens are drawn in Dark, the product's default.
import { v } from "../tools/dsl.mjs";

export const COLOR_COLLECTION = "Color";
export const MODES = ["Dark", "Light"];

/** name -> [dark, light, what it is for] */
export const COLORS = {
  "bg/app": ["#111110", "#F7F6F2", "Window background, conversation canvas"],
  "bg/sidebar": ["#161615", "#EFEEE9", "Navigation rail and sidebar"],
  "bg/surface": ["#1C1C1A", "#FFFFFF", "Cards, panels, user message blocks"],
  "bg/raised": ["#242422", "#ECEAE4", "Inputs, hover, selected rows"],
  "bg/overlay": ["#2C2C29", "#FFFFFF", "Menus, toasts, dialogs"],
  "bg/scrim": ["#000000A6", "#1B1A1766", "Behind dialogs"],
  "border/subtle": ["#2A2A27", "#E2E0D8", "Dividers, card outlines"],
  "border/strong": ["#3D3D38", "#CFCCC2", "Input outlines, focus-adjacent edges"],
  "text/primary": ["#EEEDE8", "#1B1A17", "Body and headings"],
  "text/secondary": ["#A8A69E", "#5E5C55", "Supporting text"],
  "text/tertiary": ["#85837A", "#7B7971", "Meta text, placeholders"],
  "text/on-accent": ["#0B1F18", "#FFFFFF", "Text on the accent fill"],
  "accent/base": ["#5FD9B0", "#0F8A66", "Primary action, active state, the Markas signal"],
  "accent/soft": ["#16332A", "#DDF3EA", "Accent tint behind chips and selected items"],
  "accent/text": ["#7FE3C2", "#0B6E52", "Accent-coloured text and icons"],
  "warn/base": ["#E8B450", "#A86A00", "Needs attention"],
  "warn/soft": ["#382C13", "#FBEFD2", "Attention tint"],
  "danger/base": ["#F0806A", "#C2412B", "Destructive, failed"],
  "danger/soft": ["#3A1D17", "#FBE4DE", "Destructive tint"],
  "info/base": ["#7FB2F0", "#2563B8", "Informational, running"],
  "info/soft": ["#17273C", "#E1ECFA", "Informational tint"],
  "sigil/ink": ["#111110", "#111110", "Pattern colour on bot sigils"],
  "sigil/mint": ["#5FD9B0", "#39C79A", "Bot colour"],
  "sigil/amber": ["#E8B450", "#E0A630", "Bot colour"],
  "sigil/coral": ["#F0806A", "#EC6F57", "Bot colour"],
  "sigil/sky": ["#7FB2F0", "#5E9BE8", "Bot colour"],
  "sigil/violet": ["#B79CF2", "#A283EA", "Bot colour"],
  "sigil/rose": ["#EE8FB8", "#E873A5", "Bot colour"],
  "sigil/lime": ["#B5D96A", "#9CC84A", "Bot colour"],
  "sigil/sand": ["#D9C4A0", "#CDB486", "Bot colour"],
};

export const c = {
  app: v("bg/app"),
  sidebar: v("bg/sidebar"),
  surface: v("bg/surface"),
  raised: v("bg/raised"),
  overlay: v("bg/overlay"),
  scrim: v("bg/scrim"),
  line: v("border/subtle"),
  lineStrong: v("border/strong"),
  text: v("text/primary"),
  text2: v("text/secondary"),
  text3: v("text/tertiary"),
  onAccent: v("text/on-accent"),
  accent: v("accent/base"),
  accentSoft: v("accent/soft"),
  accentText: v("accent/text"),
  warn: v("warn/base"),
  warnSoft: v("warn/soft"),
  danger: v("danger/base"),
  dangerSoft: v("danger/soft"),
  info: v("info/base"),
  infoSoft: v("info/soft"),
  ink: v("sigil/ink"),
};

export const SIGIL_COLORS = ["mint", "amber", "coral", "sky", "violet", "rose", "lime", "sand"];

const UI = "Inter";
const MONO = "Liberation Mono";

/** Type scale. Sizes in px, line heights in px. */
export const TYPE = {
  display: {
    fontFamily: UI,
    fontStyle: "SemiBold",
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.4,
  },
  title: {
    fontFamily: UI,
    fontStyle: "SemiBold",
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  heading: { fontFamily: UI, fontStyle: "SemiBold", fontSize: 15, lineHeight: 22 },
  body: { fontFamily: UI, fontStyle: "Regular", fontSize: 13, lineHeight: 20 },
  bodyStrong: { fontFamily: UI, fontStyle: "SemiBold", fontSize: 13, lineHeight: 20 },
  small: { fontFamily: UI, fontStyle: "Regular", fontSize: 12, lineHeight: 16 },
  smallStrong: { fontFamily: UI, fontStyle: "SemiBold", fontSize: 12, lineHeight: 16 },
  label: {
    fontFamily: UI,
    fontStyle: "SemiBold",
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.5,
    textCase: "upper",
  },
  mono: { fontFamily: MONO, fontStyle: "Regular", fontSize: 12, lineHeight: 18 },
};

export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 };
export const RADIUS = { control: 6, card: 10, panel: 14, full: 999 };
export const SIZE = {
  control: 32,
  controlSmall: 24,
  rail: 52,
  sidebar: 272,
  panel: 400,
  header: 52,
};

export const SCREEN = { width: 1440, height: 900 };
