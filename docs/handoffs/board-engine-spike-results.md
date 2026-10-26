# Board engine spike (D5): results

Run on rei3 on 26 Oct 2026. Decision proposed in
[ADR006](../adr/0006-board-engine-and-frontend.md).

## Setup and deviations from the brief

- **Candidate.** "Kanban Lite" is [borgius/kanban-lite](https://github.com/borgius/kanban-lite),
  npm `kanban-lite`. Other matches were `LachyFS/kanban-markdown` (a VS Code
  extension, no standalone server) and `fpperri/kanban`. The owner chose
  borgius/kanban-lite.
- **Version and licence.** 1.2.22, published 1 May 2026 (the latest on npm on
  26 Oct 2026), MIT, 494 commits on `main`. Cards are Markdown with YAML
  frontmatter; optional SQLite, MySQL, PostgreSQL, MongoDB and Redis storage
  plugins exist. Recent release cadence was several versions in March 2026,
  then one in May.
- **Location.** `/srv` is root-owned and the session has no sudo, so the spike
  lived in `~/octosprout-spike/` on rei3, not `/srv/octosprout-spike/`. The
  owner agreed. Docker project name and ports followed the brief.
- **Toolchain.** rei3 has Node 12 and no pnpm, so `pnpm install` and
  `pnpm build` of `app/` and every `octosprout` CLI call ran in a `node:24-slim`
  container (`cli.sh`). The `pre-push` hook that `init` wrote has the container
  path in it, so it was rewritten for the spike's workspace only.
- **Network.** The owner chose to bind spike ports to the LAN address
  `192.168.42.57` (rei3 also has a global IPv6 address and the firewall could
  not be read without sudo). Only port 9101 was used, briefly.
- **Test data.** A local bare repository (`remote.git`) and a throwaway
  workspace with 6 ideas, 2 projects and 10 tasks, `x-` keys on 5 records and
  `blocks` and `belongs_to` links. `octosprout validate`: 0 errors and 18
  warnings (OSV003, no schema yet for the type), as the brief expects.

## Criteria for Kanban Lite

| # | Criterion | Result |
|---|---|---|
| 1 | Markdown stays canonical | **Fail** |
| 2 | Separate boards | Pass with conditions |
| 3 | External changes | Pass |
| 4 | Writes through the write service | Not shown |
| 5 | Behind the passkey session | Not shown; two problems seen |
| 6 | Replaceable | **Fail** |

### 1. Markdown stays canonical: fail

The engine expects its own layout, so `kl init --dir records/ideas`, and even
`kl list`, **moved** all six idea files from `records/ideas/<file>` to
`records/ideas/boards/default/<status>/<file>` (shown as `D` and `??` in
`git status`). `octosprout validate` reports OSV001 for them ("belongs in
records/ideas/").

Then three actions on the moved files:

- `kl move OS-I-M9S34 sprouting` (after adding the OctoSprout statuses as
  columns, since the defaults are backlog, todo, in-progress, review, done).
- `kl edit OS-I-5VT4F --label weekly --priority high`.
- `kl edit OS-I-6Q3D2 --priority low`, on a card with `x-owner-note`.

Every touched file had its frontmatter rewritten. For OS-I-5VT4F:

```diff
-id: OS-I-5VT4F
-type: idea
-schema_version: 1
-title: Weekly garden digest
-status: sprouting
-created: 2026-10-20T09:00:00Z
-updated: 2026-10-24T09:00:00Z
+version: 0
+id: "OS-I-5VT4F"
+status: "sprouting"
+priority: "high"
+assignee: null
+dueDate: null
+created: "2026-10-20T09:00:00Z"
+modified: "2026-10-26T20:59:55.593Z"
+completedAt: null
+labels:
+  - "weekly"
+attachments:
+  - "OS-I-5VT4F.log"
+order: "a0"
```

- `type`, `schema_version`, `title`, `tags` and `updated` are dropped.
  `x-owner-note: keep this key` is dropped (OS-I-6Q3D2).
- Engine fields (`version`, `priority`, `assignee`, `dueDate`, `completedAt`,
  `labels`, `attachments`, `order`) and `modified` are added outside `x-`.
- Quoting changes, the trailing newline is removed, and a blank line is added
  after the frontmatter.
- A `.log` file per card appears in an `attachments/` folder, and
  `records/.kanban.json` holds the board and columns.
- `octosprout validate` on the result: **15 errors** (OSV001 and OSV011
  "Missing 'updated'"), against 0 before.
- Cards are still Markdown files, so there is no hidden database in the default
  mode, but a different file format and layout is canonical.

### 2. Separate boards: pass with conditions

The engine supports several boards, each with its own columns
(`columns add`). Columns matching the §7 idea statuses were created by hand and
the five defaults removed. The engine rejected `seed` and `sprouting` as
statuses until then. `edit` has no `--title`, and the list shows the first
body line ("## Motivation") as the title, not the frontmatter `title`. Tasks
and Projects boards were not set up.

### 3. External changes: pass

With `kl serve` running, a card file was edited and moved to another status
directory from outside the engine. `GET /api/tasks` showed the new status
within the 3 seconds waited. Not tested: new and deleted cards, or a `git pull`
from the `mac` clone.

### 4. Writes through the write service: not shown

Not tested, because criterion 1 had already failed. The documentation
describes a `KanbanSDK` class that the CLI, MCP server and web server all
call, before-events that can veto or alter a write, and `card.storage`
plugins resolved by npm package name. Whether these can reach
`GitWriteService.submit()` with `base_blob` was not checked. The CLI wrote
files directly.

### 5. Behind the passkey session: not shown

Not tested beyond a look at `kl serve` on 192.168.42.57:9101 (container
removed afterwards):

- No `Content-Security-Policy` header, and the page contains an inline
  `<script>`, which `default-src 'self'` would block.
- The documentation says CORS is open to all origins and does not describe
  mounting under a path or behind a proxy. Its own auth is a plugin
  (`kl-plugin-auth`).
- 375 px width on iPhone Safari was not checked.

### 6. Replaceable: fail

New cards get the engine's own IDs (`kl add` created `id: "1"`, file
`1-new-engine-idea.md`) and the engine keeps its own state (`nextCardId`,
`order`, `.log` files) in the repository. Moving files into
`boards/<board>/<status>/` also changes every path.

## Thin custom UI: assessment

No prototype was built. The reading of the code that supports ADR006:

- `GitWriteService.submit()` already takes `preconditions: [{path, baseBlob}]`
  and returns `committed`, `pending` or `unchanged`, and a `ConflictError`
  for the 409 flow. A move is one `changes` entry rewriting `status` and
  `updated` in one file.
- `app.ts` sets `Content-Security-Policy: default-src 'self'` on every
  response and authenticates routes with `requireSession`. Board routes would
  be registered next to `/api/v1/capture`, so they inherit both.
- Phase 1 pages (`server/src/ui/`) are about 27 KB of TypeScript with
  embedded CSS and scripts, and no build step.

| Approach | Build tooling | Touch drag and drop | State in the browser | Fit |
|---|---|---|---|---|
| Server-rendered pages with small scripts | none | Pointer Events written by hand, plus a "Move to…" select | rendered page and unsaved input only | **Chosen** |
| Preact or Lit | bundler, new dependency, output served from `'self'` | the same, or a library | component state | If the editor needs it |
| Full framework | largest | libraries exist | most | Over-sized for the boards |

Not tested and still open: pointer drag on iPhone Safari, the bundle sizes,
and how the page tells the user about a conflict on a card that moved while
they were looking at the board.

## Teardown

See the pull request description.
