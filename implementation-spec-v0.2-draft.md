# OctoSprout — Implementation Specification

**Version:** 0.2-draft  
**Date:** 25 October 2026  
**Status:** Architecture direction agreed; implementation details remain subject to validation.

## 1. Purpose and vision

OctoSprout is a personal, Markdown-first, Git-backed workspace for capturing ideas, exploring them with AI assistants, refining them into projects, recording architectural decisions, and preparing actionable context for coding agents.

Its metaphor is a garden: ideas begin as seeds, are explored and nurtured, and can grow into projects. Reusable knowledge can be selectively shared with others.

The system must be portable, private by default, usable across devices, and independent of any single AI provider.

## 2. Architectural principles

1. Git and Markdown are the durable source of truth.
2. Personal records remain private unless explicitly published.
3. The public repository is a curated resource library, not a mirror of the private workspace.
4. Capture must be fast and must preserve raw input.
5. AI-assisted changes must be reviewable; consequential transitions require explicit approval.
6. Multiple clients and assistants may work concurrently. Conflicts must never silently discard changes.
7. Coding agents operate on implementation repositories; OctoSprout owns project intent, constraints, planning, decisions, and handoff context.
8. No separate database is required for the MVP. Temporary local queues and operational state are allowed where necessary for reliable ingestion.
9. The system must remain usable if an AI provider or the public library is unavailable.

## 3. Repository architecture

### 3.1 Private workspace repository

The private repository is the canonical source of truth for personal work. It contains:

- Ideas, captures, tasks, projects, research, and architecture decision records (ADRs).
- Private expert profiles, AI-generated advice, and session results.
- Personal notes, relationships, and links to implementation repositories.
- Private customizations of public resources.
- Publication metadata and library version locks.
- Schemas, validation rules, agent instructions, and OctoSprout-specific configuration.

Personal content must never be automatically copied into the public repository.

### 3.2 Public resource repository

The public repository contains reusable, intentionally published artifacts:

- Skills and workflows.
- Generic expert/persona profiles.
- Templates and schemas.
- Sanitized examples and demonstration projects.
- Documentation and contribution guidelines.

The public repository must be independently cloneable and useful without the private workspace or its application server.

It has its own Git history, identifiers, licensing rules, contribution workflow, and validation. Private Git history must never be copied into it.

### 3.3 Configuration and credentials

The application must configure each repository explicitly by role. Git credentials for the private and public repositories must be separate and least-privileged.

Credentials, API tokens, private repository URLs, and personal configuration must not be committed to either repository. Secrets must be supplied through deployment secrets or equivalent protected configuration, not hardcoded in Docker Compose files.

## 4. Record types and identifiers

Initial private record types:

| Type | Example ID | Purpose |
|---|---|---|
| Capture | `OV-C-0001` | Immutable or preserved raw input awaiting triage |
| Idea | `OV-I-0042` | An idea being explored |
| Task | `OV-T-0108` | Actionable work |
| Project | `OV-P-0017` | A goal with scope and planning |
| Decision | `OV-D-0009` | An architecture or project decision |
| Research | `OV-R-0021` | Findings and evidence |

These prefixes are provisional conventions to validate before implementation. IDs must be stable and must not depend on filenames, titles, or board positions. ID allocation must be safe under concurrent writers.

Public resources use an independent namespace, for example `OS-SKILL-0012`. Initial resource types include `skill`, `expert-profile`, `template`, `schema`, `example`, and `guide`.

A private record ID must not become the canonical public ID. Public artifacts must not reveal private record IDs or personal sequence information.

## 5. Ingestion use cases

### UC1 — Quick mobile capture

**Current workflow:** jot thoughts into Apple Notes on iPhone.

**Goal:** capture a thought in seconds without requiring a title, tags, category, or project assignment.

Candidate interfaces:
- Mobile-friendly OctoSprout capture page.
- iOS Shortcut accepting shared text or URLs.
- Apple Notes share-sheet integration.

A quick capture is stored as a Capture record. It can later be promoted to an Idea, linked to an existing record, or discarded after review.

### UC2 — Explore and refine with Claude

Claude can help explore an idea, examine alternatives, identify uncertainties, and produce structured records.

Candidate integration:
- Reusable OctoSprout skill for the interaction protocol and output format.
- MCP tools for reading relevant records and proposing or applying changes where supported.
- Explicit review for record creation, relationship changes, promotion, and other consequential operations.

