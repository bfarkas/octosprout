# OctoSprout — Implementation Specification

**Version:** 0.4-draft
**Date:** 26 October 2026
**Status:** Consolidated MVP specification. Supersedes v0.3-draft, which superseded v0.1-draft (OctoVault) and v0.2-draft. v0.4 records what Phase 0 and Phase 1 decided and built; see §0.3. Items marked **[Spike]** are confirmed or decided in Phase 0; items marked **[Assumption]** are defaults chosen while drafting and need your confirmation.

---

## 0. About this document

### 0.1 Relationship to earlier drafts

- **v0.1-draft (OctoVault):** single repository, board-centric, detailed record model, ADR process, expert profiles and coding-agent handoff.
- **v0.2-draft (OctoSprout):** renamed the product, split it into a private workspace and a public resource library, added Capture records and the Inbox Service, and made mobile/ChatGPT ingestion the first milestone.
- **v0.3:** merges both. v0.2's architecture applies, and v0.1's detailed requirements carry forward unless this document changes them. The public resource library is **post-MVP** (§17).
- **v0.4 (this document):** v0.3 updated with the decisions taken while building Phase 1 (D17–D21) and the board engine decision (D5), recorded as ADRs in `octosprout/docs/adr/`. The main changes are mobile capture (§15.4) and the boards (§12).

The terms MUST, MUST NOT, SHOULD and MAY are used in their RFC 2119 sense.

### 0.2 Decision log

| # | Topic | Decision |
|---|---|---|
| D1 | Location of application code | Public `octosprout` repository (`app/`, `docs/`). Personal deployment config lives in `octosprout-private`. |
| D2 | Public resource library | Post-MVP. Its layout and ID namespace (`OSL-`) are reserved now. |
| D3 | v0.1 features retained | Separate Ideas/Tasks/Projects boards, expert profiles with advice capture, coding-agent handoff with outcome reporting, and the full v0.1 validation and test list. |
| D4 | Process layout | One backend serves the inbox API, browser UI and approvals, using one working tree and one serialized writer. |
| D5 | Board engine | Thin custom UI on `@octosprout/core` and the Fastify server: server-rendered boards with small scripts, no build step. Kanban Lite was evaluated and rejected (§12.1, ADR006). |
| D6 | Stack | TypeScript on Node.js. No frontend framework; pages are server-rendered with small hand-written scripts (D5, D18). |
| D7 | Git writes | Local clone on rei3 driven by the git CLI. A rejected push triggers fetch, rebase, re-validate and retry. The service never force-pushes. |
| D8 | ID prefixes | Private records use `OS-<TYPE>-…`. Public resources use `OSL-<TYPE>-…`. |
| D9 | ID allocation | Non-sequential random IDs (§6.1). No coordination is needed between writers. |
| D10 | Lifecycle vocabulary | Captures and Ideas use garden names. Tasks and Projects use plain names. ADRs use the upstream vocabulary. |
| D11 | Capture triage | A capture can become an Idea, Task or Research record, be attached to an existing record, or be composted. |
| D12 | Approvals | Agents can only create proposals. You approve them in the browser UI, which applies each approved proposal in one signed commit. |
| D13 | MCP | MVP: local stdio MCP server plus CLI on the Mac. Remote MCP comes after the MVP. |
| D14 | Network exposure | Public internet through Caddy on rei3, with Let's Encrypt TLS. Every endpoint requires authentication. |
| D15 | Browser authentication | App-native, single-user passkey (WebAuthn) login. |
| D16 | Domain | `octosprout.de`. The app is served at `app.octosprout.de` (in production since Phase 1), and the apex domain is reserved for a future public library/docs site. |
| D17 | Mobile capture | Share link to `/capture` (text in the URL fragment) plus a home screen web app with *Paste & save*, using the passkey session. No token on the phone (ADR001). |
| D18 | HTTP framework | Fastify 5. Phase 1 pages are server-rendered without a frontend framework (ADR002). |
| D19 | Write lock | `flock(1)` helper process on `repo/.git/octosprout.lock` (ADR003). |
| D20 | Sessions | Random 256-bit IDs, stored hashed; no `session_secret` (ADR004). |
| D21 | ChatGPT handoff | `/octosprout` defined in ChatGPT Custom Instructions; the pasted prompt is the fallback (ADR005). |
| D22 | Application code license | Apache-2.0 for the public `octosprout` repository. The vendored ADR template keeps MPL-2.0. The public library's licensing policy (§17) is still to be decided. |

### 0.3 Changes in v0.4

| Section | Change | ADR |
|---|---|---|
| §3.1, §4.1, §15.1, §15.4, §22 | Mobile capture uses a share link to the web capture page and a home screen web app with *Paste & save*, signed in with the passkey session. The token-based iOS Shortcut is dropped. | ADR001 |
| §12, §0.2 D18 | Phase 1 pages are server-rendered by the Fastify server; D5 stays open for Phase 2. | ADR002 |
| §8.2 | The advisory lock uses `flock(1)` as a helper process. | ADR003 |
| §18.1, §18.2 | Sessions are random IDs hashed at rest; there is no `session_secret`. | ADR004 |
| §15.1, §16.4, Appendix B | The ChatGPT brief is produced by an `/octosprout` command defined in Custom Instructions. | ADR005 |
| §15.2 | Adds `415`, the browser endpoint `POST /api/v1/capture` and the empty-body rule. | — |
| §18.2 | Sign-in attempts: burst 10, 20 per minute per IP. Token changes made with the CLI apply to the running server immediately. | — |
| §20 | Adds the real-browser end-to-end check and an image build to CI. | — |
| §21 | Records Phase 0 and Phase 1 status. | — |
| §5.1, §23 | The application code is licensed Apache-2.0 (D22). | — |
| §0.2 D5, D6, §3.1, §7.3, §7.4, §7.6, §9.2, §12, §21, §22, §23 | Boards are a thin custom server-rendered UI. Decisions get a board. Transitions are defined for tasks, projects and decisions; moving a task to `done` unblocks the tasks it was the last open blocker of; archiving an `active` project is consequential. | ADR006 |

---

## 1. Purpose and vision

OctoSprout is a personal, Markdown-first, Git-backed workspace for capturing ideas, exploring them with AI assistants, refining them into projects, recording architectural decisions, and preparing actionable context for coding agents.

Its metaphor is a garden: thoughts are captured as they occur, take root as ideas, are nurtured through exploration and can be transplanted into projects. Reusable knowledge can later be shared through a public library.

OctoSprout is a planning and knowledge layer. It does not replace GitHub, code repositories, coding environments, or repository-specific documentation such as `AGENTS.md`, `CLAUDE.md`, tests and design docs.

## 2. Architectural principles

1. Markdown files in Git are the durable source of truth. Every other data structure is derived from them and can be rebuilt.
2. Personal records are private unless explicitly published. Nothing is copied to a public location automatically.
3. Capture is fast and preserves raw input byte-for-byte.
4. Ideas, captures, tasks, projects, research and decisions have distinct identities and lifecycles, connected by stable IDs and typed relationships.
5. AI-assisted changes are reviewable. Consequential transitions require explicit human approval, enforced by the application rather than by agent instructions alone.
6. Multiple clients and assistants may work concurrently. No process may silently discard or overwrite another contributor's work.
7. Coding agents work in implementation repositories. OctoSprout owns intent, constraints, planning, decisions and handoff context, and does not duplicate implementation details.
8. No database is required. Operational state such as sessions, credentials, the pending-push journal and caches lives outside Git and is either rebuildable or replaceable.
9. OctoSprout remains fully usable without any particular AI provider, MCP support, conversational memory or the public library.
10. The board engine is replaceable and never defines identity or relationship semantics.

## 3. MVP scope

### 3.1 In scope

- An authenticated Inbox Service on rei3 that takes captures from the mobile web capture page, reached from the iOS share sheet through a minimal Shortcut or from the home screen (§15.4), and from other API clients with inbox tokens.
- Capture records committed to the private repository, with idempotency and durable failure handling.
- A browser UI with an Inbox, separate Ideas/Tasks/Projects/Decisions boards, Research and Experts lists, record detail and editing, triage, promotion, and a Proposals review queue.
- The record model: stable IDs, schemas, typed relationships and validation.
- Idea-to-project promotion.
- ADRs using Andrew Harmel-Law's upstream template.
- Expert profiles and capture of simulated advice.
- Proposals with signed approvals for consequential operations.
- A local CLI and stdio MCP server for Claude Code on the Mac.
- Shared `AGENTS.md`, `CLAUDE.md` and core skills.
- A reusable ChatGPT handoff prompt.
- Coding-agent handoff context and outcome reporting.
- Validation in CI on the private repository.
- Automated tests, backup and restore procedures.

### 3.2 Out of scope for the MVP

- Public resource library publishing, installation and catalog (§17).
- Remote MCP, and direct MCP from the ChatGPT or Claude mobile apps.
- Automatic import of ChatGPT or Claude conversation history.
- Apple Notes synchronization beyond share-sheet capture.
- Fetching `source_url` contents.
- Multi-user collaboration inside the application.
- Mandatory GitHub Issues synchronization.
- MemPalace or any other conversational-memory integration. It may be evaluated later as an optional, non-canonical layer.
- Autonomous multi-agent orchestration, or automatically implementing tasks.
- Treating simulated expert profiles as real human review.

