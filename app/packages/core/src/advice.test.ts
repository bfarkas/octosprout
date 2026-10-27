import { describe, expect, it } from "vitest";

import { adviceBullet, appendToSection, planAdvice } from "./advice.js";
import { newDecision } from "./adr.js";
import { configFile, expert, testKey } from "./fixtures.js";
import { applyOperations, classifyOperations, workspaceLookup } from "./proposals.js";
import { parseRecord } from "./record.js";
import { RecordIndex } from "./record-index.js";
import { newRecord, recordPath } from "./templates.js";
import { validateWorkspace, type SourceFile } from "./validate.js";

const NOW = "2026-10-27T10:00:00Z";
const SECURITY = { id: "OS-E-5EC9R", title: "Security Architect" };
const OPS = { id: "OS-E-0PSXX", title: "Operations Lead" };

function workspace(status = "DRAFT") {
  const text = newDecision({ id: "OS-D-9PKVR", title: "Poll or push", now: NOW }).replace(/^status: DRAFT$/m, `status: ${status}`).replace("* Status: DRAFT", `* Status: ${status}`);
  const files: SourceFile[] = [configFile(testKey()), { path: "records/decisions/OS-D-9PKVR--poll-or-push.md", content: text }, expert(SECURITY.id, { title: SECURITY.title })];
  const index = new RecordIndex(files);
  return { files, index, decision: index.get("OS-D-9PKVR")! };
}

describe("adviceBullet", () => {
  it("attributes simulated advice as §14 asks, on one line", () => {
    expect(adviceBullet({ expert: SECURITY, role: "Security", advice: "Prefer per-file\npreconditions." }, "claude-opus-5-5", NOW)).toBe(
      " * Prefer per-file preconditions. - Security Architect (simulated, AI-generated, claude-opus-5-5), Security, Oct 27, 2026",
    );
  });
});

describe("appendToSection", () => {
  it("replaces the template's placeholder and keeps the next heading apart", () => {
    const text = "## Advice\n * [Advice offered] - [Name, Role, Date]\n\n## Supporting Material\n * [Description] [LINK]\n";
    expect(appendToSection(appendToSection(text, "Advice", [" * A"]), "Supporting Material", [" * B"])).toBe("## Advice\n * A\n\n## Supporting Material\n * B\n");
  });

  it("keeps advice already there", () => {
    expect(appendToSection("## Advice\n * Earlier\n", "Advice", [" * Later"])).toBe("## Advice\n * Earlier\n * Later\n");
  });
});

describe("planAdvice", () => {
  it("adds attributed advice, consulted links and research, and the result validates", () => {
    const { files, index, decision } = workspace();
    const opsExpert = { path: recordPath("expert", OPS.id, OPS.title), content: newRecord("expert", { id: OPS.id, title: OPS.title, now: NOW }) };
    const operations = planAdvice({
      decision,
      entries: [
        { expert: SECURITY, role: "Security", advice: "Prefer per-file preconditions.", longForm: { id: "OS-R-4NG1A", text: "Repo-wide checks conflict with every concurrent capture.", sources: "- RFC 9110 §13" } },
        { expert: OPS, role: "Operations", advice: "Push keeps the server simpler to run." },
      ],
      synthesis: { id: "OS-R-5YNTH", text: "Both prefer push; they differ on retries." },
      newExperts: [opsExpert],
      model: "claude-opus-5-5",
      now: NOW,
    });
    expect(operations.map((op) => op.op)).toEqual(["create", "create", "create", "update"]);

    const lookup = workspaceLookup(index);
    const applied = applyOperations(operations, lookup, NOW);
    if (!applied.ok) throw new Error(applied.message);
    expect(classifyOperations(operations, lookup, applied, 10).consequential).toBe(false);

    const after = new Map(files.map((f) => [f.path, f]));
    for (const change of applied.changes) if ("content" in change) after.set(change.path, { path: change.path, content: change.content });
    expect(validateWorkspace([...after.values()]).filter((f) => f.severity === "error")).toEqual([]);

    const updated = after.get(decision.path)!.content as string;
    expect(updated).toContain(" * Prefer per-file preconditions. - Security Architect (simulated, AI-generated, claude-opus-5-5), Security, Oct 27, 2026\n * Push keeps");
    expect(updated).not.toContain("[Advice offered]");
    expect(updated).toContain("## Supporting Material\n * Security Architect on Poll or push OS-R-4NG1A\n * Advice synthesis: Poll or push OS-R-5YNTH\n");
    const parsed = parseRecord(updated);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.record.frontmatter.links).toEqual([{ rel: "consulted", id: SECURITY.id }, { rel: "consulted", id: OPS.id }]);

    const research = after.get("records/research/OS-R-4NG1A--security-architect-on-poll-or-push.md")!.content as string;
    expect(research).toContain("status: concluded");
    expect(research).toContain("Simulated, AI-generated advice (claude-opus-5-5)");
    expect(research).toContain("rel: supports, id: OS-D-9PKVR");
  });

  it("refuses frozen decisions and empty advice", () => {
    expect(() => planAdvice({ decision: workspace("ACCEPTED").decision, entries: [{ expert: SECURITY, role: "x", advice: "x" }], model: "m", now: NOW })).toThrow(/DRAFT or PROPOSED/);
    expect(() => planAdvice({ decision: workspace().decision, entries: [], model: "m", now: NOW })).toThrow(/at least one/);
    expect(() => planAdvice({ decision: workspace().decision, entries: [{ expert: SECURITY, role: "x", advice: "x" }], model: " ", now: NOW })).toThrow(/model/);
  });
});
