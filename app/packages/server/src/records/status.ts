/**
 * Status moves from the boards (spec §7, §12; boards.md §3).
 *
 * A move rewrites `status` and `updated` (and a decision's `* Status:` line)
 * through the write service, with the `base_blob` the page was rendered from.
 * Moving a task to `done` also moves the `blocked` tasks it was the last open
 * blocker of to `ready`, in the same commit (§7.3).
 */
import { isAllowedTransition, moveKind, rewriteStatus, unblockedBy, type MoveKind, type Operation } from "@octosprout/core";

import { formatTimestamp } from "../inbox/capture.js";
import { ConflictError, ValidationRejectedError, type FileChange, type Precondition, type WriteResult } from "../git/write-service.js";
import type { WorkspaceRecords, Writer } from "./workspace.js";

export interface StatusMoveRequest {
  id: string;
  to: string;
  /** Blob SHA of the record when the client read it. */
  baseBlob: string;
  /** `OctoSprout-Actor`, e.g. `user:web`. */
  actor: string;
}

export interface Moved {
  id: string;
  base_blob: string;
}

export type StatusMoveOutcome =
  | { kind: "moved"; status: "committed" | "pending"; commit: string; base_blob: string; unblocked: Moved[] }
  | { kind: "unchanged" }
  | { kind: "not_found" }
  | { kind: "transition"; from: string; to: string }
  /** Consequential, promotion-only, triage-only or server-only moves never commit from here. */
  /** `operations` make the move as a proposal, which the server applies once approved. */
  | { kind: "approval_required"; move: Exclude<MoveKind, "direct"> | "bulk"; from: string; to: string; operations: Operation[] }
  | { kind: "conflict"; path: string; base: string | null; current: string | null; submitted: string | null; current_blob: string | null }
  | { kind: "invalid"; findings: ValidationRejectedError["findings"] };

export interface StatusMoveDeps {
  records: WorkspaceRecords;
  writer: Writer & {
    readBlob(sha: string): Promise<Buffer | null>;
    history(path: string, limit?: number): Promise<Array<{ commit: string; author: string; date: string; subject: string }>>;
  };
  now?: () => Date;
}

/** What a move would also change, for the "Done (+1 unblocked)" preview. */
export function previewMove(records: WorkspaceRecords, id: string, to: string): { unblocked: string[] } {
  const record = records.index.get(id);
  if (record?.type !== "task" || to !== "done") return { unblocked: [] };
  return { unblocked: unblockedBy(record.id, records.index.list("task")) };
}

export async function moveStatus(deps: StatusMoveDeps, request: StatusMoveRequest): Promise<StatusMoveOutcome> {
  const { records, writer } = deps;
  const record = records.index.get(request.id);
  if (!record) return { kind: "not_found" };
  const from = record.status;
  const { to } = request;

  if (from === to && record.blob === request.baseBlob) return { kind: "unchanged" };
  if (!isAllowedTransition(record.type, from, to)) {
    // The client may have read an older status; then the answer is a conflict, not a forbidden move.
    if (record.blob !== request.baseBlob) return conflict(deps, record.path, request, to);
    return { kind: "transition", from, to };
  }
  const kind = moveKind(record.type, from, to);
  if (kind !== "direct") {
    return { kind: "approval_required", move: kind, from, to, operations: [{ op: "set_status", id: record.id, base_blob: request.baseBlob, status: to }] };
  }
  if (record.blob !== request.baseBlob) return conflict(deps, record.path, request, to);

  const updated = formatTimestamp((deps.now ?? (() => new Date()))());
  const changes: FileChange[] = [{ path: record.path, content: rewriteStatus(record.text, to, updated) }];
  const preconditions: Precondition[] = [{ path: record.path, baseBlob: record.blob }];
  const unblocked = record.type === "task" && to === "done" ? unblockedBy(record.id, records.index.list("task")) : [];
  for (const id of unblocked) {
    const task = records.index.get(id)!;
    changes.push({ path: task.path, content: rewriteStatus(task.text, "ready", updated) });
    preconditions.push({ path: task.path, baseBlob: task.blob });
  }
  if (changes.length > records.config().bulkThreshold) {
    const operations: Operation[] = [record.id, ...unblocked].map((id, i) => ({ op: "set_status", id, base_blob: records.index.get(id)!.blob, status: i === 0 ? to : "ready" }));
    return { kind: "approval_required", move: "bulk", from, to, operations };
  }

  const suffix = unblocked.length > 0 ? ` (+${unblocked.length} unblocked)` : "";
  let result: WriteResult;
  try {
    result = await writer.submit({
      operation: "status",
      actor: request.actor,
      subject: `status: ${record.id} ${from} -> ${to}${suffix}`,
      preconditions,
      changes,
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      const current = error.current?.toString("utf8") ?? null;
      const base = await readText(writer, request.baseBlob);
      return { kind: "conflict", path: error.path, base, current, submitted: base === null ? null : safeRewrite(base, to, updated), current_blob: error.actual };
    }
    if (error instanceof ValidationRejectedError) return { kind: "invalid", findings: error.findings };
    throw error;
  }
  if (result.status === "unchanged") return { kind: "unchanged" };

  const blobOf = (id: string): string => records.index.get(id)?.blob ?? "";
  return {
    kind: "moved",
    status: result.status,
    commit: result.commit,
    base_blob: blobOf(record.id),
    unblocked: unblocked.map((id) => ({ id, base_blob: blobOf(id) })),
  };
}

async function conflict(deps: StatusMoveDeps, path: string, request: StatusMoveRequest, to: string): Promise<StatusMoveOutcome> {
  const current = deps.records.index.byPath(path);
  const base = await readText(deps.writer, request.baseBlob);
  return {
    kind: "conflict",
    path,
    base,
    current: current?.text ?? null,
    submitted: base === null ? null : safeRewrite(base, to, formatTimestamp((deps.now ?? (() => new Date()))())),
    current_blob: current?.blob ?? null,
  };
}

async function readText(writer: StatusMoveDeps["writer"], sha: string): Promise<string | null> {
  return (await writer.readBlob(sha))?.toString("utf8") ?? null;
}

function safeRewrite(text: string, to: string, updated: string): string | null {
  try {
    return rewriteStatus(text, to, updated);
  } catch {
    return null;
  }
}
