import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runInit } from "./init.js";
import { runValidate } from "./validate.js";

let root: string;
let out: string[];
let err: string[];
const io = { out: (t: string) => out.push(t), err: (t: string) => err.push(t) };
const cliPath = "/opt/octosprout/packages/cli/dist/index.js";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "octosprout-init-"));
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("octosprout init", () => {
  it("creates the workspace skeleton, and the result validates", () => {
    expect(runInit([], root, io, { cliPath })).toBe(0);
    for (const path of [
      "README.md",
      "AGENTS.md",
      "CLAUDE.md",
      "octosprout.yaml",
      ".gitignore",
      ".github/workflows/validate.yml",
      "prompts/chatgpt-handoff.md",
      "records/captures/.gitkeep",
      "records/decisions/.gitkeep",
      "experts/.gitkeep",
      "proposals/.gitkeep",
      "skills/.gitkeep",
    ]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    expect(runValidate([], root, io)).toBe(0);
  });

  it("initializes a new directory given as an argument", () => {
    expect(runInit(["workspace"], root, io, { cliPath })).toBe(0);
    expect(existsSync(join(root, "workspace/octosprout.yaml"))).toBe(true);
  });

  it("never overwrites existing files, and is safe to repeat", () => {
    writeFileSync(join(root, "AGENTS.md"), "mine\n");
    runInit([], root, io, { cliPath });
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("mine\n");
    expect(out).toContain("skipped  AGENTS.md (already exists)");

    out = [];
    expect(runInit([], root, io, { cliPath })).toBe(0);
    expect(out.filter((line) => line.startsWith("created"))).toEqual([]);
  });

  it("installs an executable pre-push hook in a Git repository, once", () => {
    mkdirSync(join(root, ".git"));
    runInit([], root, io, { cliPath });
    const hook = join(root, ".git/hooks/pre-push");
    expect(readFileSync(hook, "utf8")).toContain(`exec node '${cliPath}' validate`);
    expect(statSync(hook).mode & 0o111).not.toBe(0);

    writeFileSync(hook, "#!/bin/sh\necho custom\n");
    runInit([], root, io, { cliPath });
    expect(readFileSync(hook, "utf8")).toContain("custom");
  });

  it("explains when there is no Git repository", () => {
    runInit([], root, io, { cliPath });
    expect(existsSync(join(root, ".git"))).toBe(false);
    expect(err.join("\n")).toContain("Not a Git repository");
  });

  it("rejects unknown options and extra arguments", () => {
    expect(runInit(["--force"], root, io)).toBe(2);
    expect(runInit(["a", "b"], root, io)).toBe(2);
  });

  it("reports a missing template directory", () => {
    expect(runInit([], root, io, { templatesDir: join(root, "nope") })).toBe(2);
  });
});
