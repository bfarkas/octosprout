# OctoSprout architecture decisions

OctoSprout's own architecture decisions, written with the same vendored
template the product uses ([`templates/adr/adr-template.md`](../../templates/adr/adr-template.md)).
A decision is never rewritten once accepted; a reversal is a new ADR that
supersedes it.

| ADR | Decision | Status |
|---|---|---|
| [ADR001](0001-capture-via-share-link-and-home-screen-app.md) | Capture on iOS through a share link and a home screen web app | ADOPTED |
| [ADR002](0002-fastify-and-server-rendered-pages.md) | Fastify and server-rendered pages for the Phase 1 server | ADOPTED |
| [ADR003](0003-flock-for-the-write-lock.md) | flock(1) for the write service's advisory lock | ADOPTED |
| [ADR004](0004-random-session-ids-without-a-session-secret.md) | Random session IDs, without a session secret | ADOPTED |
| [ADR005](0005-chatgpt-handoff-as-a-custom-instructions-command.md) | ChatGPT handoff brief as an `/octosprout` Custom Instructions command | ADOPTED |
| [ADR006](0006-board-engine-and-frontend.md) | Thin custom board UI, server-rendered, instead of Kanban Lite | PROPOSED |

The board engine and frontend (D5) are proposed in ADR006 and wait for the
owner to accept them. The spike that produced it is
[`docs/handoffs/board-engine-spike.md`](../handoffs/board-engine-spike.md).
