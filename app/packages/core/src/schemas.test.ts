import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SchemaRegistry } from "./schemas.js";

const registry = new SchemaRegistry();
const validateCapture = registry.get("capture", 1)!;

const body = "Working title: Garden metaphor for OctoSprout statuses\n";

// Spec Appendix A capture example.
const capture = {
  id: "OS-C-7K3QX",
  type: "capture",
  schema_version: 1,
  status: "new",
  created: "2026-10-25T14:03:11Z",
  updated: "2026-10-25T14:03:11Z",
  source: "chatgpt",
  source_url: "https://chatgpt.com/share/abc123",
  idempotency_key: "20261025T140310-48213",
  received_via: "token:iphone-shortcut",
  content_sha256: createHash("sha256").update(body, "utf8").digest("hex"),
};

describe("capture.v1 schema", () => {
  it("accepts the spec example", () => {
    expect(validateCapture(capture), JSON.stringify(validateCapture.errors)).toBe(true);
  });

  it("preserves x- keys", () => {
    expect(validateCapture({ ...capture, "x-board": { lane: 2 } })).toBe(true);
  });

  it.each([
    ["an unknown key", { ...capture, color: "green" }],
    ["a non-capture ID", { ...capture, id: "OS-I-7K3QX" }],
    ["a missing content_sha256", { ...capture, content_sha256: undefined }],
    ["an http source_url", { ...capture, source_url: "http://example.com" }],
    ["a short idempotency_key", { ...capture, idempotency_key: "abc" }],
    ["a non-UTC timestamp", { ...capture, created: "2026-10-25T14:03:11+02:00" }],
    ["an unknown status", { ...capture, status: "seed" }],
    ["an unknown source", { ...capture, source: "telegram" }],
    ["a bad link rel", { ...capture, links: [{ rel: "parent_of", id: "OS-I-2HD9W" }] }],
  ])("rejects %s", (_label, record) => {
    const clean = Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
    expect(validateCapture(clean)).toBe(false);
  });

  it("has no validator for unsupported versions", () => {
    expect(registry.get("capture", 2)).toBeUndefined();
  });
});

const base = { schema_version: 1, title: "Example", created: "2026-10-25T15:00:00Z", updated: "2026-10-25T15:00:00Z" };
const titled = {
  idea: { ...base, id: "OS-I-2HD9W", type: "idea", status: "transplanted", approval: "OS-PROP-8V3KD", links: [{ rel: "promoted_to", id: "OS-P-0XZ4K" }] },
  task: { ...base, id: "OS-T-QF81M", type: "task", status: "in_progress", refs: [{ kind: "repo", url: "https://github.com/bfarkas/x" }] },
  project: { ...base, id: "OS-P-0XZ4K", type: "project", status: "on_hold", tags: ["memory"] },
  decision: { ...base, id: "OS-D-4M9TZ", type: "decision", status: "ACCEPTED", template: "harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772" },
  research: { ...base, id: "OS-R-B7N2C", type: "research", status: "concluded" },
  expert: { ...base, id: "OS-E-SEC01", type: "expert", status: "retired" },
} as const;

describe.each(Object.entries(titled))("%s.v1 schema", (type, example) => {
  const validate = registry.get(type as keyof typeof titled, 1)!;

  it("accepts a valid record", () => {
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...example, "x-board": { lane: 1 } })).toBe(true);
  });

  it.each([
    ["a missing title", { title: undefined }],
    ["an over-long title", { title: "x".repeat(201) }],
    ["an unknown key", { color: "green" }],
    ["another type's ID", { id: "OS-C-7K3QX" }],
    ["another type's status", { status: "pending" }],
    ["a malformed approval", { approval: "OS-I-2HD9W" }],
  ])("rejects %s", (_label, overrides) => {
    const record = Object.fromEntries(Object.entries({ ...example, ...overrides }).filter(([, v]) => v !== undefined));
    expect(validate(record)).toBe(false);
  });
});

