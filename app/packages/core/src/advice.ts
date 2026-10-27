/**
 * The `advise` workflow (spec §14): simulated expert advice on a decision,
 * as one proposal. Each perspective becomes an attributed `## Advice` bullet
 * marked as simulated and AI-generated; long-form advice and the synthesis
 * become research records that `support` the decision and are listed under
 * `## Supporting Material`; the profiles are linked with `consulted`.
 */
import { adrDate } from "./adr.js";
import type { Operation } from "./proposals.js";
import { DEFAULT_TEMPLATES_DIR, newRecord, recordPath } from "./templates.js";
import { addLink } from "./triage.js";

/** Decision statuses whose body can still change (§7.5): later ones are frozen. */
export const ADVISABLE_STATUSES: readonly string[] = ["DRAFT", "PROPOSED"];

export interface AdviceDecision {
  id: string;
  title: string;
  status: string;
  blob: string;
  /** The whole file. */
  text: string;
}

export interface AdviceExpert {
  id: string;
  title: string;
}

export interface AdviceEntry {
  expert: AdviceExpert;
  /** The perspective's role, e.g. `Security`. */
  role: string;
  /** The advice in one or two sentences, for the `## Advice` bullet. */
  advice: string;
  /** Long-form advice, kept in a research record of its own. */
  longForm?: { id: string; text: string; sources?: string };
}

export interface AdviceInput {
  decision: AdviceDecision;
  entries: readonly AdviceEntry[];
  /** Agreements, disagreements, evidence and recommendations across the perspectives. */
  synthesis?: { id: string; text: string };
  /** Profiles created by this proposal: `{ path, content }` of each. */
  newExperts?: ReadonlyArray<{ path: string; content: string }>;
  /** The model that simulated the experts, e.g. `claude-opus-5-5`. */
  model: string;
  now: string;
}

/** The attribution of §14: `<advice> - <Profile> (simulated, AI-generated, <model>), <Role>, <Date>`. */
export function adviceBullet(entry: Pick<AdviceEntry, "expert" | "role" | "advice">, model: string, now: string): string {
  const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
  return ` * ${oneLine(entry.advice)} - ${oneLine(entry.expert.title)} (simulated, AI-generated, ${oneLine(model)}), ${oneLine(entry.role)}, ${adrDate(now)}`;
}

/**
 * Appends bullets to a level-2 section of a Markdown file, replacing the
 * template's placeholder bullet (`[...]` only) if it is still there.
 */
export function appendToSection(text: string, section: string, bullets: readonly string[]): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === `## ${section}`);
  if (start < 0) throw new Error(`The decision has no '## ${section}' section.`);
  let end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).filter((line) => !/^\s*[*-]\s+\[[^\]]*\](?:\s*-?\s*\[[^\]]*\])*\s*$/.test(line));
  while (body.length > 0 && body[body.length - 1]!.trim() === "") body.pop();
  // A blank line before the next heading, or the file's final newline.
  return [...lines.slice(0, start + 1), ...body, ...bullets, "", ...lines.slice(end)].join("\n");
}

const SIMULATED = (model: string) => `> Simulated, AI-generated advice (${model}). It is not human review, and agreement among profiles never replaces approval.`;

/** The operations of an `advise` run, as one proposal. */
export function planAdvice(input: AdviceInput, templatesDir = DEFAULT_TEMPLATES_DIR): Operation[] {
  const { decision, entries, model, now } = input;
  if (!ADVISABLE_STATUSES.includes(decision.status)) throw new Error(`${decision.id} is ${decision.status}; advice goes on DRAFT or PROPOSED decisions.`);
  if (entries.length === 0) throw new Error("Advice needs at least one perspective.");
  if (!model.trim()) throw new Error("Name the model that simulated the experts.");

  const operations: Operation[] = (input.newExperts ?? []).map((e) => ({ op: "create", path: e.path, content: e.content }));
  const supporting: string[] = [];
  const research = (id: string, title: string, summary: string, findings: string, sources = "") => {
    const body = `## Summary\n\n${summary.trim()}\n\n## Question\n\nWhat should ${decision.id} (${decision.title}) decide?\n\n## Findings\n\n${SIMULATED(model)}\n\n${findings.trim()}\n\n## Sources\n\n${sources.trim()}${sources.trim() ? "\n" : ""}`;
    let content = newRecord("research", { id, title, now, body }, templatesDir);
    content = content.replace(/^status: open$/m, "status: concluded");
    content = addLink(content, { rel: "supports", id: decision.id }, now);
    operations.push({ op: "create", path: recordPath("research", id, title), content });
    supporting.push(` * ${title} ${id}`);
  };

  for (const entry of entries) {
    if (entry.longForm) research(entry.longForm.id, `${entry.expert.title} on ${decision.title}`.slice(0, 200), entry.advice, entry.longForm.text, entry.longForm.sources);
  }
  if (input.synthesis) {
    const names = [...new Set(entries.map((e) => e.expert.title))].join(", ");
    research(input.synthesis.id, `Advice synthesis: ${decision.title}`.slice(0, 200), `Synthesis of simulated advice from ${names}.`, input.synthesis.text);
  }

  let text = appendToSection(decision.text, "Advice", entries.map((e) => adviceBullet(e, model, now)));
  if (supporting.length > 0) text = appendToSection(text, "Supporting Material", supporting);
  for (const expert of new Map(entries.map((e) => [e.expert.id, e.expert])).values()) text = addLink(text, { rel: "consulted", id: expert.id }, now);
  operations.push({ op: "update", id: decision.id, base_blob: decision.blob, content: text });
  return operations;
}
