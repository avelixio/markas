// One screen per interaction: component states, and what happens when you act on a message,
// the sidebar and the composer.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  button,
  checkbox,
  chip,
  edge,
  hspace,
  iconButton,
  input,
  kbd,
  outline,
  para,
  personAvatar,
  statusDot,
  t,
  toggle,
} from "../parts.mjs";
import {
  appScreen,
  BOTS,
  botSigil,
  chatHeader,
  dayMarker,
  sidebar,
  toolLine,
  userMessage,
} from "../shell.mjs";
import { c, RADIUS, SCREEN, SIZE } from "../tokens.mjs";

const shadow = {
  effects: [{ type: "dropShadow", color: "#00000099", offset: [0, 10], radius: 28 }],
};
const focusRing = { stroke: c.accent, strokeWeight: 2, strokeAlign: "outside" };

const sheet = (name, title, note, children) =>
  col(
    {
      name,
      width: SCREEN.width,
      height: SCREEN.height,
      padding: [28, 32, 24, 32],
      gap: 20,
      fill: c.app,
      clip: true,
    },
    [
      col({ gap: 4, sizingH: "fill" }, [t(title, "title"), para(note, "body", c.text2)]),
      ...children,
    ],
  );

/** A sample that takes the full width of its column, with its caption under it. */
const wide = (label, node) => col({ gap: 6, sizingH: "fill" }, [node, t(label, "small", c.text3)]);

const labelled = (label, node) =>
  col({ gap: 6, crossAlign: "min" }, [node, t(label, "small", c.text3)]);

// ----- 26 Component states -----

const stateRow = (title, items) =>
  row({ sizingH: "fill", gap: 24, padding: [12, 0, 12, 0], ...edge("bottom"), crossAlign: "max" }, [
    row({ width: 150 }, [t(title, "bodyStrong")]),
    ...items.map(([label, node]) => labelled(label, node)),
  ]);

const btn = (extra, label = "Save key") =>
  row(
    {
      height: SIZE.control,
      padding: [0, 12, 0, 12],
      gap: 6,
      mainAlign: "center",
      cornerRadius: RADIUS.control,
      fill: c.accent,
      ...extra,
    },
    [icon("lock", c.onAccent), t(label, "bodyStrong", c.onAccent)],
  );

const field = (value, extra, textColor = c.text) =>
  row(
    {
      width: 190,
      height: SIZE.control,
      padding: [0, 10, 0, 10],
      cornerRadius: RADIUS.control,
      fill: c.raised,
      ...outline(c.lineStrong),
      ...extra,
    },
    [t(value, "body", textColor)],
  );

const listRow = (extra, tail) =>
  row({ width: 230, padding: [7, 8, 7, 8], gap: 10, cornerRadius: RADIUS.control + 2, ...extra }, [
    botSigil("atlas", 28),
    col({ gap: 1, sizingH: "fill" }, [
      t("Atlas", "bodyStrong"),
      t("Stock is 3.410 units.", "small", c.text2),
    ]),
    tail ?? null,
  ]);

