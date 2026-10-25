/**
 * Workspace validation (spec §19): OSV001–OSV006 and OSV011.
 *
 * The validator is pure: it takes the workspace's files and returns findings.
 * The CLI, the server and CI all call it.
 */
import type { ErrorObject } from "ajv";

import { type Finding, type Severity, type ValidationCode } from "./findings.js";
import { parseId } from "./ids.js";
import { isLinkAllowed, isLinkRel, type LinkRel } from "./links.js";
import { parseRecord, sha256Hex, type ParsedRecord } from "./record.js";
import { SchemaRegistry } from "./schemas.js";
import { RECORD_TYPES, STATUSES, type RecordType } from "./types.js";

export interface SourceFile {
  /** Workspace-relative path with `/` separators. */
  path: string;
  content: string | Uint8Array;
}

export interface ValidateOptions {
  schemas?: SchemaRegistry;
}

/** Directories that hold records (spec §5.2). Everything else is not validated here. */
const RECORD_ROOTS = ["records/", "experts/", "proposals/"] as const;

interface Location {
  dir: string;
  /** Files live under `YYYY/MM/`. */
  dated: boolean;
  /** Filenames are `<ID>.md` only; other types may append `--<slug>`. */
  slug: boolean;
}

const LOCATIONS: Record<RecordType, Location> = {
  capture: { dir: "records/captures", dated: true, slug: false },
  idea: { dir: "records/ideas", dated: false, slug: true },
  task: { dir: "records/tasks", dated: false, slug: true },
  project: { dir: "records/projects", dated: false, slug: true },
  decision: { dir: "records/decisions", dated: false, slug: true },
  research: { dir: "records/research", dated: false, slug: true },
  expert: { dir: "experts", dated: false, slug: true },
  proposal: { dir: "proposals", dated: true, slug: false },
};

interface LoadedRecord {
  path: string;
  record: ParsedRecord;
  /** Canonical ID, when the file declares a valid private one. */
  id: string | undefined;
  /** Declared `type`, when it is a known one. */
  type: RecordType | undefined;
  /** Type used for placement and link rules: the declared one, else the one the ID encodes. */
  effectiveType: RecordType | undefined;
}

export function validateWorkspace(files: readonly SourceFile[], options: ValidateOptions = {}): Finding[] {
  const schemas = options.schemas ?? new SchemaRegistry();
  const findings: Finding[] = [];

  const loaded: LoadedRecord[] = [];
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!isRecordPath(file.path)) continue;
    const record = load(file, findings);
    if (record) loaded.push(record);
  }

  for (const entry of loaded) {
    checkIdentity(entry, findings);
    checkSchema(entry, schemas, findings);
    checkStatus(entry, findings);
    checkCaptureIntegrity(entry, findings);
    checkTimestamps(entry, findings);
  }

  checkDuplicateIds(loaded, findings);
  checkPlantedCaptures(loaded, findings);
  checkLinks(loaded, findings);

  return findings.sort(compareFindings);
}

function isRecordPath(path: string): boolean {
  return path.endsWith(".md") && RECORD_ROOTS.some((root) => path.startsWith(root));
}

function compareFindings(a: Finding, b: Finding): number {
  return (
    a.path.localeCompare(b.path) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.code.localeCompare(b.code) ||
    a.message.localeCompare(b.message)
  );
}

// ---------------------------------------------------------------------------
// Loading

