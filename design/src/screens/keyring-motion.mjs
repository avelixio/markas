// 30b Keyring interactions: what moves in the Keyring, why, and for how long. One rhythm for
// all of it, from the motion tokens in src/renderer/src/ui/tokens.css: things arrive slowing
// down (180 ms), leave faster than they came (120 ms), and only transform and opacity animate.
// With reduced motion on, every state is shown at once.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import { chip, edge, hspace, outline, para, t } from "../parts.mjs";
import { c, RADIUS, SCREEN, SIZE } from "../tokens.mjs";

const stage = (label, node, note) =>
  col({ gap: 6, crossAlign: "min" }, [
    node,
    t(label, "smallStrong", c.text2),
    note ? t(note, "small", c.text3) : null,
  ]);

const arrow = () => box({ width: 20, height: SIZE.control }, [icon("arrowRight", c.text3, 14)]);

const stepRow = (title, why, stages) =>
  row({ sizingH: "fill", gap: 20, padding: [12, 0, 12, 0], ...edge("bottom"), crossAlign: "min" }, [
    col({ width: 230, gap: 4 }, [t(title, "bodyStrong"), para(why, "small", c.text3)]),
    ...stages.flatMap((stageNode, index) => (index === 0 ? [stageNode] : [arrow(), stageNode])),
  ]);

const saveButton = (label, opacity = 1, spinning = false) =>
  row(
    {
      height: SIZE.control,
      padding: [0, 12, 0, 12],
      gap: 6,
      mainAlign: "center",
      cornerRadius: RADIUS.control,
      fill: c.accent,
      opacity,
    },
    [icon(spinning ? "refresh" : "lock", c.onAccent), t(label, "bodyStrong", c.onAccent)],
  );

const miniDialog = (opacity, scale) =>
  col(
    {
      width: Math.round(150 * scale),
      height: Math.round(70 * scale),
      padding: 10,
      gap: 6,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      opacity,
      ...outline(c.lineStrong),
    },
    [
      t("Add a key", "smallStrong"),
      box({ width: 90, height: 8, cornerRadius: 4, fill: c.raised }, []),
    ],
  );

const field = (value, invalid) =>
  col({ gap: 4 }, [
    row(
      {
        width: 180,
        height: SIZE.control,
        padding: [0, 10, 0, 10],
        cornerRadius: RADIUS.control,
        fill: c.raised,
        ...outline(invalid ? c.danger : c.lineStrong),
      },
      [t(value, "mono", value ? c.text : c.text3)],
    ),
    invalid
      ? row({ gap: 4 }, [icon("warning", c.danger, 12), t("Write the website", "small", c.danger)])
      : t("Only this exact site.", "small", c.text3),
  ]);

const more = (open) =>
  col({ width: 210, gap: 6 }, [
    row({ gap: 6 }, [
      icon(open ? "chevronDown" : "chevronRight", c.text2, 14),
      t("More options", "smallStrong", c.text2),
      open ? null : t("Automatically", "small", c.text3),
    ]),
    open
      ? col(
          { sizingH: "fill", padding: 8, gap: 4, cornerRadius: RADIUS.control, ...outline(c.line) },
          [
            t("Two-step setup key", "small", c.text2),
            box({ width: 150, height: 8, cornerRadius: 4, fill: c.raised }, []),
          ],
        )
      : null,
  ]);

const notice = (opacity) =>
  row({ gap: 6, opacity }, [
    icon("check", c.accentText, 12),
    t("Saved app.example.com. Pico can use it now.", "small", c.accentText),
  ]);

const keyRow = (wash) =>
  row(
    {
      width: 230,
      height: 36,
      padding: [0, 10, 0, 10],
      gap: 8,
      cornerRadius: RADIUS.control,
      fill: wash ? c.accentSoft : c.surface,
      ...outline(c.line),
    },
    [icon("user", c.text3, 14), t("app.example.com", "mono", c.text), hspace(), botSigilDot()],
  );

const botSigilDot = () => box({ width: 14, height: 14, cornerRadius: 4, fill: c.accent }, []);

const card = (state) =>
  col(
    {
      width: 200,
      padding: 10,
      gap: 6,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      opacity: state === "arriving" ? 0.5 : 1,
      ...outline(c.accent),
    },
    state === "saved"
      ? [
          row({ gap: 6 }, [
            icon("check", c.accentText, 14),
            t("Saved for Atlas", "smallStrong", c.accentText),
          ]),
        ]
      : [
          row({ gap: 6 }, [
            icon("key", c.accentText, 14),
            t("Atlas asks for a login", "smallStrong"),
          ]),
          box({ width: 160, height: 8, cornerRadius: 4, fill: c.raised }, []),
        ],
  );

const spec = col(
  {
    name: "30b Keyring interactions",
    width: SCREEN.width,
    height: SCREEN.height,
    padding: [28, 32, 24, 32],
    gap: 8,
    fill: c.app,
    clip: true,
  },
  [
    col({ gap: 4, sizingH: "fill" }, [
      t("Keyring interactions", "title"),
      para(
        "Each movement shows what changed: where a dialog came from, what opened, what is wrong, and where a saved key went. Arrivals take 180 ms and slow down; exits take 120 ms. Reduced motion shows the end state at once.",
        "body",
        c.text2,
      ),
    ]),
    stepRow(
      "Dialog opens and closes",
      "The scrim fades in 160 ms; the dialog rises 8 px and grows from 97% in 180 ms. Escape or Cancel closes it in 120 ms.",
      [
        stage("Starts", miniDialog(0.3, 0.92), "97%, 8 px lower"),
        stage("Open", miniDialog(1, 1), "180 ms, slowing down"),
        stage("Closing", miniDialog(0.4, 0.95), "120 ms, speeding up"),
      ],
    ),
    stepRow(
      "More options",
      "The chevron turns a quarter; the options fade down 4 px. The summary hides once they show.",
      [
        stage("Folded", more(false), "Summary in one line"),
        stage("Open", more(true), "Chevron 90°, 160 ms"),
      ],
    ),
    stepRow(
      "A missing field",
      "Only after Save: the border turns red, the sentence fades in under it, and focus moves to the first one. Typing clears it at once.",
      [
        stage("Before Save", field("", false)),
        stage("After Save", field("", true), "Message fades in 140 ms"),
        stage("While typing", field("https://app", false), "Cleared, no delay"),
      ],
    ),
    stepRow(
      "Saving",
      "The button keeps its width, its lock turns into a turning arrow, and nothing else can be pressed twice.",
      [
        stage("Ready", saveButton("Save key")),
        stage("Saving", saveButton("Saving", 0.85, true), "Arrow turns, 900 ms a turn"),
        stage("Done", chip("Dialog closes", { toneName: "accent", iconName: "check" })),
      ],
    ),
    stepRow(
      "Where the key went",
      "The notice slides down 6 px and stays 8 seconds. The new row gets a mint wash that fades over 1.6 s, so the eye finds it.",
      [
        stage("Notice", notice(1), "Arrives 180 ms, leaves 120 ms"),
        stage("New row", keyRow(true), "Mint wash"),
        stage("Settled", keyRow(false), "After 1.6 s"),
      ],
    ),
    stepRow(
      "A bot asks for a key",
      "The card rises into the chat. Once saved it shows a check for 600 ms before the bot carries on.",
      [
        stage("Arrives", card("arriving"), "Rises 8 px, 200 ms"),
        stage("Asking", card("asking")),
        stage("Saved", card("saved"), "Check for 600 ms"),
      ],
    ),
  ],
);

export default { name: "30b Keyring interactions", spec };
