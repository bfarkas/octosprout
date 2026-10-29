# ADR007 - Remote MCP on app.octosprout.de, with OctoSprout as its own OAuth server
* Date: Oct 29, 2026
* Status: ACCEPTED
* Author: bfarkas (drafted with Claude Code)

## Decision
`octosprout-server` serves the existing MCP tools at `https://app.octosprout.de/mcp`
over Streamable HTTP. It is its own OAuth 2.1 authorization server, and a passkey
assertion on a consent page grants each connection.

**Tools.** Remote MCP offers the same tool set as `octosprout mcp`, with the same rule:
read tools read, and write tools only create proposals, which you approve in the
browser. The tool definitions move behind a small backend interface:
- the CLI backend is the current `Workspace` over the Mac checkout;
- the server backend reads `WorkspaceRecords` and commits proposals through `GitWriteService`, under its lock and journal.

`sync` is a no-op on the server, because every write pushes.

**Transport.** Streamable HTTP in stateless mode: a fresh `McpServer` handles each
request, and there are no server-initiated messages. Fastify hands the raw request to
the SDK transport.

**OAuth (MCP authorization spec 2025-11-25).**
- **Discovery:**
  - Protected Resource Metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`.
  - The resource is `https://app.octosprout.de/mcp`, with one scope, `workspace`.
  - Authorization Server Metadata at `/.well-known/oauth-authorization-server`, advertising `S256` only, `offline_access` and a registration endpoint.
  - A `401` from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata=…, scope="workspace"`.
- **Registration:**
  - Dynamic Client Registration (RFC 7591) only, rate-limited, for public clients (`token_endpoint_auth_method: none`).
  - A registration is refused unless every `redirect_uri` is on a fixed allowlist: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, and loopback `http://localhost/…` or `http://127.0.0.1/…` (port ignored), for Claude Code.
  - Client ID Metadata Documents are not advertised. Clients that support CIMD fall back to DCR.
- **Consent:**
  - `/oauth/authorize` checks the request: known client, exact `redirect_uri`, PKCE S256, `resource` equal to the MCP URL, and scope.
  - It stores the request for 10 minutes and shows a consent page with the client's name and the redirect host. Loopback redirects get a warning.
  - Approving takes a passkey assertion on that page. The session cookie is not used, because it is `SameSite=Strict` and is not sent on the cross-site navigation from claude.ai.
  - The code is single-use and lives for 60 seconds.
- **Tokens:**
  - Opaque random tokens; only their SHA-256 is stored, in the state directory, as with inbox tokens.
  - An access token lives 1 hour and is bound to the resource.
  - A refresh token lives 30 days, sliding, and rotates on every use. Reusing a rotated refresh token revokes the whole grant.
  - The token endpoint accepts form-encoded bodies and is rate-limited.
- **Revocation:** Settings lists the connected agents (client name, created, last used). Revoking one ends its grant at once.
- **Attribution:** proposals from a grant are made by `agent:<client_name>`, sanitized as in the stdio server, so Claude on the phone shows up as `agent:claude`.

## Context
Post-MVP item 2 (spec §21) makes the workspace reachable from Claude on the web,
desktop and phone. At the moment only Claude Code on the Mac reaches it, through the
stdio server (D13).

The constraints:
- Claude's hosted apps connect from Anthropic's cloud, to a public HTTPS endpoint.
- They support DCR or CIMD, and PKCE S256 is mandatory.
- They use the fixed callback `https://claude.ai/api/mcp/auth_callback`.
- They refresh tokens on a `401` and before expiry.

OctoSprout has a single user, who already has passkeys. Nothing a remote agent can
do changes records without a signed approval (§9).

## Options Considered
### Option 1 (SELECTED): Built-in authorization server, DCR with a redirect allowlist, passkey consent
#### Consequences
 * Adopted because: no third-party identity provider or extra secret; the passkey that already guards the browser guards every connection.
 * Adopted because: open DCR is safe enough here. Registering grants nothing. Codes go only to the allowlisted redirects. Each connection needs the owner's passkey.
 * Adopted because: agents still only propose, so a stolen token can read the workspace and file proposals, but cannot change records.
 * Adopted despite: the server now holds OAuth state and endpoints, which must be covered by the authorization matrix and the security review.
 * Adopted despite: a stolen token can read the whole private workspace for up to an hour, or longer with its refresh token until the owner revokes the grant.

### Option 2: Run the remote MCP server as a second clone, like the Mac
#### Consequences
 * Rejected because: it would need its own push credentials, lock and sync loop. Its reads would lag the server's index, and concurrent pushes would conflict with the write service.

### Option 3: An external identity provider (Auth0, Keycloak, Authelia)
#### Consequences
 * Rejected because: another service to run or depend on. Its login would be weaker or redundant next to the passkeys the server already verifies.

### Option 4: Static bearer tokens, like inbox tokens
#### Consequences
 * Rejected because: Claude's hosted apps support only OAuth for authenticated connectors.

### Option 5: Client ID Metadata Documents as well as DCR
#### Consequences
 * Deferred: CIMD makes the server fetch URLs supplied by the client (an SSRF surface), and DCR covers every Claude client today. Reconsider when a client needs CIMD.

## Advice
 * None recorded.

## Supporting Material
 * [MCP authorization, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
 * [Claude connector authentication](https://www.claude.com/docs/connectors/building/authentication)
 * [app/packages/cli/src/mcp.ts](../../app/packages/cli/src/mcp.ts)
 * [ADR004](0004-random-session-ids-without-a-session-secret.md): why the session cookie is SameSite=Strict
