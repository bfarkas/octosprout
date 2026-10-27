/**
 * Workspace configuration, `octosprout.yaml` (spec §5.3).
 */
import type { KeyObject } from "node:crypto";

import { LineCounter, parseDocument } from "yaml";

import { parsePublicKey } from "./approvals.js";
import { SchemaRegistry } from "./schemas.js";

export const CONFIG_PATH = "octosprout.yaml";

/** Defaults from spec §9.2. */
export const DEFAULT_BULK_THRESHOLD = 10;

export interface WorkspaceConfig {
  bulkThreshold: number;
  /** The `* Author:` of new decisions, if set. */
  author?: string;
  approvalKeys: Array<{ id: string; key: KeyObject; status: "active" | "retired" }>;
}

export interface ConfigProblem {
  message: string;
  line?: number;
}

export const DEFAULT_CONFIG: WorkspaceConfig = { bulkThreshold: DEFAULT_BULK_THRESHOLD, approvalKeys: [] };

/**
 * Reads `octosprout.yaml`. Problems are reported, and whatever is usable is
 * still returned, so that one bad key does not distrust the others.
 */
export function parseWorkspaceConfig(text: string, schemas: SchemaRegistry = new SchemaRegistry()): { config: WorkspaceConfig; problems: ConfigProblem[] } {
  const problems: ConfigProblem[] = [];
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, version: "1.2", schema: "core" });
  if (doc.errors.length > 0) {
    const error = doc.errors[0]!;
    return { config: DEFAULT_CONFIG, problems: [{ message: `Invalid YAML: ${error.message.split("\n")[0]}`, ...(error.linePos ? { line: error.linePos[0].line } : {}) }] };
  }
  const data = doc.toJS() as unknown;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { config: DEFAULT_CONFIG, problems: [{ message: "octosprout.yaml must be a YAML mapping.", line: 1 }] };
  }

  const lineOf = (path: readonly (string | number)[]): number | undefined => {
    const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
    return node?.range ? lineCounter.linePos(node.range[0]).line : undefined;
  };

  const validate = schemas.get("workspace", 1)!;
  if (!validate(data)) {
    for (const error of validate.errors ?? []) {
      const path = error.instancePath.split("/").slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
      const where = path.length === 0 ? "octosprout.yaml" : `'${path.join(".")}'`;
      const extra = error.keyword === "additionalProperties" ? ` ('${String((error.params as { additionalProperty: string }).additionalProperty)}')` : "";
      const line = lineOf(path);
      problems.push({ message: `${where} ${error.message ?? "is invalid"}${extra}.`, ...(line ? { line } : {}) });
    }
  }

  const fields = data as { approval_public_keys?: unknown; consequential?: { bulk_threshold?: unknown }; author?: unknown };
  const approvalKeys: WorkspaceConfig["approvalKeys"] = [];
  const seen = new Set<string>();
  (Array.isArray(fields.approval_public_keys) ? fields.approval_public_keys : []).forEach((entry: unknown, i) => {
    const { id, key, status } = (entry ?? {}) as { id?: unknown; key?: unknown; status?: unknown };
    if (typeof id !== "string" || typeof key !== "string") return;
    const line = lineOf(["approval_public_keys", i]);
    if (seen.has(id)) {
      problems.push({ message: `Approval key id '${id}' is listed twice.`, ...(line ? { line } : {}) });
      return;
    }
    seen.add(id);
    const parsed = parsePublicKey(key);
    if (!parsed) {
      problems.push({ message: `Approval key '${id}' is not a valid Ed25519 public key.`, ...(line ? { line } : {}) });
      return;
    }
    approvalKeys.push({ id, key: parsed, status: status === "retired" ? "retired" : "active" });
  });

  const threshold = fields.consequential?.bulk_threshold;
  const bulkThreshold = Number.isInteger(threshold) && (threshold as number) >= 1 ? (threshold as number) : DEFAULT_BULK_THRESHOLD;
  const author = typeof fields.author === "string" && fields.author.trim() !== "" ? fields.author.trim() : undefined;
  return { config: { bulkThreshold, approvalKeys, ...(author ? { author } : {}) }, problems };
}

/** Starter content for a workspace without octosprout.yaml. */
const MINIMAL_CONFIG = "workspace_schema_version: 1\nid_prefix: OS\n";

/**
 * octosprout.yaml with `approval_public_keys` set to `keys`; the other
 * settings and their comments are kept. Starts from a minimal file if there
 * is none.
 */
export function withApprovalKeys(text: string | undefined, keys: ReadonlyArray<{ id: string; key: string; status?: "active" | "retired" }>): string {
  const doc = parseDocument(text ?? MINIMAL_CONFIG, { version: "1.2", schema: "core" });
  doc.set("approval_public_keys", keys.map((k) => ({ ...k })));
  return doc.toString({ lineWidth: 0 });
}
