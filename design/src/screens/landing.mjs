// The public landing page at markas.vercel.app: what Markas is, one download button for the
// visitor's own system, the tour, and the six areas from the README. It is built in site/.
// Screenshots are drawn as labelled frames here; the page uses the images in docs/media.
import { box, col, row, text } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import { hspace, outline, sigil } from "../parts.mjs";
import { c } from "../tokens.mjs";

const UI = "Inter";
const MONO = "Liberation Mono";
const WIDTH = 1440;
const CONTENT = 1120;

const hero = (characters) =>
  text(characters, {
    fontFamily: UI,
    fontStyle: "SemiBold",
    fontSize: 56,
    lineHeight: 62,
    letterSpacing: -1.6,
    fill: c.text,
    sizingH: "fill",
  });
const heading = (characters) =>
  text(characters, {
    fontFamily: UI,
    fontStyle: "SemiBold",
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.6,
    fill: c.text,
    sizingH: "fill",
  });
const lead = (characters, color = c.text2) =>
  text(characters, {
    fontFamily: UI,
    fontStyle: "Regular",
    fontSize: 19,
    lineHeight: 30,
    fill: color,
    sizingH: "fill",
  });
const body = (characters, color = c.text2) =>
  text(characters, {
    fontFamily: UI,
    fontStyle: "Regular",
    fontSize: 16,
    lineHeight: 25,
    fill: color,
    sizingH: "fill",
  });
const strong = (characters, color = c.text) =>
  text(characters, {
    fontFamily: UI,
    fontStyle: "SemiBold",
    fontSize: 16,
    lineHeight: 24,
    fill: color,
  });
const mono = (characters, color = c.text) =>
  text(characters, {
    fontFamily: MONO,
    fontStyle: "Regular",
    fontSize: 14,
    lineHeight: 20,
    fill: color,
  });

const link = (characters, color = c.text2) =>
  text(characters, {
    fontFamily: UI,
    fontStyle: "Regular",
    fontSize: 16,
    lineHeight: 24,
    fill: color,
  });

const roster = row(
  { name: "roster", gap: 10 },
  [
    ["mint", 0],
    ["amber", 1],
    ["coral", 2],
    ["sky", 3],
    ["violet", 4],
    ["rose", 5],
    ["lime", 6],
    ["sand", 7],
  ].map(([color, pattern]) => sigil(pattern, color, 40)),
);

const screenshot = (name, label, height) =>
  col(
    {
      name: `screenshot/${name}`,
      sizingH: "fill",
      height,
      cornerRadius: 14,
      fill: c.surface,
      ...outline(c.lineStrong),
      mainAlign: "center",
      crossAlign: "center",
      gap: 8,
    },
    [
      icon("image", c.text3, 20),
      text(label, { fontFamily: UI, fontSize: 13, lineHeight: 18, fill: c.text3 }),
    ],
  );

const download = row(
  {
    name: "download/primary",
    height: 52,
    padding: [0, 22, 0, 20],
    gap: 10,
    cornerRadius: 10,
    fill: c.accent,
  },
  [
    icon("download", c.onAccent, 18),
    text("Download for Windows", {
      fontFamily: UI,
      fontStyle: "SemiBold",
      fontSize: 16,
      lineHeight: 24,
      fill: c.onAccent,
    }),
  ],
);

const command = row(
  {
    name: "install-command",
    height: 52,
    padding: [0, 8, 0, 18],
    gap: 16,
    cornerRadius: 10,
    fill: c.surface,
    ...outline(c.lineStrong),
  },
  [
    mono(
      "curl -fsSL https://raw.githubusercontent.com/avelixio/markas/main/install.sh | sh",
      c.text2,
    ),
    row({ height: 36, padding: [0, 12], cornerRadius: 6, fill: c.raised, gap: 6 }, [
      icon("file", c.text, 14),
      text("Copy", {
        fontFamily: UI,
        fontStyle: "SemiBold",
        fontSize: 14,
        lineHeight: 20,
        fill: c.text,
      }),
    ]),
  ],
);

