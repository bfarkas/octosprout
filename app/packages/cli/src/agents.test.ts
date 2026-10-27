/**
 * The agent instructions must match the code (spec §16, §20 "Agent
 * workflows"): every MCP tool has a CLI equivalent in AGENTS.md, so the
 * skills work with MCP disabled; the skills name only tools that exist; and
 * AGENTS.md lists exactly the skills that ship.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";

import { COMMANDS } from "./commands.js";
import { DEFAULT_TEMPLATES_DIR } from "./init.js";
import { createMcpServer } from "./mcp.js";

const AGENTS = readFileSync(join(DEFAULT_TEMPLATES_DIR, "agents/AGENTS.md"), "utf8");
const SKILLS_DIR = join(DEFAULT_TEMPLATES_DIR, "skills");
const SKILLS = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
/** Commands handled outside COMMANDS, in index.ts. */
const OTHER_COMMANDS = ["init", "validate", "mcp"];

let tools: string[];

beforeAll(async () => {
  // Listing tools needs no workspace.
  const server = createMcpServer("/nonexistent", { actor: "agent:test" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
  tools = (await client.listTools()).tools.map((t) => t.name).sort();
  await client.close();
});

/** Rows of the MCP-to-CLI table: the tools named in the first cell, the commands in the second. */
function toolTable(): Array<{ tools: string[]; commands: string[] }> {
  return AGENTS.split("\n")
    .map((line) => /^\s*\|\s*(`[a-z_]+`(?:,\s*`[a-z_]+`)*)\s*\|\s*(.+?)\s*\|\s*$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      tools: [...m[1]!.matchAll(/`([a-z_]+)`/g)].map((t) => t[1]!),
      // `octosprout search`, `inbox`, `proposals`: the first names the CLI, the rest are its commands.
      commands: [...m[2]!.matchAll(/`(?:octosprout )?([a-z]+)[^`]*`/g)].map((c) => c[1]!),
    }));
}

describe("AGENTS.md", () => {
  it("maps every MCP tool to a CLI command that exists, so skills work without MCP", () => {
    const rows = toolTable();
    expect(rows.flatMap((r) => r.tools).sort()).toEqual(tools);
    for (const row of rows) {
      expect(row.commands.length, row.tools.join(", ")).toBeGreaterThan(0);
      for (const command of row.commands) expect(command in COMMANDS || OTHER_COMMANDS.includes(command), `octosprout ${command}`).toBe(true);
    }
  });

  it("lists exactly the skills that ship", () => {
    const section = AGENTS.slice(AGENTS.indexOf("\n## Skills\n"));
    const listed = [...section.matchAll(/^- `([a-z-]+)`: /gm)].map((m) => m[1]!).sort();
    expect(listed).toEqual(SKILLS);
    expect(SKILLS).toEqual(["advise", "capture", "explore", "handoff", "promote", "relate", "report", "review-backlog", "triage"]);
  });
});

describe("the skills", () => {
  it.each(SKILLS)("%s names only tools and commands that exist, and ends on a completion criterion", (name) => {
    const text = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
    for (const [, tool] of text.matchAll(/`((?:get|list|search|propose|draft)_[a-z_]+)`/g)) expect(tools, `${name}: ${tool}`).toContain(tool);
    for (const [, command] of text.matchAll(/octosprout ([a-z]+)/g)) expect(command! in COMMANDS || OTHER_COMMANDS.includes(command!), `${name}: octosprout ${command}`).toBe(true);
    expect(text).toMatch(/\*\*Done when\*\*/);
  });
});

describe("dependencies", () => {
  it("nothing depends on MemPalace", () => {
    const root = join(DEFAULT_TEMPLATES_DIR, "..");
    const manifests = ["app/package.json", "app/packages/core/package.json", "app/packages/server/package.json", "app/packages/cli/package.json"];
    for (const manifest of manifests) expect(readFileSync(join(root, manifest), "utf8").toLowerCase()).not.toContain("mempalace");
  });
});
