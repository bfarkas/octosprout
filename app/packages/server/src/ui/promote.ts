/**
 * The promotion wizard (spec §10) at /ideas/<ID>/promote: review the idea,
 * its captures and research, draft the project brief, pick initial tasks,
 * and approve it all as one consequential proposal with the passkey.
 * `POST /api/v1/ideas/:id/promote` answers 403 with the preview, and with
 * `approve: true` commits the proposal and its changes in one commit.
 */
import { generateId, planPromotion, promotionBrief, type IndexedRecord } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import { formatTimestamp } from "../inbox/capture.js";
import type { ProposalService } from "../records/proposals.js";
import type { WorkspaceRecords } from "../records/workspace.js";
import { esc, page } from "./html.js";
import { renderMarkdown } from "./markdown.js";

export interface PromoteOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  recentlyVerified: (request: FastifyRequest) => boolean;
  records: WorkspaceRecords;
  proposals: ProposalService;
  status: () => Promise<WriteStatus>;
  now?: () => Date;
}

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const MAX_TASKS = 20;

function related(idea: IndexedRecord, records: WorkspaceRecords): { captures: IndexedRecord[]; research: IndexedRecord[]; others: IndexedRecord[] } {
  const index = records.index;
  const linked = (rel: string) => idea.links.filter((l) => l.rel === rel).map((l) => index.get(l.id)).filter((r): r is IndexedRecord => r !== undefined);
  const back = index.backlinks(idea.id);
  return {
    captures: linked("derived_from"),
    research: back.filter((b) => b.rel === "supports" && b.source.type === "research").map((b) => b.source),
    others: [...linked("relates_to"), ...back.filter((b) => b.rel === "relates_to").map((b) => b.source)],
  };
}

