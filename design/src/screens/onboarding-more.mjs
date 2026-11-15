// The first two steps of the first run: pick a language, then pick how bots will run.
import { box, col, row } from "../../tools/dsl.mjs";
import { icon } from "../icons.mjs";
import { button, hspace, outline, para, radio, t } from "../parts.mjs";
import { c, RADIUS } from "../tokens.mjs";
import { panel, setupStage } from "./onboarding.mjs";

const choice = (title, body, on, extra) =>
  row(
    {
      name: `choice/${title}`,
      sizingH: "fill",
      gap: 12,
      padding: [12, 14, 12, 12],
      cornerRadius: RADIUS.card,
      crossAlign: "min",
      fill: on ? c.raised : "none",
      ...outline(on ? c.accent : c.line),
    },
    [
      box({ width: 16, height: 22 }, [box({ y: 3, width: 16, height: 16 }, [radio(on)])]),
      col({ gap: 2, sizingH: "fill" }, [t(title, "heading"), para(body, "small", c.text2)]),
      extra ?? null,
    ],
  );

const language = setupStage("01a First run, language", 1, "Choose your language", [
  panel([
    col({ gap: 6, sizingH: "fill" }, [
      t("Choose your language", "title"),
      para("Pilih bahasa Anda. You can change it later in Settings.", "body", c.text2),
    ]),
    choice("English", "Menus, buttons and messages in English.", true),
    choice("Bahasa Indonesia", "Menu, tombol dan pesan dalam Bahasa Indonesia.", false),
    para(
      "Your bots answer in whatever language you write to them. This only sets the language of Markas itself.",
      "small",
      c.text3,
    ),
    row({ sizingH: "fill", gap: 8 }, [
      row({ gap: 6 }, [
        icon("globe", c.text3, 12),
        t("Follows your computer's language by default", "small", c.text3),
      ]),
      hspace(),
      button("Continue", { kind: "primary", iconName: "arrowRight" }),
    ]),
  ]),
]);

export default [{ name: "01a First run, language", spec: language }];
