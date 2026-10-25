/**
 * Advisory file lock backed by flock(1) (spec §8.2).
 *
 * A helper process holds the lock for as long as its stdin stays open. If this
 * process dies, the pipe closes, the helper exits and the kernel releases the
 * lock, so a crash never leaves a stale lock behind.
 */
import { spawn } from "node:child_process";

export class LockTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`Could not acquire ${path} within ${timeoutMs}ms; another process holds the lock.`);
    this.name = "LockTimeoutError";
  }
}

const CONFLICT_EXIT_CODE = 99;

/** Acquires an exclusive lock on `path` (created if missing). Resolves with a release function. */
export function acquireFileLock(path: string, timeoutMs: number): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "flock",
      ["-x", "-w", String(Math.max(timeoutMs / 1000, 0.001)), "-E", String(CONFLICT_EXIT_CODE), path, "sh", "-c", "echo locked; cat >/dev/null"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    let held = false;
    let settled = false;

    const closed = new Promise<void>((done) => child.on("close", () => done()));
    const release = async (): Promise<void> => {
      child.stdin.end();
      await closed;
    };

    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      if (!held && chunk.toString().includes("locked")) {
        held = true;
        settled = true;
        resolve(release);
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject((error as NodeJS.ErrnoException).code === "ENOENT" ? new Error("flock(1) is required but was not found.") : error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      reject(code === CONFLICT_EXIT_CODE ? new LockTimeoutError(path, timeoutMs) : new Error(`flock exited with code ${code}`));
    });
  });
}
