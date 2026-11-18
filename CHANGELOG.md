# Changelog

What changed in Markas, newest first.

## Unreleased

- A bot can ask for a login or a token it needs: a card in the chat asks you for the secret and saves it in the Keyring for that bot only. The bot is told only the key's name, never the value.
- Adding a key is simpler: the website comes first and names the key, the two-step code and when bots use it wait under More options, and what is missing is said next to each field.
- A key that no bot can use is flagged when you save it and offers Share in the Keyring; after saving, the Keyring says which bots can use it.
- The Keyring list has plainer column names, bigger buttons, "1 key" instead of "1 keys", and one Add key button when it is empty.
- Send feedback, from the account menu or Settings: report a bug or share an idea as a GitHub issue, opened with your own GitHub account or sent directly without one. You see every detail about your computer that goes with it, and can leave them out.

## 0.1.2 - 2026-11-18

Found by testing 0.1.1 on a real computer.

- A bot whose engine is not on this computer opens its chat again, instead of showing an error.
- An engine that is not installed shows as such right away, instead of looking as if it were always being checked.
- The startup message reads "Starting local agent CLI…" again; 0.1.1 showed it garbled.
- A Codex model name is shortened again as it was meant to be.
- A bot on OpenCode answers its first message again: Markas no longer picks OpenCode's effort variant, whose "high" for Claude Opus 5 the model refused.
- Opening a bot whose engine is missing no longer keeps Markas looking for that engine without end.
- Stopping Markas waits for the end of a turn to be saved.
- Deleting a bot on Claude Code or OpenCode ends that bot's engine session, instead of leaving it running until Markas stops.
- A Keyring key can have any name, such as "web example" or "app.example.com". A new key starts with its site as its name, and capitals or spaces no longer make a name refused.
- On Linux, Markas finds Claude Code, Codex and OpenCode anywhere on PATH, also on a computer without zsh, instead of only in a few known folders.
- Looking for the engines no longer stops Markas when it runs in the background of a terminal.
- A yes for the chat on a folder covers it also when the folder was named through a link, such as /var on macOS, which is really /private/var.
- The install script's advice for adding Markas to PATH names the person's own shell, instead of always zsh.

## 0.1.1 - 2026-11-18

- Markas can be installed in one line on macOS and Linux, with an install script that checks the download against the release's SHA-256 list, or with Homebrew through this repository's tap.
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
