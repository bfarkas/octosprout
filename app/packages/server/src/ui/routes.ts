/**
 * The signed-in pages: the Inbox (spec §12.2) and the capture form.
 *
 * Everything user-provided is escaped. Capture text is shown as plain text,
 * never as Markdown or HTML.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WriteStatus } from "../git/write-service.js";
import type { PasskeyStore } from "../auth/passkeys.js";
import type { TokenStore } from "../http/tokens.js";
import type { OAuthStore } from "../oauth/store.js";
import type { CaptureSummary, InboxService } from "../inbox/service.js";
import { esc, page } from "./html.js";

export interface UiOptions {
  requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined>;
  inbox: InboxService;
  tokens: TokenStore;
  passkeys: PasskeyStore;
  status: () => Promise<WriteStatus>;
  /** The approval key section of Settings, when the server handles approvals. */
  approvalKey?: () => string;
  agents?: () => ReturnType<OAuthStore["grants"]>;
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
    ? // Collapsed: the preview and "Show all". Open: "Show less" and the full text, with the preview hidden by CSS.
      `<details><summary><pre class="preview">${esc(preview)}</pre><span class="toggle"></span></summary><pre class="full">${esc(body)}</pre></details>`
    : `<pre>${esc(body)}</pre>`;
  return `<article class="card" id="${esc(capture.id)}">
<a class="button secondary triage-button" href="/inbox/${esc(capture.id)}/triage">Triage</a>
<div class="meta"><a href="/records/${esc(capture.id)}"><strong>${esc(capture.id)}</strong></a> · <time datetime="${esc(capture.created)}">${esc(formatTime(capture.created))}</time> · ${esc(sourceLabel(capture))}${link}</div>
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
    const status = await options.status();
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
        crumbs: ["Garden", "Inbox"],
        sync: status,
        scripts: ["app.js"],
        body: `<h1>Inbox <span class="meta">${total} new</span></h1>
${banners(status)}
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
        crumbs: ["Garden", "Capture"],
        sync: await options.status(),
        scripts: ["app.js"],
        body: `<h1>Capture</h1>
<form id="capture-form">
<label for="text">Text</label>
<textarea id="text" name="text" required autofocus placeholder="An idea, a link, a pasted brief…"></textarea>
<label for="source_url">Link <span class="hint">(optional)</span></label>
<input type="url" id="source_url" name="source_url" placeholder="https://" inputmode="url" autocomplete="off">
<div class="actions"><button type="submit">Save capture</button><button type="button" id="paste-save" class="secondary">Paste &amp; save</button></div>
</form>
<p id="status" class="status" role="status" aria-live="polite"></p>`,
      }),
    ),
  );
}

export function registerSettings(app: FastifyInstance, options: UiOptions): void {
  const { requireSession, tokens, passkeys } = options;

  app.get("/settings", { preHandler: requireSession }, async (_request, reply) => {
    const rows = tokens
      .list()
      .map((token) =>
        token.revoked === undefined
          ? `<li class="card" data-token="${esc(token.name)}"><strong>${esc(token.name)}</strong> <span class="meta">created ${esc(formatTime(token.created))}</span>
<button type="button" class="link" data-action="revoke-token" data-name="${esc(token.name)}">Revoke</button></li>`
          : `<li class="card meta">${esc(token.name)} · revoked ${esc(formatTime(token.revoked))}</li>`,
      )
      .join("\n");
    const keys = passkeys
      .list()
      .map((key) => `<li class="card"><strong>${esc(key.name)}</strong> <span class="meta">added ${esc(formatTime(key.created))}${key.lastUsed ? `, last used ${esc(formatTime(key.lastUsed))}` : ""}</span></li>`)
      .join("\n");
    const agents = options.agents?.()
      .map((agent) => `<li class="card"><strong>${esc(agent.client.name)}</strong> <span class="meta">connected ${esc(formatTime(agent.created))}${agent.lastUsed ? `, last used ${esc(formatTime(agent.lastUsed))}` : ""}</span><button type="button" class="link" data-action="revoke-agent" data-id="${esc(agent.id)}">Revoke</button></li>`)
      .join("\n");
    return reply.type("text/html; charset=utf-8").send(
      page({
        title: "Settings",
        page: "settings",
        nav: "settings",
        crumbs: ["Workspace", "Settings"],
        sync: await options.status(),
        scripts: options.approvalKey ? ["app.js", "approve.js", "proposals.js"] : ["app.js"],
        body: `<h1>Settings</h1>
<h2>Inbox tokens</h2>
<p class="hint">A token lets a script or another client add captures through the inbox API, and nothing else. It is shown once. The share link and the home screen app need no token.</p>
<ul class="plain" id="token-list">${rows}</ul>
<form id="token-form" autocomplete="off">
<label for="token-name">New token name</label>
<input type="text" id="token-name" name="name" placeholder="laptop-script" maxlength="64" pattern="[A-Za-z0-9._-]+" required>
<div class="actions"><button type="submit">Create token</button></div>
</form>
<div id="new-token" class="card" hidden>
<p>Copy this token now. It will not be shown again.</p>
<pre id="new-token-value"></pre>
</div>
<p id="status" class="status" role="status" aria-live="polite"></p>
${options.approvalKey ? options.approvalKey() : ""}
${agents !== undefined ? `<h2>Connected agents</h2><ul class="plain">${agents || `<li class="meta">No agents connected.</li>`}</ul>` : ""}
<h2>Passkeys</h2>
<ul class="plain">${keys}</ul>
<p class="hint">Add another device at <a href="/setup">/setup</a> with the setup token.</p>`,
      }),
    );
  });
}
