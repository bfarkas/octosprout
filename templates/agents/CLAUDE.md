@AGENTS.md

## Claude Code

- `.mcp.json` registers the `octosprout` MCP server, and
  `.claude/settings.json` sets `OCTOSPROUT_ACTOR=agent:claude-code`, so your
  CLI writes become proposals too.
- For the `advise` workflow, run one sub-agent per expert profile so each
  investigates independently, then synthesize.