## 4. System architecture

### 4.1 Components

```text
 API clients (scripts)                Browsers: iPhone share link, home screen app, Mac
          | HTTPS + bearer token              | HTTPS + passkey session
          v                                   v
 +-------------------- Caddy (rei3, Let's Encrypt) --------------------+
                                  |
                                  v
 +---------------- octosprout-server (Node, one container) -------------+
 |  Inbox API  |  Web UI + JSON API  |  Auth (WebAuthn, tokens)         |
 |------------------------------------------------------------------------|
 |  Record service (parse, render, index)  |  Proposal & approval engine  |
 |  Validator (shared @octosprout/core)    |  Git write service (queue)   |
 +------------------------------------------------------------------------+
            | working tree + journal                | state dir
            v                                       v
   /var/lib/octosprout/repo (clone)        /var/lib/octosprout/state
            | git push/fetch (deploy key)
            v
   GitHub: bfarkas/octosprout-private (main)  <---- CI: octosprout validate
            ^
            | normal git
   Mac checkout  <-- octosprout CLI + stdio MCP <-- Claude Code
            |
            v
   Separate code repositories (handoff targets)
```

| Component | Responsibility |
|---|---|
| `@octosprout/core` | Record parsing and rendering, schemas, ID generation, relationship rules, validation, proposal format and signature verification. It is pure library code, shared by the server, the CLI and CI. |
| `octosprout-server` | HTTP server: inbox API, UI, JSON API for the UI, auth, approvals, Git write service and in-memory index. |
| `octosprout` CLI | Local commands (`init`, `validate`, `new`, `capture`, `show`, `handoff`, `propose`, `sync`) and `octosprout mcp`, the stdio MCP server. Runs on the Mac against a normal checkout. |
| Private repo CI | A GitHub Actions workflow runs `octosprout validate --ci` on every push to `main`. |

### 4.2 Index

The server keeps an in-memory index of all records (ID → path, metadata, links, inverse links, full-text tokens). It is built from the working tree at startup and updated after every commit or fetch. The index is derived state and MUST NOT be persisted as a source of truth. A persisted cache MAY speed up startup if it is keyed by commit SHA and discarded on mismatch.

The index serves board views, backlinks, search, idempotency lookups and ID collision checks. Personal-scale data (up to roughly 10,000 records) MUST fit comfortably in memory.

### 4.3 Repositories and their roles

The server is configured with exactly one **workspace repository**, the private repo, which it can read and write. The public library repo is not configured in the MVP. When it is added after the MVP, it MUST use separate credentials and a separate code path (§17).

## 5. Repository layout

### 5.1 Public `octosprout` (application and docs)

```text
README.md
LICENSE                      # Apache-2.0 (D22)
docs/
  spec/                      # this document and successors
  handoffs/                  # briefs for work handed to another agent
  adr/                       # OctoSprout's own architecture decisions (dogfooded format)
  operations/                # deploy, backup, restore, token rotation runbooks
app/                         # pnpm workspace
  packages/core/             # @octosprout/core
  packages/server/           # octosprout-server
  packages/cli/              # octosprout CLI + MCP
  packages/web/              # UI (shape depends on D5)
schemas/                     # JSON Schema (draft 2020-12), canonical, versioned
templates/                   # starter content copied by `octosprout init`
  adr/                       # vendored upstream ADR template + MPL-2.0 notice
  records/                   # idea, task, project, research, expert templates
  skills/                    # starter skills
  agents/                    # starter AGENTS.md, CLAUDE.md
  prompts/chatgpt-handoff.md
deploy/
  compose.example.yaml       # no secrets
  Caddyfile.example
  shortcut/                  # mobile capture guide: share link Shortcut, home screen app
  Dockerfile                 # octosprout-server image
resources/                   # RESERVED for the post-MVP public library (§17)
```

### 5.2 Private `octosprout-private` (workspace)

```text
README.md
AGENTS.md
CLAUDE.md                    # contains "@AGENTS.md" plus Claude-specific notes only
octosprout.yaml              # workspace config (§5.3)
records/
  captures/YYYY/MM/OS-C-XXXXX.md
  ideas/OS-I-XXXXX--slug.md
  tasks/OS-T-XXXXX--slug.md
  projects/OS-P-XXXXX--slug.md
  decisions/OS-D-XXXXX--slug.md
  research/OS-R-XXXXX--slug.md
experts/OS-E-XXXXX--slug.md
proposals/YYYY/MM/OS-PROP-XXXXX.md
skills/<skill-name>/SKILL.md
prompts/chatgpt-handoff.md
deploy/                      # rei3 compose overrides, Caddy site block (no secrets)
.github/workflows/validate.yml
```

- v0.2's `records/inbox/` is renamed `records/captures/`. "Inbox" is a view of captures with status `new`, not a storage location.
- Filenames are `<ID>--<slug>.md`. The slug is generated from the title at creation and is never changed automatically. Lookups always go by ID, so renaming a file or retitling a record never changes its identity. Validation enforces that a filename starts with the record's ID.
- Captures have no slug, because they have no title.

### 5.3 Workspace configuration (`octosprout.yaml`)

```yaml
workspace_schema_version: 1
id_prefix: OS
approval_public_keys:          # Ed25519 public keys trusted for approval signatures
  - id: rei3-2026-10
    key: "ed25519:BASE64..."     # base64 of the raw 32-byte public key
    status: active             # active (default) | retired
consequential:                 # optional overrides; defaults in §9.2
  bulk_threshold: 10
```

The file is checked against `schemas/workspace.v1.schema.json`. Changes to `octosprout.yaml`, `schemas/` (if a workspace ever vendors schemas) or lifecycle rules are consequential (§9.2).

## 6. Record model

### 6.1 Identifiers

Format: `<PREFIX>-<TYPE>-<RAND>`

- `PREFIX` is `OS` for private records. `OSL` is reserved for public library resources.
- `RAND` is 5 characters of Crockford Base32 (`0-9`, `A-Z` excluding `I L O U`), uppercase, generated with a CSPRNG. This gives 32⁵ ≈ 33.5 million values per type.
- The generator checks the index (or, in the CLI, the working tree) and retries on collision. Validation rejects duplicates.
- A collision introduced by a concurrent writer is only possible across unpushed commits and is astronomically unlikely. The rebase step in §8.3 detects it and fails the operation for user resolution. IDs are never renumbered silently.
- IDs are immutable and independent of titles, filenames, paths, repository URLs and board positions.
- Parsing MUST be case-insensitive. Rendering MUST be uppercase.

| Type | Code | Example | Directory |
|---|---|---|---|
| Capture | `C` | `OS-C-7K3QX` | `records/captures/YYYY/MM/` |
| Idea | `I` | `OS-I-2HD9W` | `records/ideas/` |
| Task | `T` | `OS-T-QF81M` | `records/tasks/` |
| Project | `P` | `OS-P-0XZ4K` | `records/projects/` |
| Decision (ADR) | `D` | `OS-D-4M9TZ` | `records/decisions/` |
| Research | `R` | `OS-R-B7N2C` | `records/research/` |
| Expert profile | `E` | `OS-E-SEC01`* | `experts/` |
| Proposal | `PROP` | `OS-PROP-8V3KD` | `proposals/YYYY/MM/` |

\* Example only. All IDs are random.

Public resources (post-MVP) use `OSL-SKILL-…`, `OSL-EXPERT-…`, `OSL-TEMPLATE-…`, `OSL-SCHEMA-…`, `OSL-EXAMPLE-…` and `OSL-GUIDE-…`. A private ID MUST NOT become a public ID or appear in a public artifact.

### 6.2 File format

Every record is a UTF-8 Markdown file with YAML frontmatter (YAML 1.2 core schema) followed by a Markdown body. Line endings are `\n`. Unknown frontmatter keys under `x-` are preserved, so a board engine or other tool can add its own metadata there without it becoming canonical. Any other unknown key is a validation error.

Common fields:

| Field | Required | Notes |
|---|---|---|
| `id` | yes | §6.1 |
| `type` | yes | `capture`, `idea`, `task`, `project`, `decision`, `research`, `expert`, `proposal` |
| `schema_version` | yes | Integer per type. The current value for every type is `1`. |
| `title` | all types except capture | Plain text, ≤ 200 characters |
| `status` | yes | Per-type lifecycle (§7) |
| `created` | yes | UTC RFC 3339 (`2026-10-25T14:03:11Z`) |
| `updated` | yes | UTC RFC 3339, ≥ `created` |
| `tags` | no | List of lowercase kebab-case strings |
| `links` | no | Typed relationships (§6.3) |
| `refs` | no | External references (§6.4) |
| `approval` | conditional | Proposal ID authorizing a consequential state (§9.4) |

Required fields are kept minimal so that capturing an idea or task never requires more than a title.

### 6.3 Relationships

Relationships are stored **once, on the source record**, as `links: [{rel, id}]`. Inverse relationships (backlinks) are computed by the index and never written. This avoids double-write conflicts and keeps edits to one file.