describe("decision.v1 template pin", () => {
  const validate = registry.get("decision", 1)!;
  it.each([undefined, "harmel-law-adr@main", "other@1775d49516784bee6824fcd02556926121a7e772"])("rejects %s", (template) => {
    const record = Object.fromEntries(Object.entries({ ...titled.decision, template }).filter(([, v]) => v !== undefined));
    expect(validate(record)).toBe(false);
  });
});

describe("proposal.v1 schema", () => {
  const validate = registry.get("proposal", 1)!;
  const sha = "4f1c2e9a0b7d3c5e6f8091a2b3c4d5e6f7a8b9c0";
  const link = { rel: "promoted_to", id: "OS-P-0XZ4K" };
  const proposal = {
    id: "OS-PROP-8V3KD",
    type: "proposal",
    schema_version: 1,
    status: "applied",
    title: "Promote OS-I-2HD9W to a project",
    created: "2026-10-25T15:00:00Z",
    updated: "2026-10-25T15:07:42Z",
    origin: { actor: "agent:claude-code", session: "free text" },
    base_commit: sha,
    consequential: true,
    operations: [
      { op: "create", path: "records/projects/OS-P-0XZ4K--memory.md", content: "---\nid: OS-P-0XZ4K\n" },
      { op: "update", id: "OS-T-QF81M", base_blob: sha, content: "---\n" },
      { op: "update", path: "AGENTS.md", base_blob: sha, content: "# Agents\n" },
      { op: "set_status", id: "OS-I-2HD9W", base_blob: sha, status: "transplanted" },
      { op: "set_status", id: "OS-D-4M9TZ", base_blob: sha, status: "ACCEPTED", body_sha256: "a".repeat(64) },
      { op: "add_link", id: "OS-I-2HD9W", base_blob: sha, link },
      { op: "remove_link", id: "OS-I-2HD9W", base_blob: sha, link },
      { op: "delete", path: ".github/workflows/old.yml", base_blob: sha },
    ],
    approval: { decision: "approved", at: "2026-10-25T15:07:42Z", key_id: "rei3-2026-10", ops_sha256: "b".repeat(64), signature: "ed25519:AAAA+/==" },
  };

  it("accepts the spec example with every operation kind", () => {
    expect(validate(proposal), JSON.stringify(validate.errors)).toBe(true);
  });

  const op = (operation: object) => ({ ...proposal, operations: [operation] });
  it.each([
    ["no operations", { ...proposal, operations: [] }],
    ["an unknown operation", op({ op: "rename", id: "OS-I-2HD9W" })],
    ["a set_status without base_blob", op({ op: "set_status", id: "OS-I-2HD9W", status: "ready" })],
    ["an update naming both id and path", op({ op: "update", id: "OS-T-QF81M", path: "a.md", base_blob: sha, content: "" })],
    ["a delete naming neither id nor path", op({ op: "delete", base_blob: sha })],
    ["a path that escapes the workspace", op({ op: "create", path: "../outside.md", content: "" })],
    ["an absolute path", op({ op: "create", path: "/etc/passwd", content: "" })],
    ["a path inside .git", op({ op: "create", path: ".git/hooks/pre-push", content: "" })],
    ["a short base_blob", op({ op: "delete", id: "OS-T-QF81M", base_blob: "abc123" })],
    ["a link to a malformed ID", op({ op: "add_link", id: "OS-I-2HD9W", base_blob: sha, link: { rel: "relates_to", id: "nope" } })],
    ["an unknown actor", { ...proposal, origin: { actor: "root" } }],
    ["a missing origin", { ...proposal, origin: undefined }],
    ["an approval without a signature", { ...proposal, approval: { ...proposal.approval, signature: undefined } }],
    ["an unknown approval decision", { ...proposal, approval: { ...proposal.approval, decision: "maybe" } }],
    ["links", { ...proposal, links: [link] }],
  ])("rejects %s", (_label, record) => {
    expect(validate(JSON.parse(JSON.stringify(record)))).toBe(false);
  });
});