The skill defines the workflow; MCP, when available, supplies the actual application interface. The system must not assume that every Claude client supports the same capabilities.

### UC3 — Explore and refine with ChatGPT

The primary workflow uses the ChatGPT iOS app.

1. Explore the idea naturally in ChatGPT.
2. Request a structured OctoSprout handoff brief.
3. Share the brief through the iOS share sheet to an OctoSprout Shortcut.
4. The Shortcut submits the text to the private Inbox Service over HTTPS.
5. The service commits a raw Capture record to the private repository.
6. OctoSprout later supports triage and refinement into a structured Idea.

A conversation URL may be included when explicitly supplied. It is optional and is treated as a reference, not as permission to fetch conversation content.

The workflow must not depend on direct MCP integration from the ChatGPT mobile app or automatic access to complete ChatGPT conversation history.

### 5.1 Handoff brief format

The reusable ChatGPT instruction should request:

- Working title and concise description.
- Problem or motivation.
- Proposed approach.
- Important insights and constraints.
- Alternatives considered.
- Open questions and uncertainties.
- Suggested next step.
- Relevant source links, where available.

The handoff is an aid to preserve useful context, not a replacement for the original conversation. Users can submit arbitrary text without first generating a handoff brief.

## 6. Inbox Service on rei3

### 6.1 Purpose

A small authenticated service running on `rei3` receives mobile captures and commits them directly to the private repository. It is the first end-to-end implementation milestone.

The service is a thin ingestion component, not an independent source of truth. The Git repository stores durable captures. No database is required for the MVP.

### 6.2 Initial API

`POST /api/inbox`

Illustrative request:

```json
{
  "text": "The submitted handoff brief or raw note",
  "source": "chatgpt",
  "source_url": "https://chatgpt.com/share/...",
  "capture_id": "client-generated-unique-id"
}
```

`text` and `capture_id` are required. `source` is optional and validated against known values, with an `other` fallback. `source_url` is optional.

The server generates a stable record ID and server-side capture timestamp. It preserves submitted text rather than silently rewriting it.

A successful response returns the capture ID, commit identifier, and synchronization status. A response must not claim a successful commit if the data is only queued locally.

### 6.3 Persistence and Git operations

The initial capture path may use a structure such as:

`records/inbox/YYYY/MM/OV-C-NNNN.md`

This path is provisional. Captures must have stable IDs independent of their storage paths.

The service must:

1. Authenticate and validate the request.
2. Enforce request-size and rate limits.
3. Check the idempotency key to prevent duplicate captures on retries.
4. Acquire a repository-level lock shared with other writers using the same working tree.
5. Fetch or otherwise reconcile the latest private repository state.
6. Allocate an ID safely.
7. Write the raw capture and validate its metadata.
8. Commit and push without force-pushing.
9. Return the durable commit status.

On a non-fast-forward rejection, the service must reconcile against the latest remote state and retry safely. If it cannot complete the push, it must preserve the capture in a durable local queue or journal and report synchronization as pending or failed.

If a push succeeds but the client loses the response, a retry with the same `capture_id` must return the existing capture rather than create a duplicate.

The inbox service must not permit arbitrary file paths, arbitrary shell commands, or client-supplied Git operations.

### 6.4 Security and deployment

- Expose the endpoint only over HTTPS through the existing reverse-proxy infrastructure.
- Use a dedicated, revocable token for the iOS Shortcut.
- Keep tokens out of source control and logs.
- Use narrowly scoped Git credentials for the private repository.
- Restrict allowed request methods, payload size, and request rate.
- Validate text encoding and metadata.
- Avoid logging full capture bodies by default.
- Keep the service working tree isolated from the browser application's working tree, or enforce a common locking and synchronization mechanism.
- Treat all incoming content as untrusted data.
- Do not fetch source URLs automatically in the initial version.

## 7. Private data model and schemas

Schemas must distinguish record type, identity, lifecycle, relationships, and storage location.

Core requirements:

- Explicit `schema_version`.
- Stable typed ID.
- Title where appropriate.
- Created and updated timestamps.
- Lifecycle status appropriate to the record type.
- Typed links to related records.
- Validation of referenced IDs and allowed transitions.
- Raw capture preservation and provenance links.

