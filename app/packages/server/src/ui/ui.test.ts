import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAuthenticator } from "../auth/fake-authenticator.js";
import { PasskeyStore } from "../auth/passkeys.js";
import { SessionStore } from "../auth/sessions.js";
import { git, Sandbox } from "../git/test-helpers.js";
import { GitWriteService } from "../git/write-service.js";
import { buildApp } from "../http/app.js";
import { TokenStore } from "../http/tokens.js";
import { InboxService } from "../inbox/service.js";
import { APP_JS, AUTH_JS } from "./assets.js";
import { esc } from "./html.js";
import { formatTime } from "./routes.js";

const ORIGIN = "https://app.example.test";
const RP_ID = "example.test";
const SETUP_TOKEN = "setup-token-for-tests";

let sandbox: Sandbox;
let stateDir: string;
let writer: GitWriteService;
let inbox: InboxService;
let tokens: TokenStore;
let app: FastifyInstance;
let cookie: string;
let csrf: string;
let clock: Date;

beforeEach(async () => {
  sandbox = await Sandbox.create();
  stateDir = mkdtempSync(join(tmpdir(), "octosprout-ui-"));
  clock = new Date("2026-10-25T14:03:11Z");
  writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
  inbox = new InboxService({ writer, repoDir: sandbox.server, now: () => clock });
  tokens = new TokenStore(stateDir);
  app = buildApp({
    inbox,
    tokens,
    auth: {
      passkeys: new PasskeyStore(stateDir),
      sessions: new SessionStore(stateDir),
      rpId: RP_ID,
      origin: ORIGIN,
      setupToken: SETUP_TOKEN,
      status: () => writer.status(),
    },
  });
  await app.ready();

  // Sign in through the real registration flow.
  const authenticator = new FakeAuthenticator(RP_ID, ORIGIN);
  const post = (url: string, payload: unknown) =>
    app.inject({ method: "POST", url, headers: { origin: ORIGIN, "content-type": "application/json" }, payload: JSON.stringify(payload) });
  const options = (await post("/api/v1/auth/register/options", { setup_token: SETUP_TOKEN })).json() as { challenge: string };
  const verified = await post("/api/v1/auth/register/verify", { setup_token: SETUP_TOKEN, response: authenticator.create(options) });
  cookie = (verified.headers["set-cookie"] as string).split(";")[0]!;
  csrf = (verified.json() as { csrf: string }).csrf;
});

afterEach(async () => {
  await app.close();
  sandbox.dispose();
  rmSync(stateDir, { recursive: true, force: true });
});

const page = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url, headers: { cookie, accept: "text/html", ...headers } });
const capture = (payload: unknown, headers: Record<string, string> = { cookie, origin: ORIGIN, "x-csrf-token": csrf }): Promise<LightMyRequestResponse> =>
  app.inject({ method: "POST", url: "/api/v1/capture", headers: { "content-type": "application/json", ...headers }, payload: JSON.stringify(payload) });
const store = (text: string, key: string, extra: Record<string, unknown> = {}) =>
  inbox.submit({ text, idempotencyKey: key, source: "chatgpt", ...extra }, "token:iphone-shortcut");

