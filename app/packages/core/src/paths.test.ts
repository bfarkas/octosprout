import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isWorkspacePath, resolveInside } from "./paths.js";
import { readWorkspaceFiles } from "./workspace.js";

let base: string;
let root: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "octosprout-paths-"));
  root = join(base, "workspace");
  mkdirSync(join(root, "records"), { recursive: true });
  mkdirSync(join(base, "outside"));
  writeFileSync(join(base, "outside", "secret"), "x");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("isWorkspacePath", () => {
  it.each(["records/ideas/OS-I-2HD9W--x.md", "AGENTS.md", ".claude/settings.json"])("accepts %s", (path) => expect(isWorkspacePath(path)).toBe(true));
  it.each(["", "/etc/passwd", "../x", "records/../../x", "records//x", "./x", ".git/config", "a/.GIT/x", "a\\b", "a\0b"])("refuses %j", (path) => expect(isWorkspacePath(path)).toBe(false));
});

describe("resolveInside", () => {
  it("resolves new and existing files inside the workspace", () => {
    expect(resolveInside(root, "records/ideas/new.md")).toBe(join(root, "records/ideas/new.md"));
    expect(resolveInside(root, "records")).toBe(join(root, "records"));
  });

  it("refuses symbolic links that lead outside, for the file or a directory on the way", () => {
    symlinkSync(join(base, "outside", "secret"), join(root, "records", "secret.md"));
    symlinkSync(join(base, "outside"), join(root, "experts"));
    expect(resolveInside(root, "records/secret.md")).toBeUndefined();
    expect(resolveInside(root, "experts/new.md")).toBeUndefined();
    expect(resolveInside(root, "../outside/secret")).toBeUndefined();
  });

  it("allows symbolic links that stay inside", () => {
    symlinkSync(join(root, "records"), join(root, "alias"));
    expect(resolveInside(root, "alias/x.md")).toBe(join(root, "alias/x.md"));
  });
});

describe("readWorkspaceFiles", () => {
  it("skips symbolic links, also for whole record directories", () => {
    mkdirSync(join(base, "outside", "ideas"));
    writeFileSync(join(base, "outside", "ideas", "OS-I-2HD9W--x.md"), "---\nid: OS-I-2HD9W\n---\n");
    writeFileSync(join(root, "records", "real.md"), "x");
    symlinkSync(join(base, "outside", "ideas"), join(root, "records", "ideas"));
    symlinkSync(join(base, "outside", "secret"), join(root, "records", "secret.md"));
    symlinkSync(join(base, "outside"), join(root, "experts"));
    expect(readWorkspaceFiles(root).map((f) => f.path)).toEqual(["records/real.md"]);
  });
});
