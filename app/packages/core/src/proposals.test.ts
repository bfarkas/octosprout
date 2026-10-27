import { describe, expect, it } from "vitest";

import { adrBody, capture, configFile, decision, idea, project, record, SHA1, testKey } from "./fixtures.js";
import { signApproval } from "./approvals.js";
import { gitBlobSha, RecordIndex } from "./record-index.js";
import {
  applyOperations,
  classifyOperations,
  completeOperations,
  decideProposal,
  proposalPath,
  renderProposal,
  stampApprovals,
  workspaceLookup,
  type Operation,
} from "./proposals.js";
import { parseRecord } from "./record.js";
import { newRecord } from "./templates.js";
import { validateWorkspace, type SourceFile } from "./validate.js";

const NOW = "2026-10-27T10:00:00Z";
const BRIEF = "## Goals\nA\n\n## Non-goals\nB\n\n## Scope\nC\n\n## Success criteria\nD\n";

function setup(...files: SourceFile[]) {
  const index = new RecordIndex(files);
  const others = new Map(files.filter((f) => !index.byPath(f.path)).map((f) => [f.path, f]));
  const lookup = workspaceLookup(index, (path) => {
    const file = others.get(path);
    return file ? { path, text: file.content as string, blob: gitBlobSha(file.content) } : undefined;
  });
  return { index, lookup, blob: (id: string) => index.get(id)!.blob };
}

describe("applyOperations", () => {
  it("applies operations in order, stacking several on one file", () => {
    const { lookup, blob } = setup(idea("OS-I-2HD9W", { status: "ready" }), project("OS-P-0XZ4K"));
    const ops: Operation[] = [
      { op: "set_status", id: "OS-I-2HD9W", base_blob: blob("OS-I-2HD9W"), status: "transplanted" },
      { op: "add_link", id: "os-i-2hd9w", base_blob: blob("OS-I-2HD9W"), link: { rel: "promoted_to", id: "OS-P-0XZ4K" } },
      { op: "create", path: "records/tasks/OS-T-QF81M--x.md", content: "task" },
    ];
    const result = applyOperations(ops, lookup, NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.preconditions).toEqual([
      { path: "records/ideas/OS-I-2HD9W--example.md", baseBlob: blob("OS-I-2HD9W") },
      { path: "records/tasks/OS-T-QF81M--x.md", baseBlob: null },
    ]);
    const ideaText = (result.changes[0] as { content: string }).content;
    expect(ideaText).toContain("status: transplanted");
    expect(ideaText).toContain("  - { rel: promoted_to, id: OS-P-0XZ4K }");
    expect(ideaText).toContain(`updated: ${NOW}`);
    expect(result.statusChanges).toEqual([{ id: "OS-I-2HD9W", path: "records/ideas/OS-I-2HD9W--example.md", type: "idea", from: "ready", to: "transplanted" }]);
  });

  it("removes links, updates and deletes files", () => {
    const { lookup, blob } = setup(idea("OS-I-2HD9W", { links: [{ rel: "relates_to", id: "OS-P-0XZ4K" }] }), project("OS-P-0XZ4K"), { path: "AGENTS.md", content: "# Agents\n" });
    const result = applyOperations(
      [
        { op: "remove_link", id: "OS-I-2HD9W", base_blob: blob("OS-I-2HD9W"), link: { rel: "relates_to", id: "OS-P-0XZ4K" } },
        { op: "update", path: "AGENTS.md", base_blob: gitBlobSha("# Agents\n"), content: "# Agents v2\n" },
        { op: "delete", id: "OS-P-0XZ4K", base_blob: blob("OS-P-0XZ4K") },
      ],
      lookup,
      NOW,
    );
    if (!result.ok) throw new Error(result.message);
    expect((result.changes[0] as { content: string }).content).not.toContain("links:");
    expect(result.changes[1]).toEqual({ path: "AGENTS.md", content: "# Agents v2\n" });
    expect(result.changes[2]).toEqual({ path: "records/projects/OS-P-0XZ4K--example.md", delete: true });
  });

  it("reports a stale base_blob, a missing record and an existing path", () => {
    const { lookup } = setup(idea("OS-I-2HD9W"));
    expect(applyOperations([{ op: "set_status", id: "OS-I-2HD9W", base_blob: SHA1, status: "sprouting" }], lookup, NOW)).toMatchObject({ ok: false, kind: "stale", index: 0 });
    expect(applyOperations([{ op: "set_status", id: "OS-I-ZZZZZ", base_blob: SHA1, status: "sprouting" }], lookup, NOW)).toMatchObject({ ok: false, kind: "stale" });
    expect(applyOperations([{ op: "create", path: "records/ideas/OS-I-2HD9W--example.md", content: "" }], lookup, NOW)).toMatchObject({ ok: false, kind: "stale" });
  });
});

