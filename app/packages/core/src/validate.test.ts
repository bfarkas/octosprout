import { describe, expect, it } from "vitest";

import { decisionBodySha256 } from "./adr.js";
import { adrBody, capture, configFile, decision, expert, idea, project, proposal, record, research, SHA1, signedProposal, task, testKey } from "./fixtures.js";
import { hasErrors, type Finding } from "./findings.js";
import { renderRecord, sha256Hex } from "./record.js";
import { SchemaRegistry } from "./schemas.js";
import { parseTimestamp, validateWorkspace, type SourceFile } from "./validate.js";

const schemas = new SchemaRegistry();
const run = (...files: SourceFile[]): Finding[] => validateWorkspace(files, { schemas });
const codes = (findings: Finding[]) => findings.map((f) => f.code);

describe("a valid workspace", () => {
  it("has no findings", () => {
    expect(run(capture())).toEqual([]);
  });

  it("ignores files outside the record directories", () => {
    expect(run({ path: "README.md", content: "# not a record" }, { path: "skills/x/SKILL.md", content: "no" })).toEqual([]);
  });

  it("keeps x- keys", () => {
    expect(run(capture("OS-C-7K3QX", { "x-board": { lane: 1 } }))).toEqual([]);
  });
});

describe("OSV001 identity and placement", () => {
  it.each([
    ["a malformed ID", capture("OS-C-7K3Q", {}, undefined, "records/captures/2026/10/OS-C-7K3Q.md")],
    ["a lowercase ID", capture("os-c-7k3qx", {}, undefined, "records/captures/2026/10/OS-C-7K3QX.md")],
    ["a library ID", capture("OSL-SKILL-7K3QX", {}, undefined, "records/captures/2026/10/OSL-SKILL-7K3QX.md")],
    ["an ID/type mismatch", capture("OS-I-7K3QX", {}, undefined, "records/captures/2026/10/OS-I-7K3QX.md")],
    ["the wrong directory", capture("OS-C-7K3QX", {}, undefined, "records/ideas/OS-C-7K3QX.md")],
    ["a missing date directory", capture("OS-C-7K3QX", {}, undefined, "records/captures/OS-C-7K3QX.md")],
    ["a bad month", capture("OS-C-7K3QX", {}, undefined, "records/captures/2026/13/OS-C-7K3QX.md")],
    ["a filename without the ID", capture("OS-C-7K3QX", {}, undefined, "records/captures/2026/10/other.md")],
    ["a capture slug", capture("OS-C-7K3QX", {}, undefined, "records/captures/2026/10/OS-C-7K3QX--slug.md")],
  ])("rejects %s", (_label, file) => {
    expect(codes(run(file))).toContain("OSV001");
  });

  it("accepts titled records with or without a slug", () => {
    const osv001 = (findings: Finding[]) => findings.filter((f) => f.code === "OSV001");
    expect(osv001(run(idea("OS-I-2HD9W")))).toEqual([]);
    expect(osv001(run(record("idea", "records/ideas", "OS-I-2HD9W", {}, "records/ideas/OS-I-2HD9W.md")))).toEqual([]);
  });

  it("rejects a titled record whose filename lacks its ID", () => {
    const bad = record("idea", "records/ideas", "OS-I-2HD9W", {}, "records/ideas/something--OS-I-2HD9W.md");
    expect(codes(run(bad))).toContain("OSV001");
  });

  it("only warns when the date directory disagrees with 'created'", () => {
    const findings = run(capture("OS-C-7K3QX", {}, undefined, "records/captures/2026/09/OS-C-7K3QX.md"));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: "OSV001", severity: "warning", line: 6 });
    expect(hasErrors(findings)).toBe(false);
  });

  it("reports a missing ID once", () => {
    const file = { path: "records/captures/2026/10/OS-C-7K3QX.md", content: "---\ntype: capture\n---\n" };
    expect(run(file).filter((f) => f.message.includes("'id'"))).toHaveLength(1);
  });
});

