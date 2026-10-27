#!/usr/bin/env node
/**
 * octosprout CLI (§4.1) and `octosprout mcp`, the local stdio MCP server (§16.3).
 *
 * With OCTOSPROUT_ACTOR=agent:<name>, every writing command creates a
 * proposal instead of changing records (§9.1).
 */
import { readFileSync } from "node:fs";

import { COMMANDS, runCommand } from "./commands.js";
import { runInit } from "./init.js";
import { runValidate } from "./validate.js";

const USAGE = `usage: octosprout <command> [args] [--json]

  init [dir]                         create a workspace skeleton
  validate [--ci] [--json] [path…]   check the workspace (spec §19)
  new <type> <title…>                idea, task, project, decision, research or expert
                                     [--project ID] [--supersedes ID] [--body-file FILE|-]
                                     [--draft] prints the record for a proposal instead
  capture <text…> | -                [--source claude] [--url https://…]
  show <ID>                          a record with its base_blob, links and backlinks
  search [words…]                    [--type T] [--status S] [--limit N]
  inbox                              captures waiting for triage
  triage <capture> create <type> [title…] | attach <ID> | compost
                                     [--body-file FILE|-] [--rationale TEXT]
  promote <idea> <project title…>    [--brief-file F|-] [--tasks-file F|-] [--active]
  advise <decision> <file.json | ->  simulated expert advice { model, advice, new_experts?, synthesis? }
  handoff <task>                     the context bundle for a coding agent (Markdown)
  report <task> <file.json | ->      a handoff report { outcome, verification, prs?, commits?, status?, follow_ups? }
  move <ID> <status>                 a status change (consequential ones become proposals)
  link|unlink <ID> <rel> <target>    add or remove a typed link
  propose <file.json | ->            a proposal { title, rationale, operations }
  proposals                          pending proposals [--status S]
  sync                               fetch, rebase, validate, push
  mcp                                the stdio MCP server for Claude Code`;

const [command, ...args] = process.argv.slice(2);

const io = {
  out: (text: string) => console.log(text),
  err: (text: string) => console.error(text),
};

if (command === "init") {
  process.exitCode = runInit(args, process.cwd(), io);
} else if (command === "validate") {
  process.exitCode = runValidate(args, process.cwd(), io);
} else if (command === "mcp") {
  const { runMcpServer } = await import("./mcp.js");
  await runMcpServer(process.cwd());
} else if (command !== undefined && command in COMMANDS) {
  process.exitCode = runCommand(command, args, { cwd: process.cwd(), io, env: process.env, stdin: () => readFileSync(0, "utf8") });
} else {
  console.error(command && command !== "help" && command !== "--help" ? `octosprout: unknown command '${command}'\n\n${USAGE}` : USAGE);
  process.exitCode = command === "help" || command === "--help" ? 0 : 2;
}
