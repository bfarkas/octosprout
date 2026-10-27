/**
 * Starter record templates (spec §5.1, `templates/records/`), filled in when
 * a record is created.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRecord, setFrontmatterFields } from "./record.js";
import type { RecordType } from "./types.js";

/** `<repo>/templates/`, resolved from `packages/core/{src,dist}/`. */
export const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL("../../../../templates/", import.meta.url));

export type TemplatedType = Extract<RecordType, "idea" | "task" | "project" | "research" | "expert">;

/** The template's body for a type: its sections, without frontmatter. */
export function templateBody(type: TemplatedType, templatesDir = DEFAULT_TEMPLATES_DIR): string {
  // The placeholders are not YAML scalars ("{{ID}}" reads as a flow map), so fill them in first.
  const filled = readFileSync(join(templatesDir, "records", `${type}.md`), "utf8").replace(/\{\{[A-Z]+\}\}/g, "x");
  const parsed = parseRecord(filled);
  if (!parsed.ok) throw new Error(`templates/records/${type}.md: ${parsed.error.message}`);
  return parsed.record.body;
}

/**
 * A new record file from the type's template: `{{ID}}`, `{{TITLE}}` and
 * `{{NOW}}` filled in (the title as a properly quoted YAML scalar), and the
 * template body replaced if `body` is given.
 */
export function newRecord(type: TemplatedType, fields: { id: string; title: string; now: string; body?: string }, templatesDir = DEFAULT_TEMPLATES_DIR): string {
  const template = readFileSync(join(templatesDir, "records", `${type}.md`), "utf8")
    .replaceAll("{{ID}}", fields.id)
    .replaceAll("{{NOW}}", fields.now)
    .replaceAll("{{TITLE}}", "TITLE");
  const text = setFrontmatterFields(template, { title: fields.title });
  if (fields.body === undefined) return text;
  const parsed = parseRecord(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return text.slice(0, text.length - parsed.record.body.length) + fields.body;
}

const DIRS: Record<TemplatedType | "decision", string> = {
  decision: "records/decisions",
  idea: "records/ideas",
  task: "records/tasks",
  project: "records/projects",
  research: "records/research",
  expert: "experts",
};

/** A filename slug from a title: lowercase ASCII words joined by hyphens, at most 60 characters. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/** Where a new record lives: `<dir>/<ID>--<slug>.md`, or `<dir>/<ID>.md` without a usable slug (§5.2). */
export function recordPath(type: TemplatedType | "decision", id: string, title: string): string {
  const slug = slugify(title);
  return `${DIRS[type]}/${id}${slug ? `--${slug}` : ""}.md`;
}
