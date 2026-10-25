# OctoVault — Implementation Specification

**Version:** 0.1-draft  
**Date:** 24 October 2026  
**Status:** Ready for architecture review; implementation not yet started

## 1. Purpose

OctoVault is a Markdown-first, Git-backed system for capturing ideas, developing them into projects, recording architectural decisions, and preparing actionable work for coding agents.

It provides a shared knowledge and planning layer across projects and agents. It is not intended to replace GitHub, code repositories, coding environments, or repository-specific development documentation.

### Core principles

1. Markdown files in a private GitHub repository are the canonical source of truth.
2. Git provides version history, synchronization and collaboration.
3. A browser UI provides the primary cross-device experience.
4. Ideas, projects, tasks and architectural decisions have distinct identities and lifecycles.
5. Stable IDs and explicit relationships connect records without depending on filenames or board positions.
6. Coding agents receive sufficient context to perform work without duplicating implementation details.
7. Agents can research, draft and recommend; consequential decisions require explicit human approval.
8. The board engine and optional conversational-memory integration remain replaceable.

## 2. Scope

### In scope for v1

- Browser-based access hosted on rei3.
- Private GitHub repository and Git-backed Markdown storage.
- Separate Ideas, Tasks and Projects boards.
- Architecture Decision Records (ADRs).
- Idea-to-project promotion.
- Typed cross-record relationships and validation.
- Shared agent instructions and reusable skills.
- Reusable expert profiles for architectural advice.
- Coding-agent context assembly and task handoff.
- Safe concurrent editing and direct commits to `main`.
- Automated tests, backups and restore procedures.

### Out of scope for v1

- Building a new general-purpose board engine.
- A full autonomous multi-agent orchestration platform.
- Mandatory GitHub Issues synchronization.
- Automatically implementing every task created in OctoVault.
- Replacing repository-specific `CLAUDE.md`, `AGENTS.md`, tests or architecture documentation.
- Making MemPalace or another conversational-memory system a required dependency.
- Treating simulated expert profiles as real human reviews or qualifications.

## 3. System architecture

### 3.1 Logical architecture

```text
Browser clients
      |
      v
OctoVault web interface
      |
      v
Application / board adapter
      |
      +---- Markdown record operations
      +---- Schema and relationship validation
      +---- Git-aware commit service
      +---- Agent context and workflow tools
      |
      v
Private GitHub repository (main)
      ^
      |
Mac checkout and coding agents
      |
      v
Separate project code repositories
```

The diagram is logical, not a commitment to a particular implementation or process layout.

### 3.2 Hosting

- **rei3:** runs the hosted application and browser-facing board service.
- **GitHub:** hosts the private canonical repository and its history.
- **Mac:** provides a normal local checkout for editing, scripting and coding-agent workflows.
- **Other devices:** access the hosted interface through a secured network connection.

The service must not require the Mac to remain awake for the browser interface to work.

Access must be authenticated. Public internet exposure without appropriate authentication and authorization is prohibited. Secrets and credentials must never be committed to the repository.

### 3.3 Board engine selection

Kanban Lite is the initial prototype candidate, not a permanent architectural dependency.

The implementation spike must establish that the selected engine supports:

- Multiple independent boards.
- Markdown files as canonical records, rather than a hidden database being the actual source of truth.
- External file edits and predictable refresh behavior.
- Stable OctoVault IDs independent of engine IDs.
- Browser-based access with suitable authentication.
- Safe integration with Git-backed concurrent edits.
- A documented way to integrate or replace the board engine.

If Kanban Lite cannot satisfy these requirements without compromising the storage contract, evaluate alternatives before implementation.

## 4. Git and write strategy

### 4.1 Direct commits to `main`

Routine browser edits commit directly to `main`. Pull requests are not required for ordinary record maintenance.

A browser operation must:

1. Read the current record and repository revision.
2. Apply the requested change.
3. Validate the changed record and affected relationships.
4. Check whether the repository has advanced since the edit was based on it.
5. Commit the change to `main` if safe.
6. Refresh the UI from the resulting revision.

If the revision has advanced, OctoVault must reconcile the changes or show a conflict. It must never silently overwrite a newer version.

The service must report commit failures and preserve unsaved user input.

### 4.2 Changes requiring approval

The application must distinguish routine edits from consequential operations.

Examples requiring explicit approval:

- Accepting a consequential architectural decision.
- Deleting records or performing destructive bulk transformations.
- Changing schemas or lifecycle rules.
- Promoting an idea when the promotion proposal has not yet been approved.
- Making a consequential change to an agreed project scope.

Approval is an application workflow requirement, not merely a prompt in an agent instruction.

### 4.3 Multi-record operations

Operations such as promoting an idea must create all required records and relationship updates in a single coherent Git commit where possible.

