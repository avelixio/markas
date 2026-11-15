# ADR 0010: Standing approvals for rounds

- Status: accepted
- Date: 2026-11-12

## Context

A round is work a bot does on a schedule, often while the person is away.
Since ADR 0006 a bot below full access asks before it acts outside its own folder.
A round therefore stopped at the first card and waited there until the person came back.
BDR 0002 decided that a round can be given standing permission for named actions, and still stops for anything else.

## Decision

A round can hold standing permissions, chosen by the person when creating or editing it.

| Permission | Covers |
|---|---|
| Read a folder | Reading and searching inside that one folder |
| Change a folder | Changing files inside that one folder, which includes reading it |
| Use a tool | One tool, by its exact name |
| Open a site | One exact site: scheme, full host and port |

- A standing permission is always one named thing.
There is no "any folder", "any tool" or "any site".
- A command is never covered.
Commands stay one at a time, as in ADR 0006, because a command can do anything.
A round cannot be given the tools that run commands, and the policy ignores such a grant even if one were stored.
- Markas's own data folder is never covered.
A round cannot be given that folder, a folder inside it, a link to it, a folder that contains it, or a whole drive.
The policy also refuses it on its own, so a link placed inside a granted folder later cannot reach it.
- The tool that opens web addresses cannot be given as a tool, because that would be every site.
It is reached one exact site at a time.
The parent site, a sibling host, another port, plain http for an https site, and an address with a username in front of the host are all a different site.
- A round holds at most 20 standing permissions.

### One rule, one extra input

The rule is still the one pure function `judgeTool` in `src/backend/access/policy.ts`.
It takes a fourth, explicit input: the standing permissions of the round the turn belongs to.
It first judges the call by the bot's level exactly as before.
Only when that answer is "ask" does it look at the standing permissions, and it turns the answer into "allow" only for a request the person could have allowed for a whole chat.
So a standing permission can never allow more than a card can.
The verdict names the permission that was used, so every use can be recorded.
Paths are resolved through links before they are compared, the same way as for the bot's own folder.

### Only for runs of that round

Standing permissions are stored with the round in `rounds.json`.
The scheduler names the round when it hands the instruction to the bot's queue.
The host notes which queue entry belongs to which round, and reads the round's permissions when that entry's turn starts.
A turn that is not a run of the round starts with none, which also clears what the turn before it had.
A message the person types, and work passed on to another bot during the run, never get them.
The note is kept in memory only, so after a restart a queued run asks again instead of acting on a stale note.

### The bot's access level

Each standing permission is stored with the bot's access level at the moment it was given.
When the bot is later set to a lower level, every permission given at a higher level is removed from the bot's rounds and the removal is written to the Logbook.
The policy also ignores such a permission by itself, so nothing depends on the removal having happened yet.
Raising the level keeps them.
Standing permissions do not follow a round that is given to another bot.

### What the person sees afterwards

- Every use of a standing permission is a line in the Logbook, written by the round, naming the round and the folder, tool or site.
The full path or address of the single call is not recorded, because an address can carry a secret.
- Giving, changing and dropping standing permissions are Logbook lines too.
- A run that needs something its standing permissions do not cover still stops and shows a card in the bot's chat.
The run's history records each such stop: what was asked for, when, and how it was answered.
A run that is still going with an unanswered stop is waiting on the person, and the rounds list says so.
A card that nobody answered before the run ended is closed without an answer.

## Consequences

- Standing permissions take effect for bots that run on Claude Code, where Markas judges every tool call itself.
A bot on Codex is held by Codex's own sandbox and approval requests, which do not name a folder or a site in a form the rule can judge.
Its rounds keep their standing permissions but still ask, and the rounds list marks them so the form can say it.
- A page on an allowed site can redirect elsewhere.
The engine reports a redirect to another host back to the bot instead of following it, and the next request is judged again.
- The stored level makes "set the bot lower" a clean way to take back everything given while it was trusted more.
The cost is that the person names the permissions again after lowering a level.
- The run history grows a list per run, capped at 50 stops.
- The checkpoints of the glossary are still not built.
Standing permissions cover the access cards of ADR 0006 only.
