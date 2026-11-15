# ADR 0006: Bots ask before acting outside their own folder

- Status: accepted
- Date: 2026-11-12

## Context

Every bot ran with full access and never asked.
A Claude bot ran in bypass-permissions mode, and a Codex bot ran with approvals off and no sandbox.
A bot could therefore read, change and delete any file the person's account could, and run any command, with no prompt.
The person noticed this when a new bot started reading their other projects on its own.

## Decision

Each bot has an access level, stored with the bot and shown in the chat header.

| Level | Without asking | Needs a yes |
|---|---|---|
| Ask first (default) | Read and change files in its own folder and the shared folder | Everything else |
| Read freely | The above, plus reading files anywhere | Changing other files, commands, the internet, other tools |
| Full access | Everything | Nothing |

- New bots start at Ask first, and so do bots saved before this change.
- Full access is never one click: the settings show what it means and ask again.
- A request shows a card in the bot's chat with exactly what is wanted: the path, the command, the address or the tool.
The choices are allow once, allow for this chat, and don't allow.
Anything that is not an explicit yes counts as no.
- Allow for this chat covers one folder (reading, or changing which includes reading) or one tool.
It is forgotten when the chat's session ends or the bot's level changes.
- A command is only ever allowed one at a time, because a command can do anything.
- Markas's own data folder holds the sign-in token and the keyring.
Below full access it always needs a yes, one time only, even for a bot that may read freely.
- Work a bot does for another bot runs at the more careful of the two levels, so a bot with little access cannot borrow a teammate's.
- Sending a file to a teammate is a way of reading it, so it follows the sender's level.

### How it is enforced for Claude bots

The rule is one pure function, `judgeTool`, in `src/backend/access/policy.ts`.
It runs in a PreToolUse hook, which Claude calls before its own permission settings, and again in the permission callback.
So neither the person's Claude settings nor anything the bot writes can widen what the level allows.
Paths are resolved through links before they are judged, so a link inside the bot's folder cannot point out of it.
Below full access the bot's own folder is not a source of Claude settings, because the bot could write itself permissions or hooks there.
When a bot's level changes, its Claude session is restarted so nothing loaded under the old level lingers.

### How it is enforced for Codex bots

Below full access a Codex bot runs with the `untrusted` approval policy in the workspace-write sandbox with the network off.
Its approval requests become the same cards instead of being approved automatically.

## Consequences

- A round that runs while the person is away waits at the first card until it is answered.
Standing approvals for rounds are a later change.
- The person's own Claude settings, hooks and instructions still load for every bot.
That is why a bot knows about the person's other tools.
It is their own configuration, but it does mean a bot inherits it.
- Codex's sandbox does not restrict reading, so for a Codex bot Ask first behaves like Read freely for reads done through commands it trusts.
The Codex path is covered by tests against a stand-in engine only; Codex is not installed on the development machine.
- The Claude path was checked against the real Claude CLI with `scripts/live-access-check.ts`.
- Bots can still not use saved keys; that needs the bot browser.
