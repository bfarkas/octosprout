/**
 * Triage from the browser (spec §7.1, §12.2, D11). Each action is one commit
 * with a precondition on every file it touches:
 *
 *  - create an Idea, Task or Research record that `derived_from` the capture;
 *  - attach the capture to an existing one (adds `derived_from` there);
 *  - compost the capture, or restore a composted one.
 *
 * Creating or attaching plants a `new` capture. A planted capture can be
 * triaged again, into more records.
 */
import {
  addLink,
  generateId,
  newRecord,
  recordPath,
  rewriteStatus,
  TRIAGE_TYPES,
  type IndexedRecord,
} from "@octosprout/core";

import { ConflictError, ValidationRejectedError, type FileChange, type Precondition, type WriteResult } from "../git/write-service.js";
import { formatTimestamp } from "../inbox/capture.js";
import type { StatusMoveDeps } from "./status.js";

export type TriageAction =
  | { action: "create"; type: "idea" | "task" | "research"; title: string; body: string }
  | { action: "attach"; target: string }
  | { action: "compost" }
  | { action: "restore" };

export interface TriageRequest {
  captureId: string;
  /** Blob SHA of the capture when the page was rendered. */
  baseBlob: string;
  actor: string;
  triage: TriageAction;
}

export type TriageOutcome =
  | { kind: "done"; status: "committed" | "pending"; commit: string; id: string }
  | { kind: "not_found" }
  | { kind: "forbidden"; message: string }
  | { kind: "conflict"; path: string; current_blob: string | null }
  | { kind: "invalid"; findings: ValidationRejectedError["findings"] };

export async function triageCapture(deps: StatusMoveDeps, request: TriageRequest): Promise<TriageOutcome> {
  const { records, writer } = deps;
  const index = records.index;
  const capture = index.get(request.captureId);
  if (capture?.type !== "capture") return { kind: "not_found" };
  if (capture.blob !== request.baseBlob) return { kind: "conflict", path: capture.path, current_blob: capture.blob };
  const now = formatTimestamp((deps.now ?? (() => new Date()))());
  const { triage } = request;

  const changes: FileChange[] = [];
  const preconditions: Precondition[] = [{ path: capture.path, baseBlob: capture.blob }];
  const plant = () => {
    if (capture.status === "new") changes.push({ path: capture.path, content: rewriteStatus(capture.text, "planted", now) });
  };
  let subject: string;
  let result: string;

  switch (triage.action) {
    case "create": {
      if (capture.status === "composted") return { kind: "forbidden", message: "Restore the capture before triaging it." };
      if (!(TRIAGE_TYPES as readonly string[]).includes(triage.type)) return { kind: "forbidden", message: `A capture cannot become a ${triage.type}.` };
      const title = triage.title.trim();
      if (title === "") return { kind: "forbidden", message: "The new record needs a title." };
      const id = generateId(triage.type, { exists: (candidate) => index.has(candidate) });
      const path = recordPath(triage.type, id, title);
      const text = addLink(newRecord(triage.type, { id, title, now, body: triage.body }), { rel: "derived_from", id: capture.id }, now);
      changes.push({ path, content: text });
      preconditions.push({ path, baseBlob: null });
      plant();
      subject = `triage: ${capture.id} -> ${id} (${triage.type})`;
      result = id;
      break;
    }
    case "attach": {
      if (capture.status === "composted") return { kind: "forbidden", message: "Restore the capture before triaging it." };
      const target: IndexedRecord | undefined = index.get(triage.target);
      if (!target) return { kind: "forbidden", message: `There is no record ${triage.target}.` };
      if (!(TRIAGE_TYPES as readonly string[]).includes(target.type)) {
        return { kind: "forbidden", message: `A capture can be attached to an idea, task or research record, not a ${target.type}.` };
      }
      changes.push({ path: target.path, content: addLink(target.text, { rel: "derived_from", id: capture.id }, now) });
      preconditions.push({ path: target.path, baseBlob: target.blob });
      plant();
      subject = `triage: ${capture.id} attached to ${target.id}`;
      result = target.id;
      break;
    }
    case "compost":
      if (capture.status !== "new") return { kind: "forbidden", message: `Only a new capture can be composted; this one is ${capture.status}.` };
      changes.push({ path: capture.path, content: rewriteStatus(capture.text, "composted", now) });
      subject = `triage: ${capture.id} composted`;
      result = capture.id;
      break;
    case "restore":
      if (capture.status !== "composted") return { kind: "forbidden", message: "Only a composted capture can be restored." };
      changes.push({ path: capture.path, content: rewriteStatus(capture.text, "new", now) });
      subject = `triage: ${capture.id} restored`;
      result = capture.id;
      break;
  }

  let written: WriteResult;
  try {
    written = await writer.submit({ operation: "triage", actor: request.actor, subject, preconditions, changes });
  } catch (error) {
    if (error instanceof ConflictError) return { kind: "conflict", path: error.path, current_blob: error.actual };
    if (error instanceof ValidationRejectedError) return { kind: "invalid", findings: error.findings };
    throw error;
  }
  if (written.status === "unchanged") return { kind: "forbidden", message: "Nothing changed." };
  return { kind: "done", status: written.status, commit: written.commit, id: result };
}
