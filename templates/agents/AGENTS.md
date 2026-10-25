# OctoSprout workspace instructions

This repository is an OctoSprout workspace: a Markdown-first, Git-backed record
of ideas, tasks, projects, decisions and research. These rules apply to every
AI assistant working here.

## Records

Every record is a Markdown file with YAML frontmatter and a stable ID such as
`OS-I-2HD9W` (`OS-<TYPE>-<RAND>`). IDs never change, whatever happens to the
title or filename.

| Type | Code | Location |
|---|---|---|
| Capture | `C` | `records/captures/YYYY/MM/<ID>.md` |
| Idea | `I` | `records/ideas/<ID>--<slug>.md` |
| Task | `T` | `records/tasks/<ID>--<slug>.md` |
| Project | `P` | `records/projects/<ID>--<slug>.md` |
| Decision (ADR) | `D` | `records/decisions/<ID>--<slug>.md` |
| Research | `R` | `records/research/<ID>--<slug>.md` |
| Expert profile | `E` | `experts/<ID>--<slug>.md` |
| Proposal | `PROP` | `proposals/YYYY/MM/<ID>.md` |

Relationships are `links: [{rel, id}]`, stored once on the source record.
Backlinks are computed, never written.

## Rules

- **Never edit records directly.** Agents change the workspace only by creating
  proposals, which the user approves in the browser UI. Until proposals are
  available, describe the change you would make and let the user apply it.
- **Never edit a capture's body.** It is stored verbatim and protected by
  `content_sha256`.
- **Never edit an accepted decision's body.** A reversal is a new decision that
  `supersedes` the old one.
- **Respect approval boundaries.** Promoting an idea, accepting a decision,
  completing a project, deleting files, bulk changes and edits to
  `octosprout.yaml`, `AGENTS.md`, `CLAUDE.md` or `skills/` are consequential and
  need explicit user approval.
- **Mark simulated advice.** Expert-profile output is AI-generated. Label it
  `(simulated, AI-generated, <model>)`. It is never human review.
- **Run `octosprout validate`** before you finish. Fix the errors you caused.

## Not here

Implementation details belong in the code repositories. This workspace holds
intent, constraints, plans and decisions. Read a code repository's own
`AGENTS.md` and `CLAUDE.md` before changing it.
