# ADR 0009: Bot files, ready-made bots and creating a bot from a draft

- Status: accepted
- Date: 2026-11-12

## Context

BDR 0003 decides that new bots are made by chatting with Dispatch, by picking a ready-made bot, or by importing a bot file, and that any bot can be exported as one.
Until now a bot could only be created blank, as "New agent", and filled in afterwards.
Three sources of a new bot are not trusted: a model's output, a file a stranger wrote, and a file from the repository that anyone can change with a pull request.
A bot's folder is where it may read and write without asking (ADR 0006), so where that folder goes, and what is already in it, matters.

## Decision

### One draft type for every way of making a bot

A bot draft is everything needed to create a bot before it exists: name, role, instructions, sigil, engine or model, access level, tags, category, author, an optional round, and an optional folder.
It lives in `src/shared/bot-draft.ts` and is the only shape the review screen, Dispatch, the library and the importer exchange.
`parseBotDraft` turns anything into a draft and treats its input as untrusted unless told the person has reviewed it.

- Unknown fields are dropped.
- Every text field is capped, and one-line fields are kept on one line.
- Full access is lowered to ask first.
- A folder, and the yes to adopting one, are never accepted.
- A round that cannot run is left out.
- Each repair is returned as a plain sentence, so the review screen can show what was changed.

A reviewed draft may ask for full access and name a folder.
For a reviewed draft nothing is repaired: anything wrong is reported, because quietly changing what a person chose is worse than telling them.

### The bot file format

A bot file is one Markdown file named `<slug>.bot.md`.
A details block between two `---` lines holds one `field: value` per line, and everything after it is the bot's instructions.
The block looks like YAML front matter but is deliberately not YAML: a value is the plain text after the colon, with no quoting, no lists and no nesting.
That keeps the parser about a hundred lines with no dependency, makes every error nameable by line, and removes a whole class of parser surprises from files strangers write.

- The first field is `format: 1`.
A higher number is refused with advice to update Markas, so a later format cannot be half-read.
- A field the format does not know is an error, not something to skip.
A typing mistake in `access` must never fall back to a default silently.
- `access` may be `ask` or `read`.
`full` is an error in a file, and the serializer writes `ask` for a bot that has full access.
- A file has no field for the folder or the model.
The engine is only a suggestion.
- A suggested round is three one-line fields: when, a name, and what to do.
When is written in words, such as `weekdays at 08:30` or `every 60 minutes`, and is checked by the same code that checks every round.
A round that runs once is never written, because a date means nothing to the next person.
- A file may be 64 KB at the most and its instructions 8,000 characters.
The size is checked before anything else is read.
- Every problem is reported with its line as a sentence that starts with the line: "line 4 has no name".
All problems are reported at once, in line order, so a person or Dispatch can fix the file in one pass.
- A bot file is data.
Nothing in it is executed, expanded or used as a path.

The parser and serializer are pure and live in `src/shared/bot-file.ts`, so the interface can use them too.
A draft that came from a file is, by a test, exactly what `parseBotDraft` would accept unchanged, and a serialized draft parses back to itself.

### Ready-made bots

The ready-made bots are the bot files in the top-level `bots/` folder.
The host reads them fresh on each call and lists the ones that parse; a file that does not parse is left out and named in the host's log, so one bad file cannot hide the others.
A test parses every shipped file, so a broken one cannot be merged unnoticed.
Every shipped bot starts at ask first.

The folder ships as plain files beside the host executable, next to `ui`, so a person can read a bot before adding it.
`scripts/package.ts` copies it and the desktop packaging carries it as a resource.
The host looks for `bots` beside its executable when packaged and in the repository otherwise, and `MARKAS_BOTS_DIR` overrides both, the same three steps as for the interface.

### Export

An export holds the bot's name, role, instructions, sigil, engine, access level and its first repeating round.
It holds nothing else: no folder path, no conversation, no bot id, no thread id and nothing from the keyring, because the export is built from those fields only and not by removing fields from the stored bot.
Every export is parsed again before it is returned, so a file Markas writes is always a file Markas reads.

### Creating a bot from a draft

`agent.createBotFromDraft` takes a reviewed draft and creates the folder, the bot and its round, in that order, or nothing.

- A new bot's folder is `bots/<slug>` in the data folder, named after the bot, unless the person chose another place.
- A folder that already has files in it is never used without the person's explicit `adoptExistingFolder`.
The answer names the folder and offers the first free name beside it, such as `scout-2`.
This is returned as an answer, not thrown as an error, because it is a choice for the person and not a failure.
- A folder that is, holds, or lies inside another bot's folder is refused even with that flag.
Two bots sharing a folder would share what each may do without asking.
- A chosen folder may not be, hold, or lie inside Markas's data folder, the shared folder or the downloads folder.
Paths are compared after following links.
- The bot is saved before anyone is told about it, and the round is created before the bot is announced.
If the round fails, the bot is removed and the folders this creation made are removed, deepest first and only while empty.
A folder that existed before, adopted or not, is never removed and nothing in it is touched.
- Creations run one at a time, so two at once cannot both claim the same folder.

The existing stores do the work.
`BotStore.createBot` gained an optional profile, `AgentService.createBotFromProfile` wraps it with the rollback and the announcement, and the round goes through `RoundsStore.create` like any other.

### Sigils

A draft carries a sigil: a pattern from 0 to 7 and one of the eight sigil colours.
Stored bots still carry the older avatar shape and colour, which the interface already draws as sigils.
The draft's sigil is mapped onto those stored values and back, so no stored bot had to change.

## Consequences

- A bot's instructions are stored as its description, so the description limit rose from 2,000 to 8,000 characters to match the file format.
- Lime has no stored colour of its own and is stored as yellow, and three stored colours (cyan, black, gray) export as the nearest sigil colour.
Storing the sigil directly would remove this mapping and is a later change.
- A bot's id is still random, so a bot's folder name and its id no longer match for bots made from a draft.
Nothing relied on that.
- Tags, category and author are part of a draft and a file but are not stored with a bot, so an export of a ready-made bot does not carry them.
- The library is read from disk on every call.
With nine small files that costs nothing; a cache is not worth its invalidation.
- Ready-made bots are listed by name.
The file format has no field for a display order.
- `library.importFile` can read a path on the computer.
It only opens a regular file whose name ends in `.md` and whose size fits a bot file, and returns a draft or the problems by line.
Any other Markdown file fails at line 1.
- Several ready-made bots tell the person to add a key in the Keyring.
Bots cannot use saved keys until the bot browser exists (ADR 0006), so until then those bots work only on what needs no sign-in.
