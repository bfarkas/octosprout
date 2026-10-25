import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../http/app.js";
import { RateLimiter } from "../http/rate-limit.js";
import { TokenStore } from "../http/tokens.js";
import type { InboxService } from "../inbox/service.js";
import { FakeAuthenticator } from "./fake-authenticator.js";
import { PasskeyStore } from "./passkeys.js";
import { SESSION_COOKIE, SessionStore } from "./sessions.js";

const ORIGIN = "https://app.example.test";
const RP_ID = "example.test";
const SETUP_TOKEN = "setup-token-for-tests";

let dir: string;
let app: FastifyInstance;
let passkeys: PasskeyStore;
let sessions: SessionStore;
let now: number;
/** Each public request normally arrives a little later; the rate-limit test turns this off. */
let advanceClock = true;

function build(overrides: { setupToken?: string | undefined } = { setupToken: SETUP_TOKEN }): FastifyInstance {
  const tokens = new TokenStore(dir);
  return buildApp({
    inbox: {} as InboxService,
    tokens,
    rateLimiter: new RateLimiter({ now: () => now }),
    auth: {
      passkeys,
      sessions,
      rpId: RP_ID,
      origin: ORIGIN,
      ...(overrides.setupToken ? { setupToken: overrides.setupToken } : {}),
      now: () => now,
      status: () => Promise.resolve({ head: "abc123", pending: 2, pendingBranches: [] }),
    },
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "octosprout-authroutes-"));
  now = Date.parse("2026-10-25T12:00:00Z");
  advanceClock = true;
  passkeys = new PasskeyStore(dir);
  sessions = new SessionStore(dir, () => now);
  app = build();
  await app.ready();
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const json = (response: LightMyRequestResponse) => response.json() as Record<string, any>;
const publicPost = (url: string, payload: unknown, headers: Record<string, string> = {}) => {
  if (advanceClock) now += 20_000;
  return app.inject({ method: "POST", url, headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, payload: JSON.stringify(payload) });
};
const cookieOf = (response: LightMyRequestResponse): string => {
  const header = [response.headers["set-cookie"]].flat()[0] as string;
  return header.split(";")[0]!;
};

async function register(authenticator: FastifyAuthenticator, name = "iPhone"): Promise<LightMyRequestResponse> {
  const options = json(await publicPost("/api/v1/auth/register/options", { setup_token: SETUP_TOKEN, name }));
  return publicPost("/api/v1/auth/register/verify", { setup_token: SETUP_TOKEN, name, response: authenticator.create(options as { challenge: string }) });
}
type FastifyAuthenticator = FakeAuthenticator;

async function login(authenticator: FakeAuthenticator): Promise<LightMyRequestResponse> {
  const options = json(await publicPost("/api/v1/auth/login/options", {}));
  return publicPost("/api/v1/auth/login/verify", { response: authenticator.get(options as { challenge: string }) });
}

describe("pages and assets", () => {
  it("serves the login and setup pages and assets without a session", async () => {
    for (const [url, type] of [
      ["/login", "text/html"],
      ["/setup", "text/html"],
      ["/static/app.css", "text/css"],
      ["/static/auth.js", "text/javascript"],
      ["/static/app.js", "text/javascript"],
    ] as const) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-type"], url).toContain(type);
    }
  });

  it("uses no inline scripts or styles, which the CSP forbids", async () => {
    for (const url of ["/login", "/setup"]) {
      const html = (await app.inject({ method: "GET", url })).body;
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toMatch(/\son\w+=/);
    }
  });

  it("disables /setup when no setup token is configured", async () => {
    const disabled = build({ setupToken: undefined });
    expect((await disabled.inject({ method: "GET", url: "/setup" })).statusCode).toBe(401);
    expect((await disabled.inject({ method: "POST", url: "/api/v1/auth/register/options", headers: { origin: ORIGIN, "content-type": "application/json" }, payload: "{}" })).statusCode).toBe(401);
    await disabled.close();
  });
});