describe("classifyOperations", () => {
  const classify = (files: SourceFile[], ops: (blob: (id: string) => string) => Operation[], threshold = 10) => {
    const { lookup, blob } = setup(...files);
    const operations = ops(blob);
    const applied = applyOperations(operations, lookup, NOW);
    if (!applied.ok) throw new Error(applied.message);
    return classifyOperations(operations, lookup, applied, threshold);
  };

  it("finds routine changes routine", () => {
    expect(classify([idea("OS-I-2HD9W")], (b) => [{ op: "set_status", id: "OS-I-2HD9W", base_blob: b("OS-I-2HD9W"), status: "sprouting" }])).toEqual({ consequential: false, reasons: [], authorizes: [] });
  });

  it.each([
    ["a promotion", [idea("OS-I-2HD9W", { status: "ready" })], (b: (id: string) => string): Operation[] => [{ op: "set_status", id: "OS-I-2HD9W", base_blob: b("OS-I-2HD9W"), status: "transplanted" }]],
    ["accepting a decision", [decision("OS-D-4M9TZ", { status: "PROPOSED" }, adrBody("OS-D-4M9TZ", "PROPOSED"))], (b: (id: string) => string): Operation[] => [{ op: "set_status", id: "OS-D-4M9TZ", base_blob: b("OS-D-4M9TZ"), status: "ACCEPTED" }]],
    ["archiving an active project", [record("project", "records/projects", "OS-P-0XZ4K", { status: "active" }, undefined, BRIEF)], (b: (id: string) => string): Operation[] => [{ op: "set_status", id: "OS-P-0XZ4K", base_blob: b("OS-P-0XZ4K"), status: "archived" }]],
  ])("authorizes %s", (_label, files, ops) => {
    const result = classify(files, ops);
    expect(result.consequential).toBe(true);
    expect(result.authorizes).toHaveLength(1);
  });

  it("finds deletes, guarded files, active briefs and bulk changes consequential", () => {
    expect(classify([idea("OS-I-2HD9W")], (b) => [{ op: "delete", id: "OS-I-2HD9W", base_blob: b("OS-I-2HD9W") }]).reasons).toEqual(["It deletes OS-I-2HD9W."]);
    expect(classify([idea("OS-I-2HD9W")], () => [{ op: "create", path: "skills/x/SKILL.md", content: "x" }]).reasons).toEqual(["It changes skills/x/SKILL.md."]);
    const active = record("project", "records/projects", "OS-P-0XZ4K", { status: "active" }, undefined, BRIEF);
    expect(classify([active], (b) => [{ op: "update", id: "OS-P-0XZ4K", base_blob: b("OS-P-0XZ4K"), content: (active.content as string).replace("C\n", "C2\n") }]).reasons[0]).toContain("Scope");
    const ideas = ["OS-I-11111", "OS-I-22222"].map((id) => idea(id));
    expect(classify(ideas, (b) => ["OS-I-11111", "OS-I-22222"].map((id) => ({ op: "set_status" as const, id, base_blob: b(id), status: "sprouting" })), 1).consequential).toBe(true);
  });
});

describe("a promotion, applied and signed, validates", () => {
  it("round-trips through the validator with the server's key", () => {
    const key = testKey();
    const files = [configFile(key), capture("OS-C-7K3QX"), idea("OS-I-2HD9W", { status: "ready", links: [{ rel: "derived_from", id: "OS-C-7K3QX" }] })];
    const { lookup, blob } = setup(...files);
    const projectText = newRecord("project", { id: "OS-P-0XZ4K", title: "Memory", now: NOW });
    const operations: Operation[] = [
      { op: "create", path: "records/projects/OS-P-0XZ4K--memory.md", content: projectText },
      { op: "set_status", id: "OS-I-2HD9W", base_blob: blob("OS-I-2HD9W"), status: "transplanted" },
      { op: "add_link", id: "OS-I-2HD9W", base_blob: blob("OS-I-2HD9W"), link: { rel: "promoted_to", id: "OS-P-0XZ4K" } },
    ];
    const applied = applyOperations(operations, lookup, NOW);
    if (!applied.ok) throw new Error(applied.message);
    const classification = classifyOperations(operations, lookup, applied, 10);
    expect(classification.authorizes).toEqual([{ id: "OS-I-2HD9W", status: "transplanted" }]);
    const final = completeOperations(operations, lookup, applied);
    const id = "OS-PROP-8V3KD";
    const pending = renderProposal({ id, title: "Promote OS-I-2HD9W", actor: "user:web", baseCommit: SHA1, consequential: true, operations: final, rationale: "Ready.", now: NOW });
    const decided = decideProposal(pending, { status: "applied", operations: final, approval: signApproval(id, final, "approved", NOW, key), now: NOW });
    const changes = stampApprovals(applied, lookup, classification.authorizes, id);

    const workspace: SourceFile[] = [...files.filter((f) => !changes.some((c) => c.path === f.path)), ...changes.map((c) => ({ path: c.path, content: (c as { content: string }).content })), { path: proposalPath(id, NOW), content: decided }];
    expect(validateWorkspace(workspace).filter((f) => f.severity === "error")).toEqual([]);
    const parsed = parseRecord(decided);
    expect(parsed.ok && parsed.record.frontmatter).toMatchObject({ status: "applied", consequential: true, approval: { decision: "approved", key_id: key.id } });
  });

  it("records the body hash when a decision is accepted", () => {
    const body = adrBody("OS-D-4M9TZ", "PROPOSED");
    const { lookup, blob } = setup(decision("OS-D-4M9TZ", { status: "PROPOSED" }, body));
    const operations: Operation[] = [{ op: "set_status", id: "OS-D-4M9TZ", base_blob: blob("OS-D-4M9TZ"), status: "ACCEPTED" }];
    const applied = applyOperations(operations, lookup, NOW);
    if (!applied.ok) throw new Error(applied.message);
    expect(completeOperations(operations, lookup, applied)[0]).toMatchObject({ body_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});