| `rel` | Source → Target | Directional | Meaning |
|---|---|---|---|
| `relates_to` | any → any | no (symmetric; store on either side, once) | General association |
| `belongs_to` | Task, Decision, Research → Project | yes | Membership in a project |
| `derived_from` | Idea, Task, Research → Capture; Task → Idea | yes | Provenance (triage output, attached capture) |
| `promoted_to` | Idea → Project | yes | Result of promotion |
| `blocks` | Task → Task | yes | Source must finish before target |
| `supersedes` | Decision → Decision | yes | New decision replaces old |
| `supports` | Research → Idea, Project, Decision, Task | yes | Evidence or findings |
| `implements` | Task → Decision | yes | Work that carries out a decision |
| `consulted` | Decision → Expert | yes | Expert profile used for advice |

Validation rules:

- Every target ID MUST exist in the workspace.
- Source and target types MUST be allowed for the `rel`.
- Duplicate `(rel, id)` pairs, and duplicate `relates_to` pairs in either direction, are errors.
- A record MUST NOT link to itself.
- A cycle in `blocks` is an error. A cycle in `supersedes` is an error.
- Archived or composted records remain valid link targets.
- Proposals are not link targets. They are referenced by `approval` only.

### 6.4 External references

```yaml
refs:
  - kind: repo            # repo | pr | commit | branch | issue | file | url
    url: https://github.com/bfarkas/some-code-repo
  - kind: pr
    url: https://github.com/bfarkas/some-code-repo/pull/12
    note: "Implements first slice"
```

`url` MUST be `https`. For `repo`, `pr`, `commit`, `branch`, `issue` and `file` it SHOULD be a GitHub URL. Validation checks syntax only; it never makes network calls in the MVP.

### 6.5 Per-type schemas

The canonical JSON Schemas live in `octosprout/schemas/<type>.v<N>.schema.json`. Type-specific fields are listed below; full examples are in Appendix A.

**Capture**
- `source`: `shortcut`, `chatgpt`, `claude`, `apple-notes`, `web`, `cli` or `other`. An unknown submitted value is stored as `other`, and the original value goes in `source_detail` (≤ 64 characters).
- `source_url` (optional, https).
- `idempotency_key` (required).
- `received_via`: the token name, `web-session` or `cli`.
- `content_sha256` (required): the hex SHA-256 of the body bytes.
- **The body is the submitted text, verbatim, and immutable.** Validation recomputes `content_sha256` on every run, so any edit to a capture body is detected. Only `status`, `updated`, `tags` and `x-` keys may change after creation.

**Idea**
- No required type-specific fields.
- The body is free-form. The template suggests Motivation, Exploration, Alternatives, Open questions and Next step.

**Task**
- `readiness`, derived and not stored. A task in `backlog` needs only a title.
- Moving a task to `ready` or beyond requires these body sections: `## Objective`, `## Acceptance criteria` and `## Verification`.
- A task that changes code also needs a `refs` entry of kind `repo`, on the task or its project. Validation cannot tell whether a task changes code, so a missing one is a warning.
- A required section counts as filled in when it has content other than whitespace, HTML comments or an empty template checkbox (`- [ ]`). The same holds for the project sections below.
- See §11.2 for the full task contract.

**Project**
- Body sections from the project brief template (§11.1).
- `status: active` requires the `## Goals`, `## Non-goals`, `## Scope` and `## Success criteria` sections to be non-empty.
- `refs` entries of kind `repo` list the target code repositories.

**Decision**
- `template: harmel-law-adr@<upstream-commit-sha>`.
- The body follows the upstream template exactly (§13).

**Research**
- No required type-specific fields.
- `refs` entries of kind `url` hold sources.

**Expert**
- Body sections are defined in §14.

**Proposal**
- See §9.3.

## 7. Lifecycles

A board column is a view of `status`. Status is stored only in frontmatter. The transition table lives in `@octosprout/core` (`TRANSITIONS`), with each move's kind: routine, consequential (§9.2), promotion only (§10), triage only (§7.1) or server only (proposals). A status write changes only the `status` and `updated` values, and for a decision the body's `* Status:` line; every other byte of the file is kept. Transitions not listed below are rejected by the write service and flagged by validation as a warning. Validation cannot see history, so it checks that the current state is consistent rather than which transition led to it.

### 7.1 Capture (garden)

| Status | Meaning |
|---|---|
| `new` | Received and awaiting triage. These make up the Inbox. |
| `planted` | Triaged: at least one record links to it via `derived_from` |
| `composted` | Reviewed and discarded. Kept in Git, not deleted. |

Allowed transitions: `new → planted`, `new → composted`, `composted → new` (restore). A `planted` capture MUST have at least one inbound `derived_from` link.

### 7.2 Idea (garden)

| Status | v0.1 equivalent | Meaning |
|---|---|---|
| `seed` | (Inbox) | Newly created and unexplored |
| `sprouting` | Exploring | Being researched and refined |
| `ready` | Ready | Ready to be considered for promotion |
| `dormant` | Parked | Intentionally paused |
| `transplanted` | Promoted | Promoted to a project (terminal) |
| `composted` | Archived | No longer pursued |

Allowed transitions:
- `seed → sprouting → ready`, and backwards from `ready → sprouting`.
- `seed`, `sprouting` and `ready` can move to `dormant` or `composted`.
- `dormant → seed`, `sprouting` or `ready`.
- `composted → seed`.
- `ready → transplanted`, via promotion only (§10).

A `transplanted` idea MUST have exactly one `promoted_to` link and an `approval`.

### 7.3 Task

`backlog`, `ready`, `in_progress`, `blocked`, `done`, `cancelled`

**[Assumption]** `cancelled` is new relative to v0.1. It lets a task be closed without being marked done.

Allowed transitions: from any status to any other.

`blocked` is a status set by hand, for anything that holds a task up, including reasons outside the workspace. Separately, a task is *blocked by* every task that `blocks` it and is not `done` or `cancelled`; the index computes this and the UI shows it on the card, whatever the task's status. The two meet in one rule:

- Moving a task to `done` also moves to `ready`, **in the same commit**, every task whose status is `blocked` and for which this task was the last open blocker. The operation carries a `base_blob` precondition for every file it touches, so it applies completely or not at all. The unblocked tasks count towards `bulk_threshold` (§9.2).
- Cancelling a blocker does not move anything, and neither does a status changed by editing a file directly. The UI offers a one-tap move to `ready` for a `blocked` task with no open blockers left.
- The rule lives in `@octosprout/core`, so the server, the CLI and the MCP server apply it the same way. A status never changes except as part of an operation the user started.

Completing every task in a project MUST NOT complete the project automatically.

### 7.4 Project

`proposed`, `active`, `on_hold`, `completed`, `archived`

Allowed transitions: from any status to any other. Moving an `active` project to `completed` or `archived` is consequential (§9.2).

### 7.5 Research

`open`, `concluded`, `archived`

Allowed transitions: from any status to any other.

### 7.6 Decision

The upstream vocabulary is used verbatim and in upper case: `DRAFT`, `PROPOSED`, `ACCEPTED`, `ADOPTED`, `SUPERSEDED`, `EXPIRED`.

- **DRAFT** — being written.
- **PROPOSED** — ready for advice and review.
- **ACCEPTED** — decided.
- **ADOPTED** — in effect or implemented.
- **SUPERSEDED** — replaced by a newer decision.
- **EXPIRED** — no longer applicable.

The frontmatter `status` and the body's `* Status:` line MUST match.

Allowed transitions:
- `DRAFT → PROPOSED`, and back from `PROPOSED → DRAFT`.
- `PROPOSED → ACCEPTED → ADOPTED`.
- `ACCEPTED` and `ADOPTED` can move to `SUPERSEDED` or `EXPIRED`.
- `SUPERSEDED` and `EXPIRED` are terminal. A decision never goes back from `ACCEPTED` or later to `DRAFT` or `PROPOSED`.

A status change rewrites the frontmatter `status` and the body's `* Status:` line in the same write.

Rules:
- Moving to `SUPERSEDED` requires a newer decision with `supersedes` pointing at this one.
- The body of a decision that is `ACCEPTED` or later MUST NOT be edited except to change its Status line. A reversal is a new decision that supersedes it.

### 7.7 Expert, Proposal

- **Expert:** `active`, `retired`, either way.
- **Proposal:** `pending`, `applied`, `rejected`, `stale` (§9.3).

## 8. Git collaboration and the write service

### 8.1 Principles

- Routine edits are committed directly to `main` of the private repository. Pull requests are not used for routine record maintenance.
- The service never force-pushes, never rewrites published history, and never runs `git reset --hard` onto a state that discards unpushed local commits.
- Every write is validated before it is committed. A write that would leave the workspace invalid is rejected. The one exception is a write that fixes existing errors without introducing new ones.
- Each logical operation is exactly one commit, including multi-record operations such as promotion or applying a proposal.

### 8.2 Working tree and locking

- The server owns a dedicated clone at `/var/lib/octosprout/repo`. No other process writes to it.
- All writes go through a single in-process FIFO queue. An OS-level advisory lock (`flock` on `repo/.git/octosprout.lock`) protects against accidental concurrent processes, such as an admin running the CLI inside the container. It is taken with `flock(1)` as a helper process that holds the lock while its stdin is open, so a crash never leaves a stale lock (ADR003).
- The Mac checkout and any agent checkouts are independent clones. They coordinate only through GitHub.

### 8.3 Write algorithm

For each queued operation:

