/**
 * Record bodies rendered as Markdown (spec §12.2). Raw HTML is disabled, so
 * everything in a record is escaped; markdown-it also refuses `javascript:`,
 * `vbscript:`, `file:` and most `data:` links. The CSP blocks anything
 * external that slips through, such as remote images. Relative image links
 * into `attachments/` are served by /attachments/ (ADR009); others are dropped.
 */
import { resolveAttachment } from "@octosprout/core";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

// Links leave the app without a referrer, in a new tab.
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const href = token.attrGet("href") ?? "";
  if (/^https?:/i.test(href)) {
    token.attrSet("rel", "noreferrer noopener");
    token.attrSet("target", "_blank");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env: { recordPath?: string }, self) => {
  const token = tokens[idx]!;
  const path = env.recordPath === undefined ? undefined : resolveAttachment(env.recordPath, token.attrGet("src") ?? "");
  // Anything else (remote, absolute, outside attachments/) keeps only its alt text.
  if (!path) return md.utils.escapeHtml(self.renderInlineAsText(token.children ?? [], options, env));
  token.attrSet("src", `/${path.split("/").map(encodeURIComponent).join("/")}`);
  token.attrSet("loading", "lazy");
  return defaultImage(tokens, idx, options, env, self);
};

/** Renders a record body. `recordPath` is the record's workspace path, which relative image links resolve against. */
export function renderMarkdown(text: string, recordPath?: string): string {
  return (
    md
      .render(text, { recordPath })
      // Task list items: "- [ ] x" and "- [x] x" become read-only checkboxes.
      .replace(/<li>\[( |x|X)\] /g, (_match, mark: string) => `<li class="task"><input type="checkbox" disabled${mark === " " ? "" : " checked"}> `)
      .replace(/<li>(<p>)\[( |x|X)\] /g, (_match, p: string, mark: string) => `<li class="task">${p}<input type="checkbox" disabled${mark === " " ? "" : " checked"}> `)
  );
}
