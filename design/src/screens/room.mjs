// A room: several bots and you in one conversation, with a lead that decides who answers.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import {
  button,
  chip,
  edge,
  hspace,
  iconButton,
  outline,
  para,
  settingRow,
  t,
  toggle,
} from "../parts.mjs";
import {
  appScreen,
  BOTS,
  botMessage,
  botSigil,
  composer,
  dayMarker,
  sidebar,
  toolLine,
  userMessage,
} from "../shell.mjs";
import { c, RADIUS, SIZE } from "../tokens.mjs";

const members = ["router", "atlas", "juno", "mika"];

const stack = (keys, size = 22) =>
  box(
    { width: size + (keys.length - 1) * (size - 7), height: size },
    keys.map((key, index) =>
      box({ x: index * (size - 7), y: 0, width: size, height: size }, [botSigil(key, size)]),
    ),
  );

const routing = (text, action) =>
  row(
    {
      name: "RoutingNote",
      sizingH: "fill",
      gap: 8,
      padding: [6, 12, 6, 12],
      cornerRadius: RADIUS.card,
      ...outline(),
    },
    [
      icon("steer", c.text3, 12),
      botSigil("router", 16),
      t(text, "small", c.text2),
      hspace(),
      button(action, { size: "sm", kind: "ghost" }),
    ],
  );

const header = row(
  {
    name: "RoomHeader",
    height: SIZE.header,
    sizingH: "fill",
    padding: [0, 16, 0, 16],
    gap: 10,
    ...edge("bottom"),
  },
  [
    row({ width: 28, height: 28, mainAlign: "center", cornerRadius: 8, fill: c.raised }, [
      icon("team", c.text2),
    ]),
    col({ gap: 0 }, [
      t("Stock room", "heading"),
      t("Keep stock levels and open orders in step", "small", c.text2),
    ]),
    stack(members),
    chip("Led by Dispatch", { iconName: "steer" }),
    hspace(),
    button("New conversation", { size: "sm", iconName: "plus" }),
    iconButton("sliders", { active: true }),
  ],
);

const memberRow = (key, note, lead) =>
  row({ sizingH: "fill", gap: 10, padding: [6, 0, 6, 0] }, [
    botSigil(key, 24),
    col({ gap: 0, sizingH: "fill" }, [t(BOTS[key].name, "bodyStrong"), t(note, "small", c.text2)]),
    lead ? chip("Lead", { toneName: "accent" }) : null,
  ]);

const room = appScreen("35 Room", "Chats", [
  sidebar({ active: "none" }),
  col({ name: "Conversation", sizingH: "fill", sizingV: "fill", fill: c.app }, [
    header,
    col({ sizingH: "fill", sizingV: "fill", crossAlign: "center" }, [
      col({ sizingH: "fill", sizingV: "fill", maxWidth: 820 }, [
        col(
          {
            sizingH: "fill",
            sizingV: "fill",
            padding: [14, 10, 10, 10],
            gap: 10,
            mainAlign: "max",
          },
          [
            dayMarker("Today"),
            userMessage(
              "10:12",
              "Order 88213 looks stuck. Is the stock there, and where is the order now?",
            ),
            routing(
              "Dispatch asked Atlas for the stock and Juno for the order",
              "Change who answers",
            ),
            botMessage("atlas", "10:13", [
              row({ gap: 6 }, [toolLine("globe", "Browser", "3 steps")]),
              "Stock is there: 3.410 units, well above what order 88213 needs.",
            ]),
            botMessage("juno", "10:16", [
              row({ gap: 6 }, [toolLine("globe", "Browser", "6 steps")]),
              "Order 88213 is Waiting for courier since 9 Nov 14:02. The courier asked for the label to be reprinted.",
            ]),
            botMessage("router", "10:16", [
              "So nothing is short. The order is only waiting on a reprinted label. Want me to ask Juno to reprint it?",
              row({ gap: 8 }, [
                button("Yes, reprint it", { kind: "primary", size: "sm" }),
                button("No, leave it", { size: "sm" }),
              ]),
            ]),
          ],
        ),
        composer("router", {}),
      ]),
    ]),
  ]),
  col(
    {
      name: "RoomPanel",
      width: 320,
      sizingV: "fill",
      padding: 16,
      gap: 12,
      fill: c.sidebar,
      ...edge("left"),
    },
    [
      t("Members", "label", c.text3),
      memberRow("router", "Decides who answers", true),
      memberRow("atlas", "Stock and dashboard checks"),
      memberRow("juno", "Admin console lookups"),
      memberRow("mika", "Notes and memory sync"),
      button("Add a bot", { size: "sm", iconName: "plus" }),
      box({ sizingH: "fill", width: 1, height: 1, fill: c.line }),
      t("This room", "label", c.text3),
      settingRow("Room memory", "Bots remember what is said here.", toggle(true)),
      settingRow("Rounds in this room", null, chip("1 round", { iconName: "routine" })),
      row({ gap: 8, sizingH: "fill" }, [
        button("Compact", { size: "sm" }),
        button("Clear history", { size: "sm", kind: "ghost" }),
      ]),
      hspace(),
      para(
        "A stopped task in a room offers Reassign or Cancel, so nothing is left hanging.",
        "small",
        c.text3,
      ),
    ],
  ),
]);

export default { name: "35 Room", spec: room };
