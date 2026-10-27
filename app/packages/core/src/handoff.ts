/**
 * Coding-agent handoff (spec §11.3) and outcome reporting (§11.4).
 *
 * `handoffContext` assembles the Markdown bundle a coding agent starts
 * from: generated on demand and never committed. `planHandoffReport` turns
 * the agent's report into proposal operations on the task.
 */
import { appendToSection } from "./advice.js";
import type { Operation } from "./proposals.js";
import { parseRecord, setFrontmatterFields } from "./record.js";
import type { IndexedRecord, RecordIndex, Ref } from "./record-index.js";
import { findSection } from "./sections.js";
import { DEFAULT_TEMPLATES_DIR, newRecord, recordPath, templateBody } from "./templates.js";
import { addLink } from "./triage.js";

const SETTLED_DECISIONS = new Set(["ACCEPTED", "ADOPTED"]);

/** Moves every Markdown heading outside code fences `by` levels down, so embedded records nest under the bundle's headings. */
export function demoteHeadings(markdown: string, by: number): string {
  let fence: string | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && (fence === undefined || marker.startsWith(fence))) {
        fence = fence === undefined ? marker : undefined;
        return line;
      }
      if (fence !== undefined) return line;
      const heading = /^(#{1,6})(\s.*)$/.exec(line);
      return heading ? `${"#".repeat(Math.min(6, heading[1]!.length + by))}${heading[2]}` : line;
    })
    .join("\n");
}

/** The first paragraph of a research record's Summary, else of its body (§11.3). */
export function firstParagraph(body: string): string {
  const summary = findSection(body, "Summary")?.content ?? "";
  const source = summary.trim() ? summary : body;
  const paragraphs = source.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "" && !/^#{1,6}\s/.test(p));
  return (paragraphs[0] ?? "").replace(/\s+/g, " ");
}

const repoRefs = (record: IndexedRecord | undefined): Ref[] => (record?.refs ?? []).filter((r) => r.kind === "repo");

/** The task's parent project, through `belongs_to`. */
export function parentProject(index: RecordIndex, task: IndexedRecord): IndexedRecord | undefined {
  const link = task.links.find((l) => l.rel === "belongs_to");
  const project = link ? index.get(link.id) : undefined;
  return project?.type === "project" ? project : undefined;
}

/** The handoff bundle for a task (§11.3), as Markdown. */
export function handoffContext(index: RecordIndex, taskId: string, now: string): string {
  const task = index.get(taskId);
  if (!task || task.type !== "task") throw new Error(`${taskId} is not a task.`);
  const project = parentProject(index, task);

  const implemented = task.links.filter((l) => l.rel === "implements").map((l) => index.get(l.id));
  const ofProject = project ? index.backlinks(project.id).filter((b) => b.rel === "belongs_to" && b.source.type === "decision").map((b) => b.source) : [];
  const decisions = [...new Map([...implemented, ...ofProject].filter((d): d is IndexedRecord => d?.type === "decision" && SETTLED_DECISIONS.has(d.status)).map((d) => [d.id, d])).values()].sort((a, b) => a.id.localeCompare(b.id));

  const research = [...new Map([task, ...(project ? [project] : [])].flatMap((r) => index.backlinks(r.id)).filter((b) => b.rel === "supports" && b.source.type === "research").map((b) => [b.source.id, b.source])).values()].sort((a, b) => a.id.localeCompare(b.id));

  const repos = repoRefs(task).length > 0 ? repoRefs(task) : repoRefs(project);
  const repoList = repos.map((r) => `${r.url}${r.note ? ` (${r.note})` : ""}`);

  const out: string[] = [
    `# Handoff: ${task.id} ${task.title}`,
    "",
    `Generated ${now} from the OctoSprout workspace. It is not committed: regenerate it with \`octosprout handoff ${task.id}\` rather than editing it.`,
    "",
    "## Instructions",
    "",
    repos.length > 0 ? `1. Open the target repository: ${repoList.join(", ")}.` : "1. No target repository is recorded. Ask the owner which repository this task changes before you change any code.",
    "2. Read its `AGENTS.md`, `CLAUDE.md` and contributing docs before changing anything.",
    "3. Investigate the existing code before you plan.",
    "4. Follow the repository's own workflow, conventions and tests.",
    "5. If the code contradicts the task or a decision below, stop and surface the conflict. Never resolve it silently.",
    `6. Report back from the OctoSprout workspace with \`propose_handoff_report\` (or \`octosprout report ${task.id}\`): the outcome, the verification results, and the commit and PR references.`,
    "",
    `## Task ${task.id}: ${task.title}`,
    "",
    `Status: ${task.status}${project ? ` · Project: ${project.id}` : ""} · ${task.path}`,
    "",
    demoteHeadings(task.body.trim(), 2),
    "",
  ];
  if (project) out.push(`## Project ${project.id}: ${project.title}`, "", `Status: ${project.status} · ${project.path}`, "", demoteHeadings(project.body.trim(), 2), "");

  out.push("## Decisions", "");
  if (decisions.length === 0) out.push("No accepted decisions apply.", "");
  for (const decision of decisions) {
    out.push(`### ${decision.id}: ${decision.title} (${decision.status})`, "", demoteHeadings(decision.body.trim(), 3), "");
    const superseded = decision.links.filter((l) => l.rel === "supersedes").map((l) => index.get(l.id));
    for (const old of superseded) if (old) out.push(`Supersedes ${old.id}: ${old.title} (${old.status}).`, "");
  }

  out.push("## Research", "");
  if (research.length === 0) out.push("No research is linked.", "");
  for (const r of research) out.push(`- **${r.title}** (${r.id}, \`${r.path}\`): ${firstParagraph(r.body) || "no summary"}`);
  if (research.length > 0) out.push("");

  out.push("## Repositories", "", ...(repoList.length > 0 ? repoList.map((r) => `- ${r}`) : ["None recorded."]), "");
  return out.join("\n");
}

