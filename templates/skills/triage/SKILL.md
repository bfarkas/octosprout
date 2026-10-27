---
name: triage
description: Triage the OctoSprout inbox. Use when the user asks to triage, sort or go through the inbox or new captures.
---

# Triage

**Input:** the captures with status `new` (`list_inbox`), or the ones the user
names.

**Output:** one triage proposal per capture, each of:
- **create** an idea, task or research record that `derived_from` the
  capture;
- **attach** the capture to an existing record that already covers it;
- **compost** a capture that is not worth keeping.

Create and attach also move the capture to `planted`.

1. Call `list_proposals` with status `pending`, and skip captures that already
   have a pending `Triage <capture ID>` proposal.
2. For each remaining capture, read its text and `search_records` for its key
   terms. A capture that an existing idea, task or research record already
   covers is an **attach**, never a duplicate.
3. Choose the type for a new record:
   - an **idea** is something to explore;
   - a **task** is one concrete piece of work;
   - **research** is a question to investigate.
4. Write the title as a short, specific noun phrase (under 80 characters).
5. Write the body from the template. The default is the quoted capture
   followed by the template's sections. Fill a section only with what the
   capture says, and leave the rest empty for the owner.
6. Call `propose_triage` with the capture, the action, the type, title and
   body, and a one-line rationale.
7. Report a table to the user: capture, action, new title or target, and
   proposal ID.

**Done when** every capture in scope has a pending triage proposal or is
listed in the report with the reason it was left. The owner can approve
routine triage proposals in bulk.
