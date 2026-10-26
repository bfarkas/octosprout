/**
 * The Ideas, Tasks, Projects and Decisions boards (spec §12, ADR006,
 * boards.md). Columns are statuses in lifecycle order; cards come from the
 * record index and carry the blob SHA they were rendered from. The page can
 * be read without JavaScript; /static/board.js moves cards.
 */
import { allowedTargets, moveKind, unblockedBy, type IndexedRecord, type MoveKind, type RecordIndex, type RecordType } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import type { WorkspaceRecords } from "../records/workspace.js";
import { esc, page, type NavKey } from "./html.js";

export interface BoardOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  records: WorkspaceRecords;
  status: () => Promise<WriteStatus>;
  now?: () => Date;
}

interface Column {
  status: string;
  label: string;
  hint?: string;
  /** Terminal columns start folded. */
  folded?: boolean;
  /** Every move into it needs approval. */
  gated?: boolean;
}

interface Board {
  key: NavKey & ("ideas" | "tasks" | "projects" | "decisions");
  type: RecordType;
  title: string;
  crumbs: readonly [string, string];
  columns: readonly Column[];
  /** Filter by `belongs_to` project. */
  filter: boolean;
}

export const BOARD_DEFS: readonly Board[] = [
  {
    key: "ideas",
    type: "idea",
    title: "Ideas",
    crumbs: ["Garden", "Ideas"],
    filter: false,
    columns: [
      { status: "seed", label: "Seed", hint: "New, unexplored" },
      { status: "sprouting", label: "Sprouting", hint: "Being explored" },
      { status: "ready", label: "Ready", hint: "Ready to promote" },
      { status: "dormant", label: "Dormant", hint: "Paused on purpose" },
      { status: "transplanted", label: "Transplanted", folded: true },
      { status: "composted", label: "Composted", folded: true },
    ],
  },
  {
    key: "tasks",
    type: "task",
    title: "Tasks",
    crumbs: ["Workspace", "Tasks"],
    filter: true,
    columns: [
      { status: "backlog", label: "Backlog" },
      { status: "ready", label: "Ready", hint: "Clear to begin" },
      { status: "in_progress", label: "In progress", hint: "Tending now" },
      { status: "blocked", label: "Blocked", hint: "Needs a little light" },
      { status: "done", label: "Done", hint: "Harvested" },
      { status: "cancelled", label: "Cancelled", folded: true },
    ],
  },
  {
    key: "projects",
    type: "project",
    title: "Projects",
    crumbs: ["Workspace", "Projects"],
    filter: false,
    columns: [
      { status: "proposed", label: "Proposed", hint: "Waiting to take root" },
      { status: "active", label: "Active", hint: "Growing" },
      { status: "on_hold", label: "On hold", hint: "Resting" },
      { status: "completed", label: "Completed", hint: "Bore fruit" },
      { status: "archived", label: "Archived", folded: true },
    ],
  },
  {
    key: "decisions",
    type: "decision",
    title: "Decisions",
    crumbs: ["Knowledge", "Decisions"],
    filter: true,
    columns: [
      { status: "DRAFT", label: "DRAFT", hint: "Being written" },
      { status: "PROPOSED", label: "PROPOSED", hint: "Ready for advice and review" },
      { status: "ACCEPTED", label: "ACCEPTED", hint: "Decided", gated: true },
      { status: "ADOPTED", label: "ADOPTED", hint: "In effect" },
      { status: "SUPERSEDED", label: "SUPERSEDED", folded: true, gated: true },
      { status: "EXPIRED", label: "EXPIRED", folded: true, gated: true },
    ],
  },
];

/** Labels for moves that are not a plain column change. */
const GATED_LABELS: Record<string, string> = {
  transplanted: "Promote…",
  ACCEPTED: "Accept…",
  SUPERSEDED: "Supersede…",
  EXPIRED: "Expire…",
  completed: "Complete…",
  archived: "Archive…",
};

const DAY = 24 * 60 * 60 * 1000;

/** `today`, `yesterday`, `3 d ago`, or the date for anything older than a month. */
export function age(updated: string, now: Date): string {
  const then = Date.parse(updated);
  if (Number.isNaN(then)) return "";
  // Calendar days in UTC: epoch milliseconds start at a UTC midnight.
  const days = Math.floor(now.getTime() / DAY) - Math.floor(then / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 30) return `${days} d ago`;
  return updated.slice(0, 10);
}

function projectOf(record: IndexedRecord): string | undefined {
  return record.links.find((l) => l.rel === "belongs_to")?.id;
}

