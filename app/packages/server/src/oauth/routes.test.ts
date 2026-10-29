import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildNewRecord } from "@octosprout/core";

import { PasskeyStore } from "../auth/passkeys.js";
import { SessionStore } from "../auth/sessions.js";
import { FakeAuthenticator } from "../auth/fake-authenticator.js";
import { GitWriteService } from "../git/write-service.js";
import { git, Sandbox } from "../git/test-helpers.js";
import { InboxService } from "../inbox/service.js";
import { ServerMcpBackend } from "../mcp/backend.js";
import { ProposalService } from "../records/proposals.js";
import { WorkspaceRecords } from "../records/workspace.js";
import { buildApp } from "../http/app.js";
import { RateLimiter } from "../http/rate-limit.js";
import { TokenStore } from "../http/tokens.js";
import { OAuthStore } from "./store.js";

const ORIGIN = "https://app.example.test";
const RP_ID = "example.test";
const SETUP_TOKEN = "oauth-test-setup-token";
let sandbox: Sandbox;
let state: string;
let app: ReturnType<typeof buildApp>;
let passkeys: PasskeyStore;

beforeEach(async () => {
  sandbox = await Sandbox.create(); state = mkdtempSync(join(tmpdir(), "octosprout-oauth-"));
  const writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
  const records = new WorkspaceRecords(sandbox.server);
  const recordDeps = { records, writer: { ...records.indexing(writer), readBlob: (sha: string) => writer.readBlob(sha), history: (path: string, limit?: number) => writer.history(path, limit) } };
  const proposals = new ProposalService({ ...recordDeps, head: async () => (await writer.status()).head });
  passkeys = new PasskeyStore(state);
  const oauth = new OAuthStore(state);
  app = buildApp({
    inbox: new InboxService({ writer, repoDir: sandbox.server }), tokens: new TokenStore(state), rateLimiter: new RateLimiter({ capacity: 100, perMinute: 100 }),
    auth: { passkeys, sessions: new SessionStore(state), rpId: RP_ID, origin: ORIGIN, setupToken: SETUP_TOKEN, status: () => writer.status() },
    remoteMcp: { origin: ORIGIN, backend: new ServerMcpBackend(records, proposals), authenticateBearer: (request) => { const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1]; const verified = token ? oauth.verifyAccess(token, `${ORIGIN}/mcp`) : undefined; return verified ? { actor: `agent:${verified.client.name}` } : undefined; }, oauth: { origin: ORIGIN, rpId: RP_ID, passkeys, store: oauth, rateLimiter: new RateLimiter({ capacity: 100, perMinute: 100 }) } },
  });
  await app.ready();
});
afterEach(async () => { await app.close(); sandbox.dispose(); rmSync(state, { recursive: true, force: true }); });

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, headers: { "content-type": "application/json", ...headers }, payload: JSON.stringify(body) });

describe("OAuth discovery and dynamic registration", () => {
  it("advertises the MCP resource and accepts only allowlisted public clients", async () => {
    expect((await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource/mcp" })).json()).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], scopes_supported: ["workspace"] });
    expect((await post("/oauth/register", { client_name: "Claude", redirect_uris: ["https://evil.example/callback"] })).statusCode).toBe(400);
    const registered = await post("/oauth/register", { client_name: "Claude / Desktop", token_endpoint_auth_method: "none", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(registered.statusCode).toBe(201); expect(registered.json()).toMatchObject({ client_name: "Claude-Desktop" });
  });

  it("rejects malformed authorization requests and challenges unauthenticated MCP", async () => {
    const client = (await post("/oauth/register", { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })).json() as { client_id: string };
    const authorize = await app.inject({ method: "GET", url: `/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&response_type=code&code_challenge=x&code_challenge_method=S256&resource=${encodeURIComponent(`${ORIGIN}/mcp`)}` });
    expect(authorize.statusCode).toBe(200);
    expect(authorize.body).toContain("Connect Claude?");
    const wrongResource = await app.inject({ method: "GET", url: `/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&response_type=code&code_challenge=x&code_challenge_method=S256&resource=https%3A%2F%2Fevil.example%2Fmcp` });
    expect(wrongResource.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(401);
  });

  it("uses a passkey assertion for a PKCE code and rotates refresh tokens", async () => {
    const authenticator = new FakeAuthenticator(RP_ID, ORIGIN);
    const registerOptions = await post("/api/v1/auth/register/options", { setup_token: SETUP_TOKEN }, { origin: ORIGIN });
    await post("/api/v1/auth/register/verify", { setup_token: SETUP_TOKEN, response: authenticator.create(registerOptions.json() as { challenge: string }) }, { origin: ORIGIN });
    const client = (await post("/oauth/register", { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })).json() as { client_id: string };
    const verifier = "a-very-long-pkce-verifier-that-is-safe-for-the-test-suite-0123456789";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorization = await app.inject({ method: "GET", url: `/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent("https://claude.ai/api/mcp/auth_callback")}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(`${ORIGIN}/mcp`)}&scope=workspace%20offline_access&state=state` });
    const pending = /data-pending="([^"]+)"/.exec(authorization.body)?.[1];
    expect(pending).toBeTruthy();
    const assertionOptions = await post("/oauth/consent/options", { pending }, { origin: ORIGIN });
    const approved = await post("/oauth/consent/approve", { pending, response: authenticator.get(assertionOptions.json() as { challenge: string }) }, { origin: ORIGIN });
    expect(approved.statusCode).toBe(200);
    const code = new URL((approved.json() as { redirect: string }).redirect).searchParams.get("code")!;
    const exchanged = await post("/oauth/token", { grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: verifier, resource: `${ORIGIN}/mcp` });
    expect(exchanged.statusCode).toBe(200);
    const tokens = exchanged.json() as { access_token: string; refresh_token: string };
    expect((await app.inject({ method: "GET", url: "/mcp", headers: { authorization: `Bearer ${tokens.access_token}` } })).statusCode).not.toBe(401);
    const initialized = await app.inject({ method: "POST", url: "/mcp", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Claude Test", version: "1" } } }) });
    expect(initialized.statusCode).toBe(200);
    const tools = await app.inject({ method: "POST", url: "/mcp", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, payload: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
    expect(tools.statusCode).toBe(200);
    expect(tools.body).toContain("search_records");
    const draft = buildNewRecord({ type: "idea", id: "OS-I-ABCDE", title: "Remote proposal", now: "2026-10-29T00:00:00Z" });
    const proposal = await app.inject({ method: "POST", url: "/mcp", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, payload: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "propose", arguments: { title: "Remote proposal", rationale: "Test remote MCP attribution.", operations: [{ op: "create", path: draft.path, content: draft.content }] } } }) });
    expect(proposal.statusCode).toBe(200);
    expect(proposal.body).toContain("proposed");
    expect(await git(sandbox.server, "log", "-1", "--format=%B")).toContain("OctoSprout-Actor: agent:Claude");
    const rotated = await post("/oauth/token", { grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token });
    expect(rotated.statusCode).toBe(200);
    expect((await post("/oauth/token", { grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/mcp", headers: { authorization: `Bearer ${tokens.access_token}` } })).statusCode).toBe(401);
  });
});
