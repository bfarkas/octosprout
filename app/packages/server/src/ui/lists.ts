/**
 * The Research and Experts lists (spec §12.2) and Search over title, ID,
 * tags and full text, served from the record index.
 */
import type { IndexedRecord, RecordType } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import type { WorkspaceRecords } from "../records/workspace.js";
import { age } from "./boards.js";
import { esc, page } from "./html.js";

export interface ListOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  records: WorkspaceRecords;
  status: () => Promise<WriteStatus>;
  now?: () => Date;
}

const STATUS_ORDER: Record<string, readonly string[]> = {
  research: ["open", "concluded", "archived"],
  expert: ["active", "retired"],
};

function row(record: IndexedRecord, detail: string, now: Date): string {
  return `<li class="card listrow"><a class="btitle" href="/records/${esc(record.id)}">${esc(record.title || record.id)}</a>
<span class="meta">${esc(record.id)} · <span class="badge">${esc(record.status)}</span> · ${esc(age(record.updated, now))}${detail ? ` · ${detail}` : ""}</span>
${record.tags.length ? `<span class="chips">${record.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join("")}</span>` : ""}</li>`;
}

/** Search results: up to this many. */
const SEARCH_LIMIT = 50;

const TYPE_LABELS: Record<RecordType, string> = {
  capture: "Capture",
  idea: "Idea",
  task: "Task",
  project: "Project",
  decision: "Decision",
  research: "Research",
  expert: "Expert",
  proposal: "Proposal",
};

/** Escapes text and marks each query word in it. */
function highlight(text: string, words: readonly string[]): string {
  if (words.length === 0) return esc(text);
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text
    .split(pattern)
    .map((part, i) => (i % 2 === 1 ? `<mark>${esc(part)}</mark>` : esc(part)))
    .join("");
}

export function registerLists(app: FastifyInstance, options: ListOptions): void {
  const { requireSession, records } = options;
  const now = () => (options.now ?? (() => new Date()))();

  const list = (type: "research" | "expert", path: string, title: string, intro: string, detail: (r: IndexedRecord) => string) =>
    app.get<{ Querystring: { status?: string } }>(path, { preHandler: requireSession }, async (request, reply) => {
      const statuses = STATUS_ORDER[type]!;
      const wanted = request.query.status && statuses.includes(request.query.status) ? request.query.status : undefined;
      const all = records.index.list(type);
      const shown = all
        .filter((r) => (wanted ? r.status === wanted : r.status !== statuses[statuses.length - 1]))
        .sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
      const at = now();
      const filters = [
        `<a href="${path}"${wanted ? "" : ' aria-current="page"'}>Current</a>`,
        ...statuses.map((s) => `<a href="${path}?status=${s}"${wanted === s ? ' aria-current="page"' : ""}>${s} <b>${all.filter((r) => r.status === s).length}</b></a>`),
      ].join("");
      return reply.type("text/html; charset=utf-8").send(
        page({
          title,
          page: type,
          nav: type === "research" ? "research" : "experts",
          crumbs: ["Knowledge", title],
          sync: await options.status(),
          scripts: ["app.js"],
          body: `<div class="boardhead"><div><h1>${title} <span class="meta">${shown.length} shown</span></h1></div><a class="button" href="/new/${type}">New ${type === "expert" ? "expert profile" : "research"}</a></div>
<p class="hint">${intro}</p>
<nav class="jump filters" aria-label="Filter by status">${filters}</nav>
${shown.length ? `<ul class="plain">${shown.map((r) => row(r, detail(r), at)).join("")}</ul>` : `<p class="hint">Nothing here.</p>`}`,
        }),
      );
    });

  list("research", "/research", "Research", "Investigations and their sources. Research supports ideas, projects, decisions and tasks.", (r) => {
    const supports = r.links.filter((l) => l.rel === "supports").length;
    return supports ? `supports ${supports}` : "";
  });
  list("expert", "/experts", "Experts", "Simulated expert profiles for the advise workflow (§14). Their advice is AI-generated and never human review.", (r) => {
    const consulted = records.index.backlinks(r.id).filter((b) => b.rel === "consulted").length;
    return consulted ? `consulted on ${consulted} decision${consulted === 1 ? "" : "s"}` : "";
  });

  app.get<{ Querystring: { q?: string; type?: string } }>("/search", { preHandler: requireSession }, async (request, reply) => {
    const q = (request.query.q ?? "").trim().slice(0, 200);
    const type = request.query.type && request.query.type in TYPE_LABELS ? (request.query.type as RecordType) : undefined;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = q ? records.index.search(q, { ...(type ? { type } : {}), limit: SEARCH_LIMIT }) : [];
    const at = now();
    const results = hits
      .map(
        ({ record, snippet }) => `<li class="card listrow"><a class="btitle" href="/records/${esc(record.id)}">${highlight(record.title || record.id, words)}</a>
<span class="meta">${esc(TYPE_LABELS[record.type])} · ${highlight(record.id, words)} · ${esc(record.status)} · ${esc(age(record.updated, at))}</span>
${snippet ? `<span class="snippet">${highlight(snippet, words)}</span>` : ""}</li>`,
      )
      .join("");
    const typeOptions = Object.entries(TYPE_LABELS)
      .map(([value, label]) => `<option value="${value}"${value === type ? " selected" : ""}>${label}</option>`)
      .join("");
    return reply.type("text/html; charset=utf-8").send(
      page({
        title: q ? `Search: ${q}` : "Search",
        page: "search",
        nav: "record",
        crumbs: ["Workspace", "Search"],
        sync: await options.status(),
        scripts: ["app.js"],
        body: `<h1>Search</h1>
<form class="searchform" method="get" action="/search" role="search">
<input type="search" name="q" value="${esc(q)}" placeholder="Title, ID or text" aria-label="Search" autofocus>
<select name="type" aria-label="Type"><option value="">All types</option>${typeOptions}</select>
<button type="submit">Search</button></form>
${q ? `<p class="hint">${hits.length === SEARCH_LIMIT ? `The first ${SEARCH_LIMIT} results` : `${hits.length} result${hits.length === 1 ? "" : "s"}`} for “${esc(q)}”.</p>` : ""}
${results ? `<ul class="plain">${results}</ul>` : q ? `<p class="hint">Nothing matches every word.</p>` : ""}`,
      }),
    );
  });
}
