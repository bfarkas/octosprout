import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderRecord, validateDirectory, type Frontmatter } from "@octosprout/core";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { keyEntry, signingKeyFrom, type SigningKey } from "../approvals/signing-key.js";
import { PasskeyStore } from "../auth/passkeys.js";
import { SessionStore } from "../auth/sessions.js";
import { git, Sandbox } from "../git/test-helpers.js";
import { GitWriteService } from "../git/write-service.js";
import { buildApp } from "../http/app.js";
import { signIn, TEST_ORIGIN, TEST_RP_ID, TEST_SETUP_TOKEN } from "../http/test-session.js";
import { TokenStore } from "../http/tokens.js";
import { InboxService } from "../inbox/service.js";
import { ProposalService } from "./proposals.js";
import { WorkspaceRecords } from "./workspace.js";

let sandbox: Sandbox;
let stateDir: string;
let writer: GitWriteService;
let records: WorkspaceRecords;
let app: FastifyInstance;
let session: { cookie: string; csrf: string };
let key: SigningKey;
let clock: number;

const BRIEF = "## Goals\nA\n\n## Non-goals\nB\n\n## Scope\nC\n\n## Success criteria\nD\n";
const ADR = (id: string, status: string) =>
  `# ADR ${id} - Example ${id}\n* Date: Oct 25, 2026\n* Status: ${status}\n* Author: Test\n\n## Decision\nX\n## Context\nY\n## Options Considered\n### Option 1 (SELECTED): X\n#### Consequences\n * Adopted because: it works\n## Advice\n## Supporting Material\n`;

function file(type: string, dir: string, id: string, fields: Frontmatter = {}, body = ""): [string, string] {
  return [
    `${dir}/${id}--example.md`,
    renderRecord({ id, type, schema_version: 1, title: `Example ${id}`, status: "seed", created: "2026-10-25T15:00:00Z", updated: "2026-10-25T15:00:00Z", ...fields }, body),
  ];
}
const config = (trusted: boolean): [string, string] => ["octosprout.yaml", `workspace_schema_version: 1\nid_prefix: OS\napproval_public_keys:${trusted ? `\n${keyEntry(key)}` : " []\n"}`];

async function seed(...files: Array<[string, string]>): Promise<void> {
  await sandbox.macPush(Object.fromEntries(files));
  await writer.sync();
  records.reindex();
}

function build(withKey = true): FastifyInstance {
  const deps = { records, writer: { ...records.indexing(writer), readBlob: (sha: string) => writer.readBlob(sha), history: (path: string, limit?: number) => writer.history(path, limit) }, now: () => new Date("2026-10-27T10:00:00Z") };
  const proposals = new ProposalService({ ...deps, ...(withKey ? { signingKey: key } : {}), head: async () => (await writer.status()).head });
  return buildApp({
    inbox: new InboxService({ writer, repoDir: sandbox.server }),
    tokens: new TokenStore(stateDir),
    auth: {
      passkeys: new PasskeyStore(stateDir),
      sessions: new SessionStore(stateDir),
      rpId: TEST_RP_ID,
      origin: TEST_ORIGIN,
      setupToken: TEST_SETUP_TOKEN,
      now: () => clock,
      status: () => writer.status(),
    },
    records: { ...deps, proposals },
  });
}

beforeEach(async () => {
  sandbox = await Sandbox.create();
  stateDir = mkdtempSync(join(tmpdir(), "octosprout-proposals-"));
  clock = Date.now();
  key = signingKeyFrom(generateKeyPairSync("ed25519").privateKey);
  writer = new GitWriteService({ repoDir: sandbox.server, retryBaseMs: 1, lockTimeoutMs: 2000, networkTimeoutMs: 5000 });
  records = new WorkspaceRecords(sandbox.server);
  app = build();
  await app.ready();
  session = await signIn(app);
});

afterEach(async () => {
  await app.close();
  sandbox.dispose();
  rmSync(stateDir, { recursive: true, force: true });
});

const post = (url: string, payload: unknown = {}) =>
  app.inject({ method: "POST", url, headers: { cookie: session.cookie, origin: TEST_ORIGIN, "x-csrf-token": session.csrf, "content-type": "application/json" }, payload: JSON.stringify(payload) });
