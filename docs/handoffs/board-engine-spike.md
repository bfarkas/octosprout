# Handoff: board engine spike (D5)

**For:** an agent with shell access to rei3 and to this repository.
**Owner:** bfarkas. Ask the owner whenever this brief says *ask*, or when
something here turns out to be wrong.
**Timebox:** two working days. If the evaluation cannot finish in that time,
stop and report what you have.

## Goal

Decide how OctoSprout shows its Ideas, Tasks and Projects boards (spec decision
D5, the last open Phase 0 item), and record the decision as an ADR:

- **Option A: Kanban Lite.** Evaluate it against the six criteria in spec
  §12.1. The first criterion it fails eliminates it.
- **Option B: a thin custom UI** built on `@octosprout/core` and the existing
  server. If this wins, the ADR also picks the frontend approach.

You evaluate and write the ADR. You do **not** build the Phase 2 boards.

## Read first

1. [`docs/spec/implementation-spec-v0.4-draft.md`](../spec/implementation-spec-v0.4-draft.md):
   §2 (principles), §6 (record model), §7 (lifecycles: board columns are
   statuses), §8 (the write service, `base_blob`), §12 (UI, especially §12.1),
   Appendix A (record examples).
2. [`docs/adr/`](../adr/README.md): ADR001–ADR005, particularly ADR002
   (Fastify, server-rendered pages, D5 open).
3. `app/packages/server/src/git/write-service.ts`: every write must go through
   `GitWriteService.submit()`, with `preconditions` carrying the `base_blob`
   the client read.
4. `app/packages/server/src/http/app.ts` and `src/auth/routes.ts`: how routes
   are authenticated (passkey session, Origin and CSRF checks) and the CSP
   (`default-src 'self'`, so no inline scripts or styles).

## Step 0: identify "Kanban Lite"

The spec names Kanban Lite without a link. Find the project it most likely
means: a Kanban board that keeps cards as Markdown files with frontmatter. If
there is more than one plausible candidate, list them (name, URL, licence,
last release, how it stores cards) and **ask** the owner which one to evaluate
before going further. Do not evaluate a guess.

## Ground rules on rei3

Production runs there. Do not disturb it.

| Production thing | Where | Rule |
|---|---|---|
| The `octosprout` container | Compose file `/srv/octosprout/compose.yaml` | Do not stop, restart, rebuild or reconfigure it. |
| Its volumes (`octosprout-repo`, `octosprout-state`) | Docker volumes | Do not read from or write to them. |
| Secrets | `/etc/octosprout/secrets/` | Do not read them. You need none. |
| Caddy | Host, global `acme_dns` (Hetzner DNS-01) | Do not change its configuration. |
| `bfarkas/octosprout-private` | GitHub | Never point anything at it, never push to it. |

Work like this instead:

- Put everything in `/srv/octosprout-spike/` and use a separate Compose
  project name (`-p octosprout-spike`).
- Publish ports on `127.0.0.1` only, and reach them through an SSH tunnel
  (`ssh -L 9000:127.0.0.1:9000 rei3`). Nothing from the spike is exposed to
  the internet, so it needs no TLS or DNS.
- Use a throwaway workspace (below), not real data.
- When you finish, remove the spike's containers, images, volumes and
  directory, and say so in your report.

**Ask** the owner for: an SSH login on rei3 with Docker access, and whether you
may create a private GitHub repository for the test workspace or should use a
local bare repository on rei3 (the default; it is enough for every test here).

## Step 1: a test workspace

```sh
git clone https://github.com/bfarkas/octosprout /srv/octosprout-spike/octosprout
cd /srv/octosprout-spike/octosprout/app && pnpm install && pnpm build
CLI="node /srv/octosprout-spike/octosprout/app/packages/cli/dist/index.js"

git init --bare -b main /srv/octosprout-spike/remote.git
git clone /srv/octosprout-spike/remote.git /srv/octosprout-spike/workspace
cd /srv/octosprout-spike/workspace && $CLI init .
```

Add fixture records by hand, following Appendix A and §6–§7, enough to fill
the boards:

