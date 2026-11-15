# BDR 0002: Bot browser, one-time codes and standing approvals

- Status: accepted
- Date: 2026-11-12
- Source: maintainer review, 2026-11-12

## Decisions

1. The bot browser is at least as flexible as the one in the project Markas was inspired by.
Markas drives an installed Chrome or Edge first, and downloads its own Chromium only when neither is found.
Each bot keeps its own browser profile, separate from the person's own profile and from every other bot.
The person can watch the bot's browser in the Browser panel and take over at any time.
2. A key in the Keyring may hold a TOTP secret next to its password.
Markas fills the one-time code itself during sign-in, and the bot never reads the secret or the code.
Codes sent by text message or e-mail still hand over to the person.
3. Standing approvals are built now, together with the browser.
When creating or editing a round, the person can give it standing permission for named actions, such as one site, one folder or one tool.
A round still stops for anything its standing permission does not cover.

## Open decisions

- None from this round of questions.
