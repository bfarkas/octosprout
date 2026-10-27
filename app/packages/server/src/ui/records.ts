/**
 * Record detail and editing (spec §12.2): the rendered body, links and
 * backlinks, refs, history, and an editor with a form and a whole-file mode.
 * /static/record.js saves edits and status moves, and shows the three-way
 * merge after a conflict (§8.4).
 */
import { ADVISABLE_STATUSES, allowedTargets, LINK_RELS, moveKind, parseAdr, type IndexedRecord, type RecordIndex, type RecordType } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import type { StatusMoveDeps } from "../records/status.js";
import { age, BOARD_DEFS } from "./boards.js";
import { esc, page, type NavKey } from "./html.js";
import { renderMarkdown } from "./markdown.js";

export interface RecordPageOptions extends StatusMoveDeps {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  status: () => Promise<WriteStatus>;
  approvals?: () => boolean;
}

const TYPE_LABELS: Record<RecordType, [singular: string, plural: string]> = {
  capture: ["Capture", "Captures"],
  idea: ["Idea", "Ideas"],
  task: ["Task", "Tasks"],
  project: ["Project", "Projects"],
  decision: ["Decision", "Decisions"],
  research: ["Research", "Research"],
  expert: ["Expert", "Experts"],
  proposal: ["Proposal", "Proposals"],
};

const NAV_BY_TYPE: Partial<Record<RecordType, NavKey>> = {
  capture: "inbox",
  idea: "ideas",
  task: "tasks",
  project: "projects",
  decision: "decisions",
  research: "research",
  expert: "experts",
  proposal: "proposals",
};

const REF_KINDS = ["repo", "pr", "commit", "branch", "issue", "file", "url"] as const;
const FROZEN_DECISIONS = new Set(["ACCEPTED", "ADOPTED", "SUPERSEDED", "EXPIRED"]);

export function recordUrl(id: string): string {
  return `/records/${encodeURIComponent(id)}`;
}

function statusLabel(record: IndexedRecord, status: string): string {
  return BOARD_DEFS.find((b) => b.type === record.type)?.columns.find((c) => c.status === status)?.label ?? status;
}

function linkTo(index: RecordIndex, id: string): string {
  const target = index.get(id);
  return target
    ? `<a href="${recordUrl(target.id)}">${esc(target.title || target.id)}</a> <span class="meta">${esc(target.id)} · ${esc(target.status)}</span>`
    : `<span class="mono">${esc(id)}</span> <span class="meta">(missing)</span>`;
}

function statusControl(record: IndexedRecord, approvals: boolean): string {
  const targets = allowedTargets(record.type, record.status);
  if (targets.length === 0 || record.type === "capture" || record.type === "proposal") return "";
  const options = targets
    .map((to) => {
      const kind = moveKind(record.type, record.status, to);
      if (kind === "direct") return `<option value="${esc(to)}">${esc(statusLabel(record, to))}</option>`;
      if (kind === "approval" && approvals) return `<option value="${esc(to)}">${esc(statusLabel(record, to))}… (approval)</option>`;
      if (kind === "promotion" && approvals) return `<option value="${esc(to)}" data-kind="promotion">Promote…</option>`;
      return `<option value="${esc(to)}" disabled>${esc(statusLabel(record, to))} (needs the approval key)</option>`;
    })
    .join("");
  return `<span class="move"><select id="move" aria-label="Move ${esc(record.id)} to"><option value="">Move to…</option>${options}</select></span>`;
}

/** The decision's advice at a glance (§12.1, §14): who was consulted, and what is simulated. */
function advicePanel(record: IndexedRecord, index: RecordIndex): string {
  const advice = parseAdr(record.body).advice.filter((a) => !/^\[.*\]/.test(a.text));
  const simulated = advice.filter((a) => a.text.includes("(simulated, AI-generated")).length;
  const consulted = record.links.filter((l) => l.rel === "consulted");
  const research = index.backlinks(record.id).filter((b) => b.rel === "supports" && b.source.type === "research");
  const facts = [
    advice.length === 0 ? "No advice yet." : `${advice.length} advice ${advice.length === 1 ? "entry" : "entries"}${simulated ? `, <span class="badge gated">${simulated} simulated</span>` : ""}`,
    ...consulted.map((l) => `<span class="rel">consulted</span> ${linkTo(index, l.id)}`),
    ...research.map((b) => `<span class="rel">supporting</span> ${linkTo(index, b.source.id)}`),
  ];
  const hint = ADVISABLE_STATUSES.includes(record.status)
    ? "Ask an agent to run the advise skill. Simulated advice is AI-generated and is never human review."
    : "Simulated advice is AI-generated and is never human review.";
  return `<h2>Advice</h2><ul class="plain facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul><p class="hint">${hint}</p>`;
}

