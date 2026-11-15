// The rest of the first run, one full screen per step:
// pick a default model, meet Dispatch in the middle of the screen, describe a bot or pick a
// ready-made one, review it, and land in the app with Dispatch pinned at the top.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  banner,
  button,
  chip,
  divider,
  edge,
  hspace,
  iconButton,
  input,
  kbd,
  outline,
  para,
  personAvatar,
  radio,
  segmented,
  sigil,
  statusDot,
  t,
  textArea,
  toggle,
  vspace,
} from "../parts.mjs";
import { appScreen, botMessage, botSigil, conversation } from "../shell.mjs";
import { c, RADIUS, SIZE } from "../tokens.mjs";
import { setupStage } from "./onboarding.mjs";

// ----- 01c Default model -----

const engineTab = (iconName, active, label) =>
  row(
    {
      name: `engine-tab/${label}`,
      width: 40,
      height: 40,
      mainAlign: "center",
      cornerRadius: RADIUS.control + 2,
      fill: active ? c.raised : "none",
      ...(active ? outline(c.lineStrong) : {}),
    },
    [icon(iconName, active ? c.text : c.text3, 18)],
  );

const modelRow = (name, { on = false, note, tag } = {}) =>
  row(
    {
      name: `model/${name}`,
      sizingH: "fill",
      height: 36,
      padding: [0, 10, 0, 10],
      gap: 10,
      cornerRadius: RADIUS.control,
      fill: on ? c.raised : "none",
    },
    [
      radio(on),
      t(name, on ? "bodyStrong" : "body"),
      tag ? chip(tag, { toneName: on ? "accent" : "neutral" }) : null,
      hspace(),
      note ? t(note, "small", c.text3) : null,
    ],
  );

const defaultModel = setupStage(
  "01c First run, default model",
  3,
  "Choose a default model",
  [
    col({ gap: 6, sizingH: "fill" }, [
      t("Choose the model new bots start on", "title"),
      para(
        "Each engine offers its own models. Pick one for new bots; every bot can change it later, and gets a backup engine for when this one hits its limit.",
        "body",
        c.text2,
      ),
    ]),
    row(
      {
        name: "ModelPicker",
        sizingH: "fill",
        height: 420,
        crossAlign: "min",
        cornerRadius: RADIUS.panel,
        fill: c.surface,
        clip: true,
        ...outline(),
      },
      [
        col(
          {
            name: "EngineTabs",
            width: 64,
            sizingV: "fill",
            padding: [12, 0, 12, 0],
            gap: 8,
            crossAlign: "center",
            fill: c.sidebar,
            ...edge("right"),
          },
          [engineTab("sparkle", true, "Claude Code"), engineTab("terminal", false, "Codex")],
        ),
        col({ sizingH: "fill", sizingV: "fill", padding: 16, gap: 12 }, [
          row({ sizingH: "fill", gap: 10 }, [
            col({ gap: 2, sizingH: "fill" }, [
              t("Claude Code", "heading"),
              t("Version 2.1.322 · signed in as you@example.com", "small", c.text3),
            ]),
            chip("Ready", { toneName: "accent", dot: true }),
          ]),
          input("Search models", { placeholder: true, iconName: "search", grow: true }),
          col({ sizingH: "fill", gap: 2 }, [
            modelRow("Sonnet", { on: true, tag: "Recommended", note: "Balanced, most tasks" }),
            modelRow("Opus", { note: "Most capable, uses the plan fastest" }),
            modelRow("Haiku", { note: "Fastest, for simple rounds" }),
            row({ sizingH: "fill", height: 32, padding: [0, 10, 0, 36], gap: 6 }, [
              t("Older models", "small", c.text3),
              chip("2"),
              hspace(),
              icon("chevronDown", c.text3, 12),
            ]),
          ]),
          vspace(),
          divider(),
          row({ sizingH: "fill", gap: 10 }, [
            t("Effort", "smallStrong", c.text2),
            hspace(),
            segmented(["Low", "Medium", "High"], 1),
          ]),
        ]),
      ],
    ),
    row({ sizingH: "fill", gap: 8 }, [
      icon("info", c.text3, 12),
      t(
        "Codex is still waiting for you to sign in. Its models appear here once it is ready.",
        "small",
        c.text3,
      ),
    ]),
    row({ sizingH: "fill", gap: 8 }, [
      button("Back", { kind: "ghost", iconName: "chevronLeft" }),
      hspace(),
      button("Continue", { kind: "primary", iconName: "arrowRight" }),
    ]),
  ],
  { width: 720 },
);

