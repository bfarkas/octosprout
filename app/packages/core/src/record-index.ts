/**
 * The in-memory record index (spec §4.2): ID → path, metadata, links and
 * backlinks, built from the workspace files. It is derived state and is
 * never persisted.
 */
import { createHash } from "node:crypto";

import { parseId } from "./ids.js";
import { isLinkRel, type Link, type LinkRel } from "./links.js";
import { openBlockers } from "./lifecycle.js";
import { parseRecord, type Frontmatter } from "./record.js";
import { RECORD_TYPES, type RecordType } from "./types.js";
import type { SourceFile } from "./validate.js";

export interface Ref {
  kind: string;
  url: string;
  note?: string;
}

export interface IndexedRecord {
  id: string;
  type: RecordType;
  /** Workspace-relative path. */
  path: string;
  /** Git blob SHA of the file, the `base_blob` for writes (§8.4). */
  blob: string;
  /** Empty for captures, which have no title. */
  title: string;
  status: string;
  created: string;
  updated: string;
  tags: string[];
  links: Link[];
  refs: Ref[];
  approval?: string;
  frontmatter: Frontmatter;
  body: string;
  /** The whole file. */
  text: string;
}

export interface SearchHit {
  record: IndexedRecord;
  score: number;
  /** About 160 characters of the body around the first word found there, or its start. */
  snippet: string;
}