function chips(record: IndexedRecord, index: RecordIndex): string {
  const out: string[] = record.tags.map((tag) => `<span class="chip">#${esc(tag)}</span>`);
  const backlinks = index.backlinks(record.id);
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  if (record.type === "idea") {
    const captures = record.links.filter((l) => l.rel === "derived_from").length;
    const research = backlinks.filter((b) => b.rel === "supports" && b.source.type === "research").length;
    if (captures > 0) out.push(`<span class="chip">${count(captures, "capture")}</span>`);
    if (research > 0) out.push(`<span class="chip">${research} research</span>`);
  } else if (record.type === "task") {
    const blockers = index.blockedBy(record.id);
    for (const id of blockers) out.push(`<span class="chip block">blocked by ${esc(id)}</span>`);
    const hasBlockers = backlinks.some((b) => b.rel === "blocks");
    if (record.status === "blocked" && hasBlockers && blockers.length === 0) {
      out.push(`<button type="button" class="chip ready" data-action="unblock">unblocked · move to Ready</button>`);
    }
  } else if (record.type === "project") {
    const tasks = backlinks.filter((b) => b.rel === "belongs_to" && b.source.type === "task");
    if (tasks.length > 0) {
      out.push(`<span class="chip">${tasks.filter((t) => t.source.status === "done").length} of ${count(tasks.length, "task")} done</span>`);
    }
  } else if (record.type === "decision") {
    for (const link of record.links.filter((l) => l.rel === "supersedes")) out.push(`<span class="chip">supersedes ${esc(link.id)}</span>`);
    for (const back of backlinks.filter((b) => b.rel === "supersedes")) out.push(`<span class="chip">superseded by ${esc(back.source.id)}</span>`);
  }
  return out.length > 0 ? `<div class="chips">${out.join("")}</div>` : "";
}

function moveOptions(record: IndexedRecord, board: Board, index: RecordIndex): { html: string; targets: string[]; any: boolean } {
  const targets = [...allowedTargets(record.type, record.status)];
  const label = (status: string) => board.columns.find((c) => c.status === status)?.label ?? status;
  const options = targets.map((to) => {
    const kind: MoveKind = moveKind(record.type, record.status, to);
    if (kind !== "direct") {
      // Consequential moves are approved with a passkey through a proposal (§9), not from the board yet.
      return `<option value="${esc(to)}" data-kind="${kind}" disabled>${esc(GATED_LABELS[to] ?? `${label(to)}…`)} (needs approval)</option>`;
    }
    const unblocked = record.type === "task" && to === "done" ? unblockedBy(record.id, index.list("task")) : [];
    const suffix = unblocked.length > 0 ? ` (+${unblocked.length} unblocked)` : "";
    return `<option value="${esc(to)}" data-kind="direct"${unblocked.length > 0 ? ` data-unblocks="${esc(unblocked.join(" "))}"` : ""}>${esc(label(to))}${suffix}</option>`;
  });
  return {
    any: targets.length > 0,
    targets: targets.filter((to) => moveKind(record.type, record.status, to) === "direct"),
    html: `<option value="">Move to…</option>${options.join("")}`,
  };
}

function card(record: IndexedRecord, board: Board, index: RecordIndex, now: Date): string {
  const project = projectOf(record);
  const projectTitle = project ? index.get(project)?.title : undefined;
  const { html: options, targets, any } = moveOptions(record, board, index);
  const blockedBy = record.type === "task" ? index.blockedBy(record.id) : [];
  const movable = targets.length > 0;
  return `<article class="bcard" id="card-${esc(record.id)}" data-id="${esc(record.id)}" data-blob="${esc(record.blob)}" data-status="${esc(record.status)}" data-moves="${esc(targets.join(" "))}"${blockedBy.length > 0 ? ` data-blocked-by="${esc(blockedBy.join(" "))}"` : ""}>
<div class="bcard-top"><button type="button" class="grip" aria-label="Drag ${esc(record.id)} to another column" title="Drag to move"${movable ? "" : " disabled"}>⠿</button><span class="btitle">${esc(record.title || record.id)}</span></div>
<div class="bmeta">${esc(record.id)}${projectTitle ? ` · ${esc(projectTitle)}` : ""}</div>
${chips(record, index)}
<div class="bfoot"><span class="move"><select aria-label="Move ${esc(record.id)} to"${any ? "" : " disabled"}>${options}</select></span><span class="sync"><time datetime="${esc(record.updated)}">${esc(age(record.updated, now))}</time></span></div>
</article>`;
}

function visibleRecords(board: Board, index: RecordIndex, project: string | undefined): IndexedRecord[] {
  return index.list(board.type).filter((r) => project === undefined || projectOf(r) === project);
}

