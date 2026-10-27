/**
 * The triage page for one capture (spec §12.2 Inbox): make it an Idea, Task
 * or Research record (prefilled from the template with the capture quoted),
 * attach it to an existing one, or compost it. /static/triage.js posts the
 * action to `POST /api/v1/captures/:id/triage`.
 */
import { prefillFromCapture, TRIAGE_TYPES, type IndexedRecord } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import type { WorkspaceRecords } from "../records/workspace.js";
import { age } from "./boards.js";
import { esc, page } from "./html.js";
import { formatTime } from "./routes.js";

export interface TriagePageOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  records: WorkspaceRecords;
  status: () => Promise<WriteStatus>;
  now?: () => Date;
}

const LABELS = { idea: "Idea", task: "Task", research: "Research" } as const;

function createPane(type: "idea" | "task" | "research", capture: IndexedRecord): string {
  const { title, body } = prefillFromCapture(type, capture.body);
  return `<form class="pane" data-pane="${type}" data-action="create" data-type="${type}"${type === "idea" ? "" : " hidden"} autocomplete="off">
<label for="title-${type}">Title</label>
<input type="text" id="title-${type}" name="title" maxlength="200" required value="${esc(title)}">
<label for="body-${type}">Text <span class="hint">(Markdown; the capture is quoted at the top)</span></label>
<textarea id="body-${type}" name="body" class="code">${esc(body)}</textarea>
<div class="actions"><button type="submit">Create ${LABELS[type].toLowerCase()}</button></div>
</form>`;
}

function attachPane(capture: IndexedRecord, records: WorkspaceRecords, now: Date): string {
  const candidates = records.index
    .list()
    .filter((r) => (TRIAGE_TYPES as readonly string[]).includes(r.type) && !r.links.some((l) => l.rel === "derived_from" && l.id === capture.id))
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
  const options = candidates
    .map(
      (r) =>
        `<label class="pick" data-search="${esc(`${r.id} ${r.title} ${r.type} ${r.status}`.toLowerCase())}"><input type="radio" name="target" value="${esc(r.id)}"><span><strong>${esc(r.title || r.id)}</strong> <span class="meta">${esc(r.id)} · ${esc(LABELS[r.type as keyof typeof LABELS])} · ${esc(r.status)} · ${esc(age(r.updated, now))}</span></span></label>`,
    )
    .join("");
  return `<form class="pane" data-pane="attach" data-action="attach" hidden autocomplete="off">
<p class="hint">The chosen record gets a <code>derived_from</code> link to this capture.</p>
<label for="filter">Find a record</label>
<input type="text" id="filter" placeholder="Title or ID" data-filter>
<div class="picks">${options || `<p class="hint">There are no ideas, tasks or research records yet.</p>`}</div>
<div class="actions"><button type="submit"${candidates.length ? "" : " disabled"}>Attach</button></div>
</form>`;
}

