# Boards: design details for ADR006

Status: design for ADR006, which is accepted, and built (Phase 2): the
four boards, the status-move API, drag and *Move to…*, the conflict dialog
and the refresh check. Consequential moves are listed but disabled until
proposals and signed approvals land; see §10. The owner's answers of 26 Oct 2026 are worked in
(§9); none are open. Companion mockup: [`boards-mockup.html`](boards-mockup.html)
(open it in a browser; sample data, saves are simulated).
The visual direction (palette, navigation, phone layout) is in
[`ui-brief.md`](ui-brief.md).

ADR006 proposes a thin custom UI: server-rendered board pages from the
existing Fastify server, small hand-written scripts, no build step. This note
says what that means in practice: what the pages contain, which routes and
payloads they use, how a move travels through the write service, what the
browser keeps, and what is still open.

## 1. What the user sees

### Pages

| Route | Content |
|---|---|
| `GET /ideas` | Ideas board |
| `GET /tasks` | Tasks board, with a project filter (`?project=OS-P-…`) |
| `GET /projects` | Projects board |
| `GET /decisions` | Decisions board, with the same project filter |

The navigation gains Ideas, Tasks, Projects and Decisions. The board
pages lift the `main { max-width: 42rem }` limit of the Phase 1 pages; every
other style is shared through `/static/app.css`.

### Columns

A column is one status from spec §7, in lifecycle order. Terminal statuses
start folded to a narrow strip with a count, and open on click.

| Board | Columns (folded in *italics*) |
|---|---|
| Ideas | Seed, Sprouting, Ready, Dormant, *Transplanted*, *Composted* |
| Tasks | Backlog, Ready, In progress, Blocked, Done, *Cancelled* |
| Projects | Proposed, Active, On hold, Completed, *Archived* |
| Decisions | DRAFT, PROPOSED, ACCEPTED, ADOPTED, *SUPERSEDED*, *EXPIRED* |

Decisions are a board like the others, not only a list: they have states, so
they get columns (owner, 26 Oct 2026). This changes §12.2, which lists them
as a list.
Within a column cards sort by `updated`, newest first. There is **no manual
ordering** (owner, 26 Oct 2026): a stored position would have to be an `x-`
key written into every file on every reorder.

### Card

```
⠿  Weekly garden digest              ← title links to Record detail
   OS-I-5VT4F
   #weekly  2 captures                ← tags, link summary
   [Move to… ▾]           yesterday   ← sync indicator replaces the age while saving
```

Link chips come from the index: `belongs_to` project (Tasks), `blocks` and
"blocked by" (Tasks, from backlinks), linked captures and research (Ideas),
task counts (Projects), project and `supersedes` (Decisions). Nothing on the
card is stored anywhere but in the record files.

### Blocked tasks

*Blocked* is both a status and something the index works out (owner,
26 Oct 2026):

- **The status** is set by hand, like any other: move the card to Blocked.
  Use it for anything that holds a task up, including things outside the
  workspace.
- **The derived state** comes from `blocks` links: a task is *blocked by* every
  task that `blocks` it and is not `done` or `cancelled`. The card shows a red
  "blocked by OS-T-…" chip in whatever column it is in. The index computes
  this; nothing is written.

How the two meet:

| Situation | What happens |
|---|---|
| Task has open blockers, status is not `blocked` | Red "blocked by" chip. Moving it to In progress or Done asks "Still blocked by OS-T-…. Move anyway?" |
| A blocker is moved to `done` | Every task that is `blocked` and has no other open blocker moves to `ready` **in the same commit** (owner, 26 Oct 2026). Move to… shows it in advance ("Done (+1 unblocked)"), and those cards move and flash with the blocker. |
| Task is `blocked`, its last blocker is `cancelled`, or was finished somewhere that didn't unblock it | Green "unblocked" chip with a one-tap **Move to Ready**. A cancelled blocker did not do its work, so it does not unblock anything by itself. |
| Task is `blocked`, no blocking links | Normal card in Blocked: blocked for a reason outside the workspace |

