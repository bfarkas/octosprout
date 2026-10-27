import { describe, expect, it } from "vitest";

import { adrBody, decision, record, research } from "./fixtures.js";
import { demoteHeadings, firstParagraph, handoffContext, planHandoffReport } from "./handoff.js";
import { applyOperations, workspaceLookup } from "./proposals.js";
import { parseRecord } from "./record.js";
import { RecordIndex } from "./record-index.js";
import { validateWorkspace, type SourceFile } from "./validate.js";

const NOW = "2026-10-27T10:00:00Z";
const REPO = { kind: "repo", url: "https://github.com/bfarkas/digest" };
const TASK_BODY = "## Objective\n\nPick a send day.\n\n## Acceptance criteria\n\n- [ ] a day is chosen\n\n## Verification\n\nRun the digest.\n\n## Handoff log\n";

function workspace(): SourceFile[] {
  return [
    record("project", "records/projects", "OS-P-0XZ4K", { title: "Weekly digest", refs: [REPO] }, undefined, "## Goals\n\nRemind me weekly.\n"),
    record("task", "records/tasks", "OS-T-QF81M", { title: "Pick a send day", status: "ready", links: [{ rel: "belongs_to", id: "OS-P-0XZ4K" }, { rel: "implements", id: "OS-D-22222" }] }, undefined, TASK_BODY),
    decision("OS-D-11111", { status: "SUPERSEDED", title: "Poll daily" }, adrBody("OS-D-11111", "SUPERSEDED", { title: "Poll daily" })),
    decision("OS-D-22222", { status: "ACCEPTED", title: "Send on Mondays", links: [{ rel: "supersedes", id: "OS-D-11111" }] }, adrBody("OS-D-22222", "ACCEPTED", { title: "Send on Mondays" })),
    decision("OS-D-33333", { status: "DRAFT", title: "Unsettled", links: [{ rel: "belongs_to", id: "OS-P-0XZ4K" }] }),
    research("OS-R-B7N2C", { title: "When people read email", status: "concluded", links: [{ rel: "supports", id: "OS-P-0XZ4K" }] }),
  ].map((file) => (file.path.startsWith("records/research/") ? { ...file, content: `${file.content}## Summary\n\nMonday mornings.\n\nMore detail.\n` } : file));
}

describe("demoteHeadings", () => {
  it("demotes headings outside code fences", () => {
    expect(demoteHeadings("## A\n```\n# not\n```\n### B", 2)).toBe("#### A\n```\n# not\n```\n##### B");
  });
});

describe("firstParagraph", () => {
  it("prefers the Summary section", () => {
    expect(firstParagraph("## Summary\n\nShort\nanswer.\n\nMore.\n## Findings\nX")).toBe("Short answer.");
    expect(firstParagraph("Just text.\n\nMore.")).toBe("Just text.");
  });
});

describe("handoffContext", () => {
  it("bundles the task, project, settled decisions, research and repositories with the instructions", () => {
    const bundle = handoffContext(new RecordIndex(workspace()), "OS-T-QF81M", NOW);
    expect(bundle).toContain("# Handoff: OS-T-QF81M Pick a send day");
    expect(bundle).toContain("1. Open the target repository: https://github.com/bfarkas/digest.");
    expect(bundle).toContain("#### Objective\n\nPick a send day.");
    expect(bundle).toContain("## Project OS-P-0XZ4K: Weekly digest");
    expect(bundle).toContain("### OS-D-22222: Send on Mondays (ACCEPTED)");
    expect(bundle).toContain("Supersedes OS-D-11111: Poll daily (SUPERSEDED).");
    expect(bundle).not.toContain("OS-D-33333");
    expect(bundle).toContain("- **When people read email** (OS-R-B7N2C, `records/research/OS-R-B7N2C--example.md`): Monday mornings.");
    expect(bundle).toContain("propose_handoff_report");
  });

  it("asks for the repository when none is recorded, and refuses non-tasks", () => {
    const index = new RecordIndex([record("task", "records/tasks", "OS-T-QF81M", { title: "Alone" }, undefined, TASK_BODY)]);
    expect(handoffContext(index, "OS-T-QF81M", NOW)).toContain("No target repository is recorded.");
    expect(() => handoffContext(new RecordIndex(workspace()), "OS-P-0XZ4K", NOW)).toThrow(/not a task/);
  });
});

