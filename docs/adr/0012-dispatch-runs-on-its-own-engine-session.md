# ADR 0012: Dispatch runs on its own engine session and proposes drafts as text

- Status: accepted
- Date: 2026-11-13

## Context

BDR 0003 decided that Dispatch talks with the person and proposes a bot for them to review.
Dispatch needs a model to talk, and the only engines are Claude Code and Codex.
Both engines come with tools that read files, run commands and browse.
Dispatch must do none of that: it talks, and it proposes a draft.
The first sketch gave Dispatch a tool to call with the draft.
The two engines take extra tools in different ways, and the Claude Code client builds its tool list in code.
A tool of Dispatch's own would have meant engine-specific code in both clients, for something that only carries a few fields of text.

## Decision

### An engine session of its own

Dispatch does not run inside the agent service that runs the bots.
It starts its own engine client, with one thread, in an empty folder under Markas's data.
So a talk with Dispatch can never mix with a bot's turn, queue or permissions, and stopping Dispatch stops nothing else.
Opening the Dispatch screen starts nothing, so it costs nothing until the person writes.

### Dispatch may use no tool

The session is started with the most careful setting each engine has: ask first for Claude Code, a read-only sandbox that never asks for Codex.
Every request the engine sends back is refused in one place: commands, file changes, permissions, tools and questions.
There is no path by which the person is asked to approve something for Dispatch.

### The draft is a block of text

Dispatch ends its reply with a fenced block named `bot-draft` that holds one JSON object.
The host takes the block out of the reply, so the person sees a card and never the block.
Only five fields are kept: name, role, instructions, tags and round.
Access level, model, engine and folder are dropped before parsing, because those are the person's to choose.
What is left goes through `parseBotDraft` as untrusted input, the same as a bot file from a stranger.
A reply with a broken block is shown as words only.

### What happens when it goes wrong

- A turn that breaks keeps everything said so far, and trying again sends the same message once.
- An engine that is out of plan is reported as such, with the other engine offered when it is signed in.
- Moving to the other engine starts a fresh session and tells it the talk so far in its first message.
- An answer that takes longer than three minutes counts as broken.
- One message is taken at a time; a second one while Dispatch answers is refused, not queued.

### Mending a bot file

A file that could not be imported is given to a one-off session with its own short instructions.
The file is wrapped in markers and described as information only.
The answer goes through the same block and the same untrusted parsing, so a file cannot talk its way to more access.

### After a bot is made

Creating a bot from a draft forgets the talk, so the next bot starts from an empty one.

## Consequences

- No engine client had to change, and both engines behave the same way.
- A model can still write a malformed block; the person then sees words and can ask again.
- Dispatch holds a second engine process while a talk is open, and closes it when the talk ends or the host stops.
- The Codex path is covered by tests with a stand-in engine only; it has not been tried against a real Codex.
