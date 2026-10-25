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
