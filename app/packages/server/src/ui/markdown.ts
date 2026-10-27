/**
 * Record bodies rendered as Markdown (spec §12.2). Raw HTML is disabled, so
 * everything in a record is escaped; markdown-it also refuses `javascript:`,
 * `vbscript:`, `file:` and most `data:` links. The CSP blocks anything
 * external that slips through, such as remote images.
 */
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

export function renderMarkdown(text: string): string {
  return (
    md
      .render(text)
      // Task list items: "- [ ] x" and "- [x] x" become read-only checkboxes.
      .replace(/<li>\[( |x|X)\] /g, (_match, mark: string) => `<li class="task"><input type="checkbox" disabled${mark === " " ? "" : " checked"}> `)
      .replace(/<li>(<p>)\[( |x|X)\] /g, (_match, p: string, mark: string) => `<li class="task">${p}<input type="checkbox" disabled${mark === " " ? "" : " checked"}> `)
  );
}
