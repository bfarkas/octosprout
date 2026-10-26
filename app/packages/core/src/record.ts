/**
 * Record files: UTF-8 Markdown with YAML frontmatter (spec §6.2).
 *
 * The body is everything after the closing `---` line, byte for byte. Nothing
 * here trims or normalizes it, because capture bodies are verbatim and
 * immutable (§6.5).
 */
import { createHash } from "node:crypto";

import { LineCounter, parseDocument, stringify, isMap, isScalar, type Scalar } from "yaml";

export type Frontmatter = Record<string, unknown>;

export interface ParsedRecord {
  frontmatter: Frontmatter;
  body: string;
  /** 1-based file line of each top-level frontmatter key. */
  keyLines: Record<string, number>;
}

export interface ParseError {
  message: string;
  /** 1-based file line, when known. */
  line?: number;
}

export type ParseResult =
  | { ok: true; record: ParsedRecord }
  | { ok: false; error: ParseError };

const OPEN = "---\n";
const CLOSE = "\n---\n";

/** Locates the frontmatter: the YAML text after the opening line, and where the body starts. */
function frontmatterSpan(text: string): { ok: true; yamlSource: string; bodyStart: number } | { ok: false; error: ParseError } {
  if (!text.startsWith(OPEN)) {
    return { ok: false, error: { message: "File must start with a '---' frontmatter line.", line: 1 } };
  }

  // The closing delimiter may directly follow the opening one (empty
  // frontmatter), so the search starts at the opening line's newline.
  let end = text.indexOf(CLOSE, OPEN.length - 1);
  let bodyStart: number;
  if (end >= 0) {
    bodyStart = end + CLOSE.length;
  } else if (text.endsWith("\n---")) {
    end = text.length - "\n---".length;
    bodyStart = text.length;
  } else {
    return { ok: false, error: { message: "Frontmatter is not closed by a '---' line.", line: 1 } };
  }
  return { ok: true, yamlSource: end < OPEN.length ? "" : text.slice(OPEN.length, end + 1), bodyStart };
}

/**
 * Splits and parses a record file. YAML is read with the 1.2 core schema, so
 * timestamps stay strings and duplicate keys are errors.
 */
export function parseRecord(text: string): ParseResult {
  const span = frontmatterSpan(text);
  if (!span.ok) return span;
  const { yamlSource } = span;
  const body = text.slice(span.bodyStart);

  const lineCounter = new LineCounter();
  const doc = parseDocument(yamlSource, { lineCounter, version: "1.2", schema: "core" });
  const firstError = doc.errors[0];
  if (firstError) {
    // Frontmatter starts on file line 2.
    const line = firstError.linePos?.[0]?.line;
    return {
      ok: false,
      error: { message: `Invalid YAML: ${firstError.message.split("\n")[0]}`, ...(line ? { line: line + 1 } : {}) },
    };
  }

  const root = doc.contents;
  if (root === null) {
    return { ok: true, record: { frontmatter: {}, body, keyLines: {} } };
  }
  if (!isMap(root)) {
    return { ok: false, error: { message: "Frontmatter must be a YAML mapping.", line: 2 } };
  }

  const keyLines: Record<string, number> = {};
  for (const pair of root.items) {
    if (isScalar(pair.key) && pair.key.range) {
      keyLines[String(pair.key.value)] = lineCounter.linePos(pair.key.range[0]).line + 1;
    }
  }

  return { ok: true, record: { frontmatter: doc.toJS() as Frontmatter, body, keyLines } };
}

/**
 * Sets top-level scalar frontmatter fields in place. Only the value text of
 * each field changes; key order, comments, formatting of every other line,
 * `x-` keys and the body stay byte for byte. Missing fields are appended at
 * the end of the frontmatter. Throws if the file does not parse or a field
 * holds a mapping or sequence.
 */
export function setFrontmatterScalars(text: string, fields: Record<string, string | number | boolean>): string {
  const span = frontmatterSpan(text);
  if (!span.ok) throw new Error(span.error.message);
  const doc = parseDocument(span.yamlSource, { version: "1.2", schema: "core" });
  if (doc.errors.length > 0) throw new Error(`Invalid YAML: ${doc.errors[0]!.message.split("\n")[0]}`);
  const root = doc.contents;
  if (root !== null && !isMap(root)) throw new Error("Frontmatter must be a YAML mapping.");

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const appended: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const rendered = stringify(value, { schema: "core", lineWidth: 0 }).trimEnd();
    const pair = root?.items.find((item) => isScalar(item.key) && item.key.value === key);
    if (!pair) {
      appended.push(`${stringify(key, { schema: "core" }).trimEnd()}: ${rendered}\n`);
      continue;
    }
    const node = pair.value as Scalar | null;
    if (node === null || !isScalar(node) || !node.range) throw new Error(`Field '${key}' is not a scalar.`);
    edits.push({ start: OPEN.length + node.range[0], end: OPEN.length + node.range[1], text: rendered });
  }

  let out = text;
  let yamlEnd = OPEN.length + span.yamlSource.length;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    yamlEnd += edit.text.length - (edit.end - edit.start);
  }
  if (appended.length > 0) out = out.slice(0, yamlEnd) + appended.join("") + out.slice(yamlEnd);
  return out;
}

/** Renders a record file. The body is appended unchanged. */
export function renderRecord(frontmatter: Frontmatter, body: string): string {
  return `${OPEN}${stringify(frontmatter, { schema: "core", lineWidth: 0 })}---\n${body}`;
}

/** Hex SHA-256 of a string's UTF-8 bytes (capture `content_sha256`, §6.5). */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
