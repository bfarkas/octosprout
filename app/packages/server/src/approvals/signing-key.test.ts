import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseWorkspaceConfig } from "@octosprout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateSigningKeyFile, keyEntry, loadSigningKey } from "./signing-key.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "octosprout-key-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the approval signing key", () => {
  it("is generated as a private PEM file and loads back with the same ID", () => {
    const file = join(dir, "approval_signing_key");
    const key = generateSigningKeyFile(file);
    expect(readFileSync(file, "utf8")).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(key.id).toMatch(/^server-[0-9a-f]{8}$/);
    expect(loadSigningKey(file)).toMatchObject({ id: key.id, publicKey: key.publicKey });
    expect(() => generateSigningKeyFile(file)).toThrow(/EEXIST/);
  });

  it("prints an entry octosprout.yaml accepts", () => {
    const key = generateSigningKeyFile(join(dir, "k"));
    const { config, problems } = parseWorkspaceConfig(`workspace_schema_version: 1\nid_prefix: OS\napproval_public_keys:\n${keyEntry(key)}`);
    expect(problems).toEqual([]);
    expect(config.approvalKeys.map((k) => k.id)).toEqual([key.id]);
  });
});
