# ChatGPT handoff brief

At the end of a ChatGPT conversation, send `/octosprout` and ChatGPT replies
with a structured brief of the conversation, ready to capture into OctoSprout
(spec §15.1 UC3). The brief preserves useful context. It does not replace the
original conversation.

## Set up the `/octosprout` command (once)

ChatGPT has no way to register your own slash commands, so `/octosprout` is a
convention defined in your Custom Instructions. Custom Instructions apply on
the web, the Mac app, iPhone and Android.

1. Open **Settings → Personalization → Custom Instructions** (web or Mac) or
   **Settings → Customize ChatGPT** (mobile).
2. Append this text to your existing instructions:

```text
OctoSprout handoff command: when I send "/octosprout" or "Prepare this for
OctoSprout", reply with an OctoSprout handoff brief of the current
conversation. Treat it as a command, not a question.

Output plain Markdown under 600 words, with exactly these headings, in this
order:

Working title:
Description: (2–3 sentences)
## Problem or motivation
## Proposed approach
## Important insights and constraints
## Alternatives considered
## Open questions and uncertainties
## Suggested next step
## Sources (links, if any)

Be faithful to the conversation. Keep important decisions, requirements,
constraints, alternatives and open questions. Mark inferred information as
(inferred). Do not invent facts or sources; if a detail is unknown, say so
briefly. Include relevant source links when available. Return only the brief,
with no introduction or closing remarks.
```

If the field is too short for it, shorten the last paragraph rather than the
headings: the headings are what makes every brief look the same.

## Use it

1. In the conversation you want to keep, send `/octosprout`.
2. Tap **Copy** under the brief.
3. Capture it: tap the OctoSprout home screen icon, then **Paste & save**. Or,
   to keep the chat link and record `source: chatgpt`, share the chat to
   **OctoSprout from ChatGPT** and tap **Paste & save** (see
   [`deploy/shortcut/README.md`](https://github.com/bfarkas/octosprout/blob/main/deploy/shortcut/README.md)).

## Limits

- It is a convention, not a feature: ChatGPT follows it reliably, but not with
  the guarantee of a built-in command. If a reply drifts from the format, send
  `/octosprout` again or paste the one-off prompt below.
- Temporary chats, and chats with personalization turned off, may ignore
  Custom Instructions.
- ChatGPT can only summarize what is in the current conversation, so send the
  command in that conversation.

## One-off prompt

Without the setup, for example in another account or a temporary chat, paste
this instead:

```text
Please write an OctoSprout handoff brief of our conversation so far, in plain
Markdown, using exactly these headings:

Working title:
Description: (2–3 sentences)
## Problem or motivation
## Proposed approach
## Important insights and constraints
## Alternatives considered
## Open questions and uncertainties
## Suggested next step
## Sources (links, if any)

Be faithful to what we discussed; mark anything you inferred as (inferred).
Do not invent sources. Keep it under 600 words.
```