function sidePanel(record: IndexedRecord, index: RecordIndex, history: Awaited<ReturnType<RecordPageOptions["writer"]["history"]>>): string {
  const sections: string[] = [];
  const list = (items: string[]) => `<ul class="plain facts">${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;

  if (record.type === "decision") sections.push(advicePanel(record, index));
  if (record.links.length > 0) {
    sections.push(`<h2>Links</h2>${list(record.links.map((l) => `<span class="rel">${esc(l.rel)}</span> ${linkTo(index, l.id)}`))}`);
  }
  const backlinks = index.backlinks(record.id);
  if (backlinks.length > 0) {
    sections.push(`<h2>Backlinks</h2>${list(backlinks.map((b) => `<span class="rel">${esc(b.rel)}</span> ${linkTo(index, b.source.id)}`))}`);
  }
  if (record.type === "task") {
    const blockers = index.blockedBy(record.id);
    if (blockers.length > 0) sections.push(`<p class="chips">${blockers.map((id) => `<span class="chip block">blocked by ${esc(id)}</span>`).join("")}</p>`);
  }
  if (record.refs.length > 0) {
    sections.push(
      `<h2>Refs</h2>${list(record.refs.map((r) => `<span class="rel">${esc(r.kind)}</span> ${/^https:\/\//i.test(r.url) ? `<a href="${esc(r.url)}" rel="noreferrer noopener" target="_blank">${esc(r.url)}</a>` : `<span class="mono">${esc(r.url)}</span>`}${r.note ? ` <span class="meta">${esc(r.note)}</span>` : ""}`))}`,
    );
  }
  if (record.tags.length > 0) sections.push(`<h2>Tags</h2><p class="chips">${record.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join("")}</p>`);
  if (record.approval) sections.push(`<h2>Approval</h2><p class="mono">${esc(record.approval)}</p>`);
  sections.push(
    `<h2>History</h2>${
      history.length > 0
        ? list(history.map((h) => `<span class="mono">${esc(h.commit.slice(0, 7))}</span> ${esc(h.subject)} <span class="meta">${esc(h.author)}, ${esc(h.date.slice(0, 10))}</span>`))
        : `<p class="hint">Not committed yet.</p>`
    }`,
  );
  return sections.join("\n");
}

function detailBody(record: IndexedRecord, index: RecordIndex, history: Awaited<ReturnType<RecordPageOptions["writer"]["history"]>>, now: Date, approvals: boolean): string {
  const [singular] = TYPE_LABELS[record.type];
  const body =
    record.type === "capture"
      ? // Captures are shown as plain text, exactly as received; never as Markdown.
        `<pre class="verbatim">${esc(record.body)}</pre>`
      : record.body.trim() === ""
        ? `<p class="hint">No text yet.</p>`
        : `<div class="markdown">${renderMarkdown(record.body)}</div>`;
  const editable = record.type !== "proposal";
  return `<article class="record" id="record" data-id="${esc(record.id)}" data-blob="${esc(record.blob)}">
<div class="recordhead"><div><div class="eyebrow">${esc(singular)} · ${esc(statusLabel(record, record.status))}</div>
<h1>${esc(record.title || record.id)}</h1>
<p class="meta">${esc(record.id)} · updated ${esc(age(record.updated, now))} · <span class="mono">${esc(record.path)}</span></p></div>
<div class="recordactions">${record.type === "capture" ? `<a class="button" href="/inbox/${esc(record.id)}/triage">Triage</a>` : ""}${record.type === "idea" && record.status === "ready" ? `<a class="button" href="/ideas/${esc(record.id)}/promote">Promote…</a>` : ""}${record.type === "decision" && (record.status === "ACCEPTED" || record.status === "ADOPTED") ? `<a class="button secondary" href="/new/decision?supersedes=${esc(record.id)}">Supersede…</a>` : ""}${record.type === "project" ? `<a class="button secondary" href="/new/task?project=${esc(record.id)}">New task</a>` : ""}${statusControl(record, approvals)}${editable ? `<a class="button secondary" href="${recordUrl(record.id)}/edit">Edit</a>` : ""}</div></div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<div class="recordgrid"><div class="recordbody">${body}</div>
<aside class="recordside">${sidePanel(record, index, history)}</aside></div>
</article>`;
}

function rows<T>(items: readonly T[], render: (item: T | undefined) => string): string {
  // One empty row to add to, plus a template row the script clones.
  return `${items.map((item) => render(item)).join("")}${render(undefined)}`;
}

function editBody(record: IndexedRecord): string {
  const capture = record.type === "capture";
  const frozen = record.type === "decision" && FROZEN_DECISIONS.has(record.status);
  const relOptions = (selected?: string) => LINK_RELS.map((rel) => `<option${rel === selected ? " selected" : ""}>${rel}</option>`).join("");
  const kindOptions = (selected?: string) => REF_KINDS.map((kind) => `<option${kind === selected ? " selected" : ""}>${kind}</option>`).join("");
  const linkRow = (link?: { rel: string; id: string }) =>
    `<div class="row" data-row="link"><select name="rel" aria-label="Relationship">${relOptions(link?.rel ?? "relates_to")}</select><input type="text" name="id" aria-label="Linked record ID" placeholder="OS-I-…" value="${esc(link?.id ?? "")}" autocomplete="off"><button type="button" class="link" data-action="remove-row">Remove</button></div>`;
  const refRow = (ref?: { kind: string; url: string; note?: string }) =>
    `<div class="row" data-row="ref"><select name="kind" aria-label="Kind">${kindOptions(ref?.kind ?? "url")}</select><input type="url" name="url" aria-label="URL" placeholder="https://" value="${esc(ref?.url ?? "")}"><input type="text" name="note" aria-label="Note" placeholder="Note (optional)" value="${esc(ref?.note ?? "")}"><button type="button" class="link" data-action="remove-row">Remove</button></div>`;

  return `<div class="recordhead"><div><div class="eyebrow">Editing ${esc(record.id)}</div><h1>${esc(record.title || record.id)}</h1></div></div>
<div id="editor" data-id="${esc(record.id)}" data-blob="${esc(record.blob)}">
<div class="tabs" role="tablist"><button type="button" role="tab" class="tab" data-tab="form" aria-selected="true">Form</button><button type="button" role="tab" class="tab" data-tab="raw" aria-selected="false">Whole file</button></div>
<p id="draft-note" class="banner" hidden>Restored unsaved changes from this browser. <button type="button" class="link" data-action="discard-draft">Discard them</button></p>
<form id="edit-form" data-pane="form" autocomplete="off">
${capture ? "" : `<label for="title">Title</label><input type="text" id="title" name="title" maxlength="200" value="${esc(record.title)}" required>`}
<label for="tags">Tags <span class="hint">(separated by spaces or commas)</span></label>
<input type="text" id="tags" name="tags" value="${esc(record.tags.join(" "))}">
${
  capture
    ? `<p class="hint">A capture's text and source are kept exactly as received; only its tags can change.</p>`
    : `<fieldset><legend>Links</legend><div class="rows" data-rows="link">${rows(record.links, linkRow)}</div><button type="button" class="link" data-action="add-row" data-for="link">Add a link</button></fieldset>
<fieldset><legend>Refs</legend><div class="rows" data-rows="ref">${rows(record.refs, refRow)}</div><button type="button" class="link" data-action="add-row" data-for="ref">Add a ref</button></fieldset>
<label for="body">Text <span class="hint">(Markdown)</span></label>
<textarea id="body" name="body" class="code"${frozen ? " readonly" : ""}>${esc(record.body)}</textarea>
${frozen ? `<p class="hint">The text of a ${esc(record.status)} decision is frozen. A reversal is a new decision that supersedes it.</p>` : ""}`
}
</form>
<form id="raw-form" data-pane="raw" hidden autocomplete="off">
<label for="raw">The whole file <span class="hint">(id, type, status, created and approval cannot change)</span></label>
<textarea id="raw" name="raw" class="code tall" spellcheck="false">${esc(record.text)}</textarea>
</form>
<div class="actions"><button type="button" id="save">Save</button><a class="button secondary" href="${recordUrl(record.id)}">Cancel</a></div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<ul id="findings" class="plain"></ul>
<section id="merge" hidden>
<h2>Someone changed this record while you were editing</h2>
<p class="hint">Your changes were not saved. Compare the versions, edit the merged text, and save it on top of the current version.</p>
<div class="three-way"><div><h3>When you started</h3><pre data-pane="base"></pre></div><div><h3>Now</h3><pre data-pane="current"></pre></div><div><h3>Yours</h3><pre data-pane="mine"></pre></div></div>
<label for="merged">Merged file</label>
<textarea id="merged" class="code tall" spellcheck="false"></textarea>
<div class="actions"><button type="button" id="save-merged">Save merged</button><button type="button" class="secondary" data-action="discard-mine">Discard my changes</button></div>
</section>
</div>`;
}

export function registerRecordPages(app: FastifyInstance, options: RecordPageOptions): void {
  const { requireSession, records, writer } = options;
  const now = options.now ?? (() => new Date());

  const render = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, edit: boolean) => {
    const record = records.index.get(request.params.id);
    if (!record) return reply.code(404).type("text/html; charset=utf-8").send(page({ title: "Not found", page: "not-found", nav: "record", body: `<h1>Not found</h1><p class="hint">There is no record ${esc(request.params.id)}.</p>` }));
    if (edit && record.type === "proposal") return reply.redirect(recordUrl(record.id));
    const [, plural] = TYPE_LABELS[record.type];
    const body = edit ? editBody(record) : detailBody(record, records.index, await writer.history(record.path), now(), options.approvals?.() ?? false);
    return reply.type("text/html; charset=utf-8").send(
      page({
        title: edit ? `Edit ${record.id}` : record.title || record.id,
        page: edit ? "record-edit" : "record",
        nav: NAV_BY_TYPE[record.type] ?? "record",
        crumbs: [plural, record.id],
        sync: await options.status(),
        scripts: ["app.js", "approve.js", "record.js"],
        wide: true,
        body,
      }),
    );
  };

  app.get<{ Params: { id: string } }>("/records/:id", { preHandler: requireSession }, (request, reply) => render(request, reply, false));
  app.get<{ Params: { id: string } }>("/records/:id/edit", { preHandler: requireSession }, (request, reply) => render(request, reply, true));
}
