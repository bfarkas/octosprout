<p align="center">
  <img src="assets/octosprout-logo.png" alt="OctoSprout logo" width="400">
</p>

# OctoSprout

A personal, Markdown-first, Git-backed workspace for capturing ideas, exploring
them with AI assistants, refining them into projects, recording architectural
decisions, and preparing context for coding agents.

> **Status:** early development. Phase 1 (ingestion) is deployed: the inbox
> API, Git write service, passkey sign-in, Inbox view, capture form and token
> management. Phase 2 (core workspace) is in progress: every record schema,
> the full validator with signed approvals, the record index and the Ideas,
> Tasks, Projects and Decisions boards are built. The current specification is
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
node app/packages/cli/dist/index.js init [dir]       # create a private workspace skeleton
node app/packages/cli/dist/index.js validate [--ci] [--json] [path…]
```

`init` never overwrites existing files and installs a `pre-push` hook that
runs `validate` when the target is a Git repository.

## License

OctoSprout is licensed under the [Apache License 2.0](LICENSE).

The vendored ADR template in `templates/adr/` keeps its own licence, MPL-2.0;
see its [`NOTICE.md`](templates/adr/NOTICE.md).
