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
const make = (...args: string[]): string => {
  const out: string[] = [];
  expect(runCommand(args[0]!, [...args.slice(1), "--json"], { cwd: ws.root, io: { out: (t) => out.push(t), err: () => {} }, env: {}, stdin: () => "" })).toBe(0);
  return (JSON.parse(out[out.length - 1]!) as { id: string }).id;
};

const call = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<{ data: T; isError: boolean }> => {
  const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { data: JSON.parse(result.content[0]!.text) as T, isError: result.isError === true };
};

const remoteSubject = () => ws.git("log", "-1", "--format=%s", "origin/main");

describe("octosprout mcp", () => {
  it("lists the read and proposal tools of §16.3", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["get_record", "get_related", "list_inbox", "list_proposals", "propose", "propose_adr", "propose_promotion", "propose_triage", "search_records", "sync", "validate"].sort(),
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

  it("refuses a stale base_blob and a change that would not validate", async () => {
    const idea = make("new", "idea", "Digest");
    const result = await call("propose", { title: "x", rationale: "x", operations: [{ op: "set_status", id: idea, base_blob: "0".repeat(40), status: "sprouting" }] });
    expect(result.isError).toBe(true);
    const { data } = await call<{ base_blob: string }>("get_record", { id: idea });
    const invalid = await call("propose", { title: "x", rationale: "x", operations: [{ op: "set_status", id: idea, base_blob: data.base_blob, status: "growing" }] });
    expect(invalid.isError).toBe(true);
    expect(ws.git("log", "-1", "--format=%s")).not.toMatch(/^propose:/);
  });

  it("proposes triage, ADRs and promotions", async () => {
    const capture = make("capture", "Digest by email\nweekly, on Mondays");
    const triage = await call<{ proposal: string }>("propose_triage", { capture, action: "create", type: "idea", rationale: "Worth growing." });
    expect(triage.isError).toBe(false);
    expect(remoteSubject()).toBe(`propose: ${triage.data.proposal} Triage ${capture}: create`);

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
  });
});
