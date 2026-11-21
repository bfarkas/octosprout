---
name: handoff
description: Hand an OctoSprout task to a coding agent with its full context, and start the work in the target repository. Use when the user asks to hand off, start, implement or work on a task.
---

# Handoff

**Input:** a task ID. The task should be `ready`: its Objective, Acceptance
criteria and Verification are filled in.

**Output:** the work started in the target repository, from the handoff bundle,
and the task marked `in_progress`. The agent doing the work keeps the task
current with `log_progress` and ends with the `report` skill.

1. Get the bundle with `get_handoff_context` (or `octosprout handoff <task>`).
   It holds:
   - the task;
   - its project brief;
   - the accepted decisions;
   - the research;
   - the target repositories;
   - the standing instructions.

   It is generated on demand. Keep it out of the workspace: never commit it.
2. Check that the task is ready for work:
   - its acceptance criteria are concrete;
   - a target repository is named;
   - no decision in the bundle contradicts the task.

   Raise any gap with the user before going further, and fix the task with
   `update_task` once the user agrees.
3. Mark the work as started with `log_progress`, status `in_progress` and a
   note on where the work happens (`octosprout progress <task> <note>
   --status in_progress`). It is committed directly, so the board shows it.
4. Start the work in the target repository:
   - **Checked out on this machine:** work there with the bundle as the brief,
     following its Instructions in order. Log progress on the task at each
     milestone, and `blocked` with the reason if it cannot go on. Read the repository's own
     `AGENTS.md` and `CLAUDE.md` first; they govern there, and this
     workspace's rules do not apply.
   - **Not checked out:** give the user the bundle to paste into the coding
     agent's first message, and name the repository to open.
5. Tell the user what was handed off, where, and that the outcome comes back
   through the `report` skill.

**Done when** the coding agent has the bundle and the target repository, and
every gap from step 2 is resolved or acknowledged by the user.
