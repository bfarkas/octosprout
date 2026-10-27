/**
 * Proposals (spec §9): applying their operations to the workspace, deciding
 * whether they are consequential, and writing the proposal file. Shared by
 * the server (which applies and signs), the CLI and the MCP server (which
 * create proposals).
 */
import { decisionBodySha256 } from "./adr.js";
import { checkEdit } from "./edits.js";
import { parseId } from "./ids.js";
import { moveKind, rewriteStatus } from "./lifecycle.js";
import type { Link } from "./links.js";
import { parseRecord, renderRecord, setFrontmatterFields, type Frontmatter } from "./record.js";
import type { Approval } from "./approvals.js";
import type { RecordType } from "./types.js";

export type Operation =
  | { op: "create"; path: string; content: string }
  | { op: "update"; id?: string; path?: string; base_blob: string; content: string }
  | { op: "set_status"; id: string; base_blob: string; status: string; body_sha256?: string }
  | { op: "add_link"; id: string; base_blob: string; link: Link }
  | { op: "remove_link"; id: string; base_blob: string; link: Link }
  | { op: "delete"; id?: string; path?: string; base_blob: string };

/** What applying needs to know about a file in the workspace. */
export interface WorkspaceFile {
  path: string;
  text: string;
  blob: string;
  /** Record type and status, for files that are records. */
  type?: RecordType;
  status?: string;
}

export interface WorkspaceLookup {
  byId(id: string): WorkspaceFile | undefined;
  byPath(path: string): WorkspaceFile | undefined;
}

export type FileChange = { path: string; content: string } | { path: string; delete: true };

export interface AppliedOperations {
  changes: FileChange[];
  /** One per touched file: the blob it had (or `null` for a file that must not exist yet). */
  preconditions: Array<{ path: string; baseBlob: string | null }>;
  /** Status changes made, in order. */
  statusChanges: Array<{ id: string; path: string; type: RecordType; from: string; to: string }>;
}

export type ApplyResult =
  | ({ ok: true } & AppliedOperations)
  /** A `base_blob` or `create` no longer matches the workspace: the proposal is stale (§9.3). */
  | { ok: false; kind: "stale"; index: number; path: string; message: string }
  | { ok: false; kind: "invalid"; index: number; message: string };

/** Paths whose change is consequential (§9.2 item 6). */
export function isGuardedPath(path: string): boolean {
  return path === "octosprout.yaml" || path === "AGENTS.md" || path === "CLAUDE.md" || path.startsWith("skills/") || path.startsWith("schemas/");
}

/**
 * Applies operations in order to an in-memory copy of the files they touch.
 * Every operation was prepared against the workspace as it was, so each
 * `base_blob` must equal the file's current blob, also when several
 * operations touch the same file. `updated` is set on every record changed.
 */