describe("the Inbox view", () => {
  it("requires a session", async () => {
    expect((await app.inject({ method: "GET", url: "/", headers: { accept: "text/html" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/capture" })).statusCode).toBe(401);
  });

  it("shows an empty state", async () => {
    const response = await page("/");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Nothing to triage");
    expect(response.body).toContain("0 new");
  });

  it("lists new captures, newest first, with source and time", async () => {
    await store("first idea", "key-00000001");
    clock = new Date("2026-10-26T09:30:00Z");
    await store("second idea", "key-00000002", { source: "shortcut", sourceUrl: "https://chatgpt.com/share/abc123" });

    const html = (await page("/")).body;
    expect(html).toContain("2 new");
    expect(html.indexOf("second idea")).toBeGreaterThan(-1);
    expect(html.indexOf("second idea")).toBeLessThan(html.indexOf("first idea"));
    expect(html).toContain("2026-10-26 09:30 UTC");
    expect(html).toContain("shortcut");
    expect(html).toContain('href="https://chatgpt.com/share/abc123" rel="noreferrer noopener"');
    expect(html).toMatch(/OS-C-[0-9A-HJKMNP-TV-Z]{5}/);
  });

  it("shows only captures that are still new", async () => {
    await store("keep me", "key-00000001");
    await sandbox.macPush({
      "records/captures/2026/10/OS-C-DONE1.md": (await import("../git/test-helpers.js")).captureText("OS-C-DONE1", { status: "composted" }, "already handled"),
    });
    await writer.sync();
    inbox.reindex();

    const html = (await page("/")).body;
    expect(html).toContain("keep me");
    expect(html).not.toContain("already handled");
  });

  it("escapes capture text, never rendering HTML or Markdown", async () => {
    const attack = `<script>alert(1)</script> <img src=x onerror=alert(2)> "quoted" & [link](javascript:alert(3))\n# heading`;
    await store(attack, "key-00000001", { sourceDetail: "<b>evil</b>", source: "other" });
    const html = (await page("/")).body;

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>evil</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;quoted&quot; &amp;");
    expect(html).toContain("# heading"); // Markdown is shown as written
    expect(html).not.toContain("<h1># heading");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });

  it("keeps whitespace and puts long captures behind a disclosure", async () => {
    const long = `${"word ".repeat(100)}END-OF-LONG-CAPTURE`;
    await store(long, "key-00000001");
    await store("line one\n  indented\n\nline four", "key-00000002");
    const html = (await page("/")).body;
    expect(html).toContain("<details>");
    expect(html).toContain("END-OF-LONG-CAPTURE");
    expect(html).toContain("line one\n  indented\n\nline four");
  });

  it("warns when changes have not been pushed yet", async () => {
    await sandbox.goOffline();
    await store("offline idea", "key-00000001");
    const html = (await page("/")).body;
    expect(html).toContain("1 change not yet pushed to GitHub");
    expect(html).toContain("offline idea");
  });

  it("shows the pending-branch warning", async () => {
    await store("x", "key-00000001");
    const failing = buildApp({
      inbox,
      tokens,
      auth: {
        passkeys: new PasskeyStore(stateDir),
        sessions: new SessionStore(stateDir),
        rpId: RP_ID,
        origin: ORIGIN,
        status: () => Promise.resolve({ head: "x", pending: 0, pendingBranches: ["octosprout/pending/20261025T120000000Z"] }),
      },
    });
    await failing.ready();
    // Reuse the signed-in session, which lives in the shared state directory.
    const html = (await failing.inject({ method: "GET", url: "/", headers: { cookie } })).body;
    expect(html).toContain("could not be rebased");
    await failing.close();
  });
});

describe("the capture form", () => {
  it("renders for a signed-in user", async () => {
    const response = await page("/capture");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('id="capture-form"');
    expect(response.body).toContain('<script src="/static/app.js" defer></script>');
  });

  it("stores a capture from the browser as source 'web' through the web session", async () => {
    const response = await capture({ text: "from the browser", idempotency_key: "web-0000-0001", source: "claude", source_url: "https://example.com/a" });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; status: string; path: string };
    expect(body.status).toBe("committed");

    expect(await git(sandbox.remote, "log", "-1", "--format=%s")).toBe(`capture: ${body.id} (web)`);
    expect(await git(sandbox.remote, "log", "-1", "--format=%B")).toContain("OctoSprout-Actor: user:web");
    const file = await git(sandbox.remote, "show", `main:${body.path}`);
    expect(file).toContain("source: web"); // the client's own 'source' is ignored
    expect(file).toContain("received_via: web-session");
    expect(file).toContain("source_url: https://example.com/a");
    expect((await page("/")).body).toContain("from the browser");
  });

  it("is idempotent, so a retried submission never duplicates", async () => {
    const payload = { text: "once only", idempotency_key: "web-0000-0002" };
    const first = (await capture(payload)).json() as { id: string };
    const retry = await capture(payload);
    expect(retry.statusCode).toBe(200);
    expect((retry.json() as { id: string }).id).toBe(first.id);
    expect((await capture({ ...payload, text: "different" })).statusCode).toBe(409);
  });

  it("reports a pending save as 202", async () => {
    await sandbox.goOffline();
    const response = await capture({ text: "offline", idempotency_key: "web-0000-0003" });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "pending" });
  });

  it("validates input", async () => {
    expect((await capture({ text: "   ", idempotency_key: "web-0000-0004" })).statusCode).toBe(400);
    expect((await capture({ text: "x" })).statusCode).toBe(400);
    expect((await capture({ text: "x", idempotency_key: "web-0000-0004", source_url: "http://insecure.example" })).statusCode).toBe(400);
  });

  it("needs a session, the Origin and the CSRF token", async () => {
    const payload = { text: "x", idempotency_key: "web-0000-0005" };
    expect((await capture(payload, { origin: ORIGIN, "x-csrf-token": csrf })).statusCode).toBe(401);
    expect((await capture(payload, { cookie, "x-csrf-token": csrf })).statusCode).toBe(403);
    expect((await capture(payload, { cookie, origin: ORIGIN })).statusCode).toBe(403);
    expect((await capture(payload, { cookie, origin: "https://evil.example", "x-csrf-token": csrf })).statusCode).toBe(403);
  });
});

describe("token management", () => {
  const api = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = { cookie, origin: ORIGIN, "x-csrf-token": csrf }) =>
    app.inject({ method, url, headers: { "content-type": "application/json", ...headers }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });

  it("creates a token that works on the inbox API, shown once", async () => {
    const created = await api("POST", "/api/v1/tokens", { name: "iphone-shortcut" });
    expect(created.statusCode).toBe(201);
    const { token } = created.json() as { token: string };
    expect(token).toMatch(/^ost_/);

    const stored = await app.inject({
      method: "POST",
      url: "/api/v1/inbox",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: JSON.stringify({ text: "from the shortcut", idempotency_key: "shortcut-0001" }),
    });
    expect(stored.statusCode).toBe(201);

    const listed = (await api("GET", "/api/v1/tokens")).json() as { tokens: Array<Record<string, unknown>> };
    expect(listed.tokens).toEqual([expect.objectContaining({ name: "iphone-shortcut" })]);
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it("revokes a token", async () => {
    const { token } = (await api("POST", "/api/v1/tokens", { name: "to-revoke" })).json() as { token: string };
    expect((await api("DELETE", "/api/v1/tokens/to-revoke")).statusCode).toBe(200);
    expect((await api("DELETE", "/api/v1/tokens/to-revoke")).statusCode).toBe(404);
    const rejected = await app.inject({ method: "GET", url: "/api/v1/inbox/abcdefgh", headers: { authorization: `Bearer ${token}` } });
    expect(rejected.statusCode).toBe(401);
  });

  it("rejects bad names and duplicates", async () => {
    expect((await api("POST", "/api/v1/tokens", {})).statusCode).toBe(400);
    expect((await api("POST", "/api/v1/tokens", { name: "has space" })).statusCode).toBe(400);
    await api("POST", "/api/v1/tokens", { name: "one" });
    expect((await api("POST", "/api/v1/tokens", { name: "one" })).statusCode).toBe(400);
  });

  it("needs a session, the Origin and the CSRF token", async () => {
    expect((await api("POST", "/api/v1/tokens", { name: "x1" }, { origin: ORIGIN, "x-csrf-token": csrf })).statusCode).toBe(401);
    expect((await api("POST", "/api/v1/tokens", { name: "x2" }, { cookie, origin: ORIGIN })).statusCode).toBe(403);
    expect((await api("DELETE", "/api/v1/tokens/x3", undefined, { cookie })).statusCode).toBe(403);
    expect((await api("GET", "/api/v1/tokens", undefined, {})).statusCode).toBe(401);
    expect(tokens.list()).toEqual([]);
  });

  it("is not reachable with an inbox token", async () => {
    const token = tokens.create("existing");
    const response = await app.inject({ method: "GET", url: "/api/v1/tokens", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(401);
  });

  it("renders the settings page with tokens and passkeys, escaped", async () => {
    tokens.create("active-token");
    tokens.create("old-token");
    tokens.revoke("old-token");
    const response = await page("/settings");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data-token="active-token"');
    expect(response.body).toContain("old-token");
    expect(response.body).toMatch(/old-token · revoked/);
    expect(response.body).not.toContain('data-name="old-token"');
    expect(response.body).toContain('id="token-form"');
    expect(response.body).not.toMatch(/ost_[A-Za-z0-9_-]{20,}/); // no secret ever appears in the page
    expect((await app.inject({ method: "GET", url: "/settings" })).statusCode).toBe(401);
  });
});

describe("client scripts", () => {
  it.each([
    ["auth.js", AUTH_JS],
    ["app.js", APP_JS],
  ])("%s is syntactically valid JavaScript", (_name, source) => {
    expect(() => new Function(source)).not.toThrow();
  });

  it("serves them with the right content types", async () => {
    expect((await app.inject({ method: "GET", url: "/static/app.js" })).headers["content-type"]).toContain("text/javascript");
  });
});

describe("helpers", () => {
  it("escapes HTML metacharacters", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("formats receive times", () => {
    expect(formatTime("2026-10-25T14:03:11Z")).toBe("2026-10-25 14:03 UTC");
    expect(formatTime("garbage")).toBe("garbage");
  });
});
