/**
 * What an edit of a record file may change (spec §6.5, §7, §9.2, §12.2).
 *
 * Validation checks the resulting workspace; these rules check the change
 * itself, which validation cannot see: identity and lifecycle fields are not
 * edited by hand, captures stay as received, and some edits are
 * consequential.
 */
import { decisionBodySha256 } from "./adr.js";
import { parseRecord, setFrontmatterFields } from "./record.js";
import { findSection } from "./sections.js";

/** Fields an edit never changes. `updated` is set by whoever writes. */
export const IMMUTABLE_FIELDS = ["id", "type", "schema_version", "created", "status", "approval"] as const;

/** Project brief sections whose change on an `active` project is consequential (§9.2 item 3). */
export const ACTIVE_PROJECT_SECTIONS = ["Goals", "Non-goals", "Scope", "Success criteria"] as const;

const FROZEN_DECISIONS = new Set(["ACCEPTED", "ADOPTED", "SUPERSEDED", "EXPIRED"]);

export type EditCheck =
  | { ok: true }
  /** The edit is not allowed at all. */
  | { ok: false; kind: "forbidden"; field?: string; message: string }
  /** The edit is allowed only with an approval. */
  | { ok: false; kind: "approval_required"; message: string };

export function checkEdit(before: string, after: string): EditCheck {
  const old = parseRecord(before);
  const next = parseRecord(after);
  if (!old.ok) return { ok: false, kind: "forbidden", message: `The current file does not parse: ${old.error.message}` };
  if (!next.ok) return { ok: false, kind: "forbidden", message: `The new file does not parse: ${next.error.message}` };
  const a = old.record.frontmatter;
  const b = next.record.frontmatter;

  if (a.type === "proposal") return { ok: false, kind: "forbidden", message: "Proposals are written by the server only." };

  for (const field of IMMUTABLE_FIELDS) {
    if (!same(a[field], b[field])) {
      const message =
        field === "status"
          ? "Change the status with a move, which checks the lifecycle."
          : field === "approval"
            ? "Approvals are written by the server when a proposal is applied."
            : `'${field}' cannot be changed.`;
      return { ok: false, kind: "forbidden", field, message };
    }
  }

  if (a.type === "capture") {
    // Only status, updated, tags and x- keys may change after creation (§6.5).
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key === "updated" || key === "tags" || key.startsWith("x-")) continue;
      if (!same(a[key], b[key])) return { ok: false, kind: "forbidden", field: key, message: `A capture's '${key}' cannot be changed; captures are kept as received.` };
    }
    if (old.record.body !== next.record.body) return { ok: false, kind: "forbidden", field: "body", message: "A capture's text is immutable." };
  }

  if (a.type === "decision" && typeof a.status === "string" && FROZEN_DECISIONS.has(a.status)) {
    if (decisionBodySha256(old.record.body) !== decisionBodySha256(next.record.body)) {
      return { ok: false, kind: "forbidden", field: "body", message: `The body of a ${a.status} decision is frozen. A reversal is a new decision that supersedes it.` };
    }
  }

  if (a.type === "project" && a.status === "active") {
    const changed = ACTIVE_PROJECT_SECTIONS.filter((name) => sectionText(old.record.body, name) !== sectionText(next.record.body, name));
    if (changed.length > 0) {
      return { ok: false, kind: "approval_required", message: `Changing ${changed.join(", ")} of an active project needs approval.` };
    }
  }
  return { ok: true };
}

function sectionText(body: string, name: string): string | undefined {
  return findSection(body, name)?.content.trim();
}

function same(x: unknown, y: unknown): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}

/** The frontmatter keys a form edit sets; everything else stays as it is. */
export interface FormEdit {
  title?: string;
  tags?: string[];
  links?: Array<{ rel: string; id: string }>;
  refs?: Array<{ kind: string; url: string; note?: string }>;
  body?: string;
}

/** Applies a form edit to a record file. Fields left out are untouched; empty lists remove the key. */
export function applyFormEdit(text: string, form: FormEdit): string {
  const parsed = parseRecord(text);
  const current = parsed.ok ? parsed.record.frontmatter : {};
  const fields: Record<string, unknown> = {};
  for (const key of ["title", "tags", "links", "refs"] as const) {
    const value = form[key];
    if (value === undefined) continue;
    // Unchanged fields are left alone, so their formatting is kept. A missing list equals an empty one.
    const before = current[key] ?? (Array.isArray(value) ? [] : undefined);
    if (!same(before, value)) fields[key] = value;
  }
  let out = Object.keys(fields).length > 0 ? setFrontmatterFields(text, fields) : text;
  if (form.body !== undefined) {
    const parsed = parseRecord(out);
    if (!parsed.ok) throw new Error(parsed.error.message);
    out = out.slice(0, out.length - parsed.record.body.length) + form.body;
  }
  return out;
}