export function applyOperations(operations: readonly Operation[], lookup: WorkspaceLookup, now: string): ApplyResult {
  const files = new Map<string, { text: string | null; type?: RecordType; status?: string }>();
  const preconditions = new Map<string, string | null>();
  const statusChanges: AppliedOperations["statusChanges"] = [];

  const resolve = (op: { id?: string; path?: string }): WorkspaceFile | undefined => {
    if (op.id !== undefined) {
      const id = parseId(op.id)?.id;
      return id ? lookup.byId(id) : undefined;
    }
    return op.path !== undefined ? lookup.byPath(op.path) : undefined;
  };

  for (const [index, op] of operations.entries()) {
    const stale = (path: string, message: string): ApplyResult => ({ ok: false, kind: "stale", index, path, message });
    const invalid = (message: string): ApplyResult => ({ ok: false, kind: "invalid", index, message });

    if (op.op === "create") {
      if (lookup.byPath(op.path) || files.get(op.path)?.text) return stale(op.path, `${op.path} already exists.`);
      preconditions.set(op.path, null);
      files.set(op.path, { text: op.content });
      continue;
    }

    const file = resolve(op);
    const name = op.id ?? ("path" in op ? op.path : undefined) ?? "";
    if (!file) return stale(name, `${name} does not exist any more.`);
    if (file.blob !== op.base_blob) return stale(file.path, `${file.path} changed since the proposal was prepared.`);
    if (!preconditions.has(file.path)) preconditions.set(file.path, file.blob);
    const current = files.get(file.path) ?? { text: file.text, ...(file.type ? { type: file.type } : {}), ...(file.status !== undefined ? { status: file.status } : {}) };
    if (current.text === null) return invalid(`${file.path} was deleted by an earlier operation.`);

    try {
      switch (op.op) {
        case "update":
          files.set(file.path, { ...current, text: op.content });
          break;
        case "delete":
          files.set(file.path, { ...current, text: null });
          break;
        case "set_status": {
          if (!file.type) return invalid(`${file.path} is not a record.`);
          const from = current.status ?? "";
          files.set(file.path, { ...current, text: rewriteStatus(current.text, op.status, now), status: op.status });
          statusChanges.push({ id: parseId(op.id)!.id, path: file.path, type: file.type, from, to: op.status });
          break;
        }
        case "add_link":
        case "remove_link": {
          const parsed = parseRecord(current.text);
          if (!parsed.ok) return invalid(`${file.path}: ${parsed.error.message}`);
          const links = Array.isArray(parsed.record.frontmatter.links) ? (parsed.record.frontmatter.links as Link[]) : [];
          const target = parseId(op.link.id)?.id ?? op.link.id;
          const same = (l: Link) => l.rel === op.link.rel && parseId(String(l.id))?.id === target;
          const next = op.op === "add_link" ? (links.some(same) ? links : [...links, { rel: op.link.rel, id: target }]) : links.filter((l) => !same(l));
          files.set(file.path, { ...current, text: setFrontmatterFields(current.text, { links: next, updated: now }) });
          break;
        }
      }
    } catch (error) {
      return invalid(`${file.path}: ${(error as Error).message}`);
    }
  }

  const changes: FileChange[] = [];
  for (const [path, file] of files) changes.push(file.text === null ? { path, delete: true } : { path, content: file.text });
  return {
    ok: true,
    changes,
    preconditions: [...preconditions].map(([path, baseBlob]) => ({ path, baseBlob })),
    statusChanges,
  };
}

export interface Classification {
  consequential: boolean;
  /** Why, in words, for the confirmation dialog. */
  reasons: string[];
  /** Records whose consequential state this proposal authorizes; they get `approval: <proposal>`. */
  authorizes: Array<{ id: string; status: string }>;
}

/**
 * Whether applying these operations is consequential (§9.2), judged from
 * the workspace itself rather than the proposal's own `consequential` flag.
 */
