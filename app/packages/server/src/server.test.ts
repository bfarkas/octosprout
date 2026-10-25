import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ServerConfig } from "./config.js";
import { git, Sandbox } from "./git/test-helpers.js";
import { startServer, type RunningServer } from "./server.js";

let sandbox: Sandbox;
let root: string;
let running: RunningServer | undefined;

beforeEach(async () => {
  sandbox = await Sandbox.create();
  root = mkdtempSync(join(tmpdir(), "octosprout-server-"));
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  sandbox.dispose();
  rmSync(root, { recursive: true, force: true });
});

const config = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
  repoDir: join(root, "repo"),
  stateDir: join(root, "state"),
  host: "127.0.0.1",
  port: 0,
  rpId: "localhost",
  origin: "http://localhost",
  remoteUrl: sandbox.remote,
  trustProxy: false,
  syncIntervalMs: 1000,
  logLevel: "silent",
  ...overrides,
});

const capture = (address: string, token: string, key: string, text = "hello from the share sheet") =>
  fetch(`${address}/api/v1/inbox`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ text, idempotency_key: key, source: "shortcut" }),
  });

describe("startServer", () => {
  it("clones the workspace and accepts a capture over real HTTP", async () => {
    running = await startServer(config());
    const token = running.tokens.create("iphone-shortcut");

    const response = await capture(running.address, token, "shortcut-run-0001");
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; commit: string };
    expect(await git(sandbox.remote, "rev-parse", "main")).toBe(body.commit);

    expect((await fetch(`${running.address}/healthz`)).status).toBe(200);
    expect((await fetch(`${running.address}/api/v1/inbox/shortcut-run-0001`)).status).toBe(401);
  });

  it("answers a retry after a restart without creating a duplicate", async () => {
    running = await startServer(config());
    const token = running.tokens.create("iphone-shortcut");
    const first = (await (await capture(running.address, token, "shortcut-run-0001")).json()) as { id: string };
    await running.close();

    running = await startServer(config());
    const retry = await capture(running.address, token, "shortcut-run-0001");
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { id: string }).id).toBe(first.id);
    expect(await git(sandbox.remote, "rev-list", "--count", "main")).toBe("2");
  });

  it("keeps captures made during an outage and pushes them when the remote returns", async () => {
    running = await startServer(config());
    const token = running.tokens.create("iphone-shortcut");
    await git(config().repoDir, "remote", "set-url", "origin", join(root, "nowhere.git"));

    const response = await capture(running.address, token, "shortcut-run-0002");
    expect(response.status).toBe(202);

    await git(config().repoDir, "remote", "set-url", "origin", sandbox.remote);
    const deadline = Date.now() + 15_000;
    while ((await running.writer.status()).pending > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect((await running.writer.status()).pending).toBe(0);

    const status = await fetch(`${running.address}/api/v1/inbox/shortcut-run-0002`, { headers: { authorization: `Bearer ${token}` } });
    expect(((await status.json()) as { status: string }).status).toBe("committed");
  }, 30_000);

  it("resumes pushing commits left over from a previous run", async () => {
    running = await startServer(config());
    const token = running.tokens.create("iphone-shortcut");
    await git(config().repoDir, "remote", "set-url", "origin", join(root, "nowhere.git"));
    expect((await capture(running.address, token, "shortcut-run-0003")).status).toBe(202);
    await running.close();

    await git(config().repoDir, "remote", "set-url", "origin", sandbox.remote);
    running = await startServer(config());
    const deadline = Date.now() + 10_000;
    while ((await running.writer.status()).pending > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect((await running.writer.status()).pending).toBe(0);
    expect((await sandbox.remoteLog())[0]).toMatch(/^capture: OS-C-/);
  }, 30_000);

  it("notices captures pushed from the Mac and keeps its idempotency index current", async () => {
    running = await startServer(config({ syncIntervalMs: 1000 }));
    const token = running.tokens.create("iphone-shortcut");
    await capture(running.address, token, "shortcut-run-0004");

    await sandbox.macPush({ "notes.txt": "unrelated" });
    const before = (await running.writer.status()).head;
    const deadline = Date.now() + 10_000;
    while ((await running.writer.status()).head === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect((await running.writer.status()).head).not.toBe(before);
    expect((await capture(running.address, token, "shortcut-run-0004")).status).toBe(200);
  }, 30_000);
});
