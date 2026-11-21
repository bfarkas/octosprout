# ADR008 - Agents commit routine task changes directly
* Date: Nov 21, 2026
* Status: ACCEPTED
* Author: bfarkas (drafted with Claude Code)

## Decision
Agents, through the local stdio MCP server, the remote MCP server and the CLI, commit
**routine changes to tasks** directly, the same way the owner does in the browser.
Everything else they still propose. This amends D12 and the tool rule in ADR007 ("write
tools only create proposals") for tasks only.

**What an agent may commit directly.** A set of operations is applied without a proposal
when all of these hold:
- every operation touches a task: `update`, `set_status`, `add_link` or `remove_link` on an existing task, or `create` of a new task under `records/tasks/`;
- `classifyOperations` finds it routine: no `delete`, no guarded path, not over `bulk_threshold`. The unblocked tasks a move to `done` carries (§7.3) count, as they do in the browser;
- applying it adds no validation errors;
- every `base_blob` still matches.

Anything else falls back to a proposal, as today. In practice an agent can:
- move its task between `backlog`, `ready`, `in_progress`, `blocked` and `done`;
- append to `## Handoff log`;
- tick acceptance criteria;
- add `pr` and `commit` refs;
- create follow-up tasks in `backlog`.

**Tools.**
- `log_progress(task, note, status?)` is new. It appends a `### <date>: progress (<actor>)` entry to the task's Handoff log, and optionally changes the status, in one commit. An agent calls it at the start (`in_progress`), at milestones, and when blocked.
- `report_handoff` replaces `propose_handoff_report`, with the same input and the same entry format (§11.4).
- `update_task(operations)` is new: generic task operations, for edits the typed tools don't cover.
- Every write tool returns either `{ applied: <commit> }` or, when the rules above send it to a proposal, `{ proposal: <id>, reasons }`, so the agent always knows which one happened.
- The CLI gets the same commands: `octosprout progress` and `octosprout report`, which now applies directly.
- `propose` and the other `propose_*` tools are unchanged.

**Commits.**
- Remote MCP writes go through `GitWriteService`, under its lock and journal, like browser edits.
- The stdio server and CLI commit to the Mac checkout and `sync`. A failed push is reported as `synced.error` and the commit stays local, as for proposals today.
- The operation trailer is `OctoSprout-Operation: task-update` and the actor is `agent:<client>` (§8.6), so every agent write can be found and reverted.

**Visibility.** The task's record page already renders the Handoff log. The board card
adds the date and actor of the latest Handoff log entry, so a task an agent is working
on shows as `in_progress` with when it last reported.

**Unchanged.** Validation, signing and §9.4 enforcement stay as they are. No task state
is consequential, so direct task writes need no approval block.

## Context
§9.1 made agents proposal-only for every change, routine ones included, because v0.2
required AI-assisted changes to be reviewable. In use, this gets in the way of the main
agent workflow (§11): a coding agent working on a task can't say it has started, log
progress, or mark the task blocked. It files one proposal at the end, and until the
owner approves it the board says nothing about the work.

The review requirement is met another way already. Every commit carries the actor
trailer, so the owner can see and revert any agent change. The signed approval, the
part an agent cannot forge, guards consequential operations only (§9.2), and no task
state is one of them.

## Options Considered
### Option 1 (SELECTED): Direct writes for routine task operations, proposals for the rest
#### Consequences
 * Adopted because: the agent working on a task keeps it current, and the owner sees progress on the board as it happens.
 * Adopted because: it reuses the browser's existing routine/consequential split (`classifyOperations`, `moveStatus`), so there is one rule for what needs approval.
 * Adopted because: limiting it to tasks keeps the change small. Ideas, projects, research and decisions keep the review step.
 * Adopted despite: an agent can mark a task `done` that isn't, which also moves the tasks it unblocks to `ready`. It is one attributed commit and can be reverted.
 * Adopted despite: a stolen remote MCP token can now change tasks, not only file proposals, until the grant is revoked (ADR007).
 * Adopted despite: a direct write from the Mac can conflict with a browser edit to the same task. `sync` then fails and reports it, as any rebase conflict does.

### Option 2: Keep proposals, auto-apply routine agent proposals
#### Consequences
 * Rejected because: a proposal file for every progress note fills the audit trail with noise, and gives no review the commit trailer doesn't already give.

### Option 3: A separate progress channel outside the workspace (server-side status, not committed)
#### Consequences
 * Rejected because: the workspace is the source of truth (§2). Progress kept elsewhere would be lost from git history, backups and the Mac checkout.

### Option 4: Direct writes for every non-consequential operation on any record
#### Consequences
 * Deferred: tasks are where agents need to write while they work. Reconsider other record types once task writes have been in use for a while.

## Advice
 * None recorded.

## Supporting Material
 * Spec §7.3, §9.1, §9.2, §11.4, §16.3
 * [ADR007](0007-remote-mcp-with-oauth.md): remote MCP, whose write rule this amends for tasks
 * [app/packages/core/src/proposals.ts](../../app/packages/core/src/proposals.ts): `classifyOperations`
 * [app/packages/server/src/records/status.ts](../../app/packages/server/src/records/status.ts): `moveStatus`
