# OctoSprout workspace instructions

This repository is an OctoSprout workspace: a Markdown-first, Git-backed record
of ideas, tasks, projects, decisions and research. It holds intent,
constraints, plans and decisions; implementation belongs in the code
repositories, each with its own `AGENTS.md`.

## Records

Every record is a Markdown file with YAML frontmatter and a stable ID such as
`OS-I-2HD9W` (`OS-<TYPE>-<RAND>`). IDs never change, whatever happens to the
title or filename.

| Type | Code | Location | Statuses |
|---|---|---|---|
| Capture | `C` | `records/captures/YYYY/MM/<ID>.md` | `new`, `planted`, `composted` |
| Idea | `I` | `records/ideas/<ID>--<slug>.md` | `seed`, `sprouting`, `ready`, `dormant`, `transplanted`, `composted` |
| Task | `T` | `records/tasks/<ID>--<slug>.md` | `backlog`, `ready`, `in_progress`, `blocked`, `done`, `cancelled` |
| Project | `P` | `records/projects/<ID>--<slug>.md` | `proposed`, `active`, `on_hold`, `completed`, `archived` |
| Decision (ADR) | `D` | `records/decisions/<ID>--<slug>.md` | `DRAFT`, `PROPOSED`, `ACCEPTED`, `ADOPTED`, `SUPERSEDED`, `EXPIRED` |
| Research | `R` | `records/research/<ID>--<slug>.md` | `open`, `concluded`, `archived` |
| Expert profile | `E` | `experts/<ID>--<slug>.md` | `active`, `retired` |
| Proposal | `PROP` | `proposals/YYYY/MM/<ID>.md` | `pending`, `applied`, `rejected`, `stale` |

Relationships are `links: [{rel, id}]`, stored once on the source record;
backlinks are computed. The relationships:

- `relates_to`: any record to any record.
- `belongs_to`: a task, decision or research record to its project.
- `derived_from`: an idea, task or research record to the capture it came
  from; a task also to an idea.
- `promoted_to`: an idea to the project it became.
- `blocks`: a task to the task it blocks.
- `supersedes`: a decision to the decision it replaces.
- `supports`: research to the idea, project, decision or task it informs.
- `implements`: a task to the decision it carries out.
- `consulted`: a decision to an expert profile.

## Proposals

You change this workspace only through **proposals**. A proposal is a file
under `proposals/` listing operations; the owner reviews its diff and approves
it in the browser, and only then do records change. Commit nothing else.

- **Tools.** Use the `octosprout` MCP server. The skills name its tools.
  Without it, the CLI does the same; add `--json` to every command:

  | MCP tool | CLI |
  |---|---|
  | `search_records`, `list_inbox`, `list_proposals` | `octosprout search`, `inbox`, `proposals` |
  | `get_record`, `get_related` | `octosprout show <ID>` (links and backlinks) |
  | `draft_record` | `octosprout new <type> <title> --draft` |
  | `propose` | `octosprout propose -` with `{title, rationale, operations}` on stdin |
  | `propose_triage` | `octosprout triage <capture> create\|attach\|compost …` |
  | `propose_promotion` | `octosprout promote <idea> <title> --brief-file - --tasks-file F` |
  | `propose_adr` | `octosprout new decision <title> --body-file -` |
  | `validate`, `sync` | `octosprout validate`, `sync` |
- **Operations:** `create` (path, content), `update` (id, base_blob, the whole
  new content), `set_status`, `add_link`, `remove_link` and `delete`. Every
  operation on an existing record carries its `base_blob` from `get_record`
  (`octosprout show`). A stale `base_blob` makes the proposal fail; read
  again and re-propose.
- **New records** come from `draft_record` (`octosprout new <type> <title>
  --draft --json`), which gives a fresh ID, the path and the template content.
  Fill in the sections and add the `create` operation to your proposal.
- **One proposal per coherent change**, with all its operations, so it is
  approved or rejected as a whole. The rationale says why, what you assumed
  and what is still open.
- **Validation.** A proposal that would make the workspace invalid is refused
  before it is committed. Read the findings and fix the operations.
- After proposing, give the user the proposal ID and what it changes.

## Rules

- **Captures are verbatim.** A capture's body and `content_sha256` stay as
  received; triage creates new records from it.
- **Accepted decisions are final.** A reversal is a new decision that
  `supersedes` the old one.
- **Consequential changes need the owner's passkey.** They are: promoting an
  idea; moving a decision to `ACCEPTED`, `SUPERSEDED` or `EXPIRED`; completing
  or archiving an active project, or editing its Goals, Non-goals, Scope or
  Success criteria; deleting any file; changing more than `bulk_threshold`
  records at once (in `octosprout.yaml`, default 10);
  and changing `octosprout.yaml`, `AGENTS.md`, `CLAUDE.md`, `skills/`,
  `.claude/`, `.mcp.json` or `.github/`. Propose them like any other change,
  and say in the rationale that they are consequential.
- **Simulated advice is marked.** Output written from an expert profile is
  labelled `(simulated, AI-generated, <model>)`. It is never human review.

## Skills

Before one of these workflows, read its `skills/<name>/SKILL.md` and follow it:

- `capture`: save something from this conversation to the inbox.
- `triage`: turn inbox captures into ideas, tasks or research, or compost them.
- `explore`: research and refine an idea.
- `relate`: find and propose missing links between records.
- `promote`: turn a ready idea into a project.
- `review-backlog`: find stale, blocked, unlinked or invalid records.