1. Acquire the lock.
2. Run `git fetch origin`.
3. If local `main` has unpushed commits (from the pending journal), rebase them onto `origin/main`. Otherwise fast-forward local `main` to `origin/main`.
4. Rebuild the index incrementally from the changed paths.
5. Check the operation's **preconditions** against the current state. For edits, the current git blob SHA of each target file MUST equal the `base_blob` the client read (§8.4).
6. Apply the changes to the working tree.
7. Run validation on the affected records and their link neighborhoods. CI and the health panel run full validation.
8. Commit with the message and trailers described in §8.6.
9. Run `git push origin main`.
   - **On success:** return `committed` with the commit SHA.
   - **On non-fast-forward:** fetch, rebase the new commit, re-run steps 5 and 7 against the rebased state, and push again. Retry up to 3 times with jittered backoff. If preconditions fail after rebase, drop the commit (it is still unpushed) and return a conflict.
   - **On a network or remote error:** keep the commit locally. This is the **pending journal**. Return `pending`.
10. Release the lock.

If any step from 6 to 8 fails, only the paths the operation touched are restored to their state before the operation (`git restore --staged --worktree -- <paths>`), and any files it newly created are removed.

**Background sync:**
- While unpushed commits exist, a background task retries step 9 every 60 seconds, with backoff up to 15 minutes.
- Every 60 seconds otherwise, it fetches and refreshes the index so the UI reflects changes pushed from the Mac.
- When a pending commit is rebased, its SHA changes. The capture or proposal ID stays stable, and status queries resolve it by ID.

Unpushed commits survive process restarts because they are on disk in the clone. On startup the server reports the number of pending commits and resumes sync. If a pending commit can no longer be rebased cleanly, it is moved to a branch `octosprout/pending/<timestamp>` (local only), surfaced in the UI as an unresolved conflict, and never discarded.

### 8.4 Optimistic concurrency for browser edits

- Every record read by the UI includes the file's git blob SHA (`base_blob`).
- A save sends `base_blob` together with the new content.
- If the file has changed since it was read, the server returns `409 Conflict` with the base, current and submitted versions.
- The UI then shows a three-way view. The user can merge by hand, keep theirs (which creates a new write with the current blob as its base), or discard.
- The UI keeps unsaved input in local browser storage until the save is acknowledged.
- Conflicts are detected per file, not per repository. Unrelated concurrent changes never cause false conflicts. Relationship validity is re-checked on the rebased state (step 7).

### 8.5 The Mac and agents

- The Mac checkout uses normal Git workflows. `octosprout sync` runs fetch, rebase and push, and refuses to push if `octosprout validate` fails.
- The CLI runs validation in a `pre-push` hook installed by `octosprout init`. The hook can be bypassed, but CI catches anything it misses.
- CI validation failures on `main` are shown in the UI health panel. The server itself keeps working on an invalid `main`, but only accepts writes that do not add new errors.

### 8.6 Commits and attribution

- **Author:** `OctoSprout <octosprout@octosprout.de>` for server commits. The CLI uses the local git identity.
- **Subject:** `<operation>: <ID> <short title>`, for example `capture: OS-C-7K3QX (chatgpt)` or `promote: OS-I-2HD9W -> OS-P-0XZ4K`.
- **Trailers:**
  - `OctoSprout-Operation: capture|edit|create|triage|promote|apply-proposal|reject-proposal|status`
  - `OctoSprout-Actor: user:web | token:<name> | cli | agent:<client>`
  - `OctoSprout-Proposal: OS-PROP-…`, when one applies.

## 9. Proposals and approvals

### 9.1 Who can do what

| Actor | Routine changes | Consequential changes |
|---|---|---|
| You, in the browser | Direct commit | Confirmation dialog with diff and passkey re-verification, producing a signed approval in the same commit |
| You, on the Mac (CLI or editor) | Direct commit | Must create a proposal (`octosprout propose …`) and approve it in the browser |
| Agents (MCP, skills) | **Proposal only** | Proposal only |
| Inbox token | Create captures only | Never |

Agent-originated changes always go through proposals, including routine ones, because v0.2 requires AI-assisted changes to be reviewable. The UI supports bulk approval for routine agent proposals.

### 9.2 Consequential operations

1. Promoting an idea (`ready → transplanted`, together with project creation).
2. Moving a decision to `ACCEPTED`, `SUPERSEDED` or `EXPIRED`.
3. Moving an `active` project to `completed` or `archived`, or editing the Goals, Non-goals, Scope or Success criteria sections of an `active` project.
4. Deleting any file. Records are normally composted or archived rather than deleted.
5. Any operation touching more than `bulk_threshold` records (default 10).
6. Changes to `octosprout.yaml`, lifecycle rules, schemas, `AGENTS.md`, `CLAUDE.md` or `skills/`.

### 9.3 Proposal format

```yaml
---
id: OS-PROP-8V3KD
type: proposal
schema_version: 1
status: pending            # pending | applied | rejected | stale
title: "Promote OS-I-2HD9W to a project"
created: 2026-10-25T15:00:00Z
updated: 2026-10-25T15:00:00Z
origin:
  actor: agent:claude-code
  session: "optional free text"
base_commit: 4f1c2e9…       # commit the proposal was prepared against
consequential: true
operations:
  - op: create             # create | update | set_status | add_link | remove_link | delete
    path: records/projects/OS-P-0XZ4K--memory-integration.md
    content: |
      ---
      id: OS-P-0XZ4K
      …
  - op: set_status
    id: OS-I-2HD9W
    base_blob: 9ae1…        # required for update/set_status/links/delete
    status: transplanted
  - op: add_link
    id: OS-I-2HD9W
    base_blob: 9ae1…
    link: { rel: promoted_to, id: OS-P-0XZ4K }
approval:                  # written by the server when applied or rejected
  decision: approved       # approved | rejected
  at: 2026-10-25T15:07:42Z
  key_id: rei3-2026-10
  ops_sha256: …            # hash of canonical JSON of `operations`
  signature: "ed25519:…"   # over canonical JSON of {proposal, ops_sha256, decision, at}
---
## Rationale
Why this change is proposed, assumptions, and open questions.
```

Canonical JSON sorts object keys and has no whitespace (RFC 8785 for the strings, integers and booleans proposals contain). `update` and `delete` name a record `id` or a workspace `path`, for files that are not records such as `AGENTS.md`. Paths are workspace-relative and cannot leave the workspace or touch `.git`. A `set_status` that moves a decision to `ACCEPTED`, `SUPERSEDED` or `EXPIRED` records `body_sha256` (§19, OSV007).

**Applying a proposal:**
1. The UI shows the rationale and a rendered diff of every operation.
2. You approve. Consequential proposals require passkey re-verification within the last 5 minutes.
3. The server re-checks every `base_blob`.
   - If they all match, it applies the operations, writes the signed `approval` block, sets `status: applied`, writes `approval: OS-PROP-…` into each record whose consequential state the proposal authorized, and commits everything as one commit.
   - If any of them differ, the proposal becomes `stale`. The UI shows what changed, and you can reject it or ask the agent to re-propose.
4. A rejection also writes a signed `approval` block with `decision: rejected`.

**Creating proposals:**
- Agents create proposals with the CLI or MCP. Both commit only the proposal file and sync it.
- The server also accepts proposals created in the UI itself.
- Proposals are retained permanently as an audit trail.

### 9.4 Enforcement

This mechanism is **tamper-evident, not tamper-proof**. An agent with filesystem access to the Mac checkout can edit any file, but it cannot forge an approval.

- The Ed25519 signing key exists only on rei3, as a Docker secret.
- Validation (in CI, the server and the CLI) checks that every record in a consequential state has an `approval` that references an `applied` proposal. That proposal MUST have a valid signature from a key in `approval_public_keys`, and MUST contain an operation that produces this record's current consequential state.
- Validation also checks that every applied proposal's `ops_sha256` matches its operations.
- A change to `approval_public_keys` is itself consequential. CI warns on any commit that changes it without a server-signed proposal.
- The server pins its own public key in its configuration and refuses to trust keys added to the repository that it did not sign.
- Violations show as errors in CI and in the UI health panel, with the offending commit.

This satisfies "approval is an application workflow requirement, not merely a prompt in an agent instruction" without requiring branch protection on `main`.

## 10. Idea-to-project promotion

Promotion is a workflow, not a column move.

1. Start the promotion wizard in the UI (from a `ready` idea), or have an agent run the `promote` skill, which ends in a proposal.
2. Review the idea, its `derived_from` captures, and the research and related ideas linked to it.
3. Assess readiness and list unresolved questions.
4. Draft a project brief (§11.1) covering goals, non-goals, scope, constraints, risks and success criteria.
5. Optionally draft initial tasks, each individually selectable.
6. Present everything as one consequential proposal. Approve it with passkey re-verification.
7. On approval, a single commit:
   - creates the Project with `status: proposed`, or `active` if you choose so in the dialog;
   - creates the selected tasks with `belongs_to` the project;
   - adds `promoted_to` to the idea;
   - sets the idea to `transplanted`, with `approval`.
8. Validate the whole resulting state. Any failure aborts the operation with no partial result.

The idea remains the historical record of motivation and exploration. The project brief references the idea and research instead of copying them.

## 11. Project briefs, tasks and coding-agent handoff

### 11.1 Project brief template sections

The project brief template has these sections:
- `## Problem and users`
- `## Goals`
- `## Non-goals`
- `## Scope`
- `## Requirements` (functional and non-functional)
- `## Constraints and decisions` (links to ADRs)
- `## Success criteria`
- `## Risks, assumptions and open questions`
- `## Related` (research, ideas, projects)
- `## Repositories` (mirrors `refs` of kind `repo`)

