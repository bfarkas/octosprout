/** Builders for validator tests. */
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
export const decision = (id: string, overrides: Frontmatter = {}) => record("decision", "records/decisions", id, overrides);
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
