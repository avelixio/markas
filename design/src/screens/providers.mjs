// Providers on the Switchboard: what Markas found on this computer, and one Connect for each.
import { col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import { button, chip, hspace, input, outline, t } from "../parts.mjs";
import { appScreen, pageHeader } from "../shell.mjs";
import { c, RADIUS } from "../tokens.mjs";

const page = (name, header, children) =>
  appScreen(name, "Switchboard", [
    col({ name: "Page", sizingH: "fill", sizingV: "fill", fill: c.app }, [
      header,
      col({ sizingH: "fill", sizingV: "fill", padding: [0, 32, 24, 32], gap: 14 }, children),
    ]),
  ]);

const sectionTitle = (title, note) =>
  row({ sizingH: "fill", gap: 8, padding: [6, 0, 0, 0] }, [
    t(title, "label", c.text3),
    hspace(),
    note ? t(note, "small", c.text3) : null,
  ]);

/** One provider: its mark, what it is, whether it was found, how it stands, and the one next step. */
const providerRow = (
  name,
  detail,
  { iconName = "sliders", found = true, state, stateTone, action, actionKind = "primary" },
) =>
  row(
    {
      name: `provider/${name}`,
      sizingH: "fill",
      padding: [10, 14, 10, 14],
      gap: 12,
      cornerRadius: RADIUS.card,
      fill: c.surface,
      ...outline(),
    },
    [
      row(
        {
          width: 32,
          height: 32,
          mainAlign: "center",
          cornerRadius: RADIUS.control + 2,
          fill: c.raised,
        },
        [icon(iconName, c.text2)],
      ),
      col({ gap: 0, sizingH: "fill" }, [t(name, "bodyStrong"), t(detail, "small", c.text2)]),
      found ? chip("Detected", { toneName: "info", iconName: "check" }) : null,
      chip(state, { toneName: stateTone, dot: true }),
      action ? button(action, { size: "sm", kind: actionKind }) : null,
    ],
  );

/** A provider row opened for signing in: the ways in, and the one that is waiting. */
const signingIn = col(
  {
    name: "provider/OpenAI (signing in)",
    sizingH: "fill",
    padding: 14,
    gap: 10,
    cornerRadius: RADIUS.card,
    fill: c.surface,
    ...outline(c.accent),
  },
  [
    row({ sizingH: "fill", gap: 12 }, [
      row(
        {
          width: 32,
          height: 32,
          mainAlign: "center",
          cornerRadius: RADIUS.control + 2,
          fill: c.raised,
        },
        [icon("globe", c.text2)],
      ),
      col({ gap: 0, sizingH: "fill" }, [
        t("OpenAI", "bodyStrong"),
        t("No models until it is connected", "small", c.text2),
      ]),
      chip("Waiting for the browser", { toneName: "warn", dot: true }),
      button("Cancel", { size: "sm", kind: "ghost" }),
    ]),
    row({ gap: 8 }, [
      button("ChatGPT Pro/Plus (browser)", { size: "sm", kind: "primary", iconName: "external" }),
      button("ChatGPT Pro/Plus (headless)", { size: "sm" }),
      button("API key", { size: "sm", iconName: "key" }),
    ]),
    t(
      "Finish signing in on the page that opened. Markas waits here, and OpenCode keeps the sign-in: Markas never sees it.",
      "small",
      c.text2,
    ),
  ],
);

const providers = page(
  "15c Providers: found on this computer, then Connect",
  pageHeader(
    "Switchboard",
    "The engines and model providers your bots run on, and the logins they use.",
    [button("Scan again", { iconName: "refresh" })],
  ),
  [
    sectionTitle("Engines"),
    providerRow("Claude Code", "Version 2.1.231, signed in as you@example.com", {
      iconName: "sparkle",
      state: "Connected",
      stateTone: "accent",
    }),
    providerRow("Codex", "Version 0.150.0, found but not signed in", {
      iconName: "terminal",
      state: "Not connected",
      stateTone: "warn",
      action: "Connect",
    }),
    providerRow("OpenCode", "Version 1.14.20, 4 providers and 68 models", {
      iconName: "panel",
      state: "Connected",
      stateTone: "accent",
    }),
    sectionTitle("Found on this computer", "Model servers on their usual addresses"),
    providerRow("LM Studio", "Running on 127.0.0.1:1234 with 3 models loaded", {
      iconName: "activity",
      state: "Not connected",
      stateTone: "neutral",
      action: "Connect",
    }),
    providerRow("Ollama", "Nothing answered on 127.0.0.1:11434", {
      found: false,
      iconName: "activity",
      state: "Not found",
      stateTone: "neutral",
    }),
    row({ sizingH: "fill", gap: 8, padding: [6, 0, 0, 0] }, [
      t("Model providers through OpenCode", "label", c.text3),
      hspace(),
      input("Search 324 providers", { placeholder: true, iconName: "search", width: 260 }),
    ]),
    providerRow("Anthropic", "20 models", {
      iconName: "globe",
      state: "Connected",
      stateTone: "accent",
      action: "Disconnect",
      actionKind: "ghost",
      found: false,
    }),
    signingIn,
    providerRow("GitHub Copilot", "Asks which deployment first", {
      iconName: "globe",
      state: "Not connected",
      stateTone: "neutral",
      action: "Connect",
      actionKind: "secondary",
      found: false,
    }),
  ],
);

export default [{ name: "15c Providers: found on this computer, then Connect", spec: providers }];
