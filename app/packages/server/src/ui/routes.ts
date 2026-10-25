/**
 * The signed-in pages: the Inbox (spec §12.2) and the capture form.
 *
 * Everything user-provided is escaped. Capture text is shown as plain text,
 * never as Markdown or HTML.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import type { CaptureSummary, InboxService } from "../inbox/service.js";
import { esc, page } from "./html.js";

export interface UiOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  inbox: InboxService;
  status: () => Promise<WriteStatus>;
}

/** Up to this many characters of a capture are shown in the list; the rest sits behind "Show all". */
const PREVIEW_CHARACTERS = 240;
const INBOX_LIMIT = 100;

/** `2026-10-25T14:03:11Z` -> `2026-10-25 14:03 UTC` */
export function formatTime(created: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(created);
  return match ? `${match[1]} ${match[2]} UTC` : created;
}

function sourceLabel(capture: CaptureSummary): string {
  return capture.source === "other" && capture.sourceDetail ? `other (${capture.sourceDetail})` : capture.source;
}

function captureCard(capture: CaptureSummary, body: string): string {
  const characters = [...body];
  const long = characters.length > PREVIEW_CHARACTERS;
  const preview = long ? `${characters.slice(0, PREVIEW_CHARACTERS).join("")}…` : body;
  const link =
    capture.sourceUrl !== undefined
      ? ` · <a href="${esc(capture.sourceUrl)}" rel="noreferrer noopener" target="_blank">source</a>`
      : "";
  const content = long
    ? `<details><summary><pre>${esc(preview)}</pre></summary><pre>${esc(body)}</pre></details>`
    : `<pre>${esc(body)}</pre>`;
  return `<article class="card" id="${esc(capture.id)}">
<div class="meta"><strong>${esc(capture.id)}</strong> · <time datetime="${esc(capture.created)}">${esc(formatTime(capture.created))}</time> · ${esc(sourceLabel(capture))}${link}</div>
${content}
</article>`;
}

function banners(status: WriteStatus): string {
  let html = "";
  if (status.pending > 0) {
    html += `<p class="banner" role="status">${status.pending} change${status.pending === 1 ? "" : "s"} not yet pushed to GitHub. They are safe on the server and sync automatically.</p>`;
  }
  if (status.pendingBranches.length > 0) {
    html += `<p class="banner" role="alert">${status.pendingBranches.length} commit set${status.pendingBranches.length === 1 ? "" : "s"} could not be rebased and ${status.pendingBranches.length === 1 ? "is" : "are"} kept on a pending branch on the server. Nothing was lost, but it needs attention.</p>`;
  }
  return html;
}

export function registerUi(app: FastifyInstance, options: UiOptions): void {
  const { requireSession, inbox } = options;
  const html = (reply: FastifyReply, body: string): FastifyReply => reply.type("text/html; charset=utf-8").send(body);

  app.get("/", { preHandler: requireSession }, async (_request, reply) => {
    const { captures, total } = inbox.listInbox(INBOX_LIMIT);
    const cards = captures.map((capture) => captureCard(capture, inbox.readBody(capture.path) ?? ""));
    const more = total > captures.length ? `<p class="hint">Showing the newest ${captures.length} of ${total}.</p>` : "";
    const empty = `<p class="hint">Nothing to triage. Share something to the OctoSprout shortcut, or use <a href="/capture">Capture</a>.</p>`;
    return html(
      reply,
      page({
        title: "Inbox",
        page: "inbox",
        nav: "inbox",
        scripts: ["app.js"],
        body: `<h1>Inbox <span class="meta">${total} new</span></h1>
${banners(await options.status())}
${cards.length > 0 ? cards.join("\n") : empty}
${more}`,
      }),
    );
  });

  app.get("/capture", { preHandler: requireSession }, async (_request, reply) =>
    html(
      reply,
      page({
        title: "Capture",
        page: "capture",
        nav: "capture",
        scripts: ["app.js"],
        body: `<h1>Capture</h1>
<form id="capture-form">
<label for="text">Text</label>
<textarea id="text" name="text" required autofocus placeholder="An idea, a link, a pasted brief…"></textarea>
<label for="source_url">Link <span class="hint">(optional)</span></label>
<input type="url" id="source_url" name="source_url" placeholder="https://" inputmode="url" autocomplete="off">
<div class="actions"><button type="submit">Save capture</button></div>
</form>
<p id="status" class="status" role="status" aria-live="polite"></p>`,
      }),
    ),
  );
}
