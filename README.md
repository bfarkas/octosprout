<p align="center">
  <img src="assets/octosprout-logo.png" alt="OctoSprout logo" width="400">
</p>

# OctoSprout

A personal, Markdown-first, Git-backed workspace for capturing ideas, exploring
them with AI assistants, refining them into projects, recording architectural
decisions, and preparing context for coding agents.

> **Status:** early development. Phase 1 (ingestion) is deployed: the inbox
> API, Git write service, passkey sign-in, Inbox view, capture form and token
> management. Phase 2 (core workspace) is built, not yet deployed: every
> record schema, the full validator with signed approvals, the boards, record
> detail and editing, triage, proposals with passkey-confirmed approvals, the
> promotion wizard, ADRs from the template, Research and Experts lists,
> search and the health panel. The current specification is
> [`docs/spec/implementation-spec-v0.4-draft.md`](docs/spec/implementation-spec-v0.4-draft.md).

## Repository layout

```text
docs/spec/        implementation specification (current and superseded drafts)
docs/adr/         OctoSprout's own architecture decisions
docs/operations/  deploy, backup, restore and token rotation runbooks
app/              pnpm workspace
  packages/core/    @octosprout/core: record model, IDs, schemas, validation
  packages/server/  octosprout-server: inbox API, UI, auth, approvals, Git writes
  packages/cli/     octosprout CLI and local stdio MCP server
  packages/web/     browser UI (shape decided in Phase 0)
schemas/          canonical JSON Schemas (draft 2020-12) for record frontmatter
templates/        starter content copied by `octosprout init`
deploy/           example Compose, Caddy and iOS Shortcut setup (no secrets)
resources/        reserved for the post-MVP public resource library
```

Personal workspace content lives in a separate private repository
(`octosprout-private`), never here.

## Development

Requires Node.js (the version in [`.nvmrc`](.nvmrc), currently the Active LTS)
and pnpm.

```sh
cd app
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

For an end-to-end check in a real browser (passkey registration, capture,
share links, *Paste & save*, sign-out and sign-in with a virtual
authenticator, and moving cards on the Tasks board), build and run `pnpm e2e` in `app/`; the first time, install
Chromium with `pnpm exec playwright install chromium`. To check the server
image, build it and run `deploy/smoke-test.sh`. CI runs both.

### CLI

```sh
alias octosprout="node $PWD/app/packages/cli/dist/index.js"
octosprout init [dir]                 # create a private workspace skeleton
octosprout validate [--ci] [--json]   # check it (spec §19)
octosprout new task "Pick a send day" --project OS-P-0XZ4K
octosprout capture - --source claude < notes.md
octosprout show OS-T-QF81M --json     # with base_blob, links and backlinks
octosprout search digest --type idea
octosprout move OS-T-QF81M done       # routine moves commit; consequential ones become proposals
octosprout link OS-I-2HD9W relates_to OS-P-0XZ4K
octosprout triage OS-C-7K3QX create idea   # or: attach OS-I-2HD9W | compost
octosprout promote OS-I-2HD9W Weekly digest --tasks-file tasks.txt
octosprout new research "Prior art" --draft --json   # a record for a larger proposal
octosprout advise OS-D-9PKVR - < advice.json        # simulated expert advice on a decision
octosprout handoff OS-T-QF81M                       # the context bundle for a coding agent
octosprout progress OS-T-QF81M "Scheduler done" --status in_progress  # a note in its Handoff log
octosprout report OS-T-QF81M - < report.json        # its outcome: log entry, refs, status, follow-ups
octosprout propose - < proposal.json  # { title, rationale, operations }
octosprout update - < changes.json    # the same, committed when routine
octosprout sync                       # fetch, rebase, validate, push
octosprout mcp                        # the stdio MCP server for Claude Code
```

Every command takes `--json`. `init` never overwrites existing files and
installs a `pre-push` hook that runs `validate`. With
`OCTOSPROUT_ACTOR=agent:<name>` (set for Claude Code), a writing command
commits only routine changes to tasks, so an agent can keep the task it works
on current (ADR008). Everything else becomes a proposal that you approve in
the browser (spec §9.1).

`init` also copies the starter skills into `skills/`. It writes `.mcp.json`,
which registers `octosprout mcp` with Claude Code, and `.claude/settings.json`,
which sets `OCTOSPROUT_ACTOR=agent:claude-code` so that Claude Code's CLI
calls follow the same rules. Its read tools (`search_records`, `get_record`,
`get_related`, `list_inbox`, `list_proposals`, `validate`, `draft_record`,
`get_handoff_context`) read the checkout.
Its task tools (`log_progress`, `report_handoff`, `update_task`) commit
routine changes to tasks directly, then push. Its proposal tools (`propose`,
`propose_triage`, `propose_adr`, `propose_advice`, `propose_promotion`), and
any task change that is consequential, commit one proposal file, then push
it; nothing changes until you approve it in the browser. A write that would
not validate is refused up front.

## License

OctoSprout is licensed under the [Apache License 2.0](LICENSE).

The vendored ADR template in `templates/adr/` keeps its own licence, MPL-2.0;
see its [`NOTICE.md`](templates/adr/NOTICE.md).
