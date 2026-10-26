/** Builders for validator tests. */
import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { formatPublicKey, signApproval, type ApprovalDecision } from "./approvals.js";
import { renderRecord, sha256Hex, type Frontmatter } from "./record.js";
import { ADR_TEMPLATE_PIN } from "./types.js";
import type { SourceFile } from "./validate.js";

export function capture(
  id = "OS-C-7K3QX",
  overrides: Frontmatter = {},
  body = "Working title: Garden metaphor\n",
  path = `records/captures/2026/10/${id}.md`,
): SourceFile {
  return {
    path,
    content: renderRecord(
      {
        id,
        type: "capture",
        schema_version: 1,
        status: "new",
        created: "2026-10-25T14:03:11Z",
        updated: "2026-10-25T14:03:11Z",
        source: "chatgpt",
        idempotency_key: "20261025T140310-48213",
        received_via: "token:iphone-shortcut",
        content_sha256: sha256Hex(body),
        ...overrides,
      },
      body,
    ),
  };
}

/** A titled record with the minimum valid frontmatter for its type. */
export function record(
  type: string,
  dir: string,
  id: string,
  overrides: Frontmatter = {},
  path = `${dir}/${id}--example.md`,
  body = "",
): SourceFile {
  return {
    path,
    content: renderRecord(
      {
        id,
        type,
        schema_version: 1,
        title: "Example",
        status: { idea: "seed", task: "backlog", project: "proposed", decision: "DRAFT", research: "open", expert: "active" }[type],
        created: "2026-10-25T15:00:00Z",
        updated: "2026-10-25T15:00:00Z",
        ...(type === "decision" ? { template: ADR_TEMPLATE_PIN } : {}),
        ...overrides,
      },
      body,
    ),
  };
}

export const idea = (id: string, overrides: Frontmatter = {}) => record("idea", "records/ideas", id, overrides);
export const task = (id: string, overrides: Frontmatter = {}) => record("task", "records/tasks", id, overrides);
export const project = (id: string, overrides: Frontmatter = {}) => record("project", "records/projects", id, overrides);
export const decision = (id: string, overrides: Frontmatter = {}, body?: string) =>
  record("decision", "records/decisions", id, overrides, undefined, body ?? adrBody(id, String(overrides.status ?? "DRAFT")));

/** A decision body that follows the ADR template, with option 1 selected. */
export function adrBody(id: string, status: string, { title = "Example", advice = "* None recorded." } = {}): string {
  return [
    `# ADR ${id} - ${title}`,
    "* Date: Oct 25, 2026",
    `* Status: ${status}`,
    "* Author: Example",
    "",
    "## Decision",
    "Do the thing.",
    "",
    "## Context",
    "Why.",
    "",
    "## Options Considered",
    "### Option 1 (SELECTED): The thing",
    "#### Consequences",
    " * Adopted because: it works",
    " * Adopted despite: it costs",
    "",
    "### Option 2: Another thing",
    "#### Consequences",
    " * Rejected because: it does not",
    "",
    "## Advice",
    ` ${advice}`,
    "",
    "## Supporting Material",
    " * None",
    "",
  ].join("\n");
}
export const research = (id: string, overrides: Frontmatter = {}) => record("research", "records/research", id, overrides);
export const expert = (id: string, overrides: Frontmatter = {}) => record("expert", "experts", id, overrides);

export const SHA1 = "4f1c2e9a0b7d3c5e6f8091a2b3c4d5e6f7a8b9c0";

/** A pending proposal with one `set_status` operation. */
export function proposal(id = "OS-PROP-8V3KD", overrides: Frontmatter = {}, body = "## Rationale\n"): SourceFile {
  return {
    path: `proposals/2026/10/${id}.md`,
    content: renderRecord(
      {
        id,
        type: "proposal",
        schema_version: 1,
        status: "pending",
        title: "Example proposal",
        created: "2026-10-25T15:00:00Z",
        updated: "2026-10-25T15:00:00Z",
        origin: { actor: "agent:claude-code" },
        base_commit: SHA1,
        consequential: false,
        operations: [{ op: "set_status", id: "OS-I-2HD9W", base_blob: SHA1, status: "sprouting" }],
        ...overrides,
      },
      body,
    ),
  };
}

/** A test signing key, as the server holds it. */
export interface TestKey {
  id: string;
  privateKey: KeyObject;
}

export function testKey(id = "rei3-2026-10"): TestKey {
  return { id, privateKey: generateKeyPairSync("ed25519").privateKey };
}

/** `octosprout.yaml` trusting the given keys. */
export function configFile(...keys: TestKey[]): SourceFile {
  const list = keys.map((k) => `  - id: ${k.id}\n    key: "${formatPublicKey(k.privateKey)}"\n`).join("");
  return {
    path: "octosprout.yaml",
    content: `workspace_schema_version: 1\nid_prefix: OS\napproval_public_keys:${keys.length ? `\n${list}` : " []\n"}`,
  };
}

/** A proposal applied (or rejected) by the server, with a signed approval. */
export function signedProposal(
  key: TestKey,
  operations: object[],
  { id = "OS-PROP-8V3KD", decision = "approved" as ApprovalDecision, overrides = {} as Frontmatter } = {},
): SourceFile {
  const at = "2026-10-25T15:07:42Z";
  return proposal(id, {
    status: decision === "approved" ? "applied" : "rejected",
    consequential: true,
    updated: at,
    operations,
    approval: { ...signApproval(id, operations, decision, at, key) },
    ...overrides,
  });
}
