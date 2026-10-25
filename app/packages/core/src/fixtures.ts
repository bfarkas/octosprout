/** Builders for validator tests. */
import { renderRecord, sha256Hex, type Frontmatter } from "./record.js";
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

/** A record type that has no schema yet (Phase 2), for link and lifecycle tests. */
export function record(
  type: string,
  dir: string,
  id: string,
  overrides: Frontmatter = {},
  path = `${dir}/${id}--example.md`,
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
        ...overrides,
      },
      "",
    ),
  };
}

export const idea = (id: string, overrides: Frontmatter = {}) => record("idea", "records/ideas", id, overrides);
export const task = (id: string, overrides: Frontmatter = {}) => record("task", "records/tasks", id, overrides);
export const project = (id: string, overrides: Frontmatter = {}) => record("project", "records/projects", id, overrides);
export const decision = (id: string, overrides: Frontmatter = {}) => record("decision", "records/decisions", id, overrides);
