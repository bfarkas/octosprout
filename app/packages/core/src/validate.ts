/**
 * Workspace validation (spec §19): OSV001–OSV013.
 *
 * The validator is pure: it takes the workspace's files and returns findings.
 * The CLI, the server and CI all call it.
 */
import type { ErrorObject } from "ajv";

import { ADR_FIELDS, ADR_SECTIONS, decisionBodySha256, parseAdr } from "./adr.js";
import { verifyApproval, type Approval, type TrustedKey } from "./approvals.js";
import { CONFIG_PATH, DEFAULT_CONFIG, parseWorkspaceConfig, type WorkspaceConfig } from "./config.js";
import { type Finding, type Severity, type ValidationCode } from "./findings.js";
import { parseId } from "./ids.js";
import { isLinkAllowed, isLinkRel, type LinkRel } from "./links.js";
import { parseRecord, sha256Hex, type ParsedRecord } from "./record.js";
import { SchemaRegistry } from "./schemas.js";
import { scanForSecrets } from "./secrets.js";
import { findSection, hasContent } from "./sections.js";
import { RECORD_TYPES, STATUSES, type RecordType } from "./types.js";

export interface SourceFile {
  /** Workspace-relative path with `/` separators. `octosprout.yaml` is read for the approval keys. */
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
  /** The whole file. */
  text: string;
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

  const config = loadConfig(files, schemas, findings);
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
    checkRefs(entry, findings);
    checkSecrets(entry, findings);
  }

  const index = indexRecords(loaded);
  checkDuplicateIds(loaded, findings);
  checkPlantedCaptures(loaded, findings);
  checkLinks(loaded, findings);
  checkLifecycleLinks(loaded, index, findings);
  checkDecisions(loaded, index, findings);
  checkContracts(loaded, index, findings);
  const validProposals = checkProposals(loaded, config.approvalKeys, findings);
  checkApprovals(loaded, index, validProposals, findings);

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

