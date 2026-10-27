import { describe, expect, it } from "vitest";

import { parseRecord } from "./record.js";
import { newRecord, recordPath, templateBody } from "./templates.js";
import { addLink, prefillFromCapture, quoteCapture, titleFromCapture, TRIAGE_TYPES } from "./triage.js";
import { validateWorkspace } from "./validate.js";

describe("triage helpers", () => {
  it("know which types a capture can become", () => {
    expect([...TRIAGE_TYPES].sort()).toEqual(["idea", "research", "task"]);
  });

  it.each([
    ["Working title: Garden metaphor\nDescription: …", "Garden metaphor"],
    ["\n\n## A heading\nbody", "A heading"],
    ["- a list item", "a list item"],
    ["https://example.com/x", "https://example.com/x"],
    ["", ""],
  ])("titleFromCapture(%j) is %j", (text, title) => {
    expect(titleFromCapture(text)).toBe(title);
  });

  it("caps titles at 200 characters", () => {
    expect([...titleFromCapture("é".repeat(300))]).toHaveLength(200);
  });

  it("quotes the capture", () => {
    expect(quoteCapture("one\r\n\ntwo\n\n")).toBe("> one\n>\n> two\n");
  });

  it("prefills the template with the capture quoted at the top", () => {
    const { title, body } = prefillFromCapture("idea", "Working title: Digest\nMore\n");
    expect(title).toBe("Digest");
    expect(body).toBe(`> Working title: Digest\n> More\n\n${templateBody("idea")}`);
  });

  it("makes valid records from the templates", () => {
    const text = newRecord("task", { id: "OS-T-QF81M", title: 'Say "hi": now', now: "2026-10-27T09:00:00Z", body: "Body\n" });
    const parsed = parseRecord(text);
    expect(parsed.ok && parsed.record.frontmatter).toMatchObject({ id: "OS-T-QF81M", type: "task", status: "backlog", title: 'Say "hi": now', created: "2026-10-27T09:00:00Z" });
    expect(parsed.ok && parsed.record.body).toBe("Body\n");
    expect(validateWorkspace([{ path: "records/tasks/OS-T-QF81M--x.md", content: text }])).toEqual([]);
  });

  it("adds a link once and sets updated", () => {
    const text = "---\nid: OS-I-2HD9W\nupdated: 2026-10-25T00:00:00Z\n---\n";
    const once = addLink(text, { rel: "derived_from", id: "OS-C-7K3QX" }, "2026-10-27T00:00:00Z");
    expect(once).toBe("---\nid: OS-I-2HD9W\nupdated: 2026-10-27T00:00:00Z\nlinks:\n  - { rel: derived_from, id: OS-C-7K3QX }\n---\n");
    expect(addLink(once, { rel: "derived_from", id: "OS-C-7K3QX" }, "2026-10-28T00:00:00Z")).toContain("updated: 2026-10-28T00:00:00Z");
    expect(addLink(once, { rel: "derived_from", id: "OS-C-7K3QX" }, "2026-10-28T00:00:00Z").match(/derived_from/g)).toHaveLength(1);
  });
});

describe("recordPath", () => {
  it.each([
    ["idea", "OS-I-2HD9W", "Integrate conversational memory", "records/ideas/OS-I-2HD9W--integrate-conversational-memory.md"],
    ["research", "OS-R-B7N2C", "Café: Über-fast!", "records/research/OS-R-B7N2C--cafe-uber-fast.md"],
    ["task", "OS-T-QF81M", "!!!", "records/tasks/OS-T-QF81M.md"],
    ["expert", "OS-E-SEC01", "x".repeat(80), `experts/OS-E-SEC01--${"x".repeat(60)}.md`],
  ] as const)("%s %s %j", (type, id, title, path) => {
    expect(recordPath(type, id, title)).toBe(path);
  });
});
