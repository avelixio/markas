# ADR 0008: Keys in use and one-time codes

- Status: accepted
- Date: 2026-11-12

## Context

The Keyring stores named keys, each bound to one exact website and shared with chosen bots.
Until now a bot had no way to use one.
A bot that needs to sign in must not be handed the password: whatever a bot reads can end up in its conversation, its notes, a message to a teammate or a web page it is tricked into filling.
Many sites also ask for a one-time code from an authenticator app, which a bot working alone cannot read from a phone.
BDR 0002 decided that a key may hold a TOTP secret next to its password, and that Markas fills the code itself.
The bot browser is being built separately and was not available to build against.

## Decision

### The host signs in, the bot only names a key

- Bots get two tools in the `markas` tool group, beside `list_agents` and `send_message`.
`keyring_list` gives the name, kind and exact site of each key shared with the bot.
`keyring_sign_in` takes `{ keyName }` or `{ keyId }`, never both.
- The host does the sign-in itself in `KeySignIn` (`src/backend/keyring/sign-in.ts`).
It types the username, the password and the one-time code, and submits.
- The bot gets back one outcome and one plain sentence, such as signed in, wrong site, not shared, or handed over to the person.
It never receives the username, the password, the setup key or a code.
- Nothing the bot receives, no event, no log line, no logbook line and no error message is built from a secret value.
Errors from the browser are replaced with a fixed sentence, because a browser may have put a typed value in its own error text.
A test types real values through every path and searches everything the bot, the logs, the events and the logbook saw for them.

### The exact-site rule

- A key is used only while the bot's tab is on the key's exact site: scheme, host and port.
A sibling host under the same domain is refused, and so is a parent domain, another port and plain http.
- The site is checked before the person is asked, again after they answer, and again before every single value is typed.
- The browser is also told the site with every value and must refuse to type anywhere else.
Only the browser can make the check and the typing one step, so the rule is enforced on both sides.
- A sign-in that moves to another site part-way is not followed.
The bot is told which site the key is for and which site the tab is on, as sites and never as full addresses, because an address can carry a session token.

### The browser is one small interface

`KeySignIn` depends on `SecretFiller` and on nothing else from the browser.

```ts
interface SecretFiller {
  currentUrl(botId: string): Promise<string | null>;
  hasField(botId: string, field: "username" | "password" | "otp"): Promise<boolean>;
  fillSecret(
    botId: string,
    field: "username" | "password" | "otp",
    value: string,
    site: string,
  ): Promise<"filled" | "not-found" | "wrong-site">;
  submit(botId: string): Promise<void>;
}
```

- `hasField` exists so the host can see whether a site still asks for a password or a code without typing a secret a second time just to find out.
- `submit` resolves once the page has settled.
- The real browser is passed as `filler` to `createBotKeyTools` in `src/host/keyring-methods.ts`, which `src/host/main.ts` calls.
Until then `NoBrowserSecretFiller` reports that the bot has no tab, so nothing is ever typed.
- The logic is tested against `FakeSecretFiller` in `src/backend/testing/`, which records every value and the page it went to.

### One-time codes

- A login key may hold a two-step setup key next to its password.
Both are sealed in the same encrypted record, so the setup key has exactly the password's protection.
- The setup key is accepted as base32, the way sites show it, or as the `otpauth://totp/...` address behind a QR code.
SHA-1, SHA-256 and SHA-512, 6 or 8 digits, and a period of 1 to 300 seconds are supported.
Counter-based codes are refused with a sentence that says so.
- A setup key is checked on save.
The message says what is wrong and never repeats the value.
A key shorter than 80 bits is refused as a paste cut short.
- Codes are generated in `src/backend/keyring/totp.ts` following RFC 6238, and tested against every vector in the RFC for all three hashes.
- The list of keys carries only `hasTwoStepCode`.
The setup key is shown only by `keyring.reveal`, which is the person's explicit act and is recorded in the logbook as before.
When the settings differ from the usual ones, reveal shows an `otpauth` address so that pasting it back gives the same codes.
- The existing field names `twoStepSeed` and `hasTwoStepCode` are kept, because the Keyring screens already use them.