describe("OSV002 duplicate IDs", () => {
  it("flags every file that shares an ID", () => {
    const findings = run(capture(), capture("OS-C-7K3QX", {}, "x", "records/captures/2026/11/OS-C-7K3QX.md"));
    expect(findings.filter((f) => f.code === "OSV002").map((f) => f.path)).toEqual([
      "records/captures/2026/10/OS-C-7K3QX.md",
      "records/captures/2026/11/OS-C-7K3QX.md",
    ]);
  });

  it("does not flag distinct IDs", () => {
    expect(codes(run(capture("OS-C-AAAAA"), capture("OS-C-BBBBB")))).not.toContain("OSV002");
  });
});

describe("OSV003 frontmatter", () => {
  it.each([
    ["unparseable YAML", { path: "records/captures/2026/10/OS-C-7K3QX.md", content: "---\nid: [\n---\n" }],
    ["no frontmatter", { path: "records/captures/2026/10/OS-C-7K3QX.md", content: "hello" }],
    ["invalid UTF-8", { path: "records/captures/2026/10/OS-C-7K3QX.md", content: new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff]) }],
    ["an unknown field", capture("OS-C-7K3QX", { color: "green" })],
    ["a missing required field", capture("OS-C-7K3QX", { idempotency_key: undefined })],
    ["a bad source", capture("OS-C-7K3QX", { source: "telegram" })],
    ["an http source_url", capture("OS-C-7K3QX", { source_url: "http://example.com" })],
    ["an unknown type", capture("OS-C-7K3QX", { type: "note" })],
    ["an unsupported schema_version", capture("OS-C-7K3QX", { schema_version: 2 })],
    ["a non-integer schema_version", capture("OS-C-7K3QX", { schema_version: "1" })],
  ])("flags %s", (_label, file) => {
    expect(codes(run(file))).toContain("OSV003");
  });

  it("points at the offending key's line", () => {
    const [finding] = run(capture("OS-C-7K3QX", { color: "green" }));
    expect(finding).toMatchObject({ code: "OSV003", id: "OS-C-7K3QX" });
    expect(finding?.line).toBeGreaterThan(1);
  });

  it("checks every record type against its schema", () => {
    expect(run(idea("OS-I-2HD9W"), task("OS-T-QF81M"), project("OS-P-0XZ4K"), decision("OS-D-4M9TZ"), research("OS-R-B7N2C"), expert("OS-E-SEC01"), proposal())).toEqual([]);
    expect(codes(run(idea("OS-I-2HD9W", { title: undefined })))).toEqual(["OSV003"]);
    expect(codes(run(task("OS-T-QF81M", { priority: 1 })))).toEqual(["OSV003"]);
    expect(codes(run(decision("OS-D-4M9TZ", { template: undefined })))).toEqual(["OSV003"]);
    expect(codes(run(proposal("OS-PROP-8V3KD", { operations: [] })))).toEqual(["OSV003"]);
  });
});

describe("OSV004 status and lifecycle", () => {
  it.each([
    ["an unknown capture status", capture("OS-C-7K3QX", { status: "seed" })],
    ["a lowercase decision status", decision("OS-D-4M9TZ", { status: "accepted" })],
    ["a missing status", idea("OS-I-2HD9W", { status: undefined })],
  ])("flags %s", (_label, file) => {
    expect(codes(run(file))).toContain("OSV004");
  });

  it("reports an invalid capture status once", () => {
    expect(run(capture("OS-C-7K3QX", { status: "seed" })).filter((f) => f.message.includes("status"))).toHaveLength(1);
  });

  it("requires a planted capture to have an inbound derived_from link", () => {
    const planted = capture("OS-C-7K3QX", { status: "planted" });
    expect(codes(run(planted))).toContain("OSV004");
    const derived = idea("OS-I-2HD9W", { links: [{ rel: "derived_from", id: "OS-C-7K3QX" }] });
    expect(codes(run(planted, derived))).not.toContain("OSV004");
  });

  it("allows composted captures to be restored and new ones to stay unlinked", () => {
    expect(run(capture("OS-C-AAAAA", { status: "composted" }), capture("OS-C-BBBBB", { status: "new" }))).toEqual([]);
  });
});

