/**
 * The Git write service (spec §8).
 *
 * Every write is one operation: apply file changes, validate, make one commit,
 * push. Operations run one at a time through a FIFO queue, and an advisory
 * file lock guards against other processes using the same clone.
 *
 * The service never force-pushes and never discards an unpushed commit.
 */
import { randomInt } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import {
  readWorkspaceFiles,
  validateWorkspace,
  type Finding,
  type SourceFile,
} from "@octosprout/core";

import { runGit, type GitOptions, type GitResult } from "./exec.js";
import { acquireFileLock } from "./lock.js";

const execFileAsync = promisify(execFile);

export type FileChange =
  | { path: string; content: string | Uint8Array }
  | { path: string; delete: true };

export interface Precondition {
  path: string;
  /** Git blob SHA the client read, or `null` if the file must not exist (§8.4). */
  baseBlob: string | null;
}

export interface WriteOperation {
  /** `OctoSprout-Operation` trailer, e.g. `capture` (§8.6). */
  operation: string;
  /** `OctoSprout-Actor` trailer, e.g. `token:iphone-shortcut`. */
  actor: string;
  /** Commit subject, e.g. `capture: OS-C-7K3QX (chatgpt)`. */
  subject: string;
  /** `OctoSprout-Proposal` trailer, when one applies. */
  proposal?: string;
  preconditions?: readonly Precondition[];
  changes: readonly FileChange[];
}

export type WriteResult =
  /** The commit is on the remote. */
  | { status: "committed"; commit: string }
  /** Durably committed in the local clone; the push has not succeeded yet. */
  | { status: "pending"; commit: string }
  /** The changes produced no difference, so no commit was made. */
  | { status: "unchanged" };

export interface SyncResult {
  /** Unpushed commits remaining. */
  pending: number;
  /** Local pending branches created for commits that could not be rebased. */
  quarantined: string[];
}

export interface WriteStatus {
  head: string;
  /** Commits not yet on the remote. */
  pending: number;
  /** `octosprout/pending/*` branches holding commits that could not be rebased. */
  pendingBranches: string[];
}

/** A precondition failed: the file changed since the client read it. */
export class ConflictError extends Error {
  constructor(
    readonly path: string,
    readonly expected: string | null,
    readonly actual: string | null,
    /** The file's current content, for the three-way view (§8.4). */
    readonly current: Buffer | null,
  ) {
    super(`${path} changed since it was read (expected ${expected ?? "no file"}, found ${actual ?? "no file"}).`);
    this.name = "ConflictError";
  }
}

/** The change would add validation errors (§8.1). */
export class ValidationRejectedError extends Error {
  constructor(readonly findings: readonly Finding[]) {
    super(`Write rejected: it would add ${findings.length} validation error(s), e.g. ${findings[0]?.code} ${findings[0]?.message}`);
    this.name = "ValidationRejectedError";
  }
}

export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationError";
  }
}

export interface GitWriteServiceOptions {
  /** The service's dedicated clone (§8.2). */
  repoDir: string;
  branch?: string;
  remote?: string;
  /** Author and committer of the service's commits (§8.6). */
  author?: { name: string; email: string };
  /** Validation run before and after every write. Defaults to the core validator. */
  validate?: (files: readonly SourceFile[]) => Finding[];
  /** Push retries after a non-fast-forward rejection (§8.3). */
  maxPushRetries?: number;
  /** Base of the jittered backoff between those retries. */
  retryBaseMs?: number;
  lockTimeoutMs?: number;
  networkTimeoutMs?: number;
  /** Called before each push attempt. For tests that need to interleave a remote change. */
  onBeforePush?: (attempt: number) => Promise<void> | void;
}

const BASELINE_KEY = (f: Finding): string => `${f.code}|${f.path}|${f.message}`;
const NON_FAST_FORWARD = /\[rejected\]|non-fast-forward|fetch first/;

