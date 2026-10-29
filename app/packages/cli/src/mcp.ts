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
  CREATABLE_TYPES,
  readWorkspaceFiles,
  RECORD_TYPES,
  validateWorkspace,
  type IndexedRecord,
  type Operation,
  type RecordType,
} from "@octosprout/core";
import { z } from "zod";

import { summary } from "./commands.js";
import type { McpBackend } from "./mcp-backend.js";

export type { McpBackend, McpProposal, McpSyncResult } from "./mcp-backend.js";
import { ADVICE_SHAPE, advicePlan, draftRecord, findRecord, handoffBundle, promotionPlan, REPORT_SHAPE, reportPlan, triagePlan, type TriageInput } from "./plans.js";
import { actorFrom, isAgent, Workspace, WorkspaceError } from "./workspace.js";

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

/** Registers the tools; `open` gives the workspace for one tool call. */
export function createMcpServerForBackend(open: () => McpBackend, options: McpOptions = {}): McpServer {
  const server = new McpServer({ name: "octosprout", version: VERSION }, { instructions: "OctoSprout workspace tools. Read tools are free to use. Write tools only create proposals, which the owner approves in the browser; they never change records directly." });

  // An explicit actor must be an agent: everything the MCP server writes is an agent's proposal.
  const configured = options.actor ?? process.env.OCTOSPROUT_ACTOR?.trim();
  if (configured && !isAgent(actorFrom({ OCTOSPROUT_ACTOR: configured }))) throw new WorkspaceError(`The MCP server acts as an agent; OCTOSPROUT_ACTOR must be agent:<name>, not '${configured}'.`);
  const actor = (): string => {
    if (configured) return configured;
    const client = server.server.getClientVersion()?.name ?? "mcp";
    return `agent:${client.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64) || "mcp"}`;
  };

  /** Runs a tool body, turning workspace errors into tool errors. */
  const guarded =
    <A>(body: (args: A) => ToolResult | Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return await body(args);
      } catch (error) {
        if (error instanceof WorkspaceError) return fail(error.message, error.findings.length ? error.findings : undefined);
        return fail((error as Error).message);
      }
    };

  /** Commits the proposal and, unless disabled, pushes it (§16.3). */
  const proposeAndSync = async (ws: McpBackend, input: { title: string; rationale: string; operations: Operation[]; session?: string | undefined }): Promise<ToolResult> => {
    const outcome = await ws.propose({ title: input.title, rationale: input.rationale, operations: input.operations, actor: actor(), ...(input.session ? { session: input.session } : {}) });
    let synced: { pushed: boolean; error?: string } = { pushed: false };
    if (options.sync !== false) {
      try {
        synced = { pushed: (await ws.sync()).pushed };
      } catch (error) {
        synced = { pushed: false, error: (error as Error).message };
      }
    }
    return ok({ ...outcome, synced, next: "The owner reviews and approves it in the browser under Proposals." });
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
    "get_handoff_context",
    {
      description: "The handoff bundle for a task (spec §11.3): the task, its project brief, the accepted decisions, the research, the target repositories and the instructions for the coding agent, as Markdown. Generated on demand, never committed.",
      inputSchema: { task: z.string() },
      annotations: { readOnlyHint: true },
    },
    guarded(({ task }) => ({ content: [{ type: "text", text: handoffBundle(open(), task) }] })),
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

  server.registerTool(
    "draft_record",
    {
      description: "A new record with a fresh ID, from its template, without writing it. Put it in a propose call as { op: 'create', path, content }, together with the operations that link to it.",
      inputSchema: {
        type: z.enum(CREATABLE_TYPES),
        title: z.string().min(1).max(200),
        body: z.string().optional().describe("Markdown body; keep the template's headings. Defaults to the template."),
        project: z.string().optional().describe("For a task, decision or research record: the project it belongs_to."),
        supersedes: z.string().optional().describe("For a decision: the decision it supersedes."),
      },
      annotations: { readOnlyHint: true },
    },
    guarded((input) => ok(draftRecord(open(), input))),
  );

  // --- Write tools: proposals only -------------------------------------------

  server.registerTool(
    "propose",
    {
      description: "Propose changes as operations (spec §9.3). Commits only the proposal file, then syncs. Nothing changes until the owner approves it in the browser.",
      inputSchema: { title: z.string().min(1).max(200), rationale: z.string(), operations: z.array(operationSchema).min(1), session: z.string().max(500).optional() },
    },
    guarded(async ({ title, rationale, operations, session }) => proposeAndSync(open(), { title, rationale, operations: operations as unknown as Operation[], session })),
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
      let input: TriageInput;
      if (action === "create") {
        if (!type) throw new WorkspaceError("create needs a type.");
        input = { capture, action, type, title, body };
      } else if (action === "attach") {
        if (!target) throw new WorkspaceError("attach needs a target.");
        input = { capture, action, target };
      } else input = { capture, action };
      const plan = triagePlan(ws, input);
      return proposeAndSync(ws, { title: plan.title, rationale, operations: plan.operations });
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
      const draft = draftRecord(ws, { type: "decision", title, body, project, supersedes });
      return proposeAndSync(ws, { title: `Draft ADR ${draft.id}: ${title}`, rationale, operations: [{ op: "create", path: draft.path, content: draft.content }] });
    }),
  );

  server.registerTool(
    "propose_advice",
    {
      description: "Propose simulated expert advice on a DRAFT or PROPOSED decision (spec §14): one attributed, simulated ## Advice bullet per perspective, consulted links to the profiles, and research records for long-form advice and the synthesis, listed under Supporting Material. New profiles can be created in the same proposal.",
      inputSchema: { decision: z.string(), ...ADVICE_SHAPE, rationale: z.string() },
    },
    guarded(({ rationale, ...input }) => {
      const ws = open();
      const plan = advicePlan(ws, input);
      return proposeAndSync(ws, { title: plan.title, rationale, operations: plan.operations });
    }),
  );

  server.registerTool(
    "propose_handoff_report",
    {
      description: "Report a coding agent's outcome on a task (spec §11.4): a dated entry in its Handoff log with the outcome, the verification and the references, refs for PRs and commits, optionally a status change and follow-up tasks.",
      inputSchema: { task: z.string(), ...REPORT_SHAPE, rationale: z.string().optional() },
    },
    guarded(({ rationale, ...input }) => {
      const ws = open();
      const plan = reportPlan(ws, input, actor());
      return proposeAndSync(ws, { title: plan.title, rationale: rationale ?? input.outcome, operations: plan.operations });
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
      const plan = promotionPlan(ws, { idea, projectTitle: project_title, projectStatus: project_status, brief, tasks });
      return proposeAndSync(ws, { title: plan.title, rationale, operations: plan.operations });
    }),
  );

  server.registerTool(
    "sync",
    { description: "Fetch, rebase and push the checkout. Pushes only if validation passes." },
    guarded(async () => {
      const result = await open().sync();
      return ok({ pushed: result.pushed, errors: result.findings?.filter((f) => f.severity === "error").length ?? 0 });
    }),
  );

  return server;
}

/** Registers the local backend so `octosprout mcp` remains the public CLI entry point. */
export function createMcpServer(cwd: string, options: McpOptions = {}): McpServer {
  return createMcpServerForBackend(() => Workspace.open(cwd), options);
}

export async function runMcpServer(cwd: string): Promise<void> {
  const server = createMcpServer(cwd);
  await server.connect(new StdioServerTransport());
}