- 6 ideas across `seed`, `sprouting`, `ready`, `dormant` and `composted`;
- 2 projects (`proposed`, `active`);
- 10 tasks across `backlog`, `ready`, `in_progress`, `blocked`, `done`, some
  with `belongs_to` a project and a few `blocks` links;
- a few `x-` keys on some records, to check they survive.

Use random IDs (`OS-I-…`, `OS-T-…`, `OS-P-…`, Crockford Base32, §6.1) and
filenames `<ID>--<slug>.md`. Run `$CLI validate` and fix every error. Only
captures have a JSON schema so far, so ideas, tasks and projects produce one
warning each; that is expected. Commit and push. Keep a second clone
(`/srv/octosprout-spike/mac`) to play the Mac.

## Step 2: evaluate Kanban Lite against §12.1

Run it in a container against a clone of the test workspace. For each
criterion, do the test, keep the evidence (commands, diffs, timings,
screenshots if useful), and note *pass*, *fail* or *pass with conditions*.
§12.1 says the first failure eliminates it; still note what you saw for the
criteria you could check, briefly.

1. **Markdown stays canonical.** Move cards between columns, edit a card,
   create one. Then `git diff`: only the fields the action implies may change
   (`status`, `updated`, the edited text), unknown `x-` keys and key order must
   survive, engine metadata may appear only under `x-` keys, and `$CLI
   validate` must not report new errors. Check whether the engine keeps a
   database, index or cache that becomes the real store.
2. **Separate boards.** Ideas, Tasks and Projects as independent boards, with
   columns that are exactly the statuses in §7 (Decisions use upper-case
   statuses, though they are a list rather than a board).
3. **External changes.** Push a change from the `mac` clone, pull it into the
   engine's clone, and observe whether and how fast the board shows it without
   a restart. Try an edited card, a new card and a deleted card.
4. **Writes through the write service.** Find out whether the engine's writes
   can be routed to `GitWriteService.submit()` with `base_blob` preconditions:
   an API to intercept, a storage adapter or plugin, or using it as a library.
   An engine that writes files itself and commits later fails this criterion.
5. **Behind OctoSprout's passkey session.** Can it be served by, or behind,
   `octosprout-server`, with no login of its own, under the CSP
   `default-src 'self'` and at 375 px width on iPhone Safari?
6. **Replaceable.** IDs and links stay OctoSprout's: the engine must not
   rename files, renumber, or store relationships of its own.

Record the version you tested, its licence (it must be compatible with
publishing OctoSprout's code), and how actively it is maintained.

## Step 3: assess the thin custom UI

Do this whether or not Kanban Lite passed, so the ADR compares two real
options. No full build; a sketch and, if it settles a question, a throwaway
prototype of one board.

- Board columns come from §7; cards come from the in-memory index (§4.2); a
  move is a `set_status` write through the write service with `base_blob`.
- Constraints: CSP `default-src 'self'` (no inline script or style), works at
  375 px, no hidden state outside Git, the 409 three-way flow of §8.4, and
  consequential moves open the confirmation dialog (§9.2).
- Compare two or three frontend approaches against those constraints, for
  example: server-rendered pages with small scripts (what Phase 1 uses), a
  small library such as Preact or Lit, or a full framework. Weigh build
  tooling, drag-and-drop on touch screens, bundle size and how much state
  lives in the browser.

## Deliverables

On a branch, opened as a pull request against `main` (not pushed to `main`):

1. `docs/adr/0006-board-engine-and-frontend.md`, in the vendored template's
   format like ADR001–ADR005, with status `PROPOSED`. Options: Kanban Lite and
   the custom UI (with the chosen frontend approach), each with
   `Adopted/Rejected because/despite` consequences drawn from your evidence.
   The owner accepts it.
2. `docs/handoffs/board-engine-spike-results.md`: what you tested, how, and
   what happened, per criterion, with versions and dates.
3. An updated row in [`docs/adr/README.md`](../adr/README.md).

In the pull request description, list anything you had to assume, anything you
could not test, and confirm the spike was torn down on rei3.

## Out of scope

- Building the Phase 2 boards, schemas or proposals.
- Adding dependencies to `app/`.
- Any change to production on rei3 or to `octosprout-private`.