Rules for the unblocking move:

- Only tasks whose status is `blocked` move. A task with a "blocked by" chip in
  another column keeps its status.
- It is one operation and one commit: subject
  `status: OS-T-2B7KC ready -> done (+1 unblocked)`, with a precondition on
  every file it touches. If any of them changed since the server read it, the
  whole move is a 409, so nothing half-applies.
- The unblocked tasks count towards `bulk_threshold` (§9.2 item 5): if the
  move would touch more than 10 records, it needs approval.
- The rule lives in `@octosprout/core`, so `octosprout` on the Mac and the MCP
  server unblock the same way. A blocker finished by hand-editing a file
  unblocks nothing; the chip covers that case.

A status never changes without a move by the user: the unblocking rides on
the user's own commit.

### Moving a card

Two ways, both ending in the same request:

1. **Drag by the grip (⠿).** Pointer Events, so mouse, pen and touch share one
   code path. Only the grip has `touch-action: none`, so on the iPhone the
   rest of the card still scrolls the board. Columns the lifecycle forbids are
   dimmed and refuse the drop. Near the board's edge the board scrolls
   sideways so a phone can reach the next column.
2. **Move to…** A native `<select>` on every card, listing only the allowed
   targets. On iPhone this is the system picker. It is also the keyboard and
   screen-reader path.

The boards need JavaScript to move cards; there is no form-post fallback
(owner, 26 Oct 2026). Without JavaScript they still render and can be read.

### Phone (375 px)

- One column fills about 84 % of the width; the next one peeks in. Columns
  snap when swiped (`scroll-snap-type: x mandatory`).
- A row of status chips with counts above the board jumps to a column.
- The navigation scrolls sideways when it does not fit.
- Dialogs use the full width minus 16 px on each side.

## 2. Allowed moves

The server's lifecycle table is the single source; the page receives the
allowed targets per card in the HTML (`data-moves="ready dormant composted"`),
so the script holds no rules of its own.

| Board | From | To |
|---|---|---|
| Ideas | seed | sprouting, dormant, composted |
| | sprouting | ready, dormant, composted |
| | ready | sprouting, dormant, composted, transplanted (wizard) |
| | dormant | seed, sprouting, ready |
| | composted | seed |
| | transplanted | none |
| Tasks | any | any other (owner, 26 Oct 2026) |
| Projects | any | any other (owner, 26 Oct 2026) |
| Decisions | DRAFT | PROPOSED |
| | PROPOSED | DRAFT, ACCEPTED |
| | ACCEPTED | ADOPTED, SUPERSEDED, EXPIRED |
| | ADOPTED | SUPERSEDED, EXPIRED |
| | SUPERSEDED, EXPIRED | none |

The Decisions moves were confirmed by the owner on 26 Oct 2026. They follow
§7.6's rule that an accepted decision is not reopened; a reversal is a new
decision that supersedes it.

Consequential moves (§9.2) never commit straight from the board:

| Move | What happens |
|---|---|
| Idea `ready → transplanted` | Opens the promotion wizard at `/ideas/<id>/promote` (§10). The card stays in Ready until the promotion commit lands. |
| Project `active → completed` | Confirmation dialog with the diff, then passkey re-verification; the move is committed with its signed `approval` in the same commit. |
| Project `active → archived` | The same dialog (owner, 26 Oct 2026; adds to §9.2 item 3). |
| Decision `→ ACCEPTED`, `→ EXPIRED` | The same dialog. The move rewrites the frontmatter `status` and the body's `* Status:` line together, since §7.6 requires them to match. |
| Decision `→ SUPERSEDED` | Only possible when a newer decision already `supersedes` it. Otherwise the drop opens "Create a superseding decision", which drafts the new one from the template. With one, the same approval dialog. |

## 3. The request

