/**
 * The Proposals view (spec §9, §12.2): the pending queue with each
 * proposal's rationale, why it is consequential and the diff it would make,
 * approve and reject, bulk approval of routine proposals, and the history.
 * Also the approval key section of Settings. /static/proposals.js acts.
 */
import { readOperations, type IndexedRecord } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import type { ProposalService } from "../records/proposals.js";
import type { WorkspaceRecords } from "../records/workspace.js";
import { age } from "./boards.js";
import { esc, page } from "./html.js";
import { renderMarkdown } from "./markdown.js";

export interface ProposalPageOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  records: WorkspaceRecords;
  proposals: ProposalService;
  status: () => Promise<WriteStatus>;
  now?: () => Date;
}

const HISTORY_LIMIT = 50;

/** Removed and added lines of one file, as approve.js shows them. */
export function diffHtml(before: string | null, after: string | null): string {
  const old = (before ?? "").split("\n");
  const next = (after ?? "").split("\n");
  const kept = new Set(next);
  const had = new Set(old);
  const lines = [...old.filter((l) => !kept.has(l)).map((l) => `<span class="del">- ${esc(l)}\n</span>`), ...next.filter((l) => !had.has(l)).map((l) => `<span class="add">+ ${esc(l)}\n</span>`)];
  return `<pre class="diff">${lines.join("")}</pre>`;
}

