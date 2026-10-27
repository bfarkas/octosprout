/**
 * Creating a record: /new/<type> with the title, the template's text, and
 * for tasks, decisions and research an optional project. A decision starts
 * from the ADR template (written afterwards in the editor) and can supersede
 * another. /static/new.js posts to `POST /api/v1/records`.
 */
import { templateBody, type IndexedRecord, type TemplatedType } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import { CREATABLE, PROJECT_MEMBERS, type CreatableType } from "../records/create.js";
import type { WorkspaceRecords } from "../records/workspace.js";
import { esc, page, type NavKey } from "./html.js";

export interface NewRecordOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  records: WorkspaceRecords;
  status: () => Promise<WriteStatus>;
}

const LABELS: Record<CreatableType, string> = { idea: "idea", task: "task", project: "project", decision: "decision", research: "research record", expert: "expert profile" };
const NAV: Partial<Record<CreatableType, NavKey>> = { idea: "ideas", task: "tasks", project: "projects", decision: "decisions", research: "research", expert: "experts" };

export function registerNewRecord(app: FastifyInstance, options: NewRecordOptions): void {
  const { requireSession, records } = options;

  app.get<{ Params: { type: string }; Querystring: { project?: string; supersedes?: string } }>("/new/:type", { preHandler: requireSession }, async (request, reply) => {
    const type = request.params.type as CreatableType;
    if (!(CREATABLE as readonly string[]).includes(type)) {
      return reply.code(404).type("text/html; charset=utf-8").send(page({ title: "Not found", page: "not-found", nav: "record", body: `<h1>Not found</h1><p class="hint">Records of type ${esc(type)} are not created here.</p>` }));
    }
    const index = records.index;
    const superseded: IndexedRecord | undefined = type === "decision" && request.query.supersedes ? index.get(request.query.supersedes) : undefined;
    const projectId = request.query.project ?? superseded?.links.find((l) => l.rel === "belongs_to")?.id;
    const projects = index.list("project").sort((a, b) => a.title.localeCompare(b.title));
    const projectField = PROJECT_MEMBERS.includes(type)
      ? `<label for="project">Project <span class="hint">(optional)</span></label>
<select id="project" name="project"><option value="">None</option>${projects.map((p) => `<option value="${esc(p.id)}"${p.id === projectId ? " selected" : ""}>${esc(p.title)} (${esc(p.status)})</option>`).join("")}</select>`
      : "";
    const decisionFields =
      type === "decision"
        ? `<label for="author">Author</label>
<input type="text" id="author" name="author" maxlength="200" value="${esc(records.config().author ?? "")}" placeholder="Your name">
${superseded?.type === "decision" ? `<input type="hidden" name="supersedes" value="${esc(superseded.id)}"><p class="banner info">This decision supersedes <a href="/records/${esc(superseded.id)}">${esc(superseded.title)}</a> (${esc(superseded.id)}). Accepting it later lets you move that one to SUPERSEDED.</p>` : ""}
<p class="hint">It starts as a DRAFT from the ADR template; write it in the editor next.</p>`
        : `<label for="body">Text <span class="hint">(Markdown, from the template)</span></label>
<textarea id="body" name="body" class="code tall">${esc(templateBody(type as TemplatedType))}</textarea>`;

    return reply.type("text/html; charset=utf-8").send(
      page({
        title: `New ${LABELS[type]}`,
        page: "new-record",
        nav: NAV[type] ?? "record",
        crumbs: ["New", LABELS[type]],
        sync: await options.status(),
        scripts: ["app.js", "new.js"],
        body: `<h1>New ${esc(LABELS[type])}</h1>
<form id="new-record" data-type="${esc(type)}" autocomplete="off">
<label for="title">Title</label>
<input type="text" id="title" name="title" maxlength="200" required autofocus value="${superseded ? esc(`Replace: ${superseded.title}`) : ""}">
${projectField}
${decisionFields}
<div class="actions"><button type="submit">Create</button></div>
<p id="status" class="status" role="status" aria-live="polite"></p>
<ul id="findings" class="plain"></ul>
</form>`,
      }),
    );
  });
}

export const NEW_JS = String.raw`
(() => {
  const form = document.getElementById("new-record");
  if (!form) return;
  const status = document.getElementById("status");
  const findings = document.getElementById("findings");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    findings.textContent = "";
    status.textContent = "Saving…";
    status.className = "status";
    const payload = { type: form.dataset.type };
    for (const name of ["title", "body", "project", "author", "supersedes"]) {
      if (form.elements[name]) payload[name] = form.elements[name].value;
    }
    try {
      const session = await fetch("/api/v1/session", { credentials: "same-origin" });
      if (!session.ok) throw new Error("Your session has ended. Sign in again.");
      const response = await fetch("/api/v1/records", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": (await session.json()).csrf },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        // A decision is written in the editor; anything else opens its page.
        location.assign("/records/" + encodeURIComponent(data.id) + (payload.type === "decision" ? "/edit" : ""));
        return;
      }
      status.textContent = data.message || data.error || "Nothing was created.";
      status.className = "status error";
      for (const finding of data.findings || []) {
        const li = document.createElement("li");
        li.className = "card";
        li.textContent = finding.code + ": " + finding.message;
        findings.appendChild(li);
      }
    } catch (error) {
      status.textContent = error.message;
      status.className = "status error";
    }
    button.disabled = false;
  });
})();
`;
