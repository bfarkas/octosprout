/**
 * Creating a record from the browser: an idea, task, project, research
 * record or expert profile from its template, or a DRAFT decision from the
 * vendored ADR template (spec §13). Tasks, decisions and research can
 * belong to a project; a decision can supersede another.
 */
import { addLink, generateId, newDecision, newRecord, recordPath, type TemplatedType } from "@octosprout/core";

import { ValidationRejectedError } from "../git/write-service.js";
import { formatTimestamp } from "../inbox/capture.js";
import type { StatusMoveDeps } from "./status.js";

export const CREATABLE = ["idea", "task", "project", "decision", "research", "expert"] as const;
export type CreatableType = (typeof CREATABLE)[number];

/** Types that can `belongs_to` a project (§6.3). */
export const PROJECT_MEMBERS: readonly CreatableType[] = ["task", "decision", "research"];

export interface CreateRequest {
  type: CreatableType;
  title: string;
  /** Replaces the template's body. Not for decisions, which start from the ADR template. */
  body?: string;
  project?: string;
  supersedes?: string;
  /** The decision's `* Author:`; defaults to `author` in octosprout.yaml. */
  author?: string;
  actor: string;
}

export type CreateOutcome =
  | { kind: "created"; id: string; status: "committed" | "pending"; commit: string }
  | { kind: "invalid"; field?: string; message: string; findings?: ValidationRejectedError["findings"] };

export async function createRecord(deps: StatusMoveDeps, request: CreateRequest): Promise<CreateOutcome> {
  const { records, writer } = deps;
  const index = records.index;
  const title = request.title.trim();
  if (!title || [...title].length > 200) return { kind: "invalid", field: "title", message: "A title of 1 to 200 characters is required." };

  let project: string | undefined;
  if (request.project) {
    if (!PROJECT_MEMBERS.includes(request.type)) return { kind: "invalid", field: "project", message: `A ${request.type} does not belong to a project.` };
    const target = index.get(request.project);
    if (target?.type !== "project") return { kind: "invalid", field: "project", message: `${request.project} is not a project.` };
    project = target.id;
  }
  let supersedes: string | undefined;
  if (request.supersedes) {
    const target = index.get(request.supersedes);
    if (request.type !== "decision" || target?.type !== "decision") return { kind: "invalid", field: "supersedes", message: "Only a decision can supersede a decision." };
    supersedes = target.id;
  }

  const now = formatTimestamp((deps.now ?? (() => new Date()))());
  const id = generateId(request.type, { exists: (candidate) => index.has(candidate) });
  const author = request.author?.trim() || records.config().author;
  let content: string;
  if (request.type === "decision") {
    content = newDecision({ id, title, now, ...(author ? { author } : {}), ...(project ? { project } : {}), ...(supersedes ? { supersedes } : {}) });
  } else {
    content = newRecord(request.type as TemplatedType, { id, title, now, ...(request.body !== undefined ? { body: request.body } : {}) });
    if (project) content = addLink(content, { rel: "belongs_to", id: project }, now);
  }
  const path = recordPath(request.type, id, title);

  try {
    const result = await writer.submit({
      operation: "create",
      actor: request.actor,
      subject: `create: ${id} ${title}`,
      preconditions: [{ path, baseBlob: null }],
      changes: [{ path, content }],
    });
    if (result.status === "unchanged") return { kind: "invalid", message: "Nothing was created." };
    return { kind: "created", id, status: result.status, commit: result.commit };
  } catch (error) {
    if (error instanceof ValidationRejectedError) return { kind: "invalid", message: "The new record would not be valid.", findings: error.findings };
    throw error;
  }
}
