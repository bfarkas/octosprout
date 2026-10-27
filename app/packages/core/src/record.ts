/**
 * Record files: UTF-8 Markdown with YAML frontmatter (spec §6.2).
 *
 * The body is everything after the closing `---` line, byte for byte. Nothing
 * here trims or normalizes it, because capture bodies are verbatim and
 * immutable (§6.5).
 */
import { createHash } from "node:crypto";

import { Document, LineCounter, parse, parseDocument, stringify, isMap, isScalar, isSeq, visit, type Scalar } from "yaml";

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
 * Sets, replaces or removes top-level frontmatter fields in place. Only the
 * lines of the fields named change; key order, comments and formatting of
 * every other line, `x-` keys and the body stay byte for byte. A scalar that
 * replaces a scalar keeps the rest of its line (such as a comment). New
 * fields are appended at the end of the frontmatter; `undefined` removes a
 * field, and so does an empty list. Throws if the frontmatter does not parse.
 */
export function setFrontmatterFields(text: string, fields: Record<string, unknown>): string {
  const span = frontmatterSpan(text);
  if (!span.ok) throw new Error(span.error.message);
  const yaml = span.yamlSource;
  const doc = parseDocument(yaml, { version: "1.2", schema: "core" });
  if (doc.errors.length > 0) throw new Error(`Invalid YAML: ${doc.errors[0]!.message.split("\n")[0]}`);
  const root = doc.contents;
  if (root !== null && !isMap(root)) throw new Error("Frontmatter must be a YAML mapping.");

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const appended: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const remove = value === undefined || (Array.isArray(value) && value.length === 0);
    const pair = root?.items.find((item) => isScalar(item.key) && item.key.value === key);
    const keyNode = pair?.key as Scalar | undefined;
    const valueNode = pair?.value as { range?: [number, number, number] } | null | undefined;
    if (!pair || !keyNode?.range) {
      if (!remove) appended.push(renderField(key, value));
      continue;
    }
    if (!remove && isScalarValue(value) && valueNode && isScalar(valueNode) && valueNode.range) {
      edits.push({ start: valueNode.range[0], end: valueNode.range[1], text: renderScalar(value) });
      continue;
    }
    // Replace the whole field: from the start of its key's line to the end of its value's last line.
    const start = yaml.lastIndexOf("\n", keyNode.range[0] - 1) + 1;
    const valueEnd = valueNode?.range?.[1] ?? keyNode.range[1];
    const end = yaml[valueEnd - 1] === "\n" ? valueEnd : yaml.indexOf("\n", valueEnd) + 1 || yaml.length;
    edits.push({ start, end, text: remove ? "" : renderField(key, value) });
  }

  let out = yaml;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  out += appended.join("");
  return text.slice(0, OPEN.length) + out + text.slice(OPEN.length + yaml.length);
}

function isScalarValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function renderScalar(value: unknown): string {
  return stringify(value, { schema: "core", lineWidth: 0 }).trimEnd();
}

/**
 * Renders one field as YAML lines, in the house style of the spec's examples:
 * lists of scalars on one line (`tags: [a, b]`, quoting anything but plain
 * kebab-case words), small maps in a list as flow maps
 * (`- { rel: blocks, id: OS-T-AAAAA }`), anything larger as a block.
 */
function renderField(key: string, value: unknown): string {
  const name = renderScalar(key);
  if (isScalarValue(value)) return `${name}: ${renderScalar(value)}\n`;
  if (Array.isArray(value) && value.every(isScalarValue)) {
    const item = (v: string | number | boolean) =>
      typeof v === "string" && /^[a-z0-9][a-z0-9-]*$/.test(v) && typeof parse(v, { schema: "core" }) === "string" ? v : JSON.stringify(v);
    return `${name}: [${value.map(item).join(", ")}]\n`;
  }
  const doc = new Document({ [key]: value }, { version: "1.2", schema: "core" });
  visit(doc, {
    Map(_key, node, path) {
      const inSeq = isSeq(path[path.length - 1]);
      if (inSeq && node.items.length <= 2 && node.items.every((item) => isScalar(item.value))) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

/** Sets top-level scalar fields in place; see `setFrontmatterFields`. */
export function setFrontmatterScalars(text: string, fields: Record<string, string | number | boolean>): string {
  return setFrontmatterFields(text, fields);
}

/** Renders a record file. The body is appended unchanged. */
export function renderRecord(frontmatter: Frontmatter, body: string): string {
  return `${OPEN}${stringify(frontmatter, { schema: "core", lineWidth: 0 })}---\n${body}`;
}

/** Hex SHA-256 of a string's UTF-8 bytes (capture `content_sha256`, §6.5). */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