describe("OSV005 links", () => {
  const link = (rel: string, id: string) => ({ links: [{ rel, id }] });
  const ids = { c: "OS-C-7K3QX", i: "OS-I-2HD9W", t1: "OS-T-AAAAA", t2: "OS-T-BBBBB", p: "OS-P-0XZ4K", d1: "OS-D-DDDD1", d2: "OS-D-DDDD2" };
  const osv005 = (findings: Finding[]) => findings.filter((f) => f.code === "OSV005");

  it("accepts valid links", () => {
    const findings = run(
      capture(),
      idea(ids.i, link("derived_from", ids.c)),
      project(ids.p),
      task(ids.t1, { links: [{ rel: "belongs_to", id: ids.p }, { rel: "derived_from", id: ids.i }] }),
    );
    expect(osv005(findings)).toEqual([]);
  });

  it("flags a missing target", () => {
    expect(osv005(run(idea(ids.i, link("relates_to", "OS-I-ZZZZZ"))))[0]?.message).toContain("does not exist");
  });

  it("flags disallowed source/target types", () => {
    expect(osv005(run(task(ids.t1, link("promoted_to", ids.p)), project(ids.p)))).toHaveLength(1);
    expect(osv005(run(idea(ids.i, link("derived_from", ids.t1)), task(ids.t1)))).toHaveLength(1);
  });

  it("never lets a link target a proposal", () => {
    expect(osv005(run(idea(ids.i, link("relates_to", "OS-PROP-8V3KD")), proposal()))).toHaveLength(1);
  });

  it("flags self-links and duplicates", () => {
    expect(osv005(run(idea(ids.i, link("relates_to", ids.i))))[0]?.message).toContain("itself");
    const twice = { links: [{ rel: "relates_to", id: ids.p }, { rel: "relates_to", id: ids.p }] };
    expect(osv005(run(idea(ids.i, twice), project(ids.p)))[0]?.message).toContain("Duplicate");
  });

  it("flags relates_to stored on both sides, but allows distinct relationships", () => {
    const both = run(idea(ids.i, link("relates_to", ids.p)), project(ids.p, link("relates_to", ids.i)));
    expect(osv005(both)).toHaveLength(1);
    const distinct = run(idea(ids.i, link("relates_to", ids.p)), project(ids.p), task(ids.t1, link("belongs_to", ids.p)));
    expect(osv005(distinct)).toEqual([]);
  });

  it("flags blocks cycles", () => {
    const findings = run(task(ids.t1, link("blocks", ids.t2)), task(ids.t2, link("blocks", ids.t1)));
    expect(osv005(findings)).toEqual([expect.objectContaining({ message: expect.stringContaining("blocks cycle") })]);
  });

  it("flags supersedes cycles but not chains", () => {
    const chain = run(decision(ids.d1, link("supersedes", ids.d2)), decision(ids.d2));
    expect(osv005(chain)).toEqual([]);
    const cycle = run(decision(ids.d1, link("supersedes", ids.d2)), decision(ids.d2, link("supersedes", ids.d1)));
    expect(osv005(cycle)).toHaveLength(1);
  });

  it("accepts links to composted records", () => {
    const findings = run(capture(ids.c, { status: "composted" }), idea(ids.i, link("derived_from", ids.c)));
    expect(osv005(findings)).toEqual([]);
  });
});