// ----- Dispatch in the middle -----

const DISPATCH = "router";
const SCREEN_WIDE = 1440;

const dispatchHello = (size = 56) =>
  col({ name: "DispatchHello", gap: 12, crossAlign: "center" }, [
    botSigil(DISPATCH, size),
    col({ gap: 4, crossAlign: "center" }, [
      t("Dispatch", "display"),
      t("Part of Markas. Sets up your bots and passes work between them.", "body", c.text2),
    ]),
  ]);

/** A bubble from Dispatch in the centred setup chat. */
const fromDispatch = (children) =>
  row({ name: "msg/Dispatch", sizingH: "fill", gap: 10, crossAlign: "min" }, [
    botSigil(DISPATCH, 24),
    col(
      { sizingH: "fill", gap: 10 },
      children.map((child) => (typeof child === "string" ? para(child) : child)),
    ),
  ]);

const fromYou = (body) =>
  row({ name: "msg/You", sizingH: "fill", gap: 10, crossAlign: "min" }, [
    hspace(),
    col(
      {
        maxWidth: 520,
        padding: [8, 12, 8, 12],
        cornerRadius: RADIUS.card,
        fill: c.raised,
      },
      [t(body, "body", c.text, { width: 480 })],
    ),
    personAvatar("ME", 24),
  ]);

const choiceCard = (iconName, title, body, { primary = false } = {}) =>
  col(
    {
      name: `start/${title}`,
      sizingH: "fill",
      gap: 8,
      padding: 14,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(primary ? c.accent : c.line),
    },
    [
      row({ sizingH: "fill", gap: 8 }, [
        row(
          {
            width: 28,
            height: 28,
            mainAlign: "center",
            cornerRadius: RADIUS.control,
            fill: primary ? c.accentSoft : c.raised,
          },
          [icon(iconName, primary ? c.accentText : c.text2)],
        ),
        hspace(),
        icon("arrowRight", c.text3, 12),
      ]),
      t(title, "bodyStrong"),
      para(body, "small", c.text2),
    ],
  );

const setupComposer = (placeholder, value) =>
  row(
    {
      name: "Composer",
      sizingH: "fill",
      height: 52,
      padding: [0, 8, 0, 14],
      gap: 8,
      cornerRadius: RADIUS.panel,
      fill: c.surface,
      ...outline(c.lineStrong),
    },
    [
      iconButton("attach", { size: 28 }),
      t(value ?? placeholder, "body", value ? c.text : c.text3),
      hspace(),
      t("Enter to send", "small", c.text3),
      row(
        {
          width: 32,
          height: 32,
          mainAlign: "center",
          cornerRadius: RADIUS.full,
          fill: value ? c.accent : c.raised,
        },
        [icon("send", value ? c.onAccent : c.text3)],
      ),
    ],
  );

const startChoices = row({ name: "StartChoices", sizingH: "fill", gap: 12, crossAlign: "min" }, [
  choiceCard(
    "chat",
    "Tell me what you need",
    "Say it in your own words. I ask a few questions and draft the bot.",
    {
      primary: true,
    },
  ),
  choiceCard(
    "team",
    "Pick a ready-made bot",
    "Start from a bot someone already built, then make it yours.",
  ),
  choiceCard(
    "file",
    "Import a bot file",
    "Add a bot a friend shared with you, or one you saved before.",
  ),
]);

