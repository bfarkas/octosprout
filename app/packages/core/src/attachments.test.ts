import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { attachmentLinks, attachmentType, listAttachments, resolveAttachment } from "./attachments.js";
import { record } from "./fixtures.js";
import { SchemaRegistry } from "./schemas.js";
import { validateWorkspace } from "./validate.js";

const PROJECT = "records/projects/OS-P-0XZ4K--x.md";

describe("resolveAttachment", () => {
  it.each([
    ["../../attachments/OS-P-0XZ4K/a.png", "attachments/OS-P-0XZ4K/a.png"],
    ["../../attachments/OS-P-0XZ4K/my%20mock.png", "attachments/OS-P-0XZ4K/my mock.png"],
    ["../../attachments/a.png?v=2", "attachments/a.png"],
    ["attachments/a.png", undefined],
    ["/attachments/a.png", undefined],
    ["https://example.com/a.png", undefined],
    ["data:image/png;base64,AA", undefined],
    ["../../../attachments/a.png", undefined],
    ["../../attachments/.git/a.png", undefined],
    ["../../attachments/%E0", undefined],
  ])("%s", (src, expected) => {
    expect(resolveAttachment(PROJECT, src)).toBe(expected);
  });
});

describe("attachmentLinks", () => {
  it("finds image links with their lines, not plain links", () => {
    const body = "Intro\n\n![Mock](../../attachments/OS-P-0XZ4K/a.png \"title\")\n[not an image](../../attachments/b.png)\n![x](<../../attachments/c.webp>)";
    expect(attachmentLinks(PROJECT, body)).toEqual([
      { path: "attachments/OS-P-0XZ4K/a.png", line: 3 },
      { path: "attachments/c.webp", line: 5 },
    ]);
  });
});

describe("attachmentType", () => {
  it("allows raster images only", () => {
    expect(attachmentType("attachments/a.PNG")).toBe("image/png");
    expect(attachmentType("attachments/a.jpeg")).toBe("image/jpeg");
    expect(attachmentType("attachments/a.svg")).toBeUndefined();
    expect(attachmentType("attachments/png")).toBeUndefined();
  });
});

describe("listAttachments", () => {
  let root: string | undefined;
  afterEach(() => root && rmSync(root, { recursive: true, force: true }));

  it("lists files with sizes and skips symbolic links", () => {
    root = mkdtempSync(join(tmpdir(), "os-att-"));
    mkdirSync(join(root, "attachments", "OS-P-0XZ4K"), { recursive: true });
    writeFileSync(join(root, "attachments", "OS-P-0XZ4K", "a.png"), "1234");
    symlinkSync("/etc/hosts", join(root, "attachments", "link.png"));
    expect(listAttachments(root)).toEqual([{ path: "attachments/OS-P-0XZ4K/a.png", size: 4 }]);
  });

  it("is empty without an attachments directory", () => {
    root = mkdtempSync(join(tmpdir(), "os-att-"));
    expect(listAttachments(root)).toEqual([]);
  });
});

describe("OSV014", () => {
  const schemas = new SchemaRegistry();
  const project = record("project", "records/projects", "OS-P-0XZ4K", {}, PROJECT, "![a](../../attachments/OS-P-0XZ4K/a.png)\n\n![b](../../attachments/OS-P-0XZ4K/missing.png)\n");

  it("checks attachment types, sizes and image links when attachments are given", () => {
    const findings = validateWorkspace([project], {
      schemas,
      attachments: [
        { path: "attachments/OS-P-0XZ4K/a.png", size: 10 },
        { path: "attachments/OS-P-0XZ4K/big.jpg", size: 3 * 1024 * 1024 },
        { path: "attachments/OS-P-0XZ4K/x.svg", size: 10 },
      ],
    });
    expect(findings.map((f) => [f.code, f.severity, f.path, f.line])).toEqual([
      ["OSV014", "error", "attachments/OS-P-0XZ4K/big.jpg", undefined],
      ["OSV014", "error", "attachments/OS-P-0XZ4K/x.svg", undefined],
      ["OSV014", "warning", PROJECT, expect.any(Number)],
    ]);
    expect(findings[2]!.message).toContain("missing.png");
  });

  it("skips the check when attachments are not given", () => {
    expect(validateWorkspace([project], { schemas })).toEqual([]);
  });
});
