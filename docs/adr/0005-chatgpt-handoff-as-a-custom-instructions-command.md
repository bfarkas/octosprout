# ADR005 - ChatGPT handoff brief as an `/octosprout` Custom Instructions command
* Date: Oct 26, 2026
* Status: ADOPTED
* Author: bfarkas (drafted with Claude Code)

## Decision
The ChatGPT handoff brief (spec Appendix B) is produced by sending
`/octosprout`, a command defined once in ChatGPT's Custom Instructions, rather
than by pasting the prompt into each conversation. The pasted prompt remains as
a fallback. The brief is captured by copying it and using *Paste & save*.

## Context
UC3 (spec §15.1) asked the user to paste a prompt at the end of each ChatGPT
conversation. ChatGPT has no user-defined slash commands, but Custom
Instructions apply across the web, the Mac app, iPhone and Android. ChatGPT's
share button shares only a link to the conversation, not the brief.

## Options Considered
### Option 1 (SELECTED): `/octosprout` defined in Custom Instructions
#### Consequences
 * Adopted because: one short trigger on every device, with the same nine headings every time.
 * Adopted despite: it is a convention ChatGPT follows, not a guaranteed command; temporary or unpersonalized chats may ignore it.

### Option 2: Paste the prompt each time
#### Consequences
 * Rejected because: the prompt has to be at hand on every device and every time.
 * Rejected despite: it works everywhere, so it stays as the fallback.

### Option 3: A custom GPT
#### Consequences
 * Rejected because: the brief must summarize the current conversation, which a separate GPT does not see.

## Advice
 * None recorded.

## Supporting Material
 * [templates/prompts/chatgpt-handoff.md](../../templates/prompts/chatgpt-handoff.md)