/** The board itself: what the page swaps in when it refreshes (`?fragment=board`). */
export function renderBoard(board: Board, index: RecordIndex, project: string | undefined, now: Date): string {
  const records = visibleRecords(board, index, project);
  const columns = board.columns.map((column) => {
    const cards = records
      .filter((r) => r.status === column.status)
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
    const body = cards.length > 0 ? cards.map((r) => card(r, board, index, now)).join("\n") : `<p class="empty">Nothing here</p>`;
    return `<details class="col${column.gated ? " gated" : ""}" id="col-${esc(column.status)}" data-status="${esc(column.status)}"${column.folded ? "" : " open"}>
<summary><span class="label">${esc(column.label)}</span><span class="count">${cards.length}</span></summary>
${column.hint ? `<div class="colhint">${esc(column.hint)}</div>` : ""}<div class="cards">
${body}
</div>
</details>`;
  });
  return `<div class="board" id="board" data-board="${board.key}" data-version="${index.version(board.type)}">
${columns.join("\n")}
</div>`;
}

function filterForm(board: Board, index: RecordIndex, project: string | undefined): string {
  if (!board.filter) return "";
  const projects = index.list("project").sort((a, b) => a.title.localeCompare(b.title));
  const options = projects.map((p) => `<option value="${esc(p.id)}"${p.id === project ? " selected" : ""}>${esc(p.title)}</option>`).join("");
  return `<form class="filter" method="get" action="/${board.key}"><label for="project">Project</label><select id="project" name="project" data-autosubmit><option value="">All</option>${options}</select><noscript><button type="submit" class="secondary">Filter</button></noscript></form>`;
}

const DIALOGS = `<dialog id="dlg-conflict"><form method="dialog" class="dlg">
<h2>This card changed while you were looking</h2>
<p class="hint"><span class="mono" data-field="id"></span> was changed after this page loaded. Your move was not saved.</p>
<div class="tablewrap"><table class="three"><thead><tr><th>Field</th><th>When you loaded</th><th>Now</th><th>Your move</th></tr></thead><tbody data-field="rows"></tbody></table></div>
<p class="hint" data-field="note"></p>
<div class="actions"><button class="secondary" value="theirs">Keep the current version</button><button value="mine" data-field="mine">Move anyway</button></div>
</form></dialog>
<dialog id="dlg-blocked"><form method="dialog" class="dlg">
<h2>Still blocked</h2>
<p class="hint" data-field="text"></p>
<div class="actions"><button class="secondary" value="cancel">Cancel</button><button value="ok">Move anyway</button></div>
</form></dialog>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;

export function registerBoards(app: FastifyInstance, options: BoardOptions): void {
  const { requireSession, records } = options;
  const now = options.now ?? (() => new Date());

  for (const board of BOARD_DEFS) {
    app.get<{ Querystring: { project?: string; fragment?: string } }>(`/${board.key}`, { preHandler: requireSession }, async (request, reply) => {
      const index = records.index;
      const requested = board.filter ? request.query.project : undefined;
      const project = requested && index.get(requested)?.type === "project" ? index.get(requested)!.id : undefined;
      const html = (body: string) => reply.type("text/html; charset=utf-8").send(body);
      if (request.query.fragment === "board") return html(renderBoard(board, index, project, now()));

      const status = await options.status();
      const count = visibleRecords(board, index, project).length;
      const eyebrow = board.filter ? `<div class="eyebrow">Project: ${project ? esc(index.get(project)!.title) : "all"}</div>` : "";
      const jump = board.columns
        .map((c) => `<a href="#col-${esc(c.status)}">${esc(c.label)}<b>${visibleRecords(board, index, project).filter((r) => r.status === c.status).length}</b></a>`)
        .join("");
      const pending =
        status.pending > 0
          ? `<p class="banner" role="status">${status.pending} change${status.pending === 1 ? "" : "s"} not yet pushed to GitHub. They are safe on the server and sync automatically.</p>`
          : "";
      return html(
        page({
          title: board.title,
          page: "board",
          nav: board.key,
          crumbs: board.crumbs,
          sync: status,
          wide: true,
          scripts: ["app.js", "board.js"],
          body: `<div class="boardhead"><div>${eyebrow}<h1>${board.title} <span class="meta">${count} record${count === 1 ? "" : "s"}</span></h1></div>${filterForm(board, index, project)}</div>
${pending}
<nav class="jump" aria-label="Jump to column">${jump}</nav>
${renderBoard(board, index, project, now())}
${DIALOGS}`,
        }),
      );
    });
  }
}