### Clocks that run a little off

- If a site still asks for a code after one was sent, the neighbouring window's code is tried, once.
Early in a window that is the window before, late in a window the one after.
If the clock has crossed into a new window meanwhile, the current code is the neighbour.
- After that one retry the step is handed over to the person.
A password is never tried twice, because repeated wrong passwords lock accounts.

### Asking first

- Using a key follows the access rules of ADR 0006, through `judgeKeyUse` and `covers` in `src/backend/access/policy.ts`.
- Below full access, the first use of a key by a bot in a chat needs a yes.
The card says which key and which site.
Allow for this chat covers that one key on that one site, and is forgotten when the chat's session ends or the bot's level changes.
- A bot with full access is not asked.
- A key's own fill setting can only make this stricter.
A key set to ask needs a yes on every use, even from a bot with full access, and offers allow once only.
A key set to hand-off is never filled by the host.
- The host asks the question itself, because for one engine these tools are not seen by any permission hook.
Anything that is not an explicit yes is a no, including a card that can no longer be shown.
- The site is checked before the person is asked, so they are never asked about a use that would be refused anyway.

### The logbook

- Every use leaves one line with the new action `key.used` and the actor `bot`.
A sign-in reads "Atlas signed in to https://app.example.com with key work-login".
An attempt that did not go through reads "Atlas did not sign in to ... with key ...: " and a short reason, with the outcome failed.
- A request for a name that is not shared with the bot leaves no line.
No key was touched, and the name is only text the bot supplied.
- A logbook that cannot be written does not undo a sign-in that already happened.

### Plain answers when something is in the way

| Situation | What the bot is told |
|---|---|
| The key was removed while the person was deciding | It was removed; ask which key to use |
| The key was unshared or changed meanwhile | Not shared any more, or changed; look at the list again |
| The tab is on another site | Which site the key is for and which site the tab is on |
| No tab is open | Open the site's sign-in page first |
| The fields are not found, or the site still asks | Hand the step over to the person |
| The site wants a code and the key has none | Hand the step over to the person |
| The keyring could not be opened or a key could not be read | Tell the person to check the Keyring screen |

A key that is not shared with a bot is reported exactly like a key that does not exist, so a bot cannot learn which names are taken.

### A key is named after its site by default

Added on 2026-11-18, at the owner's request: a name such as "app.example.com" was refused, while that is the name a person expects.
- A key name is lower-case letters, digits and dashes, in parts joined by single dots, at most 253 characters, like a host.
- Capitals are not refused: the name is written in small letters when it is saved, and a bot's request is matched the same way.
- A new key's name follows its website until the person writes a name of their own: "https://app.example.com/login" gives "app.example.com", and a leading "www." and the port are left out.
- A second key for the same site gets "-2", "-3" and so on.
- The rule lives in `NAME_PATTERN` in `src/backend/keyring/keyring-store.ts`, the name from a site in `src/renderer/src/keyring/key-name.ts`.

## Consequences

- A bot can sign in without ever holding a secret, and a page on the wrong site cannot get one out of the host.
- The real browser has to honour the `SecretFiller` rules, above all refusing to type on another site and not showing typed values back to the bot in a snapshot or a screenshot.
That part cannot be tested here and must be tested with the browser.
- The permission card for a key uses the existing "wants to use a tool" wording with the key and site as its detail.
A card of its own needs new interface strings.
- The Logbook screen needs a label for `key.used` and has to show a bot as the actor.
- The username is stored unsealed, as before, so the person's own Keyring screen can show it.
It is still never given to a bot.
- "Signed in" means the details were accepted as far as the host can see: the site stopped asking for a password and a code.
When the site moves the tab to another site after the details are sent, the bot is told so and asked to look at the page.
- A round that needs a key while the person is away waits at the card, like any other request.
Standing approvals are a later change.
- Two sign-ins for the same bot run one after the other, never at once.
