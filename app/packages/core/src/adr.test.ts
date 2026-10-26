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
