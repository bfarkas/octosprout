import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireFileLock, LockTimeoutError } from "./lock.js";
import { capturePath, captureText, createCapture, git, Sandbox } from "./test-helpers.js";
import {
  ConflictError,
  GitWriteService,
  InvalidOperationError,
  ValidationRejectedError,
  type GitWriteServiceOptions,
  type WriteOperation,
} from "./write-service.js";

let sandbox: Sandbox;
beforeEach(async () => {
  sandbox = await Sandbox.create();
});
afterEach(() => sandbox.dispose());

const service = (options: Partial<GitWriteServiceOptions> = {}) =>
  new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000, ...options });

const blobOf = (cwd: string, path: string) => git(cwd, "rev-parse", `HEAD:${path}`);

/** Status edit for an existing capture: allowed after creation, and leaves the body hash intact. */
async function setStatus(id: string, status: string, baseBlob: string): Promise<WriteOperation> {
  return {
    operation: "triage",
    actor: "user:web",
    subject: `status: ${id} -> ${status}`,
    preconditions: [{ path: capturePath(id), baseBlob }],
    changes: [{ path: capturePath(id), content: captureText(id, { status }) }],
  };
}

describe("committing", () => {
  it("commits, pushes and reports the commit", async () => {
    const result = await service().submit(createCapture("OS-C-AAAAA"));
    expect(result.status).toBe("committed");
    expect(await git(sandbox.remote, "rev-parse", "main")).toBe((result as { commit: string }).commit);
    expect(await git(sandbox.remote, "show", `main:${capturePath("OS-C-AAAAA")}`)).toContain("OS-C-AAAAA");
  });

  it("attributes the commit and adds trailers", async () => {
    await service().submit({ ...createCapture("OS-C-AAAAA"), proposal: "OS-PROP-8V3KD" });
    expect(await git(sandbox.remote, "log", "-1", "--format=%an <%ae>")).toBe("OctoSprout <octosprout@octosprout.de>");
    const message = await git(sandbox.remote, "log", "-1", "--format=%B");
    expect(message).toContain("capture: OS-C-AAAAA (test)");
    expect(message).toContain("OctoSprout-Operation: capture");
    expect(message).toContain("OctoSprout-Actor: token:test");
    expect(message).toContain("OctoSprout-Proposal: OS-PROP-8V3KD");
  });

  it("serializes concurrent submissions in FIFO order, one commit each", async () => {
    const svc = service();
    const ids = ["OS-C-00001", "OS-C-00002", "OS-C-00003", "OS-C-00004", "OS-C-00005"];
    const results = await Promise.all(ids.map((id) => svc.submit(createCapture(id))));
    expect(results.map((r) => r.status)).toEqual(Array(5).fill("committed"));
    const log = await sandbox.remoteLog();
    expect(log.slice(0, 5)).toEqual([...ids].reverse().map((id) => `capture: ${id} (test)`));
  });

  it("makes exactly one commit for a multi-record operation", async () => {
    const before = Number(await git(sandbox.server, "rev-list", "--count", "HEAD"));
    await service().submit({
      ...createCapture("OS-C-AAAAA"),
      changes: [
        { path: capturePath("OS-C-AAAAA"), content: captureText("OS-C-AAAAA") },
        { path: capturePath("OS-C-BBBBB"), content: captureText("OS-C-BBBBB") },
      ],
    });
    expect(Number(await git(sandbox.server, "rev-list", "--count", "HEAD"))).toBe(before + 1);
    expect(existsSync(join(sandbox.server, capturePath("OS-C-BBBBB")))).toBe(true);
  });

  it("reports unchanged when nothing differs", async () => {
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    const blob = await blobOf(sandbox.server, capturePath("OS-C-AAAAA"));
    const same = await setStatus("OS-C-AAAAA", "new", blob);
    expect(await svc.submit(same)).toEqual({ status: "unchanged" });
  });

  it("deletes files", async () => {
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    const blob = await blobOf(sandbox.server, capturePath("OS-C-AAAAA"));
    await svc.submit({
      operation: "edit",
      actor: "user:web",
      subject: "delete",
      preconditions: [{ path: capturePath("OS-C-AAAAA"), baseBlob: blob }],
      changes: [{ path: capturePath("OS-C-AAAAA"), delete: true }],
    });
    expect(existsSync(join(sandbox.server, capturePath("OS-C-AAAAA")))).toBe(false);
    expect(await git(sandbox.server, "status", "--porcelain")).toBe("");
  });

  it.each(["../escape.md", "/etc/passwd", ".git/config", "records/../../x", "a//b.md", "", "a\\b.md", "records/.GIT/hooks/x"])(
    "rejects the path %j",
    async (path) => {
      const op: WriteOperation = { ...createCapture("OS-C-AAAAA"), preconditions: [], changes: [{ path, content: "x" }] };
      await expect(service().submit(op)).rejects.toBeInstanceOf(InvalidOperationError);
    },
  );

  it("requires the clone to be on the configured branch", async () => {
    await git(sandbox.server, "checkout", "-q", "-b", "other");
    await expect(service().submit(createCapture("OS-C-AAAAA"))).rejects.toThrow(/'main' checked out/);
  });
});