export function registerPromotion(app: FastifyInstance, options: PromoteOptions): void {
  const { requireSession, records, proposals } = options;
  const now = () => (options.now ?? (() => new Date()))();

  app.get<{ Params: { id: string } }>("/ideas/:id/promote", { preHandler: requireSession }, async (request, reply) => {
    const idea = records.index.get(request.params.id);
    if (idea?.type !== "idea") {
      return reply.code(404).type("text/html; charset=utf-8").send(page({ title: "Not found", page: "not-found", nav: "ideas", body: `<h1>Not found</h1><p class="hint">There is no idea ${esc(request.params.id)}.</p>` }));
    }
    const { captures, research, others } = related(idea, records);
    const list = (items: IndexedRecord[], empty: string) =>
      items.length ? `<ul class="plain facts">${items.map((r) => `<li><a href="/records/${esc(r.id)}">${esc(r.title || r.id)}</a> <span class="meta">${esc(r.id)} · ${esc(r.status)}</span></li>`).join("")}</ul>` : `<p class="hint">${empty}</p>`;
    const notReady =
      idea.status === "ready"
        ? ""
        : `<p class="banner">Only a <strong>ready</strong> idea can be promoted; this one is ${esc(idea.status)}. Move it to Ready on the Ideas board first.</p>`;
    const ready = proposals.approvalsReady();

    return reply.type("text/html; charset=utf-8").send(
      page({
        title: `Promote ${idea.id}`,
        page: "promote",
        nav: "ideas",
        crumbs: ["Ideas", `Promote ${idea.id}`],
        sync: await options.status(),
        scripts: ["app.js", "approve.js", "promote.js"],
        wide: true,
        body: `<div class="recordhead"><div><div class="eyebrow">Promote to a project</div><h1>${esc(idea.title)}</h1>
<p class="meta">${esc(idea.id)} · ${esc(idea.status)} · <a href="/records/${esc(idea.id)}">the idea</a></p></div></div>
${notReady}${ready ? "" : `<p class="banner">Promotion needs an approval key the workspace trusts. See <a href="/settings">Settings</a>.</p>`}
<form id="promote" class="wizard" data-id="${esc(idea.id)}" data-blob="${esc(idea.blob)}" autocomplete="off">
<section><h2>1. Review</h2>
<details class="card"><summary>The idea</summary><div class="markdown">${idea.body.trim() ? renderMarkdown(idea.body) : `<p class="hint">No text.</p>`}</div></details>
<div class="review"><div><h3>Captures</h3>${list(captures, "None.")}</div><div><h3>Research</h3>${list(research, "None.")}</div><div><h3>Related</h3>${list(others, "None.")}</div></div></section>
<section><h2>2. The project</h2>
<label for="title">Project title</label>
<input type="text" id="title" name="title" maxlength="200" required value="${esc(idea.title)}">
<fieldset class="choices"><legend>Start as</legend>
<label><input type="radio" name="status" value="proposed" checked> Proposed</label>
<label><input type="radio" name="status" value="active"> Active <span class="hint">(needs Goals, Non-goals, Scope and Success criteria)</span></label></fieldset>
<label for="body">Project brief <span class="hint">(goals, non-goals, scope, constraints, risks and success criteria; reference the idea rather than copying it)</span></label>
<textarea id="body" name="body" class="code tall">${esc(promotionBrief(idea.id, research))}</textarea></section>
<section><h2>3. Initial tasks <span class="hint">(optional)</span></h2>
<div class="rows" data-rows="task"><div class="row" data-row="task"><input type="text" name="task" aria-label="Task title" placeholder="A first task" maxlength="200"><button type="button" class="link" data-action="remove-row">Remove</button></div></div>
<button type="button" class="link" data-action="add-task">Add a task</button></section>
<section><h2>4. Why now <span class="hint">(the proposal's rationale)</span></h2>
<textarea id="rationale" name="rationale" placeholder="Readiness, open questions, what decided it"></textarea></section>
<div class="actions"><button type="submit"${idea.status === "ready" && ready ? "" : " disabled"}>Review and approve…</button><a class="button secondary" href="/records/${esc(idea.id)}">Cancel</a></div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<ul id="findings" class="plain"></ul>
</form>`,
      }),
    );
  });

  app.post<{ Params: { id: string } }>("/api/v1/ideas/:id/promote", { preHandler: requireSession }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const idea = records.index.get(request.params.id);
    if (idea?.type !== "idea") return reply.code(404).send({ error: "not_found" });
    if (typeof body.base_blob !== "string" || !SHA.test(body.base_blob)) return reply.code(400).send({ error: "invalid_request", field: "base_blob", message: "'base_blob' is required." });
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 200) return reply.code(400).send({ error: "invalid_request", field: "title", message: "The project needs a title of at most 200 characters." });
    if (body.status !== "proposed" && body.status !== "active") return reply.code(400).send({ error: "invalid_request", field: "status", message: "'status' is proposed or active." });
    if (typeof body.body !== "string") return reply.code(400).send({ error: "invalid_request", field: "body", message: "'body' is the project brief." });
    const taskTitles = Array.isArray(body.tasks) ? body.tasks.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [];
    if (taskTitles.length > MAX_TASKS || taskTitles.some((t) => t.length > 200)) return reply.code(400).send({ error: "invalid_request", field: "tasks", message: `At most ${MAX_TASKS} tasks, each title at most 200 characters.` });
    if (idea.status !== "ready") return reply.code(422).send({ error: "transition", from: idea.status, to: "transplanted", message: "Only a ready idea can be promoted." });
    if (idea.blob !== body.base_blob) return reply.code(409).send({ error: "conflict", path: idea.path, message: "The idea changed since the page loaded. Reload and try again." });

    const taken = new Set<string>();
    const fresh = (type: "project" | "task") => {
      const id = generateId(type, { exists: (candidate) => records.index.has(candidate) || taken.has(candidate) });
      taken.add(id);
      return id;
    };
    const projectId = fresh("project");
    const operations = planPromotion({
      idea,
      project: { id: projectId, title, status: body.status, body: body.body },
      tasks: taskTitles.map((taskTitle) => ({ id: fresh("task"), title: taskTitle })),
      now: formatTimestamp(now()),
    });

    if (body.approve !== true) {
      return reply.code(403).send({ error: "approval_required", move: "promotion-wizard", from: "ready", to: "transplanted", ...(proposals.hasKey ? proposals.preview(operations) : {}) });
    }
    const rationale = typeof body.rationale === "string" && body.rationale.trim() ? body.rationale : `Promotion of ${idea.id} to a project.`;
    const decision = await proposals.proposeAndApply({ title: `Promote ${idea.id} to ${title}`, rationale, operations, actor: "user:web", verified: options.recentlyVerified(request) });
    switch (decision.kind) {
      case "done":
        request.log.info({ idea: idea.id, project: projectId, tasks: taskTitles.length, proposal: decision.proposal }, "idea promoted");
        return { status: decision.status, commit: decision.commit, proposal: decision.proposal, project: projectId };
      case "reverify_required":
        return reply.code(428).send({ error: "reverify_required", message: "Confirm with your passkey first." });
      case "no_key":
        return reply.code(503).send({ error: "no_signing_key", message: "The server has no approval signing key." });
      case "stale":
      case "conflict":
        return reply.code(409).send({ error: "conflict", message: "The idea changed. Reload and try again." });
      case "invalid":
        return reply.code(422).send({
          error: decision.findings ? "validation" : "invalid",
          message: decision.message,
          ...(decision.findings ? { findings: decision.findings.map(({ code, path, message, hint }) => ({ code, path, message, hint })) } : {}),
        });
      default:
        return reply.code(422).send({ error: decision.kind });
    }
  });
}

