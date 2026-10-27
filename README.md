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
octosprout propose - < proposal.json  # { title, rationale, operations }
octosprout sync                       # fetch, rebase, validate, push
octosprout mcp                        # the stdio MCP server for Claude Code
```

Every command takes `--json`. `init` never overwrites existing files and
installs a `pre-push` hook that runs `validate`. With
`OCTOSPROUT_ACTOR=agent:<name>` (set for Claude Code), every writing command
creates a proposal instead of changing records; you approve it in the
browser (spec §9.1).

`init` also copies the starter skills into `skills/`. It writes `.mcp.json`,
which registers `octosprout mcp` with Claude Code, and `.claude/settings.json`,
which sets `OCTOSPROUT_ACTOR=agent:claude-code` so that Claude Code's CLI
calls also become proposals. Its read tools (`search_records`, `get_record`,
`get_related`, `list_inbox`, `list_proposals`, `validate`, `draft_record`) read
the checkout.
Its write tools (`propose`, `propose_triage`, `propose_adr`,
`propose_promotion`) commit one proposal file, then push it. Nothing changes
until you approve the proposal in the browser. A proposal that could not
validate once applied is refused up front.

## License

OctoSprout is licensed under the [Apache License 2.0](LICENSE).

The vendored ADR template in `templates/adr/` keeps its own licence, MPL-2.0;
see its [`NOTICE.md`](templates/adr/NOTICE.md).