```http
POST /api/v1/records/OS-I-5VT4F/status
x-csrf-token: …
content-type: application/json

{ "to": "ready", "base_blob": "3f2a9c1…" }
```

- Session, Origin and CSRF checks are the existing `requireSession` ones.
- `base_blob` is the blob SHA of the file when the page was rendered; it is
  in the card's HTML as `data-blob`.
- The handler reads the file, checks the transition, sets `status` and
  `updated` (nothing else; key order, unknown `x-` keys and the body are
  kept; for a decision also the body's `* Status:` line), and calls:

```ts
writeService.submit({
  operation: "status",
  actor: "user:web",
  subject: "status: OS-I-5VT4F sprouting -> ready",
  preconditions: [{ path, baseBlob }],
  changes: [{ path, content }],
});
```

Responses:

| Status | Body | Card shows |
|---|---|---|
| `200` | `{ status: "committed", commit, base_blob }` | ✓ `a1b2c3d`, then the age again |
| `200` | `{ status: "pending", commit, base_blob }` | ● pending push, and the page banner Phase 1 already has |
| `200` | `{ status: "unchanged" }` | nothing (the card was already there) |
| `409` | `{ error: "conflict", base, current, submitted, current_blob }` | conflict dialog |
| `422` | `{ error: "transition", from, to }` | card snaps back, message |
| `403` | `{ error: "approval_required" }` | should not happen; the UI opens the dialog first |

The new `base_blob` in the response replaces the card's `data-blob`, so a
second move of the same card needs no reload.

Moving a task to `done` can include unblocked tasks (§1, Blocked tasks). The
request is the same; the server adds those files to `changes` and
`preconditions`, and the response lists them as
`unblocked: [{ id, base_blob }]` so the page moves those cards too.

Rule while a request is in flight: the card is moved optimistically and shows
*Saving…*; on any error it moves back. A second move of the same card waits
for the first answer.

## 4. Conflicts (409)

A status move changes two fields, so the three-way view (§8.4) can be a small
table rather than a text merge:

| Field | When you loaded | On GitHub now | Your move |
|---|---|---|---|
| status | Ready | Dormant | Sprouting |
| updated | Oct 24, 09:00 | Oct 26, 09:38 | now |

Actions:

- **Move anyway**: a new request with `current_blob` as `base_blob`. Offered
  only if the move is allowed from the *current* status.
- **Keep GitHub's version**: the card goes to the current column; nothing is
  written.
- **Open record**: Record detail with the full three-way view, for the case
  where the title or body changed too.

Nothing needs to be kept in local storage for a move: the user's input is one
click, and the dialog keeps it until they choose.

## 5. Changes from elsewhere

The server already fetches every 60 s and rebuilds the index (§8.3). The
board needs to learn that its data is stale:

- `GET /api/v1/boards/ideas/version` returns an ETag (a hash of the IDs,
  statuses and blobs on that board). The page asks when it becomes visible
  again (`visibilitychange`) and every 60 s while visible.
- If it changed and no move is in flight, the page fetches the board's HTML
  fragment (`GET /ideas?fragment=board`) and swaps it in, flashing the cards
  that changed. If a move is in flight, it shows "Board changed on GitHub ·
  Refresh" instead.

No WebSocket or server-sent events: a 60 s delay is fine for a personal
board, and polling keeps the server stateless.

## 6. What lives where

| Thing | Where |
|---|---|
| Statuses, titles, links | Record files in Git (only there) |
| Columns, allowed moves | Server code (§7 table), rendered into the HTML |
| Board contents | In-memory index, rendered per request |
| `base_blob` per card | HTML attribute |
| In-flight move | Script memory, for the length of one request |
| Folded/unfolded columns, last project filter | `localStorage`, per browser (convenience only) |

## 7. Code shape

All in `app/packages/server`, next to the Phase 1 UI:

| File | Content | Rough size |
|---|---|---|
| `ui/boards.ts` | `GET /ideas`, `/tasks`, `/projects`, `/decisions`; column and card HTML through `esc()` | 300 lines |
| `records/status.ts` | Transition table, `set_status` handler, `POST /api/v1/records/:id/status`, version route | 200 lines |
| `ui/assets.ts` | `BOARD_JS` (drag, move, dialogs, refresh) and board CSS | 300 lines JS, 120 lines CSS |
| tests | Route tests like `ui.test.ts`; write-service conflict test; one Playwright e2e for drag and Move to… | |

The browser downloads about 10–12 KB of script and CSS, uncompressed, with no
dependency.

Two prerequisites exist only in part today, and are Phase 2 work whichever
UI is chosen:

- **The record index (§4.2).** The server indexes captures only
  (`inbox/service.ts`). Boards need the general index of ideas, tasks,
  projects and decisions with links and backlinks.
- **The transition table.** `@octosprout/core` has the status vocabularies
  (`STATUSES` in `types.ts`) but not the allowed transitions. They belong
  there so the validator, the server and the CLI share them.

## 8. Tests

- Unit: transition table (every allowed and rejected pair), status rewrite keeps
  key order, `x-` keys and the body byte for byte.
- Route: 200 committed/pending, 409 with all three versions, 422, 403 for a
  consequential move without approval, CSRF and session required.
- E2E (Playwright, Chromium and WebKit at 375 px): drag a card by the grip,
  Move to…, conflict dialog after a change pushed from a second clone.
- Manual: drag on a real iPhone in Safari and in the home screen app.

## 9. Owner's answers (26 Oct 2026)

| Question | Answer | Where it went |
|---|---|---|
| Tasks and Projects: allow every move? | Yes | §2 |
| Does `active → archived` need approval too? | Yes | §2; spec §9.2 item 3 |
| Blocked set by hand, or derived from `blocks`? | Both | §1, Blocked tasks |
| Manual ordering inside a column? | No | §1, Columns |
| No-JavaScript fallback for Move to…? | No | §1, Moving a card |
| Decisions only a list? | No, they have states, so they get columns | §1, §2 |

### Spec changes made with ADR006

- §7.3, §7.4: every move between task statuses and between project statuses
  is allowed.
- §7.6: the Decision transitions in §2.
- §9.2 item 3: moving an `active` project to `archived` is consequential.
- §12.2: Decisions become a board with columns by status, filterable by
  project; the row "Ideas, Tasks and Projects boards" includes Decisions.
- §22 criterion 7: Decisions get a board.
- §7.3: `blocked` is a status set by hand; `blocks` links are shown on the
  card; moving a task to `done` also moves every `blocked` task it was the
  last open blocker of to `ready`, in the same commit.

Follow-up answers:

| Question | Answer | Where it went |
|---|---|---|
| Decision transitions as in §2? | Yes | §2 |
| Moving a blocker to Done also moves the tasks it unblocks to Ready, in the same commit? | Yes | §1, Blocked tasks; §3 |

No questions are open. ADR006 is accepted and the spec changes above are
made in `implementation-spec-v0.4-draft.md`.

## 10. As built

Differences from the design above, all deliberate:

- **Columns are `<details>` elements.** Folding and unfolding works without
  JavaScript; open columns are kept across refreshes, not in `localStorage`.
- **Consequential moves are disabled options** ("Accept… (needs approval)")
  and gated columns refuse the drop, until the approval dialog with passkey
  re-verification exists (proposals, spec §9). The server answers `403
  approval_required` for them either way.
- **After every answer the board is re-rendered** from `?fragment=board`
  rather than patched card by card, so the script holds no lifecycle rules
  and never shows a state the server does not have. The moved card then shows
  the commit SHA or *pending push*.
- **The conflict dialog** offers *Open record*, *Keep the current version*
  and *Move anyway*.
- **Card titles link to Record detail** (`/records/<ID>`).
- **A move that would add validation errors** (for example a task to `ready`
  without its contract sections) is refused with `422 validation` and the
  first finding is shown.
