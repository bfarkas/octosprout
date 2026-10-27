/**
 * The operations behind the typed workflows, shared by the CLI commands and
 * the MCP tools so both build exactly the same changes.
 */
import {
  buildNewRecord,
  planPromotion,
  planTriage,
  prefillFromCapture,
  promotionBrief,
  type CreatableType,
  type IndexedRecord,
  type Operation,
} from "@octosprout/core";

import { Workspace, WorkspaceError } from "./workspace.js";

export function findRecord(ws: Workspace, id: string): IndexedRecord {
  const record = ws.index.get(id);
  if (!record) throw new WorkspaceError(`There is no record ${id}.`);
  return record;
}

export interface DraftInput {
  type: CreatableType;
  title: string;
  body?: string | undefined;
  project?: string | undefined;
  supersedes?: string | undefined;
}

/** A new record with a fresh ID, from its template; nothing is written. */
export function draftRecord(ws: Workspace, input: DraftInput): { id: string; path: string; content: string } {
  const project = input.project ? findRecord(ws, input.project) : undefined;
  const supersedes = input.supersedes ? findRecord(ws, input.supersedes) : undefined;
  if (project && project.type !== "project") throw new WorkspaceError(`${project.id} is not a project.`);
  if (supersedes && supersedes.type !== "decision") throw new WorkspaceError(`${supersedes.id} is not a decision.`);
  const id = ws.newId(input.type);
  const author = ws.config().author;
  const { path, content } = buildNewRecord({
    type: input.type,
    id,
    title: input.title,
    now: ws.now(),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(project ? { project: project.id } : {}),
    ...(supersedes ? { supersedes: supersedes.id } : {}),
    ...(author ? { author } : {}),
  });
  return { id, path, content };
}

export type TriageInput =
  | { capture: string; action: "create"; type: "idea" | "task" | "research"; title?: string | undefined; body?: string | undefined }
  | { capture: string; action: "attach"; target: string }
  | { capture: string; action: "compost" };

/** A triage (§7.1): its title and operations, and the ID of a record it creates. */
export function triagePlan(ws: Workspace, input: TriageInput): { title: string; operations: Operation[]; created?: string } {
  const capture = findRecord(ws, input.capture);
  switch (input.action) {
    case "create": {
      const prefill = prefillFromCapture(input.type, capture.body);
      const id = ws.newId(input.type);
      const title = input.title?.trim() || prefill.title;
      const operations = planTriage(capture, { action: "create", type: input.type, id, title, body: input.body ?? prefill.body, now: ws.now() });
      return { title: `Triage ${capture.id}: ${input.type} ${title}`, operations, created: id };
    }
    case "attach": {
      const target = findRecord(ws, input.target);
      return { title: `Triage ${capture.id}: attach to ${target.id}`, operations: planTriage(capture, { action: "attach", target }) };
    }
    case "compost":
      return { title: `Triage ${capture.id}: compost`, operations: planTriage(capture, { action: "compost" }) };
  }
}

export interface PromotionInput {
  idea: string;
  projectTitle: string;
  projectStatus?: "proposed" | "active" | undefined;
  brief?: string | undefined;
  tasks?: readonly string[] | undefined;
}

/** A promotion (§10): its title and operations, and the new project's ID. */
export function promotionPlan(ws: Workspace, input: PromotionInput): { title: string; operations: Operation[]; project: string } {
  const idea = findRecord(ws, input.idea);
  if (idea.type !== "idea" || idea.status !== "ready") throw new WorkspaceError(`${idea.id} is not a ready idea.`);
  const taken = new Set<string>();
  const fresh = (type: "project" | "task") => {
    const id = ws.newId(type, taken);
    taken.add(id);
    return id;
  };
  const research = ws.index.backlinks(idea.id).filter((b) => b.rel === "supports" && b.source.type === "research").map((b) => b.source);
  const project = fresh("project");
  const operations = planPromotion({
    idea,
    project: { id: project, title: input.projectTitle, status: input.projectStatus ?? "proposed", body: input.brief ?? promotionBrief(idea.id, research) },
    tasks: (input.tasks ?? []).map((title) => ({ id: fresh("task"), title })),
    now: ws.now(),
  });
  return { title: `Promote ${idea.id} to ${input.projectTitle}`, operations, project };
}
