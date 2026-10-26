# ADR001 - Capture on iOS through a share link and a home screen web app
* Date: Oct 26, 2026
* Status: ADOPTED
* Author: bfarkas (drafted with Claude Code)

## Decision
Mobile capture goes through the web capture page instead of a Shortcut that
calls the inbox API with a token. A three-action Shortcut (URL Encode, Text,
Open URLs) opens `https://app.octosprout.de/capture#text=…` from the share
sheet, and the capture page added to the home screen offers *Paste & save*.
Both use the passkey session. Shared text travels in the URL fragment, with
`text=` as the last parameter. Inbox tokens remain for other API clients.

This changes spec v0.3 §15.4 and is reflected in spec v0.4.

## Context
Spec v0.3 §15.4 described a Shortcut that generates an idempotency key, POSTs
to the inbox API with a stored token, retries with the same key and reports the
result. Because a network error aborts a Shortcut before it can offer a retry,
a safe version needed an outbox file and about twenty actions built by hand in
the Shortcuts app. Trying to set it up showed this was too fiddly, even on the
Mac.

iOS does not let web apps appear in the share sheet (no Web Share Target
support in Safari), so some Shortcut is still needed for the share sheet.
The capture page already had idempotency, draft keeping and sync status.

Tried on the iPhone (Oct 26, 2026): Apple Notes shares its text; ChatGPT's
share button shares only a link to the chat, so ChatGPT answers are copied and
captured with *Paste & save*.

## Options Considered
### Option 1 (SELECTED): Share link to the capture page, plus a home screen app
The Shortcut only hands the text to the page; the page does the rest.

#### Consequences
 * Adopted because: setup is three standard actions and the home screen icon; there is no token on the phone to copy, store or rotate.
 * Adopted because: idempotency, the unsent draft, sync status and error handling live in one place, in code that is tested in a real browser.
 * Adopted because: the text never reaches the server's or Caddy's access logs, since the fragment is not sent.
 * Adopted despite: each share opens Safari and needs one tap on *Save*.
 * Adopted despite: Safari and the home screen app keep separate sessions, so the passkey is used once in each.
 * Adopted despite: `text=` must come last, because Shortcuts' URL Encode leaves `&`, `=` and `#` unencoded.

### Option 2: The token Shortcut from spec v0.3, with an outbox file
#### Consequences
 * Rejected because: about twenty hand-built actions with branching; too annoying to set up and to repair.
 * Rejected because: a token stored in the Shortcut is another secret to manage.
 * Rejected despite: it saves without leaving the source app.

### Option 3: A native iOS app with a share extension
#### Consequences
 * Rejected because: it needs Xcode, the Apple Developer Program for a lasting install, and upkeep with each iOS release.
 * Rejected despite: it is the only way to save straight from the share sheet without opening anything.

## Advice
 * The Shortcut flow is too annoying to set up with the Shortcuts app, even on the Mac - bfarkas, Owner, Oct 26, 2026

## Supporting Material
 * Capture guide [deploy/shortcut/README.md](../../deploy/shortcut/README.md)
 * Browser end-to-end check [app/e2e/browser.e2e.mjs](../../app/e2e/browser.e2e.mjs)