function load(file: SourceFile, findings: Finding[]): LoadedRecord | undefined {
  let text: string;
  if (typeof file.content === "string") {
    text = file.content;
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
    } catch {
      findings.push(
        finding("OSV003", "error", file.path, undefined, "File is not valid UTF-8.", "Records must be UTF-8 encoded."),
      );
      return undefined;
    }
  }

  const result = parseRecord(text);
  if (!result.ok) {
    findings.push(
      finding(
        "OSV003",
        "error",
        file.path,
        undefined,
        result.error.message,
        "Records are Markdown files with a YAML frontmatter block (spec §6.2).",
        result.error.line,
      ),
    );
    return undefined;
  }

  const { record } = result;
  const fm = record.frontmatter;
  const parsedId = typeof fm.id === "string" ? parseId(fm.id) : undefined;
  const id = parsedId?.prefix === "OS" ? parsedId.id : undefined;
  const type = isRecordType(fm.type) ? fm.type : undefined;
  const effectiveType = type ?? (parsedId?.prefix === "OS" ? parsedId.type : undefined);
  return { path: file.path, record, id, type, effectiveType };
}

function isRecordType(value: unknown): value is RecordType {
  return typeof value === "string" && (RECORD_TYPES as readonly string[]).includes(value);
}

function finding(
  code: ValidationCode,
  severity: Severity,
  path: string,
  id: string | undefined,
  message: string,
  hint: string,
  line?: number,
): Finding {
  return {
    code,
    severity,
    path,
    ...(line !== undefined ? { line } : {}),
    ...(id !== undefined ? { id } : {}),
    message,
    hint,
  };
}

/** Reports a problem with a frontmatter field, pointing at the key's line. */
function report(
  entry: LoadedRecord,
  findings: Finding[],
  code: ValidationCode,
  severity: Severity,
  field: string | undefined,
  message: string,
  hint: string,
): void {
  const line = field === undefined ? undefined : entry.record.keyLines[field];
  findings.push(finding(code, severity, entry.path, entry.id, message, hint, line));
}

// ---------------------------------------------------------------------------
// OSV001: ID format, type, filename and directory

function checkIdentity(entry: LoadedRecord, findings: Finding[]): void {
  const fm = entry.record.frontmatter;
  const emit = (field: string | undefined, message: string, hint: string) =>
    report(entry, findings, "OSV001", "error", field, message, hint);

  if (typeof fm.id !== "string") {
    emit("id", "Missing or non-string 'id'.", "Add an ID such as OS-I-2HD9W (spec §6.1).");
    return;
  }
  const parsed = parseId(fm.id);
  if (!parsed) {
    emit("id", `'${fm.id}' is not a valid ID.`, "IDs look like OS-I-2HD9W: prefix, type code, then 5 Crockford Base32 characters.");
    return;
  }
  if (parsed.prefix !== "OS") {
    emit("id", `'${fm.id}' uses the reserved library prefix OSL.`, "Private workspace records use the OS prefix.");
    return;
  }
  if (fm.id !== parsed.id) {
    emit("id", `ID '${fm.id}' must be uppercase.`, `Change it to ${parsed.id}.`);
  }
  if (entry.type !== undefined && entry.type !== parsed.type) {
    emit("id", `ID ${parsed.id} is a ${parsed.type} ID but the record's type is '${entry.type}'.`, `Use a ${entry.type} ID or change 'type'.`);
  }

  const type = entry.effectiveType;
  if (type === undefined) return;
  const location = LOCATIONS[type];
  const segments = entry.path.split("/");
  const filename = segments[segments.length - 1] ?? "";
  const dirSegments = segments.slice(0, -1);
  const dirParts = location.dir.split("/");

  const dirMatches = dirParts.every((part, i) => dirSegments[i] === part);
  const rest = dirSegments.slice(dirParts.length);
  const datedOk = location.dated
    ? rest.length === 2 && /^\d{4}$/.test(rest[0]!) && /^(0[1-9]|1[0-2])$/.test(rest[1]!)
    : rest.length === 0;
  const expectedDir = location.dated ? `${location.dir}/YYYY/MM/` : `${location.dir}/`;
  if (!dirMatches || !datedOk) {
    emit(undefined, `A ${type} record belongs in ${expectedDir}.`, `Move the file to ${expectedDir}${parsed.id}.md.`);
  } else if (location.dated) {
    const created =
      typeof fm.created === "string" && parseTimestamp(fm.created) !== undefined
        ? /^(\d{4})-(\d{2})-/.exec(fm.created)
        : null;
    if (created && (created[1] !== rest[0] || created[2] !== rest[1])) {
      report(
        entry,
        findings,
        "OSV001",
        "warning",
        "created",
        `Directory ${rest[0]}/${rest[1]} does not match 'created' (${created[1]}-${created[2]}).`,
        "Year and month come from the server receive time in UTC (spec §15.3).",
      );
    }
  }

  const filenameOk = location.slug
    ? filename === `${parsed.id}.md` || (filename.startsWith(`${parsed.id}--`) && filename.length > parsed.id.length + 5)
    : filename === `${parsed.id}.md`;
  if (!filenameOk) {
    const expected = location.slug ? `${parsed.id}--<slug>.md` : `${parsed.id}.md`;
    emit(undefined, `Filename '${filename}' must be ${expected}.`, "Filenames start with the record's ID (spec §5.2).");
  }
}

