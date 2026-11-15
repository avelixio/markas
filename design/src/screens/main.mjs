// Main layout: a conversation with the Browser panel open.
import { col, rect, row } from "../../tools/dsl.mjs";
import { ID, translate } from "../i18n.mjs";
import { icon } from "../icons.mjs";
import { chip, edge, hspace, iconButton, outline, para, t } from "../parts.mjs";
import {
  appScreen,
  botMessage,
  botSigil,
  conversation,
  dayMarker,
  rightPanel,
  sidebar,
  toolLine,
  userMessage,
} from "../shell.mjs";
import { c, RADIUS } from "../tokens.mjs";

/** A stand-in for the live picture of a bot's browser tab. */
export function pagePreview({ height = 380, dim = false } = {}) {
  const bar = (width, color = c.raised, h = 10) =>
    rect({ width, height: h, cornerRadius: 3, fill: color });
  const stat = (label, value, color) =>
    col({ gap: 6, padding: 10, cornerRadius: 6, fill: c.surface, sizingH: "fill", ...outline() }, [
      t(label, "small", c.text3, { fontSize: 10, lineHeight: 12 }),
      t(value, "heading", color ?? c.text),
    ]);
  const chartBars = [34, 52, 41, 66, 58, 73, 49, 81, 64, 70, 55, 88];
  return col(
    {
      name: "PagePreview",
      sizingH: "fill",
      height,
      padding: 12,
      gap: 10,
      fill: c.app,
      clip: true,
      opacity: dim ? 0.45 : 1,
    },
    [
      row({ gap: 8, sizingH: "fill" }, [
        bar(64, c.lineStrong, 12),
        hspace(),
        bar(40),
        bar(40),
        bar(22, c.accentSoft),
      ]),
      row({ gap: 8, sizingH: "fill" }, [
        stat("Stock level", "3.410", c.accentText),
        stat("Orders today", "18.204"),
        stat("Failed", "0,4%"),
      ]),
      col(
        {
          gap: 8,
          padding: 10,
          cornerRadius: 6,
          fill: c.surface,
          sizingH: "fill",
          sizingV: "fill",
          ...outline(),
        },
        [
          row({ gap: 8, sizingH: "fill" }, [bar(90, c.lineStrong), hspace(), bar(36)]),
          row(
            { gap: 6, sizingH: "fill", sizingV: "fill", crossAlign: "max" },
            chartBars.map((value, index) =>
              rect({
                width: 18,
                height: value * 1.6,
                cornerRadius: 2,
                fill: index === chartBars.length - 1 ? c.accent : c.lineStrong,
              }),
            ),
          ),
        ],
      ),
    ],
  );
}

/** Browser panel body: the tab strip names the bot in control and what it is doing. */
export function browserPanel({ takeover = false } = {}) {
  const tab = (key, title, active) =>
    row(
      {
        name: `tab/${title}`,
        height: 30,
        padding: [0, 10, 0, 8],
        gap: 6,
        cornerRadius: RADIUS.control,
        fill: active ? c.raised : "none",
      },
      [
        botSigil(key, 14),
        t(title, "small", active ? c.text : c.text2),
        active ? icon("close", c.text3, 12) : null,
      ],
    );
  return [
    row({ sizingH: "fill", padding: [8, 12, 8, 12], gap: 4, ...edge("bottom") }, [
      tab("atlas", "Metrics: stock overview", true),
      tab("sol", "Insights", false),
      hspace(),
      iconButton("external", { size: 28 }),
    ]),
    row({ sizingH: "fill", padding: [8, 12, 8, 12], gap: 8, ...edge("bottom") }, [
      icon("lock", c.text3, 12),
      t("metrics.example.com/dashboards", "small", c.text2),
      hspace(),
      chip("analytics", { iconName: "user" }),
    ]),
    pagePreview({ dim: takeover }),
    row({ sizingH: "fill", padding: [10, 12, 10, 12], gap: 10, ...edge("top") }, [
      botSigil("atlas", 20),
      col({ gap: 1, sizingH: "fill" }, [
        t(takeover ? "Atlas is waiting for you" : "Atlas is reading the page", "bodyStrong"),
        t(
          takeover
            ? "The site asked for a code sent to your phone."
            : "snapshot · 212 elements · 2 s ago",
          "small",
          c.text2,
        ),
      ]),
      takeover ? null : chip("Live", { toneName: "info", dot: true }),
    ]),
    col({ sizingH: "fill", sizingV: "fill", padding: 12, gap: 8 }, [
      t("Recent actions", "label", c.text3),
      ...[
        ["globe", "Opened", "metrics.example.com", "09:00:02"],
        ["key", "Filled sign-in", "Metrics (Atlas) from the keyring", "09:00:05"],
        ["pointer", "Clicked", "Dashboards, stock overview", "09:00:11"],
        ["eye", "Read", "stock level tile", "09:00:14"],
      ].map(([name, label, detail, time]) =>
        row({ sizingH: "fill", gap: 8 }, [
          icon(name, c.text3, 12),
          t(label, "smallStrong", c.text2),
          t(detail, "small", c.text3),
          hspace(),
          t(time, "mono", c.text3, { fontSize: 11, lineHeight: 14 }),
        ]),
      ),
    ]),
  ];
}

export const atlasMessages = [
  dayMarker("Today"),
  userMessage("08:58", "Check the stock level now and tell me if it is below the reorder line."),
  botMessage("atlas", "09:00", [
    row({ gap: 6 }, [
      toolLine("globe", "Browser", "4 steps"),
      toolLine("key", "Keyring", "Metrics (Atlas)", { toneName: "accent" }),
    ]),
    "Stock is 3.410 units as of 09:00. That is above the 2.000 unit reorder line, so I did not message Sam.",
    "The next scheduled check is at 16:00.",
  ]),
];

const mainScreen = (name) =>
  appScreen(name, "Chats", [
    sidebar({ active: "atlas" }),
    conversation("atlas", {
      header: { state: "idle", panel: "Browser" },
      tabs: { labels: ["Main", "Reorder rules", "Metrics login"], active: 0 },
      messages: atlasMessages,
    }),
    rightPanel("Browser", browserPanel()),
  ]);

export default [
  { name: "05 Main layout, browser panel", spec: mainScreen("05 Main layout, browser panel") },
  // The same screen in the Light mode, to prove every colour comes from a variable.
  {
    name: "05b Main layout, light mode",
    spec: mainScreen("05b Main layout, light mode"),
    mode: "Light",
  },
  // The same screen in Bahasa Indonesia, the second language Markas ships in.
  {
    name: "05c Main layout, Bahasa Indonesia",
    spec: translate(mainScreen("05c Main layout, Bahasa Indonesia"), ID),
  },
];

export { para };
