/**
 * A workspace checkout on the Mac (spec §8.5): the record index, Git, and
 * the write rules the CLI and the MCP server share.
 *
 * - Every write is validated before it is committed; a write that adds
 *   validation errors is refused (§8.1).
 * - Commits touch only the files of the operation and use the local Git
 *   identity, with the trailers of §8.6.
 * - An agent (`OCTOSPROUT_ACTOR=agent:<name>`) never changes records: every
 *   write becomes a proposal (§9.1). A person's routine writes commit
 *   directly; consequential ones become proposals to approve in the browser.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  applyOperations,
  classifyOperations,
  CONFIG_PATH,
  generateId,
  gitBlobSha,
  parseWorkspaceConfig,
  proposalPath,
  readWorkspaceFiles,
  RecordIndex,
  renderProposal,
  validateWorkspace,
  workspaceLookup,
  type Classification,
  type FileChange,
  type Finding,
  type Operation,
  type SourceFile,
  type WorkspaceConfig,
  type WorkspaceLookup,
} from "@octosprout/core";

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly findings: readonly Finding[] = [],
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

/** `agent:<name>` from OCTOSPROUT_ACTOR, else `cli` (a person at the keyboard). */
export function actorFrom(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.OCTOSPROUT_ACTOR?.trim();
  if (!value) return "cli";
  if (!/^agent:[A-Za-z0-9._-]{1,64}$/.test(value)) throw new WorkspaceError(`OCTOSPROUT_ACTOR must look like agent:<name>, got '${value}'.`);
  return value;
}

export const isAgent = (actor: string): boolean => actor.startsWith("agent:");

export type WriteOutcome =
  /** Committed directly to the local checkout. */
  | { kind: "committed"; commit: string; changed: string[] }
  /** Written as a pending proposal, to approve in the browser. */
  | { kind: "proposed"; proposal: string; commit: string; consequential: boolean; reasons: string[] };

const BASELINE_KEY = (f: Finding): string => `${f.code}|${f.path}|${f.message}`;

export class Workspace {
  readonly root: string;
  #index: RecordIndex | undefined;

  private constructor(root: string) {
    this.root = root;
  }

  /** The workspace containing `dir`: the Git top level, which must hold octosprout.yaml. */
  static open(dir: string): Workspace {
    let root: string;
    try {
      root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      throw new WorkspaceError(`${resolve(dir)} is not inside a Git checkout of a workspace.`);
    }
    if (!existsSync(join(root, CONFIG_PATH))) throw new WorkspaceError(`${root} has no ${CONFIG_PATH}; run \`octosprout init\` there first.`);
    return new Workspace(root);
  }

  get index(): RecordIndex {
    this.#index ??= new RecordIndex(readWorkspaceFiles(this.root));
    return this.#index;
  }

  config(): WorkspaceConfig {
    return parseWorkspaceConfig(readFileSync(join(this.root, CONFIG_PATH), "utf8")).config;
  }

  /** Any workspace file, as proposals see it. Never outside the checkout or inside .git. */
  readFile(path: string): { path: string; text: string; blob: string } | undefined {
    if (path === "" || path.startsWith("/") || path.includes("\\") || path.split("/").some((s) => s === "" || s === "." || s === ".." || s.toLowerCase() === ".git")) return undefined;
    try {
      const content = readFileSync(join(this.root, path));
      return { path, text: content.toString("utf8"), blob: gitBlobSha(content) };
    } catch {
      return undefined;
    }
  }

  lookup(): WorkspaceLookup {
    return workspaceLookup(this.index, (path) => this.readFile(path));
  }

