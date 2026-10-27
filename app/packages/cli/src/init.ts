/**
 * `octosprout init [dir]`: creates the private workspace skeleton (spec §5.2)
 * from the starter templates (§5.1), registers the MCP server for Claude
 * Code in `.mcp.json` (§16.3) and installs the pre-push hook (§8.5).
 *
 * Init never overwrites: files that already exist are skipped, so it is safe
 * to run again.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Io } from "./io.js";

/** `<repo>/templates/`, resolved from `packages/cli/{src,dist}/`. */
export const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL("../../../../templates/", import.meta.url));

/** Directories kept in Git with a `.gitkeep` until they hold records. */
const RECORD_DIRS = [
  "records/captures",
  "records/ideas",
  "records/tasks",
  "records/projects",
  "records/decisions",
  "records/research",
  "experts",
  "proposals",
  "skills",
];

export interface InitOptions {
  templatesDir?: string;
  /** Script the pre-push hook and `.mcp.json` run. Defaults to the running CLI. */
  cliPath?: string;
}

function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFiles(dir, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/** Claude Code runs `octosprout mcp` as an agent, so its writes become proposals (§9.1). */
function mcpConfig(cliPath: string): string {
  const config = { mcpServers: { octosprout: { command: "node", args: [cliPath, "mcp"], env: { OCTOSPROUT_ACTOR: "agent:claude-code" } } } };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Returns the process exit code: 0 on success, 2 on usage or I/O errors. */
export function runInit(args: readonly string[], cwd: string, io: Io, options: InitOptions = {}): number {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const unknown = args.find((arg) => arg.startsWith("-"));
  if (unknown !== undefined || positional.length > 1) {
    io.err(`octosprout init: ${unknown !== undefined ? `unknown option ${unknown}` : "too many arguments"}\nusage: octosprout init [dir]`);
    return 2;
  }

  const templates = options.templatesDir ?? DEFAULT_TEMPLATES_DIR;
  const target = resolve(cwd, positional[0] ?? ".");
  const created: string[] = [];
  const skipped: string[] = [];

  const put = (relative: string, content: string | Buffer): void => {
    const path = join(target, relative);
    if (existsSync(path)) {
      skipped.push(relative);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    created.push(relative);
  };

  try {
    mkdirSync(target, { recursive: true });

    const workspaceDir = join(templates, "workspace");
    for (const file of listFiles(workspaceDir)) put(file, readFileSync(join(workspaceDir, file)));
    put("AGENTS.md", readFileSync(join(templates, "agents/AGENTS.md")));
    put("CLAUDE.md", readFileSync(join(templates, "agents/CLAUDE.md")));
    put("prompts/chatgpt-handoff.md", readFileSync(join(templates, "prompts/chatgpt-handoff.md")));
    for (const dir of RECORD_DIRS) put(`${dir}/.gitkeep`, "");

    const cliPath = resolve(options.cliPath ?? process.argv[1] ?? "octosprout");
    put(".mcp.json", mcpConfig(cliPath));
    installPrePushHook(target, cliPath, created, skipped, io);
  } catch (error) {
    io.err(`octosprout init: ${(error as Error).message}`);
    return 2;
  }

  for (const file of created) io.out(`created  ${file}`);
  for (const file of skipped) io.out(`skipped  ${file} (already exists)`);
  io.err(`${created.length} created, ${skipped.length} skipped in ${target}`);
  return 0;
}

function installPrePushHook(target: string, cliPath: string, created: string[], skipped: string[], io: Io): void {
  const gitDir = join(target, ".git");
  if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) {
    io.err("Not a Git repository; skipped the pre-push hook. Run `octosprout init` again after `git init`.");
    return;
  }
  const relative = ".git/hooks/pre-push";
  const hook = join(target, relative);
  if (existsSync(hook)) {
    skipped.push(relative);
    return;
  }
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(
    hook,
    `#!/bin/sh\n# Installed by \`octosprout init\`. Blocks pushes while the workspace fails validation.\nexec node ${shellQuote(resolve(cliPath))} validate\n`,
  );
  chmodSync(hook, 0o755);
  created.push(relative);
}