function loadConfig(files: readonly SourceFile[], schemas: SchemaRegistry, findings: Finding[]): WorkspaceConfig {
  const file = files.find((f) => f.path === CONFIG_PATH);
  if (!file) return DEFAULT_CONFIG;
  const text = typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content);
  const { config, problems } = parseWorkspaceConfig(text, schemas);
  for (const problem of problems) {
    findings.push(finding("OSV003", "error", CONFIG_PATH, undefined, problem.message, "See spec §5.3 and schemas/workspace.v1.schema.json.", problem.line));
  }
  return config;
}

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
  return { path: file.path, text, record, id, type, effectiveType };
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
  const validate = schemas.get(entry.type, version);
  if (!validate) {
    emit("error", "schema_version", `Unsupported ${entry.type} schema_version ${version}.`, "Upgrade OctoSprout or migrate the record to a supported version.");
    return;
  }

  if (validate(fm)) return;
  for (const error of validate.errors ?? []) {
    const message = describeSchemaError(error);
    if (message === undefined) continue;
    const hint = `See schemas/${entry.type}.v${version}.schema.json.`;
    if (message.field === "refs") report(entry, findings, "OSV010", "error", "refs", message.text, hint);
    else emit("error", message.field, message.text, hint);
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

// ---------------------------------------------------------------------------
// Cross-record lookups

interface RecordIndex {
  byId: ReadonlyMap<string, LoadedRecord>;
  /** Links pointing at each ID, with their source. */
  inbound: ReadonlyMap<string, ReadonlyArray<{ rel: LinkRel; source: LoadedRecord }>>;
}

function indexRecords(loaded: readonly LoadedRecord[]): RecordIndex {
  const byId = new Map<string, LoadedRecord>();
  const inbound = new Map<string, Array<{ rel: LinkRel; source: LoadedRecord }>>();
  for (const entry of loaded) {
    if (entry.id !== undefined && !byId.has(entry.id)) byId.set(entry.id, entry);
    for (const { rel, target } of readLinks(entry)) {
      inbound.set(target, [...(inbound.get(target) ?? []), { rel, source: entry }]);
    }
  }
  return { byId, inbound };
}

/** 1-based file line of a 0-based body line. */
function bodyLine(entry: LoadedRecord, index: number): number {
  const prefix = entry.text.slice(0, entry.text.length - entry.record.body.length);
  return prefix.split("\n").length + index;
}

function reportAt(entry: LoadedRecord, findings: Finding[], code: ValidationCode, severity: Severity, line: number | undefined, message: string, hint: string): void {
  findings.push(finding(code, severity, entry.path, entry.id, message, hint, line));
}

// ---------------------------------------------------------------------------
// OSV004: lifecycle states that depend on links

function checkLifecycleLinks(loaded: readonly LoadedRecord[], index: RecordIndex, findings: Finding[]): void {
  for (const entry of loaded) {
    if (entry.id === undefined) continue;
    const status = entry.record.frontmatter.status;
    const emit = (field: string, message: string, hint: string) => report(entry, findings, "OSV004", "error", field, message, hint);

    if (entry.effectiveType === "idea") {
      const promoted = readLinks(entry).filter((link) => link.rel === "promoted_to").length;
      if (status === "transplanted" && promoted !== 1) {
        emit("status", `A transplanted idea needs exactly one promoted_to link; this one has ${promoted}.`, "Promotion adds the promoted_to link and sets 'transplanted' in one commit (spec §10).");
      } else if (status !== "transplanted" && promoted > 0) {
        emit("links", "Only a transplanted idea can have a promoted_to link.", "Promote the idea through the wizard or a promotion proposal, or remove the link.");
      }
    }

    if (entry.effectiveType === "decision" && status === "SUPERSEDED") {
      const newer = (index.inbound.get(entry.id) ?? []).some(({ rel, source }) => rel === "supersedes" && source.effectiveType === "decision");
      if (!newer) {
        emit("status", "A SUPERSEDED decision needs a newer decision that supersedes it.", "Create the replacing decision with a supersedes link to this one (spec §7.6).");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// OSV007: ADR template compliance and frozen bodies

const SELECTION_REQUIRED = new Set(["ACCEPTED", "ADOPTED", "SUPERSEDED"]);
const FROZEN = new Set(["ACCEPTED", "ADOPTED", "SUPERSEDED", "EXPIRED"]);
const TEMPLATE_HINT = "Decisions follow the pinned upstream ADR template (spec §13.1).";

function checkDecisions(loaded: readonly LoadedRecord[], index: RecordIndex, findings: Finding[]): void {
  for (const entry of loaded) {
    if (entry.effectiveType !== "decision" || entry.id === undefined) continue;
    const fm = entry.record.frontmatter;
    const body = entry.record.body;
    const adr = parseAdr(body);
    const error = (at: number | undefined, message: string, hint = TEMPLATE_HINT) =>
      reportAt(entry, findings, "OSV007", "error", at === undefined ? undefined : bodyLine(entry, at), message, hint);
    const warn = (at: number | undefined, message: string, hint = TEMPLATE_HINT) =>
      reportAt(entry, findings, "OSV007", "warning", at === undefined ? undefined : bodyLine(entry, at), message, hint);

    if (!adr.title) {
      error(0, `The body must start with '# ADR ${entry.id} - <title>'.`);
    } else {
      if (adr.title.id.toUpperCase() !== entry.id) error(adr.title.index, `The heading names ${adr.title.id}, not ${entry.id}.`, `Use '# ADR ${entry.id} - <title>'.`);
      if (typeof fm.title === "string" && adr.title.text !== fm.title) warn(adr.title.index, "The heading's title differs from 'title'.", "Keep the heading and the frontmatter title the same.");
    }

    let previous = -1;
    for (const name of ADR_FIELDS) {
      const field = adr.fields.find((f) => f.name === name);
      if (!field) {
        error(adr.title?.index, `Missing the '* ${name}:' line.`);
        continue;
      }
      if (field.index < previous) error(field.index, `'* ${name}:' is out of order; the template has Date, Status, Author.`);
      previous = field.index;
    }
    const statusField = adr.fields.find((f) => f.name === "Status");
    if (statusField && typeof fm.status === "string" && statusField.value !== fm.status) {
      error(statusField.index, `'* Status: ${statusField.value}' does not match the frontmatter status ${fm.status}.`, "A status change rewrites both in the same write (spec §7.6).");
    }

    previous = -1;
    for (const name of ADR_SECTIONS) {
      const section = adr.sections.find((s) => s.text === name);
      if (!section) {
        error(undefined, `Missing the '## ${name}' section.`);
        continue;
      }
      if (section.index < previous) error(section.index, `'## ${name}' is out of order.`, `The template's sections are ${ADR_SECTIONS.join(", ")}.`);
      previous = section.index;
    }
    for (const section of adr.sections) {
      if (!(ADR_SECTIONS as readonly string[]).includes(section.text)) warn(section.index, `'## ${section.text}' is not a template section.`);
    }

    const selected = adr.options.filter((o) => o.selected).length;
    if (typeof fm.status === "string" && SELECTION_REQUIRED.has(fm.status) && selected !== 1) {
      error(undefined, `A ${fm.status} decision needs exactly one '(SELECTED)' option; it has ${selected}.`, "Mark the chosen option '### Option N (SELECTED): …'.");
    }
    for (const option of adr.options) {
      for (const bullet of option.mismatched) {
        const expected = option.selected ? "Adopted because/despite" : "Rejected because/despite";
        warn(bullet.index, `Consequence '${bullet.text}' does not match the option's selection.`, `Consequences of ${option.selected ? "the selected" : "a rejected"} option start with '${expected}:'.`);
      }
    }

    for (const { rel, target } of readLinks(entry)) {
      if (rel !== "consulted") continue;
      const name = index.byId.get(target)?.record.frontmatter.title;
      if (typeof name !== "string" || name === "") continue;
      for (const advice of adr.advice) {
        if (advice.text.toLowerCase().includes(name.toLowerCase()) && !advice.text.includes("(simulated, AI-generated")) {
          error(advice.index, `Advice from the expert profile '${name}' is not marked as simulated and AI-generated.`, "Attribute it as '- [Profile name] (simulated, AI-generated, <model>), <Role>, <Date>' (spec §14).");
        }
      }
    }

    if (typeof fm.status === "string" && FROZEN.has(fm.status) && typeof fm.approval === "string") {
      const approving = index.byId.get(parseId(fm.approval)?.id ?? "");
      if (approving?.effectiveType !== "proposal") continue;
      const operations = approving.record.frontmatter.operations;
      const recorded = (Array.isArray(operations) ? (operations as unknown[]) : [])
        .filter((op): op is { body_sha256: string } => {
          const o = op as Record<string, unknown>;
          return o.op === "set_status" && typeof o.id === "string" && parseId(o.id)?.id === entry.id && typeof o.body_sha256 === "string";
        })
        .at(-1);
      if (!recorded) {
        report(entry, findings, "OSV007", "error", "approval", `${approving.id} records no body_sha256 for this decision, so its frozen body cannot be checked.`, "The approval that accepts a decision records the hash of its body (spec §19).");
      } else if (recorded.body_sha256 !== decisionBodySha256(body)) {
        report(entry, findings, "OSV007", "error", "approval", `The body changed after ${fm.status === "ACCEPTED" ? "it was accepted" : "acceptance"}; only the '* Status:' line may change.`, "Restore the accepted body. A reversal is a new decision that supersedes this one (spec §7.6).");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// OSV009: task readiness and project activation

const TASK_SECTIONS = ["Objective", "Acceptance criteria", "Verification"];
const PROJECT_SECTIONS = ["Goals", "Non-goals", "Scope", "Success criteria"];
const READY_OR_BEYOND = new Set(["ready", "in_progress", "done"]);

function hasRepoRef(entry: LoadedRecord): boolean {
  const refs = entry.record.frontmatter.refs;
  return Array.isArray(refs) && refs.some((ref) => (ref as { kind?: unknown } | null)?.kind === "repo");
}

function checkContracts(loaded: readonly LoadedRecord[], index: RecordIndex, findings: Finding[]): void {
  for (const entry of loaded) {
    const status = entry.record.frontmatter.status;
    const body = entry.record.body;
    const missing = (names: readonly string[]) => names.filter((name) => !hasContent(findSection(body, name)?.content ?? ""));

    if (entry.effectiveType === "task" && typeof status === "string" && READY_OR_BEYOND.has(status)) {
      for (const name of missing(TASK_SECTIONS)) {
        report(entry, findings, "OSV009", "error", "status", `A task in '${status}' needs a non-empty '## ${name}' section.`, "Fill in Objective, Acceptance criteria and Verification before the task moves to ready (spec §11.2).");
      }
      const projects = readLinks(entry).filter((l) => l.rel === "belongs_to").map((l) => index.byId.get(l.target));
      if (!hasRepoRef(entry) && !projects.some((p) => p !== undefined && hasRepoRef(p))) {
        report(entry, findings, "OSV009", "warning", "status", "No target repository: neither the task nor its project has a refs entry of kind repo.", "Add one if the task changes code (spec §11.2).");
      }
    }

    if (entry.effectiveType === "project" && status === "active") {
      for (const name of missing(PROJECT_SECTIONS)) {
        report(entry, findings, "OSV009", "error", "status", `An active project needs a non-empty '## ${name}' section.`, "Fill in Goals, Non-goals, Scope and Success criteria before activating the project (spec §6.5).");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// OSV010: refs

const GITHUB_SHAPES: Record<string, RegExp> = {
  repo: /^\/[^/]+\/[^/]+\/?$/,
  pr: /^\/[^/]+\/[^/]+\/pull\/\d+(\/|$)/,
  issue: /^\/[^/]+\/[^/]+\/issues\/\d+(\/|$)/,
  commit: /^\/[^/]+\/[^/]+\/commit\/[0-9a-f]{7,64}(\/|$)/,
  branch: /^\/[^/]+\/[^/]+\/tree\/.+/,
  file: /^\/[^/]+\/[^/]+\/blob\/.+/,
};

function checkRefs(entry: LoadedRecord, findings: Finding[]): void {
  const refs = entry.record.frontmatter.refs;
  if (!Array.isArray(refs)) return;
  const seen = new Set<string>();
  for (const ref of refs as unknown[]) {
    const { kind, url } = (ref ?? {}) as { kind?: unknown; url?: unknown };
    if (typeof kind !== "string" || typeof url !== "string") continue;
    const warn = (message: string, hint: string) => report(entry, findings, "OSV010", "warning", "refs", message, hint);
    const key = `${kind} ${url}`;
    if (seen.has(key)) warn(`Duplicate ref: ${kind} ${url}.`, "Remove the repeated entry.");
    seen.add(key);

    const shape = GITHUB_SHAPES[kind];
    if (!shape) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.hostname !== "github.com") {
      warn(`The ${kind} ref ${url} is not a GitHub URL.`, `${kind} refs should point at github.com (spec §6.4).`);
    } else if (!shape.test(parsed.pathname)) {
      warn(`${url} does not look like a GitHub ${kind} URL.`, "Check the ref's kind (spec §6.4).");
    }
  }
}

// ---------------------------------------------------------------------------
// OSV013: possible secrets

function checkSecrets(entry: LoadedRecord, findings: Finding[]): void {
  for (const hit of scanForSecrets(entry.text)) {
    reportAt(entry, findings, "OSV013", "warning", hit.index + 1, `Possible ${hit.kind} (${hit.preview}).`, "Never store tokens or keys in records. If it is a secret, remove it, rewrite history if it was pushed, and rotate it (spec §18.3).");
  }
}

// ---------------------------------------------------------------------------
// OSV012: proposal integrity

const OUTCOME: Record<string, Approval["decision"] | undefined> = { applied: "approved", rejected: "rejected" };

/** Returns the IDs of applied proposals whose approval verifies. */
function checkProposals(loaded: readonly LoadedRecord[], keys: readonly TrustedKey[], findings: Finding[]): Set<string> {
  const valid = new Set<string>();
  for (const entry of loaded) {
    if (entry.effectiveType !== "proposal" || entry.id === undefined) continue;
    const fm = entry.record.frontmatter;
    const status = fm.status;
    const approval = fm.approval as Partial<Approval> | undefined;
    const emit = (message: string, hint: string) => report(entry, findings, "OSV012", "error", "approval", message, hint);
    if (typeof status !== "string") continue;

    const expected = OUTCOME[status];
    if (expected === undefined) {
      if (approval !== undefined) emit(`A ${status} proposal must not carry an approval block.`, "Only the server writes approvals, when it applies or rejects a proposal (spec §9.3).");
      continue;
    }
    if (typeof approval !== "object" || approval === null) {
      report(entry, findings, "OSV012", "error", "status", `A ${status} proposal needs an approval block with decision '${expected}'.`, "Only the server writes approvals, when it applies or rejects a proposal (spec §9.3).");
      continue;
    }
    if (approval.decision !== expected) {
      emit(`The approval decision '${String(approval.decision)}' does not match status '${status}'.`, `An ${status} proposal carries decision '${expected}'.`);
      continue;
    }
    if (typeof approval.ops_sha256 !== "string" || typeof approval.signature !== "string" || typeof approval.key_id !== "string" || typeof approval.at !== "string") continue;

    const check = verifyApproval(entry.id, fm.operations, approval as Approval, keys);
    if (check.ok) {
      if (status === "applied") valid.add(entry.id);
    } else if (check.reason === "ops_mismatch") {
      emit("'operations' do not match the approved ops_sha256; the proposal was changed after approval.", "Restore the approved operations. Approved proposals are never edited.");
    } else if (check.reason === "unknown_key") {
      emit(`The approval is signed with key '${approval.key_id}', which is not in approval_public_keys.`, "Trusted keys are listed in octosprout.yaml; adding one is consequential (spec §9.4).");
    } else {
      emit("The approval signature does not verify.", "Approvals are signed by the server's key and cannot be written by hand (spec §9.4).");
    }
  }
  return valid;
}

// ---------------------------------------------------------------------------
// OSV008: consequential states carry valid signed approvals

/** The status an approving `set_status` operation must set for the record's current state, if it needs one. */
function requiredApproval(entry: LoadedRecord): string | undefined {
  const status = entry.record.frontmatter.status;
  switch (entry.effectiveType) {
    case "idea":
      return status === "transplanted" ? "transplanted" : undefined;
    case "decision":
      if (status === "ACCEPTED" || status === "ADOPTED") return "ACCEPTED";
      return status === "SUPERSEDED" || status === "EXPIRED" ? status : undefined;
    case "project":
      // Only a move from `active` is consequential, and validation cannot see
      // history: an approval is checked when present, never demanded.
      return (status === "completed" || status === "archived") && entry.record.frontmatter.approval !== undefined ? status : undefined;
    default:
      return undefined;
  }
}

function checkApprovals(loaded: readonly LoadedRecord[], index: RecordIndex, validProposals: ReadonlySet<string>, findings: Finding[]): void {
  for (const entry of loaded) {
    if (entry.id === undefined || entry.effectiveType === "proposal") continue;
    const reference = entry.record.frontmatter.approval;
    const required = requiredApproval(entry);
    if (reference === undefined && required === undefined) continue;
    const emit = (message: string, hint: string) => report(entry, findings, "OSV008", "error", "approval", message, hint);
    const status = String(entry.record.frontmatter.status);

    if (typeof reference !== "string") {
      report(entry, findings, "OSV008", "error", "status", `'${status}' needs an approval, but the record has none.`, "Consequential changes are approved in the browser UI, which writes the approval (spec §9.1).");
      continue;
    }
    const proposalId = parseId(reference)?.id ?? reference;
    const proposal = index.byId.get(proposalId);
    if (proposal?.effectiveType !== "proposal") {
      emit(`Approval ${reference} does not exist.`, "The approval must reference an applied proposal.");
      continue;
    }
    if (!validProposals.has(proposalId)) {
      emit(`Approval ${proposalId} is not an applied proposal with a valid signature.`, "See the OSV012 findings for that proposal.");
      continue;
    }
    if (required === undefined) continue;
    const operations = proposal.record.frontmatter.operations;
    const authorizes = Array.isArray(operations) && (operations as Array<Record<string, unknown>>).some(
      (op) => op?.op === "set_status" && typeof op.id === "string" && parseId(op.id)?.id === entry.id && op.status === required,
    );
    if (!authorizes) {
      emit(`Approval ${proposalId} does not set ${entry.id} to '${required}'.`, "The approving proposal must contain the operation that produced this state (spec §9.4).");
    }
  }
}