const blob = (id: string) => records.index.get(id)!.blob;
const errors = () => validateDirectory(sandbox.server).filter((f) => f.severity === "error");
const lastSubject = () => git(sandbox.remote, "log", "-1", "--format=%s", "main");

describe("trusting the server's key", () => {
  it("adds the key to octosprout.yaml with a self-signed proposal, in one commit", async () => {
    await seed(config(false));
    const response = await post("/api/v1/approval-key/trust");
    expect(response.statusCode).toBe(200);
    expect(readFileSync(join(sandbox.server, "octosprout.yaml"), "utf8")).toContain(key.publicKey);
    expect(await lastSubject()).toMatch(/^apply-proposal: OS-PROP-[0-9A-Z]{5} Trust the server's approval key server-/);
    expect(errors()).toEqual([]);
    // Once a key is trusted, this shortcut is gone.
    expect((await post("/api/v1/approval-key/trust")).json()).toMatchObject({ error: "invalid" });
  });

  it("trusts a new key after the owner retired a lost one, keeping the retired key for old approvals", async () => {
    const lost = signingKeyFrom(generateKeyPairSync("ed25519").privateKey);
    await seed(["octosprout.yaml", `workspace_schema_version: 1\nid_prefix: OS\napproval_public_keys:\n${keyEntry(lost)}    status: retired\n`]);
    expect((await post("/api/v1/approval-key/trust")).statusCode).toBe(200);
    const yaml = readFileSync(join(sandbox.server, "octosprout.yaml"), "utf8");
    expect(yaml).toContain(lost.publicKey);
    expect(yaml).toContain("status: retired");
    expect(yaml).toContain(key.publicKey);
    expect(errors()).toEqual([]);
  });

  it("refuses while another key is still active", async () => {
    const other = signingKeyFrom(generateKeyPairSync("ed25519").privateKey);
    await seed(["octosprout.yaml", `workspace_schema_version: 1\nid_prefix: OS\napproval_public_keys:\n${keyEntry(other)}`]);
    expect((await post("/api/v1/approval-key/trust")).json()).toMatchObject({ error: "invalid" });
  });

  it("needs a recent passkey verification", async () => {
    await seed(config(false));
    clock += 10 * 60 * 1000;
    expect((await post("/api/v1/approval-key/trust")).json()).toMatchObject({ error: "reverify_required" });
  });
});

describe("consequential moves from the board", () => {
  it("accepts a decision with a signed approval in one commit", async () => {
    await seed(config(true), file("decision", "records/decisions", "OS-D-4M9TZ", { status: "PROPOSED", template: "harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772" }, ADR("OS-D-4M9TZ", "PROPOSED")));
    const asked = await post("/api/v1/records/OS-D-4M9TZ/status", { to: "ACCEPTED", base_blob: blob("OS-D-4M9TZ") });
    expect(asked.statusCode).toBe(403);
    expect(asked.json()).toMatchObject({ error: "approval_required", ok: true, classification: { consequential: true }, diff: [expect.objectContaining({ path: "records/decisions/OS-D-4M9TZ--example.md" })] });

    const response = await post("/api/v1/records/OS-D-4M9TZ/status", { to: "ACCEPTED", base_blob: blob("OS-D-4M9TZ"), approve: true });
    expect(response.statusCode).toBe(200);
    const { proposal } = response.json() as { proposal: string };
    const decision = records.index.get("OS-D-4M9TZ")!;
    expect(decision).toMatchObject({ status: "ACCEPTED", approval: proposal });
    expect(decision.body).toContain("* Status: ACCEPTED");
    expect(records.index.get(proposal)).toMatchObject({ status: "applied" });
    expect((await git(sandbox.remote, "show", "--name-only", "--format=", "main")).split("\n").filter(Boolean)).toHaveLength(2);
    expect(errors()).toEqual([]);
  });

  it("archives an active project, and refuses without a fresh passkey", async () => {
    await seed(config(true), file("project", "records/projects", "OS-P-0XZ4K", { status: "active" }, BRIEF));
    clock += 6 * 60 * 1000;
    expect((await post("/api/v1/records/OS-P-0XZ4K/status", { to: "archived", base_blob: blob("OS-P-0XZ4K"), approve: true })).statusCode).toBe(428);
    clock -= 6 * 60 * 1000;
    expect((await post("/api/v1/records/OS-P-0XZ4K/status", { to: "archived", base_blob: blob("OS-P-0XZ4K"), approve: true })).statusCode).toBe(200);
    expect(records.index.get("OS-P-0XZ4K")?.status).toBe("archived");
    expect(errors()).toEqual([]);
  });

  it("refuses a SUPERSEDED move without a newer decision, and needs a key", async () => {
    await seed(config(true), file("decision", "records/decisions", "OS-D-4M9TZ", { status: "PROPOSED", template: "harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772" }, ADR("OS-D-4M9TZ", "PROPOSED")));
    await post("/api/v1/records/OS-D-4M9TZ/status", { to: "ACCEPTED", base_blob: blob("OS-D-4M9TZ"), approve: true });
    const superseded = await post("/api/v1/records/OS-D-4M9TZ/status", { to: "SUPERSEDED", base_blob: blob("OS-D-4M9TZ"), approve: true });
    expect(superseded.json()).toMatchObject({ error: "validation", findings: expect.arrayContaining([expect.objectContaining({ code: "OSV004" })]) });

    await app.close();
    app = build(false);
    await app.ready();
    session = await signIn(app);
    expect((await post("/api/v1/records/OS-D-4M9TZ/status", { to: "EXPIRED", base_blob: blob("OS-D-4M9TZ"), approve: true })).statusCode).toBe(503);
  });

  it("applies an approved edit to an active project's brief", async () => {
    await seed(config(true), file("project", "records/projects", "OS-P-0XZ4K", { status: "active" }, BRIEF));
    const edit = { base_blob: blob("OS-P-0XZ4K"), form: { body: BRIEF.replace("C\n", "C, and D\n") } };
    expect((await app.inject({ method: "PUT", url: "/api/v1/records/OS-P-0XZ4K", headers: { cookie: session.cookie, origin: TEST_ORIGIN, "x-csrf-token": session.csrf, "content-type": "application/json" }, payload: JSON.stringify(edit) })).statusCode).toBe(403);
    const approved = await app.inject({ method: "PUT", url: "/api/v1/records/OS-P-0XZ4K", headers: { cookie: session.cookie, origin: TEST_ORIGIN, "x-csrf-token": session.csrf, "content-type": "application/json" }, payload: JSON.stringify({ ...edit, approve: true }) });
    expect(approved.statusCode).toBe(200);
    expect(records.index.get("OS-P-0XZ4K")?.body).toContain("C, and D");
    expect(errors()).toEqual([]);
  });
});

describe("proposals", () => {
  const propose = (operations: unknown[], title = "Move it") => post("/api/v1/proposals", { title, rationale: "Because.", operations });

  it("are created pending, then approved with a signed approval", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F"));
    const created = await propose([{ op: "set_status", id: "OS-I-5VT4F", base_blob: blob("OS-I-5VT4F"), status: "sprouting" }]);
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };
    expect(records.index.get(id)).toMatchObject({ status: "pending", frontmatter: { consequential: false, origin: { actor: "user:web" } } });
    expect(await lastSubject()).toBe(`propose: ${id} Move it`);

    const approved = await post(`/api/v1/proposals/${id}/approve`);
    expect(approved.json()).toMatchObject({ status: "committed", proposal: id });
    expect(records.index.get("OS-I-5VT4F")?.status).toBe("sprouting");
    expect(records.index.get(id)?.status).toBe("applied");
    expect(errors()).toEqual([]);
    expect((await post(`/api/v1/proposals/${id}/approve`)).json()).toMatchObject({ error: "not_pending" });
  });

  it("become stale when the record changed, and can then be rejected", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F"));
    const { id } = (await propose([{ op: "set_status", id: "OS-I-5VT4F", base_blob: blob("OS-I-5VT4F"), status: "sprouting" }])).json() as { id: string };
    await post("/api/v1/records/OS-I-5VT4F/status", { to: "dormant", base_blob: blob("OS-I-5VT4F") });
    expect((await post(`/api/v1/proposals/${id}/approve`)).json()).toMatchObject({ error: "stale" });
    expect(records.index.get(id)?.status).toBe("stale");
    expect((await post(`/api/v1/proposals/${id}/reject`)).statusCode).toBe(200);
    expect(records.index.get(id)).toMatchObject({ status: "rejected", frontmatter: { approval: { decision: "rejected" } } });
    expect(errors()).toEqual([]);
  });

  it("bulk-approve routine proposals only", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F", { status: "ready" }), file("idea", "records/ideas", "OS-I-6Q3D2"));
    const routine = (await propose([{ op: "set_status", id: "OS-I-6Q3D2", base_blob: blob("OS-I-6Q3D2"), status: "sprouting" }])).json() as { id: string };
    const consequential = (await propose([{ op: "delete", id: "OS-I-5VT4F", base_blob: blob("OS-I-5VT4F") }], "Delete it")).json() as { id: string };
    expect(records.index.get(consequential.id)?.frontmatter.consequential).toBe(true);
    const response = await post("/api/v1/proposals/approve-bulk", { ids: [routine.id, consequential.id] });
    expect(response.json()).toEqual({ results: [{ id: routine.id, result: "committed" }, { id: consequential.id, result: "reverify_required" }] });
    expect(records.index.get("OS-I-5VT4F")).toBeDefined();
  });

  it("refuse operations that do not apply", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F"));
    expect((await propose([{ op: "set_status", id: "OS-I-5VT4F", base_blob: "0".repeat(40), status: "sprouting" }])).statusCode).toBe(422);
    expect((await propose([])).json()).toMatchObject({ error: "invalid", message: expect.stringContaining("at least one") });
    expect((await post("/api/v1/proposals", { operations: [] })).json()).toMatchObject({ field: "title" });
  });
});

