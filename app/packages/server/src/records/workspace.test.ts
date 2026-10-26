import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { gitBlobSha, renderRecord } from "@octosprout/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { capturePath, createCapture, git, Sandbox } from "../git/test-helpers.js";
import { GitWriteService } from "../git/write-service.js";
import { WorkspaceRecords } from "./workspace.js";

let sandbox: Sandbox;
beforeEach(async () => {
  sandbox = await Sandbox.create();
});
afterEach(() => sandbox.dispose());

const writer = () => new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
const ideaText = (title: string) =>
  renderRecord({ id: "OS-I-2HD9W", type: "idea", schema_version: 1, title, status: "seed", created: "2026-10-25T15:00:00Z", updated: "2026-10-25T15:00:00Z" }, "");

describe("WorkspaceRecords", () => {
  it("indexes the working tree and refreshes after every write", async () => {
    const records = new WorkspaceRecords(sandbox.server);
    expect(records.index.size).toBe(0);

    await records.indexing(writer()).submit(createCapture("OS-C-7K3QX"));
    const indexed = records.index.get("OS-C-7K3QX");
    expect(indexed?.path).toBe(capturePath("OS-C-7K3QX"));
    expect(indexed?.blob).toBe(await git(sandbox.server, "rev-parse", `HEAD:${capturePath("OS-C-7K3QX")}`));
  });

  it("refreshes the touched paths when a write fails", async () => {
    const records = new WorkspaceRecords(sandbox.server);
    const write = records.indexing(writer());
    await write.submit(createCapture("OS-C-7K3QX"));
    // The same capture again: the precondition (no file) fails.
    await expect(write.submit(createCapture("OS-C-7K3QX", { source: "web" }))).rejects.toThrow(/changed since/);
    expect(records.index.get("OS-C-7K3QX")?.frontmatter.source).toBe("cli");
  });

  it("picks up changes from other clones on reindex", async () => {
    const records = new WorkspaceRecords(sandbox.server);
    await sandbox.macPush({ "records/ideas/OS-I-2HD9W--idea.md": ideaText("From the Mac") });
    await writer().sync();
    expect(records.index.has("OS-I-2HD9W")).toBe(false);
    records.reindex();
    expect(records.index.get("OS-I-2HD9W")?.title).toBe("From the Mac");
  });

  it("re-reads and drops single paths", () => {
    const records = new WorkspaceRecords(sandbox.server);
    const path = "records/ideas/OS-I-2HD9W--idea.md";
    mkdirSync(join(sandbox.server, "records/ideas"), { recursive: true });
    writeFileSync(join(sandbox.server, path), ideaText("Local"));
    records.refresh([path]);
    expect(records.index.get("OS-I-2HD9W")?.blob).toBe(gitBlobSha(ideaText("Local")));
    rmSync(join(sandbox.server, path));
    records.refresh([path]);
    expect(records.index.has("OS-I-2HD9W")).toBe(false);
  });
});
