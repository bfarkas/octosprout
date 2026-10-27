# Starter skills

`octosprout init` copies each `<name>/SKILL.md` here into the workspace's
`skills/` (spec §16.2), and `AGENTS.md` lists them. Each states its input, its
output, the tools it uses, and when it is done. The rules they share live once
in `AGENTS.md`:
- side effects are proposals only;
- proposals are validated;
- consequential changes need the owner's approval.

The skills are plain Markdown, so any agent that can read files and run the
CLI can follow them. The MCP server is faster, but no skill depends on it.

`handoff` and `report` arrive with the handoff context.
