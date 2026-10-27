/**
 * Editing a record from the browser (spec §8.4, §12.2): a form edit or the
 * whole file, saved with the `base_blob` the editor was loaded from. A stale
 * base is a 409 with the base, current and submitted versions.
 */
import { applyFormEdit, checkEdit, parseRecord, setFrontmatterFields, type FormEdit, type Operation } from "@octosprout/core";

import { ConflictError, ValidationRejectedError, type WriteResult } from "../git/write-service.js";
import { formatTimestamp } from "../inbox/capture.js";
import type { StatusMoveDeps } from "./status.js";

export interface EditRequest {
  id: string;
  baseBlob: string;
  actor: string;
  /** Either a form edit… */
  form?: FormEdit;
  /** …or the whole new file. */
  content?: string;
}

export type EditOutcome =
  | { kind: "saved"; status: "committed" | "pending"; commit: string; base_blob: string }
  | { kind: "unchanged" }
  | { kind: "not_found" }
  | { kind: "forbidden"; field?: string; message: string }
  /** `operations` make the edit as a proposal, which the server applies once approved. */
  | { kind: "approval_required"; message: string; operations: Operation[] }
  | { kind: "conflict"; path: string; base: string | null; current: string | null; submitted: string | null; current_blob: string | null }
  | { kind: "invalid"; findings: ValidationRejectedError["findings"] };

export async function editRecord(deps: StatusMoveDeps, request: EditRequest): Promise<EditOutcome> {
  const { records, writer } = deps;
  const record = records.index.get(request.id);
  if (!record) return { kind: "not_found" };
  const now = formatTimestamp((deps.now ?? (() => new Date()))());

  // What the user wants, applied to the version they started from.
  const submittedFrom = (base: string): string | null => {
    try {
      return request.content ?? applyFormEdit(base, request.form ?? {});
    } catch {
      return null;
    }
  };

  if (record.blob !== request.baseBlob) {
    const base = (await writer.readBlob(request.baseBlob))?.toString("utf8") ?? null;
    return { kind: "conflict", path: record.path, base, current: record.text, submitted: request.content ?? (base === null ? null : submittedFrom(base)), current_blob: record.blob };
  }

  const edited = submittedFrom(record.text);
  if (edited === null) return { kind: "forbidden", message: "The edit could not be applied to the file." };
  if (edited === record.text) return { kind: "unchanged" };
  const check = checkEdit(record.text, edited);
  if (!check.ok) {
    return check.kind === "approval_required"
      ? { kind: "approval_required", message: check.message, operations: [{ op: "update", id: record.id, base_blob: record.blob, content: setFrontmatterFields(edited, { updated: now }) }] }
      : { kind: "forbidden", message: check.message, ...(check.field ? { field: check.field } : {}) };
  }

  const content = setFrontmatterFields(edited, { updated: now });
  const parsed = parseRecord(content);
  const title = parsed.ok && typeof parsed.record.frontmatter.title === "string" ? parsed.record.frontmatter.title : "";
  let result: WriteResult;
  try {
    result = await writer.submit({
      operation: "edit",
      actor: request.actor,
      subject: `edit: ${record.id}${title ? ` ${title}` : ""}`,
      preconditions: [{ path: record.path, baseBlob: record.blob }],
      changes: [{ path: record.path, content }],
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      return { kind: "conflict", path: error.path, base: record.text, current: error.current?.toString("utf8") ?? null, submitted: edited, current_blob: error.actual };
    }
    if (error instanceof ValidationRejectedError) return { kind: "invalid", findings: error.findings };
    throw error;
  }
  if (result.status === "unchanged") return { kind: "unchanged" };
  return { kind: "saved", status: result.status, commit: result.commit, base_blob: records.index.get(record.id)?.blob ?? "" };
}
