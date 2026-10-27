import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { adrStatusLine, decisionBodySha256, parseAdr, setAdrStatusLine } from "./adr.js";
import { adrBody } from "./fixtures.js";

describe("parseAdr", () => {
  it("reads the template structure", () => {
    const adr = parseAdr(adrBody("OS-D-4M9TZ", "ACCEPTED", { advice: "* Be careful - Security Architect (simulated, AI-generated, model), Security, Oct 25, 2026" }));
    expect(adr.title).toMatchObject({ id: "OS-D-4M9TZ", text: "Example", index: 0 });
    expect(adr.fields.map((f) => [f.name, f.value])).toEqual([["Date", "Oct 25, 2026"], ["Status", "ACCEPTED"], ["Author", "Example"]]);
    expect(adr.sections.map((s) => s.text)).toEqual(["Decision", "Context", "Options Considered", "Advice", "Supporting Material"]);
    expect(adr.options.map((o) => [o.title, o.selected, o.mismatched.length])).toEqual([["The thing", true, 0], ["Another thing", false, 0]]);
    expect(adr.advice).toHaveLength(1);
  });

  it("finds consequences that contradict the selection", () => {
    const body = adrBody("OS-D-4M9TZ", "DRAFT").replace(" * Rejected because: it does not", " * Adopted because: oops");
    expect(parseAdr(body).options[1]?.mismatched).toEqual([expect.objectContaining({ text: "* Adopted because: oops" })]);
  });

  it("parses the vendored upstream template", () => {
    const template = readFileSync(new URL("../../../../templates/adr/adr-template.md", import.meta.url), "utf8");
    const adr = parseAdr(template);
    expect(adr.sections.map((s) => s.text)).toEqual(["Decision", "Context", "Options Considered", "Advice", "Supporting Material"]);
    expect(adr.options.filter((o) => o.selected)).toHaveLength(1);
  });
});

describe("status line", () => {
  const body = adrBody("OS-D-4M9TZ", "PROPOSED");

  it("is read and rewritten in place", () => {
    expect(adrStatusLine(body)).toBe("PROPOSED");
    const accepted = setAdrStatusLine(body, "ACCEPTED");
    expect(adrStatusLine(accepted)).toBe("ACCEPTED");
    expect(accepted.replace("ACCEPTED", "PROPOSED")).toBe(body);
  });

  it("is excluded from the frozen-body hash", () => {
    expect(decisionBodySha256(setAdrStatusLine(body, "ADOPTED"))).toBe(decisionBodySha256(body));
    expect(decisionBodySha256(`${body}edit`)).not.toBe(decisionBodySha256(body));
  });
});

describe("newDecision", () => {
  it("fills in the vendored template and validates", async () => {
    const { newDecision, adrDate } = await import("./adr.js");
    const { validateWorkspace } = await import("./validate.js");
    const { project, decision } = await import("./fixtures.js");
    expect(adrDate("2026-10-27T10:00:00Z")).toBe("Oct 27, 2026");
    const text = newDecision({ id: "OS-D-22222", title: "Poll for changes", now: "2026-10-27T10:00:00Z", author: "Ada", project: "OS-P-0XZ4K", supersedes: "OS-D-11111" });
    expect(text).toContain("# ADR OS-D-22222 - Poll for changes\n* Date: Oct 27, 2026\n* Status: DRAFT\n* Author: Ada\n");
    expect(text).toContain("## Options Considered\n### Option 1 (SELECTED): [Selected option]");
    expect(text).toContain("  - { rel: supersedes, id: OS-D-11111 }");
    const findings = validateWorkspace([project("OS-P-0XZ4K"), decision("OS-D-11111"), { path: "records/decisions/OS-D-22222--poll.md", content: text }]);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});
