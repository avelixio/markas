# ADR 0015: OpenCode is the third engine

- Status: accepted
- Date: 2026-11-17

## Context

Markas ran bots on two engines, Claude Code and Codex.
BDR 0003 said those were the only two.
The owner now asks for OpenCode as well: it runs models from many services, including ones a person pays for by use.
OpenCode has no library like the Claude Agent SDK and no app-server like Codex.
It has a mode that speaks the Agent Client Protocol (ACP) over standard input and output, `opencode acp`.
What follows was read from OpenCode 1.14.20 and checked against it on Windows.

## Decision

### An engine like the others

`OpenCodeAgentClient` in `src/backend/opencode-client.ts` implements `AgentClient`, like `ClaudeAgentClient`.
The rest of Markas does not know which engine a bot runs on, apart from its name.
`AgentProviderId` gains `opencode`, and every place that listed two engines now lists three.

### Models are OpenCode's own

OpenCode's models differ per person: they are whatever services the person signed OpenCode in to.
So they are not a fixed list in Markas.
A model id is `opencode:<provider>/<model>`, checked by shape, and the list comes from `opencode models --verbose`.
There is no built-in list to fall back on.
A model's effort levels are the ones of OpenCode's variants that Markas also has; a bot's effort is passed on only when its model has that variant.
OpenCode is "signed in" when it has at least one model, because it has no single account.
Its sign-in asks questions in a terminal, so setup does not start it: it gives the command to run.

### One process per conversation

Three things differ per bot and can only be set for a whole OpenCode process: the bot's instructions, its permission rules, and where its Markas tools are.
So each conversation gets its own `opencode acp` process, started in the bot's folder.
The settings are handed over in `OPENCODE_CONFIG_CONTENT`, which OpenCode reads after the person's own settings.
The instructions are written to a file in a temporary folder outside the bot's folder, so a bot below full access cannot rewrite them.
A process that ends takes only its own conversation's turn with it, and is started again when the conversation is next used.

### Markas judges every tool call

Below full access OpenCode is told to ask about everything.
Each question arrives as `session/request_permission` and is judged by `judgeTool`, the same rule as for Claude Code.
OpenCode's question often says only "read" or "bash", without the path or the command.
The client therefore keeps what OpenCode reported about each tool call, and judges the call the question belongs to.
`judgedCalls` in `src/backend/opencode/rules.ts` turns an OpenCode call into the names the rule knows.
A call that cannot be read gets a name the rule does not know, which always asks the person; it is never let through.
The answer to OpenCode is always "once", never its own "always", so it keeps asking and Markas keeps deciding.
The rules are given twice, for the session and for the `build` agent, because the agent's rules are read last and would otherwise let the person's own OpenCode rules win.
`OPENCODE_PERMISSION` is taken out of the environment for the same reason.
Below full access `OPENCODE_DISABLE_PROJECT_CONFIG` is set, so settings, tools and plugins in the bot's folder are not loaded: a bot could otherwise write itself permissions there.
At full access everything is allowed, as for the other engines.

### Markas's own tools go over a local tool server

OpenCode takes outside tools only over the Model Context Protocol.
`LocalToolServer` in `src/backend/opencode/tool-server.ts` offers the same tools the other engines get: messages to teammates, proposing a teammate, the Keyring and the bot browser.
It listens on 127.0.0.1 on a port the system picks.
Every request must carry a secret made for one conversation, and a request with an `Origin` header is refused, so a web page cannot reach it.
A call ends in the same `item/tool/call` request as for the other engines, where the host does its own checks.
OpenCode's time limit for these tools is set to a week, because some of them wait for the person.

### Turns that end without a word

OpenCode does not report it when the model's service refuses a request, for example for an empty balance.
It either ends the turn as if all were well, or tries again in silence.
A turn in which nothing was said and no tool was used is therefore reported as failed, with a sentence that says what to check.
A turn in which nothing at all happens for five minutes, with no tool running and no question open, is ended the same way.

### Reading a conversation back

OpenCode gives a stored conversation by playing it back.
Markas puts one line in front of each message, marked as not for the model, that carries the turn's id.
That line is how a turn is matched to its delivery again after a restart.
It also keeps OpenCode from reading a message that starts with a slash as one of its own commands.
A conversation without a running process is read by a short-lived process that is given no tools and is never asked to do anything.

## Consequences

- A bot on OpenCode below full access has no helpers of its own, no question tool and no plan mode.
OpenCode cannot pass their questions on over ACP, and a question nobody hears would leave the bot waiting for ever.
- A bot on OpenCode loads the person's own OpenCode settings, and the Claude Code skills OpenCode imports by itself, as bots on the other engines load their engine's settings.
- The Optimizer does not count what OpenCode saved by folding a conversation, because OpenCode does not report it.
The context view shows how full the conversation is, but not what fills it.
- The Fuel page shows no plan for OpenCode: it has none to report.
- One process per conversation costs memory when many OpenCode bots are in use at once.
- The rules were read from OpenCode 1.14.20.
A later version that renames a permission is still covered by the rule for everything else, which asks.
A later version that changes how settings are read could weaken this; the checks in `rules.test.ts` cover Markas's side only.
- Checked against the real OpenCode: finding it, listing models, opening a session, reading it back, and a refused request ending as a failed turn.
A full turn with a model answering, a permission question and a Markas tool call was checked against a stand-in only, because no model service on the test computer had credit.
