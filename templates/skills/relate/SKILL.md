---
name: relate
description: Find and propose missing links between OctoSprout records. Use when the user asks to relate, connect or link records, or to find what is related to one.
---

# Relate

**Input:** one record ID, or a scope such as a project, all ideas, or
everything updated recently.

**Output:** one proposal of `add_link` operations, or a report that nothing is
missing.

1. For each record in scope, read it with `get_record`, and its existing
   links and backlinks with `get_related`.
2. `search_records` for its distinctive terms: names, components, problems.
3. For each candidate, choose the most specific relationship the rules in
   `AGENTS.md` allow; use `relates_to` only when none fits. Store each link
   once, on the source record its rule names. A backlink already relates the
   two records.
4. Keep a link only if the owner, reading both records, would agree at once.
   Precision matters more than recall here: an extra link costs every future
   reader.
5. Call `propose` with the `add_link` operations, each with its record's
   `base_blob`. The rationale lists each link with a one-line reason.

**Done when** every record in scope has been searched, and every link the
owner would agree with is in the proposal. Report the records that need none.
