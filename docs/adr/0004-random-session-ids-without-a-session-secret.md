# ADR004 - Random session IDs, without a session secret
* Date: Oct 26, 2026
* Status: ADOPTED
* Author: bfarkas (drafted with Claude Code)

## Decision
A browser session is a random 256-bit ID in a `__Host-octosprout_session`
cookie (Secure, HttpOnly, SameSite=Strict). The server stores only the SHA-256
of the ID, with a per-session CSRF token, in the state directory. There is no
`session_secret`, and the Docker secret of that name in spec v0.3 §18.1 is
dropped.

## Context
Spec v0.3 lists a `session_secret` Docker secret, which would be needed to sign
cookies that carry session data. OctoSprout's sessions are server-side
(§18.2), so the cookie only needs to be an unguessable reference.

## Options Considered
### Option 1 (SELECTED): Opaque random IDs, hashed at rest
#### Consequences
 * Adopted because: nothing to sign means one fewer secret to create, store and rotate.
 * Adopted because: a leaked sessions file does not reveal usable cookies.
 * Adopted despite: every request looks the session up on the server, which is trivial for a single user.

### Option 2: Signed cookies keyed by `session_secret`
#### Consequences
 * Rejected because: signing adds nothing when all session state is on the server anyway.

## Advice
 * None recorded.

## Supporting Material
 * [app/packages/server/src/auth/sessions.ts](../../app/packages/server/src/auth/sessions.ts)
