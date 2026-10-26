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

### 1. Create the shortcut and configure sharing

1. Open the Shortcuts app.
2. Click **+** to create a new shortcut.
3. Name it `OctoSprout`.
4. Open the shortcut's details.
5. On macOS, enable **Use as Quick Action**, then select **Share Menu**. On
   iPhone, enable **Show in Share Sheet**.
6. Configure the accepted input types:
   - Text
   - URLs
   - Safari web pages
7. Set **If there's no input** to **Ask For Text**.

### 2. Add the three actions

Add these actions in the following order. Use the action search field to find
each one.

**Action 1: URL Encode.** Search for `URL Encode`. Set its input to the
**Shortcut Input** variable. This converts the supplied text or URL into
URL-safe encoded text.

**Action 2: Text.** Add a **Text** action containing this exact prefix:

```text
https://app.octosprout.de/capture#text=
```

Immediately after the `=` character, insert the **URL Encoded Text** magic
variable from Action 1. Do not type the variable name as ordinary text.

**Action 3: Open URLs.** Search for `Open URLs`. Set its URL input to the
**Text** result from Action 2. Insert the variable rather than manually
retyping the address.

### 3. Check the finished shortcut

Your action list should look like this:

1. **URL Encode**: Shortcut Input
2. **Text**: capture URL + URL Encoded Text
3. **Open URLs**: Text result

### 4. Test it

1. Select some text in Safari or another app.
2. Open the Share Sheet.
3. Choose **OctoSprout**.
4. Verify that the OctoSprout capture page opens and receives the selected
   text, then tap **Save**.

If you run the shortcut without selecting anything, it should ask you to enter
text. If the text is a single link, it is also put in the link field.

The first time, Safari asks you to sign in with your passkey; afterwards the
session lasts 30 days from the last use. A share made while signed out is kept
through sign-in.

### ChatGPT briefs

ChatGPT's share button shares only a link to the conversation, not the text of
an answer. To capture a brief (UC3, spec §15.1):

1. Explore the idea in the ChatGPT app.
2. Paste the handoff prompt from
   [`templates/prompts/chatgpt-handoff.md`](../../templates/prompts/chatgpt-handoff.md).
3. Tap **Copy** under ChatGPT's answer.
4. Either:
   - **Quickest:** tap the OctoSprout home screen icon, then **Paste & save**.
   - **With the chat link and `source: chatgpt`:** share the chat to
     **OctoSprout from ChatGPT**, then tap **Paste & save**. The copied answer
     becomes the text; the chat link is kept as the capture's link.

For **OctoSprout from ChatGPT**, duplicate the shortcut and change the prefix in
Action 2 to `https://app.octosprout.de/capture#source=chatgpt&text=` (keep
`text=` last, with the variable right after it).

Whenever only a link arrives, the capture page says so and keeps the link for
*Paste & save*.

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