The brief describes outcomes and constraints. It does not duplicate implementation documentation.

### 11.2 Task contract

The contract for a task moving to `ready` or beyond has these parts:

| Part | Where it lives |
|---|---|
| ID, title, parent project | Frontmatter (`belongs_to`, optional) |
| Objective | `## Objective` |
| Scope and expected outcome | `## Scope` (optional) |
| Acceptance criteria | `## Acceptance criteria` (checklist) |
| Constraints and dependencies | `## Constraints` plus `blocks` and `implements` links |
| Verification | `## Verification` (how to prove it works) |
| Target repository | `refs` of kind `repo` (required if the task changes code) |
| Handoff log | `## Handoff log` (appended by reports, §11.4) |

### 11.3 Handoff context

`octosprout handoff OS-T-…` (CLI) and the MCP tool `get_handoff_context` assemble a Markdown bundle. The bundle contains:

1. The task, in full.
2. The parent project brief, in full.
3. Every decision in `ACCEPTED` or `ADOPTED` that the task `implements` or that `belongs_to` the project, plus decisions superseded by them, by title only.
4. Research linked through `supports` to the task or project, by title, path and summary. The summary is the first paragraph of the record.
5. The target repositories.
6. Standing instructions for the agent:
   - Open the target repository.
   - Read its `AGENTS.md`, `CLAUDE.md` and contributing docs.
   - Investigate the existing code before planning.
   - Follow the repository's own workflow and tests.
   - Surface any conflict between the code and the task or decisions instead of resolving it silently.
   - Report back via `propose_handoff_report`.

The bundle is generated on demand and never committed.

### 11.4 Outcome reporting

`propose_handoff_report` (MCP) or `octosprout report` (CLI) creates a proposal that:
- appends a dated entry to the task's `## Handoff log`, covering the outcome, verification results, and the commit and PR references;
- adds `refs` for the PR or commits;
- optionally moves the task to `done` or `blocked`;
- optionally drafts follow-up tasks.

You review and approve it in the UI.

## 12. Browser UI

### 12.1 Board engine decision

Phase 0 evaluates Kanban Lite against a thin custom UI built on `@octosprout/core`. Any engine MUST satisfy all of these; the first failure eliminates it:

1. The OctoSprout Markdown files in §6 remain canonical, with no hidden database as the real store. Engine metadata stays inside `x-` keys or in derived state.
2. It supports multiple independent boards: Ideas, Tasks, Projects and Decisions.
3. It refreshes predictably after external file changes, such as a fetch from the Mac.
4. Its writes can be routed through the write service (§8), including `base_blob` checks. Writing to disk by itself and committing later is not acceptable.
5. It sits behind OctoSprout's passkey authentication.
6. It can be replaced without migrating IDs or relationship semantics.

If Kanban Lite fails any criterion, build the custom UI. The frontend framework is then chosen in Phase 0 and recorded as an ADR in `octosprout/docs/adr/`.

**Decided (ADR006):** Kanban Lite failed criteria 1 and 6, so the boards are a thin custom UI. They are server-rendered by the Fastify server with small hand-written scripts and no build step, like the Phase 1 pages (ADR002). A move is a status write through the write service with the `base_blob` the page was rendered from. Cards move by dragging a grip (Pointer Events) or with a *Move to…* control that lists only allowed targets; the boards need JavaScript to move cards. Cards in a column are sorted by `updated`, newest first; there is no manual ordering. The design is in `octosprout/docs/design/boards.md`, the evidence in `octosprout/docs/handoffs/board-engine-spike-results.md`.

### 12.2 Required views (either option)

| View | Contents |
|---|---|
| Inbox | Captures with status `new`, newest first. Triage actions: create an Idea, Task or Research record (prefilled from the text), attach to an existing record, or compost. |
| | *As built:* each Inbox card has **Triage**, which opens `/inbox/<ID>/triage`. A new record is prefilled with a title from the capture's first line (without a `Working title:` label) and its template, with the capture quoted at the top; it gets `derived_from` the capture. Attaching adds `derived_from` to an existing Idea, Task or Research record. Creating or attaching plants a `new` capture in the same commit; a planted capture can be triaged again. Compost and Restore move between `new` and `composted`. |
| Capture form | `/capture`: a mobile-first single text area, an optional URL field, **Save** and **Paste & save**. Text shared through `/capture#text=…` is filled in (§15.4). Uses the same pipeline as the inbox API, through `POST /api/v1/capture`. The start page of the home screen app. |
| Settings | Inbox tokens (create, shown once; revoke) and registered passkeys. |
| Ideas, Tasks, Projects and Decisions boards | Columns by status. Moving a card is a status change. Promotion opens the wizard. Consequential moves open the confirmation dialog. Tasks and Decisions filter by project. Decisions: create from template, advice panel. |
| Research and Experts | Lists |
| Record detail | Rendered body, frontmatter form, links and backlinks, refs, git history (commits touching the file), and an edit mode with a Markdown editor and `base_blob` |
| | *As built:* `/records/<ID>` renders the body with markdown-it (raw HTML off); captures stay plain text. `/records/<ID>/edit` has a form (title, tags, links, refs, body) and a whole-file tab, both saved with `PUT /api/v1/records/<ID>`. Edits never change `id`, `type`, `schema_version`, `created`, `status` or `approval`; a capture's text and source never change; the body of an `ACCEPTED`-or-later decision is frozen; changing an active project's Goals, Non-goals, Scope or Success criteria needs approval. A 409 opens a three-way view (base, current, yours) with a merged text to save on top of the current version. Unsaved input stays in `localStorage` until the save is acknowledged. |
| Proposals | Pending queue with diffs, approve or reject, bulk-approve for non-consequential proposals, and history |
| Health | Validation results, pending-push count, last sync time and last CI status |
| Search | Title, ID and full text, served from the index |

The UI MUST work on iPhone Safari at 375px width. Every write shows a sync indicator: committed, pending or conflict.

## 13. Architecture Decision Records

### 13.1 Template

OctoSprout adopts Andrew Harmel-Law's template from `andrewharmellaw/facilitating-software-architecture`, file `adr/adr-template.md`. It is pinned at upstream commit `1775d49516784bee6824fcd02556926121a7e772` (16 January 2025), and the upstream repository is licensed **MPL-2.0**.

- The template file is vendored unmodified at `octosprout/templates/adr/adr-template.md`, together with its license notice and source URL. Updating it is a deliberate change that bumps the `template:` pin.
- The template's structure is preserved:
  - `# ADR… - [TITLE]`
  - `* Date:`, `* Status:` and `* Author:` lines
  - `## Decision`
  - `## Context`
  - `## Options Considered`, with `### Option N (SELECTED): …` or `### Option N: …`, each with `#### Consequences` bullets prefixed `Adopted because:`, `Adopted despite:`, `Rejected because:` or `Rejected despite:`
  - `## Advice`, with bullets of the form `* [Advice offered] - [Name, Role, Date]`
  - `## Supporting Material`
- OctoSprout's only additions are the YAML frontmatter (§6.2) and replacing `ADR00X` in the heading with the record ID: `# ADR OS-D-4M9TZ - Title`.

### 13.2 Validation of ADRs

- All template headings are present and in order.
- The `* Status:` line matches the frontmatter.
- `ACCEPTED`, `ADOPTED` and `SUPERSEDED` decisions have exactly one `(SELECTED)` option.
- Consequence bullets in a selected option use `Adopted …` prefixes, and those in rejected options use `Rejected …` prefixes. A mismatch is a warning.
- Any `## Advice` entry generated by AI MUST be marked as such (§14).

### 13.3 Process

1. Agents research options and draft the ADR as a `DRAFT`, via a proposal.
2. You or an agent move it to `PROPOSED`.
3. The `advise` skill gathers expert perspectives into Advice and Supporting Material.
4. You accept it, which is consequential and requires approval.
5. Implementing tasks link to it with `implements`.
6. A reversal is a new ADR that `supersedes` the old one. Accepted history is never rewritten.

## 14. Expert profiles and advice

Expert profiles live in `experts/OS-E-…--slug.md` (type `expert`). Body sections:
- `## Focus`
- `## Scope and expertise`
- `## Questions to investigate`
- `## Assumptions and biases to watch for`
- `## Advice format`
- `## Limitations`

Profiles can be created for a single decision and kept for reuse.

The `advise` workflow:
1. Select the profiles and link them to the ADR with `consulted`.
2. Each profile investigates independently. Claude Code can run one sub-agent per profile.
3. A synthesis captures agreements, disagreements, evidence and recommendations.
4. Each perspective becomes one `## Advice` bullet, attributed as `- [Profile name] (simulated, AI-generated, <model>), <Role>, <Date>`.
5. Long-form advice goes into a Research record that `supports` the ADR and is listed under Supporting Material.
6. The result is delivered as a proposal.

Simulated advice is never presented as human review. Agreement among personas never substitutes for approval.

## 15. Ingestion

### 15.1 Use cases

