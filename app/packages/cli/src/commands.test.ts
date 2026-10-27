import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCommand } from "./commands.js";
import { makeWorkspace, type TestWorkspace } from "./test-workspace.js";

let ws: TestWorkspace;
let out: string[];
let err: string[];

beforeEach(() => {
  ws = makeWorkspace();
  out = [];
  err = [];
});
afterEach(() => ws.dispose());

const run = (args: string[], env: NodeJS.ProcessEnv = {}, stdin = "") =>
  runCommand(args[0]!, args.slice(1), { cwd: ws.root, io: { out: (t) => out.push(t), err: (t) => err.push(t) }, env, stdin: () => stdin });
const json = <T = Record<string, unknown>>(): T => JSON.parse(out[out.length - 1]!) as T;
const AGENT = { OCTOSPROUT_ACTOR: "agent:claude-code" };
const subject = () => ws.git("log", "-1", "--format=%s");

describe("writing as a person", () => {
  it("new commits a record from the template, with the trailers", () => {
    expect(run(["new", "idea", "Weekly", "digest", "--json"])).toBe(0);
    const { id, kind, path } = json<{ id: string; kind: string; path: string }>();
    expect(kind).toBe("committed");
    expect(path).toMatch(new RegExp(`^records/ideas/${id}--weekly-digest\\.md$`));
    expect(readFileSync(join(ws.root, path), "utf8")).toContain("## Motivation");
    expect(subject()).toBe(`create: ${id} Weekly digest`);
    expect(ws.git("log", "-1", "--format=%B")).toContain("OctoSprout-Actor: cli");
    expect(ws.git("status", "--porcelain")).toBe("");
  });

  it("new links tasks to a project and decisions to what they supersede", () => {
    run(["new", "project", "Digest", "--json"]);
    const project = json<{ id: string }>().id;
    expect(run(["new", "task", "Pick", "a", "day", "--project", project, "--json"])).toBe(0);
    run(["show", json<{ id: string }>().id, "--json"]);
    expect(json<{ links: unknown[] }>().links).toEqual([{ rel: "belongs_to", id: project }]);
    run(["new", "decision", "Poll", "--json"]);
    const old = json<{ id: string }>().id;
    expect(run(["new", "decision", "Push", "instead", "--supersedes", old, "--json"])).toBe(0);
    expect(run(["new", "task", "x", "--project", old])).toBe(1);
  });

  it("capture stores stdin verbatim", () => {
    expect(run(["capture", "-", "--source", "claude", "--json"], {}, "  verbatim\r\ntext 🌱\n")).toBe(0);
    const { id } = json<{ id: string }>();
    run(["show", id, "--json"]);
    expect(json<{ body: string; frontmatter: { source: string } }>()).toMatchObject({ body: "  verbatim\r\ntext 🌱\n", frontmatter: { source: "claude" } });
    run(["inbox", "--json"]);
    expect(json<unknown[]>()).toHaveLength(1);
  });

  it("move commits routine moves, refuses forbidden ones and unblocks tasks", () => {
    run(["new", "idea", "Idea", "--json"]);
    const idea = json<{ id: string }>().id;
    expect(run(["move", idea, "sprouting"])).toBe(0);
    expect(subject()).toBe(`status: ${idea} seed -> sprouting`);
    expect(run(["move", idea, "transplanted"])).toBe(1);
    expect(err.join("\n")).toContain("cannot move");

    const contract = "## Objective\nX\n## Acceptance criteria\n- [ ] Y\n## Verification\nZ\n";
    run(["new", "task", "Blocker", "--body-file", "-", "--json"], {}, contract);
    const blocker = json<{ id: string }>().id;
    run(["new", "task", "Blocked", "--body-file", "-", "--json"], {}, contract);
    const blocked = json<{ id: string }>().id;
    run(["link", blocker, "blocks", blocked]);
    run(["move", blocked, "blocked"]);
    expect(run(["move", blocker, "done", "--json"])).toBe(0);
    expect(json()).toMatchObject({ kind: "committed", unblocked: [blocked] });
    expect(subject()).toBe(`status: ${blocker} backlog -> done (+1 unblocked)`);
    run(["show", blocked, "--json"]);
    expect(json()).toMatchObject({ status: "ready" });
  });

  it("refuses a change that would make the workspace invalid", () => {
    run(["new", "task", "Empty", "--json"]);
    const task = json<{ id: string }>().id;
    expect(run(["move", task, "ready"])).toBe(1);
    expect(err.join("\n")).toContain("OSV009");
    expect(ws.git("status", "--porcelain")).toBe("");
  });

  it("turns consequential moves into proposals", () => {
    run(["new", "project", "Brief", "--body-file", "-", "--json"], {}, "## Goals\nA\n## Non-goals\nB\n## Scope\nC\n## Success criteria\nD\n");
    const project = json<{ id: string }>().id;
    run(["move", project, "active"]);
    expect(run(["move", project, "archived", "--json"])).toBe(0);
    expect(json()).toMatchObject({ kind: "proposed", consequential: true });
    run(["show", project, "--json"]);
    expect(json()).toMatchObject({ status: "active" });
    run(["proposals", "--json"]);
    expect(json<unknown[]>()).toEqual([expect.objectContaining({ consequential: true, actor: "cli" })]);
  });

  it("triage commits a routine triage, and promote always proposes", () => {
    run(["capture", "Weekly digest", "--json"]);
    const capture = json<{ id: string }>().id;
    expect(run(["triage", capture, "create", "idea", "--json"])).toBe(0);
    const { id, kind } = json<{ id: string; kind: string }>();
    expect(kind).toBe("committed");
    run(["show", id, "--json"]);
    expect(json<{ title: string; links: unknown[] }>()).toMatchObject({ title: "Weekly digest", links: [{ rel: "derived_from", id: capture }] });
    run(["show", capture, "--json"]);
    expect(json<{ status: string }>().status).toBe("planted");
    expect(run(["triage", capture, "attach"])).toBe(2);

    run(["move", id, "sprouting"]);
    run(["move", id, "ready"]);
    expect(run(["promote", id, "Weekly", "digest", "--tasks-file", "-", "--json"], {}, "- Pick a day\n- Write the template\n")).toBe(0);
    const promoted = json<{ kind: string; consequential: boolean; project: string }>();
    expect(promoted).toMatchObject({ kind: "proposed", consequential: true });
    expect(promoted.project).toMatch(/^OS-P-/);
    run(["proposals", "--json"]);
    expect(out.join("\n")).toContain(`Promote ${id} to Weekly digest`);
  });

  it("links and unlinks records", () => {
    run(["new", "idea", "A", "--json"]);
    const a = json<{ id: string }>().id;
    run(["new", "idea", "B", "--json"]);
    const b = json<{ id: string }>().id;
    expect(run(["link", a, "relates_to", b.toLowerCase()])).toBe(0);
    run(["show", b, "--json"]);
    expect(json<{ backlinks: unknown[] }>().backlinks).toEqual([{ rel: "relates_to", id: a, title: "A" }]);
    expect(run(["unlink", a, "relates_to", b])).toBe(0);
    expect(run(["link", a, "parent_of", b])).toBe(2);
  });
});