/** Dispatch in the middle of the screen: used in setup and whenever there are no bots yet. */
export const dispatchCentre = () => [
  dispatchHello(),
  box({ width: 1, height: 8 }),
  fromDispatch([
    "Hi. Markas starts with no bots, so let's make your first one together. What should it help you with?",
    startChoices,
  ]),
  box({ width: 1, height: 8 }),
  setupComposer("Tell Dispatch what you want help with"),
];

const meetDispatch = setupStage("36 First run, meet Dispatch", 5, "Meet Dispatch", [
  ...dispatchCentre(),
  row({ sizingH: "fill", gap: 8 }, [
    button("Back", { kind: "ghost", iconName: "chevronLeft" }),
    hspace(),
    button("Skip for now", { kind: "ghost" }),
  ]),
]);

// ----- 37 Describe the bot in a chat -----

const quickReply = (label, on = false) =>
  row(
    {
      name: `reply/${label}`,
      height: 28,
      padding: [0, 10, 0, 10],
      cornerRadius: RADIUS.full,
      fill: on ? c.accentSoft : "none",
      ...outline(on ? c.accent : c.lineStrong),
    },
    [t(label, "smallStrong", on ? c.accentText : c.text2)],
  );

const draftLine = (label, value, iconName) =>
  row({ name: `draft/${label}`, sizingH: "fill", gap: 10 }, [
    icon(iconName, c.text3, 12),
    t(label, "small", c.text3, { width: 96 }),
    t(value, "body", c.text),
  ]);

const draftCard = col(
  {
    name: "DraftCard",
    sizingH: "fill",
    gap: 12,
    padding: 16,
    cornerRadius: RADIUS.card,
    fill: c.surface,
    ...outline(c.accent),
  },
  [
    row({ sizingH: "fill", gap: 12 }, [
      sigil(1, "coral", 40),
      col({ gap: 2, sizingH: "fill" }, [
        row({ gap: 8 }, [
          t("Scout", "heading"),
          chip("Draft", { toneName: "accent", iconName: "sparkle" }),
        ]),
        t("Watches public status pages and reports incidents", "small", c.text2),
      ]),
    ]),
    divider(),
    draftLine("Engine", "Claude Code · Sonnet, backup Codex", "terminal"),
    draftLine("Uses", "Its own browser, public pages only, no keys", "globe"),
    draftLine("May do", "Ask first: works in its own folder, asks for the rest", "shield"),
    draftLine("Round", "Every day at 08:30, report in this chat", "routine"),
    row({ sizingH: "fill", gap: 8 }, [
      button("Change something", { kind: "ghost", iconName: "pencil" }),
      hspace(),
      button("Review and create", { kind: "primary", iconName: "arrowRight" }),
    ]),
  ],
);

const describeChat = setupStage(
  "37 First run, describe with Dispatch",
  6,
  "Describe your bot",
  [
    row({ sizingH: "fill", gap: 10 }, [
      botSigil(DISPATCH, 28),
      col({ gap: 0, sizingH: "fill" }, [
        t("Dispatch", "bodyStrong"),
        t("Drafting your first bot", "small", c.text3),
      ]),
      button("Pick a ready-made bot instead", { kind: "ghost", size: "sm", iconName: "team" }),
    ]),
    col({ name: "Messages", sizingH: "fill", sizingV: "fill", gap: 14, mainAlign: "max" }, [
      fromYou(
        "Check the public status pages of the tools we use every morning, and tell me if any of them has an incident.",
      ),
      fromDispatch([
        "Got it. Which pages should it check? Paste the links, or name the tools and I will find their status pages.",
        row({ gap: 6 }, [quickReply("Paste links"), quickReply("Name the tools", true)]),
      ]),
      fromYou("GitHub, Vercel and Cloudflare."),
      fromDispatch(["Here is a draft. Nothing is created until you say so.", draftCard]),
    ]),
    setupComposer("Ask Dispatch to change anything"),
  ],
  { width: 720 },
);

// ----- 38 Ready-made bots -----

