import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderRecord, type Frontmatter } from "@octosprout/core";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PasskeyStore } from "../auth/passkeys.js";
import { SessionStore } from "../auth/sessions.js";
import { git, Sandbox } from "../git/test-helpers.js";
import { GitWriteService } from "../git/write-service.js";
import { buildApp } from "../http/app.js";
import { signIn, TEST_ORIGIN, TEST_RP_ID, TEST_SETUP_TOKEN } from "../http/test-session.js";
import { TokenStore } from "../http/tokens.js";
import { InboxService } from "../inbox/service.js";
import { WorkspaceRecords } from "./workspace.js";

let sandbox: Sandbox;
let stateDir: string;
let writer: GitWriteService;
let records: WorkspaceRecords;
let app: FastifyInstance;
let session: { cookie: string; csrf: string };

const NOW = new Date("2026-10-26T09:38:00Z");
const adrBody = (id: string, status: string, { title = "Example" } = {}) =>
  `# ADR ${id} - ${title}\n* Date: Oct 25, 2026\n* Status: ${status}\n* Author: Test\n\n## Decision\nX\n## Context\nY\n## Options Considered\n### Option 1 (SELECTED): X\n## Advice\n## Supporting Material\n`;
const READY_BODY = "## Objective\nShip it.\n\n## Acceptance criteria\n- [ ] shipped\n\n## Verification\nRun it.\n";

function file(type: string, dir: string, id: string, fields: Frontmatter = {}, body = ""): [string, string] {
  return [
    `${dir}/${id}--example.md`,
    renderRecord({ id, type, schema_version: 1, title: `Example ${id}`, status: "seed", created: "2026-10-25T15:00:00Z", updated: "2026-10-25T15:00:00Z", ...fields }, body),
  ];
}
const ideaFile = (id: string, fields: Frontmatter = {}) => file("idea", "records/ideas", id, fields);
const taskFile = (id: string, fields: Frontmatter = {}, body = READY_BODY) =>
  file("task", "records/tasks", id, { status: "backlog", refs: [{ kind: "repo", url: "https://github.com/bfarkas/x" }], ...fields }, body);

async function seed(...files: Array<[string, string]>): Promise<void> {
  await sandbox.macPush(Object.fromEntries(files));
  await writer.sync();
  records.reindex();
}

beforeEach(async () => {
  sandbox = await Sandbox.create();
  stateDir = mkdtempSync(join(tmpdir(), "octosprout-records-"));
  writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
  records = new WorkspaceRecords(sandbox.server);
  app = buildApp({
    inbox: new InboxService({ writer, repoDir: sandbox.server }),
    tokens: new TokenStore(stateDir),
    auth: {
      passkeys: new PasskeyStore(stateDir),
      sessions: new SessionStore(stateDir),
      rpId: TEST_RP_ID,
      origin: TEST_ORIGIN,
      setupToken: TEST_SETUP_TOKEN,
      status: () => writer.status(),
    },
    records: { records, writer: { ...records.indexing(writer), readBlob: (sha) => writer.readBlob(sha) }, now: () => NOW },
  });
  await app.ready();
  session = await signIn(app);
});

afterEach(async () => {
  await app.close();
  sandbox.dispose();
  rmSync(stateDir, { recursive: true, force: true });
});

const move = (id: string, to: string, baseBlob = records.index.get(id)?.blob ?? "0".repeat(40), headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url: `/api/v1/records/${id}/status`,
    headers: { cookie: session.cookie, origin: TEST_ORIGIN, "x-csrf-token": session.csrf, "content-type": "application/json", ...headers },
    payload: JSON.stringify({ to, base_blob: baseBlob }),
  });

