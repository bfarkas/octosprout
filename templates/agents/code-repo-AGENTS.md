## Planning with OctoSprout

<!-- Paste this section into the AGENTS.md of a code repository whose work is
tracked in an OctoSprout workspace. Fill in the workspace and project. -->

Work in this repository is planned and tracked as tasks in the OctoSprout
workspace `<workspace repository or checkout path>`, project `<OS-P-…>`. Use
the `octosprout` MCP server, or the `octosprout` CLI run in the workspace
checkout with `--json`.

- **The plan lives in tasks.** Before work that takes more than one step,
  find its task with `search_records`, or create one. Put the plan in the
  task's Scope and Acceptance criteria, not in a private TODO list or plan
  file. Get the brief with `get_handoff_context`.
- **Split work into tasks, not checklists.** Work bigger than one pull
  request becomes several tasks: `draft_record` for each, then `update_task`
  to create them in `backlog`, `belongs_to` the project, `blocks` for order.
  Follow-ups you find while working become tasks the same way.
- **Orchestrate by task.** When you run sub-agents or parallel sessions, give
  each one its own task and its handoff bundle. Pick the next work from
  `ready` tasks; never start a task another agent has `in_progress`.
- **Keep tasks current.** `log_progress` with `in_progress` when you start, a
  note at each milestone, `blocked` with the reason. End with
  `report_handoff`: outcome, verification, commit and PR refs.
- **Only tasks change directly.** A plan that changes the project's goals,
  scope or decisions is a proposal (`propose`, `propose_adr`) for the owner
  to approve.
