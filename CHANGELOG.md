# Changelog

What changed in Markas, newest first.

## Unreleased

- The Switchboard shows what Markas found on this computer, marked Detected, with one Connect for each: the engines, model servers such as LM Studio and Ollama, and every model provider OpenCode can use. Signing in happens in the browser, without a terminal.
- An engine that is not installed can be installed from the Switchboard.
- A tab the person took over offers to save a login in the Keyring too; the bot is then told in the chat, since it is not waiting on the tab.
- A login saved from a hand-off gets a name the Keyring accepts, made from the website.
- Bots are told not to end their turn asking the person to sign in, and to hand the tab over instead.
- When a bot asks about several things at once, every card is shown in turn instead of the last one hiding the others; a yes for the session on a command also answers the other command cards.
- A permission card for a website or for a saved key says that the yes for the session covers that one website or key.
- What a bot says before and after using a tool is set apart in its reply instead of running together.
- A chat shows its earlier messages while the first turn after Markas restarts is running.
- A link to a site without https no longer tries to load an icon the page refuses.
- OpenCode is a third engine: a bot can run on any model your OpenCode has, with the same access levels, Markas tools and bot browser as the other engines.
- A turn that an engine ends without an answer is shown as failed, with what to check, instead of looking finished.
- A bot on OpenCode that is told no explains what it could not do, instead of stopping mid-sentence.
- Checking several engines at once no longer leaves one of them shown as still being checked.
- The bot browser lives in the Browser panel: it has no window of its own, and once you take a tab over you click, type and scroll on the page inside Markas.
- The Keyring signs bots in: a saved login is typed into the bot's own tab, on the exact site of the key only.
- A hand-off card on a website offers to save a login for that site in the Keyring.
- A permission card for a command can be allowed for the session.
- Every answer to a bot's request for permission is written in the Logbook.
- A bot can propose a new teammate; it is created only after you say yes.
- Each bot's settings show what fills its context.
- Picking a specialty for a new bot no longer sets it off working by itself.
- The desktop window always appears, and a host that will not start says why.
- Bots are told not to use tools that take over the screen, keyboard or mouse.
- Markas can be run from the source with `bun run start`.
- macOS and Linux packages are built on their own systems.

## 0.1.0 - 2026-11-16

The first public version, an early preview.

- Guided setup, and bots created by answering a few questions or from a ready-made bot file.
- Chats with a queue, files and access levels.
- Rounds: work on a schedule.
- Rooms (Preview): a team on one question.
- A browser for bots, the Keyring, Switchboard (Preview), Optimizer and Logbook.
- Notifications, and Undo for a deleted bot.
- English and Bahasa Indonesia.