const READY = [
  [1, "coral", "Scout", "Watches status pages and reports incidents", ["Browser", "Daily round"]],
  [
    5,
    "sand",
    "Herald",
    "A short morning brief from the sources you choose",
    ["Browser", "Daily round"],
  ],
  [
    6,
    "rose",
    "Sift",
    "Sorts an inbox and drafts the replies that matter",
    ["Needs a key", "Asks before sending"],
  ],
  [3, "violet", "Lens", "Researches a question and cites every source", ["Browser"]],
  [0, "sky", "Quill", "Writes and edits documents in your voice", ["Files"]],
  [7, "lime", "Tally", "Builds and checks spreadsheets and reports", ["Files", "Weekly round"]],
  [2, "amber", "Sentry", "Reviews code changes and runs the tests", ["Files", "Commands"]],
  [4, "mint", "Ledger", "Tracks prices or numbers on sites you name", ["Browser", "Needs a key"]],
  [1, "sky", "Echo", "Turns meeting notes into tasks and follow-ups", ["Files"]],
];

const readyCard = ([pattern, color, name, body, tags], selected) =>
  col(
    {
      name: `ready/${name}`,
      sizingH: "fill",
      gap: 10,
      padding: 14,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(selected ? c.accent : c.line),
    },
    [
      row({ sizingH: "fill", gap: 10 }, [
        sigil(pattern, color, 32),
        col({ gap: 0, sizingH: "fill" }, [
          t(name, "bodyStrong"),
          t("by Markas community", "small", c.text3),
        ]),
        selected
          ? chip("Added", { toneName: "accent", iconName: "check" })
          : button("Add", { size: "sm", iconName: "plus" }),
      ]),
      para(body, "small", c.text2),
      row(
        { gap: 6 },
        tags.map((tag) => chip(tag)),
      ),
    ],
  );

const gridRow = (items, selectedName) =>
  row(
    { sizingH: "fill", gap: 12, crossAlign: "min" },
    items.map((item) => readyCard(item, item[2] === selectedName)),
  );

const readyMade = setupStage(
  "38 First run, ready-made bots",
  6,
  "Pick a ready-made bot",
  [
    row({ sizingH: "fill", gap: 12, crossAlign: "min" }, [
      col({ gap: 4, sizingH: "fill" }, [
        t("Ready-made bots", "title"),
        para(
          "Each one is a single bot file, made and shared by people who use Markas. Adding one makes a copy that is yours to change.",
          "body",
          c.text2,
        ),
      ]),
    ]),
    row({ sizingH: "fill", gap: 8 }, [
      input("Search ready-made bots", { placeholder: true, iconName: "search", grow: true }),
      segmented(["All", "Daily", "Research", "Writing", "Code"], 0),
    ]),
    col({ name: "ReadyGrid", sizingH: "fill", gap: 12 }, [
      gridRow(READY.slice(0, 3), "Scout"),
      gridRow(READY.slice(3, 6)),
      gridRow(READY.slice(6, 9)),
    ]),
    row({ sizingH: "fill", gap: 8 }, [
      button("Back to Dispatch", { kind: "ghost", iconName: "chevronLeft" }),
      button("Import a bot file", { iconName: "file" }),
      hspace(),
      t("Made a good bot? Share its file on GitHub.", "small", c.text3),
      button("Review and create", { kind: "primary", iconName: "arrowRight" }),
    ]),
  ],
  { width: 1040 },
);

// ----- 39 Review and create -----

const accessChoice = (title, body, on) =>
  row(
    {
      name: `access/${title}`,
      sizingH: "fill",
      gap: 10,
      padding: [10, 12, 10, 12],
      cornerRadius: RADIUS.card,
      crossAlign: "min",
      fill: on ? c.raised : "none",
      ...outline(on ? c.accent : c.line),
    },
    [
      box({ width: 16, height: 20 }, [box({ y: 2, width: 16, height: 16 }, [radio(on)])]),
      col({ gap: 2, sizingH: "fill" }, [t(title, "bodyStrong"), para(body, "small", c.text2)]),
    ],
  );

const label = (text) => t(text, "smallStrong", c.text2);