| UC | Flow |
|---|---|
| UC1 Quick mobile capture | Share text or a URL from any app (including Apple Notes) to the **OctoSprout** Shortcut, which opens the capture page with the text filled in; tap **Save**. Or copy text and tap **Paste & save** in the home screen app. A Capture record is created, with no title, tags or project needed. |
| UC2 Explore with Claude | Claude Code on the Mac uses the skills and the local MCP (§16). Results arrive as proposals. Other Claude clients use the ChatGPT-style handoff via share sheet until remote MCP exists. |
| UC3 Explore with ChatGPT | 1. Explore the idea in the ChatGPT app. 2. Send `/octosprout` (defined once in Custom Instructions; Appendix B), and ChatGPT replies with a structured brief. 3. Copy the brief. 4. Tap **Paste & save** in the home screen app; or share the chat to **OctoSprout from ChatGPT** and tap **Paste & save**, which keeps the chat link as `source_url` and records `source: chatgpt`. 5. Triage it into an Idea later. ChatGPT's share button shares only a link, never the brief; the link is never fetched. |

Arbitrary text can always be captured without a handoff brief.

### 15.2 Inbox API

`POST https://app.octosprout.de/api/v1/inbox`

Headers:
- `Authorization: Bearer <inbox token>`
- `Content-Type: application/json; charset=utf-8`

Request body:

| Field | Required | Constraints |
|---|---|---|
| `text` | yes | Valid UTF-8, non-empty after trimming, ≤ 100,000 characters. Stored verbatim, untrimmed. |
| `idempotency_key` | yes | 8–128 characters, `[A-Za-z0-9._:-]`. v0.2 called this `capture_id`. |
| `source` | no | Enum as in §6.5. An unknown value becomes `other` with `source_detail`. |
| `source_url` | no | `https` only, ≤ 2048 characters |
| `client_created_at` | no | RFC 3339. Stored as provided, for reference. |

Responses (JSON):

| Code | When | Body |
|---|---|---|
| `201 Created` | Committed and pushed | `{"id":"OS-C-7K3QX","status":"committed","commit":"<sha>","path":"records/captures/2026/10/OS-C-7K3QX.md"}` |
| `202 Accepted` | Committed locally, push pending | `{"id":"OS-C-7K3QX","status":"pending","local_commit":"<sha>"}` |
| `200 OK` | Replay of an existing `idempotency_key` with identical `text` | The current status of that capture, `committed` or `pending` |
| `400` | Validation failure, including invalid UTF-8 and invalid JSON | `{"error":"invalid_request","field":"text","message":"…"}` |
| `401` | Missing or invalid token | |
| `409` | `idempotency_key` reused with different `text` | `{"error":"idempotency_conflict","id":"OS-C-…"}` |
| `413` | Body > 512 KiB (also enforced at Caddy) | |
| `415` | Request body without a JSON content type | `{"error":"unsupported_media_type"}` |
| `429` | Rate limited | `Retry-After` header |
| `503` | Cannot even write locally (for example, disk full) | Nothing stored |

`GET /api/v1/inbox/{idempotency_key}` returns the same status body, using the same token scope.

An empty request body is treated as no body, which the inbox API rejects with `400`.

**Browser endpoint.** `POST /api/v1/capture` takes the same body and returns the same responses, for the capture page. It requires a session, an exact `Origin` and the session's CSRF token instead of a bearer token, and records `received_via: web-session`. `source` is kept if it is `web`, `shortcut`, `chatgpt`, `claude` or `apple-notes`, and is `web` otherwise.

**Status semantics:**
- `committed` means present on GitHub `main`.
- `pending` means durably committed in the rei3 clone but not yet pushed.
- The service MUST NOT report `committed` for a pending capture.

**Idempotency:** the index maps `idempotency_key` to capture ID, built from Git (including unpushed commits). Lookup therefore survives restarts and needs no database.

**Hardening:**
- Requests are rate-limited per token to 30 per minute, with a burst of 10.
- Only `POST` and `GET` are allowed on these routes.
- Requests with a body must have a JSON content type.
- The service never logs `text`. It logs the ID, size, source and token name.
- All content is treated as untrusted data and rendered only as escaped or sanitized Markdown in the UI.
- Clients cannot choose paths, Git operations or shell input.

### 15.3 Capture record creation

The capture follows the write algorithm in §8.3, with the operation "create `records/captures/<YYYY>/<MM>/<ID>.md`".
- The year and month come from the server receive time in UTC.
- The body is the submitted `text`, and `content_sha256` is computed over the stored bytes.

### 15.4 Mobile capture (share link and home screen app)

Mobile capture goes through the capture page and the passkey session (ADR001). There is no token on the phone.

**Share sheet.** iOS does not let web apps appear in the share sheet, so a minimal Shortcut named **OctoSprout** hands the shared text to the page:
- It accepts Text, URLs and Safari web pages; with no input, it asks for text.
- Its three actions are URL Encode (Shortcut Input), Text (`https://app.octosprout.de/capture#text=` followed by the encoded text) and Open URLs.
- The variant **OctoSprout from ChatGPT** uses `#source=chatgpt&text=`.

**Capture page behaviour with a shared fragment:**
- `text=` MUST be the last parameter: everything after it is the text, because Shortcuts' URL Encode leaves `&`, `=` and `#` unencoded. Other parameters (`source`) come before it.
- The fragment is never sent to the server, so capture text never appears in access logs. The page removes it from the address bar after reading it, and also reads a fragment that changes in an already open tab.
- A text that is a single `https` link is also put in the link field, and the page explains that only a link was shared. *Paste & save* then keeps that link and its source.
- If the visitor is signed out, the sign-in page returns to the same address, fragment included, after the passkey (same-origin paths only).
- Saving uses one idempotency key per attempt, keeps the unsent text in local storage until the server confirms, and shows "Saved OS-C-… ✓", "Saved OS-C-… (sync pending)" or the error.

**Home screen app.** The capture page is installable (web app manifest, `start_url: /capture`, `display: standalone`, icons). *Paste & save* reads the clipboard after a tap and saves it. The home screen app has its own sign-in, separate from Safari.

**Inbox tokens** (§18.2) are for other clients of the inbox API, such as scripts.

The guide lives in `octosprout/deploy/shortcut/README.md`.

## 16. Agent integration

### 16.1 Shared instructions

- **`AGENTS.md`** (private repo) covers:
  - what OctoSprout is;
  - the record model summary and where records live;
  - the rule that agents only create proposals, never edit records directly;
  - how to run `octosprout validate`;
  - approval boundaries;
  - that simulated advice must be marked.
- **`CLAUDE.md`** contains `@AGENTS.md` plus Claude-specific notes, such as using sub-agents for `advise`. It never duplicates rules.

### 16.2 Skills (`skills/<name>/SKILL.md`)

Each skill states its inputs, outputs, the tools it uses, its permitted side effects (proposals only), validation requirements and approval boundaries.

| Skill | Purpose |
|---|---|
| `capture` | Create a capture from conversation content, locally (`octosprout capture`) |
| `triage` | Review `new` captures and propose Idea, Task or Research records, attachments or composting |
| `explore` | Research and refine an idea and propose updates (sections, research records, links) |
| `relate` | Find and propose links between records |
| `promote` | Prepare a promotion proposal (§10) |
| `advise` | Run expert profiles and propose ADR Advice and Supporting Material (§14) |
| `handoff` | Assemble handoff context and start work in the target repository (§11.3) |
| `report` | Propose a handoff report (§11.4) |
| `review-backlog` | Find stale, blocked, unlinked or invalid records and propose fixes |

Starter versions ship in `octosprout/templates/skills/` and are copied by `octosprout init`. The skills use portable Markdown, so any agent that can read files and run the CLI can follow them. MCP is an accelerator, not a requirement.

### 16.3 Local MCP server (`octosprout mcp`, stdio)

The MCP server runs against the current checkout. It is registered in Claude Code via `.mcp.json` in the private repo.

| Tool | Kind | Notes |
|---|---|---|
| `search_records` | read | Query by text, type, status or tag |
| `get_record` | read | Full content plus `base_blob` |
| `get_related` | read | Links and backlinks, depth ≤ 2 |
| `list_inbox` | read | Captures with status `new` |
| `get_handoff_context` | read | §11.3 |
| `validate` | read | Runs validation and returns structured results |
| `propose` | write (proposal) | Generic operations (§9.3) |
| `propose_promotion`, `propose_adr`, `propose_handoff_report`, `propose_triage` | write (proposal) | Typed helpers that build operations |
| `list_proposals` | read | Including status |
| `sync` | git | Fetch, rebase and push. Pushes only if validation passes. |

Write tools only create and commit the proposal file (`git commit -- <proposal path>`) and then call `sync`. They never modify records.

### 16.4 ChatGPT

ChatGPT has no MCP in the MVP. The handoff brief (Appendix B) is produced by an `/octosprout` command defined once in ChatGPT's Custom Instructions, with the pasted prompt as a fallback (ADR005). Both are kept in `prompts/chatgpt-handoff.md`. The workflow never depends on access to ChatGPT conversation history.

## 17. Public resource library (post-MVP, reserved)

v0.2 §§8–9 remain the intended design and are deferred:
- independent `OSL-` IDs;
- resource metadata (version, license, provenance);
- publication states `private`, `draft`, `published` and `withdrawn`;
- the one-resource-at-a-time publishing flow, with sanitization, a secret scan, an exact diff and explicit approval;
- a lockfile with `installed`, `customized` and `update-available` states;
- a generated catalog.

What the MVP MUST do now:
- reserve `octosprout/resources/` and the `OSL-` prefix;
- keep private records and publishable artifacts in separate directories;
- make no part of the MVP depend on the public library.