describe("POST /api/v1/records/:id/status", () => {
  it("commits a move and returns the new base_blob", async () => {
    await seed(ideaFile("OS-I-5VT4F"));
    const response = await move("OS-I-5VT4F", "sprouting");
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; commit: string; base_blob: string; unblocked: unknown[] };
    expect(body).toMatchObject({ status: "committed", unblocked: [] });
    expect(body.commit).toBe(await git(sandbox.remote, "rev-parse", "main"));
    expect(await git(sandbox.remote, "log", "-1", "--format=%s")).toBe("status: OS-I-5VT4F seed -> sprouting");
    expect(await git(sandbox.remote, "log", "-1", "--format=%B")).toContain("OctoSprout-Actor: user:web");

    const path = "records/ideas/OS-I-5VT4F--example.md";
    expect(body.base_blob).toBe(await git(sandbox.server, "rev-parse", `HEAD:${path}`));
    const text = readFileSync(join(sandbox.server, path), "utf8");
    expect(text).toContain("status: sprouting\n");
    expect(text).toContain("updated: 2026-10-26T09:38:00Z\n");
    expect(records.index.get("OS-I-5VT4F")?.status).toBe("sprouting");

    // A second move with the returned blob needs no reload.
    expect((await move("OS-I-5VT4F", "ready", body.base_blob)).statusCode).toBe(200);
  });

  it("reports pending when the push fails", async () => {
    await seed(ideaFile("OS-I-5VT4F"));
    await sandbox.goOffline();
    expect((await move("OS-I-5VT4F", "dormant")).json()).toMatchObject({ status: "pending" });
  });

  it("answers unchanged for a move to the current status", async () => {
    await seed(ideaFile("OS-I-5VT4F"));
    expect((await move("OS-I-5VT4F", "seed")).json()).toEqual({ status: "unchanged" });
  });

  it("rejects a move the lifecycle forbids", async () => {
    await seed(ideaFile("OS-I-5VT4F"));
    const response = await move("OS-I-5VT4F", "ready");
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "transition", from: "seed", to: "ready" });
  });

  it.each([
    ["promotion", ideaFile("OS-I-5VT4F", { status: "ready" }), "OS-I-5VT4F", "transplanted"],
    ["approval", file("project", "records/projects", "OS-P-0XZ4K", { status: "active" }, "## Goals\nA\n## Non-goals\nB\n## Scope\nC\n## Success criteria\nD\n"), "OS-P-0XZ4K", "archived"],
    ["approval", file("decision", "records/decisions", "OS-D-4M9TZ", { status: "PROPOSED", template: "harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772" }, adrBody("OS-D-4M9TZ", "PROPOSED", { title: "Example OS-D-4M9TZ" })), "OS-D-4M9TZ", "ACCEPTED"],
  ] as const)("refuses a %s move with 403", async (kind, seeded, id, to) => {
    await seed(seeded);
    const response = await move(id, to);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "approval_required", move: kind, to });
  });

  it("moves a decision's Status line with its status", async () => {
    const id = "OS-D-4M9TZ";
    await seed(file("decision", "records/decisions", id, { status: "DRAFT", template: "harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772" }, adrBody(id, "DRAFT", { title: `Example ${id}` })));
    expect((await move(id, "PROPOSED")).statusCode).toBe(200);
    expect(readFileSync(join(sandbox.server, `records/decisions/${id}--example.md`), "utf8")).toContain("* Status: PROPOSED\n");
  });

  it("returns 409 with base, current and submitted versions when the file changed", async () => {
    const [path] = ideaFile("OS-I-5VT4F");
    await seed(ideaFile("OS-I-5VT4F"));
    const stale = records.index.get("OS-I-5VT4F")!.blob;
    // The Mac moves the idea; the server has not synced yet.
    await sandbox.macPush(Object.fromEntries([ideaFile("OS-I-5VT4F", { status: "dormant" })]));

    const response = await move("OS-I-5VT4F", "sprouting", stale);
    expect(response.statusCode).toBe(409);
    const body = response.json() as Record<string, string>;
    expect(body).toMatchObject({ error: "conflict", path });
    expect(body.base).toContain("status: seed");
    expect(body.current).toContain("status: dormant");
    expect(body.submitted).toContain("status: sprouting");
    expect(body.current_blob).toBe(await git(sandbox.remote, "rev-parse", `main:${path}`));
    expect(await sandbox.remoteLog()).not.toContain("status: OS-I-5VT4F seed -> sprouting");
  });

  it("returns 409 when the client's blob is older than the server's", async () => {
    await seed(ideaFile("OS-I-5VT4F"));
    const stale = records.index.get("OS-I-5VT4F")!.blob;
    await move("OS-I-5VT4F", "dormant");
    const response = await move("OS-I-5VT4F", "sprouting", stale);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ current: expect.stringContaining("status: dormant") });
  });

  it("rejects a move that would make the record invalid", async () => {
    await seed(taskFile("OS-T-QF81M", {}, ""));
    const response = await move("OS-T-QF81M", "ready");
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: "validation", findings: expect.arrayContaining([expect.objectContaining({ code: "OSV009" })]) });
  });

  it("moves the tasks a finished blocker unblocks, in the same commit", async () => {
    await seed(
      taskFile("OS-T-2B7KC", { status: "in_progress", links: [{ rel: "blocks", id: "OS-T-AAAAA" }, { rel: "blocks", id: "OS-T-BBBBB" }] }),
      taskFile("OS-T-AAAAA", { status: "blocked" }),
      taskFile("OS-T-BBBBB", { status: "blocked" }),
      taskFile("OS-T-CCCCC", { status: "in_progress", links: [{ rel: "blocks", id: "OS-T-BBBBB" }] }),
    );
    const response = await move("OS-T-2B7KC", "done");
    expect(response.statusCode).toBe(200);
    const body = response.json() as { unblocked: Array<{ id: string; base_blob: string }> };
    expect(body.unblocked).toEqual([{ id: "OS-T-AAAAA", base_blob: records.index.get("OS-T-AAAAA")!.blob }]);
    expect(records.index.get("OS-T-AAAAA")?.status).toBe("ready");
    expect(records.index.get("OS-T-BBBBB")?.status).toBe("blocked");
    expect(await git(sandbox.remote, "log", "-1", "--format=%s")).toBe("status: OS-T-2B7KC in_progress -> done (+1 unblocked)");
    expect((await git(sandbox.remote, "show", "--name-only", "--format=", "main")).split("\n").sort()).toEqual([
      "records/tasks/OS-T-2B7KC--example.md",
      "records/tasks/OS-T-AAAAA--example.md",
    ]);
  });

  it("needs approval when unblocking would touch more than bulk_threshold records", async () => {
    await seed(
      ["octosprout.yaml", "workspace_schema_version: 1\nid_prefix: OS\nconsequential:\n  bulk_threshold: 1\n"],
      taskFile("OS-T-2B7KC", { status: "in_progress", links: [{ rel: "blocks", id: "OS-T-AAAAA" }] }),
      taskFile("OS-T-AAAAA", { status: "blocked" }),
    );
    expect((await move("OS-T-2B7KC", "done")).json()).toMatchObject({ error: "approval_required", move: "bulk" });
  });

  it("answers 404, 400, and requires a session with CSRF", async () => {
    expect((await move("OS-I-ZZZZZ", "ready")).statusCode).toBe(404);
    await seed(ideaFile("OS-I-5VT4F"));
    expect((await move("OS-I-5VT4F", "sprouting", "not-a-sha")).statusCode).toBe(400);
    expect((await move("OS-I-5VT4F", "sprouting", undefined, { "x-csrf-token": "wrong" })).statusCode).toBe(403);
    expect((await move("OS-I-5VT4F", "sprouting", undefined, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await move("OS-I-5VT4F", "sprouting", undefined, { cookie: "" })).statusCode).toBe(401);
  });
});

describe("GET /api/v1/boards/:board/version", () => {
  const version = (board: string) => app.inject({ method: "GET", url: `/api/v1/boards/${board}/version`, headers: { cookie: session.cookie } });

  it("changes when a card on that board changes", async () => {
    await seed(ideaFile("OS-I-5VT4F"), taskFile("OS-T-QF81M"));
    const ideas = (await version("ideas")).json() as { version: string };
    const tasks = (await version("tasks")).json() as { version: string };
    await move("OS-I-5VT4F", "sprouting");
    expect((await version("ideas")).json()).not.toEqual(ideas);
    expect((await version("tasks")).json()).toEqual(tasks);
    expect((await version("ideas")).headers.etag).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it("answers 404 for an unknown board and 401 without a session", async () => {
    expect((await version("captures")).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/v1/boards/ideas/version" })).statusCode).toBe(401);
  });
});
