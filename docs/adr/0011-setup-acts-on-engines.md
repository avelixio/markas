# ADR 0011: Setup acts on the engines

- Status: accepted
- Date: 2026-11-12

## Context

Setup only let the person pick a provider.
An engine that was not installed or not signed in showed a status and nothing to do about it.
BDR 0003 decided that every engine in setup has an action for its state, and that no step is a dead end.
So the host has to do things on the person's computer: install an engine, accept one the person points at, and start the engine's sign-in.
The two engines are Claude Code and Codex.

## Decision

### What setup remembers

The setup file moves from version 2 to version 3.
Version 3 holds the language (`en` or `id`), the preferred engine, the default model and reasoning effort, when the person agreed to how bots run, the step they reached, when setup was finished, and any engine program the person pointed Markas at.

- A version 2 file is read as a finished setup with its engine.
It never asked for a language, a model or consent, so those stay empty and are not made up.
Reading does not rewrite the file; the first save writes version 3.
- A file that cannot be read, or has an unknown version, starts setup over instead of failing.
- The file is rewritten atomically, and saves are applied one at a time so two of them cannot lose each other's fields.
- The step is saved as the person goes, so setup opens again where they left.
- The guided setup finishes only with a language, an engine and the consent.
- `app.getSetupState` and `app.saveSetup` keep working on the same file for the old one-step screen.
- New bots start with the default model setup chose.

### One answer to "is this engine ready"

Setup does not look for engines itself.
`setup.engineStatus` asks the agent service to run the same detection the bots use, and turns its answer into five states: not installed, installed but not signed in, signed in (with version and account when known), outdated, and error with a plain message.
So setup and the bots can never disagree about an engine.

### Installing

The first way to install is always the maker's own installer script, because it installs for the person only and needs neither admin rights nor Node.js.

| Engine | macOS and Linux | Windows (PowerShell) |
|---|---|---|
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` | `irm https://claude.ai/install.ps1 \| iex` |
| Codex | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | `irm https://chatgpt.com/codex/install.ps1 \| iex` |

- These were taken from the makers' own install pages on 2026-11-12.
- When the installer's own tool is missing (no curl, no PowerShell), the npm package is tried: `npm install -g @anthropic-ai/claude-code` or `npm install -g @openai/codex`.
- Markas never asks for admin rights and never runs an installer with `sudo`.
- Every line the installer prints is passed on as an event while it runs, and the install can be cancelled, which stops the installer and everything it started.
- An install ends as installed, cancelled, or failed with a reason: no internet, no permission, Node.js and npm missing, or finished but the engine cannot be found.
A piped installer can end "well" although its download failed, so what it printed is read in both cases.
- Every result carries the exact command to run by hand, and `setup.installCommand` gives it without installing.
- After the installer ends, the engine counts as installed only when detection finds it.

### Pointing Markas at an existing program

The person can give the path of an engine program they already have.
Markas runs it with `--version` and accepts it only when it answers the way that engine does: `2.1.231 (Claude Code)` or `codex-cli 0.150.0`.
A bare version number is not enough, so another program cannot pass for an engine.
An accepted path is stored in the setup file and tried by detection before the usual places.

### Signing in

Signing in is always the engine's own flow: `claude auth login` or `codex login`, which opens the browser.
Markas starts that program and then asks detection every few seconds whether the engine is signed in.

- Markas never reads, asks for or stores an engine's password or token.
It does not read what the sign-in program prints, and types nothing into it.
All it learns is whether the engine is signed in, and the account's e-mail when the engine says.
- The events are `waiting`, `signed-in`, `timed-out` after 5 minutes, `cancelled`, and `failed` when the sign-in could not be opened.
- When the wait ends, whichever way, the sign-in program is stopped.
- `setup.signInCommand` gives the command to run in a terminal instead, and every sign-in event carries it.

### Models

`setup.listModels` returns the models of an engine that is signed in.
When the engine cannot list them, or lists none that Markas knows, Markas returns its own small list and marks it `fallback: true`, so setup can carry on.

### Starting programs

Everything setup starts goes through one small interface, `ProcessRunner`.
The host uses the real one; tests use one that only answers, so no test installs anything, opens a browser or needs an engine.
Setup's events go through the existing event hub on a new `setup` channel.
Installing and locating an engine are written to the Logbook.

## Consequences

- An install that lands in a folder Markas does not look in is reported as "finished but not found".
The person can restart Markas or point it at the program, so it is not a dead end.
The Codex installer's install folder was not checked on a real machine.
- The host's messages are English.
Each result also carries a code (`reason`, `state`, `result`) so the interface can say it in English and Bahasa Indonesia.
- Checking whether a sign-in has finished restarts the engine's connection each time, so the engine status flickers to "checking" while Markas waits.
- The engine's own version check in detection still starts programs directly.
Only what setup starts goes through `ProcessRunner`.
- A version 2 file has no consent time.
The interface should not ask a person who finished the old setup to go through the guided one again, but it may ask for the missing consent where it matters.