describe("registration", () => {
  it("registers a passkey with the setup token and signs the user in", async () => {
    const authenticator = new FakeAuthenticator(RP_ID, ORIGIN);
    const response = await register(authenticator);
    expect(response.statusCode, response.body).toBe(200);
    expect(json(response)).toMatchObject({ ok: true, csrf: expect.any(String) });

    const cookie = response.headers["set-cookie"] as string;
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    expect(passkeys.list()).toEqual([expect.objectContaining({ id: authenticator.id, name: "iPhone", counter: 0 })]);
    const session = await app.inject({ method: "GET", url: "/api/v1/session", headers: { cookie: cookieOf(response) } });
    expect(session.statusCode).toBe(200);
    expect(json(session).passkeys).toEqual([expect.objectContaining({ name: "iPhone" })]);
  });

  it("registers several passkeys, and excludes existing ones from new registrations", async () => {
    await register(new FakeAuthenticator(RP_ID, ORIGIN), "iPhone");
    await register(new FakeAuthenticator(RP_ID, ORIGIN), "Mac");
    expect(passkeys.list().map((p) => p.name)).toEqual(["iPhone", "Mac"]);
    const options = json(await publicPost("/api/v1/auth/register/options", { setup_token: SETUP_TOKEN }));
    expect(options.excludeCredentials).toHaveLength(2);
  });

  it("requires the setup token for both steps", async () => {
    expect((await publicPost("/api/v1/auth/register/options", {})).statusCode).toBe(401);
    expect((await publicPost("/api/v1/auth/register/options", { setup_token: "wrong" })).statusCode).toBe(401);

    const options = json(await publicPost("/api/v1/auth/register/options", { setup_token: SETUP_TOKEN }));
    const response = new FakeAuthenticator(RP_ID, ORIGIN).create(options as { challenge: string });
    expect((await publicPost("/api/v1/auth/register/verify", { setup_token: "wrong", response })).statusCode).toBe(401);
    expect(passkeys.list()).toEqual([]);
  });

  it("rejects a credential created for another origin, and a replayed registration", async () => {
    const options = json(await publicPost("/api/v1/auth/register/options", { setup_token: SETUP_TOKEN }));
    const phisher = new FakeAuthenticator(RP_ID, ORIGIN).create(options as { challenge: string }, { origin: "https://evil.example" });
    expect((await publicPost("/api/v1/auth/register/verify", { setup_token: SETUP_TOKEN, response: phisher })).statusCode).toBe(400);

    // The failed attempt consumed the challenge, so even a correct response to it is refused.
    const honest = new FakeAuthenticator(RP_ID, ORIGIN).create(options as { challenge: string });
    expect((await publicPost("/api/v1/auth/register/verify", { setup_token: SETUP_TOKEN, response: honest })).statusCode).toBe(400);
    expect(passkeys.list()).toEqual([]);
  });

  it("refuses a registration for a challenge the server never issued", async () => {
    const forged = new FakeAuthenticator(RP_ID, ORIGIN).create({ challenge: Buffer.from("not issued by us").toString("base64url") });
    expect((await publicPost("/api/v1/auth/register/verify", { setup_token: SETUP_TOKEN, response: forged })).statusCode).toBe(400);
  });
});

describe("login", () => {
  it("signs in with a registered passkey and records its counter", async () => {
    const authenticator = new FakeAuthenticator(RP_ID, ORIGIN);
    await register(authenticator);

    const response = await login(authenticator);
    expect(response.statusCode, response.body).toBe(200);
    expect(passkeys.find(authenticator.id)).toMatchObject({ counter: 1, lastUsed: expect.any(String) });
    const status = await app.inject({ method: "GET", url: "/api/v1/status", headers: { cookie: cookieOf(response) } });
    expect(json(status)).toEqual({ head: "abc123", pending: 2, pending_branches: [] });
  });

  it("offers no login before a passkey exists", async () => {
    const response = await publicPost("/api/v1/auth/login/options", {});
    expect(response.statusCode).toBe(409);
    expect(json(response).error).toBe("no_passkeys");
  });

  it("rejects replayed, tampered, unknown and cloned-authenticator assertions", async () => {
    const authenticator = new FakeAuthenticator(RP_ID, ORIGIN);
    await register(authenticator);

    // Replay: a challenge works once.
    const options = json(await publicPost("/api/v1/auth/login/options", {}));
    const assertion = authenticator.get(options as { challenge: string });
    expect((await publicPost("/api/v1/auth/login/verify", { response: assertion })).statusCode).toBe(200);
    expect((await publicPost("/api/v1/auth/login/verify", { response: assertion })).statusCode).toBe(401);

    // Tampered signature.
    const fresh = json(await publicPost("/api/v1/auth/login/options", {}));
    const tampered = authenticator.get(fresh as { challenge: string }) as { response: { signature: string } };
    tampered.response.signature = Buffer.from(tampered.response.signature, "base64url").reverse().toString("base64url");
    expect((await publicPost("/api/v1/auth/login/verify", { response: tampered })).statusCode).toBe(401);

    // Unknown credential.
    const another = json(await publicPost("/api/v1/auth/login/options", {}));
    const stranger = new FakeAuthenticator(RP_ID, ORIGIN).get(another as { challenge: string });
    expect((await publicPost("/api/v1/auth/login/verify", { response: stranger })).statusCode).toBe(401);

    // A counter that goes backwards means a cloned authenticator.
    const last = json(await publicPost("/api/v1/auth/login/options", {}));
    const cloned = authenticator.get(last as { challenge: string }, { counter: 1 });
    expect((await publicPost("/api/v1/auth/login/verify", { response: cloned })).statusCode).toBe(401);
  });

  it("rejects a malformed login request", async () => {
    await register(new FakeAuthenticator(RP_ID, ORIGIN));
    for (const payload of [{}, { response: "x" }, { response: { id: 5 } }, { response: { id: "nope" } }]) {
      expect((await publicPost("/api/v1/auth/login/verify", payload)).statusCode).toBe(401);
    }
  });
});

