import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCommand } from "./commands.js";
import { createMcpServer } from "./mcp.js";
import { makeWorkspace, type TestWorkspace } from "./test-workspace.js";

let ws: TestWorkspace;
let client: Client;

beforeEach(async () => {
  ws = makeWorkspace();
  const server = createMcpServer(ws.root, { actor: "agent:test" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test-client", version: "1" });
  await client.connect(clientSide);
});
afterEach(async () => {
  await client.close();
  ws.dispose();
});

/** A record made directly by a person, through the CLI. */
const make = (...args: string[]): string => makeWith("", ...args);
const makeWith = (stdin: string, ...args: string[]): string => {
  const out: string[] = [];
  expect(runCommand(args[0]!, [...args.slice(1), "--json"], { cwd: ws.root, io: { out: (t) => out.push(t), err: () => {} }, env: {}, stdin: () => stdin })).toBe(0);
  return (JSON.parse(out[out.length - 1]!) as { id: string }).id;
};

const call = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<{ data: T; isError: boolean }> => {
  const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { data: JSON.parse(result.content[0]!.text) as T, isError: result.isError === true };
};

/** A task with the contract a task needs from ready on (§11.2). */
const CONTRACT = "## Objective\n\nDo it.\n\n## Acceptance criteria\n\n- [ ] it is done\n\n## Verification\n\nLook.\n";
const makeTask = (title: string): string => makeWith(CONTRACT, "new", "task", title, "--body-file", "-");

const remoteSubject = () => ws.git("log", "-1", "--format=%s", "origin/main");

describe("octosprout mcp", () => {
  it("lists the read, task and proposal tools of §16.3", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["draft_record", "propose_advice", "get_handoff_context", "report_handoff", "log_progress", "update_task", "get_record", "get_related", "list_inbox", "list_proposals", "propose", "propose_adr", "propose_promotion", "propose_triage", "search_records", "sync", "validate"].sort(),
    );
    expect(tools.find((t) => t.name === "get_record")?.annotations?.readOnlyHint).toBe(true);
  });

  it("reads records, links and the inbox", async () => {
    const project = make("new", "project", "Weekly digest");
    const task = make("new", "task", "Pick a day", "--project", project);
    make("capture", "send it on Mondays");

    const found = await call<Array<{ id: string }>>("search_records", { query: "digest" });
    expect(found.data.map((r) => r.id)).toEqual([project]);
    expect((await call<unknown[]>("search_records", { type: "task" })).data).toHaveLength(1);

    const record = await call<{ base_blob: string; backlinks: unknown[] }>("get_record", { id: project });
    expect(record.data.base_blob).toMatch(/^[0-9a-f]{40}$/);
    expect(record.data.backlinks).toEqual([{ rel: "belongs_to", id: task }]);
    expect((await call<Array<{ id: string }>>("get_related", { id: task })).data.map((r) => r.id)).toEqual([project]);

    const inbox = await call<Array<{ text: string }>>("list_inbox");
    expect(inbox.data.map((c) => c.text)).toEqual(["send it on Mondays"]);
    expect((await call<{ errors: number }>("validate")).data.errors).toBe(0);

    const missing = await call("get_record", { id: "OS-T-ZZZZZ" });
    expect(missing.isError).toBe(true);
  });

  it("propose commits only a proposal file and pushes it", async () => {
    const idea = make("new", "idea", "Digest");
    const { data } = await call<{ base_blob: string }>("get_record", { id: idea });
    const before = ws.git("rev-parse", "HEAD");
    const result = await call<{ kind: string; proposal: string; synced: { pushed: boolean } }>("propose", {
      title: "Move the digest on",
      rationale: "It is being worked on.",
      operations: [{ op: "set_status", id: idea, base_blob: data.base_blob, status: "sprouting" }],
    });
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({ kind: "proposed", synced: { pushed: true } });
    expect(ws.git("diff", "--name-only", before, "HEAD")).toMatch(/^proposals\/.+\.md$/);
    expect(remoteSubject()).toBe(`propose: ${result.data.proposal} Move the digest on`);
    expect(ws.git("log", "-1", "--format=%B")).toContain("OctoSprout-Actor: agent:test");
    // The idea itself is unchanged until the owner approves.
    expect((await call<{ status: string }>("get_record", { id: idea })).data.status).toBe("seed");
    expect((await call<Array<{ id: string }>>("list_proposals", { status: "pending" })).data.map((p) => p.id)).toEqual([result.data.proposal]);
  });

  it("acts only as an agent", () => {
    expect(() => createMcpServer(ws.root, { actor: "cli" })).toThrow(/agent:<name>/);
    expect(() => createMcpServer(ws.root, { actor: "agent:bad name" })).toThrow(/agent:<name>/);
  });

  it("refuses a stale base_blob and a change that would not validate", async () => {
    const idea = make("new", "idea", "Digest");
    const result = await call("propose", { title: "x", rationale: "x", operations: [{ op: "set_status", id: idea, base_blob: "0".repeat(40), status: "sprouting" }] });
    expect(result.isError).toBe(true);
    const { data } = await call<{ base_blob: string }>("get_record", { id: idea });
    const invalid = await call("propose", { title: "x", rationale: "x", operations: [{ op: "set_status", id: idea, base_blob: data.base_blob, status: "growing" }] });
    expect(invalid.isError).toBe(true);
    expect(ws.git("log", "-1", "--format=%s")).not.toMatch(/^propose:/);
  });

  it("drafts a record for a combined proposal", async () => {
    const idea = make("new", "idea", "Digest");
    const draft = await call<{ id: string; path: string; content: string }>("draft_record", { type: "research", title: "Prior art" });
    expect(draft.data.path).toContain(draft.data.id);
    const { data } = await call<{ base_blob: string }>("get_record", { id: idea });
    const result = await call("propose", {
      title: "Research the digest",
      rationale: "x",
      operations: [
        { op: "create", path: draft.data.path, content: draft.data.content },
        { op: "add_link", id: idea, base_blob: data.base_blob, link: { rel: "relates_to", id: draft.data.id } },
      ],
    });
    expect(result.isError).toBe(false);
    expect((await call("draft_record", { type: "task", title: "x", project: idea })).isError).toBe(true);
  });

  it("proposes simulated advice with a new profile", async () => {
    const decision = make("new", "decision", "Poll or push");
    const result = await call<{ kind: string; proposal: string }>("propose_advice", {
      decision,
      model: "claude-opus-5-5",
      new_experts: [{ title: "Operations Lead" }],
      advice: [{ expert: "Operations Lead", role: "Operations", advice: "Push is simpler to run.", long_form: "Polling needs a scheduler." }],
      synthesis: "One perspective; no disagreement.",
      rationale: "Advice before proposing the decision.",
    });
    expect(result.isError).toBe(false);
    expect(ws.git("show", "HEAD:" + ws.git("show", "--name-only", "--format=", "HEAD"))).toContain("Push is simpler to run. - Operations Lead (simulated, AI-generated, claude-opus-5-5), Operations,");
    expect((await call("propose_advice", { decision, model: "m", advice: [{ expert: "Nobody", role: "x", advice: "x" }], rationale: "x" })).isError).toBe(true);
  });

  it("gives the handoff context and commits the report directly", async () => {
    const project = make("new", "project", "Weekly digest");
    const task = makeWith(CONTRACT, "new", "task", "Pick a send day", "--project", project, "--body-file", "-");
    const context = await client.callTool({ name: "get_handoff_context", arguments: { task } });
    const markdown = (context.content as Array<{ text: string }>)[0]!.text;
    expect(markdown).toContain(`# Handoff: ${task} Pick a send day`);
    expect(markdown).toContain(`## Project ${project}: Weekly digest`);

    const report = await call<{ applied: string; synced: { pushed: boolean } }>("report_handoff", {
      task,
      outcome: "Chose Monday.",
      verification: "Tests pass.",
      prs: ["https://github.com/bfarkas/digest/pull/3"],
      status: "done",
      follow_ups: [{ title: "Add a time-zone setting" }],
    });
    expect(report.isError).toBe(false);
    expect(report.data).toMatchObject({ applied: expect.stringMatching(/^[0-9a-f]{40}$/), synced: { pushed: true } });
    expect(remoteSubject()).toBe(`report: ${task}: Pick a send day (done)`);
    expect(ws.git("log", "-1", "--format=%B", "origin/main")).toContain("OctoSprout-Operation: task-update\nOctoSprout-Actor: agent:test");
    expect((await call<{ status: string }>("get_record", { id: task })).data.status).toBe("done");
    expect((await call("get_handoff_context", { task: project })).isError).toBe(true);
  });

  it("logs progress on a task directly and unblocks on done", async () => {
    const task = makeTask("Build it");
    const waiting = makeTask("Ship it");
    make("link", task, "blocks", waiting);
    make("move", waiting, "blocked");

    const started = await call<{ applied: string }>("log_progress", { task, note: "Started.", status: "in_progress" });
    expect(started.isError).toBe(false);
    expect(remoteSubject()).toBe(`progress: ${task}: Build it (in_progress)`);
    const record = await call<{ status: string; body: string }>("get_record", { id: task });
    expect(record.data.status).toBe("in_progress");
    expect(record.data.body).toMatch(/### \d{4}-\d{2}-\d{2}: progress, backlog → in_progress \(agent:test\)\n\nStarted\./);

    await call("log_progress", { task, note: "Done.", status: "done" });
    expect((await call<{ status: string }>("get_record", { id: waiting })).data.status).toBe("ready");
  });

  it("update_task commits task changes and proposes anything else", async () => {
    const task = makeTask("Tick it");
    const idea = make("new", "idea", "Not a task");
    const t = await call<{ base_blob: string }>("get_record", { id: task });
    const direct = await call<{ applied?: string }>("update_task", { title: "Start it", operations: [{ op: "set_status", id: task, base_blob: t.data.base_blob, status: "ready" }] });
    expect(direct.data.applied).toMatch(/^[0-9a-f]{40}$/);

    const i = await call<{ base_blob: string }>("get_record", { id: idea });
    const proposed = await call<{ proposal?: string; reasons: string[] }>("update_task", { title: "Grow it", operations: [{ op: "set_status", id: idea, base_blob: i.data.base_blob, status: "sprouting" }] });
    expect(proposed.data.proposal).toMatch(/^OS-PROP-/);
    expect(proposed.data.reasons).toEqual(["It changes more than tasks."]);
    expect((await call<{ status: string }>("get_record", { id: idea })).data.status).not.toBe("sprouting");

    // `body` instead of `content` used to surface a raw Node error from the write.
    const t2 = await call<{ base_blob: string }>("get_record", { id: task });
    const malformed = await call<{ error: string }>("update_task", { title: "Bad shape", operations: [{ op: "update", id: task, base_blob: t2.data.base_blob, body: "x" }] });
    expect(malformed.isError).toBe(true);
    expect(malformed.data.error).toContain("operation 1 (update): must have required property 'content'");
    expect(malformed.data.error).toContain("must NOT have additional properties: body");
  });

  it("proposes triage, ADRs and promotions", async () => {
    const capture = make("capture", "Digest by email\nweekly, on Mondays");
    const triage = await call<{ proposal: string }>("propose_triage", { capture, action: "create", type: "idea", rationale: "Worth growing." });
    expect(triage.isError).toBe(false);
    expect(remoteSubject()).toBe(`propose: ${triage.data.proposal} Triage ${capture}: idea Digest by email`);

    const adr = await call<{ kind: string }>("propose_adr", { title: "Send digests by email", rationale: "Recording the choice." });
    expect(adr.data.kind).toBe("proposed");
    expect((await call("propose_adr", { title: "x", project: capture, rationale: "x" })).isError).toBe(true);

    const idea = make("new", "idea", "Digest");
    expect((await call("propose_promotion", { idea, project_title: "Digest", rationale: "x" })).isError).toBe(true);
    make("move", idea, "sprouting");
    make("move", idea, "ready");
    const promotion = await call<{ consequential: boolean }>("propose_promotion", { idea, project_title: "Weekly digest", tasks: ["Pick a day"], rationale: "Ready." });
    expect(promotion.isError).toBe(false);
    expect(promotion.data.consequential).toBe(true);
  }, 20_000); // Several git commits; slow under the full parallel suite.
});
