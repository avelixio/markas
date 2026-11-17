# Contributing

Thank you for looking at Markas.
It is an early preview, so the most useful help right now is a clear bug report or a small, focused fix.

## Setting up

You need [Git](https://git-scm.com) and [Bun](https://bun.sh) 1.3.11 or newer.

```bash
git clone https://github.com/avelixio/markas.git
cd markas
bun install
bun run start
```

## Before you open a pull request

Run the whole check:

```bash
bun run check
```

It runs the linter, the type check, the tests, the interface build and an end-to-end run.
The engine tests use POSIX shell scripts, so on Windows run it inside WSL.
`bun run test:browser` drives a real Chrome or Edge and is worth running when you touch the bot browser or the Keyring.

## How the project works

- **Decisions are written down.** Technical decisions are in `docs/adr`, product decisions in `docs/bdr`. A change that reverses one adds a new record instead of editing history.
- **Design comes first for new screens.** The interface is drawn in `design/` before it is coded.
- **Two languages.** Every piece of interface text goes through the translation tables in `src/renderer/src/i18n`, in English and Bahasa Indonesia.
- **Fictional examples only.** Tests, docs and designs use made-up bots (Atlas, Juno, Mika, Pico, Nova, Sol) and `example.com` sites, never real people, companies or websites.
- **Secrets stay out.** Nothing secret goes into logs, events, error messages or the Logbook. A test that needs a password uses an obviously fake one.
- **`docs/features.md` is the status list.** Update its row in the same change as the work.

## Ready-made bots

A new ready-made bot is one file in `bots/`; see `bots/README.md`.

## Reporting a security problem

Do not open a public issue; see [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under Apache-2.0, like the rest of Markas.