export interface HandoffReportInput {
  task: { id: string; blob: string; text: string; status: string };
  outcome: string;
  verification: string;
  /** Pull request URLs (https). */
  prs?: readonly string[];
  /** Commit URLs (https) or SHAs; SHAs become refs only with a GitHub repository to build the URL from. */
  commits?: readonly string[];
  /** The task's new status, if the report moves it. */
  status?: "in_progress" | "done" | "blocked";
  /** Follow-up tasks to draft, each with a fresh ID. */
  followUps?: ReadonlyArray<{ id: string; title: string; objective?: string }>;
  /** The project follow-ups `belongs_to`. */
  project?: string;
  /** The target repository, to turn commit SHAs into URLs. */
  repoUrl?: string;
  /** Who reports, e.g. `agent:claude-code`. */
  actor: string;
  now: string;
}

const isHttps = (url: string) => /^https:\/\/\S+$/.test(url);

/** The operations of a handoff report (§11.4). */
export function planHandoffReport(input: HandoffReportInput, templatesDir = DEFAULT_TEMPLATES_DIR): Operation[] {
  const { task, now } = input;
  if (!input.outcome.trim()) throw new Error("The report needs an outcome.");
  for (const pr of input.prs ?? []) if (!isHttps(pr)) throw new Error(`'${pr}' is not an https URL.`);
  const github = input.repoUrl && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+?(\.git)?\/?$/.test(input.repoUrl) ? input.repoUrl.replace(/(\.git)?\/?$/, "") : undefined;
  const commits = (input.commits ?? []).map((c) => c.trim()).filter(Boolean).map((c) => {
    if (isHttps(c)) return { label: c, url: c };
    if (!/^[0-9a-f]{7,40}$/i.test(c)) throw new Error(`'${c}' is neither a commit SHA nor an https URL.`);
    return { label: `\`${c.slice(0, 12)}\``, url: github ? `${github}/commit/${c}` : undefined };
  });

  const followUps = input.followUps ?? [];
  const references = [...(input.prs ?? []).map((pr) => `PR ${pr}`), ...commits.map((c) => `commit ${c.url ?? c.label}`)];
  const entry = [
    `### ${now.slice(0, 10)}: ${input.status ? `${task.status} → ${input.status}` : task.status} (${input.actor})`,
    "",
    `**Outcome:** ${input.outcome.trim()}`,
    "",
    `**Verification:** ${input.verification.trim() || "Not reported."}`,
    ...(references.length > 0 ? ["", `**References:** ${references.join(", ")}`] : []),
    ...(followUps.length > 0 ? ["", `**Follow-ups:** ${followUps.map((f) => `${f.id} ${f.title}`).join("; ")}`] : []),
  ];
  const withLog = /^## Handoff log[ \t]*$/m.test(task.text) ? task.text : `${task.text.replace(/\n*$/, "\n")}\n## Handoff log\n`;
  let text = appendToSection(withLog, "Handoff log", ["", ...entry]);

  const parsed = parseRecord(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const refs = Array.isArray(parsed.record.frontmatter.refs) ? (parsed.record.frontmatter.refs as Ref[]) : [];
  const added = [
    ...(input.prs ?? []).map((url) => ({ kind: "pr", url })),
    ...commits.filter((c): c is { label: string; url: string } => c.url !== undefined).map((c) => ({ kind: "commit", url: c.url })),
  ].filter((ref) => !refs.some((r) => r.url === ref.url));
  text = setFrontmatterFields(text, { ...(added.length > 0 ? { refs: [...refs, ...added] } : {}), updated: now });

  const operations: Operation[] = [{ op: "update", id: task.id, base_blob: task.blob, content: text }];
  if (input.status && input.status !== task.status) operations.push({ op: "set_status", id: task.id, base_blob: task.blob, status: input.status });
  for (const followUp of followUps) {
    const body = followUp.objective?.trim() ? templateBody("task", templatesDir).replace(/^## Objective\n/m, `## Objective\n\n${followUp.objective.trim()}\n`) : undefined;
    let content = newRecord("task", { id: followUp.id, title: followUp.title, now, ...(body ? { body } : {}) }, templatesDir);
    if (input.project) content = addLink(content, { rel: "belongs_to", id: input.project }, now);
    content = addLink(content, { rel: "relates_to", id: task.id }, now);
    operations.push({ op: "create", path: recordPath("task", followUp.id, followUp.title), content });
  }
  return operations;
}