Licensing policy MUST be decided before the library accepts any contribution. A publishing implementation MUST use a separate code path and separate, publish-only credentials.

## 18. Hosting, security and operations

### 18.1 Deployment on rei3

- **Docker Compose service `octosprout`:** runs the image built from `octosprout/app`, on the current Node.js Active LTS pinned in `.nvmrc` and the Dockerfile. It listens on `127.0.0.1:8080`, or on Caddy's Docker network.
- **Volumes:** `/var/lib/octosprout/repo` (the clone) and `/var/lib/octosprout/state` (sessions, passkey credentials, token hashes, rate-limit counters).
- **Secrets** are Docker secrets, never stored in the compose file or the repository:
  - `deploy_key`: an SSH key added to GitHub as a deploy key with write access to **octosprout-private only**;
  - `approval_signing_key` (Ed25519);
  - `setup_token`.

  There is no `session_secret`: sessions are random IDs stored hashed (ADR004). Compose file secrets keep the host's owner and mode, and the container runs as uid/gid 1000, so the secret files must be readable by it.
- **Caddy site block** (example in `deploy/Caddyfile.example`):

```caddy
app.octosprout.de {
    encode zstd gzip
    request_body {
        max_size 512KB
    }
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
        -Server
    }
    reverse_proxy 127.0.0.1:8080
}
```

- The app trusts `X-Forwarded-For` only from Caddy and sets a strict CSP (`default-src 'self'`).
- The Mac does not need to be awake for any server function.

### 18.2 Authentication and authorization

- **Browser:** single-user WebAuthn passkeys.
  - Relying party ID `octosprout.de` and origin `https://app.octosprout.de`, so passkeys keep working if other subdomains are added.
  - Several passkeys can be registered (iPhone, Mac, a hardware key).
  - **Bootstrap and recovery:** visiting `/setup` with the `setup_token` allows registering a passkey. Rotate the token after use.
  - Sessions are server-side, using a `__Host-` cookie that is `HttpOnly`, `Secure` and `SameSite=Strict`, with a 30-day idle timeout. The cookie holds a random 256-bit ID; only its SHA-256 is stored (ADR004).
  - State-changing requests must pass an Origin check and carry a CSRF token.
  - Consequential approvals require a fresh assertion with user verification (§9.3).
  - Login and setup attempts are rate-limited per IP (burst 10, 20 per minute) and must carry the exact `Origin`.
- **Inbox tokens:**
  - Named tokens with the `inbox:write` scope, shown only once at creation.
  - Stored as SHA-256 hashes in the state directory.
  - Created and revoked in the UI (Settings), or with `octosprout-server token create|revoke|list`. Changes made with the CLI apply to the running server immediately.
  - Accepted only on `/api/v1/inbox*`.
- **Authorization matrix:** test separately for each actor:
  - an anonymous request gets `401` everywhere except `/login`, `/setup` (with a valid setup token) and static assets;
  - an inbox token is accepted only on the inbox routes;
  - a session can do everything except operations restricted to the setup token.

### 18.3 Secrets hygiene

- No tokens, keys or private URLs in either repository.
- The `.gitignore` files cover runtime state.
- CI runs `gitleaks` on both repositories.
- The validator flags high-entropy strings and known token formats inside records, as a warning.

### 18.4 Logging and monitoring

- Structured JSON logs go to stdout.
- Logs never include capture bodies, tokens or cookies.
- `GET /healthz` returns liveness without authentication. `GET /api/v1/status` (session only) returns the pending count, the last push, the last fetch and validation totals.

### 18.5 Backup and restore

- **Durable data:** GitHub `octosprout-private` is the backup of record. The Mac checkout is a second full copy.
- **Pending commits:** an alert (UI banner) appears if there have been unpushed commits for more than 1 hour.
- **State directory:**
  - Back up with the existing rei3 backups. Losing it costs only re-registering passkeys (via the setup token) and reissuing inbox tokens.
  - Losing the signing key means generating a new one and adding its public key through a consequential change.
  - Old approvals remain valid under the retired key, which stays listed as `retired`.
- **Restore runbook** (`docs/operations/restore.md`):
  1. Provision the host.
  2. Clone `octosprout-private`.
  3. Deploy with Compose.
  4. Restore or recreate the secrets.
  5. Re-register a passkey.
  6. Set up mobile capture again (§15.4); issue new inbox tokens only for API clients that need them.
  7. Verify with an end-to-end capture.

## 19. Validation

`octosprout validate [--ci] [--json] [path…]` checks the following and exits non-zero on errors:

| Code | Check |
|---|---|
| `OSV001` | ID format, prefix matches `type`, filename and directory match ID and type |
| `OSV002` | Duplicate IDs |
| `OSV003` | Frontmatter matches the JSON Schema for `type` and `schema_version`; supported schema versions only |
| `OSV004` | Status valid for the type; current state consistent with lifecycle rules (§7) |
| `OSV005` | Link targets exist; allowed source/target types; no duplicates or self-links; no `blocks` or `supersedes` cycles |
| `OSV006` | Capture `content_sha256` matches the body (immutability) |
| `OSV007` | ADR template compliance (§13.2) and frozen body for `ACCEPTED`+. The approving proposal's `set_status` operation records `body_sha256` of the decision body (excluding the `* Status:` line), and validation compares against it. |
| `OSV008` | Consequential states carry valid signed approvals (§9.4). `ADOPTED` decisions are covered by the approval that accepted them. A `completed` or `archived` project is checked only when it has an `approval`, because validation cannot see that it was `active` before. |
| `OSV009` | Task readiness contract (§11.2) and project-activation sections (§6.5) |
| `OSV010` | `refs` syntax and allowed kinds |
| `OSV011` | `updated ≥ created`; timestamps are UTC RFC 3339 |
| `OSV012` | Proposal integrity (`ops_sha256`, status consistent with `approval`, signature by a key in `approval_public_keys`) |
| `OSV013` | Possible secrets in records (warning) |

Problems in `octosprout.yaml` are reported as `OSV003`. Every finding reports the code, severity, file path, line where possible, the record ID, a message and a fix hint. The same validator code runs in the CLI, the server and CI.

## 20. Testing

Tests use Vitest. Git tests run against temporary bare repositories that act as "GitHub", with several clones that act as the server and the Mac. Network failures are simulated by making the remote unavailable.

**Record model**
- Create and edit every record type.
- Renaming a file or retitling a record keeps its ID and links.
- Links are validated across all types, and links to composted or archived records still resolve.
- Every `OSV` rule has positive and negative fixtures.
- Unknown `x-` keys round-trip unchanged.

**IDs**
- The format is correct.
- An injected collision triggers regeneration.
- Duplicate IDs across two clones are detected at rebase or validation, with no renumbering.

**Inbox**
- Auth: a missing token, a wrong token, a revoked token, and a token used on a non-inbox route.
- Size and rate limits, and invalid UTF-8.
- Verbatim storage: whitespace, CRLF in the input stored as submitted, emoji, a leading `---`, and Markdown or HTML injection rendered safely.
- Idempotent replay returns `200`. A replay with different text returns `409`. A replay after a lost response, where the push succeeded, does not create a duplicate.
- A push failure produces `202 pending` and never `201`. The pending commit is pushed after the remote recovers.
- Restarting the server with pending commits resumes the push.
- No capture body appears in the logs.

**Git and concurrency**
- Routine browser edits commit directly to `main`.
- A stale `base_blob` produces `409`, and the three-way data is correct.
- An unrelated concurrent change from the Mac does not conflict.
- Non-fast-forward retry succeeds.
- A precondition failure after rebase is reported, not overwritten.
- A pending commit that conflicts on rebase is preserved on a pending branch.
- Multi-record operations produce exactly one commit, or none on failure, and the working tree is restored.

**Promotion and proposals**
- A promotion creates the project and tasks, the link and the status change in one commit, and the idea is preserved.
- An invalid promotion leaves nothing behind.
- A stale proposal is detected.
- The signature verifies.
- A tampered `operations` block, a forged approval, or a consequential status set without an approval all fail validation.
- Bulk approval is refused for consequential proposals.

**UI and auth**
- Passkey registration with the setup token, then login and logout.
- Re-verification is required for consequential approvals.
- CSRF and Origin rejection.
- An unsaved draft survives a conflict and a reload.
- Board moves map to status changes.
- External edits pushed from the Mac appear after a fetch.

**Board engine** (if Kanban Lite is selected)
- Markdown stays canonical.
- Its writes go through the write service.
- Replacing it requires no migration of IDs or links.

**Agent workflows**
- The handoff bundle contains the correct project, task and ADR set.
- MCP write tools only create proposals.
- Skills work with MCP disabled, using the CLI only.
- Advice entries are marked as AI-generated.
- A report proposal updates the task's handoff log.
- Nothing depends on MemPalace.

**Real browser**
- `pnpm e2e` drives Chromium with a virtual WebAuthn authenticator through passkey registration, the capture page (including shared fragments, sign-in round trips and *Paste & save*), the Inbox, sign-out and sign-in, and token management.
- CI runs it, and builds the server image and smoke-tests it (start, health check, a token capture).

**Recovery**
- A fresh clone plus `octosprout validate` passes.
- The restore runbook is executed end-to-end on a scratch host before the MVP is signed off.

