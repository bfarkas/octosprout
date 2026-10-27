/**
 * The health panel (spec §12.2): validation results for the server's clone,
 * pending pushes, the last fetch and push, pending branches and the last CI
 * run on the private repository.
 */
import type { Finding } from "@octosprout/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { HealthService } from "../health/health.js";
import { esc, page } from "./html.js";
import { formatTime } from "./routes.js";

export interface HealthPageOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  health: HealthService;
}

const FINDINGS_LIMIT = 200;

function findingRow(f: Finding): string {
  const where = f.id ? `<a href="/records/${esc(f.id)}">${esc(f.id)}</a>` : `<span class="mono">${esc(f.path)}</span>`;
  return `<li class="card listrow"><span><span class="badge ${f.severity === "error" ? "rejected" : ""}">${esc(f.code)} ${esc(f.severity)}</span> ${where}${f.line ? ` <span class="meta">line ${f.line}</span>` : ""}</span>
<span>${esc(f.message)}</span><span class="hint">${esc(f.hint)}</span></li>`;
}

export function registerHealthPage(app: FastifyInstance, options: HealthPageOptions): void {
  app.get("/health", { preHandler: options.requireSession }, async (_request, reply) => {
    const h = await options.health.health();
    const w = h.write;
    const fact = (label: string, value: string, kind = "") => `<div class="fact${kind ? ` ${kind}` : ""}"><span class="hint">${label}</span><strong>${value}</strong></div>`;
    const ci =
      h.ci.kind === "ok"
        ? h.ci.run
          ? `<a href="${esc(h.ci.run.url)}" rel="noreferrer noopener" target="_blank">${esc(h.ci.run.conclusion ?? h.ci.run.status)}</a> <span class="meta">${esc(h.ci.run.sha.slice(0, 7))} · ${esc(formatTime(h.ci.run.created))}</span>`
          : "no runs yet"
        : h.ci.kind === "error"
          ? `unavailable <span class="meta">${esc(h.ci.message)}</span>`
          : `<span class="meta">${esc(h.ci.reason)}</span>`;
    const ciKind = h.ci.kind === "ok" && h.ci.run?.conclusion === "success" ? "ok" : h.ci.kind === "ok" && h.ci.run?.conclusion && h.ci.run.conclusion !== "success" ? "bad" : "";
    const errors = h.findings.filter((f) => f.severity === "error");
    const warnings = h.findings.filter((f) => f.severity === "warning");
    const list = (items: Finding[]) => `<ul class="plain">${items.slice(0, FINDINGS_LIMIT).map(findingRow).join("")}</ul>${items.length > FINDINGS_LIMIT ? `<p class="hint">and ${items.length - FINDINGS_LIMIT} more; run <code>octosprout validate</code> for all.</p>` : ""}`;

    return reply.type("text/html; charset=utf-8").send(
      page({
        title: "Health",
        page: "health",
        nav: "health",
        crumbs: ["Workspace", "Health"],
        sync: w,
        scripts: ["app.js"],
        body: `<h1>Health</h1>
${h.pendingAlert ? `<p class="banner alert" role="alert">A commit has waited more than an hour to be pushed (since ${esc(formatTime(w.oldestPending!))}). It is safe on the server; check GitHub access and the deploy key.</p>` : ""}
${w.pendingBranches.length ? `<p class="banner alert" role="alert">Commits that could not be rebased are kept on ${w.pendingBranches.map((b) => `<code>${esc(b)}</code>`).join(", ")} in the server's clone. Nothing was lost; resolve them by hand.</p>` : ""}
<div class="facts">
${fact("Validation", `${h.errors} error${h.errors === 1 ? "" : "s"}, ${h.warnings} warning${h.warnings === 1 ? "" : "s"}`, h.errors ? "bad" : "ok")}
${fact("Waiting to be pushed", String(w.pending), w.pending ? (h.pendingAlert ? "bad" : "warn") : "ok")}
${fact("Last fetch", w.lastFetch ? esc(formatTime(w.lastFetch)) : "not since start")}
${fact("Last push", w.lastPush ? esc(formatTime(w.lastPush)) : "not since start")}
${fact("Commit", `<span class="mono">${esc(w.head.slice(0, 12))}</span>`)}
${fact("Last CI run on main", ci, ciKind)}
</div>
<h2>Errors</h2>
${errors.length ? list(errors) : `<p class="hint">None. The server keeps accepting only writes that add no errors (§8.5).</p>`}
<h2>Warnings</h2>
${warnings.length ? list(warnings) : `<p class="hint">None.</p>`}`,
      }),
    );
  });
}
