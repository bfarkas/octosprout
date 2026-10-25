/**
 * Relationship rules (spec §6.3).
 */
import type { RecordType } from "./types.js";

export const LINK_RELS = [
  "relates_to",
  "belongs_to",
  "derived_from",
  "promoted_to",
  "blocks",
  "supersedes",
  "supports",
  "implements",
  "consulted",
] as const;

export type LinkRel = (typeof LINK_RELS)[number];

export interface Link {
  rel: LinkRel;
  id: string;
}

/** Allowed `source type -> target types` per relationship. `undefined` means any. */
export const LINK_RULES: Record<LinkRel, Partial<Record<RecordType, readonly RecordType[]>> | undefined> = {
  relates_to: undefined,
  belongs_to: { task: ["project"], decision: ["project"], research: ["project"] },
  derived_from: {
    idea: ["capture"],
    task: ["capture", "idea"],
    research: ["capture"],
  },
  promoted_to: { idea: ["project"] },
  blocks: { task: ["task"] },
  supersedes: { decision: ["decision"] },
  supports: { research: ["idea", "project", "decision", "task"] },
  implements: { task: ["decision"] },
  consulted: { decision: ["expert"] },
};

/** Proposals are referenced by `approval` only, never by links. */
export function isLinkAllowed(rel: LinkRel, source: RecordType, target: RecordType): boolean {
  if (target === "proposal") return false;
  const rule = LINK_RULES[rel];
  if (rule === undefined) return true;
  return rule[source]?.includes(target) ?? false;
}

export function isLinkRel(value: unknown): value is LinkRel {
  return typeof value === "string" && (LINK_RELS as readonly string[]).includes(value);
}