A Capture should retain its submitted content. Refinement should create or update a separate structured record and link it to the source capture rather than silently replacing the original text.

Idea promotion to Project must preserve the original Idea, set its status to Promoted, create a linked Project record, and maintain a `promoted_to` relationship. The transition must be validated and handled coherently, with explicit user approval.

ADRs must use Andrew Harmel-Law’s upstream template exactly, including its sections for Decision, Context, Options Considered, Consequences, Advice, and Supporting Material. Preserve attribution and add only minimal metadata required by OctoSprout. New decisions supersede earlier ones without rewriting accepted decision history.

## 8. Public resource schema and publishing

### 8.1 Resource metadata

Public resource metadata should include:

- Independent public resource ID.
- Resource type and title.
- Schema version.
- Resource version.
- Author/contributor attribution and provenance.
- Explicit license.
- Optional compatibility constraints and dependencies.

Illustrative resource:

```yaml
id: OS-SKILL-0012
type: skill
title: Review an idea before promotion
schema_version: 1
version: 1.0.0
license: CC-BY-4.0
```

This is an example, not a final schema. The project must choose and document its licensing policy before accepting third-party contributions. Do not assign a license to someone else's content without authorization.

### 8.2 Private publication metadata

The private source record or publication manifest can track:

- Publication status.
- Public resource ID.
- Public path.
- Published resource version.
- Full public commit SHA.
- Source-to-public provenance.

Publication states: `private`, `draft`, `published`, and `withdrawn`.

The public artifact must not contain private backlinks, private repository paths, or personal publication history.

### 8.3 Publishing workflow

1. Select a private source and prepare a distinct public candidate.
2. Remove project-specific context and inspect sensitive metadata.
3. Validate schema, dependencies, attribution, licensing, and links.
4. Run secret and personal-information checks.
5. Show the exact public diff and destination.
6. Require explicit approval.
7. Commit and push to the public repository.
8. Record the resulting public ID, version, and commit SHA privately.

Publishing must never copy private Git history. A failed push must not mark a resource as published. If the public push succeeds but private bookkeeping fails, provide a reconciliation operation.

Initially publish one resource at a time. Bundled publication can be added after dependency semantics are defined.

A resource withdrawn from the current catalog may remain in Git history or existing clones. If sensitive information is accidentally published, assess history cleanup and credential rotation as appropriate.

## 9. Public library consumption

Private workspaces can install public resources without losing local customization.

The private workspace records the public resource ID, source version, and optionally a commit or release reference in a library lockfile.

Possible local states:
- Installed.
- Customized.
- Upstream update available.

Updates must show differences between upstream content and the local copy. Applying an update is an explicit action; it must not overwrite private customizations silently.

The public catalog is a validated or generated index of resource metadata, not an independent source of truth.

## 10. Git collaboration and concurrency

Routine browser edits may commit directly to the private `main` branch after checking remote state, validating changes, and handling conflicts safely.

The application must:
- Preserve concurrent edits.
- Never force-push shared branches.
- Avoid overwriting files changed since they were read.
- Validate records and relationships before committing.
- Reconcile rejected pushes against current upstream state.
- Report unresolved conflicts clearly.

The inbox service and browser editor must coordinate if they share a working tree. Separate working trees are preferred where they simplify locking and conflict management.

Public contributions should use a reviewed workflow such as pull requests. Public publishing from the private workspace must use a separate code path and separate credentials.

## 11. Agent workflows and expert profiles

Reusable skills should cover capture, exploration, relationship discovery, triage, promotion, advice, handoff, and backlog review.

Skills define the interaction protocol; application tools provide validated data operations. Agent instructions must not be the sole enforcement mechanism for security or data integrity.

Expert/persona profiles should be version-controlled and define:
- Remit and scope.
- Questions to investigate.
- Perspective, assumptions, and known biases.
- Expected output structure.
- Relevant evidence and limitations.

Simulated expert advice must be identified as AI-generated. Agreement among multiple simulated personas does not replace user approval for consequential decisions.

Implementation details remain in the target code repository. OctoSprout supplies the brief, goals, scope, constraints, relevant ADRs, and task context. Agent handoff should be explicit and traceable.

## 12. Candidate repository structure

Private repository:

```text
README.md
AGENTS.md
CLAUDE.md
records/
  inbox/
  ideas/
  tasks/
  projects/
  decisions/
  research/
experts/
skills/
schemas/
publications/
library-lock.yaml
scripts/
tests/
docs/
```