const componentStates = sheet(
  "26 Component states",
  "Component states",
  "Every control in each state it can be in. Focus is always a 2 px mint ring outside the control, so it shows on any background.",
  [
    stateRow("Primary button", [
      ["Default", btn({})],
      ["Hover", btn({ opacity: 0.9 })],
      ["Focus", btn(focusRing)],
      ["Pressed", btn({ opacity: 0.78 })],
      ["Working", btn({ opacity: 0.9 }, "Saving")],
      ["Disabled", btn({ opacity: 0.4 })],
    ]),
    stateRow("Secondary button", [
      ["Default", button("Edit first", { iconName: "pencil" })],
      [
        "Hover",
        row({ fill: c.overlay, cornerRadius: RADIUS.control }, [
          button("Edit first", { iconName: "pencil" }),
        ]),
      ],
      [
        "Focus",
        row({ cornerRadius: RADIUS.control, ...focusRing }, [
          button("Edit first", { iconName: "pencil" }),
        ]),
      ],
      ["Disabled", row({ opacity: 0.4 }, [button("Edit first", { iconName: "pencil" })])],
      ["Danger", button("Delete bot", { kind: "danger", iconName: "trash" })],
      ["Quiet", button("Not now", { kind: "ghost" })],
    ]),
    stateRow("Text field", [
      ["Empty", field("Name", {}, c.text3)],
      ["Filled", field("admin-read", {})],
      ["Focus", field("admin-read", { ...outline(c.accent), strokeWeight: 2 })],
      [
        "Error",
        col({ gap: 4 }, [
          field("", outline(c.danger)),
          t("A key needs a name.", "small", c.danger),
        ]),
      ],
      ["Disabled", field("admin-read", { opacity: 0.4 })],
    ]),
    stateRow("Crew row", [
      ["Default", listRow({})],
      ["Hover", listRow({ fill: c.surface }, icon("more", c.text3))],
      ["Selected", listRow({ fill: c.raised })],
      ["Focus", listRow({ ...focusRing })],
      [
        "Dragging",
        listRow({ fill: c.overlay, ...outline(c.accent), ...shadow }, icon("grip", c.text3)),
      ],
    ]),
    stateRow("Switches", [
      ["Off", toggle(false)],
      ["On", toggle(true)],
      ["Focus", row({ cornerRadius: RADIUS.full, ...focusRing }, [toggle(true)])],
      ["Disabled", row({ opacity: 0.4 }, [toggle(true)])],
      ["Unchecked", checkbox(false)],
      ["Checked", checkbox(true)],
    ]),
    stateRow("Status chips", [
      ["Idle", chip("Idle", { dot: true })],
      ["Working", chip("Working", { toneName: "info", dot: true })],
      ["Waiting", chip("Waiting on you", { toneName: "warn", dot: true })],
      ["Failed", chip("Failed", { toneName: "danger", dot: true })],
      ["Done", chip("Finished", { toneName: "accent", dot: true })],
    ]),
  ],
);

// ----- 27 Message interactions -----

const reaction = (symbol, count, mine) =>
  row(
    {
      height: 22,
      padding: [0, 8, 0, 6],
      gap: 5,
      cornerRadius: RADIUS.full,
      fill: mine ? c.accentSoft : c.raised,
      ...(mine ? outline(c.accent) : {}),
    },
    [
      icon(symbol, mine ? c.accentText : c.text2, 12),
      t(String(count), "smallStrong", mine ? c.accentText : c.text2),
    ],
  );

const hoverActions = row(
  {
    name: "MessageActions",
    height: 30,
    padding: [0, 4, 0, 4],
    gap: 2,
    cornerRadius: RADIUS.control + 2,
    fill: c.overlay,
    ...outline(c.lineStrong),
    ...shadow,
  },
  [
    iconButton("check", { size: 24 }),
    iconButton("reply", { size: 24 }),
    iconButton("thread", { size: 24 }),
    iconButton("pin", { size: 24 }),
    iconButton("more", { size: 24 }),
  ],
);

const reactionPicker = row(
  {
    name: "ReactionPicker",
    height: 36,
    padding: [0, 6, 0, 6],
    gap: 2,
    cornerRadius: RADIUS.control + 2,
    fill: c.overlay,
    ...outline(c.lineStrong),
    ...shadow,
  },
  ["check", "sparkle", "eye", "warning", "zap", "clock"].map((name, index) =>
    row(
      {
        width: 28,
        height: 28,
        mainAlign: "center",
        cornerRadius: RADIUS.control,
        fill: index === 0 ? c.raised : "none",
      },
      [icon(name, index === 0 ? c.accentText : c.text2)],
    ),
  ),
);

const steps = col(
  {
    name: "Steps",
    sizingH: "fill",
    gap: 0,
    padding: [4, 12, 4, 12],
    cornerRadius: RADIUS.card,
    fill: c.surface,
    ...outline(),
  },
  [
    ...[
      ["globe", "Opened metrics.example.com", "1,2 s"],
      ["key", "Filled sign-in with the key Metrics (Atlas)", "0,4 s"],
      ["pointer", "Clicked Dashboards, stock overview", "0,9 s"],
      ["eye", "Read the stock level tile", "0,3 s"],
    ].map(([name, label, time], index) =>
      row({ sizingH: "fill", gap: 8, height: 30, ...(index < 3 ? edge("bottom") : {}) }, [
        icon(name, c.text3, 12),
        t(label, "small", c.text2),
        hspace(),
        t(time, "mono", c.text3, { fontSize: 11 }),
      ]),
    ),
  ],
);

