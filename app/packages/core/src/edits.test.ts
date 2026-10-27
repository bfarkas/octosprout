import { describe, expect, it } from "vitest";

import { adrBody, capture, decision, idea, record } from "./fixtures.js";
import { applyFormEdit, checkEdit } from "./edits.js";
import { setFrontmatterFields } from "./record.js";

const text = (file: { content: string | Uint8Array }) => file.content as string;

describe("checkEdit", () => {
  const before = text(idea("OS-I-2HD9W", { tags: ["a"] }));

  it("allows title, tags, links, refs, body and x- keys", () => {
    const after = setFrontmatterFields(before, { title: "New", tags: ["b"], "x-board": 1, updated: "2026-10-27T00:00:00Z" }) + "Body\n";
    expect(checkEdit(before, after)).toEqual({ ok: true });
  });

  it.each(["id", "type", "schema_version", "created", "status", "approval"])("forbids changing %s", (field) => {
    const after = setFrontmatterFields(before, { [field]: field === "schema_version" ? 2 : "OS-PROP-8V3KD" });
    expect(checkEdit(before, after)).toMatchObject({ ok: false, kind: "forbidden", field });
  });

  it("forbids unparseable results and proposals", () => {
    expect(checkEdit(before, "no frontmatter")).toMatchObject({ ok: false, kind: "forbidden" });
    const proposal = record("proposal", "proposals", "OS-PROP-8V3KD", { status: "pending" });
    expect(checkEdit(text(proposal), text(proposal))).toMatchObject({ kind: "forbidden" });
  });

  it("keeps captures as received, except tags and x- keys", () => {
    const original = text(capture());
    expect(checkEdit(original, setFrontmatterFields(original, { tags: ["later"], "x-seen": true }))).toEqual({ ok: true });
    expect(checkEdit(original, setFrontmatterFields(original, { source: "web" }))).toMatchObject({ kind: "forbidden", field: "source" });
    expect(checkEdit(original, `${original}more`)).toMatchObject({ kind: "forbidden", field: "body" });
  });

  it("freezes the body of accepted decisions, except the Status line", () => {
    const body = adrBody("OS-D-4M9TZ", "ACCEPTED");
    const accepted = text(decision("OS-D-4M9TZ", { status: "ACCEPTED" }, body));
    expect(checkEdit(accepted, accepted.replace("Do the thing.", "Do more."))).toMatchObject({ kind: "forbidden", field: "body" });
    expect(checkEdit(accepted, setFrontmatterFields(accepted, { title: "Renamed" }))).toEqual({ ok: true });
    const draft = text(decision("OS-D-4M9TZ"));
    expect(checkEdit(draft, draft.replace("Do the thing.", "Do more."))).toEqual({ ok: true });
  });

  it("needs approval to change the brief of an active project", () => {
    const brief = "## Goals\nA\n\n## Non-goals\nB\n\n## Scope\nC\n\n## Success criteria\nD\n\n## Risks, assumptions and open questions\nE\n";
    const active = text(record("project", "records/projects", "OS-P-0XZ4K", { status: "active" }, undefined, brief));
    expect(checkEdit(active, active.replace("C\n", "C, and more\n"))).toMatchObject({ ok: false, kind: "approval_required", message: expect.stringContaining("Scope") });
    expect(checkEdit(active, active.replace("E\n", "E2\n"))).toEqual({ ok: true });
    const proposed = text(record("project", "records/projects", "OS-P-0XZ4K", { status: "proposed" }, undefined, brief));
    expect(checkEdit(proposed, proposed.replace("C\n", "C2\n"))).toEqual({ ok: true });
  });
});

describe("applyFormEdit", () => {
  it("sets the given fields and the body, and leaves the rest", () => {
    const before = text(idea("OS-I-2HD9W", { tags: ["a"], "x-board": { lane: 1 } }));
    const after = applyFormEdit(before, { title: "Renamed", tags: [], links: [{ rel: "relates_to", id: "OS-P-0XZ4K" }], body: "## Motivation\nWhy\n" });
    expect(after).toContain("title: Renamed\n");
    expect(after).not.toContain("tags:");
    expect(after).toContain("links:\n  - { rel: relates_to, id: OS-P-0XZ4K }\n");
    expect(after).toContain("x-board:");
    expect(after.endsWith("---\n## Motivation\nWhy\n")).toBe(true);
    expect(applyFormEdit(before, {})).toBe(before);
  });

  it("leaves unchanged fields as they are written", () => {
    const before = "---\nid: OS-I-2HD9W\ntitle: T\nlinks:\n  - rel: relates_to\n    id: OS-P-0XZ4K\n---\nBody\n";
    expect(applyFormEdit(before, { title: "T", tags: [], links: [{ rel: "relates_to", id: "OS-P-0XZ4K" }], refs: [], body: "Body\n" })).toBe(before);
  });
});
