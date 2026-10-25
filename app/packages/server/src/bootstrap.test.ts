import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareRepo, sshCommand } from "./bootstrap.js";
import type { ServerConfig } from "./config.js";
import { git, Sandbox } from "./git/test-helpers.js";

let sandbox: Sandbox;
let root: string;
beforeEach(async () => {
  sandbox = await Sandbox.create();
  root = mkdtempSync(join(tmpdir(), "octosprout-boot-"));
});
afterEach(() => {
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
  trustProxy: false,
  syncIntervalMs: 60_000,
  logLevel: "silent",
  ...overrides,
});

describe("prepareRepo", () => {
  it("clones the workspace on first start, and not again", async () => {
    const c = config({ remoteUrl: sandbox.remote });
    expect(await prepareRepo(c)).toEqual({ cloned: true });
    expect(existsSync(join(c.repoDir, "README.md"))).toBe(true);
    expect(await git(c.repoDir, "branch", "--show-current")).toBe("main");

    expect(await prepareRepo(c)).toEqual({ cloned: false });
  });

  it("clones into an empty directory, as a Docker volume mount provides", async () => {
    const c = config({ remoteUrl: sandbox.remote });
    mkdirSync(c.repoDir, { recursive: true });
    expect(await prepareRepo(c)).toEqual({ cloned: true });
  });

  it("refuses to clone over unrelated files", async () => {
    const c = config({ remoteUrl: sandbox.remote });
    mkdirSync(c.repoDir, { recursive: true });
    writeFileSync(join(c.repoDir, "precious.txt"), "keep");
    await expect(prepareRepo(c)).rejects.toThrow(/not empty/);
    expect(existsSync(join(c.repoDir, "precious.txt"))).toBe(true);
  });

  it("explains a missing clone without a remote URL", async () => {
    await expect(prepareRepo(config())).rejects.toThrow(/OCTOSPROUT_REMOTE_URL/);
  });

  it("uses a private copy of the deploy key for all git operations", async () => {
    const secret = join(root, "secret_key");
    writeFileSync(secret, "-----BEGIN KEY-----\n", { mode: 0o644 });
    const c = config({ remoteUrl: sandbox.remote, deployKeyFile: secret });
    await prepareRepo(c);

    const keyCopy = join(c.stateDir, "deploy_key");
    expect(statSync(keyCopy).mode & 0o077).toBe(0);
    const configured = await git(c.repoDir, "config", "core.sshCommand");
    expect(configured).toBe(sshCommand(keyCopy, join(c.stateDir, "known_hosts")));
    expect(configured).toContain("IdentitiesOnly=yes");
    expect(configured).toContain("BatchMode=yes");
  });
});