const replyQuote = row(
  {
    sizingH: "fill",
    gap: 8,
    padding: [6, 10, 6, 10],
    cornerRadius: RADIUS.control,
    fill: c.raised,
    ...edge("left", c.accent),
    strokeLeftWeight: 2,
  },
  [
    icon("reply", c.text3, 12),
    t("Atlas", "smallStrong", c.text2),
    t("Stock is 3.410 units as of 09:00.", "small", c.text3),
    hspace(),
    icon("close", c.text3, 12),
  ],
);

const messageInteractions = appScreen("27 Message interactions", "Chats", [
  sidebar({ active: "atlas" }),
  col({ name: "Conversation", sizingH: "fill", sizingV: "fill", fill: c.app }, [
    chatHeader("atlas", { state: "idle", panel: "none" }),
    col({ sizingH: "fill", sizingV: "fill", crossAlign: "center" }, [
      col(
        {
          sizingH: "fill",
          sizingV: "fill",
          maxWidth: 820,
          padding: [14, 10, 14, 10],
          gap: 12,
          mainAlign: "max",
        },
        [
          dayMarker("Today"),
          userMessage(
            "08:58",
            "Check the stock level now and tell me if it is below the reorder line.",
          ),
          box({ sizingH: "fill", width: 1, height: 30 }, [
            box({ x: 560, y: 0, width: 1, height: 1 }, [hoverActions]),
          ]),
          col(
            {
              name: "message/hovered",
              sizingH: "fill",
              gap: 8,
              padding: [8, 14, 10, 14],
              cornerRadius: RADIUS.card,
              fill: c.surface,
            },
            [
              row({ gap: 12, sizingH: "fill", crossAlign: "min" }, [
                botSigil("atlas", 24),
                col({ gap: 6, sizingH: "fill" }, [
                  row({ gap: 8 }, [
                    t("Atlas", "bodyStrong"),
                    t("09:00", "small", c.text3),
                    chip("Hovered", { toneName: "info" }),
                  ]),
                  row({ gap: 6 }, [
                    toolLine("globe", "4 steps", "2,8 s"),
                    t("Steps open in place", "small", c.text3),
                  ]),
                  steps,
                  para(
                    "Stock is 3.410 units as of 09:00. That is above the 2.000 unit reorder line, so I did not message Sam.",
                  ),
                  row({ gap: 6 }, [
                    reaction("check", 1, true),
                    reaction("eye", 2, false),
                    row(
                      {
                        width: 26,
                        height: 22,
                        mainAlign: "center",
                        cornerRadius: RADIUS.full,
                        ...outline(c.lineStrong),
                        dashes: [3, 3],
                      },
                      [icon("plus", c.text3, 12)],
                    ),
                  ]),
                ]),
              ]),
            ],
          ),
          row({ gap: 12, sizingH: "fill" }, [
            box({ width: 24, height: 1 }),
            reactionPicker,
            t("React: a quick mark instead of a reply", "small", c.text3),
          ]),
          col(
            {
              sizingH: "fill",
              padding: [10, 10, 8, 12],
              gap: 8,
              cornerRadius: RADIUS.panel,
              fill: c.surface,
              ...outline(c.accent),
            },
            [
              replyQuote,
              para("And how does that compare with yesterday at the same hour?", "body"),
              row({ sizingH: "fill", gap: 4 }, [
                iconButton("attach", { size: 28 }),
                hspace(),
                t("Replying to Atlas", "small", c.text3),
                row(
                  {
                    width: 28,
                    height: 28,
                    mainAlign: "center",
                    cornerRadius: RADIUS.full,
                    fill: c.accent,
                  },
                  [icon("send", c.onAccent)],
                ),
              ]),
            ],
          ),
        ],
      ),
    ]),
  ]),
  col(
    {
      name: "Legend",
      width: 300,
      sizingV: "fill",
      padding: 16,
      gap: 12,
      fill: c.sidebar,
      ...edge("left"),
    },
    [
      t("What you can do to a message", "label", c.text3),
      ...[
        ["check", "React", "A mark the bot can see. No reply needed."],
        ["reply", "Reply", "Quotes the message above the composer."],
        ["thread", "Move to a thread", "Continues it beside the main chat."],
        ["pin", "Pin", "Keeps it at the top of this chat."],
        ["more", "More", "Copy, show steps, delete."],
      ].map(([name, label, body]) =>
        row({ sizingH: "fill", gap: 10, crossAlign: "min" }, [
          row(
            {
              width: 24,
              height: 24,
              mainAlign: "center",
              cornerRadius: RADIUS.control,
              fill: c.raised,
            },
            [icon(name, c.text2, 12)],
          ),
          col({ gap: 1, sizingH: "fill" }, [t(label, "bodyStrong"), para(body, "small", c.text2)]),
        ]),
      ),
    ],
  ),
]);

