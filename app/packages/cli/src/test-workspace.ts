/** Test helper: a workspace made by `octosprout init`, committed, with a bare remote. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInit } from "./init.js";

export interface TestWorkspace {
  root: string;
  remote: string;
  git(...args: string[]): string;
  dispose(): void;
}

export function makeWorkspace(): TestWorkspace {
  const base = mkdtempSync(join(tmpdir(), "octosprout-cli-"));
  const remote = join(base, "remote.git");
  const root = join(base, "workspace");
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  run(base, "init", "-q", "--bare", "-b", "main", remote);
  run(base, "init", "-q", "-b", "main", root);
  for (const [key, value] of [["user.name", "Test"], ["user.email", "test@example.com"], ["commit.gpgsign", "false"], ["core.hooksPath", "/dev/null"]]) run(root, "config", key!, value!);
  runInit([], root, { out: () => {}, err: () => {} }, { cliPath: "/nonexistent" });
  run(root, "add", "-A");
  run(root, "commit", "-q", "-m", "init");
  run(root, "remote", "add", "origin", remote);
  run(root, "push", "-q", "origin", "main");
  return { root, remote, git: (...args) => run(root, ...args), dispose: () => rmSync(base, { recursive: true, force: true }) };
}