describe("OSV004 lifecycle states that depend on links", () => {
  const promoted = { links: [{ rel: "promoted_to", id: "OS-P-0XZ4K" }] };
  const osv004 = (findings: Finding[]) => findings.filter((f) => f.code === "OSV004");

  it("requires exactly one promoted_to link on a transplanted idea", () => {
    expect(osv004(run(idea("OS-I-2HD9W", { status: "transplanted" })))).toHaveLength(1);
    expect(osv004(run(idea("OS-I-2HD9W", { status: "transplanted", ...promoted }), project("OS-P-0XZ4K")))).toEqual([]);
    const twice = { links: [...promoted.links, { rel: "promoted_to", id: "OS-P-11111" }] };
    expect(osv004(run(idea("OS-I-2HD9W", { status: "transplanted", ...twice }), project("OS-P-0XZ4K"), project("OS-P-11111")))).toHaveLength(1);
  });

  it("allows promoted_to only on a transplanted idea", () => {
    expect(osv004(run(idea("OS-I-2HD9W", { status: "ready", ...promoted }), project("OS-P-0XZ4K")))).toHaveLength(1);
  });

  it("requires a newer decision for SUPERSEDED", () => {
    const old = decision("OS-D-DDDD1", { status: "SUPERSEDED" });
    expect(osv004(run(old))).toHaveLength(1);
    expect(osv004(run(old, decision("OS-D-DDDD2", { links: [{ rel: "supersedes", id: "OS-D-DDDD1" }] })))).toEqual([]);
  });
});

describe("OSV006 capture immutability", () => {
  it("detects an edited body", () => {
    const original = capture();
    const edited: SourceFile = { ...original, content: `${original.content as string}tampered` };
    expect(run(edited)).toEqual([expect.objectContaining({ code: "OSV006", severity: "error" })]);
  });

  it("hashes the stored bytes, including CRLF, emoji and a leading '---'", () => {
    const body = "---\r\n🌱 café \r\n  trailing  \n";
    expect(run(capture("OS-C-7K3QX", {}, body))).toEqual([]);
  });

  it("detects a changed hash", () => {
    expect(codes(run(capture("OS-C-7K3QX", { content_sha256: sha256Hex("other") })))).toEqual(["OSV006"]);
  });

  it("does not apply to other record types", () => {
    expect(codes(run(idea("OS-I-2HD9W", { content_sha256: "0".repeat(64) })))).not.toContain("OSV006");
  });
});

