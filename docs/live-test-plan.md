# Live test plan

Automated tests prove the parts.
This plan proves the whole: the real app, on a real computer, with a real engine, used the way a person would.
Every run is done by hand or by a script that drives the real app, and every step records pass or fail with a screenshot.

## Ground rules

- Use the built app, not the development server, for the final run before a release.
- Start from an empty data folder, so setup is tested every time.
- Real engines and the real bot browser.
No fakes.
- Sign-ups and logins happen on a small test site that Markas starts on this computer, plus public practice sites made for testing.
No real personal accounts are created on third-party services.
- Anything that fails is fixed, then the whole scenario is run again from the start.

## Scenarios

### 1. First run

1. Open Markas with no data folder.
2. Pick Bahasa Indonesia, then switch back to English.
3. Engines: one engine signed in, one not installed.
Install the missing one, cancel halfway, install again.
4. Disconnect the network and try to install: the retry, copy command and locate paths all work.
5. Sign in to an engine, close the login page without finishing, and use Open login again.
6. Pick a default model and effort.
7. Tick consent and continue.
8. Close Markas halfway through setup and open it again: it resumes at the same step.

### 2. First bot with Dispatch

1. Tell Dispatch what is needed in one sentence.
2. Answer its questions, ask it to change one thing, and review the draft.
3. Create the bot and watch its first run.
4. Dispatch is now pinned at the top of the list.

### 3. Ready-made bots and bot files

1. Add two ready-made bots.
2. Export one bot as a bot file, delete the bot, and import the file back.
3. Import a broken bot file and check the message names the line.

### 4. A crew working at once

1. Create at least four bots.
2. Give all four a task at the same time and queue a second message for two of them.
3. Pause, resume and cancel queued messages.
4. Ask one bot to hand work to another and get the reply back.

### 5. The bot browser

1. A bot opens a video site in its own browser and plays a video.
The person watches in the Browser panel.
2. A second bot browses a different site at the same time: the two profiles do not share tabs, cookies or history.
3. The person takes over a tab, clicks something, and hands it back.
4. A page shows a CAPTCHA or asks for a phone code: the bot hands off and waits.
5. Quit and reopen Markas: each bot is still signed in where it was.

### 6. Keys: sign up, save, sign in again

1. A bot signs up on the test site with a login the person approves.
2. The login is saved to the Keyring as a named key bound to that exact site.
3. The bot signs out, then signs in again with the key.
The password never appears in the chat, the Logbook or any file in the bot's folder.
4. A second key for the same site with a different name works side by side.
5. A sibling host under the same domain is refused with a clear message.
6. A key with a one-time code signs in with no help.
7. A bot the key is not shared with is refused.

### 7. Access and approvals

1. A bot at Ask first tries to read outside its folder: a card appears, and "don't allow" really stops it.
2. Allow for this chat, then check it is forgotten in a new chat.
3. Raise a bot to Full access and lower it again.

### 8. Rounds

1. Create a round that runs in two minutes and let it run unattended.
2. Give a round a standing approval for one site and check it does not stop for it.
3. A round needs something outside its standing approval: it waits, and the wait is visible afterwards.
4. Quit Markas across a scheduled time: the missed run is shown, not silently dropped.

### 9. Away and disconnected

1. Stop the host while the window is open: the window says so and reconnects by itself.
2. Signal and beacon show a bot that needs the person while the window is closed.
3. Fuel shows what is left of each engine's plan, and a bot that hits the limit is held, not failed.

### 10. Both languages

1. Repeat scenarios 1, 2 and 6 in Bahasa Indonesia.
2. No English text, clipped label or the word "agent" appears anywhere.

## Record

Each run is written to `docs/live-test-runs/<date>.md` with the app version, the scenario results and what was fixed.
