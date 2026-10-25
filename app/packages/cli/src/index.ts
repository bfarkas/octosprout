#!/usr/bin/env node
/**
 * octosprout CLI (§4.1) and `octosprout mcp`, the local stdio MCP server (§16.3).
 *
 * Implemented: validate. Planned: init, new, capture, show, handoff, propose, report, sync, mcp.
 */
import { runValidate } from "./validate.js";

const [command, ...args] = process.argv.slice(2);

const io = {
  out: (text: string) => console.log(text),
  err: (text: string) => console.error(text),
};

switch (command) {
  case "validate":
    process.exitCode = runValidate(args, process.cwd(), io);
    break;
  default:
    console.error(command ? `octosprout: unknown command '${command}'` : "usage: octosprout <command>");
    console.error("commands: validate");
    process.exitCode = 2;
}
