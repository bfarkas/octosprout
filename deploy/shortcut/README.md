# iOS Shortcut: "OctoSprout Capture"

Build steps and an exported `.shortcut` file (without the token) go here
(spec §15.4). Prototyped against a stub endpoint in Phase 0, finished in Phase 1.

Behaviour:

- Accepts Text and URLs from the share sheet; asks for text when run directly.
- Generates one `idempotency_key` per run (timestamp + random number) and reuses it on every retry.
- Sends `source: shortcut`. The **OctoSprout from ChatGPT** variant sends `source: chatgpt`.
- POSTs to `https://app.octosprout.de/api/v1/inbox` with a dedicated, revocable inbox token.
- On a network error or 5xx, offers **Retry** with the same key.
- Shows "Saved OS-C-… ✓" (committed), "Saved OS-C-… (sync pending)" (pending), or the error.