describe("writing as an agent", () => {
  it("every write becomes a proposal, and records stay unchanged", () => {
    expect(run(["new", "idea", "From", "Claude", "--json"], AGENT)).toBe(0);
    const proposed = json<{ id: string; kind: string; proposal: string }>();
    expect(proposed).toMatchObject({ kind: "proposed" });
    expect(ws.git("log", "-1", "--format=%B")).toContain("OctoSprout-Actor: agent:claude-code");
    expect(ws.git("show", "--name-only", "--format=", "HEAD")).toMatch(/^proposals\/\d{4}\/\d{2}\/OS-PROP-[0-9A-Z]{5}\.md$/);
    // The idea does not exist until the proposal is approved in the browser.
    expect(run(["show", proposed.id])).toBe(1);
    expect(err.join("\n")).toContain(`no record ${proposed.id}`);
  });

  it("propose takes JSON on stdin", () => {
    run(["new", "idea", "Idea", "--json"]);
    const { id } = json<{ id: string }>();
    run(["show", id, "--json"]);
    const blob = json<{ base_blob: string }>().base_blob;
    const proposal = { title: "Explore it", rationale: "Because.", operations: [{ op: "set_status", id, base_blob: blob, status: "sprouting" }] };
    expect(run(["propose", "-", "--json"], AGENT, JSON.stringify(proposal))).toBe(0);
    expect(json()).toMatchObject({ kind: "proposed", consequential: false });
    expect(run(["propose", "-"], AGENT, "{ not json")).toBe(2);
  });

  it("new --draft prints a record for a larger proposal and writes nothing", () => {
    run(["new", "idea", "Idea", "--json"]);
    const idea = json<{ id: string }>().id;
    run(["show", idea, "--json"]);
    const blob = json<{ base_blob: string }>().base_blob;
    const head = ws.git("rev-parse", "HEAD");
    expect(run(["new", "research", "Prior", "art", "--draft", "--json"], AGENT, "")).toBe(0);
    const draft = json<{ id: string; path: string; content: string }>();
    expect(draft.content).toContain(`id: ${draft.id}`);
    expect(ws.git("rev-parse", "HEAD")).toBe(head);
    const operations = [
      { op: "create", path: draft.path, content: draft.content.replace("\n---\n", "\nlinks:\n  - { rel: supports, id: " + idea + " }\n---\n") },
      { op: "set_status", id: idea, base_blob: blob, status: "sprouting" },
    ];
    expect(run(["propose", "-", "--json"], AGENT, JSON.stringify({ title: "Explore", rationale: "x", operations }))).toBe(0);
    expect(json()).toMatchObject({ kind: "proposed" });
  });

  it("new decision takes a body that keeps the ADR structure", () => {
    run(["new", "decision", "Poll", "--draft", "--json"]);
    const draft = json<{ content: string }>();
    // A body written for another ID gets this record's heading.
    const body = draft.content.slice(draft.content.indexOf("\n---\n") + 5).replace(/^## Decision\n/m, "## Decision\n\nWe poll every minute.\n");
    expect(run(["new", "decision", "Poll", "often", "--body-file", "-", "--json"], {}, body), err.join("\n")).toBe(0);
    const { id, path } = json<{ id: string; path: string }>();
    const text = readFileSync(join(ws.root, path), "utf8");
    expect(text).toContain(`# ADR ${id} - Poll often`);
    expect(text).toContain("We poll every minute.");
  });

  it("rejects a malformed actor", () => {
    expect(run(["new", "idea", "x"], { OCTOSPROUT_ACTOR: "root" })).toBe(1);
  });
});

describe("reading and syncing", () => {
  it("search finds records by words, type and status", () => {
    run(["new", "idea", "Weekly", "digest"]);
    run(["new", "task", "Send", "the", "digest"]);
    out = [];
    run(["search", "digest", "--type", "task", "--json"]);
    expect(json<Array<{ title: string }>>().map((h) => h.title)).toEqual(["Send the digest"]);
    run(["search", "--status", "seed", "--json"]);
    expect(json<unknown[]>()).toHaveLength(1);
  });

  it("sync pushes when the workspace validates, and refuses otherwise", () => {
    run(["new", "idea", "Pushed"]);
    expect(run(["sync"])).toBe(0);
    expect(ws.git("rev-parse", "HEAD")).toBe(ws.git("rev-parse", "origin/main"));

    writeFileSync(join(ws.root, "records/ideas/OS-I-ZZZZZ--bad.md"), "---\nid: OS-I-ZZZZZ\n---\n");
    ws.git("add", "-A");
    ws.git("commit", "-q", "-m", "bad");
    expect(run(["sync"])).toBe(1);
    expect(ws.git("rev-parse", "HEAD")).not.toBe(ws.git("rev-parse", "origin/main"));
  });
});
