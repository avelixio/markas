# ADR 0007: The bot browser

- Status: accepted
- Date: 2026-11-12

## Context

Until now the host ran `UnavailableBrowserService`, which refused every browser action (ADR 0003).
BDR 0002 decides what the real browser must be.
It drives an installed Chrome or Edge first and downloads its own Chromium only when neither is found.
Each bot keeps its own browser profile, apart from the person's profile and from every other bot.
The person can watch a bot's tab and take over at any time.
Saved logins and one-time codes are filled by Markas, and the bot never reads them.
ADR 0006 adds that using the internet needs a yes below full access.

## Decision

### One real browser per bot

`BotBrowserService` in `src/backend/browser/bot-browser-service.ts` implements the `BrowserService` contract.
Each bot gets its own browser process with its own profile folder, `<data folder>/browser-profiles/<bot id>`.
A bot id that is not a plain folder name is hashed, so it can never point outside that folder.
The browser for a bot starts when the bot opens its first tab and stops when its last tab closes, which frees the profile.
The profile folders sit inside Markas's data folder, which a bot below full access cannot read without a yes (ADR 0006).
Deleting a bot closes its browser and removes its profile.

### Two small seams: finding a browser and driving it

`BrowserFinder` answers three questions: which browsers are installed, whether Markas downloaded one earlier, and how to download one.
`SystemBrowserFinder` looks for Chrome, then Edge, in the places they install themselves.
Only when none starts does it run the driving library's own installer, pointed at `<data folder>/browsers`.
`BrowserDriver` is everything the service needs from a browser: start one on a profile, open pages, read, click, type, fill, take a picture.
`PlaywrightDriver` implements it with `playwright-core`, which is now a runtime dependency.
The service never imports the library, so unit tests run against `FakeBrowserDriver` and `FakeBrowserFinder` with no browser.
`scripts/browser-check.ts` runs the real service against a real browser and a small local sign-in site.

### The bot's tools

The existing tools are implemented as they were declared: `open`, `list_tabs`, `snapshot`, `act`, `screenshot` and `close_tab`.
`snapshot` returns the page as text with a reference on every element that can be acted on, and a revision number.
`act` must name the revision its reference came from, and is refused when the page has changed since.
One tool is added, `hand_off`, because a sign-in can need something only the person can do.
A bot reaches only its own tabs; another bot's tab does not exist for it.
A window that a website opens by itself becomes a tab of the same bot.

### Hand-off and taking over

A tab is controlled by its bot unless it is listed in `BrowserControlState.handOffs`.
A hand-off starts when the bot calls `hand_off` with a reason, or when the person takes over with `browser.takeControl`.
While the person controls a tab, the bot can neither act in it nor read it, and it cannot be given a secret.
`hand_off` waits for the person for up to four minutes, then reports "still waiting" so the bot can wait again or end its turn.
The person gives the tab back with `browser.resumeControl`, optionally with a note the bot is told.
A hand-off outlives the bot's turn: a tab the person holds stays theirs until they resume.
The bot's browser was a normal window of its own at first; since ADR 0014 it has none, and the person uses the page in the Browser panel.
For the Browser panel, `browser.viewTab` returns a picture of the tab with who controls it; the panel asks for it as often as it wants to redraw.
Every change is announced through the existing `browser-changed` and `browser-control-changed` events.

### Secrets never reach the bot

`BrowserService.fillSecret` puts a value into a form field.
It is called by host code only: it is not a bot tool and not a host route.
The caller must name the exact site the secret belongs to, and the fill is refused when the tab is on any other site, even a sibling host.
The value goes only into the page's own document, never into an embedded one.
The value is never logged or returned, and no error carries it: the driving library's own error text quotes the value, so it is replaced by a fixed sentence.
After a fill, the value is taken out of everything the bot reads from its tabs, and the field is covered in pictures.
What the person types into a password field during a hand-off is hidden from the bot the same way.

### Access

A website is the internet.
`judgeSite` in `src/backend/access/policy.ts` decides per website, and `AgentService` asks it before every browser tool call.
Below full access, opening an address shows the usual card with the address.
The yes can be for once, or for that one exact site until the chat's session ends or the bot's level changes.
Reading, acting and taking a picture are judged against the site the tab is on at that moment.
So a tab that a link or a redirect took to another site needs its own yes before the bot can read it.
Nothing was removed from the policy: the browser tools were already allowed through as Markas's own tools, and this adds the missing check behind them.

### Failures

Every failure is a `BrowserProblem` with a plain sentence that says what happened and what to do next.

| What went wrong | What the bot or the person is told | State afterwards |
|---|---|---|
| No browser found and the download failed | Why, and to install Chrome or Edge or check the connection | Nothing started; the next try starts fresh |
| Profile in use by another program | To close the other window or the other copy of Markas | Nothing started; works once it is free |
| Page crashed | To reload it, or close the tab and open it again | Tab kept; a reload clears it |
| Page took too long to load | That the tab is still open, and its id | Tab kept with whatever loaded |
| Address could not be reached | To check the address and the connection | Tab kept |
| Tab or window closed by the person | To open the page again | Tab removed; sign-ins kept in the profile |
| Element reference out of date | To read the page again | Nothing done |

### Fallback

`createBrowserService` in `src/host/browser-methods.ts` builds the real service.
It returns `UnavailableBrowserService` with the reason when the driving library cannot be loaded, or when the browser is switched off with `MARKAS_BOT_BROWSER=off`.
`MARKAS_BOT_BROWSER=<path>` names a browser to prefer, and `MARKAS_BROWSER_WINDOW=1` gives the browser a window of its own for looking into a problem (ADR 0014).

## Consequences

- A bot's browser is a real window on the person's desktop, not a view inside the Markas window.
The person can always see it and use it, but it appears on its own when a bot starts browsing.
Embedding the picture as a live, clickable view in the Browser panel is a later change.
- One browser process per bot costs memory when many bots browse at once.
It is the price of profiles that cannot leak into each other.
- A profile can be used by one program at a time, so two hosts on the same data folder cannot both drive the same bot's browser.
- A sign-in form inside an embedded document from another site cannot be filled by `fillSecret`.
That step is handed to the person.
- A website can tell that it is being driven by automation, and some refuse to work then.
Nothing is done to hide it.
- The standing permission of a round (BDR 0002) is not part of this change.
A round still stops at the first website card.
- The browser was checked from a source checkout only, not from the packaged single executable.
The Chromium download runs the driving library's installer script from `node_modules`, which the packaged executable does not ship, so there the download is expected to fail with its plain message until packaging carries it.
With Chrome or Edge installed, nothing is downloaded.
- The real check runs on Windows with Chrome, Edge and the downloaded Chromium.
macOS and Linux are covered by the unit tests only.