// ---------------------------------------------------------------------------
// OSV003: frontmatter schema

/** Fields whose problems are reported by a more specific rule. */
const OWNED_ELSEWHERE = new Set(["id", "status", "created", "updated"]);

function checkSchema(entry: LoadedRecord, schemas: SchemaRegistry, findings: Finding[]): void {
  const fm = entry.record.frontmatter;
  const emit = (severity: Severity, field: string | undefined, message: string, hint: string) =>
    report(entry, findings, "OSV003", severity, field, message, hint);

  if (entry.type === undefined) {
    emit("error", "type", `'type' must be one of: ${RECORD_TYPES.join(", ")}.`, "Set 'type' to the record's type (spec §6.2).");
    return;
  }
  if (!Number.isInteger(fm.schema_version)) {
    emit("error", "schema_version", "'schema_version' must be an integer.", "The current schema_version for every type is 1.");
    return;
  }
  const version = fm.schema_version as number;
  if (!schemas.hasType(entry.type)) {
    emit("warning", "schema_version", `No schema for '${entry.type}' records is available yet, so their frontmatter is not checked.`, "Schemas for the remaining types arrive in Phase 2.");
    return;
  }
  const validate = schemas.get(entry.type, version);
  if (!validate) {
    emit("error", "schema_version", `Unsupported ${entry.type} schema_version ${version}.`, "Upgrade OctoSprout or migrate the record to a supported version.");
    return;
  }

  if (validate(fm)) return;
  for (const error of validate.errors ?? []) {
    const message = describeSchemaError(error);
    if (message === undefined) continue;
    emit("error", message.field, message.text, `See schemas/${entry.type}.v${version}.schema.json.`);
  }
}

function describeSchemaError(error: ErrorObject): { field: string | undefined; text: string } | undefined {
  const segments = error.instancePath.split("/").slice(1);
  const top = segments[0];

  if (error.keyword === "required") {
    const missing = String((error.params as { missingProperty: string }).missingProperty);
    if (segments.length === 0 && OWNED_ELSEWHERE.has(missing)) return undefined;
    return { field: top, text: `Missing required field '${[...segments, missing].join(".")}'.` };
  }
  if (top !== undefined && segments.length === 1 && OWNED_ELSEWHERE.has(top)) return undefined;

  if (error.keyword === "additionalProperties") {
    const extra = String((error.params as { additionalProperty: string }).additionalProperty);
    return {
      field: segments.length === 0 ? extra : top,
      text: `Unknown field '${[...segments, extra].join(".")}'. Custom keys must start with 'x-'.`,
    };
  }
  const where = segments.length === 0 ? "Frontmatter" : `'${segments.join(".")}'`;
  return { field: top, text: `${where} ${error.message ?? "is invalid"}.` };
}

// ---------------------------------------------------------------------------
// OSV004: status and lifecycle consistency

