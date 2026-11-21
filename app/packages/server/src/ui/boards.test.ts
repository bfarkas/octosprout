import { describe, expect, it } from "vitest";

import { age, lastLogEntry } from "./boards.js";

describe("age", () => {
  const now = new Date("2026-10-26T09:38:00Z");
  it.each([
    ["2026-10-26T00:00:01Z", "today"],
    ["2026-10-25T23:59:59Z", "yesterday"],
    ["2026-10-23T12:00:00Z", "3 d ago"],
    ["2026-09-01T12:00:00Z", "2026-09-01"],
    ["2026-10-27T12:00:00Z", "today"],
    ["garbage", ""],
  ])("%s is %s", (updated, expected) => {
    expect(age(updated, now)).toBe(expected);
  });
});

describe("lastLogEntry", () => {
  it("finds the latest Handoff log entry, and nothing outside the log", () => {
    const body = "## Objective\n\n### 2026-01-01: not a log (x)\n\n## Handoff log\n\n### 2026-11-20: ready → in_progress (agent:a)\n\nx\n\n### 2026-11-21: progress (agent:claude-code)\n\nNote.\n\n## Notes\n\n### 2026-12-01: later (y)\n";
    expect(lastLogEntry(body)).toEqual({ date: "2026-11-21", actor: "agent:claude-code" });
    expect(lastLogEntry("## Handoff log\n")).toBeUndefined();
    expect(lastLogEntry("## Objective\n\n### 2026-01-01: x (y)\n")).toBeUndefined();
  });
});
