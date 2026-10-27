/**
 * Lifecycle transitions (spec §7) and the status-change rules shared by the
 * server, the CLI and the MCP server.
 */
import { setAdrStatusLine } from "./adr.js";
import type { Link } from "./links.js";
import { parseRecord, setFrontmatterScalars } from "./record.js";
import { STATUSES, type RecordType } from "./types.js";

type TransitionTable = { [T in RecordType]: { readonly [From in (typeof STATUSES)[T][number]]: readonly (typeof STATUSES)[T][number][] } };

/** Every move to every other status. */
function anyToAny<S extends string>(statuses: readonly S[]): { readonly [From in S]: readonly S[] } {
  return Object.fromEntries(statuses.map((from) => [from, statuses.filter((to) => to !== from)])) as { [From in S]: S[] };
}

/** Allowed moves per type and status (§7, boards.md §2). */
export const TRANSITIONS: TransitionTable = {
  capture: {
    new: ["planted", "composted"],
    planted: [],
    composted: ["new"],
  },
  idea: {
    seed: ["sprouting", "dormant", "composted"],
    sprouting: ["ready", "dormant", "composted"],
    ready: ["sprouting", "dormant", "composted", "transplanted"],
    dormant: ["seed", "sprouting", "ready"],
    transplanted: [],
    composted: ["seed"],
  },
  task: anyToAny(STATUSES.task),
  project: anyToAny(STATUSES.project),
  decision: {
    DRAFT: ["PROPOSED"],
    PROPOSED: ["DRAFT", "ACCEPTED"],
    ACCEPTED: ["ADOPTED", "SUPERSEDED", "EXPIRED"],
    ADOPTED: ["SUPERSEDED", "EXPIRED"],
    SUPERSEDED: [],
    EXPIRED: [],
  },
  research: anyToAny(STATUSES.research),
  expert: anyToAny(STATUSES.expert),
  // Only the server moves proposals, when it applies, rejects or re-checks them.
  proposal: {
    pending: ["applied", "rejected", "stale"],
    applied: [],
    rejected: [],
    stale: ["rejected"],
  },
};

export function allowedTargets(type: RecordType, from: string): readonly string[] {
  return (TRANSITIONS[type] as Record<string, readonly string[] | undefined>)[from] ?? [];
}

export function isAllowedTransition(type: RecordType, from: string, to: string): boolean {
  return allowedTargets(type, from).includes(to);
}

/**
 * How an allowed move is made:
 * - `direct`: a routine status write;
 * - `approval`: consequential (§9.2), committed with a signed approval after passkey re-verification;
 * - `promotion`: only through the promotion workflow (§10);
 * - `triage`: only by triaging the capture into a record that derives from it (§7.1);
 * - `server`: proposals, moved only by the server.
 */
export type MoveKind = "direct" | "approval" | "promotion" | "triage" | "server";

export function moveKind(type: RecordType, from: string, to: string): MoveKind {
  if (type === "proposal") return "server";
  if (type === "capture" && to === "planted") return "triage";
  if (type === "idea" && to === "transplanted") return "promotion";
  if (type === "decision" && (to === "ACCEPTED" || to === "SUPERSEDED" || to === "EXPIRED")) return "approval";
  if (type === "project" && from === "active" && (to === "completed" || to === "archived")) return "approval";
  return "direct";
}

/**
 * Rewrites a record's status and `updated`, and for a decision its body's
 * `* Status:` line. Everything else in the file is kept byte for byte.
 */
export function rewriteStatus(text: string, to: string, updated: string): string {
  const parsed = parseRecord(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const rewritten = setFrontmatterScalars(text, { status: to, updated });
  if (parsed.record.frontmatter.type !== "decision") return rewritten;
  const body = parsed.record.body;
  return rewritten.slice(0, rewritten.length - body.length) + setAdrStatusLine(body, to);
}

// ---------------------------------------------------------------------------
// Blocking (§7.3)

/** What the blocking rules need to know about a task. */
export interface TaskSummary {
  id: string;
  status: string;
  links: readonly Link[];
}

const CLOSED = new Set(["done"]);

/** Tasks that `blocks` the given task and are not done. */
export function openBlockers(taskId: string, tasks: readonly TaskSummary[]): string[] {
  return tasks
    .filter((t) => !CLOSED.has(t.status) && t.links.some((l) => l.rel === "blocks" && l.id === taskId))
    .map((t) => t.id);
}

/**
 * The tasks that move to `ready` together with `taskId` moving to `done`:
 * those whose status is `blocked` and whose only open blocker is `taskId`.
 */
export function unblockedBy(taskId: string, tasks: readonly TaskSummary[]): string[] {
  const blocker = tasks.find((t) => t.id === taskId);
  if (!blocker) return [];
  const targets = blocker.links.filter((l) => l.rel === "blocks").map((l) => l.id);
  return [...new Set(targets)].filter((id) => {
    const task = tasks.find((t) => t.id === id);
    if (task?.status !== "blocked") return false;
    const open = openBlockers(id, tasks);
    return open.length === 1 && open[0] === taskId;
  });
}
