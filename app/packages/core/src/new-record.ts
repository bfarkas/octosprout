/**
 * New records from the templates, as the browser, the CLI and the MCP
 * server make them: an idea, task, project, research record or expert
 * profile from its template, or a DRAFT decision from the ADR template.
 * Tasks, decisions and research can belong to a project; a decision can
 * supersede another.
 */
import { newDecision } from "./adr.js";
import { newRecord, recordPath, type TemplatedType } from "./templates.js";
import { addLink } from "./triage.js";

export const CREATABLE_TYPES = ["idea", "task", "project", "decision", "research", "expert"] as const;
export type CreatableType = (typeof CREATABLE_TYPES)[number];

/** Types that can `belongs_to` a project (§6.3). */
export const PROJECT_MEMBER_TYPES: readonly CreatableType[] = ["task", "decision", "research"];

export interface NewRecordInput {
  type: CreatableType;
  id: string;
  title: string;
  now: string;
  /**
   * Replaces the template's body. A decision's must keep the ADR template's
   * structure (§13); its `# ADR … - …` heading is rewritten to name this ID
   * and title, so a body can be written before the ID is known.
   */
  body?: string;
  project?: string;
  supersedes?: string;
  /** A decision's `* Author:`. */
  author?: string;
}

export function buildNewRecord(input: NewRecordInput): { path: string; content: string } {
  const { type, id, title, now } = input;
  let content: string;
  if (type === "decision") {
    content = newDecision({ id, title, now, ...(input.author ? { author: input.author } : {}), ...(input.project ? { project: input.project } : {}), ...(input.supersedes ? { supersedes: input.supersedes } : {}) });
    if (input.body !== undefined) content = content.slice(0, content.indexOf("\n---\n") + 5) + input.body.replace(/^# ADR .*$/m, `# ADR ${id} - ${title}`);
  } else {
    content = newRecord(type as TemplatedType, { id, title, now, ...(input.body !== undefined ? { body: input.body } : {}) });
    if (input.project) content = addLink(content, { rel: "belongs_to", id: input.project }, now);
  }
  return { path: recordPath(type, id, title), content };
}
