import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signingKeyFrom } from "../approvals/signing-key.js";
import { PasskeyStore } from "../auth/passkeys.js";
import { SessionStore } from "../auth/sessions.js";
import { Sandbox } from "../git/test-helpers.js";
import { GitWriteService } from "../git/write-service.js";
import { CiStatus } from "../health/ci.js";
import { HealthService } from "../health/health.js";
import { InboxService } from "../inbox/service.js";
import { ProposalService } from "../records/proposals.js";
import { WorkspaceRecords } from "../records/workspace.js";
import { buildApp } from "./app.js";
import { RateLimiter } from "./rate-limit.js";
import { signIn, TEST_ORIGIN, TEST_RP_ID, TEST_SETUP_TOKEN } from "./test-session.js";
import { TokenStore } from "./tokens.js";

let sandbox: Sandbox;
let stateDir: string;
let app: FastifyInstance;
const routes: Array<{ method: string; url: string }> = [];

beforeAll(async () => {
  sandbox = await Sandbox.create();
  stateDir = mkdtempSync(join(tmpdir(), "octosprout-authz-"));
  const writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
  const records = new WorkspaceRecords(sandbox.server);
  const deps = { records, writer: { ...records.indexing(writer), readBlob: (sha: string) => writer.readBlob(sha), history: (path: string, limit?: number) => writer.history(path, limit) } };
  app = buildApp({
    inbox: new InboxService({ writer, repoDir: sandbox.server }),
    tokens: new TokenStore(stateDir),
    auth: { passkeys: new PasskeyStore(stateDir), sessions: new SessionStore(stateDir), rpId: TEST_RP_ID, origin: TEST_ORIGIN, setupToken: TEST_SETUP_TOKEN, status: () => writer.status() },
    records: { ...deps, proposals: new ProposalService({ ...deps, signingKey: signingKeyFrom(generateKeyPairSync("ed25519").privateKey), head: async () => (await writer.status()).head }) },
    // Room for every inbox route in one test; the limiter has tests of its own.
    rateLimiter: new RateLimiter({ capacity: 1000, perMinute: 1000 }),
    health: new HealthService({ repoDir: sandbox.server, status: () => writer.status(), ci: new CiStatus({}) }),
    onRoute: ({ method, url }) => {
      for (const m of [method].flat()) routes.push({ method: m, url });
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  sandbox.dispose();
  rmSync(stateDir, { recursive: true, force: true });
});

let session: { cookie: string; csrf: string };
let token: string;
let ip = 0;

const PARAMS: Record<string, string> = { board: "ideas", type: "idea", id: "OS-I-ZZZZZ", name: "nobody", key: "abcdefgh" };
const materialize = (url: string) => url.replace(/:(\w+)/g, (_, name: string) => PARAMS[name] ?? "x");
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function hit(route: { method: string; url: string }, as: "anonymous" | "token" | "session", options: { csrf?: boolean; origin?: string } = {}): Promise<number> {
  return (await request(route, as, options)).statusCode;
}

async function request(route: { method: string; url: string }, as: "anonymous" | "token" | "session", options: { csrf?: boolean; origin?: string } = {}) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (MUTATING.has(route.method)) {
    headers["content-type"] = "application/json";
    headers.origin = options.origin ?? TEST_ORIGIN;
  }
  if (as === "token") headers.authorization = `Bearer ${token}`;
  if (as === "session") {
    headers.cookie = session.cookie;
    if (options.csrf !== false) headers["x-csrf-token"] = session.csrf;
  }
  // A fresh address per request keeps the per-IP sign-in limit out of the matrix.
  ip++;
  return app.inject({ method: route.method as "GET", url: materialize(route.url), headers, remoteAddress: `10.0.${Math.floor(ip / 250)}.${ip % 250}`, ...(MUTATING.has(route.method) ? { payload: "{}" } : {}) });
}

/** Reachable without signing in: sign-in itself, the health check and static assets (spec §18.2). */
const PUBLIC = (r: { method: string; url: string }) =>
  (r.method === "GET" && (["/healthz", "/login", "/setup", "/manifest.webmanifest", "/favicon.ico"].includes(r.url) || r.url.startsWith("/static/"))) ||
  (r.method === "POST" && r.url === "/api/v1/auth/login/options");
/** Sign-in endpoints: they authenticate the request themselves, so a session neither helps nor is needed. */
const SIGN_IN = (r: { url: string }) => r.url.startsWith("/api/v1/auth/login/");
/** Passkey registration needs the setup token, even with a session. */
const SETUP_ONLY = (r: { url: string }) => r.url.startsWith("/api/v1/auth/register/");
const INBOX = (r: { url: string }) => r.url === "/api/v1/inbox" || r.url.startsWith("/api/v1/inbox/");
const LOGOUT = (r: { url: string }) => r.url === "/api/v1/auth/logout";

describe("the authorization matrix (spec §18.2), over every registered route", () => {
  beforeAll(async () => {
    session = await signIn(app);
    const created = await app.inject({ method: "POST", url: "/api/v1/tokens", headers: { cookie: session.cookie, "x-csrf-token": session.csrf, origin: TEST_ORIGIN, "content-type": "application/json" }, payload: JSON.stringify({ name: "matrix" }) });
    token = (created.json() as { token: string }).token;
  });

  it("covers the whole app", () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(routes.filter(LOGOUT)).toHaveLength(1);
  });

  it("answers 401 to anonymous requests except on the public routes", async () => {
    const open: string[] = [];
    for (const route of routes) if ((await hit(route, "anonymous")) !== 401) open.push(`${route.method} ${route.url}`);
    expect(open.sort()).toEqual(routes.filter(PUBLIC).map((r) => `${r.method} ${r.url}`).sort());
  });

  it("accepts an inbox token on the inbox routes only, and it adds nothing anywhere else", async () => {
    for (const route of routes) {
      const [anonymous, withToken] = [await hit(route, "anonymous"), await hit(route, "token")];
      if (INBOX(route)) expect(withToken, `${route.method} ${route.url}`).not.toBe(401);
      else expect(withToken, `${route.method} ${route.url}`).toBe(anonymous);
    }
  });

  it("lets a session do everything except the inbox API and passkey registration", async () => {
    for (const route of routes.filter((r) => !LOGOUT(r) && !SIGN_IN(r))) {
      const response = await request(route, "session");
      // A 401 for the session itself says "unauthorized"; re-verification's 401 is for the empty passkey assertion.
      const refused = response.statusCode === 401 && (response.json() as { error?: string }).error !== "reverify_failed";
      expect(refused, `${route.method} ${route.url}: ${response.statusCode} ${response.body}`).toBe(INBOX(route) || SETUP_ONLY(route));
    }
  });

  it("needs the CSRF token and the exact Origin for every state change a session makes", async () => {
    // Logout goes last: it ends the session.
    const changes = routes.filter((r) => MUTATING.has(r.method) && !INBOX(r) && !SIGN_IN(r) && !SETUP_ONLY(r)).sort((a, b) => Number(LOGOUT(a)) - Number(LOGOUT(b)));
    expect(changes.length).toBeGreaterThan(15);
    for (const route of changes) {
      expect(await hit(route, "session", { csrf: false }), `${route.method} ${route.url} without CSRF`).toBe(403);
      expect(await hit(route, "session", { origin: "https://evil.example" }), `${route.method} ${route.url} from another origin`).toBe(403);
    }
    expect(await hit(changes[changes.length - 1]!, "session")).toBe(200);
    expect(await hit({ method: "GET", url: "/api/v1/session" }, "session")).toBe(401);
  });
});
