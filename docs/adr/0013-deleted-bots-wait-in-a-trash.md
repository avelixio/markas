# ADR 0013: A deleted bot waits in a trash for 30 days

- Status: accepted
- Date: 2026-11-14

## Context

Deleting a bot used to remove it at once: its record, its messages, its keys, its rounds, its place in rooms and its browser sign-ins.
The design promises an undo after a delete.
An undo that only lasts while a notice is on screen is too short for something this costly to lose.
A bot's data lives in six stores, each with its own file.
Copying everything out on delete and writing it back on undo would need a take-out and a put-back in every store, and a half-finished put-back would leave the stores disagreeing.

## Decision

### Deleting only takes the bot off the roster

The bot store keeps a second list, the trash, next to the list of bots.
Deleting moves the bot's record from one list to the other and writes down when.
Nothing else is touched: messages, keys, rounds, rooms, sign-ins and usage numbers stay where they are.
Restoring moves the record back, so there is nothing to repair.

### Everything else is removed only when the trash is emptied

One function in the host removes a bot for good: messages, keys, rounds, rooms, usage numbers and the browser profile.
It runs in two cases: the person chose "Delete forever" in Settings, or 30 days have passed.
The host checks for bots past their 30 days when it starts and once an hour.
The bot's own folder and the engine's history are never removed, as before.

### A deleted bot is absent, not half-present

Every part of the host finds bots through the roster, so a bot in the trash cannot be messaged, shown or chosen.
A message addressed to a deleted bot's id is refused, instead of quietly making a new bot with the same id.
Its rounds rest: they are not listed, they do not run, and the times that pass are let go, so nothing runs late when the bot returns.
A room that had the bot keeps its entry and shows the bot as deleted until the bot is restored or removed for good.

### Two ways back

Right after a delete, a notice offers Undo for a few seconds.
After that, Settings lists the deleted bots with the day each is removed for good, with Restore and Delete forever.
Delete forever asks once more, because nothing brings the bot back afterwards.
Deleting, restoring and removing for good are each written in the Logbook.

## Consequences

- A delete is cheap and safe to undo, because it changes one file.
- Disk space is not freed until 30 days pass or the person empties the trash.
- A secret shared with a deleted bot stays shared until the bot is removed for good; nothing can use it meanwhile, because the bot cannot run.
- The 30 days are one constant, `BOT_TRASH_DAYS`, shared by the host and the screen.
- State files written before the trash existed have no trash list and are read as an empty trash.