// ----- 28 Sidebar interactions -----

const menu = (items) =>
  col(
    {
      name: "Menu",
      width: 210,
      padding: 4,
      gap: 0,
      cornerRadius: RADIUS.card,
      fill: c.overlay,
      ...outline(c.lineStrong),
      ...shadow,
    },
    items.map(([name, label, hint, danger]) =>
      label === "-"
        ? box({ sizingH: "fill", width: 1, height: 9 }, [
            box({ x: 0, y: 4, width: 202, height: 1, fill: c.line }),
          ])
        : row(
            {
              sizingH: "fill",
              height: 30,
              padding: [0, 8, 0, 8],
              gap: 8,
              cornerRadius: RADIUS.control,
              fill: hint === "hover" ? c.raised : "none",
            },
            [
              icon(name, danger ? c.danger : c.text2),
              t(label, "body", danger ? c.danger : c.text),
              hspace(),
              hint && hint !== "hover" ? kbd(hint) : null,
            ],
          ),
    ),
  );

const miniRow = (key, preview, extra = {}) =>
  row(
    { sizingH: "fill", padding: [7, 8, 7, 8], gap: 10, cornerRadius: RADIUS.control + 2, ...extra },
    [
      botSigil(key, 28),
      col({ gap: 1, sizingH: "fill" }, [
        t(BOTS[key].name, "bodyStrong"),
        t(preview, "small", c.text2),
      ]),
    ],
  );

const panelCard = (title, note, children) =>
  col(
    {
      name: `panel/${title}`,
      sizingH: "fill",
      sizingV: "fill",
      padding: 14,
      gap: 8,
      cornerRadius: RADIUS.card,
      fill: c.sidebar,
      ...outline(),
    },
    [
      col({ gap: 2, sizingH: "fill" }, [t(title, "heading"), para(note, "small", c.text2)]),
      ...children,
    ],
  );

const sectionLabel = (label, tail) =>
  row({ sizingH: "fill", padding: [8, 8, 2, 8], gap: 6 }, [
    t(label, "label", c.text3),
    hspace(),
    tail ?? null,
  ]);

