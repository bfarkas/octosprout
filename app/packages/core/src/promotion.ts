/**
 * Idea-to-project promotion (spec §10): one consequential proposal that
 * creates the project and any initial tasks, links the idea to the project
 * with `promoted_to` and moves it to `transplanted`. The idea stays the
 * record of motivation and exploration; the brief references it.
 */
import type { Operation, WorkspaceFile } from "./proposals.js";
import { addLink } from "./triage.js";
import { setFrontmatterFields } from "./record.js";
import { newRecord, recordPath, templateBody, DEFAULT_TEMPLATES_DIR } from "./templates.js";

export interface PromotionPlan {
  idea: WorkspaceFile & { id: string };
  project: { id: string; title: string; status: "proposed" | "active"; body: string };
  tasks: Array<{ id: string; title: string }>;
  now: string;
}

/** The brief's starting point: the project template with the idea and its research listed under Related. */
export function promotionBrief(ideaId: string, related: ReadonlyArray<{ id: string; title: string }>, templatesDir = DEFAULT_TEMPLATES_DIR): string {
  const lines = [`- Idea ${ideaId}`, ...related.map((r) => `- ${r.title} (${r.id})`)].join("\n");
  return templateBody("project", templatesDir).replace(/^## Related\n/m, `## Related\n\n${lines}\n`);
}

export function planPromotion(plan: PromotionPlan, templatesDir = DEFAULT_TEMPLATES_DIR): Operation[] {
  const { idea, project, now } = plan;
  let projectText = newRecord("project", { id: project.id, title: project.title, now, body: project.body }, templatesDir);
  if (project.status === "active") projectText = setFrontmatterFields(projectText, { status: "active" });
  const projectPath = recordPath("project", project.id, project.title);

  const tasks: Operation[] = plan.tasks.map((task) => {
    let text = newRecord("task", { id: task.id, title: task.title, now }, templatesDir);
    text = addLink(text, { rel: "belongs_to", id: project.id }, now);
    text = addLink(text, { rel: "derived_from", id: idea.id }, now);
    return { op: "create", path: recordPath("task", task.id, task.title), content: text };
  });

  return [
    { op: "create", path: projectPath, content: projectText },
    ...tasks,
    { op: "set_status", id: idea.id, base_blob: idea.blob, status: "transplanted" },
    { op: "add_link", id: idea.id, base_blob: idea.blob, link: { rel: "promoted_to", id: project.id } },
  ];
}
