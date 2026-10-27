---
name: report
description: Report the outcome of a coding agent's work on an OctoSprout task back to the workspace as a proposal. Use when the work on a handed-off task is finished, stopped or blocked, or the user asks to report back.
---

# Report

**Input:** a task ID, and the work done on it in the target repository.

**Output:** one proposal (`propose_handoff_report`) that:
- appends a dated entry to the task's `## Handoff log`, with the outcome,
  the verification and the references;
- adds refs for the PRs and commits;
- optionally moves the task and drafts follow-up tasks.

1. Gather the facts from the target repository:
   - the commits on the branch (`git log`) and the pull request URL;
   - the verification actually run, such as tests, checks and manual steps,
     with the result of each.

   Report what was observed. Name a check that was not run as not run.
2. Compare the result with each acceptance criterion of the task:
   - all met → `status` `done`;
   - stopped by something outside the task → `blocked`, with the blocker in
     the outcome;
   - otherwise → leave the status as it is.
3. Turn work that was found but left out into `follow_ups`, each with a
   title and an objective. Surface a conflict with a decision in the outcome
   too, never only in a follow-up.
4. Propose the report from the OctoSprout workspace with
   `propose_handoff_report`, passing the outcome, the verification, the
   `prs`, the `commits`, the status and the follow-ups. Without the MCP
   server, run it from the workspace checkout as the agent:

   ```sh
   cd <workspace> && OCTOSPROUT_ACTOR=agent:claude-code octosprout report <task> - --json <<'EOF'
   { "outcome": "…", "verification": "…", "prs": ["https://…"], "commits": ["<sha>"], "status": "done" }
   EOF
   ```
5. Tell the user the proposal ID and summarize the outcome against the
   acceptance criteria.

**Done when** every acceptance criterion is accounted for in the outcome as met,
unmet or blocked, and the proposal exists.