function pendingCard(proposal: IndexedRecord, service: ProposalService, now: Date, approvals: boolean): string {
  const operations = readOperations(proposal.frontmatter) ?? [];
  const preview = service.preview(operations);
  const consequential = preview.classification?.consequential ?? proposal.frontmatter.consequential === true;
  const actor = (proposal.frontmatter.origin as { actor?: unknown } | undefined)?.actor;
  const rationale = proposal.body.replace(/^## Rationale\s*\n/, "");
  const reasons = preview.classification?.reasons ?? [];
  const files = (preview.diff ?? [])
    .map((file) => `<p class="mono hint">${esc(file.path)}${file.after === null ? " (deleted)" : file.before === null ? " (new)" : ""}</p>${diffHtml(file.before, file.after)}`)
    .join("");
  const stale = proposal.status === "stale" || !preview.ok;
  return `<article class="card proposal" id="${esc(proposal.id)}" data-id="${esc(proposal.id)}" data-consequential="${consequential}">
<h2>${!stale && !consequential ? `<input type="checkbox" class="bulk-pick" aria-label="Select ${esc(proposal.id)} for bulk approval">` : ""}<a href="/records/${esc(proposal.id)}">${esc(proposal.title)}</a>
<span class="badge${consequential ? " gated" : ""}">${consequential ? "consequential" : "routine"}</span>${stale ? `<span class="badge stale">stale</span>` : ""}</h2>
<p class="meta">${esc(proposal.id)} · ${esc(typeof actor === "string" ? actor : "unknown")} · ${esc(age(proposal.created, now))} · ${operations.length} operation${operations.length === 1 ? "" : "s"}</p>
${rationale.trim() ? `<div class="markdown">${renderMarkdown(rationale)}</div>` : ""}
${reasons.length ? `<ul class="hint">${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
${stale ? `<p class="status error">${esc(preview.message ?? "The workspace changed since this was proposed.")} It can only be rejected; ask for a new proposal.</p>` : `<details${operations.length <= 3 ? " open" : ""}><summary>Changes</summary>${files}</details>`}
<div class="actions">${stale ? "" : `<button type="button" data-action="approve"${approvals ? "" : " disabled"}>${consequential ? "Approve with passkey" : "Approve"}</button>`}<button type="button" class="secondary" data-action="reject"${approvals || service.hasKey ? "" : " disabled"}>Reject</button></div>
<p class="status" role="status" aria-live="polite"></p>
</article>`;
}

function historyRow(proposal: IndexedRecord, now: Date): string {
  return `<li><a href="/records/${esc(proposal.id)}">${esc(proposal.title)}</a> <span class="badge ${esc(proposal.status)}">${esc(proposal.status)}</span> <span class="meta">${esc(proposal.id)} · ${esc(age(proposal.updated, now))}</span></li>`;
}

/** The approval key section of Settings. */
export function approvalKeySection(service: ProposalService, records: WorkspaceRecords): string {
  const key = service.signingKey;
  const trusted = records.config().approvalKeys;
  let body: string;
  if (!key) {
    body = `<p class="hint">The server has no approval signing key, so nothing consequential can be approved. Generate one with <code>octosprout-server approval-key generate</code> and mount it as the <code>approval_signing_key</code> secret (see the deploy runbook).</p>`;
  } else if (service.approvalsReady()) {
    body = `<p>Approvals are signed with <span class="mono">${esc(key.id)}</span>, which the workspace trusts.</p>`;
  } else if (!trusted.some((k) => k.status === "active")) {
    body = `<p class="hint">The server's key <span class="mono">${esc(key.id)}</span> is not trusted yet, so nothing consequential can be approved.${trusted.length > 0 ? ` Every listed key is retired (${trusted.map((k) => esc(k.id)).join(", ")}).` : ""} Trusting it adds it to <code>approval_public_keys</code> in <code>octosprout.yaml</code>, with a proposal the server signs itself.</p>
<div class="actions"><button type="button" data-action="trust-key">Trust this server's approval key</button></div>`;
  } else {
    body = `<p class="hint">The server's key <span class="mono">${esc(key.id)}</span> is not among the trusted keys (${trusted.map((k) => esc(k.id)).join(", ")}). Adding it is a consequential change to <code>octosprout.yaml</code>, approved with a key the workspace already trusts.</p>`;
  }
  return `<h2>Approval key</h2>
<section id="approval-key">${body}<p class="status" role="status" aria-live="polite"></p></section>`;
}

export function registerProposalPages(app: FastifyInstance, options: ProposalPageOptions): void {
  const { requireSession, records, proposals } = options;
  const now = options.now ?? (() => new Date());

  app.get("/proposals", { preHandler: requireSession }, async (_request, reply) => {
    const all = records.index.list("proposal").sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
    const open = all.filter((p) => p.status === "pending" || p.status === "stale");
    const done = all.filter((p) => p.status === "applied" || p.status === "rejected").sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, HISTORY_LIMIT);
    const approvals = proposals.approvalsReady();
    const at = now();
    const cards = open.map((p) => pendingCard(p, proposals, at, approvals));
    return reply.type("text/html; charset=utf-8").send(
      page({
        title: "Proposals",
        page: "proposals",
        nav: "proposals",
        crumbs: ["Workspace", "Proposals"],
        sync: await options.status(),
        scripts: ["app.js", "approve.js", "proposals.js"],
        body: `<h1>Proposals <span class="meta">${open.length} open</span></h1>
${approvals ? "" : `<p class="banner">Nothing can be approved until the server's approval key is set up and trusted. See <a href="/settings">Settings</a>.</p>`}
${cards.some((c) => c.includes("bulk-pick")) ? `<div class="bulk"><button type="button" class="secondary" data-action="approve-bulk" disabled>Approve selected</button><span class="hint">Only routine proposals can be approved together.</span></div>` : ""}
${cards.length ? cards.join("\n") : `<p class="hint">Nothing waiting. Agents propose changes here; you approve them.</p>`}
<h2>History</h2>
${done.length ? `<ul class="plain facts">${done.map((p) => historyRow(p, at)).join("")}</ul>` : `<p class="hint">No decisions yet.</p>`}`,
      }),
    );
  });
}

export const PROPOSALS_JS = String.raw`
(() => {
  async function post(url, body) {
    const session = await fetch("/api/v1/session", { credentials: "same-origin" });
    if (!session.ok) throw new Error("Your session has ended. Sign in again.");
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": (await session.json()).csrf },
      body: JSON.stringify(body || {}),
    });
    return { response: response, data: await response.json().catch(() => ({})) };
  }
  const explain = (data) =>
    data.error === "stale" ? "The workspace changed since this was proposed; it is now stale."
    : data.error === "reverify_required" ? "The passkey check expired. Try again."
    : data.findings && data.findings[0] ? data.findings[0].code + ": " + data.findings[0].message
    : data.message || data.error || "Something went wrong.";

  // Approving a consequential proposal asks for the passkey first (§9.3).
  async function approve(card) {
    const status = card.querySelector(".status");
    status.textContent = "Saving…";
    status.className = "status";
    try {
      if (card.dataset.consequential === "true") await window.octosproutReverify();
      const { response, data } = await post("/api/v1/proposals/" + encodeURIComponent(card.dataset.id) + "/approve");
      if (response.ok) return location.reload();
      status.textContent = explain(data);
      status.className = "status error";
      if (data.error === "stale") setTimeout(() => location.reload(), 1500);
    } catch (error) {
      status.textContent = error && error.name === "NotAllowedError" ? "The passkey check was cancelled." : error.message;
      status.className = "status error";
    }
  }

  for (const card of document.querySelectorAll(".proposal")) {
    const approveButton = card.querySelector('[data-action="approve"]');
    if (approveButton) approveButton.addEventListener("click", () => approve(card));
    card.querySelector('[data-action="reject"]').addEventListener("click", async () => {
      if (!window.confirm("Reject " + card.dataset.id + "? It stays in the history.")) return;
      const { response, data } = await post("/api/v1/proposals/" + encodeURIComponent(card.dataset.id) + "/reject");
      if (response.ok) return location.reload();
      const status = card.querySelector(".status");
      status.textContent = explain(data);
      status.className = "status error";
    });
  }

  const bulk = document.querySelector('[data-action="approve-bulk"]');
  if (bulk) {
    const picked = () => [...document.querySelectorAll(".bulk-pick:checked")].map((box) => box.closest(".proposal").dataset.id);
    document.addEventListener("change", () => (bulk.disabled = picked().length === 0));
    bulk.addEventListener("click", async () => {
      bulk.disabled = true;
      const { data } = await post("/api/v1/proposals/approve-bulk", { ids: picked() });
      const failed = (data.results || []).filter((r) => r.result !== "committed" && r.result !== "pending");
      if (failed.length) window.alert(failed.map((r) => r.id + ": " + (r.message || r.result)).join("\n"));
      location.reload();
    });
  }

  // Settings: trust the server's own key (the first one only).
  const trust = document.querySelector('[data-action="trust-key"]');
  if (trust) {
    trust.addEventListener("click", async () => {
      const status = document.querySelector("#approval-key .status");
      trust.disabled = true;
      status.textContent = "Waiting for your passkey…";
      status.className = "status";
      try {
        await window.octosproutReverify();
        const { response, data } = await post("/api/v1/approval-key/trust");
        if (response.ok) return location.reload();
        status.textContent = explain(data);
        status.className = "status error";
      } catch (error) {
        status.textContent = error && error.name === "NotAllowedError" ? "The passkey check was cancelled." : error.message;
        status.className = "status error";
      }
      trust.disabled = false;
    });
  }
})();
`;
