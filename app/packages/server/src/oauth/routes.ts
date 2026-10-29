/** OAuth 2.1 discovery, DCR, consent and PKCE token exchange for remote MCP. */
import { createHash } from "node:crypto";

import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { ChallengeStore } from "../auth/challenges.js";
import type { PasskeyStore } from "../auth/passkeys.js";
import { RateLimiter } from "../http/rate-limit.js";
import { esc, page } from "../ui/html.js";
import { OAuthStore } from "./store.js";

const SCOPES = new Set(["workspace", "offline_access"]);
const b64uSha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("base64url");
const field = (body: unknown, name: string): string | undefined => typeof (body as Record<string, unknown> | null)?.[name] === "string" ? (body as Record<string, string>)[name] : undefined;
const loopback = (value: string): URL | undefined => { try { const url = new URL(value); return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1") ? url : undefined; } catch { return undefined; } };

export function allowedRedirect(uri: string): boolean {
  if (uri === "https://claude.ai/api/mcp/auth_callback" || uri === "https://claude.com/api/mcp/auth_callback") return true;
  return loopback(uri) !== undefined;
}

/** RFC 8252 loopback redirects match a registered URI even if the port changes. */
export function redirectMatches(registered: string, actual: string): boolean {
  if (registered === actual) return true;
  const a = loopback(registered); const b = loopback(actual);
  return a !== undefined && b !== undefined && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search && a.hash === b.hash;
}

function resourceMatches(value: string | undefined, resource: string): boolean {
  return value !== undefined && value.replace(/\/+$/, "") === resource.replace(/\/+$/, "");
}

function oauthError(reply: FastifyReply, error: string, description?: string, status = 400): FastifyReply {
  return reply.code(status).type("application/json; charset=utf-8").send({ error, ...(description ? { error_description: description } : {}) });
}

function consentScript(): string {
  return `(()=>{const id=document.body.dataset.pending;const post=async(u,b)=>{const r=await fetch(u,{method:"POST",headers:{"content-type":"application/json","origin":location.origin},body:JSON.stringify(b)});if(!r.ok)throw new Error("Passkey verification failed");return r.json()};document.querySelector("#approve")?.addEventListener("click",async()=>{try{const o=await post("/oauth/consent/options",{pending:id});const c=await navigator.credentials.get({publicKey:{...o,challenge:Uint8Array.from(atob(o.challenge.replace(/-/g,"+").replace(/_/g,"/")),x=>x.charCodeAt(0)),allowCredentials:o.allowCredentials?.map(x=>({...x,id:Uint8Array.from(atob(x.id.replace(/-/g,"+").replace(/_/g,"/")),y=>y.charCodeAt(0))}))}});const j=await post("/oauth/consent/approve",{pending:id,response:{id:c.id,rawId:btoa(String.fromCharCode(...new Uint8Array(c.rawId))).replace(/=/g,"").replace(/\\+/g,"-").replace(/\\//g,"_"),type:c.type,response:{clientDataJSON:btoa(String.fromCharCode(...new Uint8Array(c.response.clientDataJSON))).replace(/=/g,"").replace(/\\+/g,"-").replace(/\\//g,"_"),authenticatorData:btoa(String.fromCharCode(...new Uint8Array(c.response.authenticatorData))).replace(/=/g,"").replace(/\\+/g,"-").replace(/\\//g,"_"),signature:btoa(String.fromCharCode(...new Uint8Array(c.response.signature))).replace(/=/g,"").replace(/\\+/g,"-").replace(/\\//g,"_"),userHandle:c.response.userHandle?btoa(String.fromCharCode(...new Uint8Array(c.response.userHandle))).replace(/=/g,"").replace(/\\+/g,"-").replace(/\\//g,"_"):null},clientExtensionResults:{}}});location.assign(j.redirect)}catch(e){document.querySelector("#status").textContent=e.message}})})();`;
}

export interface OAuthRouteOptions { origin: string; rpId: string; passkeys: PasskeyStore; store: OAuthStore; rateLimiter: RateLimiter; now?: () => number }

export function registerOAuthRoutes(app: FastifyInstance, options: OAuthRouteOptions): void {
  const resource = `${options.origin}/mcp`;
  const challenges = new ChallengeStore(options.now);
  const authLimit = options.rateLimiter;
  const transports = (value: readonly string[] | undefined) => value as AuthenticatorTransportFuture[] | undefined;
  const fields = (request: FastifyRequest): Record<string, unknown> => typeof request.body === "object" && request.body !== null && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const limited = (request: FastifyRequest, reply: FastifyReply): boolean => { const limit = authLimit.take(`oauth:${request.ip}`); if (limit.allowed) return false; reply.code(429).header("Retry-After", String(limit.retryAfterSeconds)).send({ error: "rate_limited" }); return true; };

  const protectedMetadata = () => ({ resource, authorization_servers: [options.origin], scopes_supported: ["workspace"], bearer_methods_supported: ["header"] });
  app.get("/.well-known/oauth-protected-resource", async () => protectedMetadata());
  app.get("/.well-known/oauth-protected-resource/mcp", async () => protectedMetadata());
  app.get("/.well-known/oauth-authorization-server", async () => ({ issuer: options.origin, authorization_endpoint: `${options.origin}/oauth/authorize`, token_endpoint: `${options.origin}/oauth/token`, registration_endpoint: `${options.origin}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["workspace", "offline_access"] }));

  app.post("/oauth/register", async (request, reply) => {
    if (limited(request, reply)) return;
    const body = fields(request); const redirects = body.redirect_uris;
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") return oauthError(reply, "invalid_client_metadata", "Only public clients are supported.");
    if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 10 || redirects.some((x) => typeof x !== "string" || x.length > 512 || !allowedRedirect(x))) return oauthError(reply, "invalid_redirect_uri", "Every redirect URI must be allowlisted.");
    const client = options.store.register(typeof body.client_name === "string" ? body.client_name : "mcp", redirects as string[]);
    return reply.code(201).send({ client_id: client.id, client_name: client.name, redirect_uris: client.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  });

  app.get("/oauth/authorize", async (request, reply) => {
    // Each request stores a pending authorization, so anonymous callers are limited too.
    if (limited(request, reply)) return;
    const query = request.query as Record<string, string | undefined>; const client = query.client_id ? options.store.client(query.client_id) : undefined;
    const invalid = (message: string) => reply.code(400).type("text/html; charset=utf-8").send(page({ title: "Authorization request rejected", page: "oauth", body: `<h1>Authorization request rejected</h1><p>${esc(message)}</p>` }));
    if (!client || !query.redirect_uri || !client.redirectUris.some((uri) => redirectMatches(uri, query.redirect_uri!))) return invalid("The client or redirect URI is not registered.");
    if (query.response_type !== "code") return invalid("response_type must be code.");
    if (!query.code_challenge || query.code_challenge_method !== "S256") return invalid("PKCE S256 is required.");
    if (!resourceMatches(query.resource, resource)) return invalid("This authorization request is for a different resource.");
    const scope = (query.scope ?? "workspace").split(/\s+/).filter(Boolean); if (scope.length === 0 || scope.some((value) => !SCOPES.has(value)) || !scope.includes("workspace")) return invalid("The requested scope is not supported.");
    const pending = options.store.pending({ clientId: client.id, redirectUri: query.redirect_uri, ...(query.state ? { state: query.state } : {}), challenge: query.code_challenge, resource, scope });
    const warning = loopback(query.redirect_uri) ? `<p class="banner">This redirects to a local application on your device.</p>` : "";
    return reply.type("text/html; charset=utf-8").send(page({ title: "Connect agent", page: "oauth", scripts: ["oauth.js"], body: `<h1>Connect ${esc(client.name)}?</h1><p>${esc(client.name)} will be able to read this workspace and create proposals for your review.</p><p class="hint">Redirect: ${esc(new URL(query.redirect_uri).host)}</p>${warning}<div class="actions"><button id="approve" type="button">Approve with passkey</button><form method="post" action="/oauth/consent/deny"><input type="hidden" name="pending" value="${esc(pending.id)}"><button class="secondary" type="submit">Deny</button></form></div><p id="status" class="status" role="status"></p>` }).replace("<body", `<body data-pending="${esc(pending.id)}"`));
  });

  app.get("/static/oauth.js", async (_request, reply) => reply.type("text/javascript; charset=utf-8").send(consentScript()));
  app.post("/oauth/consent/options", async (request, reply) => {
    if (limited(request, reply)) return;
    if (request.headers.origin !== options.origin) return reply.code(403).send({ error: "bad_origin" });
    const pending = options.store.getPending(field(fields(request), "pending") ?? ""); if (!pending) return oauthError(reply, "invalid_request", "The authorization request expired.");
    const authentication = await generateAuthenticationOptions({ rpID: options.rpId, userVerification: "required", allowCredentials: options.passkeys.list().map((key) => ({ id: key.id, ...(key.transports ? { transports: transports(key.transports)! } : {}) })) });
    challenges.remember(`${pending.id}:${authentication.challenge}`, "login");
    return authentication;
  });
  app.post("/oauth/consent/approve", async (request, reply) => {
    if (limited(request, reply)) return;
    if (request.headers.origin !== options.origin) return reply.code(403).send({ error: "bad_origin" });
    const body = fields(request); const id = field(body, "pending") ?? ""; const response = body.response as AuthenticationResponseJSON | undefined; const key = typeof response?.id === "string" ? options.passkeys.find(response.id) : undefined;
    let assertedChallenge: string | undefined;
    try {
      const parsed = JSON.parse(Buffer.from(response?.response.clientDataJSON ?? "", "base64url").toString("utf8")) as { challenge?: unknown };
      assertedChallenge = typeof parsed.challenge === "string" ? parsed.challenge : undefined;
    } catch { /* malformed WebAuthn client data is simply an unsuccessful assertion */ }
    if (!response || !key || !assertedChallenge || !challenges.consume(`${id}:${assertedChallenge}`, "login")) return oauthError(reply, "access_denied", "Passkey verification failed.", 401);
    try {
      const verification = await verifyAuthenticationResponse({ response, expectedChallenge: () => true, expectedOrigin: options.origin, expectedRPID: options.rpId, credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")), counter: key.counter, ...(key.transports ? { transports: transports(key.transports)! } : {}) }, requireUserVerification: true });
      if (!verification.verified) return oauthError(reply, "access_denied", "Passkey verification failed.", 401);
      options.passkeys.recordUse(key.id, verification.authenticationInfo.newCounter); const pending = options.store.consumePending(id); if (!pending) return oauthError(reply, "invalid_request", "The authorization request expired."); const code = options.store.issueCode(pending); const redirect = new URL(pending.redirectUri); redirect.searchParams.set("code", code); if (pending.state) redirect.searchParams.set("state", pending.state); redirect.searchParams.set("iss", options.origin); return { redirect: redirect.toString() };
    } catch { return oauthError(reply, "access_denied", "Passkey verification failed.", 401); }
  });
  app.post("/oauth/consent/deny", async (request, reply) => {
    if (request.headers.origin !== options.origin) return reply.code(403).send({ error: "bad_origin" }); const pending = options.store.consumePending(field(fields(request), "pending") ?? ""); if (!pending) return reply.code(400).send("Authorization request expired."); const redirect = new URL(pending.redirectUri); redirect.searchParams.set("error", "access_denied"); if (pending.state) redirect.searchParams.set("state", pending.state); return reply.redirect(redirect.toString());
  });

  app.post("/oauth/token", async (request, reply) => {
    if (limited(request, reply)) return; const body = fields(request); const clientId = field(body, "client_id") ?? ""; if (!options.store.client(clientId)) return oauthError(reply.header("WWW-Authenticate", "Basic realm=oauth"), "invalid_client", undefined, 401);
    const grantType = field(body, "grant_type");
    if (grantType === "authorization_code") {
      const code = field(body, "code") ?? ""; const value = options.store.exchangeCode(code, (c) => c.clientId === clientId && !!field(body, "redirect_uri") && redirectMatches(c.redirectUri, field(body, "redirect_uri")!) && resourceMatches(field(body, "resource"), c.resource) && !!field(body, "code_verifier") && b64uSha256(field(body, "code_verifier")!) === c.challenge); if (!value) return oauthError(reply, "invalid_grant");
      const tokens = options.store.issueTokens(value.grant, value.scope.includes("offline_access")); if (!tokens) return oauthError(reply, "invalid_grant"); return { access_token: tokens.access, token_type: "Bearer", expires_in: tokens.expiresIn, ...(tokens.refresh ? { refresh_token: tokens.refresh } : {}), scope: value.scope.join(" ") };
    }
    if (grantType === "refresh_token") { const tokens = options.store.refresh(field(body, "refresh_token") ?? "", clientId); if (!tokens || tokens === "reuse") return oauthError(reply, "invalid_grant"); return { access_token: tokens.access, token_type: "Bearer", expires_in: tokens.expiresIn, ...(tokens.refresh ? { refresh_token: tokens.refresh } : {}) }; }
    return oauthError(reply, "unsupported_grant_type");
  });
}
