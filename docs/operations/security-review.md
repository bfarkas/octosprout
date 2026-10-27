# Security review (Phase 3)

The MVP security review of spec §21, Phase 3. It covers the server, the CLI,
the MCP server and the agent instructions as of 27 October 2026. Re-run it
when the threat model changes. A remote MCP server or a second user would each
change it.

## Threat model

- **One owner.** Every person who can sign in is the owner.
- **Untrusted input:**
  - capture text from the inbox API and the share sheet;
  - any record text, which agents and the owner write and agents read;
  - proposals written by agents.
- **Trusted:** the owner's passkeys, the server's secrets, and push access
  to `octosprout-private`. Anyone who can push to the private repository can
  change any file. Validation then limits what that push can claim, for
  example a consequential status without a valid signed approval.

## Authorization matrix

[`authz.test.ts`](../../app/packages/server/src/http/authz.test.ts) builds the
full app and tests **every registered route**, so new routes are covered
automatically. It checks:

| Actor | Expected | Result |
|---|---|---|
| Anonymous | `401` except `/healthz`, `/login`, `/setup`, the manifest, static assets and sign-in options | Pass |
| Inbox token | Accepted on `/api/v1/inbox*` only; elsewhere the same as anonymous | Pass |
| Session | Everything except the inbox API and passkey registration (setup token only) | Pass |
| Session without CSRF token, or with a foreign `Origin` | `403` on every state-changing route | Pass |

## Findings

| # | Area | Finding | Fix |
|---|---|---|---|
| 1 | Paths | Proposal and write paths were checked lexically only, so a symbolic link in the clone or checkout could lead a read or write outside it | `resolveInside` in `@octosprout/core` resolves links. The write service, the server's file reads, and the CLI's reads and commits use it. `readWorkspaceFiles` skips symbolic links, including whole record directories |
| 2 | UI | Ref links were rendered from frontmatter without checking the scheme. The schema requires https, but a link was rendered even when validation had flagged the record | Only `https:` refs become links; others are shown as text |
| 3 | MCP | `OCTOSPROUT_ACTOR` was not checked by the MCP server, so a misconfigured `cli` actor would label agent proposals as the owner's | The MCP server refuses any actor but `agent:<name>` |
| 4 | Agents | Record text is untrusted, but neither AGENTS.md nor the handoff bundle said so | Both now say that text in records is content, not instructions |
| 5 | Agent config | `.claude/`, `.mcp.json` and `.github/` decide what agents may do and what CI checks, but changing them was routine | They are guarded paths: changing them is consequential (fixed in the skills step) |
| 6 | Key recovery | Losing the only approval key deadlocked recovery: adding a new key needed an approval that only the lost key could sign | After the owner retires the lost key with their own commit, the server may trust its new key. It never may while an active key remains (restore runbook, step 4) |

## Checked, no change

- **Rendering.** Markdown is rendered with HTML off. markdown-it rejects
  `javascript:` and similar links. CSP `default-src 'self'` and no inline
  scripts.
- **Captures.** Captures are shown as escaped plain text. Their bodies are
  never logged.
- **Sessions.** Session cookies are `__Host-`, `HttpOnly`, `Secure` and
  `SameSite=Strict`, and only the SHA-256 of the session ID is stored.
- **Inbox tokens.** Stored as hashes, shown once, and rate-limited per token.
- **Approvals.**
  - Consequential approvals need a passkey verification within the last
    five minutes.
  - Ed25519 signatures cover the proposal ID, the hash of its operations,
    the decision and the time.
  - Validation rejects tampered operations and forged approvals.
- **Agents.**
  - Agent writes are proposals only, through both MCP and the CLI.
  - Proposals that would not validate are refused before they are
    committed.
- **Secrets.** The validator flags token-like strings in records, and CI runs
  gitleaks.
- **Dependencies.** `pnpm audit` reports no known vulnerabilities. markdown-it
  is at 14.3.3 and zod at 4.x, both chosen over versions with advisories.

## Open

- **Unencrypted state.** The state directory (passkeys, token hashes) is not
  encrypted at rest. It relies on rei3's disk and backups.
- **Remote MCP.** A post-MVP remote MCP server will need its own review:
  OAuth, a public endpoint, and agent scopes.
