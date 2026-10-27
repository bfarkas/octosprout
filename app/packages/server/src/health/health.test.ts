import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PasskeyStore } from "../auth/passkeys.js";
import { SessionStore } from "../auth/sessions.js";
import { captureText, createCapture, Sandbox } from "../git/test-helpers.js";
import { buildApp } from "../http/app.js";
import { signIn, TEST_ORIGIN, TEST_RP_ID, TEST_SETUP_TOKEN } from "../http/test-session.js";
import { TokenStore } from "../http/tokens.js";
import { InboxService } from "../inbox/service.js";
import { GitWriteService } from "../git/write-service.js";
import { CiStatus, githubRepo } from "./ci.js";
import { HealthService, PENDING_ALERT_MS } from "./health.js";

describe("githubRepo", () => {
  it.each([
    ["git@github.com:bfarkas/octosprout-private.git", "bfarkas/octosprout-private"],
    ["ssh://git@github.com/bfarkas/octosprout-private.git", "bfarkas/octosprout-private"],
    ["https://github.com/bfarkas/octosprout-private", "bfarkas/octosprout-private"],
    ["/srv/remote.git", undefined],
    [undefined, undefined],
  ])("%s -> %s", (url, repo) => {
    expect(githubRepo(url)).toBe(repo);
  });
});

describe("CiStatus", () => {
  const run = { status: "completed", conclusion: "failure", html_url: "https://github.com/x/y/actions/runs/1", head_sha: "a".repeat(40), created_at: "2026-10-27T10:00:00Z", display_title: "edit" };
  const fakeFetch = (calls: string[], body: unknown, status = 200) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${String(url)} ${(init?.headers as Record<string, string>).authorization}`);
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;

  it("is not configured without a token or a GitHub remote", async () => {
    expect((await new CiStatus({ repo: "x/y" }).state()).kind).toBe("not_configured");
    expect((await new CiStatus({ token: "t" }).state()).kind).toBe("not_configured");
  });

  it("reads the latest run on main with the token, and caches it for a minute", async () => {
    const calls: string[] = [];
    let now = 0;
    const ci = new CiStatus({ token: "secret", repo: "x/y", fetch: fakeFetch(calls, { workflow_runs: [run] }), now: () => now });
    expect(await ci.state()).toEqual({ kind: "ok", run: { status: "completed", conclusion: "failure", url: run.html_url, sha: run.head_sha, created: run.created_at, title: "edit" } });
    expect(calls).toEqual(["https://api.github.com/repos/x/y/actions/runs?branch=main&per_page=1 Bearer secret"]);
    now += 30_000;
    await ci.state();
    expect(calls).toHaveLength(1);
    now += 31_000;
    await ci.state();
    expect(calls).toHaveLength(2);
  });

  it("reports errors and empty histories", async () => {
    expect(await new CiStatus({ token: "t", repo: "x/y", fetch: fakeFetch([], {}, 401) }).state()).toEqual({ kind: "error", message: "GitHub answered 401." });
    expect(await new CiStatus({ token: "t", repo: "x/y", fetch: fakeFetch([], { workflow_runs: [] }) }).state()).toEqual({ kind: "ok", run: null });
  });
});

describe("HealthService", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await Sandbox.create();
  });
  afterEach(() => sandbox.dispose());

  it("reports validation, pending commits and their age, and the last fetch and push", async () => {
    const writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
    await writer.submit(createCapture("OS-C-AAAAA"));
    let now = Date.now();
    const health = new HealthService({ repoDir: sandbox.server, status: () => writer.status(), ci: new CiStatus({}), now: () => now });
    let h = await health.health();
    expect(h).toMatchObject({ errors: 0, pendingAlert: false, write: { pending: 0, lastPush: expect.any(String), lastFetch: expect.any(String) } });
    expect(h.ci.kind).toBe("not_configured");

    await sandbox.goOffline();
    await writer.submit(createCapture("OS-C-BBBBB"));
    h = await health.health();
    expect(h.write).toMatchObject({ pending: 1, oldestPending: expect.stringMatching(/Z$/) });
    expect(h.pendingAlert).toBe(false);
    now += PENDING_ALERT_MS + 60_000;
    expect((await health.health()).pendingAlert).toBe(true);
  });

  it("re-validates when HEAD moves", async () => {
    const writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
    const health = new HealthService({ repoDir: sandbox.server, status: () => writer.status(), ci: new CiStatus({}) });
    expect((await health.health()).warnings).toBe(0);
    // A capture from the Mac with a secret-looking string: a warning, not an error.
    await sandbox.macPush({ "records/captures/2026/10/OS-C-CCCCC.md": captureText("OS-C-CCCCC", {}, `key ${["AKIA", "IOSFODNN7EXAMPLE"].join("")}\n`) });
    await writer.sync();
    expect((await health.health()).warnings).toBe(1);
  });
});

describe("the health page and status API", () => {
  let sandbox: Sandbox;
  let stateDir: string;
  beforeEach(async () => {
    sandbox = await Sandbox.create();
    stateDir = mkdtempSync(join(tmpdir(), "octosprout-health-"));
  });
  afterEach(() => {
    sandbox.dispose();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("show validation findings, pending pushes and the CI run", async () => {
    const writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
    await sandbox.macPush({ "records/ideas/OS-I-2HD9W--broken.md": "---\nid: OS-I-2HD9W\ntype: idea\n---\n" });
    await writer.sync();
    const run = { status: "completed", conclusion: "success", html_url: "https://github.com/x/y/actions/runs/1", head_sha: "b".repeat(40), created_at: "2026-10-27T10:00:00Z" };
    const ci = new CiStatus({ token: "t", repo: "x/y", fetch: (async () => new Response(JSON.stringify({ workflow_runs: [run] }))) as typeof fetch });
    const app = buildApp({
      inbox: new InboxService({ writer, repoDir: sandbox.server }),
      tokens: new TokenStore(stateDir),
      auth: { passkeys: new PasskeyStore(stateDir), sessions: new SessionStore(stateDir), rpId: TEST_RP_ID, origin: TEST_ORIGIN, setupToken: TEST_SETUP_TOKEN, status: () => writer.status() },
      health: new HealthService({ repoDir: sandbox.server, status: () => writer.status(), ci }),
    });
    await app.ready();
    const { cookie } = await signIn(app);
    const html = (await app.inject({ method: "GET", url: "/health", headers: { cookie, accept: "text/html" } })).body;
    expect(html).toMatch(/[1-9]\d* errors?, 0 warnings/);
    expect(html).toContain('<a href="/records/OS-I-2HD9W">OS-I-2HD9W</a>');
    expect(html).toContain('<a href="https://github.com/x/y/actions/runs/1" rel="noreferrer noopener" target="_blank">success</a>');
    const status = (await app.inject({ method: "GET", url: "/api/v1/status", headers: { cookie } })).json() as Record<string, unknown>;
    expect(status).toMatchObject({ pending: 0, pending_alert: false, last_fetch: expect.any(String), validation: { warnings: 0 }, ci: { conclusion: "success" } });
    expect((status.validation as { errors: number }).errors).toBeGreaterThan(0);
    await app.close();
  });
});