export const PROMOTE_JS = String.raw`
(() => {
  const form = document.getElementById("promote");
  if (!form) return;
  const status = document.getElementById("status");
  const findings = document.getElementById("findings");
  const show = (text, kind) => {
    status.textContent = text;
    status.className = "status " + (kind || "");
  };
  const rows = form.querySelector('[data-rows="task"]');
  const wire = (row) => row.querySelector('[data-action="remove-row"]').addEventListener("click", () => (rows.children.length > 1 ? row.remove() : (row.querySelector("input").value = "")));
  wire(rows.firstElementChild);
  form.querySelector('[data-action="add-task"]').addEventListener("click", () => {
    const row = rows.lastElementChild.cloneNode(true);
    row.querySelector("input").value = "";
    rows.appendChild(row);
    wire(row);
    row.querySelector("input").focus();
  });

  async function send(approve) {
    const session = await fetch("/api/v1/session", { credentials: "same-origin" });
    if (!session.ok) throw new Error("Your session has ended. Sign in again.");
    const payload = {
      base_blob: form.dataset.blob,
      title: form.elements.title.value,
      status: form.querySelector("input[name=status]:checked").value,
      body: form.elements.body.value,
      tasks: [...form.querySelectorAll("input[name=task]")].map((input) => input.value).filter((v) => v.trim()),
      rationale: form.elements.rationale.value,
    };
    if (approve) payload.approve = true;
    return fetch("/api/v1/ideas/" + encodeURIComponent(form.dataset.id) + "/promote", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": (await session.json()).csrf },
      body: JSON.stringify(payload),
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    findings.textContent = "";
    show("Preparing…");
    try {
      let response = await send(false);
      let data = await response.json().catch(() => ({}));
      if (response.status === 403 && data.error === "approval_required") {
        const approved = await window.octosproutApprove(data, "Promote to " + form.elements.title.value + "?", () => send(true));
        if (approved === null) return show("");
        response = approved.response;
        data = approved.data;
      }
      if (response.ok) return location.assign("/records/" + encodeURIComponent(data.project));
      show(data.message || data.error || "The promotion failed. Nothing was saved.", "error");
      for (const finding of data.findings || []) {
        const li = document.createElement("li");
        li.className = "card";
        li.textContent = finding.code + ": " + finding.message + " " + finding.hint;
        findings.appendChild(li);
      }
    } catch (error) {
      show(error.message, "error");
    }
  });
})();
`;