describe("pages", () => {
  const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie: session.cookie, accept: "text/html" } });

  it("Settings offers to trust the key only while none is trusted", async () => {
    await seed(config(false));
    expect((await get("/settings")).body).toContain('data-action="trust-key"');
    await post("/api/v1/approval-key/trust");
    const html = (await get("/settings")).body;
    expect(html).not.toContain('data-action="trust-key"');
    expect(html).toContain(`Approvals are signed with <span class="mono">${key.id}</span>`);
  });

  it("the boards enable approval moves once the key is trusted", async () => {
    const decision = file("decision", "records/decisions", "OS-D-4M9TZ", { status: "PROPOSED", template: "harmel-law-adr@1775d49516784bee6824fcd02556926121a7e772" }, ADR("OS-D-4M9TZ", "PROPOSED"));
    await seed(config(false), decision);
    expect((await get("/decisions")).body).toContain('<option value="ACCEPTED" data-kind="approval" disabled>Accept… (needs the approval key)</option>');
    await post("/api/v1/approval-key/trust");
    const html = (await get("/decisions")).body;
    expect(html).toContain('<option value="ACCEPTED" data-kind="approval">Accept…</option>');
    expect(html).toContain('data-moves="DRAFT ACCEPTED"');
    expect(html).toContain('<script src="/static/approve.js" defer>');
  });

  it("Proposals lists pending proposals with their diff, and the history", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F"), file("idea", "records/ideas", "OS-I-6Q3D2"));
    const routine = (await post("/api/v1/proposals", { title: "Explore <it>", rationale: "**Because**.", operations: [{ op: "set_status", id: "OS-I-5VT4F", base_blob: blob("OS-I-5VT4F"), status: "sprouting" }] })).json() as { id: string };
    const removal = (await post("/api/v1/proposals", { title: "Remove", operations: [{ op: "delete", id: "OS-I-6Q3D2", base_blob: blob("OS-I-6Q3D2") }] })).json() as { id: string };
    let html = (await get("/proposals")).body;
    expect(html).toContain("2 open");
    expect(html).toContain("Explore &lt;it&gt;");
    expect(html).toContain("<strong>Because</strong>");
    expect(html).toContain('<span class="del">- status: seed\n</span>');
    expect(html).toContain('<span class="add">+ status: sprouting\n</span>');
    expect(html).toMatch(new RegExp(`id="${routine.id}"[^>]*data-consequential="false"`));
    expect(html).toMatch(new RegExp(`id="${removal.id}"[^>]*data-consequential="true"`));
    expect(html).toContain("Approve with passkey");
    expect(html).toContain('data-action="approve-bulk"');

    await post(`/api/v1/proposals/${routine.id}/approve`);
    html = (await get("/proposals")).body;
    expect(html).toContain("1 open");
    expect(html).toContain(`<span class="badge applied">applied</span>`);
  });
});