const sidebarInteractions = sheet(
  "28 Sidebar interactions",
  "Sidebar interactions",
  "Folders group bots. A right click or the dots open the menu. Drag to reorder, pin, or drop a bot into a folder.",
  [
    row({ sizingH: "fill", sizingV: "fill", gap: 16, crossAlign: "min" }, [
      panelCard(
        "Folders",
        "A folder is only a way to group. It changes nothing about the bots in it.",
        [
          sectionLabel("Crew", icon("plus", c.text3, 12)),
          row({ sizingH: "fill", height: 30, padding: [0, 8, 0, 8], gap: 8 }, [
            icon("chevronDown", c.text3, 12),
            icon("folder", c.text2),
            t("Operations", "bodyStrong"),
            hspace(),
            t("3", "small", c.text3),
          ]),
          col({ sizingH: "fill", padding: [0, 0, 0, 14], gap: 2 }, [
            miniRow("atlas", "Stock is 3.410 units."),
            miniRow("juno", "Finish a sign-in step"),
            miniRow("sol", "Weekly report sent Monday."),
          ]),
          row({ sizingH: "fill", height: 30, padding: [0, 8, 0, 8], gap: 8 }, [
            icon("chevronRight", c.text3, 12),
            icon("folder", c.text2),
            t("Personal", "bodyStrong"),
            hspace(),
            t("2", "small", c.text3),
          ]),
          miniRow("mika", "Synced 14 notes."),
        ],
      ),
      panelCard("Row menu", "The same menu opens from the dots that appear on hover.", [
        miniRow("atlas", "Stock is 3.410 units.", { fill: c.raised }),
        menu([
          ["pin", "Pin to top", "hover"],
          ["folder", "Move to folder"],
          ["pencil", "Rename", "F2"],
          ["sliders", "Settings"],
          ["bell", "Tell me about"],
          ["-", "-"],
          ["pause", "Pause its queue"],
          ["trash", "Delete bot", "", true],
        ]),
      ]),
      panelCard(
        "Drag and drop",
        "A mint line shows where the bot will land. Dropping on a folder moves it in.",
        [
          miniRow("mika", "Synced 14 notes."),
          box({ sizingH: "fill", width: 1, height: 2, fill: c.accent, cornerRadius: 1 }),
          miniRow("pico", "Working: inbox summary", {
            fill: c.overlay,
            ...outline(c.accent),
            ...shadow,
          }),
          miniRow("nova", "Your brief for today is ready."),
          row(
            {
              sizingH: "fill",
              height: 34,
              padding: [0, 8, 0, 8],
              gap: 8,
              cornerRadius: RADIUS.control + 2,
              fill: c.accentSoft,
              ...outline(c.accent),
              dashes: [4, 4],
            },
            [
              icon("folder", c.accentText),
              t("Drop to move into Personal", "bodyStrong", c.accentText),
            ],
          ),
        ],
      ),
      panelCard("Search", "Finds bots, messages and files. Arrow keys move, Enter opens.", [
        input("stock", { iconName: "search", grow: true, trailing: kbd("Esc") }),
        sectionLabel("Bots"),
        miniRow("atlas", "Stock and dashboard checks", { fill: c.raised }),
        sectionLabel("Messages"),
        col({ sizingH: "fill", gap: 2, padding: [6, 8, 6, 8] }, [
          t("Atlas · Today 09:00", "small", c.text3),
          para("Stock is 3.410 units as of 09:00.", "body"),
        ]),
        sectionLabel("Files"),
        row({ sizingH: "fill", gap: 8, padding: [6, 8, 6, 8] }, [
          icon("file", c.text3),
          t("stock-history.csv", "body"),
        ]),
      ]),
    ]),
  ],
);

// ----- 29 Composer interactions -----

const composerShell = (extra, children) =>
  col(
    {
      sizingH: "fill",
      padding: [10, 10, 8, 12],
      gap: 10,
      cornerRadius: RADIUS.panel,
      fill: c.surface,
      ...outline(c.lineStrong),
      ...extra,
    },
    children,
  );

const composerBar = (sendOn, tail) =>
  row({ sizingH: "fill", gap: 4 }, [
    iconButton("attach", { size: 28 }),
    iconButton("zap", { size: 28 }),
    hspace(),
    tail ?? null,
    row(
      {
        width: 28,
        height: 28,
        mainAlign: "center",
        cornerRadius: RADIUS.full,
        fill: sendOn ? c.accent : c.raised,
      },
      [icon(sendOn ? "send" : "send", sendOn ? c.onAccent : c.text3)],
    ),
  ]);

