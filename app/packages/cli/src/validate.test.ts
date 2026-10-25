import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderRecord, sha256Hex } from "@octosprout/core";

import { runValidate } from "./validate.js";

let root: string;
let out: string[];
let err: string[];
const io = { out: (t: string) => out.push(t), err: (t: string) => err.push(t) };

function write(path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function captureFile(id: string, body = "hello\n"): string {
  return renderRecord(
    {
      id,
      type: "capture",
      schema_version: 1,
      status: "new",
      created: "2026-10-25T14:03:11Z",
      updated: "2026-10-25T14:03:11Z",
      source: "cli",
      idempotency_key: "abcdefgh",
      received_via: "cli",
      content_sha256: sha256Hex(body),
    },
    body,
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "octosprout-cli-"));
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("octosprout validate", () => {
  it("passes on a valid workspace and on an empty one", () => {
    expect(runValidate([], root, io)).toBe(0);
    write("records/captures/2026/10/OS-C-7K3QX.md", captureFile("OS-C-7K3QX"));
    expect(runValidate([], root, io)).toBe(0);
    expect(err.at(-1)).toBe("No findings.");
  });

  it("exits 1 and reports a tampered capture", () => {
    write("records/captures/2026/10/OS-C-7K3QX.md", `${captureFile("OS-C-7K3QX")}edited`);
    expect(runValidate([], root, io)).toBe(1);
    expect(out.join("\n")).toContain("OSV006");
  });

  it("emits JSON findings", () => {
    write("records/captures/2026/10/OS-C-7K3QX.md", `${captureFile("OS-C-7K3QX")}edited`);
    runValidate(["--json"], root, io);
    expect(JSON.parse(out.join("\n"))).toEqual([expect.objectContaining({ code: "OSV006", severity: "error" })]);
  });

  it("emits GitHub annotations with --ci", () => {
    write("records/captures/2026/10/OS-C-7K3QX.md", `${captureFile("OS-C-7K3QX")}edited`);
    runValidate(["--ci"], root, io);
    expect(out[0]).toMatch(/^::error file=records\/captures\/2026\/10\/OS-C-7K3QX\.md,line=\d+,title=OSV006::/);
  });

  it("limits reported findings to the given paths but still validates links workspace-wide", () => {
    write("records/captures/2026/10/OS-C-AAAAA.md", `${captureFile("OS-C-AAAAA")}edited`);
    write("records/captures/2026/10/OS-C-BBBBB.md", captureFile("OS-C-BBBBB"));
    expect(runValidate(["records/captures/2026/10/OS-C-BBBBB.md"], root, io)).toBe(0);
    expect(runValidate(["./records/captures"], root, io)).toBe(1);
  });

  it("rejects unknown options", () => {
    expect(runValidate(["--nope"], root, io)).toBe(2);
  });
});