If validation fails, the operation must not leave a partially completed promotion.

### 4.4 Concurrent contributors

The Mac, browser service and coding agents may use independent checkouts and branches.

Rules:

- Git is the collaboration and history mechanism.
- Local development follows normal Git workflows.
- Browser operations use optimistic concurrency checks.
- Conflicting changes must be preserved and reconciled.
- No process may silently discard another contributor's work.
- Repository history must make changes attributable and reviewable.

### 4.5 Security

- Use least-privilege repository access.
- Keep tokens, passwords and other secrets out of Markdown and Git.
- Exclude credentials, caches and runtime state from commits.
- Secure API, WebSocket and browser access.
- Test authorization separately for browser users and automation.
- Document backup and recovery from the GitHub repository.

## 5. Repository organization

The logical organization is:

```text
octovault/
├── README.md
├── AGENTS.md
├── CLAUDE.md
├── records/
│   ├── ideas/
│   ├── tasks/
│   ├── projects/
│   ├── decisions/
│   └── research/
├── experts/
├── skills/
│   ├── capture/
│   ├── explore/
│   ├── relate/
│   ├── triage/
│   ├── promote/
│   ├── advise/
│   ├── handoff/
│   └── review-backlog/
├── schemas/
├── scripts/
├── tests/
└── docs/
```

This is the proposed logical layout. Exact paths, board configuration and compatibility with the selected engine must be verified during the prototype.

The implementation must not make OctoVault's identity or relationships depend on engine-specific filenames, folders, IDs or status encodings.

## 6. Record model

### 6.1 Stable IDs

Use stable, type-prefixed IDs:

| Record type | ID pattern | Example |
|---|---|---|
| Idea | `OV-I-NNNN` | `OV-I-0042` |
| Task | `OV-T-NNNN` | `OV-T-0012` |
| Project | `OV-P-NNNN` | `OV-P-0007` |
| Decision | `OV-D-NNNN` | `OV-D-0012` |
| Research | `OV-R-NNNN` | `OV-R-0003` |

IDs must be unique, immutable and independent of titles, filenames, repository URLs and board position.

ID allocation must be concurrency-safe. A process must not assume that the next available number remains available between reading and committing.

### 6.2 Metadata

Each record has a small machine-readable metadata section and a human-readable Markdown body.

Illustrative example:

```yaml
---
id: "OV-I-0042"
type: idea
schema_version: 1
status: exploring
related:
  - type: relates_to
    id: "OV-I-0043"
---
# Integrate conversational memory

Describe the idea, motivation, research and open questions here.
```

The exact serialization must be validated against the chosen board engine. If the engine requires additional metadata, that metadata must remain separate from OctoVault's canonical identity and relationships.

Keep required metadata minimal. Optional fields should not prevent an idea from being captured quickly.

### 6.3 Relationships

Use explicit, typed relationships rather than relying on prose or filename conventions.

Initial relationship types:

- `relates_to`
- `belongs_to`
- `derived_from`
- `promoted_to`
- `blocks`
- `supersedes`
- `supports`
- `implements`

The relationship schema must define valid source and target types and whether the relationship is directional.

For example, a project may be derived from an idea; a task may belong to a project; and a code change may implement an accepted architectural decision.

Validation must detect missing targets, duplicate IDs, invalid types and broken relationships. Archived records remain linkable.

## 7. Boards and lifecycle

### 7.1 Ideas

Suggested statuses:

- Inbox
- Exploring
- Ready
- Parked
- Promoted
- Archived

Ideas hold the original motivation, exploration, alternatives, research and unresolved questions.

### 7.2 Projects

Suggested statuses:

- Proposed
- Active
- On hold
- Completed
- Archived

Projects hold the agreed objective, scope, outcomes, constraints, success criteria and links to relevant code repositories.

### 7.3 Tasks

Suggested statuses:

- Backlog
- Ready
- In progress
- Blocked
- Done

Tasks represent actionable work with a clear outcome. Tasks may belong to projects or relate directly to ideas and decisions.

Completing tasks must not automatically complete a project.

### 7.4 Architecture decisions

ADRs have their own lifecycle defined by the adopted upstream template and OctoVault's approval process. They are first-class records with stable IDs and relationships, even if they are presented through a dedicated board or view.

Board status is a view of record state, not an independent source of truth.

## 8. Idea-to-project promotion

Promotion is a first-class workflow, not a move between board columns.

### Workflow

1. Review the idea, linked research and related ideas.
2. Assess readiness and identify unresolved questions.
3. Draft a project brief with goals, non-goals, scope, constraints, risks and success criteria.
4. Suggest initial milestones and actionable tasks where useful.
5. Present the proposal and assumptions for approval.
6. On approval, create the project and any explicitly approved initial tasks.
7. Link the project to the original idea using `promoted_to`.
8. Mark the idea `Promoted`.
9. Validate the entire change and commit it coherently.

