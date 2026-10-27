/**
 * Triage of captures (spec §7.1, D11): turning a capture into an Idea, Task
 * or Research record, attaching it to one, or composting it. These helpers
 * prepare the file contents; the caller writes them in one commit.
 */
import { LINK_RULES, type Link } from "./links.js";
import { parseRecord, setFrontmatterFields } from "./record.js";
import type { Operation } from "./proposals.js";
import { newRecord, recordPath, templateBody, DEFAULT_TEMPLATES_DIR } from "./templates.js";
import type { RecordType } from "./types.js";

/** Types a capture can become, and can be attached to (`derived_from` → capture, §6.3). */
export const TRIAGE_TYPES = (Object.keys(LINK_RULES.derived_from ?? {}) as RecordType[]).filter((type) =>
  LINK_RULES.derived_from?.[type]?.includes("capture"),
) as Array<"idea" | "task" | "research">;

const MAX_TITLE = 200;

/**
 * A title from a capture's text: its first non-empty line, without Markdown
 * heading or list markers or a `Working title:` label (the handoff brief's
 * first line, Appendix B).
 */
export function titleFromCapture(text: string): string {
  const first = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  const title = first
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+>]\s+/, "")
    .replace(/^working title:\s*/i, "")
    .trim();
  const chars = [...title];
  return chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join("")}…` : title;
}

/** The capture's text as a Markdown block quote. */
export function quoteCapture(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  return lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n") + "\n";
}

/** The prefilled title and body for a record made from a capture: the template, with the capture quoted at the top. */
export function prefillFromCapture(type: "idea" | "task" | "research", captureText: string, templatesDir = DEFAULT_TEMPLATES_DIR): { title: string; body: string } {
  return { title: titleFromCapture(captureText), body: `${quoteCapture(captureText)}\n${templateBody(type, templatesDir)}` };
}

/** Adds a link to a record file (if it is not there yet) and sets `updated`. */
export function addLink(text: string, link: Link, updated: string): string {
  const parsed = parseRecord(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const links = Array.isArray(parsed.record.frontmatter.links) ? (parsed.record.frontmatter.links as Link[]) : [];
  if (links.some((l) => l.rel === link.rel && String(l.id).toUpperCase() === link.id)) return setFrontmatterFields(text, { updated });
  return setFrontmatterFields(text, { links: [...links, link], updated });
}

/** What `planTriage` needs to know about a record. */
interface TriageFile {
  id: string;
  type: string;
  status: string;
  blob: string;
  path?: string;
}

export type TriagePlanInput =
  | { action: "create"; type: "idea" | "task" | "research"; id: string; title: string; body: string; now: string }
  | { action: "attach"; target: TriageFile }
  | { action: "compost" };

/**
 * The operations of a triage (§7.1), as a proposal makes them: create a
 * record that `derived_from` the capture or attach the capture to one, and
 * plant a `new` capture; or compost a `new` one.
 */
export function planTriage(capture: TriageFile, input: TriagePlanInput, templatesDir = DEFAULT_TEMPLATES_DIR): Operation[] {
  if (capture.type !== "capture") throw new Error(`${capture.id} is not a capture.`);
  const plant: Operation[] = capture.status === "new" ? [{ op: "set_status", id: capture.id, base_blob: capture.blob, status: "planted" }] : [];
  switch (input.action) {
    case "create": {
      if (capture.status === "composted") throw new Error("Restore the capture before triaging it.");
      const text = addLink(newRecord(input.type, { id: input.id, title: input.title, now: input.now, body: input.body }, templatesDir), { rel: "derived_from", id: capture.id }, input.now);
      return [{ op: "create", path: recordPath(input.type, input.id, input.title), content: text }, ...plant];
    }
    case "attach":
      if (capture.status === "composted") throw new Error("Restore the capture before triaging it.");
      if (!(TRIAGE_TYPES as readonly string[]).includes(input.target.type)) throw new Error(`A capture can be attached to an idea, task or research record, not a ${input.target.type}.`);
      return [{ op: "add_link", id: input.target.id, base_blob: input.target.blob, link: { rel: "derived_from", id: capture.id } }, ...plant];
    case "compost":
      if (capture.status !== "new") throw new Error(`Only a new capture can be composted; this one is ${capture.status}.`);
      return [{ op: "set_status", id: capture.id, base_blob: capture.blob, status: "composted" }];
  }
}
