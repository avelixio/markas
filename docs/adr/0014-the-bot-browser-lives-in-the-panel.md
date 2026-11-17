# ADR 0014: The bot browser lives in the Browser panel

- Status: accepted
- Date: 2026-11-17

## Context

The bot browser opened a real browser window beside Markas, and the Browser panel drew a picture of the same page.
A person saw the page twice, and had to leave Markas for the other window to do a step the bot handed over.
When that step was a sign-in, the person typed the password into the page, and the bot asked again next time.
The Keyring could already type a saved login, but it was never connected to the real browser, so no bot could use a saved key.

## Decision

### One place to see and use the page

The bot browser runs without a window of its own.
The Browser panel is the only view of the page.
While the person holds a tab, the panel passes on what they do there: a click, typing, a short list of keys, pasted text and scrolling.
The host accepts this only for a tab the person has taken over, through `browser.personInput`.
A click is sent as a share of the width and height of the picture, so the size of the panel does not matter.
The panel looks at the page every 0.7 seconds while the person uses it, and after every input.
`MARKAS_BROWSER_WINDOW=1` gives the browser a window of its own as well, for looking into a problem.

### The browser keeps its sandbox

The browser is started with its own sandbox on, as it is when a person starts it.
`MARKAS_BROWSER_NO_SANDBOX=1` turns it off on a system where the sandbox cannot start.

### A sign-in is saved, not typed

The Keyring is connected to the bot browser: `BrowserService.secretFiller()` types a saved login into the tab the bot used last, on the exact site of the key only.
When a bot hands a step over on a website, the card offers "Save a login in the Keyring".
The dialog opens with the site and the bot filled in; the person types the login into Markas, not into the page.
The tab then goes back to the bot with a note that names the key, and the bot signs in with `keyring_sign_in`.
The bot never sees the password, and next time it signs in by itself.

## Consequences

- A page is drawn as still pictures, so using it through the panel is slower than a real window; it is meant for short steps such as a code or a consent screen.
- Dragging, right-click, file choosers and browser dialogs are not passed on.
- Some websites refuse a browser without a window; `MARKAS_BROWSER_WINDOW=1` is the way around it until that is handled in the app.
- What the person types through the panel travels through the host on this computer, like everything else the panel does; it is never logged.