describe("concurrency with other writers", () => {
  it("picks up unrelated changes pushed from the Mac without conflict", async () => {
    await sandbox.macPush({ [capturePath("OS-C-MAC00")]: captureText("OS-C-MAC00") });
    const result = await service().submit(createCapture("OS-C-AAAAA"));
    expect(result.status).toBe("committed");
    expect(existsSync(join(sandbox.server, capturePath("OS-C-MAC00")))).toBe(true);
  });

  it("retries after a non-fast-forward rejection without rewriting remote history", async () => {
    let pushedFromMac = false;
    const result = await service({
      onBeforePush: async () => {
        if (pushedFromMac) return;
        pushedFromMac = true;
        await sandbox.macPush({ [capturePath("OS-C-MAC00")]: captureText("OS-C-MAC00") }, "mac: capture");
      },
    }).submit(createCapture("OS-C-AAAAA"));

    expect(result.status).toBe("committed");
    expect(await sandbox.remoteLog()).toEqual(["capture: OS-C-AAAAA (test)", "mac: capture", "first commit"]);
  });

  it("reports a stale base_blob up front, with the current content", async () => {
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    const staleBlob = await blobOf(sandbox.server, capturePath("OS-C-AAAAA"));
    await svc.submit(await setStatus("OS-C-AAAAA", "composted", staleBlob));

    const error = await svc.submit(await setStatus("OS-C-AAAAA", "planted", staleBlob)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).current?.toString()).toContain("status: composted");
    expect(await git(sandbox.server, "status", "--porcelain")).toBe("");
  });

  it("detects a conflicting remote change that arrives after the commit, and drops the commit", async () => {
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    const blob = await blobOf(sandbox.server, capturePath("OS-C-AAAAA"));
    const headBefore = await git(sandbox.server, "rev-parse", "HEAD");

    // The Mac edits a different line of the same file, so the rebase itself succeeds
    // but the blob the client read is no longer current.
    const error = await service({
      onBeforePush: () =>
        sandbox.macPush({ [capturePath("OS-C-AAAAA")]: captureText("OS-C-AAAAA", { updated: "2026-10-26T09:00:00Z" }) }),
    })
      .submit(await setStatus("OS-C-AAAAA", "composted", blob))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(await git(sandbox.server, "rev-parse", "HEAD")).not.toBe(headBefore); // fetched the Mac commit
    expect(await git(sandbox.server, "rev-parse", "HEAD")).toBe(await git(sandbox.remote, "rev-parse", "main"));
    expect(readFileSync(join(sandbox.server, capturePath("OS-C-AAAAA")), "utf8")).toContain("status: new");
    expect(await git(sandbox.server, "status", "--porcelain")).toBe("");
  });

  it("reports a textual rebase conflict as a conflict and preserves the remote's version", async () => {
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    const blob = await blobOf(sandbox.server, capturePath("OS-C-AAAAA"));

    const error = await service({
      onBeforePush: () => sandbox.macPush({ [capturePath("OS-C-AAAAA")]: captureText("OS-C-AAAAA", { status: "planted" }) }),
    })
      .submit(await setStatus("OS-C-AAAAA", "composted", blob))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).current?.toString()).toContain("status: planted");
    expect(await git(sandbox.server, "rev-parse", "HEAD")).toBe(await git(sandbox.remote, "rev-parse", "main"));
  });

  it("re-validates against the rebased state", async () => {
    // The Mac pushes a record that makes the server's pending capture a duplicate ID.
    const error = await service({
      onBeforePush: () => sandbox.macPush({ "records/captures/2026/11/OS-C-AAAAA.md": captureText("OS-C-AAAAA") }),
    })
      .submit(createCapture("OS-C-AAAAA"))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationRejectedError);
    expect((error as ValidationRejectedError).findings.map((f) => f.code)).toContain("OSV002");
    expect(existsSync(join(sandbox.server, capturePath("OS-C-AAAAA")))).toBe(false);
    expect(await git(sandbox.server, "rev-parse", "HEAD")).toBe(await git(sandbox.remote, "rev-parse", "main"));
  });
});

