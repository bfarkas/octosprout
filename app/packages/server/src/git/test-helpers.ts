/**
 * Fixtures for Git tests: a bare repository that plays "GitHub", plus clones
 * that play the server and the Mac (spec §20).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { renderRecord, sha256Hex, type Frontmatter } from "@octosprout/core";

import { runGit } from "./exec.js";
import type { WriteOperation } from "./write-service.js";

export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await runGit(cwd, args)).stdout.trim();
}

export class Sandbox {
  readonly remote: string;
  readonly server: string;
  readonly mac: string;
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
    this.remote = join(root, "remote.git");
    this.server = join(root, "server");
    this.mac = join(root, "mac");
  }

  static async create(): Promise<Sandbox> {
    const sandbox = new Sandbox(mkdtempSync(join(tmpdir(), "octosprout-git-")));
    await git(sandbox.#root, "init", "-q", "--bare", "-b", "main", sandbox.remote);

    const seed = join(sandbox.#root, "seed");
    await git(sandbox.#root, "clone", "-q", sandbox.remote, seed);
    await sandbox.#configure(seed);
    writeFileSync(join(seed, "README.md"), "# workspace\n");
    await git(seed, "add", "-A");
    await git(seed, "commit", "-q", "-m", "first commit");
    await git(seed, "push", "-q", "origin", "HEAD:main");

    for (const clone of [sandbox.server, sandbox.mac]) {
      await git(sandbox.#root, "clone", "-q", sandbox.remote, clone);
      await sandbox.#configure(clone);
    }
    return sandbox;
  }

  async #configure(dir: string): Promise<void> {
    await git(dir, "config", "user.name", "Test");
    await git(dir, "config", "user.email", "test@example.com");
    await git(dir, "config", "commit.gpgsign", "false");
  }

  /** Commits files from the Mac clone and pushes them to the remote. */
  async macPush(files: Record<string, string>, message = "mac change"): Promise<void> {
    await git(this.mac, "pull", "-q", "--rebase", "origin", "main");
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(this.mac, path)), { recursive: true });
      writeFileSync(join(this.mac, path), content);
    }
    await git(this.mac, "add", "-A");
    await git(this.mac, "commit", "-q", "-m", message);
    await git(this.mac, "push", "-q", "origin", "HEAD:main");
  }

  /** Points the server clone at a missing remote, simulating an outage. */
  async goOffline(): Promise<void> {
    await git(this.server, "remote", "set-url", "origin", join(this.#root, "nowhere.git"));
  }

  async goOnline(): Promise<void> {
    await git(this.server, "remote", "set-url", "origin", this.remote);
  }

  async remoteLog(): Promise<string[]> {
    return (await git(this.remote, "log", "--format=%s", "main")).split("\n");
  }

  dispose(): void {
    rmSync(this.#root, { recursive: true, force: true });
  }
}

export function captureText(id: string, overrides: Frontmatter = {}, body = `body of ${id}\n`): string {
  return renderRecord(
    {
      id,
      type: "capture",
      schema_version: 1,
      status: "new",
      created: "2026-10-25T14:03:11Z",
      updated: "2026-10-25T14:03:11Z",
      source: "cli",
      idempotency_key: `key-${id}`,
      received_via: "cli",
      content_sha256: sha256Hex(body),
      ...overrides,
    },
    body,
  );
}

export const capturePath = (id: string): string => `records/captures/2026/10/${id}.md`;

/** A capture-creating operation, as the inbox service will issue. */
export function createCapture(id: string, overrides: Frontmatter = {}, body?: string): WriteOperation {
  return {
    operation: "capture",
    actor: "token:test",
    subject: `capture: ${id} (test)`,
    preconditions: [{ path: capturePath(id), baseBlob: null }],
    changes: [{ path: capturePath(id), content: captureText(id, overrides, body) }],
  };
}
