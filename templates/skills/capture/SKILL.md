---
name: capture
description: Save something from this conversation to the OctoSprout inbox as a capture. Use when the user says capture, save, jot down, remember or "put this in the inbox".
---

# Capture

**Input:** what the user wants kept: their words, a passage of this
conversation, a link.

**Output:** a proposal that creates one capture, which appears in the inbox
once approved.

1. Take the text the user means, in their words. Quote rather than summarize,
   unless they ask for a summary; a capture is kept verbatim and triage works
   from it later.
2. Create it with the CLI, passing the text on stdin:

   ```sh
   octosprout capture - --source claude --json [--url https://…] <<'EOF'
   …the text…
   EOF
   ```

   Add `--url` when the capture is about one web page.
3. Tell the user the proposal ID. The capture enters the inbox when they
   approve it.

**Done when** the CLI reports `"kind": "proposed"`, and the user has the
proposal ID.