const review = setupStage(
  "39 First run, review and create",
  7,
  "Review and create",
  [
    row({ sizingH: "fill", gap: 24, crossAlign: "min" }, [
      col({ name: "Who", sizingH: "fill", gap: 14 }, [
        row({ gap: 14 }, [
          sigil(1, "coral", 56),
          col({ gap: 2 }, [
            t("Scout", "display"),
            t("Drafted by Dispatch from your chat", "small", c.text3),
          ]),
        ]),
        col({ gap: 6, sizingH: "fill" }, [
          label("Role"),
          input("Watches public status pages and reports incidents", { grow: true }),
        ]),
        col({ gap: 6, sizingH: "fill" }, [
          label("Instructions"),
          textArea(
            "Each morning open the status pages of GitHub, Vercel and Cloudflare. Reply with one line per service that is not fully operational, with the incident title and start time. If all are fine, say so in one line. These pages are public: never sign in anywhere.",
            { height: 132 },
          ),
        ]),
        col({ gap: 6, sizingH: "fill" }, [
          label("Its folder"),
          input("~/.markas/bots/scout", {
            mono: true,
            grow: true,
            trailing: t("Change", "smallStrong", c.accentText),
          }),
        ]),
      ]),
      col({ name: "Rules", sizingH: "fill", gap: 14 }, [
        col({ gap: 8, sizingH: "fill" }, [
          label("What it may do without asking"),
          accessChoice("Ask first", "Works in its own folder. Asks you for everything else.", true),
          accessChoice(
            "Read freely",
            "Also reads any file. Asks before changing things or running commands.",
            false,
          ),
          accessChoice("Full access", "Never asks. Only for bots you fully trust.", false),
        ]),
        row(
          {
            name: "RoundToggle",
            sizingH: "fill",
            gap: 10,
            padding: [10, 12, 10, 12],
            cornerRadius: RADIUS.card,
            ...outline(),
          },
          [
            icon("routine", c.text2),
            col({ gap: 2, sizingH: "fill" }, [
              t("Every day at 08:30", "bodyStrong"),
              para(
                "Its round may open those three status pages without asking each time.",
                "small",
                c.text2,
              ),
            ]),
            toggle(true),
          ],
        ),
        row({ gap: 8 }, [
          statusDot("accent", 6),
          t("Runs on Claude Code · Sonnet, backup Codex", "small", c.text2),
        ]),
      ]),
    ]),
    row({ sizingH: "fill", gap: 8 }, [
      button("Back", { kind: "ghost", iconName: "chevronLeft" }),
      hspace(),
      t("You can change all of this later in the bot's settings.", "small", c.text3),
      button("Create Scout and say hello", { kind: "primary", iconName: "arrowRight" }),
    ]),
  ],
  { width: 1000 },
);

// ----- 40 After setup: Dispatch moves to the top of the list -----

const listRow = (tile, name, preview, time, { active = false } = {}) =>
  row(
    {
      name: `bot-row/${name}`,
      sizingH: "fill",
      padding: [7, 8, 7, 8],
      gap: 10,
      cornerRadius: RADIUS.control + 2,
      fill: active ? c.raised : "none",
    },
    [
      tile,
      col({ gap: 1, sizingH: "fill" }, [
        row({ gap: 6, sizingH: "fill" }, [
          t(name, "bodyStrong"),
          hspace(),
          t(time, "small", c.text3),
        ]),
        t(preview, "small", c.text2),
      ]),
    ],
  );

const section = (text, trailing) =>
  row({ sizingH: "fill", padding: [10, 8, 4, 8] }, [
    t(text, "label", c.text3),
    hspace(),
    trailing ?? null,
  ]);

