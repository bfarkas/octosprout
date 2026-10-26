import { describe, expect, it } from "vitest";

import { age } from "./boards.js";

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
