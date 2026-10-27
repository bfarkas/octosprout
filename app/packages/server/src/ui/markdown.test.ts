import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("renders headings, lists and code", () => {
    const html = renderMarkdown("## Goals\n\n- one\n- two\n\n```\ncode <b>\n```\n");
    expect(html).toContain("<h2>Goals</h2>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<pre><code>code &lt;b&gt;\n</code></pre>");
  });

  it("escapes raw HTML and refuses script links", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
  });

  it("opens external links without a referrer", () => {
    expect(renderMarkdown("[a](https://example.com)")).toContain('<a href="https://example.com" rel="noreferrer noopener" target="_blank">a</a>');
  });

  it("renders task list items as read-only checkboxes", () => {
    const html = renderMarkdown("- [ ] open\n- [x] done\n");
    expect(html).toContain('<li class="task"><input type="checkbox" disabled> open</li>');
    expect(html).toContain('<li class="task"><input type="checkbox" disabled checked> done</li>');
  });
});
