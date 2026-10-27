/**
 * The workspace commands of the CLI (spec §4.1, §8.5, §16.2): new,
 * capture, show, search, inbox, triage, promote, advise, move, link, unlink,
 * propose, proposals and sync. Each takes `--json` for machine-readable output, so the skills can
 * use the CLI when MCP is not available.
 *
 * Exit codes: 0 done, 1 refused (validation, lifecycle, missing record),
 * 2 usage or environment error.
 */
import { readFileSync } from "node:fs";

import {
  allowedTargets,
  CREATABLE_TYPES,
  isLinkRel,
  moveKind,
  parseId,
  RECORD_TYPES,
  renderRecord,
  sha256Hex,
  unblockedBy,
  type CreatableType,
  type IndexedRecord,
  type Operation,
  type RecordType,
} from "@octosprout/core";

import { z } from "zod";

import type { Io } from "./io.js";
import { ADVICE_SHAPE, advicePlan, draftRecord, promotionPlan, triagePlan, type TriageInput } from "./plans.js";
import { actorFrom, Workspace, WorkspaceError, type WriteOutcome } from "./workspace.js";

export interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

/** `--name value` and `--name` flags; everything else is positional. */
export function parseArgs(args: readonly string[], booleans: readonly string[] = ["json"]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (booleans.includes(name)) flags.set(name, true);
      else {
        const value = args[i + 1];
        if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
        flags.set(name, value);
        i++;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

export class UsageError extends Error {}

const flag = (parsed: Parsed, name: string): string | undefined => {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
};

export interface CommandContext {
  cwd: string;
  io: Io;
  env?: NodeJS.ProcessEnv;
  /** Reads standard input, for `capture -` and `propose -`. */
  stdin?: () => string;
}

type Command = (args: readonly string[], context: CommandContext, ws: Workspace) => number;

function print(context: CommandContext, json: boolean, data: unknown, text: () => string): void {
  context.io.out(json ? JSON.stringify(data, null, 2) : text());
}

function describeWrite(outcome: WriteOutcome): string {
  if (outcome.kind === "committed") return `Committed ${outcome.commit.slice(0, 7)}: ${outcome.changed.join(", ")}`;
  const why = outcome.reasons.length ? ` It is consequential: ${outcome.reasons.join(" ")}` : "";
  return `Proposed ${outcome.proposal} (${outcome.commit.slice(0, 7)}).${why} Approve it in the browser under Proposals, after \`octosprout sync\`.`;
}

function requireRecord(ws: Workspace, id: string | undefined): IndexedRecord {
  if (!id) throw new UsageError("a record ID is required");
  const record = ws.index.get(id);
  if (!record) throw new WorkspaceError(`There is no record ${id}.`);
  return record;
}

/** The summary of a record the CLI and MCP print. */
export function summary(record: IndexedRecord): Record<string, unknown> {
  return { id: record.id, type: record.type, title: record.title, status: record.status, path: record.path, updated: record.updated, tags: record.tags };
}

// ---------------------------------------------------------------------------

const newCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args, ["json", "draft"]);
  const [type, ...words] = parsed.positional;
  if (!type || !(CREATABLE_TYPES as readonly string[]).includes(type)) throw new UsageError(`usage: octosprout new <${CREATABLE_TYPES.join("|")}> <title…> [--project ID] [--supersedes ID] [--body-file FILE] [--draft]`);
  const title = words.join(" ").trim();
  if (!title) throw new UsageError("a title is required");
  const { id, path, content } = draftRecord(ws, {
    type: type as CreatableType,
    title,
    body: fileFlag(parsed, "body-file", context),
    project: flag(parsed, "project"),
    supersedes: flag(parsed, "supersedes"),
  });
  if (parsed.flags.has("draft")) {
    // Nothing is written: the record goes into a larger proposal as a `create` operation.
    print(context, parsed.flags.has("json"), { id, path, content }, () => content);
    return 0;
  }
  const actor = actorFrom(context.env);
  const outcome = ws.write({ operations: [{ op: "create", path, content }], title: `Create ${type} ${title}`, rationale: `New ${type}: ${title}`, actor, operation: "create", subject: `create: ${id} ${title}` });
  print(context, parsed.flags.has("json"), { id, path, ...outcome }, () => `${id} ${title}\n${describeWrite(outcome)}`);
  return 0;
};

/** Reads a text option given as a file path, or `-` for stdin. */
const fileFlag = (parsed: Parsed, name: string, context: CommandContext): string | undefined => {
  const value = flag(parsed, name);
  return value === undefined ? undefined : value === "-" ? context.stdin!() : readFileSync(value, "utf8");
};

const TRIAGE_USAGE = "usage: octosprout triage <capture> create <idea|task|research> [title…] [--body-file FILE|-] | attach <ID> | compost [--rationale TEXT]";

const triageCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const [capture, action, ...rest] = parsed.positional;
  if (!capture) throw new UsageError(TRIAGE_USAGE);
  let input: TriageInput;
  if (action === "create") {
    const [type, ...words] = rest;
    if (type !== "idea" && type !== "task" && type !== "research") throw new UsageError(TRIAGE_USAGE);
    input = { capture, action, type, title: words.join(" "), body: fileFlag(parsed, "body-file", context) };
  } else if (action === "attach" && rest.length === 1) {
    input = { capture, action, target: rest[0]! };
  } else if (action === "compost" && rest.length === 0) {
    input = { capture, action };
  } else throw new UsageError(TRIAGE_USAGE);
  const plan = triagePlan(ws, input);
  const outcome = ws.write({ operations: plan.operations, title: plan.title, rationale: flag(parsed, "rationale") ?? plan.title, actor: actorFrom(context.env), operation: "triage", subject: `triage: ${plan.title.replace(/^Triage /, "")}` });
  print(context, parsed.flags.has("json"), { ...(plan.created ? { id: plan.created } : {}), ...outcome }, () => describeWrite(outcome));
  return 0;
};

const PROMOTE_USAGE = "usage: octosprout promote <idea> <project title…> [--brief-file FILE|-] [--tasks-file FILE|-] [--active] [--rationale TEXT]";

const promoteCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args, ["json", "active"]);
  const [idea, ...words] = parsed.positional;
  const projectTitle = words.join(" ").trim();
  if (!idea || !projectTitle) throw new UsageError(PROMOTE_USAGE);
  if (flag(parsed, "brief-file") === "-" && flag(parsed, "tasks-file") === "-") throw new UsageError("only one of --brief-file and --tasks-file can read stdin");
  const tasks = fileFlag(parsed, "tasks-file", context)?.split("\n").map((line) => line.replace(/^\s*(?:[-*]|\d+\.)?\s*/, "").trim()).filter(Boolean);
  const plan = promotionPlan(ws, { idea, projectTitle, projectStatus: parsed.flags.has("active") ? "active" : "proposed", brief: fileFlag(parsed, "brief-file", context), tasks });
  // A promotion is consequential, so this always becomes a proposal (§10).
  const outcome = ws.write({ operations: plan.operations, title: plan.title, rationale: flag(parsed, "rationale") ?? plan.title, actor: actorFrom(context.env), operation: "promote", subject: plan.title });
  print(context, parsed.flags.has("json"), { project: plan.project, ...outcome }, () => `${plan.project} ${projectTitle}\n${describeWrite(outcome)}`);
  return 0;
};

const ADVISE_USAGE = "usage: octosprout advise <decision> <file.json | -> where the JSON is { model, advice: [{ expert, role, advice, long_form? }], new_experts?, synthesis?, rationale? }";

const adviseCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const [decision, source] = parsed.positional;
  if (!decision || !source) throw new UsageError(ADVISE_USAGE);
  let raw: unknown;
  try {
    raw = JSON.parse(source === "-" ? (context.stdin?.() ?? "") : readFileSync(source, "utf8"));
  } catch (error) {
    throw new UsageError(`the advice is not valid JSON: ${(error as Error).message}`);
  }
  const input = z.object({ ...ADVICE_SHAPE, rationale: z.string().optional() }).safeParse(raw);
  if (!input.success) throw new UsageError(`the advice does not match: ${z.prettifyError(input.error)}`);
  const plan = advicePlan(ws, { ...input.data, decision });
  const outcome = ws.write({ operations: plan.operations, title: plan.title, rationale: input.data.rationale ?? plan.title, actor: actorFrom(context.env), operation: "advise", subject: `advise: ${plan.title.replace(/^Advice on /, "")}` });
  print(context, parsed.flags.has("json"), outcome, () => describeWrite(outcome));
  return 0;
};

const SOURCES = ["shortcut", "chatgpt", "claude", "apple-notes", "web", "cli", "other"];

const captureCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const text = parsed.positional.length === 0 || parsed.positional[0] === "-" ? (context.stdin?.() ?? "") : parsed.positional.join(" ");
  if (!text.trim()) throw new UsageError("usage: octosprout capture <text…> | - [--source claude] [--url https://…]");
  const source = flag(parsed, "source") ?? "cli";
  const url = flag(parsed, "url");
  if (url && !/^https:\/\/\S+$/.test(url)) throw new UsageError("--url must be an https URL");
  const now = ws.now();
  const id = ws.newId("capture");
  const known = SOURCES.includes(source);
  const content = renderRecord(
    {
      id,
      type: "capture",
      schema_version: 1,
      status: "new",
      created: now,
      updated: now,
      source: known ? source : "other",
      ...(known ? {} : { source_detail: source.slice(0, 64) }),
      ...(url ? { source_url: url } : {}),
      idempotency_key: `cli-${id}-${now.replace(/[^0-9]/g, "")}`,
      received_via: "cli",
      content_sha256: sha256Hex(text),
    },
    text,
  );
  const path = `records/captures/${now.slice(0, 4)}/${now.slice(5, 7)}/${id}.md`;
  const outcome = ws.write({ operations: [{ op: "create", path, content }], title: `Capture ${id}`, rationale: "A capture from the CLI.", actor: actorFrom(context.env), operation: "capture", subject: `capture: ${id} (${source})` });
  print(context, parsed.flags.has("json"), { id, path, ...outcome }, () => `${id}\n${describeWrite(outcome)}`);
  return 0;
};

const showCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const record = requireRecord(ws, parsed.positional[0]);
  const backlinks = ws.index.backlinks(record.id).map((b) => ({ rel: b.rel, id: b.source.id, title: b.source.title }));
  const data = { ...summary(record), base_blob: record.blob, links: record.links, backlinks, refs: record.refs, frontmatter: record.frontmatter, body: record.body };
  print(context, parsed.flags.has("json"), data, () => {
    const lines = [`${record.id} · ${record.type} · ${record.status}`, record.title, record.path, `base_blob ${record.blob}`];
    for (const l of record.links) lines.push(`→ ${l.rel} ${l.id}`);
    for (const b of backlinks) lines.push(`← ${b.rel} ${b.id} ${b.title}`);
    return `${lines.join("\n")}\n\n${record.body}`;
  });
  return 0;
};

const searchCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const type = flag(parsed, "type");
  if (type && !(RECORD_TYPES as readonly string[]).includes(type)) throw new UsageError(`--type is one of ${RECORD_TYPES.join(", ")}`);
  const status = flag(parsed, "status");
  const query = parsed.positional.join(" ");
  const hits = query.trim()
    ? ws.index.search(query, { ...(type ? { type: type as RecordType } : {}), ...(status ? { status } : {}), limit: Number(flag(parsed, "limit") ?? 20) })
    : ws.index
        .list(type as RecordType | undefined)
        .filter((r) => !status || r.status === status)
        .sort((a, b) => b.updated.localeCompare(a.updated))
        .slice(0, Number(flag(parsed, "limit") ?? 20))
        .map((record) => ({ record, score: 0, snippet: "" }));
  print(context, parsed.flags.has("json"), hits.map((h) => ({ ...summary(h.record), snippet: h.snippet })), () =>
    hits.length ? hits.map((h) => `${h.record.id}  ${h.record.status.padEnd(12)} ${h.record.title || h.snippet}`).join("\n") : "Nothing found.",
  );
  return 0;
};

const inboxCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const captures = ws.index
    .list("capture")
    .filter((c) => c.status === "new")
    .sort((a, b) => b.created.localeCompare(a.created));
  print(context, parsed.flags.has("json"), captures.map((c) => ({ ...summary(c), source: c.frontmatter.source, text: c.body })), () =>
    captures.length ? captures.map((c) => `${c.id}  ${c.created}  ${String(c.frontmatter.source)}\n  ${c.body.split("\n")[0]?.slice(0, 100) ?? ""}`).join("\n") : "The Inbox is empty.",
  );
  return 0;
};

const moveCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const record = requireRecord(ws, parsed.positional[0]);
  const to = parsed.positional[1];
  if (!to) throw new UsageError("usage: octosprout move <ID> <status>");
  if (!allowedTargets(record.type, record.status).includes(to)) {
    throw new WorkspaceError(`${record.id} cannot move from ${record.status} to ${to}. Allowed: ${allowedTargets(record.type, record.status).join(", ") || "none"}.`);
  }
  if (moveKind(record.type, record.status, to) === "promotion") throw new WorkspaceError("An idea is promoted with a promotion proposal (the promote skill or the wizard in the browser).");
  if (moveKind(record.type, record.status, to) === "triage") throw new WorkspaceError("A capture is planted by triaging it.");
  const operations: Operation[] = [{ op: "set_status", id: record.id, base_blob: record.blob, status: to }];
  // Finishing a blocker unblocks the tasks it was the last open blocker of (§7.3).
  const unblocked = record.type === "task" && to === "done" ? unblockedBy(record.id, ws.index.list("task")) : [];
  for (const id of unblocked) operations.push({ op: "set_status", id, base_blob: ws.index.get(id)!.blob, status: "ready" });
  const suffix = unblocked.length ? ` (+${unblocked.length} unblocked)` : "";
  const outcome = ws.write({ operations, title: `Move ${record.id} to ${to}`, rationale: `Move ${record.id} from ${record.status} to ${to}${suffix}.`, actor: actorFrom(context.env), operation: "status", subject: `status: ${record.id} ${record.status} -> ${to}${suffix}` });
  print(context, parsed.flags.has("json"), { id: record.id, from: record.status, to, unblocked, ...outcome }, () => describeWrite(outcome));
  return 0;
};

