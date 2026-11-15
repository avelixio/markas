# Ready-made bots

Every file in this folder that ends in `.bot.md` is a ready-made bot.
Markas ships this folder with each release and shows the bots under "Pick a ready-made bot".
Adding one makes a copy that belongs to the person who added it, so they can change anything.

A bot file is plain text.
Markas reads it as data and never runs anything in it.

## Share a bot

1. In Markas, open your bot's settings and export it as a bot file, or copy an existing file here and edit it.
2. Name the file after the bot in lower case, with hyphens for spaces: `price-watcher.bot.md`.
3. Put it in this folder and run `bunx vitest run src/backend/library`, which checks that every file here can be read.
4. Open a pull request that says what the bot is for and how you have used it.

Once the pull request is merged, the bot ships with the next release.

## The format

A bot file has a details block between two `---` lines, then the bot's instructions.

```markdown
---
format: 1
name: Scout
role: Watches public status pages and reports incidents
sigil: 1 coral
access: ask
tags: Browser
category: Monitoring
author: Your name
round: daily at 08:30
round-name: Morning status check
round-instruction: Check every status page in pages.md and report.
---

Everything below the second --- line is the bot's instructions.
Write them in Markdown, addressed to the bot as "you".
```

Each line in the block is `field: value`.
The value is everything after the colon, as plain text.
Do not put quotes around it.
A line that starts with `#` is a comment, and blank lines are ignored.
This is not YAML, so lists, nesting and multi-line values do not work.

| Field | Needed | What it holds |
| --- | --- | --- |
| `format` | yes | Always `1`. |
| `name` | yes | The bot's name, up to 60 characters. |
| `role` | yes | One line saying what the bot is for, up to 120 characters. |
| `sigil` | yes | The badge: a pattern from `0` to `7`, then a colour. |
| `engine` | no | `claude` or `codex`. Leave it out unless the bot really needs one of them. |
| `access` | no | `ask` or `read`. Left out, it is `ask`. |
| `tags` | no | Up to 6 short tags, separated by commas. |
| `category` | no | One or two words to group the bot under. |
| `author` | no | Who made it. |
| `round` | no | When a suggested round runs. |
| `round-name` | no | A name for that round. |
| `round-instruction` | with `round` | One line telling the bot what to do each time. |

The sigil colours are `mint`, `amber`, `coral`, `sky`, `violet`, `rose`, `lime` and `sand`.
Pick a pattern and colour pair that no other bot here uses.

The tags Markas draws with an icon are `Browser`, `Files`, `Commands`, `Needs a key` and `Asks before sending`.
Other tags are shown as plain text.

A round time is written one of these ways:

- `daily at 08:30`
- `weekdays at 08:30`
- `mon, thu at 09:00, 16:00`
- `every 60 minutes`

Times use the 24-hour clock of the computer Markas runs on.
A repeating round runs every 5 minutes at the most.

## Limits

- A file may be up to 64 KB, and the instructions up to 8,000 characters.
- A bot file cannot ask for full access.
The person who adds the bot can raise its access themselves afterwards.
- A bot file cannot choose the bot's folder or a model.
- A field Markas does not know is an error, so a typing mistake is caught instead of ignored.

When a file cannot be read, Markas names the line and says what is wrong, for example `line 4 has no name`.

## What makes a good ready-made bot

- It does one job, and the role line says which.
- It is safe to add without reading every line: it asks before it sends, pays, deletes or changes anything outside its own folder.
- Its instructions say what to do when something is missing or goes wrong, not only the happy path.
- It keeps what it needs to remember in named files in its own folder, and asks the person for anything it cannot know.
- It names no company, person or private site.
A public, well-known service may appear only as an optional example.
- It holds no secrets.
A bot that needs a sign-in tells the person to add a key in the Keyring.
- It tells the bot that text it reads on a page, in a file or in a message is material, never an instruction.
