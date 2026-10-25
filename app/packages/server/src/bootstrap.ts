/**
 * Prepares the server's clone of the workspace repository (spec §8.2, §18.1).
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ServerConfig } from "./config.js";
import { runGit } from "./git/exec.js";

/** ssh options for the deploy key. Host keys are pinned on first use, in the state directory. */
export function sshCommand(keyPath: string, knownHostsPath: string): string {
  return [
    "ssh",
    "-i", keyPath,
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${knownHostsPath}`,
    "-o", "BatchMode=yes",
  ].join(" ");
}

/**
 * Makes sure `repoDir` holds a clone of the workspace that fetches and pushes with the deploy key.
 * Returns whether it had to clone.
 */
export async function prepareRepo(config: ServerConfig): Promise<{ cloned: boolean }> {
  mkdirSync(config.stateDir, { recursive: true });

  let ssh: string | undefined;
  if (config.deployKeyFile) {
    // Docker secrets are world-readable, which ssh refuses; use a private copy.
    const keyPath = join(config.stateDir, "deploy_key");
    copyFileSync(config.deployKeyFile, keyPath);
    chmodSync(keyPath, 0o600);
    ssh = sshCommand(keyPath, join(config.stateDir, "known_hosts"));
  }

  let cloned = false;
  if (!existsSync(join(config.repoDir, ".git"))) {
    if (!config.remoteUrl) {
      throw new Error(`${config.repoDir} is not a Git clone and OCTOSPROUT_REMOTE_URL is not set.`);
    }
    mkdirSync(dirname(config.repoDir), { recursive: true });
    if (existsSync(config.repoDir) && readdirSync(config.repoDir).length > 0) {
      throw new Error(`${config.repoDir} exists, is not empty and is not a Git clone.`);
    }
    const args = ["clone", ...(ssh ? ["-c", `core.sshCommand=${ssh}`] : []), config.remoteUrl, config.repoDir];
    await runGit(dirname(config.repoDir), args, { timeoutMs: 600_000 });
    cloned = true;
  }

  // Persist the ssh command so every later fetch and push uses the deploy key.
  if (ssh) await runGit(config.repoDir, ["config", "core.sshCommand", ssh]);
  return { cloned };
}