describe("sessions, CSRF and origin checks", () => {
  async function signedIn() {
    const authenticator = new FakeAuthenticator(RP_ID, ORIGIN);
    const response = await register(authenticator);
    return { cookie: cookieOf(response), csrf: json(response).csrf as string, authenticator };
  }

  it("logs out with a valid CSRF token and Origin, ending the session", async () => {
    const { cookie, csrf } = await signedIn();
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie, origin: ORIGIN, "x-csrf-token": csrf } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    expect((await app.inject({ method: "GET", url: "/api/v1/session", headers: { cookie } })).statusCode).toBe(401);
  });

  it("rejects state-changing requests without the CSRF token or from another origin", async () => {
    const { cookie, csrf } = await signedIn();
    const attempt = (headers: Record<string, string>) =>
      app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie, ...headers } });

    expect((await attempt({ origin: ORIGIN })).statusCode).toBe(403);
    expect((await attempt({ origin: ORIGIN, "x-csrf-token": "wrong" })).statusCode).toBe(403);
    expect((await attempt({ "x-csrf-token": csrf })).statusCode).toBe(403);
    expect((await attempt({ origin: "https://evil.example", "x-csrf-token": csrf })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/session", headers: { cookie } })).statusCode).toBe(200);
  });

  it("rejects cross-origin posts to the public auth endpoints", async () => {
    for (const origin of ["https://evil.example", undefined]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login/options",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        payload: "{}",
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it("expires a session after 30 idle days", async () => {
    const { cookie } = await signedIn();
    now += 31 * 24 * 60 * 60 * 1000;
    expect((await app.inject({ method: "GET", url: "/api/v1/session", headers: { cookie } })).statusCode).toBe(401);
  });

  it("rate-limits sign-in attempts per IP", async () => {
    advanceClock = false;
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await publicPost("/api/v1/auth/register/options", { setup_token: "wrong" })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429, 429]);
    expect((await publicPost("/api/v1/auth/register/options", { setup_token: "wrong" }, {})).headers["retry-after"]).toBeDefined();
  });
});

describe("authorization matrix", () => {
  it("answers 401 to anonymous requests everywhere except login, setup and assets", async () => {
    const urls = ["/", "/capture", "/api/v1/status", "/api/v1/session", "/api/v1/anything", "/records/x"];
    for (const url of urls) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
    const html = await app.inject({ method: "GET", url: "/", headers: { accept: "text/html" } });
    expect(html.statusCode).toBe(401);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.body).toContain('href="/login"');
  });

  it("keeps inbox tokens and sessions apart", async () => {
    const token = new TokenStore(dir).create("iphone-shortcut");
    const bearer = { authorization: `Bearer ${token}` };
    for (const url of ["/api/v1/status", "/api/v1/session"]) {
      expect((await app.inject({ method: "GET", url, headers: bearer })).statusCode, url).toBe(401);
    }

    const response = await register(new FakeAuthenticator(RP_ID, ORIGIN));
    const cookie = cookieOf(response);
    expect((await app.inject({ method: "GET", url: "/api/v1/inbox/abcdefgh", headers: { cookie } })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/inbox", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, payload: "{}" })).statusCode,
    ).toBe(401);
  });
});