const linkCommand = (remove: boolean): Command => (args, context, ws) => {
  const parsed = parseArgs(args);
  const [id, rel, target] = parsed.positional;
  if (!id || !rel || !target) throw new UsageError(`usage: octosprout ${remove ? "unlink" : "link"} <ID> <rel> <target ID>`);
  if (!isLinkRel(rel)) throw new UsageError(`unknown relationship '${rel}'`);
  const record = requireRecord(ws, id);
  const targetId = parseId(target)?.id;
  if (!targetId) throw new UsageError(`'${target}' is not an ID`);
  const operations: Operation[] = [{ op: remove ? "remove_link" : "add_link", id: record.id, base_blob: record.blob, link: { rel, id: targetId } }];
  const verb = remove ? "unlink" : "link";
  const outcome = ws.write({ operations, title: `${remove ? "Unlink" : "Link"} ${record.id} ${rel} ${targetId}`, rationale: `${record.id} ${rel} ${targetId}.`, actor: actorFrom(context.env), operation: "edit", subject: `${verb}: ${record.id} ${rel} ${targetId}` });
  print(context, parsed.flags.has("json"), outcome, () => describeWrite(outcome));
  return 0;
};

const proposeCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const source = parsed.positional[0];
  if (!source) throw new UsageError("usage: octosprout propose <file.json | -> where the JSON is { title, rationale, operations }");
  const raw = source === "-" ? (context.stdin?.() ?? "") : readFileSync(source, "utf8");
  let input: { title?: unknown; rationale?: unknown; operations?: unknown; session?: unknown };
  try {
    input = JSON.parse(raw) as typeof input;
  } catch (error) {
    throw new UsageError(`the proposal is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof input.title !== "string" || !Array.isArray(input.operations)) throw new UsageError("the proposal needs 'title' and 'operations'");
  const actor = actorFrom(context.env);
  const outcome = ws.propose({
    title: input.title,
    rationale: typeof input.rationale === "string" ? input.rationale : "",
    operations: input.operations as Operation[],
    actor,
    ...(typeof input.session === "string" ? { session: input.session } : {}),
  });
  print(context, parsed.flags.has("json"), outcome, () => describeWrite(outcome));
  return 0;
};

const proposalsCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const status = flag(parsed, "status");
  const proposals = ws.index
    .list("proposal")
    .filter((p) => (status ? p.status === status : p.status === "pending" || p.status === "stale"))
    .sort((a, b) => b.created.localeCompare(a.created));
  print(context, parsed.flags.has("json"), proposals.map((p) => ({ ...summary(p), consequential: p.frontmatter.consequential === true, actor: (p.frontmatter.origin as { actor?: string } | undefined)?.actor })), () =>
    proposals.length ? proposals.map((p) => `${p.id}  ${p.status.padEnd(8)} ${p.frontmatter.consequential === true ? "consequential" : "routine      "}  ${p.title}`).join("\n") : "No proposals.",
  );
  return 0;
};

const syncCommand: Command = (args, context, ws) => {
  const parsed = parseArgs(args);
  const result = ws.sync();
  const errors = result.findings.filter((f) => f.severity === "error");
  print(context, parsed.flags.has("json"), { pushed: result.pushed, errors: errors.length }, () =>
    result.pushed ? "Synced: fetched, rebased and pushed." : `Not pushed: validation found ${errors.length} error(s). Run \`octosprout validate\`.`,
  );
  return result.pushed ? 0 : 1;
};

export const COMMANDS: Record<string, Command> = {
  new: newCommand,
  capture: captureCommand,
  show: showCommand,
  search: searchCommand,
  inbox: inboxCommand,
  move: moveCommand,
  link: linkCommand(false),
  unlink: linkCommand(true),
  triage: triageCommand,
  promote: promoteCommand,
  advise: adviseCommand,
  propose: proposeCommand,
  proposals: proposalsCommand,
  sync: syncCommand,
};

/** Runs a workspace command and maps errors to exit codes. */
export function runCommand(name: string, args: readonly string[], context: CommandContext): number {
  const command = COMMANDS[name];
  if (!command) throw new Error(`unknown command ${name}`);
  try {
    return command(args, context, Workspace.open(context.cwd));
  } catch (error) {
    if (error instanceof UsageError) {
      context.io.err(`octosprout ${name}: ${error.message}`);
      return 2;
    }
    if (error instanceof WorkspaceError) {
      context.io.err(`octosprout ${name}: ${error.message}`);
      for (const f of error.findings) context.io.err(`  ${f.code} ${f.path}: ${f.message}`);
      return 1;
    }
    throw error;
  }
}
