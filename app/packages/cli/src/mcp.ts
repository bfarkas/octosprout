/**
 * `octosprout mcp`: the local stdio MCP server for Claude Code (spec §16.3).
 *
 * It runs against the current checkout. Read tools read the record index;
 * write tools only create and commit a proposal file, then sync, and never
 * change records: changes take effect after approval in the browser (§9.1).
 * The actor is `agent:<client>`, from OCTOSPROUT_ACTOR or the MCP client's
 * name.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  buildNewRecord,
  generateId,
  planPromotion,
  planTriage,
  prefillFromCapture,
  promotionBrief,
  readWorkspaceFiles,
  RECORD_TYPES,
  validateWorkspace,
  type IndexedRecord,
  type Operation,
  type RecordType,
} from "@octosprout/core";
import { z } from "zod";

import { summary } from "./commands.js";
import { Workspace, WorkspaceError, type WriteOutcome } from "./workspace.js";

const VERSION = "0.0.0";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (message: string, details?: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ error: message, ...(details ? { details } : {}) }, null, 2) }], isError: true });

const operationSchema = z
  .object({ op: z.enum(["create", "update", "set_status", "add_link", "remove_link", "delete"]) })
  .passthrough()
  .describe("An operation of spec §9.3, e.g. { op: 'set_status', id, base_blob, status }. Take base_blob from get_record.");

export interface McpOptions {
  /** `agent:<name>`; defaults to OCTOSPROUT_ACTOR, then the client's name. */
  actor?: string;
  /** Push after committing a proposal. Off in tests without a remote. */
  sync?: boolean;
}