describe("validation before commit", () => {
  it("rejects a write that adds errors and restores the working tree", async () => {
    const head = await git(sandbox.server, "rev-parse", "HEAD");
    const bad = createCapture("OS-C-AAAAA", { content_sha256: "0".repeat(64) });
    const error = await service().submit(bad).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationRejectedError);
    expect((error as ValidationRejectedError).findings.map((f) => f.code)).toEqual(["OSV006"]);
    expect(await git(sandbox.server, "rev-parse", "HEAD")).toBe(head);
    expect(await git(sandbox.server, "status", "--porcelain")).toBe("");
    expect(existsSync(join(sandbox.server, capturePath("OS-C-AAAAA")))).toBe(false);
  });

  it("leaves nothing behind when the second file of a multi-record operation is invalid", async () => {
    const op: WriteOperation = {
      ...createCapture("OS-C-AAAAA"),
      changes: [
        { path: capturePath("OS-C-AAAAA"), content: captureText("OS-C-AAAAA") },
        { path: capturePath("OS-C-BBBBB"), content: captureText("OS-C-BBBBB", { content_sha256: "f".repeat(64) }) },
      ],
    };
    await expect(service().submit(op)).rejects.toBeInstanceOf(ValidationRejectedError);
    expect(existsSync(join(sandbox.server, capturePath("OS-C-AAAAA")))).toBe(false);
    expect(existsSync(join(sandbox.server, capturePath("OS-C-BBBBB")))).toBe(false);
    expect(await git(sandbox.server, "status", "--porcelain")).toBe("");
  });

  it("restores an edited file to its previous content", async () => {
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    const original = readFileSync(join(sandbox.server, capturePath("OS-C-AAAAA")), "utf8");
    const blob = await blobOf(sandbox.server, capturePath("OS-C-AAAAA"));
    const tamper: WriteOperation = {
      operation: "edit",
      actor: "user:web",
      subject: "tamper",
      preconditions: [{ path: capturePath("OS-C-AAAAA"), baseBlob: blob }],
      changes: [{ path: capturePath("OS-C-AAAAA"), content: `${original}tampered` }],
    };
    await expect(svc.submit(tamper)).rejects.toBeInstanceOf(ValidationRejectedError);
    expect(readFileSync(join(sandbox.server, capturePath("OS-C-AAAAA")), "utf8")).toBe(original);
    expect(await git(sandbox.server, "status", "--porcelain")).toBe("");
  });

  it("tolerates existing errors but still rejects new ones", async () => {
    await sandbox.macPush({ [capturePath("OS-C-BADBA")]: captureText("OS-C-BADBA", { content_sha256: "0".repeat(64) }) });
    const svc = service();
    expect((await svc.submit(createCapture("OS-C-AAAAA"))).status).toBe("committed");

    const error = await svc.submit(createCapture("OS-C-CCCCC", { content_sha256: "0".repeat(64) })).catch((e: unknown) => e);
    expect((error as ValidationRejectedError).findings.map((f) => f.path)).toEqual([capturePath("OS-C-CCCCC")]);
  });
});

