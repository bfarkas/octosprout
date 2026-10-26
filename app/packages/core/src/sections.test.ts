import { describe, expect, it } from "vitest";

import { findSection, hasContent, headings, sections } from "./sections.js";

const body = [
  "## Objective",
  "Ship it.",
  "### Detail",
  "More.",
  "## Acceptance criteria",
  "",
  "- [ ] ",
  "## Notes ##",
  "```md",
  "## Not a heading",
  "```",
  "",
].join("\n");

describe("sections", () => {
  it("finds headings outside code fences", () => {
    expect(headings(body).map((h) => [h.level, h.text, h.index])).toEqual([
      [2, "Objective", 0],
      [3, "Detail", 2],
      [2, "Acceptance criteria", 4],
      [2, "Notes", 7],
    ]);
  });

  it("includes subsections in a section's content", () => {
    expect(sections(body)[0]?.content).toBe("Ship it.\n### Detail\nMore.");
    expect(findSection(body, "notes")?.content).toBe("```md\n## Not a heading\n```\n");
  });

  it.each([
    ["", false],
    ["  \n\t\n", false],
    ["- [ ] \n* [ ]", false],
    ["<!-- fill me in -->\n", false],
    ["- [ ] works", true],
    ["- [x]", true],
    ["Text", true],
  ])("hasContent(%j) is %s", (content, expected) => {
    expect(hasContent(content)).toBe(expected);
  });
});