function checkStatus(entry: LoadedRecord, findings: Finding[]): void {
  const type = entry.effectiveType;
  if (type === undefined) return;
  const status = entry.record.frontmatter.status;
  const allowed: readonly string[] = STATUSES[type];
  if (typeof status !== "string") {
    report(entry, findings, "OSV004", "error", "status", "Missing or non-string 'status'.", `Allowed for ${type}: ${allowed.join(", ")}.`);
  } else if (!allowed.includes(status)) {
    report(entry, findings, "OSV004", "error", "status", `'${status}' is not a valid ${type} status.`, `Allowed for ${type}: ${allowed.join(", ")}.`);
  }
}

/** A `planted` capture MUST have at least one inbound `derived_from` link (§7.1). */
function checkPlantedCaptures(loaded: readonly LoadedRecord[], findings: Finding[]): void {
  const derivedFrom = new Set<string>();
  for (const entry of loaded) {
    for (const link of readLinks(entry)) {
      if (link.rel === "derived_from") derivedFrom.add(link.target);
    }
  }
  for (const entry of loaded) {
    if (entry.effectiveType !== "capture" || entry.id === undefined) continue;
    if (entry.record.frontmatter.status === "planted" && !derivedFrom.has(entry.id)) {
      report(
        entry,
        findings,
        "OSV004",
        "error",
        "status",
        "Capture is 'planted' but no record links to it with 'derived_from'.",
        "Triage the capture into a record that derives from it, or set the status back to 'new'.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// OSV006: capture immutability

function checkCaptureIntegrity(entry: LoadedRecord, findings: Finding[]): void {
  if (entry.effectiveType !== "capture") return;
  const recorded = entry.record.frontmatter.content_sha256;
  if (typeof recorded !== "string") return;
  const actual = sha256Hex(entry.record.body);
  if (recorded.toLowerCase() !== actual) {
    report(
      entry,
      findings,
      "OSV006",
      "error",
      "content_sha256",
      "Capture body does not match 'content_sha256'; capture bodies are immutable.",
      `Restore the original body. The current body hashes to ${actual}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// OSV011: timestamps

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;

/** Parses a UTC RFC 3339 timestamp into epoch milliseconds, or `undefined` if invalid. */
export function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = TIMESTAMP.exec(value);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(match[i]));
  const ms = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day ||
    hour! > 23 ||
    minute! > 59 ||
    second! > 59
  ) {
    return undefined;
  }
  return ms + (match[7] ? Number(`0${match[7]}`) * 1000 : 0);
}

function checkTimestamps(entry: LoadedRecord, findings: Finding[]): void {
  const fm = entry.record.frontmatter;
  const times: Partial<Record<"created" | "updated", number>> = {};
  for (const field of ["created", "updated"] as const) {
    const value = fm[field];
    if (value === undefined) {
      report(entry, findings, "OSV011", "error", undefined, `Missing '${field}'.`, "Timestamps look like 2026-10-25T14:03:11Z.");
      continue;
    }
    const ms = parseTimestamp(value);
    if (ms === undefined) {
      report(entry, findings, "OSV011", "error", field, `'${field}' is not a valid UTC RFC 3339 timestamp.`, "Use the form 2026-10-25T14:03:11Z, always in UTC with a trailing 'Z'.");
    } else {
      times[field] = ms;
    }
  }
  if (times.created !== undefined && times.updated !== undefined && times.updated < times.created) {
    report(entry, findings, "OSV011", "error", "updated", "'updated' is earlier than 'created'.", "Set 'updated' to a time at or after 'created'.");
  }
}

// ---------------------------------------------------------------------------
// OSV002: duplicate IDs

function checkDuplicateIds(loaded: readonly LoadedRecord[], findings: Finding[]): void {
  const byId = new Map<string, LoadedRecord[]>();
  for (const entry of loaded) {
    if (entry.id === undefined) continue;
    byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  }
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      const others = entries.filter((other) => other !== entry).map((other) => other.path);
      report(entry, findings, "OSV002", "error", "id", `ID ${id} is also used by ${others.join(", ")}.`, "IDs are never renumbered silently; decide which record keeps the ID and resolve the other by hand.");
    }
  }
}

// ---------------------------------------------------------------------------
// OSV005: links

interface ReadLink {
  rel: LinkRel;
  target: string;
}

/** Reads well-formed links. Malformed ones are OSV003's concern. */
function readLinks(entry: LoadedRecord): ReadLink[] {
  const links = entry.record.frontmatter.links;
  if (!Array.isArray(links)) return [];
  const out: ReadLink[] = [];
  for (const item of links as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { rel, id } = item as { rel?: unknown; id?: unknown };
    if (!isLinkRel(rel) || typeof id !== "string") continue;
    const parsed = parseId(id);
    if (parsed?.prefix !== "OS") continue;
    out.push({ rel, target: parsed.id });
  }
  return out;
}

function checkLinks(loaded: readonly LoadedRecord[], findings: Finding[]): void {
  const byId = new Map<string, LoadedRecord>();
  for (const entry of loaded) {
    if (entry.id !== undefined && !byId.has(entry.id)) byId.set(entry.id, entry);
  }

  const symmetricPairs = new Map<string, LoadedRecord>();
  const graphs: Record<"blocks" | "supersedes", Map<string, string[]>> = {
    blocks: new Map(),
    supersedes: new Map(),
  };

  for (const entry of loaded) {
    if (entry.id === undefined) continue;
    const emit = (message: string, hint: string) =>
      report(entry, findings, "OSV005", "error", "links", message, hint);
    const seen = new Set<string>();

    for (const { rel, target } of readLinks(entry)) {
      if (target === entry.id) {
        emit(`${rel} link points at the record itself.`, "Remove the self-link.");
        continue;
      }
      const key = `${rel}:${target}`;
      if (seen.has(key)) {
        emit(`Duplicate link: ${rel} ${target}.`, "Remove the repeated entry.");
        continue;
      }
      seen.add(key);

      const targetEntry = byId.get(target);
      if (!targetEntry) {
        emit(`${rel} target ${target} does not exist.`, "Fix the ID or remove the link. Composted and archived records remain valid targets.");
        continue;
      }
      const sourceType = entry.effectiveType;
      const targetType = targetEntry.effectiveType;
      if (sourceType !== undefined && targetType !== undefined && !isLinkAllowed(rel, sourceType, targetType)) {
        emit(`A ${sourceType} cannot ${rel} a ${targetType} (${target}).`, "See the relationship table in spec §6.3.");
        continue;
      }

      if (rel === "relates_to") {
        const pair = [entry.id, target].sort().join("|");
        const first = symmetricPairs.get(pair);
        if (first && first !== entry) {
          emit(`relates_to ${target} duplicates the link already stored on ${first.id}.`, "relates_to is symmetric; store it on one side only.");
        } else {
          symmetricPairs.set(pair, entry);
        }
      } else if (rel === "blocks" || rel === "supersedes") {
        graphs[rel].set(entry.id, [...(graphs[rel].get(entry.id) ?? []), target]);
      }
    }
  }

  for (const [rel, graph] of Object.entries(graphs) as ["blocks" | "supersedes", Map<string, string[]>][]) {
    for (const cycle of findCycles(graph)) {
      const owner = byId.get(cycle[0]!);
      if (!owner) continue;
      report(owner, findings, "OSV005", "error", "links", `${rel} cycle: ${[...cycle, cycle[0]].join(" -> ")}.`, `Break the cycle by removing one ${rel} link.`);
    }
  }
}

/** Returns one representative path per back edge found by depth-first search. */
function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const state = new Map<string, "active" | "done">();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    state.set(node, "active");
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === "active") {
        cycles.push(stack.slice(stack.indexOf(next)));
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, "done");
  };

  for (const node of [...graph.keys()].sort()) {
    if (!state.has(node)) visit(node);
  }
  return cycles;
}