describe("the pending journal", () => {
  it("keeps a commit locally when the remote is unreachable, then pushes it on sync", async () => {
    await sandbox.goOffline();
    const svc = service();
    const result = await svc.submit(createCapture("OS-C-AAAAA"));
    expect(result.status).toBe("pending");
    expect((await svc.status()).pending).toBe(1);
    expect(await sandbox.remoteLog()).toEqual(["first commit"]);

    await sandbox.goOnline();
    expect((await svc.sync()).pending).toBe(0);
    expect(await sandbox.remoteLog()).toEqual(["capture: OS-C-AAAAA (test)", "first commit"]);
  });

  it("survives a restart: a new service instance finds and pushes the pending commit", async () => {
    await sandbox.goOffline();
    await service().submit(createCapture("OS-C-AAAAA"));
    await sandbox.goOnline();

    const restarted = service();
    expect((await restarted.status()).pending).toBe(1);
    await restarted.sync();
    expect((await restarted.status()).pending).toBe(0);
    expect(await sandbox.remoteLog()).toContain("capture: OS-C-AAAAA (test)");
  });

  it("keeps accepting writes while offline and pushes them in order afterwards", async () => {
    await sandbox.goOffline();
    const svc = service();
    await svc.submit(createCapture("OS-C-00001"));
    await svc.submit(createCapture("OS-C-00002"));
    expect((await svc.status()).pending).toBe(2);

    await sandbox.goOnline();
    await svc.sync();
    expect((await sandbox.remoteLog()).slice(0, 2)).toEqual(["capture: OS-C-00002 (test)", "capture: OS-C-00001 (test)"]);
  });

  it("rebases pending commits onto changes pushed while offline", async () => {
    await sandbox.goOffline();
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    await sandbox.macPush({ [capturePath("OS-C-MAC00")]: captureText("OS-C-MAC00") }, "mac: capture");

    await sandbox.goOnline();
    expect((await svc.sync()).pending).toBe(0);
    expect(await sandbox.remoteLog()).toEqual(["capture: OS-C-AAAAA (test)", "mac: capture", "first commit"]);
  });

  it("preserves a pending commit that cannot be rebased on a local pending branch", async () => {
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    const blob = await blobOf(sandbox.server, capturePath("OS-C-AAAAA"));

    await sandbox.goOffline();
    expect((await svc.submit(await setStatus("OS-C-AAAAA", "composted", blob))).status).toBe("pending");
    await sandbox.macPush({ [capturePath("OS-C-AAAAA")]: captureText("OS-C-AAAAA", { status: "planted" }) });
    await sandbox.goOnline();

    const synced = await svc.sync();
    expect(synced.pending).toBe(0);
    expect(synced.quarantined).toHaveLength(1);

    const status = await svc.status();
    expect(status.pendingBranches).toEqual(synced.quarantined);
    expect(await git(sandbox.server, "log", "-1", "--format=%s", status.pendingBranches[0]!)).toBe("status: OS-C-AAAAA -> composted");
    expect(await git(sandbox.server, "rev-parse", "HEAD")).toBe(await git(sandbox.remote, "rev-parse", "main"));
    expect(await git(sandbox.server, "status", "--porcelain")).toBe("");
  });

  it("retries in the background until the remote returns", async () => {
    await sandbox.goOffline();
    const svc = service();
    await svc.submit(createCapture("OS-C-AAAAA"));
    const background = svc.startBackgroundSync({ intervalMs: 20, maxBackoffMs: 80 });
    try {
      await sandbox.goOnline();
      const deadline = Date.now() + 10_000;
      while ((await svc.status()).pending > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
      expect((await svc.status()).pending).toBe(0);
    } finally {
      background.stop();
    }
    expect(await sandbox.remoteLog()).toContain("capture: OS-C-AAAAA (test)");
  });
});

describe("the file lock", () => {
  it("makes a write wait for, then fail on, another process holding the lock", async () => {
    const lockPath = join(sandbox.server, ".git", "octosprout.lock");
    const release = await acquireFileLock(lockPath, 1000);
    await expect(service({ lockTimeoutMs: 200 }).submit(createCapture("OS-C-AAAAA"))).rejects.toBeInstanceOf(LockTimeoutError);
    await release();
    expect((await service().submit(createCapture("OS-C-AAAAA"))).status).toBe("committed");
  });
});

describe("reading", () => {
  it("lists the commits that touched a file, newest first, and reads blobs", async () => {
    const writer = service();
    await writer.submit(createCapture("OS-C-7K3QX"));
    await writer.submit({ ...createCapture("OS-C-7K3QX", { tags: ["later"] }), subject: "edit: OS-C-7K3QX", preconditions: [] });
    const history = await writer.history(capturePath("OS-C-7K3QX"));
    expect(history.map((h) => h.subject)).toEqual(["edit: OS-C-7K3QX", "capture: OS-C-7K3QX (test)"]);
    expect(history[0]).toMatchObject({ author: "OctoSprout", commit: expect.stringMatching(/^[0-9a-f]{40}$/), date: expect.stringMatching(/^\d{4}-/) });
    expect(await writer.history("records/none.md")).toEqual([]);

    const blob = await blobOf(sandbox.server, capturePath("OS-C-7K3QX"));
    expect((await writer.readBlob(blob))?.toString()).toContain("tags:");
    expect(await writer.readBlob("0".repeat(40))).toBeNull();
    expect(await writer.readBlob("not-a-sha")).toBeNull();
    expect(await writer.readBlob(history[0]!.commit)).toBeNull();
  });
});
