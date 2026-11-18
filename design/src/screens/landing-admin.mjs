// The website's private numbers page at /admin, for the owner only: visits from Vercel Web
// Analytics, clicks on the download button, and downloads and installs from GitHub's counts.
// Built in site/admin.html. One series per chart, so no legend; every chart has a table beside it.
import { box, col, row, text } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import { hspace, outline } from "../parts.mjs";
import { c } from "../tokens.mjs";

const UI = "Inter";
const CONTENT = 1120;

const label = (characters, color = c.text2, size = 14) =>
  text(characters, {
    fontFamily: UI,
    fontStyle: "Regular",
    fontSize: size,
    lineHeight: size + 6,
    fill: color,
  });
const strong = (characters, size = 16, color = c.text) =>
  text(characters, {
    fontFamily: UI,
    fontStyle: "SemiBold",
    fontSize: size,
    lineHeight: size + 8,
    fill: color,
  });

const tile = (name, value, note) =>
  col(
    {
      name: `tile/${name}`,
      sizingH: "fill",
      padding: 20,
      gap: 6,
      cornerRadius: 10,
      fill: c.surface,
      ...outline(c.line),
    },
    [label(name), strong(value, 32), label(note, c.text3, 13)],
  );

const days = [
  3, 5, 2, 8, 6, 4, 9, 12, 7, 5, 6, 10, 14, 11, 9, 8, 13, 16, 12, 10, 9, 15, 18, 14, 12, 11, 17, 21,
  16, 19,
];
const chart = col(
  {
    name: "chart/visits",
    sizingH: "fill",
    padding: 20,
    gap: 16,
    cornerRadius: 10,
    fill: c.surface,
    ...outline(c.line),
  },
  [
    row({ sizingH: "fill" }, [
      strong("Visitors per day, last 30 days"),
      hspace(),
      label("Show as table", c.accentText),
    ]),
    row(
      { name: "bars", sizingH: "fill", height: 180, gap: 4, crossAlign: "max", ...{} },
      days.map((value) =>
        box(
          {
            sizingH: "fill",
            height: Math.round((value / 21) * 170),
            cornerRadius: 4,
            fill: c.accent,
          },
          [],
        ),
      ),
    ),
    row({ sizingH: "fill" }, [
      label("20 Oct", c.text3, 12),
      hspace(),
      label("18 Nov", c.text3, 12),
    ]),
  ],
);

const tableRow = (cells, head = false) =>
  row(
    {
      sizingH: "fill",
      height: 40,
      gap: 12,
      stroke: c.line,
      strokeAlign: "inside",
      strokeBottomWeight: 1,
      strokeTopWeight: 0,
      strokeLeftWeight: 0,
      strokeRightWeight: 0,
    },
    cells.map((cell, index) =>
      index === 0
        ? box({ width: 180, height: 20 }, [label(cell, head ? c.text3 : c.text, head ? 13 : 14)])
        : box({ sizingH: "fill", height: 20 }, [
            label(cell, head ? c.text3 : c.text2, head ? 13 : 14),
          ]),
    ),
  );

const card = (title, note, rows) =>
  col(
    {
      name: `card/${title}`,
      sizingH: "fill",
      padding: 20,
      gap: 12,
      cornerRadius: 10,
      fill: c.surface,
      ...outline(c.line),
    },
    [strong(title), label(note, c.text3, 13), col({ sizingH: "fill" }, rows)],
  );

const dashboard = col({ name: "dashboard", width: CONTENT, gap: 24, padding: [8, 0, 64, 0] }, [
  row({ sizingH: "fill", gap: 12 }, [
    col({ gap: 4 }, [
      strong("Numbers", 28),
      label("Updated 19 Nov, 09:12. Only you can see this page.", c.text3),
    ]),
    hspace(),
    row({ height: 40, padding: [0, 14], gap: 8, cornerRadius: 6, fill: c.raised }, [
      label("Last 30 days", c.text),
    ]),
    row({ height: 40, padding: [0, 14], cornerRadius: 6, ...outline(c.lineStrong) }, [
      label("Sign out", c.text),
    ]),
  ]),
  row({ sizingH: "fill", gap: 16 }, [
    tile("Visitors", "412", "1,038 page views"),
    tile("Download clicks", "57", "on the website's button"),
    tile("App downloads", "61", "from GitHub, all systems"),
    tile("Command-line installs", "23", "install script and Homebrew"),
  ]),
  chart,
  row({ sizingH: "fill", gap: 16, crossAlign: "min" }, [
    card("Download clicks by system", "From the website, last 30 days", [
      tableRow(["System", "Clicks"], true),
      tableRow(["Windows", "31"]),
      tableRow(["macOS, Apple silicon", "18"]),
      tableRow(["macOS, Intel", "3"]),
      tableRow(["Linux", "5"]),
    ]),
    card("Where visitors came from", "Last 30 days", [
      tableRow(["Source", "Visitors"], true),
      tableRow(["Direct", "201"]),
      tableRow(["github.com", "143"]),
      tableRow(["news.example.com", "40"]),
      tableRow(["Others", "28"]),
    ]),
  ]),
  card("Downloads and installs by release", "From GitHub's counts, which include CI's own checks", [
    tableRow(
      ["Release", "Windows app", "macOS app", "Linux app", "Install script", "Homebrew"],
      true,
    ),
    tableRow(["0.1.2", "21", "18", "4", "9", "6"]),
    tableRow(["0.1.1", "2", "4", "1", "12", "0"]),
    tableRow(["0.1.0", "2", "7", "2", "11", "0"]),
  ]),
]);

const signIn = col(
  {
    name: "sign-in",
    width: 380,
    padding: 28,
    gap: 16,
    cornerRadius: 14,
    fill: c.surface,
    ...outline(c.line),
  },
  [
    strong("Sign in to see the numbers", 20),
    col({ sizingH: "fill", gap: 6 }, [
      label("Password", c.text),
      row(
        {
          sizingH: "fill",
          height: 44,
          padding: [0, 6, 0, 12],
          cornerRadius: 6,
          fill: c.raised,
          ...outline(c.lineStrong),
        },
        [
          label("••••••••••••••••", c.text),
          hspace(),
          row({ height: 32, padding: [0, 10], cornerRadius: 4 }, [icon("eye", c.text2, 16)]),
        ],
      ),
      row({ gap: 6 }, [
        icon("warning", c.danger, 14),
        label("That password is not right.", c.danger, 13),
      ]),
    ]),
    row({ sizingH: "fill", height: 44, mainAlign: "center", cornerRadius: 8, fill: c.accent }, [
      strong("Sign in", 15, c.onAccent),
    ]),
  ],
);

const spec = col(
  { name: "41 Website numbers page", width: 1440, fill: c.app, crossAlign: "center", gap: 40 },
  [
    row({ width: CONTENT, height: 72, gap: 10 }, [
      box({ width: 28, height: 28, cornerRadius: 8, fill: c.accent }, []),
      strong("Markas"),
      label("Numbers", c.text3),
    ]),
    row({ width: CONTENT, gap: 40, crossAlign: "min" }, [
      signIn,
      label("Signed out: only this card shows.", c.text3, 13),
    ]),
    dashboard,
  ],
);

export default { name: "41 Website numbers page", spec };
