/**
 * Record types, type codes and lifecycle vocabularies (spec §6.1, §6.2, §7).
 */

export const RECORD_TYPES = [
  "capture",
  "idea",
  "task",
  "project",
  "decision",
  "research",
  "expert",
  "proposal",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

/** ID type code for each private record type (spec §6.1). */
export const TYPE_CODES = {
  capture: "C",
  idea: "I",
  task: "T",
  project: "P",
  decision: "D",
  research: "R",
  expert: "E",
  proposal: "PROP",
} as const satisfies Record<RecordType, string>;

export type TypeCode = (typeof TYPE_CODES)[RecordType];

/** Type codes reserved for the post-MVP public library (`OSL-` prefix, spec §6.1). */
export const LIBRARY_TYPE_CODES = [
  "SKILL",
  "EXPERT",
  "TEMPLATE",
  "SCHEMA",
  "EXAMPLE",
  "GUIDE",
] as const;

export type LibraryTypeCode = (typeof LIBRARY_TYPE_CODES)[number];

/** Allowed `status` values per type (spec §7). */
export const STATUSES = {
  capture: ["new", "planted", "composted"],
  idea: ["seed", "sprouting", "ready", "dormant", "transplanted", "composted"],
  task: ["backlog", "ready", "in_progress", "blocked", "done", "archived"],
  project: ["proposed", "active", "on_hold", "completed", "archived"],
  decision: ["DRAFT", "PROPOSED", "ACCEPTED", "ADOPTED", "SUPERSEDED", "EXPIRED"],
  research: ["open", "concluded"],
  expert: ["active", "retired"],
  proposal: ["pending", "applied", "rejected", "stale"],
} as const satisfies Record<RecordType, readonly string[]>;

export type Status<T extends RecordType = RecordType> = (typeof STATUSES)[T][number];

/** The current `schema_version` for every type (spec §6.2). */
export const CURRENT_SCHEMA_VERSION = 1;

/** Pinned upstream ADR template (spec §13.1). */
export const ADR_TEMPLATE_PIN =
  "harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772";
