/**
 * Decision bodies: the pinned upstream ADR template (spec §13).
 */
import { sha256Hex } from "./record.js";
import { bodyLines, headings } from "./sections.js";

/** Level-2 headings of the template, in order (§13.1). */
export const ADR_SECTIONS = ["Decision", "Context", "Options Considered", "Advice", "Supporting Material"] as const;

/** Metadata lines between the title and `## Decision`, in order. */
export const ADR_FIELDS = ["Date", "Status", "Author"] as const;

const STATUS_LINE = /^\* Status:[ \t]*(.*?)[ \t]*$/m;
const TITLE = /^ADR (\S+) - (.+)$/;
const OPTION = /^Option (\d+|N)( \(SELECTED\))?: (.*)$/;
const ADOPTED = /^\s*[*-]\s+Adopted (because|despite):/;
const REJECTED = /^\s*[*-]\s+Rejected (because|despite):/;

export interface AdrOption {
  title: string;
  selected: boolean;
  /** 0-based body line of the `### Option` heading. */
  index: number;
  /** Consequence bullets whose prefix contradicts the option's selection. */
  mismatched: Array<{ index: number; text: string }>;
}

export interface AdrStructure {
  /** `# ADR <id> - <title>`, if the first heading has that form. */
  title?: { id: string; text: string; index: number };
  /** Values of `* Date:`, `* Status:` and `* Author:`, with their lines. */
  fields: Array<{ name: string; value: string; index: number }>;
  /** Level-2 headings, in order. */
  sections: Array<{ text: string; index: number }>;
  options: AdrOption[];
  /** `## Advice` bullets, with their lines. */
  advice: Array<{ text: string; index: number }>;
}

export function parseAdr(body: string): AdrStructure {
  const lines = bodyLines(body);
  const all = headings(body);
  const structure: AdrStructure = { fields: [], sections: [], options: [], advice: [] };

  const first = all[0];
  if (first?.level === 1) {
    const match = TITLE.exec(first.text);
    if (match) structure.title = { id: match[1]!, text: match[2]!, index: first.index };
  }

  const firstSection = all.find((h) => h.level === 2);
  const metaEnd = firstSection ? firstSection.index : lines.length;
  for (let i = first?.level === 1 ? first.index + 1 : 0; i < metaEnd; i++) {
    const match = /^\* ([A-Za-z]+):[ \t]*(.*?)[ \t]*$/.exec(lines[i]!);
    if (match) structure.fields.push({ name: match[1]!, value: match[2]!, index: i });
  }

  structure.sections = all.filter((h) => h.level === 2).map(({ text, index }) => ({ text, index }));

  const sectionEnd = (index: number) => all.find((h) => h.index > index && h.level <= 2)?.index ?? lines.length;
  const options = structure.sections.find((s) => s.text === "Options Considered");
  if (options) {
    const end = sectionEnd(options.index);
    const optionHeadings = all.filter((h) => h.level === 3 && h.index > options.index && h.index < end);
    optionHeadings.forEach((heading, i) => {
      const match = OPTION.exec(heading.text);
      if (!match) return;
      const selected = match[2] !== undefined;
      const stop = optionHeadings[i + 1]?.index ?? end;
      const mismatched: AdrOption["mismatched"] = [];
      for (let j = heading.index + 1; j < stop; j++) {
        const line = lines[j]!;
        if ((selected && REJECTED.test(line)) || (!selected && ADOPTED.test(line))) {
          mismatched.push({ index: j, text: line.trim() });
        }
      }
      structure.options.push({ title: match[3]!, selected, index: heading.index, mismatched });
    });
  }

  const advice = structure.sections.find((s) => s.text === "Advice");
  if (advice) {
    for (let i = advice.index + 1; i < sectionEnd(advice.index); i++) {
      const match = /^\s*[*-]\s+(.*)$/.exec(lines[i]!);
      if (match) structure.advice.push({ text: match[1]!, index: i });
    }
  }
  return structure;
}

/** The value of the body's `* Status:` line, if any. */
export function adrStatusLine(body: string): string | undefined {
  return STATUS_LINE.exec(body)?.[1];
}

/** Rewrites the body's `* Status:` line; the rest of the body is unchanged. */
export function setAdrStatusLine(body: string, status: string): string {
  return body.replace(STATUS_LINE, `* Status: ${status}`);
}

/**
 * SHA-256 of a decision body without its `* Status:` line. An approval that
 * moves a decision to `ACCEPTED` or later records it, freezing the body (§19 OSV007).
 */
export function decisionBodySha256(body: string): string {
  return sha256Hex(body.replace(/^\* Status:.*(\r?\n|$)/m, ""));
}
