import { describe, expect, it } from "vitest";

import { CROCKFORD_ALPHABET, generateId, isId, normalizeId, parseId, randomPart } from "./ids.js";
import { RECORD_TYPES, TYPE_CODES } from "./types.js";

describe("randomPart", () => {
  it("uses only Crockford Base32 characters", () => {
    for (let i = 0; i < 1000; i++) {
      const rand = randomPart();
      expect(rand).toHaveLength(5);
      for (const ch of rand) expect(CROCKFORD_ALPHABET).toContain(ch);
    }
  });

  it("excludes I, L, O and U", () => {
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ILOU]/);
  });
});

describe("generateId", () => {
  it.each(RECORD_TYPES)("produces a valid %s ID", (type) => {
    const id = generateId(type);
    expect(id.startsWith(`OS-${TYPE_CODES[type]}-`)).toBe(true);
    expect(parseId(id)).toMatchObject({ prefix: "OS", type });
  });

  it("regenerates on an injected collision", () => {
    const values = ["AAAAA", "AAAAA", "BBBBB"];
    const taken = new Set(["OS-I-AAAAA"]);
    const id = generateId("idea", {
      random: () => values.shift()!,
      exists: (candidate) => taken.has(candidate),
    });
    expect(id).toBe("OS-I-BBBBB");
  });

  it("gives up after maxAttempts collisions", () => {
    expect(() => generateId("task", { exists: () => true, maxAttempts: 3 })).toThrow(/3 attempts/);
  });
});

describe("parseId", () => {
  it("parses the spec examples", () => {
    for (const id of ["OS-C-7K3QX", "OS-I-2HD9W", "OS-T-QF81M", "OS-P-0XZ4K", "OS-D-4M9TZ", "OS-R-B7N2C", "OS-E-SEC01", "OS-PROP-8V3KD"]) {
      expect(parseId(id)?.id).toBe(id);
    }
  });

  it("is case-insensitive and renders uppercase", () => {
    expect(normalizeId("os-prop-8v3kd")).toBe("OS-PROP-8V3KD");
  });

  it("parses reserved library IDs", () => {
    expect(parseId("OSL-SKILL-7K3QX")).toMatchObject({ prefix: "OSL", code: "SKILL" });
  });

  it.each([
    "OS-X-7K3QX", // unknown type code
    "OS-C-7K3Q", // too short
    "OS-C-7K3QXX", // too long
    "OS-C-7K3QI", // excluded letter
    "OSL-C-7K3QX", // private type code under library prefix
    "OS-SKILL-7K3QX", // library type code under private prefix
    " OS-C-7K3QX",
  ])("rejects %j", (id) => {
    expect(isId(id)).toBe(false);
  });

  it("normalizeId throws on invalid input", () => {
    expect(() => normalizeId("nope")).toThrow();
  });
});
