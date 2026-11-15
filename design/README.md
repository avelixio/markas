# Markas design

The Markas UI is designed in [FigCraft](https://github.com/storytold/figcraft) before it is coded.
The design file is generated from scripts, so it can always be rebuilt and reviewed as a diff.

## What is here

| Path | What it is |
| --- | --- |
| `markas.figcraft` | The design file, a build output that is not kept in git. Open it in FigCraft. |
| `exports/` | One PNG per frame at 2x, a build output that is not kept in git. |
| `src/tokens.mjs` | Colours (Dark and Light), type scale, spacing, radius, sizes. |
| `src/icons.mjs` | The Markas icon set, drawn here on a 16 unit grid. |
| `src/parts.mjs` | Atoms: sigils, buttons, chips, inputs, toggles, banners. |
| `src/shell.mjs` | The app shell: nav rail, sidebar, conversation, composer, right panel. |
| `src/screens/` | The screens. |
| `src/foundations/` | The foundations sheet. |
| `tools/` | The FigCraft MCP client and the small layout DSL the sources use. |
| `build.mjs` | Builds the file and the exports. |

## Build

FigCraft's CLI must be at `~/.markas/tools/figcraft/` or named by `FIGCRAFT_CLI`.

```bash
node design/build.mjs                # everything: saves markas.figcraft and exports/
node design/build.mjs --only areas   # only matching screen modules, to exports/_draft/
```

Edits made by hand inside `markas.figcraft` are lost on the next build.
Change the sources, or tell whoever maintains them what to change.

## Names

The interface uses the Markas glossary in [`docs/glossary.md`](../docs/glossary.md).

## Design decisions

- **Own system.**
Markas has its own look, icons and copy.
- **Identity.**
Markas means headquarters: warm ink neutrals, one mint signal colour, dense rows.
- **Sigils, not faces.**
A bot is a signal-flag tile: one of 8 patterns in one of 8 colours.
People are round monograms, so a person is never mistaken for a bot.
- **Transcript, not bubbles.**
Messages sit in one left-aligned reading column capped at 820 px.
- **Navigation rail.**
Chats, Rooms, Rounds, Keyring, Switchboard, Optimizer, Archive and Logbook are areas, each one click away.
- **Colour roles.**
Every colour is a variable with a Dark and a Light value.
Screens are drawn in Dark; frame `05b` shows the same screen in Light.
- **Flows.**
The screens follow the seven main user flows, plus the vault, gate, routines and login-health screens.

## Screens

| Frame | Flow |
| --- | --- |
| 00 | Foundations |
| 01, 02 | First run: engines (every engine has an action: install, sign in, or wait for sign-in), consent |
| 03, 04 | Create a bot: describe, review the draft |
| 05, 05b | Main layout with the Browser panel, Dark and Light |
| 06 | Messages while busy: the queue |
| 07 | Bot to bot work |
| 08, 09 | Files panel, Bot settings panel |
| 10 | Browser hand-off |
| 11 | Approval card and secure entry card |
| 12 | Keyring |
| 13 | Logbook |
| 14 | Rounds and run history |
| 15 | Switchboard and login health |
| 16 | Notifications and the undo toast |
| 17 | Status system: every bot state and its action |
| 18 | Needs an answer, needs sign-in |
| 19 | Empty workspace: Dispatch in the middle until the first bot exists |
| 20 | App settings |
| 21 | Signal and beacon: presence outside the window, disconnected and away states |
| 22 | Fuel: how much of each engine's plan is left |
| 23 | Archive: every file in one place |
| 24 | Rounds as a calendar |
| 25 | Add a key: named, bound to one exact site, shared per bot |
| 01a | First run: language |
| 01c | First run: the default model, engines on the left and models on the right |
| 05c | Main layout in Bahasa Indonesia |
| 26 | Component states |
| 27, 28, 29 | Message, sidebar and composer interactions |
| 30 | Held: usage limit, and waiting on another bot |
| 31 | Confirmations |
| 32 | Empty states |
| 33 | New round |
| 34 | Loading and errors |
| 35 | Room |
| 36 | First run: meet Dispatch, in the middle of the screen |
| 37 | First run: describe the bot in a chat with Dispatch |
| 38 | First run: ready-made bots |
| 39 | First run: review and create |
| 40 | After setup: Dispatch pinned at the top |
| 41 | Setup fallbacks: what each step offers when it goes wrong |
| 42 | Optimizer: what saves tokens, how full each conversation is, and what was saved |
| 43 | Deleted bots in Settings, and the undo notice after a delete |

## Languages

Markas ships in English and Bahasa Indonesia.
Screens are drawn in English, and `src/i18n.mjs` holds the Indonesian text and a `translate()` helper that redraws a screen in it.
Translating a screen is also the check that a longer word still fits.

## Not designed yet

- Narrow window layouts.
- Indonesian text for screens other than the main one.
- The design uses layout frames, not FigCraft components and text styles.
Turning the atoms into real components is the next step before handoff.

The design guidance consulted was the `ui-ux-pro-max` skill (MIT), used as a reference for style, density and accessibility checks.