The original idea remains available as the historical record of motivation and exploration. Project content may reference related records rather than copying their entire contents.

## 9. Project briefs and coding-agent tasks

### 9.1 Project brief

A project brief should explain:

- Problem and intended users.
- Goals and explicit non-goals.
- Functional and non-functional requirements.
- Constraints and agreed architectural decisions.
- Overall acceptance criteria.
- Open questions, risks and assumptions.
- Links to research, ADRs and related projects.
- Target code repository or repositories.

It describes the intended outcome and constraints, not a duplicate of the implementation documentation.

### 9.2 Task contract

A coding-agent-ready task should provide:

- Stable task ID and objective.
- Parent project, where applicable.
- Relevant project brief and decision links.
- Expected outcome and scope.
- Acceptance criteria.
- Known constraints and dependencies.
- Verification requirements.
- Target repository, when known.

Not every captured task needs a complete implementation contract. Readiness requirements increase as a task moves toward execution.

### 9.3 Code repository ownership

OctoVault owns planning records and cross-project knowledge.

Each code repository owns its implementation, tests, build instructions, detailed component design and repository-specific agent instructions.

OctoVault may link to files, commits, branches and pull requests. It must not duplicate implementation details merely to make a task look complete.

### 9.4 Agent handoff

A shared handoff workflow should:

1. Resolve the task and project context.
2. Retrieve relevant accepted ADRs and supporting material.
3. Open the target code repository.
4. Read its applicable `AGENTS.md`, `CLAUDE.md` and other project instructions.
5. Investigate the existing code before proposing a plan.
6. Implement and test according to the repository's workflow.
7. Report the outcome, verification results, commit or pull request references, and follow-up work to OctoVault.

If the code conflicts with a task or accepted decision, the agent must surface the conflict instead of silently inventing a resolution.

## 10. Architecture Decision Records

OctoVault adopts Andrew Harmel-Law's upstream ADR template:

https://github.com/andrewharmellaw/facilitating-software-architecture/blob/main/adr/adr-template.md

The upstream template is the canonical format. Its sections must not be replaced with a newly invented OctoVault template.

Preserve the template's sections:

- Decision
- Context
- Options Considered
- Consequences for each option
- Advice
- Supporting Material

Preserve the upstream status vocabulary and its intended meaning. The implementation must fetch and retain the actual template and attribution rather than reconstructing it from memory.

OctoVault may add machine-readable metadata for stable ID, schema version, relationships and project scope, without altering the intended decision-making content.

### Decision process

- Agents can research alternatives and draft ADRs.
- Reusable expert profiles can offer different perspectives and record advice.
- Advice and disagreement remain visible in the ADR.
- Consequential decisions require explicit human approval.
- Implementations link back to the relevant ADR.
- Reversals create a new decision that supersedes the previous one; accepted history is not silently rewritten.

The ADR records the decision and its reasoning. Repository documentation explains how the decision is implemented.

## 11. Reusable expert profiles

Expert profiles are version-controlled Markdown artifacts, not hard-coded application personas.

Each profile should define:

- Name and area of focus.
- Scope and expertise to apply.
- Questions to investigate.
- Assumptions and biases to watch for.
- Expected advice format.
- Limitations and relevant conflicts of perspective.

Profiles may be created for a particular decision and retained for reuse when useful.

Examples include security architecture, distributed systems, developer experience, data modeling and operations.

When advising on a decision, multiple profiles may investigate independently. The synthesis should capture agreements, disagreements, evidence and recommendations in the ADR's Advice section or linked supporting material.

These are simulated expert perspectives, not substitutes for qualified human review. Agent agreement never substitutes for required approval.

## 12. Shared agent skills and instructions

The repository should provide a common `AGENTS.md` and reusable skills for:

- `capture`: create an idea with minimal friction.
- `explore`: research and refine an idea.
- `relate`: identify and propose links between records.
- `triage`: review inbox items and backlog.
- `promote`: prepare an idea-to-project proposal.
- `advise`: gather expert perspectives and prepare an ADR.
- `handoff`: prepare a task for a coding agent.
- `review-backlog`: identify stale, blocked or unlinked records.

`CLAUDE.md` should refer to shared instructions where supported, rather than maintaining a divergent copy of every rule.

Skills must describe their inputs, outputs, validation requirements, permitted side effects and approval boundaries.

The first version should support portable Markdown-based workflows. MCP or other integrations may be added where they materially improve usability, but the data model must not depend on a particular agent platform.

## 13. Optional conversational memory

MemPalace is an optional complementary layer for retrieving context from past conversations.

It must not become the canonical store for ideas, tasks, project requirements or accepted ADRs.

Important information discovered in conversation should be curated into explicit OctoVault records when appropriate. The system must remain useful if MemPalace is absent, unavailable or replaced.

