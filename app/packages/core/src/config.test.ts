import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { formatPublicKey } from "./approvals.js";
import { parseWorkspaceConfig, withApprovalKeys } from "./config.js";

const key = formatPublicKey(generateKeyPairSync("ed25519").publicKey);

describe("parseWorkspaceConfig", () => {
  it("reads keys and the bulk threshold", () => {
    const { config, problems } = parseWorkspaceConfig(
      `workspace_schema_version: 1\nid_prefix: OS\napproval_public_keys:\n  - id: rei3-2026-10\n    key: "${key}"\n  - id: old\n    key: "${key}"\n    status: retired\nconsequential:\n  bulk_threshold: 5\n`,
    );
    expect(problems).toEqual([]);
    expect(config.bulkThreshold).toBe(5);
    expect(config.approvalKeys.map((k) => [k.id, k.status])).toEqual([["rei3-2026-10", "active"], ["old", "retired"]]);
  });

  it("defaults the threshold and accepts an empty key list", () => {
    const { config, problems } = parseWorkspaceConfig("workspace_schema_version: 1\nid_prefix: OS\napproval_public_keys: []\n");
    expect(problems).toEqual([]);
    expect(config).toMatchObject({ bulkThreshold: 10, approvalKeys: [] });
  });

  it("reports problems with their line and keeps the usable keys", () => {
    const { config, problems } = parseWorkspaceConfig(
      `workspace_schema_version: 1\nid_prefix: OS\ncolour: green\napproval_public_keys:\n  - id: a\n    key: "${key}"\n  - id: a\n    key: "${key}"\n  - id: b\n    key: "ed25519:AAAA"\n`,
    );
    expect(config.approvalKeys.map((k) => k.id)).toEqual(["a"]);
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining("colour") }),
      expect.objectContaining({ message: expect.stringContaining("listed twice"), line: 7 }),
      expect.objectContaining({ message: expect.stringContaining("not a valid Ed25519"), line: 9 }),
    ]));
  });

  it("reports invalid YAML", () => {
    expect(parseWorkspaceConfig("a: [\n").problems).toEqual([expect.objectContaining({ message: expect.stringContaining("Invalid YAML") })]);
  });
});

describe("withApprovalKeys", () => {
  it("sets the keys and keeps comments and other settings", () => {
    const text = withApprovalKeys("workspace_schema_version: 1\nid_prefix: OS\napproval_public_keys: []       # trusted keys\nconsequential:\n  bulk_threshold: 5\n", [{ id: "server-1", key }]);
    expect(text).toContain("bulk_threshold: 5");
    const { config, problems } = parseWorkspaceConfig(text);
    expect(problems).toEqual([]);
    expect(config.approvalKeys.map((k) => k.id)).toEqual(["server-1"]);
    expect(parseWorkspaceConfig(withApprovalKeys(undefined, [{ id: "server-1", key }])).problems).toEqual([]);
  });
});