const afterSidebar = col(
  {
    name: "Sidebar/after-setup",
    width: SIZE.sidebar,
    padding: [12, 8, 12, 8],
    gap: 2,
    fill: c.sidebar,
    sizingV: "fill",
    ...edge("right"),
  },
  [
    row({ sizingH: "fill", gap: 8, padding: [0, 4, 8, 4] }, [
      input("Search", {
        placeholder: true,
        iconName: "search",
        grow: true,
        trailing: kbd("Ctrl K"),
      }),
      iconButton("plus", { color: c.text }),
    ]),
    section("Pinned", icon("pin", c.text3, 12)),
    listRow(botSigil(DISPATCH, 28), "Dispatch", "Scout is set up. Test run passed.", "08:41"),
    section("Crew", icon("plus", c.text3, 12)),
    listRow(sigil(1, "coral", 28), "Scout", "All three services are operational.", "08:42", {
      active: true,
    }),
    vspace(),
    row({ sizingH: "fill", gap: 8, padding: [8, 8, 0, 8], ...edge("top") }, [
      statusDot("accent", 6),
      t("Host running", "small", c.text2),
      hspace(),
      t("1 engine ready", "small", c.text3),
    ]),
  ],
);

const afterSetup = appScreen("40 After setup, first bot", "Chats", [
  afterSidebar,
  conversation("router", {
    header: { state: "idle", panel: "Files" },
    messages: [
      botMessage("router", "08:41", [
        "Scout is ready. I ran it once so you can see what a morning report looks like. I'm pinned at the top whenever you want another bot.",
        row({ gap: 6 }, [
          chip("Open Scout", { toneName: "accent", iconName: "arrowRight" }),
          chip("Make another bot", { iconName: "plus" }),
          chip("Browse ready-made bots", { iconName: "team" }),
        ]),
      ]),
    ],
    composerProps: {},
  }),
]);

// ----- 41 Setup fallbacks: what each step offers when it goes wrong -----

const fallbackCard = (step, title, problem, detail, actions, toneName = "warn") =>
  col(
    {
      name: `fallback/${step}`,
      sizingH: "fill",
      gap: 10,
      padding: 16,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(),
    },
    [
      row({ sizingH: "fill", gap: 8 }, [chip(`Step ${step}`), t(title, "bodyStrong")]),
      banner(toneName, toneName === "danger" ? "warning" : "info", problem, detail),
      row({ sizingH: "fill", gap: 6 }, actions),
    ],
  );

const fallbackRow = (cards) => row({ sizingH: "fill", gap: 16, crossAlign: "min" }, cards);