const nav = row({ name: "nav", width: CONTENT, height: 72, gap: 28 }, [
  row({ gap: 10 }, [
    box({ width: 28, height: 28, cornerRadius: 8, fill: c.accent }, []),
    strong("Markas"),
  ]),
  hspace(),
  link("Tour"),
  link("What it does"),
  link("GitHub"),
]);

const heroSection = col({ name: "hero", width: CONTENT, gap: 28, padding: [72, 0, 40, 0] }, [
  roster,
  col({ width: 820, gap: 20 }, [
    hero("A headquarters for your AI teammates, on your own computer."),
    lead(
      "Markas drives bots through the Claude Code, Codex and OpenCode you already use. Talk to each one, queue work, put them on a schedule and see what every bot is doing, in one window.",
    ),
  ]),
  row({ gap: 14 }, [download, command]),
  body("Free and open source. Version 0.1.2, an early preview. Also for macOS and Linux.", c.text3),
]);

const area = (name, title, line) =>
  col({ name: `area/${name}`, sizingH: "fill", gap: 12 }, [
    screenshot(name, `${title} screenshot`, 200),
    strong(title),
    body(line),
  ]);

const areas = col({ name: "areas", width: CONTENT, gap: 32, padding: [56, 0] }, [
  heading("What it does"),
  row({ sizingH: "fill", gap: 28, crossAlign: "min" }, [
    area("chats", "Chats", "Every bot has its own job and its own conversation."),
    area("access", "Access", "A new bot asks before it acts outside its own folder."),
    area("rounds", "Rounds", "Work that runs on a schedule, with the next 7 days in view."),
  ]),
  row({ sizingH: "fill", gap: 28, crossAlign: "min" }, [
    area("rooms", "Rooms", "Put a question to a team, and its lead decides who helps."),
    area("optimizer", "Optimizer", "Smaller conversations, and a count of the tokens saved."),
    area("logbook", "Logbook", "What was done, by whom, and how it ended."),
  ]),
]);

const local = row({ name: "local", width: CONTENT, gap: 56, padding: [56, 0], crossAlign: "min" }, [
  col({ width: 460, gap: 14 }, [
    heading("Everything stays on your computer."),
    body(
      "There is no Markas account, cloud service or telemetry. Your bots still reach the services their engines use, such as Anthropic and OpenAI.",
    ),
  ]),
  col(
    { sizingH: "fill", gap: 0 },
    [
      ["Claude Code", "Anthropic's coding agent"],
      ["Codex", "OpenAI's coding agent"],
      ["OpenCode", "Any model your OpenCode has"],
    ].map(([name, line]) =>
      row(
        {
          sizingH: "fill",
          height: 64,
          gap: 16,
          stroke: c.line,
          strokeAlign: "inside",
          strokeBottomWeight: 1,
          strokeTopWeight: 0,
          strokeLeftWeight: 0,
          strokeRightWeight: 0,
        },
        [strong(name), hspace(), link(line, c.text3)],
      ),
    ),
  ),
]);

const spec = col(
  {
    name: "40 Landing page",
    width: WIDTH,
    fill: c.app,
    crossAlign: "center",
    padding: [0, 0, 64, 0],
  },
  [
    nav,
    heroSection,
    col({ name: "hero-shot", width: CONTENT, height: 640 }, [
      screenshot("main", "The main window: bots on the left, a chat in the middle", 640),
    ]),
    col({ name: "tour", width: CONTENT, gap: 24, padding: [88, 0, 0, 0] }, [
      heading("A 48 second tour"),
      screenshot("tour", "Tour video, with sound and captions, played only when asked", 520),
    ]),
    areas,
    local,
    row(
      {
        name: "preview-note",
        width: CONTENT,
        padding: 20,
        gap: 12,
        cornerRadius: 10,
        fill: c.warnSoft,
      },
      [
        icon("warning", c.warn, 18),
        body(
          "Markas is an early preview. A bot you give full access can change and delete files on your computer. Run only bots and tasks you trust.",
          c.text,
        ),
      ],
    ),
    row({ name: "footer", width: CONTENT, height: 96, gap: 24 }, [
      link("Markas is open source under the Apache 2.0 license.", c.text3),
      hspace(),
      link("GitHub"),
      link("Releases"),
      link("Changelog"),
    ]),
  ],
);

export default { name: "40 Landing page", spec };
