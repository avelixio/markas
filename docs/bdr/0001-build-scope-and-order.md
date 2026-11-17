# BDR 0001: Build scope and order

- Status: accepted
- Date: 2026-11-11
- Source: the project build plan and maintainer review, 2026-11-11

## Decisions

1. Markas is built on Bun, and its own code is licensed under Apache-2.0.
The software it bundles keeps its own terms, listed in `THIRD-PARTY-NOTICES.md`; the Claude Agent SDK among it is Anthropic's and is not open source.
2. Vitest is the test runner, the vault store is built for Markas, and the browser is driven with playwright-core.
3. No bot is built by hand in the code.
The app must let bots be created and set up from inside the app.
4. Markas ships empty.
A new person starts with no bots and creates their own through the in-app onboarding.
Design mock-ups use fictional bots and sites, never shipped defaults.
5. UI work is designed in FigCraft first, then implemented.
No new screen is coded before its design exists.
6. Markas ships in English and Bahasa Indonesia.
Every piece of interface text goes through one translation table, and no screen is done until it fits in both.
7. Development cost is not a deciding factor.
Quality, simplicity, robustness and long-term maintainability are.

## Platform note

The plan targets macOS (launchd, Keychain), Windows and Linux.
Platform-specific pieces sit behind small interfaces with a macOS implementation and, where cheap, Windows and Linux ones, so the host runs on all three.

## Open decisions

Both were open when this was written and are taken up in BDR 0002.

- Whether the sites bots sign in to can use TOTP or service accounts.
- Standing approvals for routine sends.
