import { describe, expect, it } from "vitest";

import { adrStatusLine } from "./adr.js";
import { adrBody } from "./fixtures.js";
import { allowedTargets, isAllowedTransition, moveKind, openBlockers, rewriteStatus, TRANSITIONS, unblockedBy, type TaskSummary } from "./lifecycle.js";
import { parseRecord, setFrontmatterScalars } from "./record.js";
import { STATUSES, type RecordType } from "./types.js";

describe("transition table", () => {
  it("covers every status of every type, and only those", () => {
    for (const type of Object.keys(STATUSES) as RecordType[]) {
      const statuses: readonly string[] = STATUSES[type];
      expect(Object.keys(TRANSITIONS[type]).sort()).toEqual([...statuses].sort());
      for (const from of statuses) {
        for (const to of allowedTargets(type, from)) {
          expect(statuses).toContain(to);
          expect(to).not.toBe(from);
        }
      }
    }
  });

  const allowed: Array<[RecordType, string, string[]]> = [
    ["idea", "seed", ["sprouting", "dormant", "composted"]],
    ["idea", "sprouting", ["ready", "dormant", "composted"]],
    ["idea", "ready", ["sprouting", "dormant", "composted", "transplanted"]],
    ["idea", "dormant", ["seed", "sprouting", "ready"]],
    ["idea", "composted", ["seed"]],
    ["idea", "transplanted", []],
    ["decision", "DRAFT", ["PROPOSED"]],
    ["decision", "PROPOSED", ["DRAFT", "ACCEPTED"]],
    ["decision", "ACCEPTED", ["ADOPTED", "SUPERSEDED", "EXPIRED"]],
    ["decision", "ADOPTED", ["SUPERSEDED", "EXPIRED"]],
    ["decision", "SUPERSEDED", []],
    ["decision", "EXPIRED", []],
    ["capture", "new", ["planted", "composted"]],
    ["capture", "composted", ["new"]],
    ["capture", "planted", []],
  ];

  it.each(allowed)("%s %s -> %j", (type, from, targets) => {
    expect([...allowedTargets(type, from)].sort()).toEqual([...targets].sort());
    for (const to of STATUSES[type] as readonly string[]) {
      expect(isAllowedTransition(type, from, to)).toBe(targets.includes(to));
    }
  });

  it.each(["task", "project", "research", "expert"] as const)("allows every %s move", (type) => {
    const statuses: readonly string[] = STATUSES[type];
    for (const from of statuses) {
      expect([...allowedTargets(type, from)].sort()).toEqual(statuses.filter((s) => s !== from).sort());
    }
  });

  it("rejects unknown statuses", () => {
    expect(allowedTargets("idea", "nope")).toEqual([]);
    expect(isAllowedTransition("idea", "seed", "nope")).toBe(false);
  });
});

describe("moveKind", () => {
  it.each([
    ["idea", "ready", "transplanted", "promotion"],
    ["idea", "seed", "sprouting", "direct"],
    ["capture", "new", "planted", "triage"],
    ["capture", "new", "composted", "direct"],
    ["decision", "PROPOSED", "ACCEPTED", "approval"],
    ["decision", "ACCEPTED", "ADOPTED", "direct"],
    ["decision", "ADOPTED", "SUPERSEDED", "approval"],
    ["decision", "ACCEPTED", "EXPIRED", "approval"],
    ["project", "active", "completed", "approval"],
    ["project", "active", "archived", "approval"],
    ["project", "proposed", "archived", "direct"],
    ["project", "on_hold", "completed", "direct"],
    ["task", "ready", "done", "direct"],
    ["proposal", "pending", "applied", "server"],
  ] as const)("%s %s -> %s is %s", (type, from, to, kind) => {
    expect(moveKind(type, from, to)).toBe(kind);
  });
});

describe("rewriteStatus", () => {
  const task = [
    "---",
    "id: OS-T-QF81M",
    "type: task   # keep me",
    "schema_version: 1",
    'title: "Quoted: title"',
    "status: blocked",
    "created: 2026-10-25T15:00:00Z",
    "updated: 2026-10-25T15:00:00Z",
    "tags: [a, b]",
    "links:",
    "  - { rel: blocks, id: OS-T-AAAAA }",
    "x-board:",
    "  lane: 1",
    "---",
    "## Objective\r\nKeep CRLF ---\n",
  ].join("\n");

  it("changes only the status and updated values", () => {
    const out = rewriteStatus(task, "ready", "2026-10-26T09:38:00Z");
    expect(out).toBe(task.replace("status: blocked", "status: ready").replace("updated: 2026-10-25T15:00:00Z", "updated: 2026-10-26T09:38:00Z"));
  });

  it("rewrites a decision's Status line too", () => {
    const body = adrBody("OS-D-4M9TZ", "PROPOSED");
    const text = `---\nid: OS-D-4M9TZ\ntype: decision\nstatus: PROPOSED\nupdated: 2026-10-25T15:00:00Z\n---\n${body}`;
    const out = rewriteStatus(text, "ACCEPTED", "2026-10-26T09:00:00Z");
    const parsed = parseRecord(out);
    expect(parsed.ok && parsed.record.frontmatter.status).toBe("ACCEPTED");
    expect(parsed.ok && adrStatusLine(parsed.record.body)).toBe("ACCEPTED");
    expect(out.replaceAll("ACCEPTED", "PROPOSED").replace("2026-10-26T09:00:00Z", "2026-10-25T15:00:00Z")).toBe(text);
  });
});

describe("setFrontmatterScalars", () => {
  it("appends missing fields at the end of the frontmatter", () => {
    expect(setFrontmatterScalars("---\nid: x\n---\nbody", { approval: "OS-PROP-8V3KD" })).toBe("---\nid: x\napproval: OS-PROP-8V3KD\n---\nbody");
    expect(setFrontmatterScalars("---\n---\n", { status: "new" })).toBe("---\nstatus: new\n---\n");
  });

  it("quotes values that need it", () => {
    expect(setFrontmatterScalars("---\ntitle: a\n---\n", { title: "a: b" })).toBe('---\ntitle: "a: b"\n---\n');
  });

  it("replaces a collection with a scalar", () => {
    expect(setFrontmatterScalars("---\ntags: [a]\nid: x\n---\n", { tags: "a" })).toBe("---\ntags: a\nid: x\n---\n");
  });
});

describe("blocking", () => {
  const t = (id: string, status: string, ...blocks: string[]): TaskSummary => ({ id, status, links: blocks.map((target) => ({ rel: "blocks", id: target })) });

  it("lists open blockers", () => {
    const tasks = [t("A", "in_progress", "C"), t("B", "done", "C"), t("D", "cancelled", "C"), t("E", "backlog", "C"), t("C", "blocked")];
    expect(openBlockers("C", tasks)).toEqual(["A", "E"]);
  });

  it("unblocks blocked tasks whose last open blocker finishes", () => {
    const tasks = [
      t("A", "in_progress", "B", "C", "D", "E"),
      t("B", "blocked"),
      t("C", "blocked"),
      t("X", "ready", "C"),
      t("D", "backlog"),
      t("E", "blocked"),
      t("Y", "done", "E"),
    ];
    expect(unblockedBy("A", tasks)).toEqual(["B", "E"]);
  });

  it("unblocks nothing for an unknown task", () => {
    expect(unblockedBy("Z", [t("B", "blocked")])).toEqual([]);
  });
});