  git(args: readonly string[], input?: string): string {
    try {
      return execFileSync("git", args, { cwd: this.root, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      throw new WorkspaceError(`git ${args[0]} failed${stderr ? `: ${stderr}` : ""}`);
    }
  }

  head(): string {
    return this.git(["rev-parse", "HEAD"]);
  }

  now(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  newId(type: Parameters<typeof generateId>[0], taken: ReadonlySet<string> = new Set()): string {
    return generateId(type, { exists: (id) => this.index.has(id) || taken.has(id) });
  }

  /** What applying `operations` now would change, and whether it is consequential. */
  plan(operations: readonly Operation[]): { changes: FileChange[]; classification: Classification } {
    const lookup = this.lookup();
    const applied = applyOperations(operations, lookup, this.now());
    if (!applied.ok) throw new WorkspaceError(applied.message);
    return { changes: applied.changes, classification: classifyOperations(operations, lookup, applied, this.config().bulkThreshold) };
  }

  /**
   * Makes a change: committed directly when a person makes a routine one,
   * otherwise written as a proposal.
   */
  write(input: { operations: readonly Operation[]; title: string; rationale: string; actor: string; operation: string; subject: string }): WriteOutcome {
    const { changes, classification } = this.plan(input.operations);
    if (isAgent(input.actor) || classification.consequential) {
      return this.propose({ title: input.title, rationale: input.rationale, operations: input.operations, actor: input.actor });
    }
    const commit = this.commit(changes, { operation: input.operation, actor: input.actor, subject: input.subject });
    return { kind: "committed", commit, changed: changes.map((c) => c.path) };
  }

  /** Commits a pending proposal file (only that file, §16.3). */
  propose(input: { title: string; rationale: string; operations: readonly Operation[]; actor: string; session?: string }): WriteOutcome & { kind: "proposed" } {
    if (input.operations.length === 0) throw new WorkspaceError("A proposal needs at least one operation.");
    const { classification } = this.plan(input.operations);
    const now = this.now();
    const id = this.newId("proposal");
    const path = proposalPath(id, now);
    const text = renderProposal({
      id,
      title: input.title,
      actor: input.actor,
      ...(input.session ? { session: input.session } : {}),
      baseCommit: this.head(),
      consequential: classification.consequential,
      operations: input.operations,
      rationale: input.rationale,
      now,
    });
    const commit = this.commit([{ path, content: text }], { operation: "propose", actor: input.actor, subject: `propose: ${id} ${input.title}`, proposal: id });
    return { kind: "proposed", proposal: id, commit, consequential: classification.consequential, reasons: classification.reasons };
  }

  /**
   * Validates the workspace with `changes` applied, writes them, and commits
   * exactly those paths. Refuses a change that adds validation errors.
   */
  commit(changes: readonly FileChange[], meta: { operation: string; actor: string; subject: string; proposal?: string }): string {
    const before = readWorkspaceFiles(this.root);
    const after = new Map<string, SourceFile>(before.map((f) => [f.path, f]));
    for (const change of changes) {
      if ("delete" in change) after.delete(change.path);
      else after.set(change.path, { path: change.path, content: change.content });
    }
    const baseline = new Set(validateWorkspace(before).filter((f) => f.severity === "error").map(BASELINE_KEY));
    const added = validateWorkspace([...after.values()]).filter((f) => f.severity === "error" && !baseline.has(BASELINE_KEY(f)));
    if (added.length > 0) throw new WorkspaceError(`The change would add ${added.length} validation error(s).`, added);

    for (const change of changes) {
      const target = join(this.root, change.path);
      if ("delete" in change) rmSync(target, { force: true });
      else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, change.content);
      }
    }
    const paths = changes.map((c) => c.path);
    const trailers = [`OctoSprout-Operation: ${meta.operation}`, `OctoSprout-Actor: ${meta.actor}`, ...(meta.proposal ? [`OctoSprout-Proposal: ${meta.proposal}`] : [])];
    this.git(["add", "-A", "--", ...paths]);
    this.git(["commit", "-q", "-F", "-", "--", ...paths], `${meta.subject}\n\n${trailers.join("\n")}\n`);
    this.#index = undefined;
    return this.head();
  }

  /**
   * `octosprout sync` (§8.5): fetch, rebase, and push only if validation
   * passes. Returns what happened.
   */
  sync(options: { remote?: string; branch?: string } = {}): { pushed: boolean; findings: Finding[] } {
    const remote = options.remote ?? "origin";
    const branch = options.branch ?? (this.git(["symbolic-ref", "--short", "HEAD"]) || "main");
    this.git(["fetch", "-q", remote]);
    let hasRemoteBranch = true;
    try {
      this.git(["rev-parse", "--verify", "-q", `${remote}/${branch}`]);
    } catch {
      hasRemoteBranch = false;
    }
    if (hasRemoteBranch) this.git(["rebase", "-q", `${remote}/${branch}`]);
    this.#index = undefined;
    const findings = validateWorkspace(readWorkspaceFiles(this.root));
    if (findings.some((f) => f.severity === "error")) return { pushed: false, findings };
    this.git(["push", "-q", remote, `HEAD:refs/heads/${branch}`]);
    return { pushed: true, findings };
  }
}