export class GitWriteService {
  readonly #repoDir: string;
  readonly #branch: string;
  readonly #remote: string;
  readonly #identity: readonly string[];
  readonly #validate: (files: readonly SourceFile[]) => Finding[];
  readonly #maxPushRetries: number;
  readonly #retryBaseMs: number;
  readonly #lockTimeoutMs: number;
  readonly #networkTimeoutMs: number;
  readonly #onBeforePush: GitWriteServiceOptions["onBeforePush"];
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: GitWriteServiceOptions) {
    this.#repoDir = options.repoDir;
    this.#branch = options.branch ?? "main";
    this.#remote = options.remote ?? "origin";
    const author = options.author ?? { name: "OctoSprout", email: "octosprout@octosprout.de" };
    this.#identity = [
      "-c", `user.name=${author.name}`,
      "-c", `user.email=${author.email}`,
      "-c", "commit.gpgsign=false",
      // The server validates writes itself; repository hooks must not run.
      "-c", "core.hooksPath=/dev/null",
    ];
    this.#validate = options.validate ?? ((files) => validateWorkspace(files));
    this.#maxPushRetries = options.maxPushRetries ?? 3;
    this.#retryBaseMs = options.retryBaseMs ?? 200;
    this.#lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
    this.#networkTimeoutMs = options.networkTimeoutMs ?? 60_000;
    this.#onBeforePush = options.onBeforePush;
  }

  /** Queues a write. Resolves once it is committed (pushed or pending) or throws. */
  submit(operation: WriteOperation): Promise<WriteResult> {
    return this.#enqueue(() => this.#withLock(() => this.#write(operation)));
  }

  /**
   * Fetches, rebases pending commits and pushes them. Safe to call at any time;
   * the background task calls it periodically.
   */
  sync(): Promise<SyncResult> {
    return this.#enqueue(() =>
      this.#withLock(async () => {
        const quarantined: string[] = [];
        await this.#assertBranch();
        const sync = await this.#syncWithRemote();
        if (sync.quarantined) quarantined.push(sync.quarantined);
        if (sync.online && (await this.#ahead()) > 0) {
          const outcome = await this.#pushWithRetry(undefined);
          if (outcome.quarantined) quarantined.push(outcome.quarantined);
        }
        return { pending: await this.#ahead(), quarantined };
      }),
    );
  }

  /**
   * The commit that added `path`, and whether it is on the remote branch yet.
   * Reads refs only, so it does not wait behind queued writes.
   */
  async commitFor(path: string): Promise<{ commit: string; onRemote: boolean } | undefined> {
    safePath(path);
    const find = async (rev: string): Promise<string> =>
      (await this.#git(["log", "-1", "--diff-filter=A", "--format=%H", rev, "--", path])).stdout.trim();
    if (await this.#hasRemoteRef()) {
      const commit = await find(this.#remoteRef);
      if (commit !== "") return { commit, onRemote: true };
    }
    const commit = await find("HEAD");
    return commit === "" ? undefined : { commit, onRemote: false };
  }

  /**
   * Commits that touched `path`, newest first, following renames. Reads refs
   * only, so it does not wait behind queued writes.
   */
  async history(path: string, limit = 20): Promise<Array<{ commit: string; author: string; date: string; subject: string }>> {
    safePath(path);
    const log = await this.#git(["log", "--follow", `-n${limit}`, "--format=%H%x1f%an%x1f%aI%x1f%s", "--", path], { allowFail: true });
    if (log.code !== 0) return [];
    return log.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [commit = "", author = "", date = "", subject = ""] = line.split("\x1f");
        return { commit, author, date, subject };
      });
  }

  /** The content of a blob by SHA, or `null` if the clone does not have it. Reads objects only. */
  async readBlob(sha: string): Promise<Buffer | null> {
    if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) return null;
    const type = await this.#git(["cat-file", "-t", sha], { allowFail: true });
    if (type.code !== 0 || type.stdout.trim() !== "blob") return null;
    return (await this.#git(["cat-file", "blob", sha])).stdoutBuffer;
  }

  status(): Promise<WriteStatus> {
    return this.#enqueue(async () => {
      const head = (await this.#git(["rev-parse", "HEAD"])).stdout.trim();
      const branches = (await this.#git(["for-each-ref", "--format=%(refname:short)", "refs/heads/octosprout/pending/"])).stdout
        .split("\n")
        .filter(Boolean);
      return { head, pending: await this.#ahead(), pendingBranches: branches };
    });
  }

  /**
   * Retries pending pushes in the background (§8.3): every `intervalMs`, backing
   * off up to `maxBackoffMs` while pushes keep failing.
   */
  startBackgroundSync(
    options: {
      intervalMs?: number;
      maxBackoffMs?: number;
      /** Called after every successful sync, so callers can refresh what they derived from the tree. */
      onSynced?: (result: SyncResult) => void | Promise<void>;
      onError?: (error: unknown) => void;
    } = {},
  ): { stop: () => void } {
    const interval = options.intervalMs ?? 60_000;
    const maxBackoff = options.maxBackoffMs ?? 15 * 60_000;
    let delay = interval;
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const tick = async (): Promise<void> => {
      try {
        const result = await this.sync();
        await options.onSynced?.(result);
        delay = result.pending > 0 ? Math.min(delay * 2, maxBackoff) : interval;
      } catch (error) {
        options.onError?.(error);
        delay = Math.min(delay * 2, maxBackoff);
      }
      if (!stopped) {
        timer = setTimeout(() => void tick(), delay);
        timer.unref();
      }
    };
    timer = setTimeout(() => void tick(), delay);
    timer.unref();
    return {
      stop: () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Queue and lock

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(task);
    this.#tail = result.catch(() => {});
    return result;
  }

  async #withLock<T>(task: () => Promise<T>): Promise<T> {
    const release = await acquireFileLock(join(this.#repoDir, ".git", "octosprout.lock"), this.#lockTimeoutMs);
    try {
      return await task();
    } finally {
      await release();
    }
  }

  // -------------------------------------------------------------------------
  // Git helpers

  #git(args: readonly string[], options?: GitOptions): Promise<GitResult> {
    return runGit(this.#repoDir, [...this.#identity, ...args], options);
  }

  #network(args: readonly string[]): Promise<GitResult> {
    return this.#git(args, { allowFail: true, timeoutMs: this.#networkTimeoutMs });
  }

  async #assertBranch(): Promise<void> {
    const current = (await this.#git(["symbolic-ref", "--short", "HEAD"])).stdout.trim();
    if (current !== this.#branch) {
      throw new Error(`The write clone must have '${this.#branch}' checked out, found '${current}'.`);
    }
  }

  get #remoteRef(): string {
    return `${this.#remote}/${this.#branch}`;
  }

  async #hasRemoteRef(): Promise<boolean> {
    return (await this.#git(["rev-parse", "--verify", "-q", this.#remoteRef], { allowFail: true })).code === 0;
  }

  /** Number of local commits not on the remote branch. */
  async #ahead(): Promise<number> {
    const range = (await this.#hasRemoteRef()) ? `${this.#remoteRef}..HEAD` : "HEAD";
    return Number((await this.#git(["rev-list", "--count", range])).stdout.trim());
  }

  /** The blob SHA of `path` at `rev`, or `null` if it does not exist there. */
  async #blobAt(rev: string, path: string): Promise<string | null> {
    const result = await this.#git(["rev-parse", "--verify", "-q", `${rev}:${path}`], { allowFail: true });
    return result.code === 0 ? result.stdout.trim() : null;
  }

  async #contentAt(rev: string, path: string): Promise<Buffer | null> {
    const sha = await this.#blobAt(rev, path);
    return sha === null ? null : (await this.#git(["cat-file", "blob", sha])).stdoutBuffer;
  }

  // -------------------------------------------------------------------------
  // Steps 2 and 3: fetch, then rebase or fast-forward

  async #syncWithRemote(): Promise<{ online: boolean; quarantined?: string }> {
    const fetched = await this.#network(["fetch", this.#remote]);
    if (fetched.code !== 0) return { online: false };
    const quarantined = await this.#rebaseOntoRemote();
    return quarantined === undefined ? { online: true } : { online: true, quarantined };
  }

  /** Rebases onto the remote branch. On conflict, preserves the local commits on a pending branch. */
  async #rebaseOntoRemote(): Promise<string | undefined> {
    if (!(await this.#hasRemoteRef())) return undefined;
    const rebased = await this.#git(["rebase", this.#remoteRef], { allowFail: true });
    if (rebased.code === 0) return undefined;
    await this.#git(["rebase", "--abort"], { allowFail: true });
    return this.#quarantine();
  }

  /** Moves unpushed commits to `octosprout/pending/<timestamp>` and resets to the remote (§8.3). */
  async #quarantine(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[-:.]/g, "");
    let name = `octosprout/pending/${stamp}`;
    for (let n = 1; (await this.#git(["rev-parse", "--verify", "-q", `refs/heads/${name}`], { allowFail: true })).code === 0; n++) {
      name = `octosprout/pending/${stamp}-${n}`;
    }
    // The commits stay reachable from the new branch, so nothing is discarded.
    await this.#git(["branch", name, "HEAD"]);
    await this.#git(["reset", "--hard", this.#remoteRef]);
    return name;
  }

  // -------------------------------------------------------------------------
  // The write algorithm (§8.3)

  async #write(operation: WriteOperation): Promise<WriteResult> {
    const changes = operation.changes.map((change) => ({ ...change, path: safePath(change.path) }));
    for (const precondition of operation.preconditions ?? []) safePath(precondition.path);
    if (changes.length === 0) throw new InvalidOperationError("An operation needs at least one change.");

    await this.#assertBranch();
    await this.#syncWithRemote();
    await this.#checkPreconditions("HEAD", operation);

    const baseline = this.#errorKeys(this.#validateTree());
    const touched = [...new Set(changes.map((change) => change.path))];
    try {
      this.#applyChanges(changes);
      this.#assertNoNewErrors(baseline);
      await this.#git(["add", "-A", "--", ...touched]);
      if ((await this.#git(["diff", "--cached", "--quiet"], { allowFail: true })).code === 0) {
        return { status: "unchanged" };
      }
      await this.#git(["commit", "-q", "-F", "-"], { input: commitMessage(operation) });
    } catch (error) {
      await this.#restore(touched);
      throw error;
    }

    const outcome = await this.#pushWithRetry(operation);
    const commit = (await this.#git(["rev-parse", "HEAD"])).stdout.trim();
    return { status: outcome.pushed ? "committed" : "pending", commit };
  }

  async #checkPreconditions(rev: string, operation: WriteOperation): Promise<void> {
    for (const { path, baseBlob } of operation.preconditions ?? []) {
      const actual = await this.#blobAt(rev, path);
      if (actual !== baseBlob) {
        throw new ConflictError(path, baseBlob, actual, await this.#contentAt(rev, path));
      }
    }
  }

  #applyChanges(changes: readonly (FileChange & { path: string })[]): void {
    for (const change of changes) {
      const target = join(this.#repoDir, change.path);
      if ("delete" in change) {
        rmSync(target, { force: true });
      } else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, change.content);
      }
    }
  }

  /** Restores only the paths an operation touched, and removes files it created. */
  async #restore(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      if ((await this.#blobAt("HEAD", path)) !== null) {
        await this.#git(["restore", "--source=HEAD", "--staged", "--worktree", "--", path]);
      } else {
        await this.#git(["rm", "-q", "--cached", "--ignore-unmatch", "--", path]);
        rmSync(join(this.#repoDir, path), { force: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Validation (steps 7 and 8.1)

  #validateTree(): Finding[] {
    return this.#validate(readWorkspaceFiles(this.#repoDir));
  }

  #errorKeys(findings: readonly Finding[]): Set<string> {
    return new Set(findings.filter((f) => f.severity === "error").map(BASELINE_KEY));
  }

  /** A write may not add errors, but it may leave existing ones in place or fix them. */
  #assertNoNewErrors(baseline: ReadonlySet<string>): void {
    const added = this.#validateTree().filter((f) => f.severity === "error" && !baseline.has(BASELINE_KEY(f)));
    if (added.length > 0) throw new ValidationRejectedError(added);
  }

  /** Validates the tree at `rev` without touching the working tree. */
  async #findingsAt(rev: string): Promise<Finding[]> {
    const dir = mkdtempSync(join(tmpdir(), "octosprout-tree-"));
    try {
      await execFileAsync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", this.#repoDir, rev, dir], {
        maxBuffer: 1 << 20,
      });
      return this.#validate(readWorkspaceFiles(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------------------
  // Step 9: push, with retry after a non-fast-forward rejection

  /**
   * Pushes HEAD. With `operation`, HEAD is that operation's commit: after each
   * rebase its preconditions and validation are re-checked, and the commit is
   * dropped (it is still unpushed) if they no longer hold.
   */
  async #pushWithRetry(operation: WriteOperation | undefined): Promise<{ pushed: boolean; quarantined?: string }> {
    for (let attempt = 0; ; attempt++) {
      await this.#onBeforePush?.(attempt);
      const pushed = await this.#network(["push", this.#remote, `HEAD:refs/heads/${this.#branch}`]);
      if (pushed.code === 0) return { pushed: true };
      if (!NON_FAST_FORWARD.test(pushed.stderr) || attempt >= this.#maxPushRetries) {
        return { pushed: false };
      }

      await sleep(this.#retryBaseMs * 2 ** attempt + randomInt(0, Math.max(this.#retryBaseMs, 1)));
      if ((await this.#network(["fetch", this.#remote])).code !== 0) return { pushed: false };

      const rebased = await this.#git(["rebase", this.#remoteRef], { allowFail: true });
      if (rebased.code !== 0) {
        await this.#git(["rebase", "--abort"], { allowFail: true });
        if (operation === undefined) {
          const quarantined = await this.#quarantine();
          return { pushed: (await this.#ahead()) === 0, quarantined };
        }
        await this.#dropHeadCommit();
        const touched = operation.changes.map((change) => change.path);
        await this.#rebaseOntoRemote();
        throw await this.#conflictFor(touched[0] ?? "", operation);
      }

      if (operation !== undefined) await this.#recheckAfterRebase(operation);
    }
  }

  async #recheckAfterRebase(operation: WriteOperation): Promise<void> {
    try {
      await this.#checkPreconditions("HEAD~1", operation);
      const baseline = this.#errorKeys(await this.#findingsAt("HEAD~1"));
      this.#assertNoNewErrors(baseline);
    } catch (error) {
      await this.#dropHeadCommit();
      throw error;
    }
  }

  /** Removes our own, still-unpushed commit from the branch. */
  async #dropHeadCommit(): Promise<void> {
    await this.#git(["reset", "--hard", "HEAD~1"]);
  }

  async #conflictFor(path: string, operation: WriteOperation): Promise<Error> {
    for (const precondition of operation.preconditions ?? []) {
      const actual = await this.#blobAt("HEAD", precondition.path);
      if (actual !== precondition.baseBlob) {
        return new ConflictError(precondition.path, precondition.baseBlob, actual, await this.#contentAt("HEAD", precondition.path));
      }
    }
    return new ConflictError(path, null, await this.#blobAt("HEAD", path), await this.#contentAt("HEAD", path));
  }
}

function commitMessage(operation: WriteOperation): string {
  const trailers = [
    `OctoSprout-Operation: ${operation.operation}`,
    `OctoSprout-Actor: ${operation.actor}`,
    ...(operation.proposal ? [`OctoSprout-Proposal: ${operation.proposal}`] : []),
  ];
  return `${operation.subject}\n\n${trailers.join("\n")}\n`;
}

/** Clients never choose arbitrary paths (§15.2): reject anything outside the workspace or inside `.git`. */
function safePath(path: string): string {
  const segments = path.split("/");
  if (
    path === "" ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.toLowerCase() === ".git")
  ) {
    throw new InvalidOperationError(`Invalid path: ${JSON.stringify(path)}`);
  }
  return path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
