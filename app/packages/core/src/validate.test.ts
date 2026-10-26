import { describe, expect, it } from "vitest";

import { capture, decision, expert, idea, project, proposal, record, research, task } from "./fixtures.js";
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
