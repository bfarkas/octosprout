import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { capture, decision, idea, project, task } from "./fixtures.js";
import { gitBlobSha, RecordIndex } from "./record-index.js";

describe("gitBlobSha", () => {
  it("matches git hash-object", () => {
    for (const content of ["", "hello\n", "🌱 café\r\n"]) {
      const expected = execFileSync("git", ["hash-object", "--stdin"], { input: content }).toString().trim();
      expect(gitBlobSha(content)).toBe(expected);
      expect(gitBlobSha(Buffer.from(content))).toBe(expected);
    }
  });
});

describe("RecordIndex", () => {
  const files = [
    capture("OS-C-7K3QX"),
    idea("OS-I-2HD9W", { tags: ["memory"], links: [{ rel: "derived_from", id: "os-c-7k3qx" }] }),
    project("OS-P-0XZ4K", { refs: [{ kind: "repo", url: "https://github.com/bfarkas/x", note: "main" }] }),
    task("OS-T-AAAAA", { status: "in_progress", links: [{ rel: "blocks", id: "OS-T-BBBBB" }, { rel: "belongs_to", id: "OS-P-0XZ4K" }] }),
    task("OS-T-BBBBB", { status: "blocked" }),
    decision("OS-D-4M9TZ"),
    { path: "records/ideas/broken.md", content: "no frontmatter" },
    { path: "README.md", content: "---\nid: OS-I-ZZZZZ\n---\n" },
  ];
  const index = new RecordIndex(files);

  it("indexes readable records only", () => {
    expect(index.size).toBe(6);
    expect(index.has("OS-I-ZZZZZ")).toBe(false);
  });

  it("looks up by ID case-insensitively and by path", () => {
    const record = index.get("os-i-2hd9w");
    expect(record).toMatchObject({ type: "idea", title: "Example", status: "seed", tags: ["memory"], path: "records/ideas/OS-I-2HD9W--example.md" });
    expect(record?.links).toEqual([{ rel: "derived_from", id: "OS-C-7K3QX" }]);
    expect(index.byPath(record!.path)).toBe(record);
    expect(index.get("OS-C-7K3QX")?.title).toBe("");
    expect(index.get("OS-P-0XZ4K")?.refs).toEqual([{ kind: "repo", url: "https://github.com/bfarkas/x", note: "main" }]);
  });

  it("carries the blob SHA of the file", () => {
    expect(index.get("OS-T-BBBBB")?.blob).toBe(gitBlobSha(files[4]!.content));
  });

  it("computes backlinks and blockers", () => {
    expect(index.backlinks("OS-P-0XZ4K").map((b) => [b.rel, b.source.id])).toEqual([["belongs_to", "OS-T-AAAAA"]]);
    expect(index.backlinks("OS-C-7K3QX").map((b) => b.source.id)).toEqual(["OS-I-2HD9W"]);
    expect(index.blockedBy("OS-T-BBBBB")).toEqual(["OS-T-AAAAA"]);
  });

  it("updates, removes and versions records", () => {
    const local = new RecordIndex(files);
    const before = local.version("task");
    const ideasBefore = local.version("idea");
    local.set(task("OS-T-AAAAA", { status: "done", links: [{ rel: "blocks", id: "OS-T-BBBBB" }] }));
    expect(local.blockedBy("OS-T-BBBBB")).toEqual([]);
    expect(local.version("task")).not.toBe(before);
    expect(local.version("idea")).toBe(ideasBefore);
    local.remove("records/tasks/OS-T-AAAAA--example.md");
    expect(local.has("OS-T-AAAAA")).toBe(false);
    expect(local.list("task").map((r) => r.id)).toEqual(["OS-T-BBBBB"]);
  });

  it("keeps the first path for duplicate IDs and falls back when it goes", () => {
    const local = new RecordIndex([idea("OS-I-2HD9W"), { ...idea("OS-I-2HD9W", { title: "Second" }), path: "records/ideas/OS-I-2HD9W--z.md" }]);
    expect(local.get("OS-I-2HD9W")?.title).toBe("Example");
    local.remove("records/ideas/OS-I-2HD9W--example.md");
    expect(local.get("OS-I-2HD9W")?.title).toBe("Second");
  });
});