describe("promotion", () => {
  const promote = (payload: Record<string, unknown>) => post("/api/v1/ideas/OS-I-5VT4F/promote", { base_blob: blob("OS-I-5VT4F"), title: "Weekly digest", status: "proposed", body: "## Goals\nA\n", tasks: ["Pick a day", " ", "Write the template"], ...payload });

  it("previews, then creates the project and tasks and transplants the idea in one approved commit", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F", { status: "ready" }), file("research", "records/research", "OS-R-B7N2C", { status: "open", links: [{ rel: "supports", id: "OS-I-5VT4F" }] }));
    const preview = await promote({});
    expect(preview.statusCode).toBe(403);
    expect(preview.json()).toMatchObject({ error: "approval_required", classification: { consequential: true } });
    expect((preview.json() as { diff: unknown[] }).diff).toHaveLength(4);

    const response = await promote({ approve: true, rationale: "It is time." });
    expect(response.statusCode).toBe(200);
    const { project, proposal } = response.json() as { project: string; proposal: string };
    expect(records.index.get(project)).toMatchObject({ type: "project", status: "proposed", title: "Weekly digest", body: "## Goals\nA\n" });
    const tasks = records.index.backlinks(project).filter((b) => b.rel === "belongs_to").map((b) => b.source.title).sort();
    expect(tasks).toEqual(["Pick a day", "Write the template"]);
    expect(records.index.get("OS-I-5VT4F")).toMatchObject({ status: "transplanted", approval: proposal, links: [{ rel: "promoted_to", id: project }] });
    expect(records.index.get(proposal)?.body).toContain("It is time.");
    expect((await git(sandbox.remote, "show", "--name-only", "--format=", "main")).split("\n").filter(Boolean)).toHaveLength(5);
    expect(errors()).toEqual([]);
  });

  it("refuses an idea that is not ready, a stale page and a bad request", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F", { status: "sprouting" }));
    expect((await promote({ approve: true })).json()).toMatchObject({ error: "transition" });
    await seed(file("idea", "records/ideas", "OS-I-5VT4F", { status: "ready" }));
    expect((await promote({ approve: true, base_blob: "1".repeat(40) })).statusCode).toBe(409);
    expect((await promote({ status: "done" })).json()).toMatchObject({ field: "status" });
    expect((await promote({ title: "" })).json()).toMatchObject({ field: "title" });
  });

  it("refuses an active project without its brief sections", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F", { status: "ready" }));
    const response = await promote({ approve: true, status: "active" });
    expect(response.json()).toMatchObject({ error: "validation", findings: expect.arrayContaining([expect.objectContaining({ code: "OSV009" })]) });
    expect(records.index.get("OS-I-5VT4F")?.status).toBe("ready");
  });

  it("the wizard page shows the idea, its research and a brief that references them", async () => {
    await seed(config(true), file("idea", "records/ideas", "OS-I-5VT4F", { status: "ready" }), file("research", "records/research", "OS-R-B7N2C", { status: "open", title: "Digest survey", links: [{ rel: "supports", id: "OS-I-5VT4F" }] }));
    const html = (await app.inject({ method: "GET", url: "/ideas/OS-I-5VT4F/promote", headers: { cookie: session.cookie, accept: "text/html" } })).body;
    expect(html).toContain('<a href="/records/OS-R-B7N2C">Digest survey</a>');
    expect(html).toContain("## Related\n\n- Idea OS-I-5VT4F\n- Digest survey (OS-R-B7N2C)");
    expect(html).toMatch(/<button type="submit">Review and approve…<\/button>/);
    const board = (await app.inject({ method: "GET", url: "/ideas", headers: { cookie: session.cookie, accept: "text/html" } })).body;
    expect(board).toContain('<option value="transplanted" data-kind="promotion">Promote…</option>');
  });
});
