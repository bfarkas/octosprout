import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { captureText, git, Sandbox } from "../git/test-helpers.js";
import { GitWriteService } from "../git/write-service.js";
import { InboxService } from "./service.js";
import type { InboxRequest } from "./request.js";

let sandbox: Sandbox;
beforeEach(async () => {
  sandbox = await Sandbox.create();
});
afterEach(() => sandbox.dispose());

const writer = () => new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
const inbox = (w = writer(), extra: Partial<ConstructorParameters<typeof InboxService>[0]> = {}) =>
  new InboxService({ writer: w, repoDir: sandbox.server, now: () => new Date("2026-10-25T14:03:11Z"), ...extra });

const request = (overrides: Partial<InboxRequest> = {}): InboxRequest => ({
  text: "Working title: Garden metaphor\n",
  idempotencyKey: "20261025T140310-48213",
  source: "chatgpt",
  ...overrides,
});
const VIA = "token:iphone-shortcut";

describe("creating captures", () => {
  it("commits and pushes a capture, and reports its ID, path and commit", async () => {
    const outcome = await inbox().submit(request(), VIA);
    if (outcome.kind !== "created") throw new Error(`expected created, got ${outcome.kind}`);

    expect(outcome.status).toBe("committed");
    expect(outcome.id).toMatch(/^OS-C-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(outcome.path).toBe(`records/captures/2026/10/${outcome.id}.md`);
    expect(await git(sandbox.remote, "rev-parse", "main")).toBe(outcome.commit);
    expect(await git(sandbox.remote, "log", "-1", "--format=%s")).toBe(`capture: ${outcome.id} (chatgpt)`);
    expect(await git(sandbox.remote, "log", "-1", "--format=%B")).toContain("OctoSprout-Actor: token:iphone-shortcut");
  });

  it("stores the text byte for byte", async () => {
    const text = "  \r\n---\n🌱 trailing  \r\n\n";
    const outcome = await inbox().submit(request({ text }), VIA);
    if (outcome.kind !== "created") throw new Error("expected created");
    expect(readFileSync(`${sandbox.server}/${outcome.path}`, "utf8").endsWith(`\n---\n${text}`)).toBe(true);
  });

  it("reports pending, never committed, while the remote is unreachable", async () => {
    await sandbox.goOffline();
    const outcome = await inbox().submit(request(), VIA);
    expect(outcome).toMatchObject({ kind: "created", status: "pending" });
    expect(await sandbox.remoteLog()).toEqual(["first commit"]);
  });

  it("retries with a new ID when another writer has already taken the first one", async () => {
    // The inbox is built first, so its index does not know the file the Mac pushes next.
    const service = inbox(writer(), { random: sequence(["AAAAA", "BBBBB"]) });
    await sandbox.macPush({ "records/captures/2026/10/OS-C-AAAAA.md": captureText("OS-C-AAAAA") });

    const outcome = await service.submit(request(), VIA);
    expect(outcome).toMatchObject({ kind: "created", id: "OS-C-BBBBB", status: "committed" });
  });
});

describe("idempotency", () => {
  it("answers a replay with the same capture and makes no new commit", async () => {
    const service = inbox();
    const first = await service.submit(request(), VIA);
    const commits = await git(sandbox.remote, "rev-list", "--count", "main");

    const replay = await service.submit(request(), VIA);
    expect(replay).toMatchObject({ kind: "replay", status: "committed" });
    expect(replay).toMatchObject({ id: (first as { id: string }).id, commit: (first as { commit: string }).commit });
    expect(await git(sandbox.remote, "rev-list", "--count", "main")).toBe(commits);
  });

  it("returns a conflict when the key is reused with different text", async () => {
    const service = inbox();
    const first = await service.submit(request(), VIA);
    const second = await service.submit(request({ text: "something else" }), VIA);
    expect(second).toEqual({ kind: "conflict", id: (first as { id: string }).id });
  });

  it("treats whitespace differences as different text", async () => {
    const service = inbox();
    await service.submit(request({ text: "same" }), VIA);
    expect((await service.submit(request({ text: "same " }), VIA)).kind).toBe("conflict");
  });

  it("stores concurrent requests with the same key once", async () => {
    const service = inbox();
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => service.submit(request(), VIA)));
    expect(outcomes.filter((o) => o.kind === "created")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "replay")).toHaveLength(3);
    expect(new Set(outcomes.map((o) => (o as { id: string }).id)).size).toBe(1);
    expect(await git(sandbox.remote, "rev-list", "--count", "main")).toBe("2");
  });

  it("does not create a duplicate when the response was lost after a successful push", async () => {
    await inbox().submit(request(), VIA); // the client never saw this response
    const afterRestart = inbox(); // and retries against a fresh process
    expect((await afterRestart.submit(request(), VIA)).kind).toBe("replay");
    expect(await git(sandbox.remote, "rev-list", "--count", "main")).toBe("2");
  });

  it("reports a replay of a pending capture as pending, then committed once pushed", async () => {
    await sandbox.goOffline();
    const w = writer();
    const service = inbox(w);
    await service.submit(request(), VIA);

    expect(await service.submit(request(), VIA)).toMatchObject({ kind: "replay", status: "pending" });
    expect(await service.statusByKey(request().idempotencyKey)).toMatchObject({ status: "pending" });

    await sandbox.goOnline();
    await w.sync();
    expect(await service.statusByKey(request().idempotencyKey)).toMatchObject({ status: "committed" });
  });

  it("survives a restart with unpushed captures", async () => {
    await sandbox.goOffline();
    await inbox().submit(request(), VIA);
    const restarted = inbox();
    expect((await restarted.submit(request(), VIA)).kind).toBe("replay");
  });

  it("has no status for an unknown key", async () => {
    expect(await inbox().statusByKey("never-seen-key")).toBeUndefined();
  });
});

function sequence(values: string[]): () => string {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}
