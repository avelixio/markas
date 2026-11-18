# ADR 0018: Feedback becomes a GitHub issue

- Status: accepted
- Date: 2026-11-19

## Context

People who use Markas had no way to report a bug or share an idea from the app.
The owner asked for one, and chose to offer two ways out: through the person's own GitHub account, and directly, without an account.
Markas promises no account, no cloud service and no telemetry, so whatever leaves the computer must be what the person wrote and saw, sent only when they choose.

## Decision

### One dialog, two ways out

- Send feedback opens from the account menu in the sidebar and from a Feedback section in Settings.
- The person picks "Something is wrong" or "An idea", writes a title and what happened, and sees every detail about the computer that would go with it, in the words the issue will use.
The details are on by default and can be left out with one tick.
- The details are the Markas version, the system and its version, the processor, the language, and the engines with their versions.
No chat, file, key, folder, bot name or account name is ever part of them; the engines' email addresses are not read.
- The dialog says that the report becomes a public issue either way.

### Open on GitHub

- The window builds a new-issue address on `github.com/avelixio/markas` with the title, the body and a `bug` or `enhancement` label, and opens it in the browser.
- The person checks it on GitHub and submits it with their own account.
- A description too long for an address is cut, with an ellipsis, so the person sees the cut before submitting.

### Send directly

- The host sends the draft to `https://markas-livid.vercel.app/api/feedback`, with the app's version in `x-markas-version`.
`MARKAS_FEEDBACK_URL` points it elsewhere for tests.
- The website checks every field itself, builds the issue from the checked fields only, and opens it with a fine-grained token in `GITHUB_FEEDBACK_TOKEN` that can only read and write issues on this repository.
Issues get the `from-app` label beside `bug` or `enhancement`.
- "@name" is broken with an invisible character, so a report never notifies a GitHub user.
- Past 30 reports an hour from everybody, the website asks people to try later.
It keeps no store of its own; the count comes from GitHub's search.
- The app shows the issue's number and a link to it.
When sending fails, the dialog keeps what was written, says why, and points to Open on GitHub.

## Consequences

- Sending directly is the first time Markas itself sends anything to a service of its own.
It happens only on the person's click, with content they have seen, and this ADR is the place that says so.
- Anyone can post to the endpoint, since the app is open source and holds no secret.
The field limits, the size limit, the hourly limit and the `from-app` label keep that manageable; a store per address would be the next step if it is abused.
- Without `GITHUB_FEEDBACK_TOKEN` on Vercel, sending directly answers that it is not set up, and Open on GitHub still works.
- Replies happen on GitHub; Markas does not show them.