export function createMcpServer(cwd: string, options: McpOptions = {}): McpServer {
  const server = new McpServer({ name: "octosprout", version: VERSION }, { instructions: "OctoSprout workspace tools. Read tools are free to use. Write tools only create proposals, which the owner approves in the browser; they never change records directly." });

  const actor = (): string => {
    const configured = options.actor ?? process.env.OCTOSPROUT_ACTOR;
    if (configured) return configured;
    const client = server.server.getClientVersion()?.name ?? "mcp";
    return `agent:${client.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64) || "mcp"}`;
  };
  const open = () => Workspace.open(cwd);

  /** Runs a tool body, turning workspace errors into tool errors. */
  const guarded =
    <A>(body: (args: A) => ToolResult) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return body(args);
      } catch (error) {
        if (error instanceof WorkspaceError) return fail(error.message, error.findings.length ? error.findings : undefined);
        return fail((error as Error).message);
      }
    };

  /** Commits the proposal and, unless disabled, pushes it (§16.3). */
  const proposeAndSync = (ws: Workspace, input: { title: string; rationale: string; operations: Operation[]; session?: string | undefined }): ToolResult => {
    const outcome: WriteOutcome = ws.propose({ title: input.title, rationale: input.rationale, operations: input.operations, actor: actor(), ...(input.session ? { session: input.session } : {}) });
    let synced: { pushed: boolean; error?: string } = { pushed: false };
    if (options.sync !== false) {
      try {
        synced = { pushed: ws.sync().pushed };
      } catch (error) {
        synced = { pushed: false, error: (error as Error).message };
      }
    }
    return ok({ ...outcome, synced, next: "The owner reviews and approves it in the browser under Proposals." });
  };

  const findRecord = (ws: Workspace, id: string): IndexedRecord => {
    const record = ws.index.get(id);
    if (!record) throw new WorkspaceError(`There is no record ${id}.`);
    return record;
  };

  // --- Read tools ------------------------------------------------------------

  server.registerTool(
    "search_records",
    {
      description: "Search records by words (ID, title, tags, text), type, status or tag. Without words, lists the most recently updated.",
      inputSchema: { query: z.string().optional(), type: z.enum(RECORD_TYPES).optional(), status: z.string().optional(), tag: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true },
    },
    guarded(({ query, type, status, tag, limit }) => {
      const ws = open();
      const max = limit ?? 20;
      const hits = query?.trim()
        ? ws.index.search(query, { ...(type ? { type: type as RecordType } : {}), ...(status ? { status } : {}), limit: 500 })
        : ws.index.list(type as RecordType | undefined).filter((r) => !status || r.status === status).sort((a, b) => b.updated.localeCompare(a.updated)).map((record) => ({ record, snippet: "" }));
      return ok(hits.filter((h) => !tag || h.record.tags.includes(tag)).slice(0, max).map((h) => ({ ...summary(h.record), ...(h.snippet ? { snippet: h.snippet } : {}) })));
    }),
  );

  server.registerTool(
    "get_record",
    { description: "A record in full: frontmatter, body, links, backlinks and its base_blob (needed for operations that change it).", inputSchema: { id: z.string() }, annotations: { readOnlyHint: true } },
    guarded(({ id }) => {
      const ws = open();
      const record = findRecord(ws, id);
      return ok({ ...summary(record), base_blob: record.blob, frontmatter: record.frontmatter, body: record.body, links: record.links, backlinks: ws.index.backlinks(record.id).map((b) => ({ rel: b.rel, id: b.source.id })) });
    }),
  );

  server.registerTool(
    "get_related",
    { description: "Records linked to or from a record, to depth 1 or 2.", inputSchema: { id: z.string(), depth: z.number().int().min(1).max(2).optional() }, annotations: { readOnlyHint: true } },
    guarded(({ id, depth }) => {
      const ws = open();
      const start = findRecord(ws, id);
      const seen = new Map<string, { record: IndexedRecord; via: string; depth: number }>();
      let frontier = [start];
      for (let level = 1; level <= (depth ?? 1); level++) {
        const next: IndexedRecord[] = [];
        for (const record of frontier) {
          const edges = [
            ...record.links.map((l) => ({ id: l.id, via: `${record.id} ${l.rel} →` })),
            ...ws.index.backlinks(record.id).map((b) => ({ id: b.source.id, via: `← ${b.rel} ${record.id}` })),
          ];
          for (const edge of edges) {
            const target = ws.index.get(edge.id);
            if (!target || target.id === start.id || seen.has(target.id)) continue;
            seen.set(target.id, { record: target, via: edge.via, depth: level });
            next.push(target);
          }
        }
        frontier = next;
      }
      return ok([...seen.values()].map(({ record, via, depth: d }) => ({ ...summary(record), via, depth: d })));
    }),
  );

  server.registerTool(
    "list_inbox",
    { description: "Captures with status new, newest first, with their text.", annotations: { readOnlyHint: true } },
    guarded(() => {
      const ws = open();
      return ok(ws.index.list("capture").filter((c) => c.status === "new").sort((a, b) => b.created.localeCompare(a.created)).map((c) => ({ ...summary(c), base_blob: c.blob, source: c.frontmatter.source, text: c.body })));
    }),
  );

  server.registerTool(
    "validate",
    { description: "Validate the workspace (spec §19) and return the findings.", annotations: { readOnlyHint: true } },
    guarded(() => {
      const ws = open();
      const findings = validateWorkspace(readWorkspaceFiles(ws.root));
      return ok({ errors: findings.filter((f) => f.severity === "error").length, warnings: findings.filter((f) => f.severity === "warning").length, findings });
    }),
  );

  server.registerTool(
    "list_proposals",
    { description: "Proposals and their status (pending, applied, rejected, stale).", inputSchema: { status: z.enum(["pending", "applied", "rejected", "stale"]).optional() }, annotations: { readOnlyHint: true } },
    guarded(({ status }) => {
      const ws = open();
      return ok(ws.index.list("proposal").filter((p) => !status || p.status === status).sort((a, b) => b.created.localeCompare(a.created)).map((p) => ({ ...summary(p), consequential: p.frontmatter.consequential === true })));
    }),
  );

  // --- Write tools: proposals only -------------------------------------------

  server.registerTool(
    "propose",
    {
      description: "Propose changes as operations (spec §9.3). Commits only the proposal file, then syncs. Nothing changes until the owner approves it in the browser.",
      inputSchema: { title: z.string().min(1).max(200), rationale: z.string(), operations: z.array(operationSchema).min(1), session: z.string().max(500).optional() },
    },
    guarded(({ title, rationale, operations, session }) => proposeAndSync(open(), { title, rationale, operations: operations as unknown as Operation[], session })),
  );

  server.registerTool(
    "propose_triage",
    {
      description: "Propose triaging a capture: make it an idea, task or research record (derived_from the capture), attach it to an existing one, or compost it.",
      inputSchema: {
        capture: z.string(),
        action: z.enum(["create", "attach", "compost"]),
        type: z.enum(["idea", "task", "research"]).optional(),
        title: z.string().max(200).optional().describe("Defaults to the first line of the capture."),
        body: z.string().optional().describe("Markdown body for a new record; defaults to the quoted capture and the template."),
        target: z.string().optional().describe("The record to attach the capture to."),
        rationale: z.string(),
      },
    },
    guarded(({ capture, action, type, title, body, target, rationale }) => {
      const ws = open();
      const source = findRecord(ws, capture);
      let operations: Operation[];
      if (action === "create") {
        if (!type) throw new WorkspaceError("create needs a type.");
        const prefill = prefillFromCapture(type, source.body);
        operations = planTriage(source, { action, type, id: ws.newId(type), title: title || prefill.title, body: body ?? prefill.body, now: ws.now() });
      } else if (action === "attach") {
        if (!target) throw new WorkspaceError("attach needs a target.");
        operations = planTriage(source, { action, target: findRecord(ws, target) });
      } else {
        operations = planTriage(source, { action });
      }
      return proposeAndSync(ws, { title: `Triage ${source.id}: ${action}${title ? ` ${title}` : target ? ` to ${target}` : ""}`, rationale, operations });
    }),
  );

  server.registerTool(
    "propose_adr",
    {
      description: "Propose a new DRAFT decision (ADR) from the pinned template (spec §13). Pass the full ADR body to fill in Decision, Context, Options and Supporting Material; keep the template's headings.",
      inputSchema: { title: z.string().min(1).max(200), project: z.string().optional(), supersedes: z.string().optional(), body: z.string().optional(), rationale: z.string() },
    },
    guarded(({ title, project, supersedes, body, rationale }) => {
      const ws = open();
      if (project && ws.index.get(project)?.type !== "project") throw new WorkspaceError(`${project} is not a project.`);
      if (supersedes && ws.index.get(supersedes)?.type !== "decision") throw new WorkspaceError(`${supersedes} is not a decision.`);
      const id = ws.newId("decision");
      const author = ws.config().author;
      const built = buildNewRecord({ type: "decision", id, title, now: ws.now(), ...(project ? { project: ws.index.get(project)!.id } : {}), ...(supersedes ? { supersedes: ws.index.get(supersedes)!.id } : {}), ...(author ? { author } : {}) });
      const content = body ? built.content.slice(0, built.content.indexOf("\n---\n") + 5) + body : built.content;
      return proposeAndSync(ws, { title: `Draft ADR ${id}: ${title}`, rationale, operations: [{ op: "create", path: built.path, content }] });
    }),
  );

  server.registerTool(
    "propose_promotion",
    {
      description: "Propose promoting a ready idea to a project (spec §10): the project brief, optional initial tasks, promoted_to and the idea moving to transplanted, as one consequential proposal.",
      inputSchema: {
        idea: z.string(),
        project_title: z.string().min(1).max(200),
        project_status: z.enum(["proposed", "active"]).optional(),
        brief: z.string().optional().describe("The project brief (Markdown, project template sections). Defaults to the template with the idea and its research under Related."),
        tasks: z.array(z.string().min(1).max(200)).max(20).optional(),
        rationale: z.string(),
      },
    },
    guarded(({ idea, project_title, project_status, brief, tasks, rationale }) => {
      const ws = open();
      const source = findRecord(ws, idea);
      if (source.type !== "idea" || source.status !== "ready") throw new WorkspaceError(`${source.id} is not a ready idea.`);
      const taken = new Set<string>();
      const fresh = (type: "project" | "task") => {
        const id = generateId(type, { exists: (candidate) => ws.index.has(candidate) || taken.has(candidate) });
        taken.add(id);
        return id;
      };
      const research = ws.index.backlinks(source.id).filter((b) => b.rel === "supports" && b.source.type === "research").map((b) => b.source);
      const operations = planPromotion({
        idea: source,
        project: { id: fresh("project"), title: project_title, status: project_status ?? "proposed", body: brief ?? promotionBrief(source.id, research) },
        tasks: (tasks ?? []).map((title) => ({ id: fresh("task"), title })),
        now: ws.now(),
      });
      return proposeAndSync(ws, { title: `Promote ${source.id} to ${project_title}`, rationale, operations });
    }),
  );

  server.registerTool(
    "sync",
    { description: "Fetch, rebase and push the checkout. Pushes only if validation passes." },
    guarded(() => {
      const result = open().sync();
      return ok({ pushed: result.pushed, errors: result.findings.filter((f) => f.severity === "error").length });
    }),
  );

  return server;
}

export async function runMcpServer(cwd: string): Promise<void> {
  const server = createMcpServer(cwd);
  await server.connect(new StdioServerTransport());
}
