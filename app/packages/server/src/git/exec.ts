/**
 * Thin wrapper around the git CLI (spec D7).
 */
import { spawn } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stdoutBuffer: Buffer;
  stderr: string;
}

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly result: GitResult,
  ) {
    super(`git ${args.join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
    this.name = "GitError";
  }
}

export interface GitOptions {
  input?: string | Buffer;
  /** Return non-zero exits instead of throwing. */
  allowFail?: boolean;
  /** Kill the process after this long. Used for network operations. */
  timeoutMs?: number;
}

/** Runs `git <args>` in `cwd` and resolves with its output. */
export function runGit(cwd: string, args: readonly string[], options: GitOptions = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Stable, parseable output; never prompt, never open an editor.
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
        GIT_EDITOR: "true",
        GIT_MERGE_AUTOEDIT: "no",
      },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const stdoutBuffer = Buffer.concat(out);
      const result: GitResult = {
        code: timedOut ? 124 : (code ?? 1),
        stdout: stdoutBuffer.toString("utf8"),
        stdoutBuffer,
        stderr: timedOut ? `timed out after ${options.timeoutMs}ms` : Buffer.concat(err).toString("utf8"),
      };
      if (result.code !== 0 && !options.allowFail) reject(new GitError(args, result));
      else resolve(result);
    });
    // A command that exits without reading stdin raises EPIPE; the exit code is what matters.
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  });
}