describe("OSV007 ADR template", () => {
  const id = "OS-D-4M9TZ";
  const osv007 = (findings: Finding[]) => findings.filter((f) => f.code === "OSV007");
  const withBody = (body: string, overrides = {}) => decision(id, overrides, body);

  it("accepts a decision that follows the template", () => {
    expect(osv007(run(decision(id)))).toEqual([]);
  });

  it.each([
    ["a missing title heading", adrBody(id, "DRAFT").replace(`# ADR ${id} - Example\n`, "")],
    ["a heading with another ID", adrBody(id, "DRAFT").replace(`# ADR ${id}`, "# ADR OS-D-ZZZZZ")],
    ["a missing Author line", adrBody(id, "DRAFT").replace("* Author: Example\n", "")],
    ["metadata out of order", adrBody(id, "DRAFT").replace("* Date: Oct 25, 2026\n* Status: DRAFT", "* Status: DRAFT\n* Date: Oct 25, 2026")],
    ["a status line that disagrees", adrBody(id, "PROPOSED")],
    ["a missing section", adrBody(id, "DRAFT").replace("## Context\nWhy.\n", "")],
    ["sections out of order", adrBody(id, "DRAFT").replace("## Decision\nDo the thing.\n\n## Context\nWhy.", "## Context\nWhy.\n\n## Decision\nDo the thing.")],
  ])("flags %s as an error", (_label, body) => {
    expect(osv007(run(withBody(body))).filter((f) => f.severity === "error")).not.toEqual([]);
  });

  it("points at the body line", () => {
    const [finding] = osv007(run(withBody(adrBody(id, "PROPOSED"))));
    expect(finding?.line).toBe(13);
  });

  it("requires exactly one selected option once accepted", () => {
    const none = adrBody(id, "ADOPTED").replace(" (SELECTED)", "");
    const errors = (findings: Finding[]) => osv007(findings).filter((f) => f.severity === "error");
    expect(errors(run(withBody(none, { status: "ADOPTED" })))).toEqual([expect.objectContaining({ message: expect.stringContaining("exactly one") })]);
    expect(errors(run(withBody(none.replace("ADOPTED", "DRAFT"))))).toEqual([]);
  });

  it("warns about contradicting consequences, extra sections and a differing title", () => {
    const body = adrBody(id, "DRAFT", { title: "Other" }).replace("Rejected because", "Adopted because").replace("## Advice", "## Notes\n\n## Advice");
    const findings = osv007(run(withBody(body)));
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("requires advice from consulted expert profiles to be marked as simulated", () => {
    const consulted = { links: [{ rel: "consulted", id: "OS-E-SEC01" }] };
    const profile = expert("OS-E-SEC01", { title: "Security Architect" });
    const unmarked = adrBody(id, "DRAFT", { advice: "* Prefer per-file checks - Security Architect, Security, Oct 25, 2026" });
    expect(osv007(run(withBody(unmarked, consulted), profile))).toHaveLength(1);
    const marked = adrBody(id, "DRAFT", { advice: "* Prefer per-file checks - Security Architect (simulated, AI-generated, model), Security, Oct 25, 2026" });
    expect(osv007(run(withBody(marked, consulted), profile))).toEqual([]);
  });

  describe("frozen body", () => {
    const body = adrBody(id, "ACCEPTED");
    const approving = (body_sha256?: string) =>
      proposal("OS-PROP-8V3KD", { status: "applied", consequential: true, operations: [{ op: "set_status", id, base_blob: SHA1, status: "ACCEPTED", ...(body_sha256 ? { body_sha256 } : {}) }] });
    const accepted = (text = body, status = "ACCEPTED") => withBody(text.replace("* Status: ACCEPTED", `* Status: ${status}`), { status, approval: "OS-PROP-8V3KD" });

    it("accepts the approved body, also after a status change", () => {
      expect(osv007(run(accepted(), approving(decisionBodySha256(body))))).toEqual([]);
      expect(osv007(run(accepted(body, "ADOPTED"), approving(decisionBodySha256(body))))).toEqual([]);
    });

    it("detects an edit after acceptance", () => {
      const edited = body.replace("Do the thing.", "Do another thing.");
      expect(osv007(run(accepted(edited), approving(decisionBodySha256(body))))).toEqual([expect.objectContaining({ severity: "error", message: expect.stringContaining("body changed") })]);
    });

    it("requires the approval to record the body hash", () => {
      expect(osv007(run(accepted(), approving()))).toEqual([expect.objectContaining({ message: expect.stringContaining("body_sha256") })]);
    });
  });
});

describe("OSV008 approvals and OSV012 proposal integrity", () => {
  const key = testKey();
  const config = configFile(key);
  const promotion = [
    { op: "set_status", id: "OS-I-2HD9W", base_blob: SHA1, status: "transplanted" },
    { op: "add_link", id: "OS-I-2HD9W", base_blob: SHA1, link: { rel: "promoted_to", id: "OS-P-0XZ4K" } },
  ];
  const transplanted = (overrides = {}) =>
    idea("OS-I-2HD9W", { status: "transplanted", approval: "OS-PROP-8V3KD", links: [{ rel: "promoted_to", id: "OS-P-0XZ4K" }], ...overrides });
  const of = (...wanted: string[]) => (findings: Finding[]) => findings.filter((f) => wanted.includes(f.code));
  const approvals = of("OSV008", "OSV012");

  it("accepts a consequential state with a valid signed approval", () => {
    expect(run(config, transplanted(), project("OS-P-0XZ4K"), signedProposal(key, promotion))).toEqual([]);
  });

  it("accepts approvals signed with a retired key that is still listed", () => {
    const retired = testKey("rei3-2025-01");
    expect(approvals(run(configFile(key, retired), transplanted(), project("OS-P-0XZ4K"), signedProposal(retired, promotion)))).toEqual([]);
  });

  it("requires an approval for a consequential state", () => {
    expect(approvals(run(config, transplanted({ approval: undefined }), project("OS-P-0XZ4K")))).toEqual([
      expect.objectContaining({ code: "OSV008", message: expect.stringContaining("needs an approval") }),
    ]);
  });

  it("rejects a missing, pending or unsigned approving proposal", () => {
    expect(approvals(run(config, transplanted(), project("OS-P-0XZ4K")))[0]?.message).toContain("does not exist");
    expect(codes(approvals(run(config, transplanted(), project("OS-P-0XZ4K"), proposal("OS-PROP-8V3KD", { operations: promotion }))))).toEqual(["OSV008"]);
  });

  it("rejects an approval that does not produce the current state", () => {
    const other = [{ op: "set_status", id: "OS-I-2HD9W", base_blob: SHA1, status: "ready" }];
    expect(approvals(run(config, transplanted(), project("OS-P-0XZ4K"), signedProposal(key, other)))).toEqual([
      expect.objectContaining({ code: "OSV008", message: expect.stringContaining("does not set") }),
    ]);
  });

  it("detects operations changed after approval", () => {
    const tampered = signedProposal(key, promotion, { overrides: { operations: [{ ...promotion[0], id: "OS-I-ZZZZZ" }] } });
    const findings = approvals(run(config, transplanted(), project("OS-P-0XZ4K"), tampered));
    expect(codes(findings).sort()).toEqual(["OSV008", "OSV012"]);
    expect(findings.find((f) => f.code === "OSV012")?.message).toContain("changed after approval");
  });

  it("detects a forged approval and one by an unknown key", () => {
    const forger = testKey();
    expect(approvals(run(config, transplanted(), project("OS-P-0XZ4K"), signedProposal(forger, promotion))).find((f) => f.code === "OSV012")?.message).toContain("does not verify");
    expect(approvals(run(configFile(), transplanted(), project("OS-P-0XZ4K"), signedProposal(key, promotion))).find((f) => f.code === "OSV012")?.message).toContain("not in approval_public_keys");
  });

  it("checks that status and approval agree", () => {
    const pendingWithApproval = signedProposal(key, promotion, { overrides: { status: "pending" } });
    expect(approvals(run(config, pendingWithApproval))[0]?.message).toContain("must not carry");
    expect(approvals(run(config, proposal("OS-PROP-8V3KD", { status: "applied" })))[0]?.message).toContain("needs an approval block");
    const mismatch = signedProposal(key, promotion, { decision: "rejected", overrides: { status: "applied" } });
    expect(approvals(run(config, mismatch))[0]?.message).toContain("does not match status");
    expect(approvals(run(config, signedProposal(key, promotion, { decision: "rejected" })))).toEqual([]);
  });

  it("requires ACCEPTED for ADOPTED decisions and the exact status for SUPERSEDED and EXPIRED", () => {
    const id = "OS-D-4M9TZ";
    const body = adrBody(id, "ADOPTED");
    const accept = [{ op: "set_status", id, base_blob: SHA1, status: "ACCEPTED", body_sha256: decisionBodySha256(body) }];
    const adopted = decision(id, { status: "ADOPTED", approval: "OS-PROP-8V3KD" }, body);
    expect(of("OSV007", "OSV008", "OSV012")(run(config, adopted, signedProposal(key, accept)))).toEqual([]);
    const expired = decision(id, { status: "EXPIRED", approval: "OS-PROP-8V3KD" }, adrBody(id, "EXPIRED"));
    expect(codes(of("OSV008")(run(config, expired, signedProposal(key, accept))))).toEqual(["OSV008"]);
  });

  it("checks a project's approval only when it has one", () => {
    expect(approvals(run(config, project("OS-P-0XZ4K", { status: "archived" })))).toEqual([]);
    expect(codes(approvals(run(config, project("OS-P-0XZ4K", { status: "archived", approval: "OS-PROP-8V3KD" }))))).toEqual(["OSV008"]);
    const archive = [{ op: "set_status", id: "OS-P-0XZ4K", base_blob: SHA1, status: "archived" }];
    expect(approvals(run(config, project("OS-P-0XZ4K", { status: "archived", approval: "OS-PROP-8V3KD" }), signedProposal(key, archive)))).toEqual([]);
  });

  it("reports octosprout.yaml problems", () => {
    expect(run({ path: "octosprout.yaml", content: "workspace_schema_version: 2\nid_prefix: OS\n" })).toEqual([
      expect.objectContaining({ code: "OSV003", path: "octosprout.yaml" }),
    ]);
  });
});

describe("OSV009 task and project contracts", () => {
  const filled = "## Objective\nShip it.\n\n## Acceptance criteria\n- [ ] it ships\n\n## Verification\nRun it.\n";
  const repo = { refs: [{ kind: "repo", url: "https://github.com/bfarkas/x" }] };
  const osv009 = (findings: Finding[]) => findings.filter((f) => f.code === "OSV009");
  const taskWith = (status: string, body: string, overrides = {}) =>
    record("task", "records/tasks", "OS-T-QF81M", { status, ...overrides }, undefined, body);

  it("lets a backlog task have an empty body", () => {
    expect(osv009(run(taskWith("backlog", "")))).toEqual([]);
  });

  it.each(["ready", "in_progress", "done"])("requires the contract sections in %s", (status) => {
    const template = "## Objective\n\n## Acceptance criteria\n\n- [ ] \n\n## Verification\n";
    const messages = osv009(run(taskWith(status, template, repo))).map((f) => f.message);
    expect(messages).toHaveLength(3);
    for (const name of ["Objective", "Acceptance criteria", "Verification"]) {
      expect(messages).toContainEqual(expect.stringContaining(`'## ${name}'`));
    }
    expect(osv009(run(taskWith(status, filled, repo)))).toEqual([]);
  });

  it("warns when no repository is known, unless the project has one", () => {
    expect(osv009(run(taskWith("ready", filled)))).toEqual([expect.objectContaining({ severity: "warning" })]);
    const inProject = taskWith("ready", filled, { links: [{ rel: "belongs_to", id: "OS-P-0XZ4K" }] });
    expect(osv009(run(inProject, project("OS-P-0XZ4K", repo)))).toEqual([]);
  });

  it("requires the brief sections of an active project", () => {
    const brief = "## Goals\nA\n## Non-goals\nB\n## Scope\nC\n## Success criteria\nD\n";
    const active = (body: string) => record("project", "records/projects", "OS-P-0XZ4K", { status: "active" }, undefined, body);
    expect(osv009(run(active(brief)))).toEqual([]);
    expect(osv009(run(active(brief.replace("C\n", ""))))).toEqual([expect.objectContaining({ message: expect.stringContaining("Scope") })]);
  });
});

describe("OSV010 refs", () => {
  const osv010 = (findings: Finding[]) => findings.filter((f) => f.code === "OSV010");
  const withRefs = (...refs: object[]) => idea("OS-I-2HD9W", { refs });

  it("accepts GitHub refs of every kind", () => {
    expect(osv010(run(withRefs(
      { kind: "repo", url: "https://github.com/bfarkas/x" },
      { kind: "pr", url: "https://github.com/bfarkas/x/pull/12", note: "first slice" },
      { kind: "issue", url: "https://github.com/bfarkas/x/issues/3" },
      { kind: "commit", url: "https://github.com/bfarkas/x/commit/4f1c2e9" },
      { kind: "branch", url: "https://github.com/bfarkas/x/tree/main" },
      { kind: "file", url: "https://github.com/bfarkas/x/blob/main/README.md" },
      { kind: "url", url: "https://example.com/paper.pdf" },
    )))).toEqual([]);
  });

  it("reports malformed refs as errors", () => {
    expect(osv010(run(withRefs({ kind: "repo", url: "http://github.com/bfarkas/x" })))).toEqual([expect.objectContaining({ severity: "error" })]);
    expect(osv010(run(withRefs({ kind: "website", url: "https://example.com" })))).toEqual([expect.objectContaining({ severity: "error" })]);
  });

  it("warns about non-GitHub, misshapen and duplicate refs", () => {
    const findings = osv010(run(withRefs(
      { kind: "repo", url: "https://gitlab.com/bfarkas/x" },
      { kind: "pr", url: "https://github.com/bfarkas/x/issues/12" },
      { kind: "url", url: "https://example.com" },
      { kind: "url", url: "https://example.com" },
    )));
    expect(findings.map((f) => f.severity)).toEqual(["warning", "warning", "warning"]);
  });
});

describe("OSV013 possible secrets", () => {
  it("warns with the line and without the secret", () => {
    const body = "Working title\nghp_" + "aB3".repeat(12) + "\n";
    const findings = run(capture("OS-C-7K3QX", {}, body));
    expect(findings).toEqual([expect.objectContaining({ code: "OSV013", severity: "warning", line: 14 })]);
    expect(findings[0]?.message).not.toContain("aB3aB3aB3");
  });
});

describe("OSV011 timestamps", () => {
  it.each([
    ["a non-UTC offset", { created: "2026-10-25T14:03:11+02:00" }],
    ["a date only", { created: "2026-10-25" }],
    ["an impossible date", { created: "2026-02-31T00:00:00Z", updated: "2026-03-01T00:00:00Z" }],
    ["an impossible time", { updated: "2026-10-25T24:00:00Z" }],
    ["updated before created", { updated: "2026-10-25T14:03:10Z" }],
    ["a missing updated", { updated: undefined }],
  ])("flags %s", (_label, overrides) => {
    expect(codes(run(capture("OS-C-7K3QX", overrides)))).toEqual(["OSV011"]);
  });

  it("accepts fractional seconds and equal timestamps", () => {
    expect(run(capture("OS-C-7K3QX", { created: "2026-10-25T14:03:11.250Z", updated: "2026-10-25T14:03:11.250Z" }))).toEqual([]);
  });

  it("parseTimestamp handles leap days", () => {
    expect(parseTimestamp("2028-02-29T00:00:00Z")).toBeDefined();
    expect(parseTimestamp("2026-02-29T00:00:00Z")).toBeUndefined();
  });
});

describe("findings", () => {
  it("are sorted and carry code, severity, path, line, id, message and hint", () => {
    const findings = run(capture("OS-C-AAAAA", { color: "green" }), capture("OS-C-BBBBB", { status: "seed" }));
    expect(findings.map((f) => f.path)).toEqual([...findings.map((f) => f.path)].sort());
    for (const f of findings) {
      expect(f).toMatchObject({ code: expect.stringMatching(/^OSV\d{3}$/), severity: expect.any(String), id: expect.any(String), hint: expect.any(String) });
    }
  });

  it("round-trips a rendered record through the validator", () => {
    const body = "text";
    const content = renderRecord(
      { id: "OS-C-7K3QX", type: "capture", schema_version: 1, status: "new", created: "2026-10-25T14:03:11Z", updated: "2026-10-25T14:03:11Z", source: "web", idempotency_key: "abcdefgh", received_via: "web-session", content_sha256: sha256Hex(body) },
      body,
    );
    expect(run({ path: "records/captures/2026/10/OS-C-7K3QX.md", content })).toEqual([]);
  });
});
