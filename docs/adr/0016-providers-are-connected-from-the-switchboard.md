# ADR 0016: Providers are connected from the Switchboard

- Status: accepted
- Date: 2026-11-18

## Context

Connecting what bots run on took a terminal: `codex login`, `claude auth login`, or `opencode auth login`, which asks its questions in the terminal.
The Switchboard only showed the command to copy.
The owner asked for the interaction they know from other agent apps: the app shows what it found on the computer, marks it Detected, and one Connect makes it usable.
They want it for every engine and for the many model services OpenCode can reach.

## Decision

### One place, three groups

The Switchboard's Providers part (`src/renderer/src/areas/ProvidersPanel.tsx`) lists, in order:

| Group | What is in it | Detected means | Connect does |
|---|---|---|---|
| Engines | Claude Code, Codex, OpenCode | Its program is on this computer | Starts the engine's own sign-in in the browser and waits until the engine says it is signed in |
| Found on this computer | LM Studio and Ollama on their usual addresses | It answered just now and listed its models | Lets bots on OpenCode use its models |
| Model providers through OpenCode | Every provider OpenCode knows | Not used: these are services, not programs | Offers OpenCode's own ways in: a browser sign-in, a code to paste back, or a key |

An engine that is not on the computer gets Install, which runs the maker's own installer as setup does.
Connected providers come first, then the ones most people mean, then the rest by search.
Each row says how it stands in words, never by colour alone, and a wait for the browser is announced to screen readers.

### OpenCode's own server does the sign-in

OpenCode signs in to providers through its local server (`opencode serve`): it lists every provider and its ways in, starts a browser sign-in and gives the page, waits for it, and stores a key.
`OpenCodeConnect` (`src/backend/providers/opencode-connect.ts`) runs that server only while it is needed.
It listens on 127.0.0.1 behind a password made for that run, and stops two minutes after its last use.
A provider id is checked before it is put in an address, so a request cannot reach another route.
Cancel stops the server, which is the only way to end OpenCode's wait; a cancelled wait counts as not connected, not as a failure.

### Model servers on this computer

`LocalModelServers` (`src/backend/providers/local-models.ts`) looks at LM Studio (port 1234) and Ollama (port 11434) and remembers the ones the person connected in `local-models.json`.
A connected server is handed to Markas's own OpenCode processes as an OpenAI-compatible provider named `markas-<id>`, in the settings Markas already passes them (ADR 0015).
Nothing is written into the person's OpenCode settings, so removing Markas leaves them as they were.

### What Markas keeps

Sign-ins and keys are kept by the engine that uses them.
A key typed in Markas is passed to OpenCode once and dropped: it is not stored, logged or shown again.
The Logbook records `provider.connected` and `provider.disconnected` with the provider's name and the outcome only.
After every change the engines' model lists are read again, so a connected provider appears in every bot's model picker.

## Consequences

- The Switchboard no longer shows sign-in commands to copy; a failed Connect says what the engine said instead.
- OpenCode signs in to a provider for the whole computer, as it would from its own app or terminal.
- The browser sign-in was tried in the app up to the provider's page; finishing one with a real account, and a model server that is running, were checked against stand-ins only.
- Codex and Claude Code still sign in through their own programs; Markas only starts that and watches for the result.
