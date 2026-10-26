/**
 * Markdown body structure: ATX headings and the sections under them.
 *
 * Used for the task and project contracts (spec §6.5, §11), ADR template
 * compliance (§13.2) and the handoff bundle. Headings inside fenced code
 * blocks are ignored.
 */

export interface Heading {
  level: number;
  text: string;
  /** 0-based index of the heading line within the body. */
  index: number;
}

export interface Section extends Heading {
  /** Lines after the heading, up to the next heading of the same or a higher level. */
  content: string;
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

export function bodyLines(body: string): string[] {
  return body.split(/\r?\n/);
}

/** Every ATX heading in the body, in order. */
export function headings(body: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | undefined;
  bodyLines(body).forEach((line, index) => {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return;
    }
    if (fence !== undefined) return;
    const match = HEADING.exec(line);
    if (match) out.push({ level: match[1]!.length, text: match[2]!, index });
  });
  return out;
}

/** Sections of the given level, with their content. */
export function sections(body: string, level = 2): Section[] {
  const lines = bodyLines(body);
  const all = headings(body);
  const out: Section[] = [];
  all.forEach((heading, i) => {
    if (heading.level !== level) return;
    const next = all.slice(i + 1).find((h) => h.level <= level);
    const end = next ? next.index : lines.length;
    out.push({ ...heading, content: lines.slice(heading.index + 1, end).join("\n") });
  });
  return out;
}

/** The first section of the given level whose heading text matches, case-insensitively. */
export function findSection(body: string, title: string, level = 2): Section | undefined {
  const wanted = title.toLowerCase();
  return sections(body, level).find((s) => s.text.toLowerCase() === wanted);
}

/**
 * True when a section holds real content: anything other than whitespace,
 * HTML comments and empty template checkboxes (`- [ ]`).
 */
export function hasContent(content: string): boolean {
  return content
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/)
    .some((line) => line.trim() !== "" && !/^\s*[-*+]\s*\[ \]\s*$/.test(line));
}
