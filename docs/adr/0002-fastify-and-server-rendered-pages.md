# ADR002 - Fastify and server-rendered pages for the Phase 1 server
* Date: Oct 26, 2026
* Status: ADOPTED
* Author: bfarkas (drafted with Claude Code)

## Decision
`octosprout-server` uses Fastify 5 as its HTTP framework. The Phase 1 pages
(sign-in, setup, Inbox, Capture, Settings) are HTML rendered on the server from
plain template functions, with small hand-written scripts and one stylesheet
served by the app. No frontend framework is introduced. The board engine and
frontend framework for Phase 2 (spec D5) remain open and are decided by the
board engine spike.

## Context
Spec D6 fixes TypeScript on Node.js and leaves the frontend to D5, which Phase 0
was to decide. Phase 1 needed only a few simple pages before that decision. The
CSP is `default-src 'self'`, so pages cannot use inline scripts or styles. The
inbox API needs strict control over body parsing (strict UTF-8, 512 KiB limit,
authentication before the body is read).

## Options Considered
### Option 1 (SELECTED): Fastify with server-rendered HTML
#### Consequences
 * Adopted because: Fastify gives routing, encapsulated hooks (authentication before body parsing), body limits, custom content-type parsers and `inject()` for fast tests.
 * Adopted because: server-rendered pages need no build step and keep D5 open; everything user-provided goes through one escaping function.
 * Adopted despite: Phase 2 boards will likely need a client-side framework, and some Phase 1 pages may be rewritten then.

### Option 2: Node's `http` module with a hand-written router
#### Consequences
 * Rejected because: body limits, parsers, hooks and test injection would all be hand-written and need their own tests.
 * Rejected despite: no dependency.

### Option 3: Choose the frontend framework now
#### Consequences
 * Rejected because: it would pre-empt the board engine decision (D5), which may pick Kanban Lite and its own UI.

## Advice
 * None recorded.

## Supporting Material
 * [app/packages/server/src/http/app.ts](../../app/packages/server/src/http/app.ts)
 * [app/packages/server/src/ui/](../../app/packages/server/src/ui/)
