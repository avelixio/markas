# BDR 0003: Guided setup, Dispatch and ready-made bots

- Status: accepted
- Date: 2026-11-12
- Source: maintainer review of the running app, 2026-11-12

## Context

The setup screen in the app only let the person pick a provider.
An engine that was not installed or not signed in showed a status and nothing to do about it.
After setup the person landed on an empty "To:" field with no guidance.

## Decisions

1. Setup is full screen, one step per screen, in seven steps: language, connect engines, default model, consent, meet Dispatch, describe or pick a bot, review and create.
Markas supports two engines, Claude Code and Codex, and shows no others.
2. Every engine in setup has an action for its state: install, sign in, open the login again while Markas waits, or fix.
Continue unlocks once one engine is signed in.
3. A default-model step shows the engines on the left, their models on the right, with nothing else.
4. New bots are made by chatting with Dispatch, by picking a ready-made bot, or by importing a bot file.
5. Dispatch is part of Markas, not one of the person's bots, so Markas still starts with no bots of the person's own (BDR 0001, decision 4).
Dispatch sits in the middle of the screen until the first bot exists, then stays pinned at the top of the chat list.
6. Ready-made bots are bot files in a `bots/` folder of the repository.
Anyone can add one with a pull request, and it ships with the next release.
A person can also import a bot file, and export any of their bots as one.
Adding a ready-made bot makes a copy that is the person's to change.
7. Every setup step has a way forward when it goes wrong: a retry, a manual way, or another route to the same place.
No step is a dead end, and nothing the person typed is lost.

## Designs

Frames 01, 01a, 01c, 02, 19 and 36 to 41 in `design/`.
