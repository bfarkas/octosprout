/**
 * Builds a capture record file from an inbox request (spec §6.5, §15.3).
 */
import { renderRecord, sha256Hex, type Frontmatter } from "@octosprout/core";

import type { InboxRequest } from "./request.js";

export interface BuiltCapture {
  id: string;
  /** Workspace-relative path: `records/captures/YYYY/MM/<ID>.md`. */
  path: string;
  content: string;
}

/** `YYYY-MM-DDTHH:MM:SSZ` in UTC. */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function capturePath(id: string, receivedAt: Date): string {
  const iso = receivedAt.toISOString();
  return `records/captures/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${id}.md`;
}

/**
 * The body is the submitted text, verbatim; `content_sha256` covers exactly the
 * stored bytes. Year and month come from the server receive time in UTC.
 */
export function buildCapture(request: InboxRequest, context: { id: string; receivedAt: Date; receivedVia: string }): BuiltCapture {
  const timestamp = formatTimestamp(context.receivedAt);
  const frontmatter: Frontmatter = {
    id: context.id,
    type: "capture",
    schema_version: 1,
    status: "new",
    created: timestamp,
    updated: timestamp,
    source: request.source,
    ...(request.sourceDetail !== undefined ? { source_detail: request.sourceDetail } : {}),
    ...(request.sourceUrl !== undefined ? { source_url: request.sourceUrl } : {}),
    idempotency_key: request.idempotencyKey,
    received_via: context.receivedVia,
    ...(request.clientCreatedAt !== undefined ? { client_created_at: request.clientCreatedAt } : {}),
    content_sha256: sha256Hex(request.text),
  };
  return {
    id: context.id,
    path: capturePath(context.id, context.receivedAt),
    content: renderRecord(frontmatter, request.text),
  };
}
