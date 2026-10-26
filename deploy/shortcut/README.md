# Capturing from the iPhone (and Mac)

Two ways in, both through the web app at `https://app.octosprout.de`. You sign
in with your passkey; there is no token to copy into anything.

| Way | Steps per capture | Set up |
|---|---|---|
| **Share sheet** via a three-action Shortcut | Share → **OctoSprout** → **Save** | about a minute, once |
| **Home screen app** with *Paste & save* | Copy → tap the icon → **Paste & save** | add to Home Screen, once |

Both end in the same capture page, which does the careful parts: one
idempotency key per attempt (a retry never creates a duplicate), the unsent
text kept on the device until the server confirms it, and a clear
"Saved OS-C-… ✓" or "Saved OS-C-… (sync pending)".

## Share sheet: the OctoSprout shortcut

iOS does not let web apps appear in the share sheet, so a tiny Shortcut hands
the shared text to the capture page. It has no logic and no secrets.

In the Shortcuts app (iPhone or Mac), create a shortcut named **OctoSprout**:

1. Open the shortcut's details (ⓘ) and turn on **Show in Share Sheet**
   (on the Mac: **Use as Quick Action → Share Menu**). Set the input types to
   **Text**, **URLs** and **Safari web pages**. Set *If there's no input* to
   **Ask For Text**.
2. Add **URL Encode** with *Shortcut Input*.
3. Add **Text**: `https://app.octosprout.de/capture#text=` followed by the
   *URL Encoded Text* variable.
4. Add **Open URLs** with that *Text*.

Sharing now opens the capture page with the text filled in. Check it and tap
**Save**. If the text is a single link, it is also put in the link field.

The first time, Safari asks you to sign in with your passkey; afterwards the
session lasts 30 days from the last use. A share made while signed out is kept
through sign-in.

### ChatGPT briefs

For UC3 (spec §15.1), duplicate the shortcut, name it **OctoSprout from
ChatGPT**, and change the text in step 3 to
`https://app.octosprout.de/capture#source=chatgpt&text=` (keep `text=` last).
Captures made with it are recorded with `source: chatgpt`.

1. Explore the idea in the ChatGPT app.
2. Paste the handoff prompt from
   [`templates/prompts/chatgpt-handoff.md`](../../templates/prompts/chatgpt-handoff.md).
3. Share ChatGPT's brief to **OctoSprout from ChatGPT** and tap **Save**.

### Why the text goes after `#`

Everything after `#` stays in the browser: it is never sent to the server, so
capture text never appears in Caddy's or the app's access logs. The page reads
it, then removes it from the address bar. `text=` must be the last parameter:
everything after it is taken as the text, including `&`, `=` and `#`, because
Shortcuts' URL Encode leaves those characters as they are.

## Home screen app: Paste & save

1. Open `https://app.octosprout.de/capture` in Safari.
2. Share → **Add to Home Screen**. The icon opens straight into Capture, full
   screen.
3. Sign in once with your passkey inside the app (home screen apps keep their
   own sign-in, separate from Safari).

To capture: copy text anywhere, tap the icon, tap **Paste & save**. iOS shows a
small *Paste* button the first time; tap it to allow reading the clipboard.

## Inbox tokens

The share link and the home screen app use your passkey session, so they need
no token. Inbox tokens (Settings → Inbox tokens) remain for other clients of
the inbox API, such as scripts:

```sh
curl -sS -X POST https://app.octosprout.de/api/v1/inbox \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"text":"from a script","idempotency_key":"script-20261026-0001","source":"cli"}'
```
