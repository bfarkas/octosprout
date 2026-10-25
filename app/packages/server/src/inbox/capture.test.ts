import { describe, expect, it } from "vitest";

import { parseRecord, sha256Hex, validateWorkspace } from "@octosprout/core";

import { buildCapture, capturePath, formatTimestamp } from "./capture.js";
import type { InboxRequest } from "./request.js";

const receivedAt = new Date("2026-10-25T14:03:11.789Z");
const base: InboxRequest = { text: "hello\n", idempotencyKey: "20261025T140310-48213", source: "chatgpt" };
const build = (request: InboxRequest, id = "OS-C-7K3QX") => buildCapture(request, { id, receivedAt, receivedVia: "token:iphone-shortcut" });

describe("buildCapture", () => {
  it("places the file by UTC receive time", () => {
    expect(build(base).path).toBe("records/captures/2026/10/OS-C-7K3QX.md");
    expect(capturePath("OS-C-7K3QX", new Date("2026-12-31T23:59:59Z"))).toBe("records/captures/2026/12/OS-C-7K3QX.md");
    expect(capturePath("OS-C-7K3QX", new Date("2027-01-01T00:00:00Z"))).toBe("records/captures/2027/01/OS-C-7K3QX.md");
  });

  it("formats timestamps without milliseconds", () => {
    expect(formatTimestamp(receivedAt)).toBe("2026-10-25T14:03:11Z");
  });

  it("produces a record that validates cleanly", () => {
    const built = build({ ...base, sourceUrl: "https://chatgpt.com/share/abc123", clientCreatedAt: "2026-10-25T16:03:10+02:00" });
    expect(validateWorkspace([{ path: built.path, content: built.content }])).toEqual([]);
  });

  it.each([
    ["CRLF and trailing whitespace", "line one  \r\nline two \r\n\r\n"],
    ["a leading frontmatter delimiter", "---\nnot: frontmatter\n---\nbody"],
    ["emoji and combining characters", "🌱 café é"],
    ["leading and trailing blank lines", "\n\n  text  \n\n\n"],
    ["Markdown and HTML", "# Title\n<script>alert(1)</script>\n[x](javascript:alert(1))"],
    ["no trailing newline", "no newline"],
  ])("stores %s byte for byte", (_label, text) => {
    const built = build({ ...base, text });
    const parsed = parseRecord(built.content);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.record.body).toBe(text);
    expect(parsed.record.frontmatter.content_sha256).toBe(sha256Hex(text));
    expect(validateWorkspace([{ path: built.path, content: built.content }])).toEqual([]);
  });

  it.each(["12345678", "2026-10-25", "true-true", "1e100000", "0x1234567"])("keeps the idempotency key %j a string", (key) => {
    const built = build({ ...base, idempotencyKey: key });
    const parsed = parseRecord(built.content);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.record.frontmatter.idempotency_key).toBe(key);
  });

  it("records an unknown source as other with its detail", () => {
    const built = build({ ...base, source: "other", sourceDetail: "telegram" });
    expect(validateWorkspace([{ path: built.path, content: built.content }])).toEqual([]);
    expect(built.content).toContain("source_detail: telegram");
  });
});
