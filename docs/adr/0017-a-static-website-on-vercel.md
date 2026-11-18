# ADR 0017: A static website on Vercel

- Status: accepted
- Date: 2026-11-19

## Context

The README on GitHub is written for developers.
A person who is sent a GitHub link does not know which of fifteen release files to take.
The owner asked for a page to show Markas to people, and for a way to see how often it is downloaded and installed.
Markas itself promises no account, no cloud service and no telemetry, and that promise must stay true.

## Decision

### One static page, not a hosted Markas

- The website is one page of plain HTML, CSS and a small script in `site/`, with no build step.
- It is not a hosted copy of Markas.
A hosted Markas would run other people's bots and hold their keys on a server, which is what Markas exists to avoid.
- It is deployed to the Vercel project `markas` with `vercel deploy --prod` from `site/`, and is served at https://markas-livid.vercel.app.
- It uses the app's own colours, the Inter font served from the site itself, and the bot sigils as its one distinctive element.
Its frame is `design/src/screens/landing.mjs`.
- Screenshots and the tour video are the ones in the README, made with fictional bots.

### The download button reads the newest release

- The script asks GitHub for the newest release and points the button at the file for the visitor's system: the Windows installer, the macOS disk image for Apple silicon or Intel, or the Linux AppImage.
- Only Chromium browsers say which processor a Mac has; others get Apple silicon, the common case, and the install section names both.
- Without JavaScript, or when GitHub cannot be reached, the button opens the release page.
So a new release needs no change to the site.

### Counting without telemetry

- Nothing is added to the Markas app or to the install script.
- GitHub already counts every download of every release file.
`scripts/download-stats.ts` reads those counts and sorts them by system and by way of installing.
- The install script and Homebrew download the same command-line zip; only the install script also downloads the SHA-256 list.
So the install script is counted by the list, and Homebrew by the zip minus the list.
These are estimates: CI's own install checks and anyone who downloads a file by hand count too.
- Visits to the page are counted by Vercel Web Analytics, which sets no cookies.
It is turned on in the Vercel dashboard; until then its script answers 404 and nothing is counted.
- Counting clicks on the download button as events needs a paid Vercel plan, and the GitHub counts already say how many downloads there were.

### Security headers

`site/vercel.json` sets a strict Content Security Policy that allows only the site itself and the GitHub API, and forbids framing.

## Consequences

- The site is deployed by hand from `site/`; it is not built on every push.
Connecting the Vercel project to the repository with `site` as its root directory would make that automatic.
- A visitor's browser asks the GitHub API for the newest release, which allows 60 requests an hour from one address; past that the button falls back to the release page.
- `markas.vercel.app` was already taken; a domain of its own can be added in Vercel later.
- The README screenshots and the tour are from 0.1.0; when they are renewed, `site/media` should be renewed with them.