## 21. Implementation phases (MVP = Phases 0–3)

### Status (26 October 2026)

- **Phase 0:** domain, DNS, Caddy and TLS are live; the Git write service is proven in tests and in production; passkey login works on the iPhone; the ADR template is vendored. The board engine was evaluated and decided (ADR006). Still open: the Ed25519 approval round-trip in CI. Decisions taken so far are ADR001–ADR006.
- **Phase 1:** complete and deployed. The exit criterion was met with the share link and home screen app instead of the token Shortcut (ADR001).
- **Phase 2:** in progress. Built: JSON Schemas for every record type; the full validator (OSV001–OSV013), including Ed25519 approval signatures checked against `approval_public_keys`; the lifecycle transition table in `@octosprout/core`; the in-memory record index; the status-move API; the Ideas, Tasks, Projects and Decisions boards in the sidebar shell of the UI brief; Record detail with editing; and triage (below). Next: proposals with signed approvals (which enable consequential moves on the boards), promotion, ADR creation, research and experts lists, search and the health panel.
- **Phase 3:** not started.

### Phase 0 — Compatibility and safety spike

- Register `octosprout.de`. Set up DNS for `app.octosprout.de` and a Caddy site with a Let's Encrypt certificate on rei3.
- Prove the Git write service, using the server clone and a Mac clone against the GitHub private repo:
  - concurrent writes;
  - non-fast-forward retry;
  - the pending journal across a restart;
  - a stale `base_blob` conflict.
- Prove WebAuthn passkey login on iPhone Safari and Mac through Caddy.
- Prove the Ed25519 approval signature round-trip, with validation in CI on the private repo.
- Prototype the iOS Shortcut against a stub endpoint, including retry with the same key. (Superseded by ADR001.)
- Evaluate the board engine against §12.1 and record the decision as an ADR in `octosprout/docs/adr/`.
- Vendor the ADR template, with its MPL-2.0 notice.

**Exit criterion:** every Phase 0 item has been demonstrated, and the decisions (board engine, frontend framework, any changes to this spec) are recorded as ADRs.

### Phase 1 — Ingestion vertical slice

- `@octosprout/core` with the capture schema, ID generation and the validator (initially OSV001–006 and OSV011).
- `octosprout-server`:
  - the inbox API (§15.2) and write service (§8);
  - idempotency and pending sync;
  - inbox token management;
  - passkey auth;
  - a **minimal read-only Inbox view** and the `/capture` form.
- `octosprout init` for the private repo skeleton, plus CI validation.
- Mobile capture (§15.4), and the ChatGPT handoff brief (Appendix B).

**Exit criterion:** ChatGPT iOS → `/octosprout` brief → *Paste & save* (or the share link) → `app.octosprout.de` → Capture committed to `octosprout-private` → visible in the Inbox view, plus the inbox tests in §20.

### Phase 2 — Core workspace

- All record types, schemas and the full validator.
- The boards and views listed in §12.2.
- Editing with optimistic concurrency.
- Triage, typed links and backlinks.
- Proposals and signed approvals, the promotion wizard, and ADR creation and lifecycle.
- The health panel.

### Phase 3 — Assistant workflows

- The full CLI and the local stdio MCP server (§16.3).
- `AGENTS.md`, `CLAUDE.md` and the skills (§16.2).
- Expert profiles and the `advise` workflow.
- Handoff context and outcome reports.
- Hardening:
  - the full test suite;
  - the security review and authorization matrix;
  - the backup and restore runbook executed end-to-end.

### Post-MVP (candidates, ordered by expected value)

1. Public resource library (§17).
2. Remote MCP on `app.octosprout.de` with OAuth, for Claude web, desktop and mobile.
3. Optional GitHub Issues linking.
4. Optional MemPalace evaluation.
5. Bundled publishing.

## 22. MVP acceptance criteria

The MVP is complete when all of the following are demonstrated:

1. You can share or paste text on an iPhone (from ChatGPT, Apple Notes or any app) into OctoSprout without editing a file, and get a capture ID back.
2. The Inbox Service authenticates the request and stores the submitted text verbatim. Its integrity is verifiable through `content_sha256`.
3. A successful capture is committed and pushed to `octosprout-private` and returns a verifiable capture ID and commit SHA.
4. Repeating a request with the same idempotency key never creates a duplicate.
5. A remote conflict or push failure never loses a capture and never reports it as committed.
6. The browser UI, reachable only after passkey login, shows the Inbox and lets you triage captures into Ideas, Tasks or Research records, attach them, or compost them, without losing the source content.
7. Ideas, Tasks, Projects and Decisions are on separate boards. Research, Experts and Proposals have their own views.
8. An idea can be promoted to a project in one approved commit, and the original idea is preserved.
9. You can create linked tasks and ADRs, and ADRs follow the pinned upstream template.
10. Expert profiles can be reused, and their simulated advice is captured in ADRs and clearly marked as AI-generated.
11. Claude Code on the Mac can read context and propose changes through MCP or the CLI. Those changes take effect only after approval in the UI.
12. A task can be handed to a coding agent working in a separate repository, and the agent's outcome report lands in the task after approval.
13. Records can be edited from both the browser and the Mac checkout. Browser edits commit directly to `main` and never silently overwrite concurrent work.
14. Validation runs locally, in the server and in CI. It detects invalid records, broken links, edited captures and unapproved consequential states.
15. Everything works without MemPalace, MCP or any specific AI provider.
16. The complete workspace can be restored from GitHub, and a working hosted instance can be rebuilt by following the runbook.

## 23. Open questions

1. ~~**Application code license** for public `octosprout`.~~ Decided: Apache-2.0 (D22).
2. **MPL-2.0 implications** of instantiating ADRs from the vendored template. The template file keeps its notice. Confirm that filled-in private ADRs need no further action, and decide how this applies once ADRs could be published through the library.
3. **[Assumption]** Hostnames: is the app at `app.octosprout.de` with the apex reserved, or at the apex itself?
4. **[Assumption]** Task status `cancelled`, and Research statuses `open`, `concluded` and `archived`.
5. Does `ADOPTED` also require approval? Currently it does not; only `ACCEPTED`, `SUPERSEDED` and `EXPIRED` do.
6. ~~The board engine and frontend framework.~~ Decided: thin custom server-rendered UI, no frontend framework (D5, ADR006).

---

## Appendix A — Record examples

**Capture** (`records/captures/2026/10/OS-C-7K3QX.md`)

```markdown
---
id: OS-C-7K3QX
type: capture
schema_version: 1
status: new
created: 2026-10-25T14:03:11Z
updated: 2026-10-25T14:03:11Z
source: chatgpt
source_url: https://chatgpt.com/share/abc123
idempotency_key: 20261025T140310-48213
received_via: token:iphone-shortcut
content_sha256: 9b1f0c…
---
Working title: Garden metaphor for OctoSprout statuses
…verbatim submitted text…
```

**Idea** (`records/ideas/OS-I-2HD9W--integrate-conversational-memory.md`)

```markdown
---
id: OS-I-2HD9W
type: idea
schema_version: 1
title: Integrate conversational memory
status: sprouting
created: 2026-10-25T15:00:00Z
updated: 2026-10-25T15:20:00Z
tags: [memory, agents]
links:
  - { rel: derived_from, id: OS-C-7K3QX }
---
## Motivation
## Exploration
## Alternatives
## Open questions
## Next step
```

**Decision** (`records/decisions/OS-D-4M9TZ--git-write-strategy.md`)

```markdown
---
id: OS-D-4M9TZ
type: decision
schema_version: 1
title: Commit browser edits directly to main
status: ACCEPTED
created: 2026-10-25T16:00:00Z
updated: 2026-10-26T09:00:00Z
template: harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772
approval: OS-PROP-8V3KD
links:
  - { rel: belongs_to, id: OS-P-0XZ4K }
  - { rel: consulted, id: OS-E-SEC01 }
---
# ADR OS-D-4M9TZ - Commit browser edits directly to main
* Date: Oct 25, 2026
* Status: ACCEPTED
* Author: [Author name]

## Decision
…
## Context
…
## Options Considered
### Option 1 (SELECTED): Direct commits with optimistic concurrency
…
#### Consequences
 * Adopted because: …
 * Adopted despite: …
### Option 2: Pull request per edit
…
#### Consequences
 * Rejected because: …
 * Rejected despite: …
## Advice
 * Prefer per-file preconditions over repo-wide revision checks - Security Architect (simulated, AI-generated, claude-opus-5-5), Security, Oct 25, 2026
## Supporting Material
 * Long-form advice OS-R-B7N2C
```

## Appendix B — ChatGPT handoff brief

The brief is requested with `/octosprout`, defined once in ChatGPT's Custom Instructions; the exact instruction text is in `prompts/chatgpt-handoff.md` (ADR005). It produces the format below. The prompt below is the fallback for chats without Custom Instructions.

```text
Please write an OctoSprout handoff brief of our conversation so far, in plain
Markdown, using exactly these headings:

Working title:
Description: (2–3 sentences)
## Problem or motivation
## Proposed approach
## Important insights and constraints
## Alternatives considered
## Open questions and uncertainties
## Suggested next step
## Sources (links, if any)

Be faithful to what we discussed; mark anything you inferred as (inferred).
Do not invent sources. Keep it under 600 words.
```

The brief preserves useful context. It does not replace the original conversation.