/** Text around the first matching word, on one line, without Markdown markers. */
function snippet(body: string, words: readonly string[]): string {
  const flat = body
    .replace(/^\s*(#{1,6}|[-*+]\s+\[[ xX]\]|[-*+>]|\d+\.)\s+/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = flat.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 60);
  const text = flat.slice(start, start + 160);
  return `${start > 0 ? "…" : ""}${text}${start + 160 < flat.length ? "…" : ""}`;
}

export interface Backlink {
  rel: LinkRel;
  source: IndexedRecord;
}

const RECORD_ROOTS = ["records/", "experts/", "proposals/"];

/** The Git blob SHA-1 of a file's bytes, as `git hash-object` computes it. */
export function gitBlobSha(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export class RecordIndex {
  readonly #byPath = new Map<string, IndexedRecord>();
  readonly #byId = new Map<string, IndexedRecord>();

  constructor(files: Iterable<SourceFile> = []) {
    for (const file of files) this.set(file);
  }

  /** Adds or replaces the record stored at `file.path`. Files that are not readable records are dropped. */
  set(file: SourceFile): IndexedRecord | undefined {
    this.remove(file.path);
    const record = toIndexed(file);
    if (!record) return undefined;
    this.#byPath.set(record.path, record);
    // With duplicate IDs (OSV002) the first path, in path order, wins.
    const current = this.#byId.get(record.id);
    if (!current || record.path < current.path) this.#byId.set(record.id, record);
    return record;
  }

  remove(path: string): void {
    const record = this.#byPath.get(path);
    if (!record) return;
    this.#byPath.delete(path);
    if (this.#byId.get(record.id) === record) {
      this.#byId.delete(record.id);
      const next = [...this.#byPath.values()].filter((r) => r.id === record.id).sort((a, b) => a.path.localeCompare(b.path))[0];
      if (next) this.#byId.set(next.id, next);
    }
  }

  get size(): number {
    return this.#byId.size;
  }

  has(id: string): boolean {
    return this.#byId.has(canonical(id));
  }

  get(id: string): IndexedRecord | undefined {
    return this.#byId.get(canonical(id));
  }

  byPath(path: string): IndexedRecord | undefined {
    return this.#byPath.get(path);
  }

  /** Records of one type, or all, in no particular order. */
  list(type?: RecordType): IndexedRecord[] {
    const all = [...this.#byId.values()];
    return type === undefined ? all : all.filter((r) => r.type === type);
  }

  /** Links pointing at `id`, computed and never stored (§6.3). */
  backlinks(id: string): Backlink[] {
    const target = canonical(id);
    const out: Backlink[] = [];
    for (const source of this.#byId.values()) {
      for (const link of source.links) {
        if (link.id === target) out.push({ rel: link.rel, source });
      }
    }
    return out.sort((a, b) => a.rel.localeCompare(b.rel) || a.source.id.localeCompare(b.source.id));
  }

  /** Open tasks that `blocks` this task (§7.3). */
  blockedBy(taskId: string): string[] {
    return openBlockers(canonical(taskId), this.list("task"));
  }

  /**
   * Search by ID, title, tags and full text (§12.2). Every word must match
   * somewhere, case-insensitively. An ID match ranks first, then title,
   * then tag, then body matches; ties go to the most recently updated.
   */
  search(query: string, options: { type?: RecordType; status?: string; limit?: number } = {}): SearchHit[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const record of this.#byId.values()) {
      if (options.type && record.type !== options.type) continue;
      if (options.status && record.status !== options.status) continue;
      const id = record.id.toLowerCase();
      const title = record.title.toLowerCase();
      const tags = record.tags.join(" ");
      const body = record.body.toLowerCase();
      let score = 0;
      let matched = true;
      for (const word of words) {
        if (id === word) score += 100;
        else if (id.includes(word)) score += 50;
        else if (title.includes(word)) score += 20;
        else if (tags.includes(word)) score += 10;
        else if (body.includes(word)) score += 1;
        else {
          matched = false;
          break;
        }
      }
      if (matched) hits.push({ record, score, snippet: snippet(record.body, words) });
    }
    return hits
      .sort((a, b) => b.score - a.score || b.record.updated.localeCompare(a.record.updated) || a.record.id.localeCompare(b.record.id))
      .slice(0, options.limit ?? 50);
  }

  /** A short hash of the IDs, statuses and blobs of one type: changes whenever that board would. */
  version(type: RecordType): string {
    const lines = this.list(type)
      .map((r) => `${r.id} ${r.status} ${r.blob}`)
      .sort();
    return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
  }
}

function canonical(id: string): string {
  return parseId(id)?.id ?? id;
}

function toIndexed(file: SourceFile): IndexedRecord | undefined {
  if (!file.path.endsWith(".md") || !RECORD_ROOTS.some((root) => file.path.startsWith(root))) return undefined;
  let text: string;
  try {
    text = typeof file.content === "string" ? file.content : new TextDecoder("utf-8", { fatal: true }).decode(file.content);
  } catch {
    return undefined;
  }
  const parsed = parseRecord(text);
  if (!parsed.ok) return undefined;
  const fm = parsed.record.frontmatter;
  const id = typeof fm.id === "string" ? parseId(fm.id) : undefined;
  if (id?.prefix !== "OS") return undefined;
  const type = (RECORD_TYPES as readonly unknown[]).includes(fm.type) ? (fm.type as RecordType) : id.type;

  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const links: Link[] = [];
  for (const item of Array.isArray(fm.links) ? (fm.links as unknown[]) : []) {
    const { rel, id: target } = (item ?? {}) as { rel?: unknown; id?: unknown };
    const parsedTarget = typeof target === "string" ? parseId(target) : undefined;
    if (isLinkRel(rel) && parsedTarget) links.push({ rel, id: parsedTarget.id });
  }
  const refs: Ref[] = [];
  for (const item of Array.isArray(fm.refs) ? (fm.refs as unknown[]) : []) {
    const { kind, url, note } = (item ?? {}) as { kind?: unknown; url?: unknown; note?: unknown };
    if (typeof kind === "string" && typeof url === "string") refs.push({ kind, url, ...(typeof note === "string" ? { note } : {}) });
  }
  const approval = typeof fm.approval === "string" ? fm.approval : undefined;

  return {
    id: id.id,
    type,
    path: file.path,
    blob: gitBlobSha(file.content),
    title: str(fm.title),
    status: str(fm.status),
    created: str(fm.created),
    updated: str(fm.updated),
    tags: Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === "string") : [],
    links,
    refs,
    ...(approval !== undefined ? { approval } : {}),
    frontmatter: fm,
    body: parsed.record.body,
    text,
  };
}