Public repository:

```text
README.md
CONTRIBUTING.md
resources/
  skills/
  experts/
  templates/
  schemas/
  examples/
docs/
catalog.yaml
LICENSES/
```

These layouts are provisional and should be refined during the compatibility spike. No directory should mix private records with publishable artifacts merely because they share a content type.

## 13. Hosting and UI

The intended deployment is on `rei3` using Docker Compose. A browser UI supports cross-device access. The private Git repository remains the canonical store.

A candidate Markdown-backed board engine may be evaluated, but no permanent dependency should be selected until a compatibility spike confirms:

- Multiple boards backed by Markdown.
- Stable IDs and external edits.
- Authentication and authorization.
- Direct Git commits and safe concurrency.
- Deployment behind the existing reverse proxy.
- Compatibility with the proposed private/public repository split.

Do not expose the application publicly without authentication. Reuse existing reverse-proxy and certificate infrastructure where practical.

MemPalace may be evaluated as an optional complementary conversational memory tool, but it is never the canonical OctoSprout source of truth.

## 14. MVP scope and implementation sequence

### Phase 0 — Compatibility and safety spike

- Validate repository layouts and schemas.
- Prove safe ID allocation and Git conflict handling.
- Test repository locking and multi-client behavior.
- Verify deployment and authentication on `rei3`.
- Test that the private/public boundary can be enforced independently of agent instructions.

### Phase 1 — First end-to-end ingestion milestone

- Implement the authenticated Inbox Service on `rei3`.
- Create Capture records and commit them to the private repository.
- Implement idempotency and durable failure handling.
- Create an iOS Shortcut that accepts shared text and submits it over HTTPS.
- Test ChatGPT handoff briefs and raw text sharing.
- Confirm the saved capture is visible through the OctoSprout inbox.

### Phase 2 — Core workspace

- Implement idea, task, project, research, and ADR views.
- Support record validation, typed links, and safe editing.
- Implement Idea-to-Project promotion.
- Add triage and refinement workflows.

### Phase 3 — Assistant workflows

- Add Claude skill and supported MCP operations.
- Define the ChatGPT handoff prompt and reusable brief format.
- Preserve source context and links.
- Add reviewable AI-generated structured updates.

### Phase 4 — Public resource library

- Define public schemas, IDs, versioning, provenance, and license policy.
- Implement catalog validation and read-only browsing.
- Add resource installation and lockfile support.
- Implement candidate generation, diff preview, explicit approval, and publishing.
- Add update comparison and local customization preservation.

## 15. Acceptance criteria

The MVP is not complete until the following are demonstrated:

1. A user can share text from an iPhone into OctoSprout without manually editing a file.
2. The Inbox Service authenticates the request and stores the original submitted text.
3. A successful capture is committed to the private repository and returns a verifiable capture ID and commit.
4. Repeating a request with the same idempotency key does not create a duplicate.
5. A remote conflict or push failure never silently loses the capture or falsely reports it as committed.
6. The browser UI can locate and review captured items.
7. Captures can be linked to Ideas without losing their source content.
8. Claude-assisted workflows can propose validated changes without bypassing application safeguards.
9. Public publishing creates a separate artifact and requires explicit review.
10. The public repository contains no private repository history or private publication metadata.
11. Public resource versions can be tracked and compared with locally customized copies.
12. Git restore can recover the durable workspace records.

## 16. Deferred work and open questions

- Full automatic import of ChatGPT conversation history.
- Direct MCP integration from ChatGPT mobile, contingent on supported capabilities.
- Automatic Apple Notes synchronization beyond share-sheet capture.
- Publishing whole projects or entire personal workspaces.
- Multi-user collaboration inside the application.
- Bundled publishing of resources and dependencies.
- Final choice of board engine and API framework.
- Final license policy and contribution terms.
- Final ID allocation mechanism and exact schema files.

## 17. Immediate next deliverable

Build and validate the Phase 0 compatibility spike, then deliver the first ingestion vertical slice:

**ChatGPT iOS handoff → iOS share sheet / Shortcut → authenticated Inbox Service on `rei3` → raw Capture record → validated commit to the private Git repository → visible item in the OctoSprout inbox.**

This is the smallest useful proof that the privacy, Git, and mobile ingestion architecture works before investing in the full application.