const composerInteractions = sheet(
  "29 Composer interactions",
  "Composer interactions",
  "What the composer does as you type, attach, mention another bot, speak, and while the bot is busy.",
  [
    row({ sizingH: "fill", gap: 16, crossAlign: "min" }, [
      col({ sizingH: "fill", gap: 16 }, [
        wide(
          "Empty: send is off until there is something to send",
          composerShell({}, [
            para("Message Atlas", "body", c.text3),
            composerBar(false, t("Enter to send", "small", c.text3)),
          ]),
        ),
        wide(
          "Typing: Shift Enter adds a line",
          composerShell(outline(c.accent), [
            para("Compare today's stock with the same hour yesterday, and", "body"),
            composerBar(true, t("Enter to send", "small", c.text3)),
          ]),
        ),
        wide(
          "Files attached: remove one with its cross",
          composerShell({}, [
            row({ gap: 6 }, [
              chip("stock-history.csv", { iconName: "file" }),
              chip("shelf-photo.png", { iconName: "image" }),
              row(
                {
                  height: 22,
                  padding: [0, 8, 0, 8],
                  gap: 5,
                  cornerRadius: RADIUS.full,
                  fill: c.infoSoft,
                },
                [t("Uploading 62%", "smallStrong", c.info)],
              ),
            ]),
            para("Compare this export with today's reading.", "body"),
            composerBar(true),
          ]),
        ),
      ]),
      col({ sizingH: "fill", gap: 16 }, [
        wide(
          "Dragging a file over the window",
          composerShell({ fill: c.accentSoft, ...outline(c.accent), dashes: [5, 5] }, [
            row({ sizingH: "fill", height: 58, mainAlign: "center", gap: 10 }, [
              icon("download", c.accentText, 20),
              t("Drop to attach to this message", "heading", c.accentText),
            ]),
          ]),
        ),
        wide(
          "Mentioning another bot with @",
          col({ gap: 6, sizingH: "fill" }, [
            col(
              {
                width: 260,
                padding: 4,
                cornerRadius: RADIUS.card,
                fill: c.overlay,
                ...outline(c.lineStrong),
                ...shadow,
              },
              [
                miniRow("juno", "Admin console lookups", { fill: c.raised }),
                miniRow("sol", "Weekly conversion report"),
              ],
            ),
            composerShell(outline(c.accent), [para("Ask @ju", "body"), composerBar(true)]),
          ]),
        ),
        wide(
          "Speaking: the words appear as you talk",
          composerShell(outline(c.info), [
            row({ sizingH: "fill", gap: 10 }, [
              row(
                { gap: 3, crossAlign: "center" },
                [8, 16, 10, 22, 14, 6, 18, 12].map((h) =>
                  box({ width: 3, height: h, cornerRadius: 2, fill: c.info }),
                ),
              ),
              para("Check the stock level and tell me if", "body"),
            ]),
            composerBar(
              false,
              row({ gap: 6 }, [
                button("Cancel", { kind: "ghost", size: "sm" }),
                button("Done", { size: "sm", iconName: "check" }),
              ]),
            ),
          ]),
        ),
      ]),
      col({ width: 360, gap: 16 }, [
        wide(
          "Bot busy, set to queue",
          composerShell({}, [
            para("Then post the summary to my notes.", "body"),
            composerBar(
              true,
              row({ gap: 6 }, [
                chip("Will wait its turn", { iconName: "queue" }),
                statusDot("info", 6),
              ]),
            ),
          ]),
        ),
        wide(
          "Bot busy, set to steer",
          composerShell({}, [
            para("Stop, use yesterday's figure instead.", "body"),
            composerBar(
              true,
              chip("Changes the running turn", { toneName: "warn", iconName: "steer" }),
            ),
          ]),
        ),
        wide(
          "Answering a question",
          composerShell(outline(c.warn), [
            para("Type your answer", "body", c.text3),
            composerBar(false, t("Atlas is waiting on you", "small", c.warn)),
          ]),
        ),
        wide(
          "Disconnected: you can keep typing",
          composerShell({ opacity: 0.6 }, [
            para("Your message is kept and sent when Markas reconnects.", "body", c.text3),
            composerBar(false),
          ]),
        ),
      ]),
    ]),
    row({ gap: 8 }, [
      personAvatar("ME", 18),
      t(
        "Keyboard: Enter sends, Shift Enter adds a line, Up edits your last message, Esc leaves a reply.",
        "small",
        c.text3,
      ),
    ]),
  ],
);

export default [
  { name: "26 Component states", spec: componentStates },
  { name: "27 Message interactions", spec: messageInteractions },
  { name: "28 Sidebar interactions", spec: sidebarInteractions },
  { name: "29 Composer interactions", spec: composerInteractions },
];