const fallbacks = col(
  {
    name: "41 Setup, when a step goes wrong",
    width: SCREEN_WIDE,
    padding: [32, 40, 40, 40],
    gap: 16,
    fill: c.app,
  },
  [
    col({ gap: 4, sizingH: "fill" }, [
      t("When a setup step goes wrong", "title"),
      para(
        "Every step has a way forward. Nothing is a dead end: there is always a retry, a manual way, or a different route to the same place.",
        "body",
        c.text2,
      ),
    ]),
    fallbackRow([
      fallbackCard(
        1,
        "Language",
        "Your computer's language is not one Markas has yet",
        "Markas starts in English. Pick Bahasa Indonesia here or later in Settings.",
        [
          button("Use English", { kind: "primary", size: "sm" }),
          button("Bahasa Indonesia", { size: "sm" }),
        ],
        "info",
      ),
      fallbackCard(
        2,
        "Engines: install failed",
        "Codex could not be installed: no internet connection",
        "Markas tried twice. You can retry, install it yourself with the command below, or point Markas at a copy you already have.",
        [
          button("Retry", { kind: "primary", size: "sm", iconName: "refresh" }),
          button("Copy install command", { size: "sm", iconName: "terminal" }),
          button("Locate it", { size: "sm", iconName: "folder" }),
        ],
        "danger",
      ),
    ]),
    fallbackRow([
      fallbackCard(
        2,
        "Engines: sign-in not finished",
        "Codex sign-in has waited 5 minutes",
        "The login page may be closed or blocked. Open it again, sign in from a terminal instead, or skip Codex for now.",
        [
          button("Open login again", { kind: "primary", size: "sm", iconName: "external" }),
          button("Sign in from a terminal", { size: "sm", iconName: "terminal" }),
          button("Skip Codex", { kind: "ghost", size: "sm" }),
        ],
      ),
      fallbackCard(
        2,
        "Engines: none ready",
        "No engine is signed in yet, so Continue stays locked",
        "Markas needs one engine to run bots. Sign in to one you have, or install the other.",
        [
          button("Sign in to Claude Code", { kind: "primary", size: "sm" }),
          button("Install Codex", { size: "sm", iconName: "download" }),
          button("Get help", { kind: "ghost", size: "sm", iconName: "external" }),
        ],
      ),
    ]),
    fallbackRow([
      fallbackCard(
        3,
        "Default model",
        "Claude Code did not list its models",
        "Markas uses the engine's own default until the list loads. You can still continue.",
        [
          button("Use the engine's default", { kind: "primary", size: "sm" }),
          button("Retry", { size: "sm", iconName: "refresh" }),
          button("Type a model name", { kind: "ghost", size: "sm", iconName: "pencil" }),
        ],
      ),
      fallbackCard(
        4,
        "Consent",
        "You did not tick the box",
        "Markas cannot run bots without it. Nothing is installed or started until you agree.",
        [
          button("Back", { size: "sm", iconName: "chevronLeft" }),
          button("Quit Markas", { kind: "ghost", size: "sm" }),
        ],
        "info",
      ),
    ]),
    fallbackRow([
      fallbackCard(
        5,
        "Meet Dispatch",
        "Dispatch could not start: Claude Code hit its usage limit",
        "Dispatch can run on your backup engine, or you can make the bot without it.",
        [
          button("Use Codex for Dispatch", { kind: "primary", size: "sm" }),
          button("Pick a ready-made bot", { size: "sm", iconName: "team" }),
          button("Fill in a form", { kind: "ghost", size: "sm", iconName: "pencil" }),
        ],
        "danger",
      ),
      fallbackCard(
        6,
        "Describe: draft failed",
        "Dispatch could not turn the chat into a draft",
        "Your messages are kept. Try again, answer in a form instead, or start from a ready-made bot.",
        [
          button("Draft again", { kind: "primary", size: "sm", iconName: "refresh" }),
          button("Fill in a form", { size: "sm", iconName: "pencil" }),
          button("Pick a ready-made bot", { kind: "ghost", size: "sm" }),
        ],
        "danger",
      ),
    ]),
    fallbackRow([
      fallbackCard(
        6,
        "Ready-made: bad bot file",
        "scout.bot.md could not be imported: line 4 has no name",
        "Nothing was added. Fix the file and import it again, or let Dispatch repair it.",
        [
          button("Ask Dispatch to fix it", { kind: "primary", size: "sm" }),
          button("Choose another file", { size: "sm", iconName: "file" }),
        ],
        "danger",
      ),
      fallbackCard(
        7,
        "Create: folder in use",
        "~/.markas/bots/scout already exists",
        "Markas never writes over a folder. Use a new folder, or adopt the existing one if it is an old Scout.",
        [
          button("Use scout-2", { kind: "primary", size: "sm" }),
          button("Choose a folder", { size: "sm", iconName: "folder" }),
          button("Adopt it", { kind: "ghost", size: "sm" }),
        ],
      ),
    ]),
    fallbackRow([
      fallbackCard(
        7,
        "Create: first run failed",
        "Scout was created, but its test run could not open status.github.com",
        "The bot is saved. Open its chat to see what happened, or skip the test run.",
        [
          button("Open Scout's chat", { kind: "primary", size: "sm" }),
          button("Run the test again", { size: "sm", iconName: "refresh" }),
          button("Skip the test", { kind: "ghost", size: "sm" }),
        ],
        "danger",
      ),
    ]),
  ],
);

export default [
  { name: "01c First run, default model", spec: defaultModel },
  { name: "36 First run, meet Dispatch", spec: meetDispatch },
  { name: "37 First run, describe with Dispatch", spec: describeChat },
  { name: "38 First run, ready-made bots", spec: readyMade },
  { name: "39 First run, review and create", spec: review },
  { name: "40 After setup, first bot", spec: afterSetup },
  { name: "41 Setup, when a step goes wrong", spec: fallbacks },
];