export function registerTriagePage(app: FastifyInstance, options: TriagePageOptions): void {
  const { requireSession, records } = options;
  const now = options.now ?? (() => new Date());

  app.get<{ Params: { id: string } }>("/inbox/:id/triage", { preHandler: requireSession }, async (request, reply) => {
    const capture = records.index.get(request.params.id);
    if (capture?.type !== "capture") {
      return reply.code(404).type("text/html; charset=utf-8").send(page({ title: "Not found", page: "not-found", nav: "inbox", body: `<h1>Not found</h1><p class="hint">There is no capture ${esc(request.params.id)}.</p>` }));
    }
    const fm = capture.frontmatter;
    const source = typeof fm.source === "string" ? fm.source : "other";
    const sourceUrl = typeof fm.source_url === "string" ? fm.source_url : undefined;
    const derived = records.index.backlinks(capture.id).filter((b) => b.rel === "derived_from");
    const composted = capture.status === "composted";

    const tabs = composted
      ? `<button type="button" role="tab" class="tab" data-tab="restore" aria-selected="true">Restore</button>`
      : [...TRIAGE_TYPES.map((t) => [t, LABELS[t]] as const), ["attach", "Attach"] as const, ...(capture.status === "new" ? [["compost", "Compost"] as const] : [])]
          .map(([key, label], i) => `<button type="button" role="tab" class="tab" data-tab="${key}" aria-selected="${i === 0}">${label}</button>`)
          .join("");
    const panes = composted
      ? `<form class="pane" data-pane="restore" data-action="restore"><p class="hint">This capture was composted. Restoring it puts it back in the Inbox.</p><div class="actions"><button type="submit">Restore to the Inbox</button></div></form>`
      : `${TRIAGE_TYPES.map((t) => createPane(t, capture)).join("\n")}
${attachPane(capture, records, now())}
${capture.status === "new" ? `<form class="pane" data-pane="compost" data-action="compost" hidden><p class="hint">Composted captures leave the Inbox but stay in Git, and can be restored.</p><div class="actions"><button type="submit" class="secondary">Compost</button></div></form>` : ""}`;

    return reply.type("text/html; charset=utf-8").send(
      page({
        title: `Triage ${capture.id}`,
        page: "triage",
        nav: "inbox",
        crumbs: ["Inbox", capture.id],
        sync: await options.status(),
        scripts: ["app.js", "triage.js"],
        wide: true,
        body: `<div class="recordhead"><div><div class="eyebrow">Triage · ${esc(capture.status)}</div>
<h1>${esc(capture.id)}</h1>
<p class="meta">${esc(formatTime(capture.created))} · ${esc(source)}${sourceUrl ? ` · <a href="${esc(sourceUrl)}" rel="noreferrer noopener" target="_blank">source</a>` : ""} · <a href="/records/${esc(capture.id)}">details</a></p></div></div>
${derived.length > 0 ? `<p class="banner info">Already planted in ${derived.map((d) => `<a href="/records/${esc(d.source.id)}">${esc(d.source.title || d.source.id)}</a>`).join(", ")}. You can make more records from it.</p>` : ""}
<div class="triage" id="triage" data-id="${esc(capture.id)}" data-blob="${esc(capture.blob)}">
<div class="card capture-text"><pre class="verbatim">${esc(capture.body)}</pre></div>
<div><div class="tabs" role="tablist">${tabs}</div>
${panes}
<p id="status" class="status" role="status" aria-live="polite"></p>
<ul id="findings" class="plain"></ul></div>
</div>`,
      }),
    );
  });
}

export const TRIAGE_JS = String.raw`
(() => {
  const root = document.getElementById("triage");
  if (!root) return;
  const status = document.getElementById("status");
  const findings = document.getElementById("findings");
  const show = (text, kind) => {
    status.textContent = text;
    status.className = "status " + (kind || "");
  };

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      for (const other of document.querySelectorAll(".tab")) other.setAttribute("aria-selected", String(other === tab));
      for (const pane of document.querySelectorAll(".pane")) pane.hidden = pane.dataset.pane !== tab.dataset.tab;
      show("");
    });
  }

  const filter = document.querySelector("[data-filter]");
  if (filter) {
    filter.addEventListener("input", () => {
      const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
      for (const pick of document.querySelectorAll(".pick")) {
        pick.hidden = !words.every((word) => pick.dataset.search.includes(word));
      }
    });
  }

  for (const form of document.querySelectorAll(".pane")) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = { base_blob: root.dataset.blob, action: form.dataset.action };
      if (payload.action === "create") {
        payload.type = form.dataset.type;
        payload.title = form.elements.title.value;
        payload.body = form.elements.body.value;
      } else if (payload.action === "attach") {
        const chosen = form.querySelector("input[name=target]:checked");
        if (!chosen) return show("Choose a record to attach the capture to.", "error");
        payload.target = chosen.value;
      }
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      findings.textContent = "";
      show("Saving…");
      try {
        const session = await fetch("/api/v1/session", { credentials: "same-origin" });
        if (!session.ok) throw new Error("Your session has ended. Sign in again.");
        const response = await fetch("/api/v1/captures/" + encodeURIComponent(root.dataset.id) + "/triage", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": (await session.json()).csrf },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          if (payload.action === "create" || payload.action === "attach") location.assign("/records/" + encodeURIComponent(data.id));
          else location.assign("/");
          return;
        }
        if (response.status === 409) show("This capture changed since the page loaded. Reload and try again.", "error");
        else show(data.message || (data.error === "validation" ? "The result would be invalid:" : data.error) || "Triage failed. Nothing was saved.", "error");
        for (const finding of data.findings || []) {
          const li = document.createElement("li");
          li.className = "card";
          li.textContent = finding.code + ": " + finding.message;
          findings.appendChild(li);
        }
      } catch (error) {
        show(error.message, "error");
      }
      button.disabled = false;
    });
  }
})();
`;
