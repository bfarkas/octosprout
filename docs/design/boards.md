# Boards: design details for ADR006

Status: sketch for review, written so ADR006 can be accepted or rejected.
Nothing here is built. Companion mockup: [`boards-mockup.html`](boards-mockup.html)
(open it in a browser; sample data, saves are simulated).

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

The navigation gains Ideas, Tasks, Projects (and later Decisions). The board
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

Within a column cards sort by `updated`, newest first. There is **no manual
ordering** in the first version: a stored position would have to be an `x-`
key written into every file on every reorder, which makes noisy commits and
conflicts for no gain on a personal board.

### Card

```
⠿  Weekly garden digest              ← title links to Record detail
   OS-I-5VT4F
   #weekly  2 captures                ← tags, link summary
   [Move to… ▾]           yesterday   ← sync indicator replaces the age while saving
```

Link chips come from the index: `belongs_to` project (Tasks), `blocks` and
"blocked by" (Tasks, from backlinks), linked captures and research (Ideas),
task counts (Projects). Nothing on the card is stored anywhere but in the
record files.

### Moving a card

Three ways, all ending in the same request:

1. **Drag by the grip (⠿).** Pointer Events, so mouse, pen and touch share one
   code path. Only the grip has `touch-action: none`, so on the iPhone the
   rest of the card still scrolls the board. Columns the lifecycle forbids are
   dimmed and refuse the drop. Near the board's edge the board scrolls
   sideways so a phone can reach the next column.
2. **Move to…** A native `<select>` on every card, listing only the allowed
   targets. On iPhone this is the system picker. It is also the keyboard and
   screen-reader path.
3. **Without JavaScript** (optional). The same `<select>` inside a
   `<form method="post">` with a submit button would work as a plain form post
   if the server accepted the CSRF token as a hidden field. Not planned for
   the first version; listed because it costs little if wanted.

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
| Tasks | any | any other (**assumption**: §7.3 lists no transitions) |
| Projects | any | any other (**assumption**: §7.4 lists no transitions) |

Consequential moves (§9.2) never commit straight from the board:

| Move | What happens |
|---|---|
| Idea `ready → transplanted` | Opens the promotion wizard at `/ideas/<id>/promote` (§10). The card stays in Ready until the promotion commit lands. |
| Project `active → completed` | Confirmation dialog with the diff, then passkey re-verification; the move is committed with its signed `approval` in the same commit. |
| Decisions to `ACCEPTED`, `SUPERSEDED`, `EXPIRED` | Same dialog, on the Decisions list (not a board). |

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
  kept), and calls:

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
| `ui/boards.ts` | `GET /ideas`, `/tasks`, `/projects`; column and card HTML through `esc()` | 250 lines |
| `records/status.ts` | Transition table, `set_status` handler, `POST /api/v1/records/:id/status`, version route | 200 lines |
| `ui/assets.ts` | `BOARD_JS` (drag, move, dialogs, refresh) and board CSS | 300 lines JS, 120 lines CSS |
| tests | Route tests like `ui.test.ts`; write-service conflict test; one Playwright e2e for drag and Move to… | |

The browser downloads about 10–12 KB of script and CSS, uncompressed, with no
dependency.

Two prerequisites exist only in part today, and are Phase 2 work whichever
UI is chosen:

- **The record index (§4.2).** The server indexes captures only
  (`inbox/service.ts`). Boards need the general index of ideas, tasks and
  projects with links and backlinks.
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

## 9. Open questions for the owner

1. Tasks and Projects have no transition rules in §7. Allow every move
   (assumed here) or write rules into the spec?
2. Is `active → completed` the only consequential project move, or should
   `→ archived` from `active` also need approval?
3. Should *Blocked* be a column that is set by hand (assumed), or derived from
   open `blocks` links? Derived would mean the column is not a status, which
   contradicts §7.
4. Is manual ordering inside a column needed at all? If yes, it needs an `x-`
   key (for example `x-rank`) and every reorder becomes a commit.
5. Is the no-JavaScript form fallback for Move to… worth the hidden CSRF field?
6. Decisions are a list, not a board (§12.2). Confirm.
