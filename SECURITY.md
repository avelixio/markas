# Security

Markas holds saved logins and lets bots run commands and drive a browser on your computer, so security reports matter here.

## Reporting a problem

Please do not open a public issue for a security problem.
Use **Report a vulnerability** on the repository's [Security tab](../../security/advisories/new), which reaches the maintainers privately.
Say what you did, what happened, what you expected, and which version and operating system you used.
You will get an answer within a week.

## What counts

- A bot reading a saved secret, or a secret reaching a page other than the exact site of its key.
- A bot acting outside its access level without the person saying yes.
- A web page, another program or another computer reaching the Markas host without the token.
- A way to make the Logbook miss or change an entry.
- Anything that lets a bot's page or a bot's output run code in the Markas window.

## How Markas is meant to be safe

- The host listens on this computer only (127.0.0.1) and every request needs a token kept in `~/.markas/token`.
- Requests from other websites are refused.
- A new bot asks before it acts outside its own folder; the person chooses each bot's access level.
- Saved logins are encrypted on disk, and bots use them without reading them.
- A login is typed only into the exact website it was saved for.
- What bots and people decide is written to an append-only Logbook, without secret values.

The decisions behind this are in [docs/adr](docs/adr), mainly 0002, 0006, 0007, 0008 and 0014.

## Known limits

- The packages are not signed with a paid certificate yet.
- A bot with full access can change and delete files your account can; give that level only to work you trust.
- Each bot runs on an engine (Claude Code or Codex) that you installed and signed in to; what that engine sends to its provider is governed by that provider.
- A bot on Claude Code or Codex also loads the settings of your own engine account, such as its instructions, skills and connected tools.
