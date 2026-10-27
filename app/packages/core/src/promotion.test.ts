import { describe, expect, it } from "vitest";

import { capture, configFile, idea, SHA1, testKey } from "./fixtures.js";
import { signApproval } from "./approvals.js";
import { planPromotion, promotionBrief } from "./promotion.js";
import { applyOperations, classifyOperations, completeOperations, decideProposal, proposalPath, renderProposal, stampApprovals, workspaceLookup } from "./proposals.js";
import { RecordIndex } from "./record-index.js";
import { validateWorkspace, type SourceFile } from "./validate.js";

const NOW = "2026-10-27T10:00:00Z";
const BRIEF = (related: string) => promotionBrief("OS-I-2HD9W", [{ id: "OS-R-B7N2C", title: "Memory survey" }]).replace("## Goals\n", "## Goals\nRemember.\n").replace("## Non-goals\n", "## Non-goals\nForget.\n").replace("## Scope\n", "## Scope\nAll.\n").replace("## Success criteria\n", `## Success criteria\nIt works.${related}\n`);

describe("promotionBrief", () => {
  it("lists the idea and its research under Related", () => {
    expect(promotionBrief("OS-I-2HD9W", [{ id: "OS-R-B7N2C", title: "Memory survey" }])).toContain("## Related\n\n- Idea OS-I-2HD9W\n- Memory survey (OS-R-B7N2C)\n");
  });
});

describe("planPromotion", () => {
  it.each(["proposed", "active"] as const)("makes one proposal that validates once applied and signed (%s)", (status) => {
    const key = testKey();
    const files: SourceFile[] = [configFile(key), capture("OS-C-7K3QX"), idea("OS-I-2HD9W", { status: "ready", links: [{ rel: "derived_from", id: "OS-C-7K3QX" }] })];
    const index = new RecordIndex(files);
    const lookup = workspaceLookup(index);
    const ideaFile = index.get("OS-I-2HD9W")!;
    const operations = planPromotion({
      idea: ideaFile,
      project: { id: "OS-P-0XZ4K", title: "Conversational memory", status, body: BRIEF("") },
      tasks: [{ id: "OS-T-AAAAA", title: "Survey stores" }, { id: "OS-T-BBBBB", title: "Prototype" }],
      now: NOW,
    });
    expect(operations.map((op) => op.op)).toEqual(["create", "create", "create", "set_status", "add_link"]);

    const applied = applyOperations(operations, lookup, NOW);
    if (!applied.ok) throw new Error(applied.message);
    const classification = classifyOperations(operations, lookup, applied, 10);
    expect(classification).toMatchObject({ consequential: true, authorizes: [{ id: "OS-I-2HD9W", status: "transplanted" }] });
    const final = completeOperations(operations, lookup, applied);
    const id = "OS-PROP-8V3KD";
    const proposal = decideProposal(renderProposal({ id, title: "Promote", actor: "user:web", baseCommit: SHA1, consequential: true, operations: final, rationale: "Ready.", now: NOW }), {
      status: "applied",
      operations: final,
      approval: signApproval(id, final, "approved", NOW, key),
      now: NOW,
    });
    const changes = stampApprovals(applied, lookup, classification.authorizes, id);
    const workspace = [...files.filter((f) => !changes.some((c) => c.path === f.path)), ...changes.map((c) => ({ path: c.path, content: (c as { content: string }).content })), { path: proposalPath(id, NOW), content: proposal }];
    expect(validateWorkspace(workspace).filter((f) => f.severity === "error")).toEqual([]);

    const after = new RecordIndex(workspace);
    expect(after.get("OS-P-0XZ4K")).toMatchObject({ status, title: "Conversational memory", path: "records/projects/OS-P-0XZ4K--conversational-memory.md" });
    expect(after.get("OS-T-AAAAA")?.links).toEqual([{ rel: "belongs_to", id: "OS-P-0XZ4K" }, { rel: "derived_from", id: "OS-I-2HD9W" }]);
    expect(after.get("OS-I-2HD9W")).toMatchObject({ status: "transplanted", approval: id });
  });
});
