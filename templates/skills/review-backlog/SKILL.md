---
name: review-backlog
description: Review the OctoSprout backlog for stale, blocked, unlinked or invalid records and propose fixes. Use when the user asks for a backlog review, cleanup or "what's stuck".
---

# Review backlog

**Input:** the whole workspace, or a scope the user names (a project, a type).

**Output:**
- a report of findings, grouped by kind;
- one proposal per kind of clear fix.

1. Run `validate`. Every error and warning is a finding. Propose a fix for
   those you can fix from the record alone.
2. List records with `search_records` by type and status, which gives the
   most recently updated first. Look for each of these:

   | Finding | Rule (defaults, unless the user gives others) | Fix to propose |
   |---|---|---|
   | Inbox backlog | captures `new` for more than 7 days | name them for `triage` |
   | Stale work | tasks `in_progress` not updated for 14 days | report and ask |
   | Stale blocks | tasks `blocked` with no open task that `blocks` them | `set_status` `ready` |
   | Hidden blocks | tasks `blocked` with nothing linked that `blocks` them | report: say what blocks them |
   | Forgotten ideas | ideas `seed` or `sprouting` not updated for 60 days | `set_status` `dormant` |
   | Open research | research `open` not updated for 30 days | report and ask |
   | Unlinked records | ideas, tasks, decisions or research with no links and no backlinks | name them for `relate` |
   | Stuck proposals | proposals `pending` for more than 7 days, or `stale` | report |
   | Stale decisions | decisions `DRAFT` or `PROPOSED` for more than 30 days | report and ask |

3. Call `propose` once for each kind of fix, with every record of that kind.
   A batch over the bulk threshold becomes consequential, so split it when
   the user prefers routine approvals.
4. Report:
   - each kind of finding, with its records;
   - the proposal IDs;
   - what you left for the user to decide.

**Done when** every record in scope has been checked against every row of the
table, and every finding is either in a proposal or in the report.
