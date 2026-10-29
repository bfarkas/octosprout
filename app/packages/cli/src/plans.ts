/**
 * The operations behind the typed workflows, shared by the CLI commands and
 * the MCP tools so both build exactly the same changes.
 */
import {
  buildNewRecord,
  handoffContext,
  parentProject,
  planAdvice,
  planHandoffReport,
  type AdviceEntry,
  planPromotion,
  planTriage,
  prefillFromCapture,
  promotionBrief,
  type CreatableType,
  type IndexedRecord,
  type Operation,
} from "@octosprout/core";

import { z } from "zod";

import type { McpBackend } from "./mcp-backend.js";
import { WorkspaceError } from "./workspace.js";

export function findRecord(ws: McpBackend, id: string): IndexedRecord {
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
export function draftRecord(ws: McpBackend, input: DraftInput): { id: string; path: string; content: string } {
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
export function triagePlan(ws: McpBackend, input: TriageInput): { title: string; operations: Operation[]; created?: string } {
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
export function promotionPlan(ws: McpBackend, input: PromotionInput): { title: string; operations: Operation[]; project: string } {
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

/** The input of `propose_advice` and `octosprout advise`, besides the decision. */
export const ADVICE_SHAPE = {
  model: z.string().min(1).max(100).describe("The model that simulated the experts, e.g. claude-opus-5-5."),
  advice: z
    .array(
      z.object({
        expert: z.string().describe("An active expert profile's ID, or the title of one in new_experts."),
        role: z.string().min(1).max(80).describe("The perspective's role, e.g. Security."),
        advice: z.string().min(1).max(1000).describe("The advice in one or two sentences, for the ## Advice bullet."),
        long_form: z.string().optional().describe("Longer reasoning and evidence; kept in a research record that supports the decision."),
        sources: z.string().optional().describe("Markdown list of sources for the long form."),
      }),
    )
    .min(1)
    .max(20),
  new_experts: z
    .array(z.object({ title: z.string().min(1).max(200), body: z.string().optional().describe("The profile in the expert template's sections.") }))
    .max(10)
    .optional()
    .describe("Profiles to create in the same proposal, kept for reuse."),
  synthesis: z.string().optional().describe("Agreements, disagreements, evidence and recommendations across the perspectives."),
};

export type AdviceInput = z.infer<z.ZodObject<typeof ADVICE_SHAPE>> & { decision: string };

/** An `advise` run (§14): its title and operations. */
export function advicePlan(ws: McpBackend, input: AdviceInput): { title: string; operations: Operation[] } {
  const decision = findRecord(ws, input.decision);
  if (decision.type !== "decision") throw new WorkspaceError(`${decision.id} is not a decision.`);
  const taken = new Set<string>();
  const fresh = (type: "expert" | "research") => {
    const id = ws.newId(type, taken);
    taken.add(id);
    return id;
  };
  const drafted = new Map<string, { id: string; title: string; path: string; content: string }>();
  for (const profile of input.new_experts ?? []) {
    const id = fresh("expert");
    const { path, content } = buildNewRecord({ type: "expert", id, title: profile.title, now: ws.now(), ...(profile.body !== undefined ? { body: profile.body } : {}) });
    drafted.set(profile.title.trim().toLowerCase(), { id, title: profile.title.trim(), path, content });
  }
  const expertFor = (name: string) => {
    const created = drafted.get(name.trim().toLowerCase());
    if (created) return { id: created.id, title: created.title };
    const existing = ws.index.get(name);
    if (existing?.type !== "expert") throw new WorkspaceError(`${name} is neither an expert profile nor one of new_experts.`);
    if (existing.status !== "active") throw new WorkspaceError(`${existing.id} is retired.`);
    return { id: existing.id, title: existing.title };
  };
  const entries: AdviceEntry[] = input.advice.map((a) => ({
    expert: expertFor(a.expert),
    role: a.role,
    advice: a.advice,
    ...(a.long_form?.trim() ? { longForm: { id: fresh("research"), text: a.long_form, ...(a.sources ? { sources: a.sources } : {}) } } : {}),
  }));
  try {
    const operations = planAdvice({
      decision,
      entries,
      model: input.model,
      now: ws.now(),
      newExperts: [...drafted.values()].map(({ path, content }) => ({ path, content })),
      ...(input.synthesis?.trim() ? { synthesis: { id: fresh("research"), text: input.synthesis } } : {}),
    });
    return { title: `Advice on ${decision.id}: ${decision.title}`, operations };
  } catch (error) {
    throw new WorkspaceError((error as Error).message);
  }
}

/** The handoff bundle for a task (§11.3): Markdown, never committed. */
export function handoffBundle(ws: McpBackend, taskId: string): string {
  const task = findRecord(ws, taskId);
  if (task.type !== "task") throw new WorkspaceError(`${task.id} is not a task.`);
  return handoffContext(ws.index, task.id, ws.now());
}

/** The input of `propose_handoff_report` and `octosprout report`, besides the task. */
export const REPORT_SHAPE = {
  outcome: z.string().min(1).describe("What was done, and what was not."),
  verification: z.string().describe("How it was verified: the tests and checks run, and their results."),
  prs: z.array(z.string().regex(/^https:\/\/\S+$/)).max(20).optional().describe("Pull request URLs."),
  commits: z.array(z.string()).max(50).optional().describe("Commit URLs or SHAs."),
  status: z.enum(["in_progress", "done", "blocked"]).optional().describe("Move the task: done when its acceptance criteria are met, blocked when it cannot go on."),
  follow_ups: z
    .array(z.object({ title: z.string().min(1).max(200), objective: z.string().optional() }))
    .max(10)
    .optional()
    .describe("Follow-up tasks to draft in the same project."),
};

export type ReportInput = z.infer<z.ZodObject<typeof REPORT_SHAPE>> & { task: string };

/** A handoff report (§11.4): its title and operations. */
export function reportPlan(ws: McpBackend, input: ReportInput, actor: string): { title: string; operations: Operation[] } {
  const task = findRecord(ws, input.task);
  if (task.type !== "task") throw new WorkspaceError(`${task.id} is not a task.`);
  const project = parentProject(ws.index, task);
  const repoUrl = [...task.refs, ...(project?.refs ?? [])].find((r) => r.kind === "repo")?.url;
  const taken = new Set<string>();
  const followUps = (input.follow_ups ?? []).map((f) => {
    const id = ws.newId("task", taken);
    taken.add(id);
    return { id, title: f.title, ...(f.objective ? { objective: f.objective } : {}) };
  });
  try {
    const operations = planHandoffReport({
      task,
      outcome: input.outcome,
      verification: input.verification,
      ...(input.prs ? { prs: input.prs } : {}),
      ...(input.commits ? { commits: input.commits } : {}),
      ...(input.status ? { status: input.status } : {}),
      followUps,
      ...(project ? { project: project.id } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      actor,
      now: ws.now(),
    });
    return { title: `Report on ${task.id}: ${task.title}${input.status ? ` (${input.status})` : ""}`, operations };
  } catch (error) {
    throw new WorkspaceError((error as Error).message);
  }
}
