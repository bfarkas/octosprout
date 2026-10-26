# ADR006 - Board engine and frontend for the Ideas, Tasks and Projects boards
* Date: Oct 26, 2026
* Status: PROPOSED
* Author: Claude Code (spike for bfarkas)

## Decision
Build a thin custom board UI on `@octosprout/core` and the existing Fastify
server. Do not adopt Kanban Lite (`kanban-lite` 1.2.22). The boards are
server-rendered pages with small hand-written scripts and no build step, the
approach ADR002 set for Phase 1. A move is a `set_status` write through
`GitWriteService.submit()` with the `base_blob` the page was rendered from.
Touch devices get a "Move to…" control as well as drag and drop.

## Context
Spec D5 asked Phase 0 to choose between Kanban Lite and a thin custom UI
(§12.1). An engine must meet six criteria and the first failure eliminates it.
Kanban Lite fails criterion 1 (Markdown stays canonical), criterion 6
(replaceable without migrating IDs). The spike could not show that it passes
criteria 4 and 5, and stopped there because one failure is enough. The evidence is in
[`docs/handoffs/board-engine-spike-results.md`](../handoffs/board-engine-spike-results.md).
The constraints for any UI are the CSP `default-src 'self'` (no inline script
or style), a 375 px layout, no hidden state outside Git, the 409 three-way flow
(§8.4) and the confirmation dialog for consequential moves (§9.2).

## Options Considered
### Option 1 (SELECTED): Thin custom UI, server-rendered with small scripts
Columns come from the §7 lifecycles, cards from the in-memory index (§4.2),
each card carrying its `base_blob`. The browser holds only the rendered page
and unsaved input.

#### Consequences
 * Adopted because: the engine never owns the files, so the §6 format, `x-` keys, key order and IDs are unchanged by construction.
 * Adopted because: moves use the existing write service, session and CSRF/Origin checks, and the existing CSP header with no changes.
 * Adopted because: no new build tooling or dependencies, and the same escaping function and test style as Phase 1.
 * Adopted because: the Phase 1 pages and the boards share one stylesheet and one set of conventions.
 * Adopted despite: OctoSprout writes and maintains the board code itself (columns, ordering, the 409 dialog, the sync indicator) where Kanban Lite offers a finished board UI.
 * Adopted despite: drag and drop on touch screens is hand-written with Pointer Events and was not prototyped in this spike; the "Move to…" control is the fallback.
 * Adopted despite: the Record detail editor (§12.2) is still needed and is not made smaller by this choice.

### Option 2: Thin custom UI with Preact or Lit
#### Consequences
 * Rejected because: it needs a bundler and a build step in `app/` that nothing else uses, for boards that are a handful of columns of cards.
 * Rejected because: it moves state into the browser, which the 409 flow and "no hidden state outside Git" would then have to police.
 * Rejected despite: component structure and a smaller amount of hand-written DOM code for the card and dialog interactions.
 * Revisit if: the Record detail editor or Proposals diff view turns out to need it.

### Option 3: Thin custom UI with a full framework
#### Consequences
 * Rejected because: it adds the largest build, dependency and bundle cost, and a second rendering model next to the server-rendered pages.
 * Rejected despite: mature drag-and-drop and accessibility libraries.

### Option 4: Kanban Lite (`kanban-lite` 1.2.22, MIT)
#### Consequences
 * Rejected because: criterion 1 fails. `kl init` moved the six idea files into `boards/default/<status>/`, and a move or edit rewrote the frontmatter: `type`, `schema_version`, `title`, `tags`, `links`, `updated` and an `x-` key were dropped, engine fields (`priority`, `labels`, `order`, `attachments`, `version`) were added outside `x-`, and `.log` files and a `.kanban.json` appeared. `octosprout validate` went from 0 to 15 errors.
 * Rejected because: criterion 6 fails. New cards get the engine's own numeric IDs and filenames (`1-new-engine-idea.md`), and the engine reads the card title from the body, not from `title`.
 * Rejected because: it only accepts its own statuses until columns are added by hand, and its writes were not routed through the write service in the spike. The server sent no CSP header and its page has an inline `<script>`.
 * Rejected despite: it has a finished board UI with multiple boards, a REST API, an MCP server and live refresh; an external change showed on the board within three seconds.
 * Rejected despite: a documented SDK with before-event hooks and storage plugins, which might one day allow an adapter. That would be a custom adapter over an engine whose file format has to be overridden, so the saving is small.

## Advice
 * None recorded.

## Supporting Material
 * [Board design details](../design/boards.md) and [clickable mockup](../design/boards-mockup.html)
 * [Spike results](../handoffs/board-engine-spike-results.md)
 * [Spike brief](../handoffs/board-engine-spike.md)
 * [Spec §12.1](../spec/implementation-spec-v0.4-draft.md)
 * [ADR002](0002-fastify-and-server-rendered-pages.md)