No required workflow may depend on conversational memory being available.

## 14. Validation and testing

A validation command must check:

- Unique, correctly typed IDs.
- Required metadata and supported schema versions.
- Valid status values for each record type.
- Relationship targets and allowed target types.
- Invalid or duplicate relationships.
- ADR status and template compliance.
- Required project/task links.
- Missing or invalid repository references where validation is possible.

Validation must be runnable locally and in automated tests. Errors should identify the affected record and explain how to fix the problem.

### Required tests

**Record model**
- Create and edit each record type.
- Rename a record without changing its ID.
- Validate relationships across all boards.
- Preserve links to archived records.

**Promotion**
- Promote an idea into a linked project.
- Preserve the original idea and its history.
- Reject or roll back invalid partial promotions.
- Prevent duplicate IDs during concurrent promotions.

**Git**
- Commit routine browser edits directly to `main`.
- Detect a stale base revision.
- Preserve conflicting edits.
- Handle failed pushes without losing user input.
- Verify that multi-record operations are committed coherently.

**Board engine**
- Confirm Markdown remains canonical.
- Verify browser edits and external file edits stay consistent.
- Verify IDs survive renames and board transitions.
- Verify authentication and authorization.
- Demonstrate that the board engine can be replaced without migrating canonical identity or relationship semantics.

**Agent workflows**
- Assemble the correct project/task/ADR context.
- Respect repository-specific instructions.
- Preserve approval requirements.
- Report implementation outcomes and verification results.
- Work without MemPalace.

**Recovery**
- Reconstruct the repository from GitHub.
- Restore a working hosted instance from a documented procedure.

## 15. MVP acceptance criteria

The MVP is complete when a user can:

1. Capture and refine ideas through a browser.
2. Browse separate Ideas, Tasks and Projects boards.
3. Promote an idea into a project without losing the original record.
4. Create linked tasks and ADRs.
5. Use the upstream ADR template.
6. Reuse expert profiles and capture advice.
7. Hand a task to a coding agent working in a separate code repository.
8. Access and update records from both the browser and a Mac checkout.
9. Commit browser edits directly to `main` without silently overwriting concurrent work.
10. Validate records and relationships automatically.
11. Operate without MemPalace.
12. Restore the complete canonical dataset from GitHub.

## 16. Implementation phases

### Phase 0 — Compatibility spike

- Fetch the upstream ADR template.
- Prototype Kanban Lite against the proposed record model.
- Verify multiple boards, metadata, stable IDs and external edits.
- Test authentication and remote browser access.
- Test concurrent edits from the browser and Mac.
- Prove direct commits to `main` and conflict handling.
- Confirm the intended deployment works on rei3.

**Exit criterion:** the selected engine can meet the storage and collaboration contracts without making its internal format the canonical identity model.

### Phase 1 — Canonical repository

- Establish the repository structure.
- Implement IDs, schemas, relationship rules and validation.
- Add initial templates and example records.
- Add shared agent instructions and core skills.
- Add automated tests.

### Phase 2 — Browser workflow

- Deploy the board engine and application on rei3.
- Implement secure access.
- Integrate Git-aware edits and concurrency checks.
- Verify all three boards and cross-record navigation.

### Phase 3 — Planning and architecture workflows

- Implement idea promotion.
- Add ADR creation and lifecycle handling.
- Add expert profiles and advice capture.
- Implement task context assembly and agent handoff.

### Phase 4 — Hardening

- Test concurrency, recovery and security.
- Improve validation and error reporting.
- Document backup, restore and operational maintenance.
- Evaluate optional MCP and GitHub Issues integrations based on actual usage.

## 17. Open implementation questions

These are implementation-spike questions, not unresolved product goals:

1. Does Kanban Lite support the canonical Markdown layout and metadata without incompatible transformations?
2. Should the application commit through a local Git checkout on rei3 or through GitHub's API? Either implementation must preserve direct commits to `main`, atomic multi-record operations and conflict detection.
3. What authentication mechanism best fits the actual rei3 deployment and private network?
4. How should IDs be allocated safely across independent checkouts?
5. Which agent integration mechanism—CLI, MCP or shared skill alone—provides the best initial handoff experience?

These questions must be answered with a working prototype and documented results before locking the implementation stack.

## 18. Final architectural position

OctoVault v1 is a Git-backed project knowledge and planning system with a replaceable browser board, stable typed records, explicit relationships, reusable agent workflows and human-governed architectural decisions.

Its purpose is to make ideas, project intent and technical reasoning durable and accessible to both people and coding agents, while leaving implementation details in the repositories where the software is actually built.

**The next deliverable is the Phase 0 compatibility spike—not the full application.** Once that spike validates the board engine and Git collaboration model, implementation can proceed against this specification.