export function classifyOperations(operations: readonly Operation[], lookup: WorkspaceLookup, applied: AppliedOperations, bulkThreshold: number): Classification {
  const reasons: string[] = [];
  const authorizes: Classification["authorizes"] = [];

  for (const change of applied.statusChanges) {
    const kind = moveKind(change.type, change.from, change.to);
    if (kind === "approval" || kind === "promotion") {
      reasons.push(`${change.id} moves from ${change.from} to ${change.to}.`);
      authorizes.push({ id: change.id, status: change.to });
    }
  }
  for (const op of operations) {
    if (op.op === "delete") reasons.push(`It deletes ${op.id ?? op.path}.`);
  }
  for (const change of applied.changes) {
    if (isGuardedPath(change.path)) reasons.push(`It changes ${change.path}.`);
    const before = lookup.byPath(change.path);
    if (before?.type === "project" && before.status === "active" && "content" in change) {
      const check = checkEdit(before.text, change.content);
      if (!check.ok && check.kind === "approval_required") reasons.push(check.message);
    }
  }
  const records = applied.changes.filter((c) => /^(records|experts)\//.test(c.path)).length;
  if (records > bulkThreshold) reasons.push(`It touches ${records} records, more than ${bulkThreshold}.`);
  return { consequential: reasons.length > 0, reasons: [...new Set(reasons)], authorizes };
}

const RECORDS_FROZEN_ON = new Set(["ACCEPTED", "SUPERSEDED", "EXPIRED"]);

/**
 * Fills in what the server adds before it signs: the `body_sha256` of a
 * decision that an operation moves to ACCEPTED, SUPERSEDED or EXPIRED (§19
 * OSV007), computed from the body after all operations.
 */
export function completeOperations(operations: readonly Operation[], lookup: WorkspaceLookup, applied: AppliedOperations): Operation[] {
  return operations.map((op) => {
    if (op.op !== "set_status" || !RECORDS_FROZEN_ON.has(op.status)) return op;
    const file = lookup.byId(parseId(op.id)?.id ?? "");
    if (file?.type !== "decision") return op;
    const change = applied.changes.find((c) => c.path === file.path);
    if (!change || !("content" in change)) return op;
    const parsed = parseRecord(change.content);
    return parsed.ok ? { ...op, body_sha256: decisionBodySha256(parsed.record.body) } : op;
  });
}

/** Writes `approval: <proposal>` into each authorized record, among the applied changes. */
export function stampApprovals(applied: AppliedOperations, lookup: WorkspaceLookup, authorizes: Classification["authorizes"], proposalId: string): FileChange[] {
  const paths = new Set(authorizes.map((a) => lookup.byId(a.id)?.path).filter((p): p is string => p !== undefined));
  return applied.changes.map((change) => ("content" in change && paths.has(change.path) ? { path: change.path, content: setFrontmatterFields(change.content, { approval: proposalId }) } : change));
}

export interface NewProposal {
  id: string;
  title: string;
  actor: string;
  session?: string;
  baseCommit: string;
  consequential: boolean;
  operations: readonly Operation[];
  rationale: string;
  now: string;
}

/** `proposals/YYYY/MM/<ID>.md`, by the creation time in UTC. */
export function proposalPath(id: string, created: string): string {
  return `proposals/${created.slice(0, 4)}/${created.slice(5, 7)}/${id}.md`;
}

/** A pending proposal file (§9.3). */
export function renderProposal(proposal: NewProposal): string {
  const frontmatter: Frontmatter = {
    id: proposal.id,
    type: "proposal",
    schema_version: 1,
    status: "pending",
    title: proposal.title,
    created: proposal.now,
    updated: proposal.now,
    origin: { actor: proposal.actor, ...(proposal.session ? { session: proposal.session } : {}) },
    base_commit: proposal.baseCommit,
    consequential: proposal.consequential,
    operations: proposal.operations.map((op) => ({ ...op })),
  };
  return renderRecord(frontmatter, `## Rationale\n${proposal.rationale.trim()}\n`);
}

/** A proposal file after the server's decision: new status, final operations and the signed approval block. */
export function decideProposal(text: string, update: { status: "applied" | "rejected" | "stale"; operations?: readonly Operation[]; approval?: Approval; consequential?: boolean; now: string }): string {
  const parsed = parseRecord(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const frontmatter: Frontmatter = { ...parsed.record.frontmatter, status: update.status, updated: update.now };
  if (update.consequential !== undefined) frontmatter.consequential = update.consequential;
  if (update.operations) frontmatter.operations = update.operations.map((op) => ({ ...op }));
  if (update.approval) frontmatter.approval = { ...update.approval };
  return renderRecord(frontmatter, parsed.record.body);
}

/** Reads a proposal's operations, or `undefined` if they are missing. Shape is the schema's concern. */
export function readOperations(frontmatter: Frontmatter): Operation[] | undefined {
  return Array.isArray(frontmatter.operations) ? (frontmatter.operations as Operation[]) : undefined;
}

/** A lookup over the record index, with other workspace files (such as `AGENTS.md`) read on demand. */
export function workspaceLookup(index: { get(id: string): WorkspaceFile | undefined; byPath(path: string): WorkspaceFile | undefined }, readOther: (path: string) => WorkspaceFile | undefined = () => undefined): WorkspaceLookup {
  return {
    byId: (id) => index.get(id),
    byPath: (path) => index.byPath(path) ?? readOther(path),
  };
}
