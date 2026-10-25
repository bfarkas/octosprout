# iOS Shortcut: "OctoSprout Capture"

Share text or a link from any app (ChatGPT, Apple Notes, Safari, …) to
OctoSprout in two taps. This is spec §15.4. A `.shortcut` file cannot be built
or signed outside the Shortcuts app, so the shortcut is built by hand from the
steps below; the API it calls is documented in spec §15.2 and tested in
`app/packages/server`.

You need an inbox token: sign in at `https://app.octosprout.de`, open
**Settings**, create a token named `iphone-shortcut` and copy it. It is shown
once. The token can add captures and nothing else; revoke it in Settings if the
phone is lost.

## What the shortcut must do

1. **Accept** Text, URLs and Safari web pages from the share sheet
   (Shortcut Settings → Show in Share Sheet). When run directly, ask for text.
2. **Generate one idempotency key per capture**, and reuse it on every retry
   of that capture. This is what makes retries safe: the server answers a
   repeated key with the same capture and never creates a duplicate.
3. **POST** `https://app.octosprout.de/api/v1/inbox` and show what happened.

## Build steps

Create a new shortcut named **OctoSprout Capture** and add these actions.

### A. Pick up an unfinished capture (the outbox)

A network error aborts a shortcut before it can ask to retry, so the shortcut
keeps the capture in a file until the server has confirmed it.

1. **Get File** `Shortcuts/OctoSprout/outbox.json`, with *Error If Not Found* off.
2. **If** *File* has any value:
   1. **Get Dictionary from** *File*.
   2. **Choose from Menu** "An earlier capture was not confirmed":
      - **Retry it**: **Get Dictionary Value** `text` into variable `Text`, and
        `idempotency_key` into `Key`. Continue at step C.
      - **Discard it**: **Delete Files** *File*, then continue with step B.
3. **End If**.

### B. Start a new capture

1. **If** *Shortcut Input* has any value: **Text** = *Shortcut Input*.
   **Otherwise**: **Ask for Input** (Text) into `Text`.
   For a web page, use its URL as the text.
2. **Format Date** (Current Date, custom format `yyyyMMdd'T'HHmmss`) and
   **Random Number** (10000 to 99999). **Text**: `<date>-<number>`.
   **Set Variable** `Key`. This runs once per capture, outside any loop.
3. **Dictionary** `{ "text": Text, "idempotency_key": Key, "source": "shortcut" }`.
   **Save File** it to `Shortcuts/OctoSprout/outbox.json`, *Overwrite If File
   Exists* on.

### C. Send

1. **Dictionary** (if you came from the retry path, rebuild it from `Text`,
   `Key` and `"source": "shortcut"`).
2. **Get Contents of URL**
   - URL: `https://app.octosprout.de/api/v1/inbox`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <your token>`;
     `Content-Type` = `application/json; charset=utf-8`
   - Request Body: **JSON**, the dictionary above.
3. **Get Dictionary from** *Contents of URL*.

### D. Report the result

Read `status` and `id` from the response dictionary.

| Response | Meaning | Do |
|---|---|---|
| `status` = `committed` | On GitHub | **Delete Files** the outbox file. Show "Saved *id* ✓". |
| `status` = `pending` | Stored on the server; GitHub sync pending | **Delete Files** the outbox file. Show "Saved *id* (sync pending)". Nothing is lost; the server keeps retrying. |
| `error` = `idempotency_conflict` | This key was already used for different text | Delete the outbox file. Show the error. |
| `error` = `invalid_request` or `payload_too_large` | The server rejected the text; retrying will not help | Delete the outbox file. Show `message`. |
| `error` = `unauthorized` | Token missing, wrong or revoked | **Keep** the outbox file. Show "Check the token", fix it, run the shortcut again and choose *Retry it*. |
| `error` = `rate_limited` or `unavailable` | Try again shortly | **Keep** the outbox file. Show the error; run again and choose *Retry it*. |
| (no response at all) | Network error | Shortcuts stops with an error. The outbox file is still there, so run the shortcut again and choose *Retry it*: the same key is sent. |

Use **If** actions on the `status` and `error` values, and **Show Notification**
or **Show Result** for the messages.

## The ChatGPT variant: "OctoSprout from ChatGPT"

A shortcut cannot tell which app shared something. Duplicate the shortcut,
rename it **OctoSprout from ChatGPT** and change `"source": "shortcut"` to
`"source": "chatgpt"` in both places. The server stores which one you used, so
captures from ChatGPT can be recognised later.

Workflow for UC3 (spec §15.1):

1. Explore the idea in the ChatGPT app.
2. Paste the handoff prompt from
   [`templates/prompts/chatgpt-handoff.md`](../../templates/prompts/chatgpt-handoff.md).
3. Share ChatGPT's brief to **OctoSprout from ChatGPT**.
4. The capture appears in the Inbox. Triage it into an Idea later.

## Check it from a computer first

```sh
curl -sS -X POST https://app.octosprout.de/api/v1/inbox \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{"text":"shortcut check","idempotency_key":"check-20261025-0001","source":"shortcut"}'
```

Expect `{"id":"OS-C-…","status":"committed",…}` with HTTP 201. Running it again
returns the same `id` with HTTP 200.