describe("planHandoffReport", () => {
  it("logs the outcome, adds refs, moves the task and drafts follow-ups; the result validates", () => {
    const files = workspace();
    const index = new RecordIndex(files);
    const task = index.get("OS-T-QF81M")!;
    const operations = planHandoffReport({
      task,
      outcome: "Monday it is; the scheduler runs at 07:00.",
      verification: "pnpm test passes; a dry run sent one digest.",
      prs: ["https://github.com/bfarkas/digest/pull/12"],
      commits: ["4f1c2e9a0b7d"],
      status: "done",
      followUps: [{ id: "OS-T-AAAAA", title: "Add a time-zone setting", objective: "Let me pick the hour." }],
      project: "OS-P-0XZ4K",
      repoUrl: REPO.url,
      actor: "agent:claude-code",
      now: NOW,
    });
    expect(operations.map((op) => op.op)).toEqual(["update", "set_status", "create"]);

    const applied = applyOperations(operations, workspaceLookup(index), NOW);
    if (!applied.ok) throw new Error(applied.message);
    const after = new Map(files.map((f) => [f.path, f]));
    for (const change of applied.changes) if ("content" in change) after.set(change.path, { path: change.path, content: change.content });
    // The decision fixtures carry no signed approvals (OSV008); the report adds no errors of its own.
    const errors = (all: SourceFile[]) => validateWorkspace(all).filter((f) => f.severity === "error").map((f) => `${f.code} ${f.path}`);
    expect(errors([...after.values()])).toEqual(errors(files));

    const text = after.get(task.path)!.content as string;
    expect(text).toContain("## Handoff log\n\n### 2026-10-27: ready → done (agent:claude-code)\n\n**Outcome:** Monday it is;");
    expect(text).toContain("**References:** PR https://github.com/bfarkas/digest/pull/12, commit https://github.com/bfarkas/digest/commit/4f1c2e9a0b7d");
    expect(text).toContain("**Follow-ups:** OS-T-AAAAA Add a time-zone setting");
    const parsed = parseRecord(text);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.record.frontmatter).toMatchObject({
      status: "done",
      refs: [{ kind: "pr", url: "https://github.com/bfarkas/digest/pull/12" }, { kind: "commit", url: "https://github.com/bfarkas/digest/commit/4f1c2e9a0b7d" }],
    });
    const followUp = [...after.values()].find((f) => f.path.startsWith("records/tasks/OS-T-AAAAA"))!.content as string;
    expect(followUp).toContain("## Objective\n\nLet me pick the hour.");
    expect(followUp).toContain("rel: belongs_to, id: OS-P-0XZ4K");
    expect(followUp).toContain("rel: relates_to, id: OS-T-QF81M");
  });

  it("appends to an existing log, keeps SHAs without a GitHub repo in the log only, and checks input", () => {
    const index = new RecordIndex(workspace());
    const task = index.get("OS-T-QF81M")!;
    const base = { task, outcome: "Done.", verification: "", actor: "agent:x", now: NOW };
    const [first] = planHandoffReport({ ...base, commits: ["abcdef1"] });
    const text = (first as { content: string }).content;
    expect(text).toContain("**References:** commit `abcdef1`");
    expect(text).not.toContain("refs:\n  - { kind: commit");
    expect(text).toContain("**Verification:** Not reported.");
    expect(() => planHandoffReport({ ...base, prs: ["http://x"] })).toThrow(/https/);
    expect(() => planHandoffReport({ ...base, commits: ["not a sha"] })).toThrow(/SHA/);
    expect(() => planHandoffReport({ ...base, outcome: " " })).toThrow(/outcome/);
  });
});
